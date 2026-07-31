import crypto from 'crypto';
import { Pool, type PoolClient } from 'pg';
import { config } from '../config.js';
import type { FinancialAccessTokenClaims } from '../security/financialAccessToken.js';

export type RefreshTokenContext = {
  familyId: string;
  serviceCode: string;
  environment: 'sandbox' | 'live';
  subjectId: string;
  consentId: string;
  scopes: string[];
  identityIssuer: string;
};

export type RefreshRotationResult =
  | { status: 'rotated'; refreshToken: string; context: RefreshTokenContext }
  | { status: 'reuse_detected'; context: RefreshTokenContext; accessTokenClaims: FinancialAccessTokenClaims[] }
  | { status: 'invalid' };

type StoreOptions = { mode?: 'postgres' | 'memory'; databaseUrl?: string };
type MemoryToken = RefreshTokenContext & { hash: string; expiresAt: number; consumed: boolean; revoked: boolean };

const tokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const newToken = () => `orbi_rt_${crypto.randomBytes(48).toString('base64url')}`;

export class RefreshTokenStore {
  private readonly mode: 'postgres' | 'memory';
  private readonly databaseUrl?: string;
  private pool?: Pool;
  private initialized = false;
  private readonly memoryTokens = new Map<string, MemoryToken>();
  private readonly memoryFamilyClaims = new Map<string, FinancialAccessTokenClaims[]>();
  private readonly revokedFamilies = new Set<string>();

  constructor(options: StoreOptions = {}) {
    this.mode = options.mode || 'postgres';
    this.databaseUrl = options.databaseUrl || config.databaseUrl;
  }

  static inMemory() {
    const store = new RefreshTokenStore({ mode: 'memory' });
    store.initialized = true;
    return store;
  }

  async initialize() {
    if (this.initialized) return;
    if (!this.databaseUrl) throw new Error('DATABASE_URL_REQUIRED');
    this.pool = new Pool({ connectionString: this.databaseUrl });
    await this.ensureSchema();
    this.initialized = true;
  }

