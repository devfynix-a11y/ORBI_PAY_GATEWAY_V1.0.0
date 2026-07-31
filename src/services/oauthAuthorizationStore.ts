import crypto from 'crypto';
import { Pool } from 'pg';
import { config } from '../config.js';
import { decryptSecret, encryptSecret } from '../security/secretVaultCrypto.js';

export type OAuthAuthorizationRecord = {
  requestId: string;
  upstreamState: string;
  serviceCode: string;
  environment: 'sandbox' | 'live';
  redirectUri: string;
  requestedScopes: string[];
  clientState: string;
  codeChallenge: string;
  nonce: string;
  upstreamVerifier: string;
  approvalToken: string;
  subjectId?: string;
  status: 'pending_identity' | 'pending_consent' | 'approved' | 'denied';
  expiresAt: string;
};

export type OAuthAuthorizationCode = {
  serviceCode: string;
  environment: 'sandbox' | 'live';
  redirectUri: string;
  scopes: string[];
  subjectId: string;
  consentId: string;
  codeChallenge: string;
};

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export class OAuthAuthorizationStore {
  private pool?: Pool;

  async initialize() {
    if (this.pool) return;
    if (!config.databaseUrl) throw new Error('DATABASE_URL_REQUIRED');
    this.pool = new Pool({ connectionString: config.databaseUrl });
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS public.pay_gateway_oauth_authorizations (
        request_id text PRIMARY KEY,
        upstream_state_hash text UNIQUE NOT NULL,
        service_code text NOT NULL,
        environment text NOT NULL CHECK (environment IN ('sandbox','live')),
        redirect_uri text NOT NULL,
        requested_scopes text[] NOT NULL,
        client_state text NOT NULL,
        code_challenge text NOT NULL,
        nonce text NOT NULL,
        upstream_verifier jsonb NOT NULL,
        approval_token jsonb NOT NULL,
        approval_token_hash text NOT NULL,
        subject_id text,
        status text NOT NULL,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_pay_gateway_oauth_authorization_expiry
        ON public.pay_gateway_oauth_authorizations (expires_at, status);
      CREATE TABLE IF NOT EXISTS public.pay_gateway_oauth_codes (
        code_hash text PRIMARY KEY,
        service_code text NOT NULL,
        environment text NOT NULL CHECK (environment IN ('sandbox','live')),
        redirect_uri text NOT NULL,
        scopes text[] NOT NULL,
        subject_id text NOT NULL,
        consent_id text NOT NULL,
        code_challenge text NOT NULL,
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_pay_gateway_oauth_code_expiry
        ON public.pay_gateway_oauth_codes (expires_at, consumed_at);
    `);
  }

  async create(input: Omit<OAuthAuthorizationRecord, 'status'>) {
    this.assertReady();
    await this.pool!.query(
      `INSERT INTO public.pay_gateway_oauth_authorizations (
        request_id, upstream_state_hash, service_code, environment, redirect_uri,
        requested_scopes, client_state, code_challenge, nonce, upstream_verifier,
        approval_token, approval_token_hash, status, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,'pending_identity',$13)`,
      [input.requestId, hash(input.upstreamState), input.serviceCode, input.environment,
        input.redirectUri, input.requestedScopes, input.clientState, input.codeChallenge,
        input.nonce, JSON.stringify(encryptSecret(input.upstreamVerifier)),
        JSON.stringify(encryptSecret(input.approvalToken)), hash(input.approvalToken), input.expiresAt],
    );
  }

  async completeIdentity(upstreamState: string, subjectId: string) {
    this.assertReady();
    const result = await this.pool!.query(
      `UPDATE public.pay_gateway_oauth_authorizations
       SET subject_id=$2, status='pending_consent', updated_at=now()
       WHERE upstream_state_hash=$1 AND status='pending_identity' AND expires_at > now()
       RETURNING *`,
      [hash(upstreamState), subjectId],
    );
    if (result.rowCount !== 1) throw new Error('OAUTH_AUTHORIZATION_STATE_INVALID');
    return this.fromRow(result.rows[0]);
  }

  async getForConsent(requestId: string, approvalToken: string) {
    this.assertReady();
    const result = await this.pool!.query(
      `SELECT * FROM public.pay_gateway_oauth_authorizations
       WHERE request_id=$1 AND approval_token_hash=$2
         AND status='pending_consent' AND expires_at > now()`,
      [requestId, hash(approvalToken)],
    );
    if (result.rowCount !== 1) throw new Error('OAUTH_AUTHORIZATION_REQUEST_INVALID');
    return this.fromRow(result.rows[0]);
  }

  async replacePendingSubject(requestId: string, subjectId: string) {
    this.assertReady();
    const result = await this.pool!.query(
      `UPDATE public.pay_gateway_oauth_authorizations SET subject_id=$2, updated_at=now()
       WHERE request_id=$1 AND status='pending_consent' AND expires_at > now()
       RETURNING *`,
      [requestId, subjectId],
    );
    if (result.rowCount !== 1) throw new Error('OAUTH_AUTHORIZATION_REQUEST_INVALID');
    return this.fromRow(result.rows[0]);
  }

  async decide(requestId: string, approvalToken: string, decision: 'approved' | 'denied') {
    this.assertReady();
    const result = await this.pool!.query(
      `UPDATE public.pay_gateway_oauth_authorizations SET status=$3, updated_at=now()
       WHERE request_id=$1 AND approval_token_hash=$2
         AND status='pending_consent' AND expires_at > now()
       RETURNING *`,
      [requestId, hash(approvalToken), decision],
    );
    if (result.rowCount !== 1) throw new Error('OAUTH_AUTHORIZATION_REQUEST_INVALID');
    return this.fromRow(result.rows[0]);
  }

  async issueCode(record: OAuthAuthorizationRecord, consentId: string, ttlSeconds: number) {
    this.assertReady();
    if (!record.subjectId) throw new Error('OAUTH_AUTHORIZATION_SUBJECT_REQUIRED');
    const code = `orbi_ac_${crypto.randomBytes(32).toString('base64url')}`;
    await this.pool!.query(
      `INSERT INTO public.pay_gateway_oauth_codes (
        code_hash, service_code, environment, redirect_uri, scopes, subject_id,
        consent_id, code_challenge, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now() + ($9 * interval '1 second'))`,
      [hash(code), record.serviceCode, record.environment, record.redirectUri,
        record.requestedScopes, record.subjectId, consentId, record.codeChallenge, ttlSeconds],
    );
    return code;
  }

  async consumeCode(code: string, serviceCode: string, redirectUri: string, verifier: string) {
    this.assertReady();
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const client = await this.pool!.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT * FROM public.pay_gateway_oauth_codes
         WHERE code_hash=$1 FOR UPDATE`, [hash(code)],
      );
      const row = result.rows[0];
      if (!row || row.consumed_at || new Date(row.expires_at).getTime() <= Date.now()) {
        throw new Error('OAUTH_AUTHORIZATION_CODE_INVALID');
      }
      if (row.service_code !== serviceCode || row.redirect_uri !== redirectUri) {
        throw new Error('OAUTH_AUTHORIZATION_CODE_CLIENT_MISMATCH');
      }
      const expected = Buffer.from(row.code_challenge);
      const actual = Buffer.from(challenge);
      if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        throw new Error('OAUTH_PKCE_VERIFIER_INVALID');
      }
      await client.query(`UPDATE public.pay_gateway_oauth_codes SET consumed_at=now() WHERE code_hash=$1`, [hash(code)]);
      await client.query('COMMIT');
      return {
        serviceCode: row.service_code,
        environment: row.environment,
        redirectUri: row.redirect_uri,
        scopes: row.scopes,
        subjectId: row.subject_id,
        consentId: row.consent_id,
        codeChallenge: row.code_challenge,
      } as OAuthAuthorizationCode;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private fromRow(row: any): OAuthAuthorizationRecord {
    return {
      requestId: row.request_id, upstreamState: '', serviceCode: row.service_code,
      environment: row.environment, redirectUri: row.redirect_uri,
      requestedScopes: row.requested_scopes, clientState: row.client_state,
      codeChallenge: row.code_challenge, nonce: row.nonce,
      upstreamVerifier: decryptSecret(row.upstream_verifier),
      approvalToken: decryptSecret(row.approval_token),
      subjectId: row.subject_id || undefined, status: row.status,
      expiresAt: new Date(row.expires_at).toISOString(),
    };
  }

  private assertReady() {
    if (!this.pool) throw new Error('OAUTH_AUTHORIZATION_STORE_NOT_INITIALIZED');
  }
}

export const oauthAuthorizationStore = new OAuthAuthorizationStore();
