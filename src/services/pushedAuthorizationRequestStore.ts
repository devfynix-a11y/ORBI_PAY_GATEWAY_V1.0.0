import crypto from 'crypto';
import { Pool } from 'pg';
import { config } from '../config.js';

export type PushedAuthorizationRequest = {
  requestUri: string;
  serviceCode: string;
  environment: 'sandbox' | 'live';
  payload: Record<string, unknown>;
  expiresAt: string;
};

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export class PushedAuthorizationRequestStore {
  private pool?: Pool;
  private memory = new Map<string, PushedAuthorizationRequest & { consumedAt?: string }>();

  static inMemory() {
    return new PushedAuthorizationRequestStore(true);
  }

  constructor(private readonly memoryOnly = false) {}

  async initialize() {
    if (this.memoryOnly || this.pool) return;
    if (!config.databaseUrl) throw new Error('DATABASE_URL_REQUIRED');
    this.pool = new Pool({ connectionString: config.databaseUrl });
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS public.pay_gateway_oauth_pushed_authorization_requests (
        request_uri_hash text PRIMARY KEY,
        service_code text NOT NULL,
        environment text NOT NULL CHECK (environment IN ('sandbox','live')),
        payload jsonb NOT NULL,
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_pay_gateway_oauth_par_expiry
        ON public.pay_gateway_oauth_pushed_authorization_requests (expires_at, consumed_at);
    `);
  }

  async create(input: Omit<PushedAuthorizationRequest, 'requestUri' | 'expiresAt'>, ttlSeconds: number) {
    const requestUri = `urn:ietf:params:oauth:request_uri:orbi:${crypto.randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const record: PushedAuthorizationRequest = { ...input, requestUri, expiresAt };
    if (this.memoryOnly) {
      this.memory.set(hash(requestUri), record);
      return record;
    }
    this.assertReady();
    await this.pool!.query(
      `INSERT INTO public.pay_gateway_oauth_pushed_authorization_requests (
        request_uri_hash, service_code, environment, payload, expires_at
      ) VALUES ($1,$2,$3,$4::jsonb,$5)`,
      [hash(requestUri), input.serviceCode, input.environment, JSON.stringify(input.payload), expiresAt],
    );
    return record;
  }

  async consume(requestUri: string, serviceCode: string) {
    if (this.memoryOnly) {
      const key = hash(requestUri);
      const record = this.memory.get(key);
      if (!record || record.consumedAt || record.serviceCode !== serviceCode || Date.parse(record.expiresAt) <= Date.now()) {
        throw new Error('OAUTH_PAR_REQUEST_URI_INVALID');
      }
      this.memory.set(key, { ...record, consumedAt: new Date().toISOString() });
      return record;
    }
    this.assertReady();
    const client = await this.pool!.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT * FROM public.pay_gateway_oauth_pushed_authorization_requests
         WHERE request_uri_hash=$1 FOR UPDATE`,
        [hash(requestUri)],
      );
      const row = result.rows[0];
      if (!row || row.consumed_at || row.service_code !== serviceCode || new Date(row.expires_at).getTime() <= Date.now()) {
        throw new Error('OAUTH_PAR_REQUEST_URI_INVALID');
      }
      await client.query(
        `UPDATE public.pay_gateway_oauth_pushed_authorization_requests SET consumed_at=now()
         WHERE request_uri_hash=$1`,
        [hash(requestUri)],
      );
      await client.query('COMMIT');
      return {
        requestUri,
        serviceCode: row.service_code,
        environment: row.environment,
        payload: row.payload,
        expiresAt: new Date(row.expires_at).toISOString(),
      } as PushedAuthorizationRequest;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private assertReady() {
    if (!this.pool) throw new Error('OAUTH_PAR_STORE_NOT_INITIALIZED');
  }
}

export const pushedAuthorizationRequestStore = new PushedAuthorizationRequestStore();