  async issue(input: Omit<RefreshTokenContext, 'familyId'>) {
    this.assertReady();
    const refreshToken = newToken();
    const familyId = `rtf_${crypto.randomUUID()}`;
    const context: RefreshTokenContext = { ...input, familyId };
    if (this.mode === 'memory') {
      this.memoryTokens.set(tokenHash(refreshToken), {
        ...context, hash: tokenHash(refreshToken),
        expiresAt: Date.now() + config.security.refreshTokenTtlSeconds * 1000,
        consumed: false, revoked: false,
      });
      return { refreshToken, context };
    }
    await this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO public.pay_gateway_refresh_token_families
           (family_id, service_code, environment, subject_id, consent_id, scopes, identity_issuer, absolute_expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,now() + ($8 * interval '1 second'))`,
          [familyId, input.serviceCode, input.environment, input.subjectId, input.consentId,
            input.scopes, input.identityIssuer, config.security.refreshTokenAbsoluteTtlSeconds],
        );
        await this.insertToken(client, refreshToken, familyId);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
    return { refreshToken, context };
  }

  async rotate(refreshToken: string, serviceCode: string): Promise<RefreshRotationResult> {
    this.assertReady();
    const hash = tokenHash(refreshToken);
    if (this.mode === 'memory') {
      const token = this.memoryTokens.get(hash);
      if (!token || token.serviceCode !== serviceCode || token.expiresAt <= Date.now() || token.revoked) return { status: 'invalid' };
      if (this.revokedFamilies.has(token.familyId)) return { status: 'invalid' };
      if (token.consumed) {
        this.revokedFamilies.add(token.familyId);
        return { status: 'reuse_detected', context: token, accessTokenClaims: this.memoryFamilyClaims.get(token.familyId) || [] };
      }
      token.consumed = true;
      const rotated = newToken();
      this.memoryTokens.set(tokenHash(rotated), { ...token, hash: tokenHash(rotated), consumed: false });
      return { status: 'rotated', refreshToken: rotated, context: token };
    }
    return this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const result = await client.query(
          `SELECT t.consumed_at, t.revoked_at AS token_revoked_at, t.expires_at,
                  f.family_id, f.service_code, f.environment, f.subject_id, f.consent_id,
                  f.scopes, f.identity_issuer, f.revoked_at AS family_revoked_at,
                  f.absolute_expires_at, f.access_token_claims, f.revoke_reason
           FROM public.pay_gateway_refresh_tokens t
           JOIN public.pay_gateway_refresh_token_families f ON f.family_id=t.family_id
           WHERE t.token_hash=$1 FOR UPDATE OF t, f`, [hash],
        );
        const row = result.rows[0];
        if (!row || row.service_code !== serviceCode || row.token_revoked_at ||
            new Date(row.expires_at).getTime() <= Date.now() || new Date(row.absolute_expires_at).getTime() <= Date.now()) {
          await client.query('ROLLBACK');
          return { status: 'invalid' };
        }
        const context = this.contextFromRow(row);
        if (row.family_revoked_at) {
          await client.query('ROLLBACK');
          return { status: 'invalid' };
        }
        if (row.consumed_at) {
          await client.query(
            `UPDATE public.pay_gateway_refresh_token_families
             SET revoked_at=COALESCE(revoked_at,now()), revoke_reason='refresh_token_reuse', updated_at=now()
             WHERE family_id=$1`, [row.family_id],
          );
          await client.query(`UPDATE public.pay_gateway_refresh_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE family_id=$1`, [row.family_id]);
          await client.query('COMMIT');
          return { status: 'reuse_detected', context, accessTokenClaims: row.access_token_claims || [] };
        }
        await client.query(`UPDATE public.pay_gateway_refresh_tokens SET consumed_at=now() WHERE token_hash=$1`, [hash]);
        const rotated = newToken();
        await this.insertToken(client, rotated, row.family_id);
        await client.query(`UPDATE public.pay_gateway_refresh_token_families SET updated_at=now() WHERE family_id=$1`, [row.family_id]);
        await client.query('COMMIT');
        return { status: 'rotated', refreshToken: rotated, context };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async recordAccessToken(familyId: string, claims: FinancialAccessTokenClaims) {
    this.assertReady();
    if (this.mode === 'memory') {
      this.memoryFamilyClaims.set(familyId, [...(this.memoryFamilyClaims.get(familyId) || []), claims]);
      return;
    }
    await this.withClient((client) => client.query(
      `UPDATE public.pay_gateway_refresh_token_families
       SET access_token_claims=access_token_claims || $2::jsonb, updated_at=now()
       WHERE family_id=$1 AND revoked_at IS NULL`,
      [familyId, JSON.stringify([claims])],
    ).then(() => undefined));
  }

  async revokeByConsent(consentId: string, reason = 'consent_revoked') {
    this.assertReady();
    if (this.mode === 'memory') {
      for (const token of this.memoryTokens.values()) if (token.consentId === consentId) this.revokedFamilies.add(token.familyId);
      return;
    }
    await this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const families = await client.query<{ family_id: string }>(
          `UPDATE public.pay_gateway_refresh_token_families SET revoked_at=COALESCE(revoked_at,now()), revoke_reason=$2, updated_at=now()
           WHERE consent_id=$1 RETURNING family_id`, [consentId, reason],
        );
        if (families.rows.length) await client.query(
          `UPDATE public.pay_gateway_refresh_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE family_id=ANY($1::text[])`,
          [families.rows.map((row) => row.family_id)],
        );
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    });
  }

  async revokeToken(refreshToken: string, serviceCode: string, reason = 'client_revoked') {
    this.assertReady();
    const hash = tokenHash(refreshToken);
    if (this.mode === 'memory') {
      const token = this.memoryTokens.get(hash);
      if (!token || token.serviceCode !== serviceCode) return false;
      this.revokedFamilies.add(token.familyId);
      return true;
    }
    return this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const families = await client.query<{ family_id: string }>(
          `SELECT f.family_id FROM public.pay_gateway_refresh_tokens t
           JOIN public.pay_gateway_refresh_token_families f ON f.family_id=t.family_id
           WHERE t.token_hash=$1 AND f.service_code=$2 FOR UPDATE OF t, f`, [hash, serviceCode],
        );
        if (!families.rows[0]) { await client.query('ROLLBACK'); return false; }
        const familyId = families.rows[0].family_id;
        await client.query(
          `UPDATE public.pay_gateway_refresh_token_families SET revoked_at=COALESCE(revoked_at,now()), revoke_reason=$2, updated_at=now()
           WHERE family_id=$1`, [familyId, reason],
        );
        await client.query(`UPDATE public.pay_gateway_refresh_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE family_id=$1`, [familyId]);
        await client.query('COMMIT');
        return true;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    });
  }

  async revokeByService(serviceCode: string, reason = 'service_suspended') {
    this.assertReady();
    if (this.mode === 'memory') {
      for (const token of this.memoryTokens.values()) if (token.serviceCode === serviceCode) this.revokedFamilies.add(token.familyId);
      return;
    }
    await this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const families = await client.query<{ family_id: string }>(
          `UPDATE public.pay_gateway_refresh_token_families SET revoked_at=COALESCE(revoked_at,now()), revoke_reason=$2, updated_at=now()
           WHERE service_code=$1 RETURNING family_id`, [serviceCode, reason],
        );
        if (families.rows.length) await client.query(
          `UPDATE public.pay_gateway_refresh_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE family_id=ANY($1::text[])`,
          [families.rows.map((row) => row.family_id)],
        );
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    });
  }

  async revokeBySubject(input: {
    subjectId: string;
    reason: 'logout' | 'risk_action' | 'account_lock';
    serviceCode?: string;
    environment?: 'sandbox' | 'live';
  }) {
    this.assertReady();
    if (this.mode === 'memory') {
      const claims: FinancialAccessTokenClaims[] = [];
      for (const token of this.memoryTokens.values()) {
        if (token.subjectId !== input.subjectId || (input.serviceCode && token.serviceCode !== input.serviceCode) ||
            (input.environment && token.environment !== input.environment)) continue;
        this.revokedFamilies.add(token.familyId);
        claims.push(...(this.memoryFamilyClaims.get(token.familyId) || []));
      }
      return claims;
    }
    return this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const families = await client.query<{ family_id: string; access_token_claims: FinancialAccessTokenClaims[] }>(
          `UPDATE public.pay_gateway_refresh_token_families
           SET revoked_at=COALESCE(revoked_at,now()), revoke_reason=$2, updated_at=now()
           WHERE subject_id=$1
             AND ($3::text IS NULL OR service_code=$3)
             AND ($4::text IS NULL OR environment=$4)
           RETURNING family_id,access_token_claims`,
          [input.subjectId, input.reason, input.serviceCode || null, input.environment || null],
        );
        if (families.rows.length) await client.query(
          `UPDATE public.pay_gateway_refresh_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE family_id=ANY($1::text[])`,
          [families.rows.map((row) => row.family_id)],
        );
        await client.query('COMMIT');
        return families.rows.flatMap((row) => row.access_token_claims || []);
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    });
  }

  private async insertToken(client: PoolClient, token: string, familyId: string) {
    await client.query(
      `INSERT INTO public.pay_gateway_refresh_tokens (token_hash,family_id,expires_at)
       VALUES ($1,$2,now() + ($3 * interval '1 second'))`,
      [tokenHash(token), familyId, config.security.refreshTokenTtlSeconds],
    );
  }

  private contextFromRow(row: any): RefreshTokenContext {
    return { familyId: row.family_id, serviceCode: row.service_code, environment: row.environment,
      subjectId: row.subject_id, consentId: row.consent_id, scopes: row.scopes,
      identityIssuer: row.identity_issuer };
  }

  private async ensureSchema() {
    await this.withClient((client) => client.query(`
      CREATE TABLE IF NOT EXISTS public.pay_gateway_refresh_token_families (
        family_id text PRIMARY KEY, service_code text NOT NULL,
        environment text NOT NULL CHECK(environment IN ('sandbox','live')),
        subject_id text NOT NULL, consent_id text NOT NULL REFERENCES public.pay_gateway_consent_receipts(consent_id),
        scopes text[] NOT NULL, identity_issuer text NOT NULL,
        access_token_claims jsonb NOT NULL DEFAULT '[]'::jsonb,
        absolute_expires_at timestamptz NOT NULL, revoked_at timestamptz,
        revoke_reason text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_pay_gateway_refresh_family_consent ON public.pay_gateway_refresh_token_families(consent_id,revoked_at);
      CREATE TABLE IF NOT EXISTS public.pay_gateway_refresh_tokens (
        token_hash text PRIMARY KEY, family_id text NOT NULL REFERENCES public.pay_gateway_refresh_token_families(family_id),
        expires_at timestamptz NOT NULL, consumed_at timestamptz, revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_pay_gateway_refresh_token_family ON public.pay_gateway_refresh_tokens(family_id,created_at DESC);
    `).then(() => undefined));
  }

  private async withClient<T>(operation: (client: PoolClient) => Promise<T>) {
    if (!this.pool) throw new Error('DATABASE_POOL_NOT_INITIALIZED');
    const client = await this.pool.connect();
    try { return await operation(client); } finally { client.release(); }
  }
  private assertReady() { if (!this.initialized) throw new Error('REFRESH_TOKEN_STORE_NOT_INITIALIZED'); }
}

export const refreshTokenStore = new RefreshTokenStore();
