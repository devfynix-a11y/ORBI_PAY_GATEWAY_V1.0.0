import { Pool, type PoolClient } from 'pg';
import { config } from '../config.js';
import { rememberRevokedServiceAccessTokenIds, type ServiceAccessTokenClaims } from '../security/serviceAccessToken.js';
import type { FinancialAccessTokenClaims } from '../security/financialAccessToken.js';

type RevocationStoreOptions = {
  mode?: 'postgres' | 'memory';
  databaseUrl?: string;
};

type RevocationRecordInput = {
  claims: ServiceAccessTokenClaims | FinancialAccessTokenClaims;
  revokedBy?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export class ServiceAccessTokenRevocationStore {
  private readonly mode: 'postgres' | 'memory';
  private readonly databaseUrl?: string;
  private pool?: Pool;
  private initialized = false;

  constructor(options: RevocationStoreOptions = {}) {
    this.mode = options.mode || 'postgres';
    this.databaseUrl = options.databaseUrl || config.databaseUrl;
  }

  static inMemory() {
    const store = new ServiceAccessTokenRevocationStore({ mode: 'memory' });
    store.initialized = true;
    return store;
  }

  async initialize() {
    if (this.initialized) return;
    if (this.mode === 'postgres') {
      if (!this.databaseUrl) throw new Error('DATABASE_URL_REQUIRED');
      this.pool = new Pool({ connectionString: this.databaseUrl });
      await this.ensureSchema();
      await this.loadActiveRevocations();
      await this.pruneExpiredRevocations();
    }
    this.initialized = true;
  }

  async recordRevocation(input: RevocationRecordInput) {
    this.assertReady();
    if (this.mode === 'memory') {
      rememberRevokedServiceAccessTokenIds([input.claims.jti]);
      return;
    }
    await this.withClient(async (client) => {
      await client.query(
        `
        INSERT INTO pay_gateway_service_access_token_revocations (
          jti,
          service_code,
          key_id,
          fingerprint,
          environment,
          scopes,
          expires_at,
          revoked_at,
          revoked_by,
          reason,
          metadata
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8,$9,$10::jsonb)
        ON CONFLICT (jti) DO UPDATE SET
          revoked_at = EXCLUDED.revoked_at,
          revoked_by = COALESCE(EXCLUDED.revoked_by, pay_gateway_service_access_token_revocations.revoked_by),
          reason = COALESCE(EXCLUDED.reason, pay_gateway_service_access_token_revocations.reason),
          metadata = pay_gateway_service_access_token_revocations.metadata || EXCLUDED.metadata
        `,
        [
          input.claims.jti,
          input.claims.serviceCode,
          input.claims.keyId,
          input.claims.fingerprint,
          input.claims.environment,
          input.claims.scopes,
          new Date(input.claims.exp * 1000).toISOString(),
          input.revokedBy || null,
          input.reason || null,
          JSON.stringify(input.metadata || {}),
        ],
      );
    });
    rememberRevokedServiceAccessTokenIds([input.claims.jti]);
  }

  private async ensureSchema() {
    await this.withClient(async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS pay_gateway_service_access_token_revocations (
          jti text PRIMARY KEY,
          service_code text NOT NULL,
          key_id text NOT NULL,
          fingerprint text NOT NULL,
          environment text NOT NULL CHECK (environment IN ('sandbox', 'live')),
          scopes text[] NOT NULL DEFAULT '{}',
          expires_at timestamptz NOT NULL,
          revoked_at timestamptz NOT NULL DEFAULT now(),
          revoked_by text,
          reason text,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_pay_gateway_sat_revocations_active
        ON pay_gateway_service_access_token_revocations (expires_at)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_pay_gateway_sat_revocations_service
        ON pay_gateway_service_access_token_revocations (service_code, environment)
      `);
    });
  }

  private async loadActiveRevocations() {
    await this.withClient(async (client) => {
      const result = await client.query<{ jti: string }>(
        `
        SELECT jti
        FROM pay_gateway_service_access_token_revocations
        WHERE expires_at > now()
        `,
      );
      rememberRevokedServiceAccessTokenIds(result.rows.map((row) => row.jti));
    });
  }

  private async pruneExpiredRevocations() {
    await this.withClient(async (client) => {
      await client.query(`
        DELETE FROM pay_gateway_service_access_token_revocations
        WHERE expires_at < now() - interval '7 days'
      `);
    });
  }

  private async withClient<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool) throw new Error('DATABASE_POOL_NOT_INITIALIZED');
    const client = await this.pool.connect();
    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }

  private assertReady() {
    if (!this.initialized) throw new Error('SERVICE_ACCESS_TOKEN_REVOCATION_STORE_NOT_INITIALIZED');
  }
}

export const serviceAccessTokenRevocationStore = new ServiceAccessTokenRevocationStore();
