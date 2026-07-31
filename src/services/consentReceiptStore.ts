import crypto from 'crypto';
import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';
import { config } from '../config.js';
import {
  ConsentReceiptSchema,
  type ConsentReceiptCreateSchema,
  type ConsentRevocationSchema,
} from '../contracts/consentCenterContract.js';

type ConsentReceipt = z.infer<typeof ConsentReceiptSchema>;
type ConsentReceiptCreate = z.infer<typeof ConsentReceiptCreateSchema>;
type ConsentRevocation = z.infer<typeof ConsentRevocationSchema>;

type ConsentReceiptStoreOptions = {
  mode?: 'postgres' | 'memory';
  databaseUrl?: string;
};

type ConsentFilters = {
  serviceCode?: string;
  subjectId?: string;
  status?: string;
};

const normalizeServiceCode = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const unique = <T>(items: T[]): T[] => [...new Set(items)];

const deriveStatus = (receipt: ConsentReceipt, now = new Date()): ConsentReceipt['status'] => {
  if (receipt.revokedAt || receipt.status === 'revoked') return 'revoked';
  return new Date(receipt.expiresAt).getTime() <= now.getTime() ? 'expired' : 'active';
};

const parseReceipt = (value: unknown): ConsentReceipt => {
  const parsed = ConsentReceiptSchema.parse(value);
  return { ...parsed, status: deriveStatus(parsed) };
};

export class ConsentReceiptStore {
  private readonly mode: 'postgres' | 'memory';
  private readonly databaseUrl?: string;
  private readonly receipts = new Map<string, ConsentReceipt>();
  private pool?: Pool;
  private initialized = false;

  constructor(options: ConsentReceiptStoreOptions = {}) {
    this.mode = options.mode || 'postgres';
    this.databaseUrl = options.databaseUrl || config.databaseUrl;
  }

  static inMemory() {
    const store = new ConsentReceiptStore({ mode: 'memory' });
    store.initialized = true;
    return store;
  }

  async initialize() {
    if (this.initialized) return;
    if (this.mode === 'postgres') {
      if (!this.databaseUrl) throw new Error('DATABASE_URL_REQUIRED');
      this.pool = new Pool({ connectionString: this.databaseUrl });
      await this.ensureSchema();
    }
    this.initialized = true;
  }

  async create(input: ConsentReceiptCreate) {
    this.assertReady();
    const now = new Date().toISOString();
    const receipt: ConsentReceipt = {
      ...input,
      serviceCode: normalizeServiceCode(input.serviceCode),
      scopes: unique(input.scopes),
      consentId: `consent_${crypto.randomUUID()}`,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    if (this.mode === 'memory') {
      const existing = [...this.receipts.values()].find((item) =>
        item.serviceCode === receipt.serviceCode &&
        item.evidence.evidenceHash === receipt.evidence.evidenceHash);
      if (existing) return parseReceipt(existing);
      this.receipts.set(receipt.consentId, receipt);
      return receipt;
    }
    return this.withClient(async (client) => {
      const result = await client.query<{ receipt: unknown }>(
        `INSERT INTO public.pay_gateway_consent_receipts (
          consent_id, service_code, environment, subject_type, subject_id,
          evidence_hash, status, expires_at, receipt, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8::jsonb,$9,$9)
        ON CONFLICT (service_code, evidence_hash) DO UPDATE SET
          service_code = EXCLUDED.service_code
        RETURNING receipt`,
        [
          receipt.consentId,
          receipt.serviceCode,
          receipt.environment,
          receipt.subjectType,
          receipt.subjectId,
          receipt.evidence.evidenceHash,
          receipt.expiresAt,
          JSON.stringify(receipt),
          now,
        ],
      );
      return parseReceipt(result.rows[0].receipt);
    });
  }

  async list(filters: ConsentFilters = {}) {
    this.assertReady();
    if (this.mode === 'memory') return this.filterReceipts([...this.receipts.values()], filters);
    return this.withClient(async (client) => {
      const result = await client.query<{ receipt: unknown }>(
        `SELECT receipt
         FROM public.pay_gateway_consent_receipts
         WHERE ($1::text IS NULL OR service_code = $1)
           AND ($2::text IS NULL OR subject_id = $2)
         ORDER BY created_at DESC`,
        [
          filters.serviceCode ? normalizeServiceCode(filters.serviceCode) : null,
          filters.subjectId || null,
        ],
      );
      return this.filterReceipts(result.rows.map((row) => parseReceipt(row.receipt)), filters);
    });
  }

  async exportAudit(filters: ConsentFilters & { requestedBy?: string } = {}) {
    const receipts = await this.list(filters);
    return {
      exportId: `consent_export_${crypto.randomUUID()}`,
      generatedAt: new Date().toISOString(),
      requestedBy: filters.requestedBy,
      filters: {
        serviceCode: filters.serviceCode,
        subjectId: filters.subjectId,
        status: filters.status,
      },
      count: receipts.length,
      receipts,
    };
  }

  async get(consentId: string) {
    this.assertReady();
    if (this.mode === 'memory') {
      const receipt = this.receipts.get(consentId);
      if (!receipt) throw new Error('CONSENT_RECEIPT_NOT_FOUND');
      return parseReceipt(receipt);
    }
    return this.withClient(async (client) => {
      const result = await client.query<{ receipt: unknown }>(
        `SELECT receipt FROM public.pay_gateway_consent_receipts WHERE consent_id = $1`,
        [consentId],
      );
      if (!result.rows[0]) throw new Error('CONSENT_RECEIPT_NOT_FOUND');
      return parseReceipt(result.rows[0].receipt);
    });
  }

  async findByEvidenceHash(serviceCode: string, evidenceHash: string) {
    this.assertReady();
    const normalizedServiceCode = normalizeServiceCode(serviceCode);
    const normalizedEvidenceHash = String(evidenceHash || '').trim();
    if (!normalizedEvidenceHash) return null;
    if (this.mode === 'memory') {
      const receipt = [...this.receipts.values()].find((item) =>
        item.serviceCode === normalizedServiceCode &&
        item.evidence.evidenceHash === normalizedEvidenceHash);
      return receipt ? parseReceipt(receipt) : null;
    }
    return this.withClient(async (client) => {
      const result = await client.query<{ receipt: unknown }>(
        `SELECT receipt FROM public.pay_gateway_consent_receipts
         WHERE service_code = $1 AND evidence_hash = $2`,
        [normalizedServiceCode, normalizedEvidenceHash],
      );
      return result.rows[0] ? parseReceipt(result.rows[0].receipt) : null;
    });
  }

  async revoke(consentId: string, input: ConsentRevocation) {
    this.assertReady();
    const existing = await this.get(consentId);
    if (existing.status === 'revoked') return existing;
    const now = new Date().toISOString();
    const receipt: ConsentReceipt = {
      ...existing,
      status: 'revoked',
      revokedAt: now,
      revokedBy: input.revokedBy,
      revocationReason: input.reason,
      updatedAt: now,
      metadata: {
        ...(existing.metadata || {}),
        revocationMetadata: input.metadata || {},
      },
    };
    if (this.mode === 'memory') {
      this.receipts.set(receipt.consentId, receipt);
      return receipt;
    }
    return this.withClient(async (client) => {
      const result = await client.query<{ receipt: unknown }>(
        `UPDATE public.pay_gateway_consent_receipts
         SET status = 'revoked', revoked_at = $2, receipt = $3::jsonb, updated_at = $2
         WHERE consent_id = $1
         RETURNING receipt`,
        [consentId, now, JSON.stringify(receipt)],
      );
      if (!result.rows[0]) throw new Error('CONSENT_RECEIPT_NOT_FOUND');
      return parseReceipt(result.rows[0].receipt);
    });
  }

  async hasActiveConsent(input: {
    serviceCode: string;
    subjectId: string;
    scopes: string[];
    environment?: 'sandbox' | 'live';
  }) {
    const requiredScopes = unique(input.scopes);
    const receipts = await this.list({
      serviceCode: input.serviceCode,
      subjectId: input.subjectId,
      status: 'active',
    });
    return receipts.some((receipt) => {
      if (input.environment && receipt.environment !== input.environment) return false;
      return requiredScopes.every((scope) => receipt.scopes.includes(scope as never));
    });
  }

  async evaluateConsent(input: {
    serviceCode: string;
    subjectId: string;
    scopes: string[];
    environment?: 'sandbox' | 'live';
    renewalWindowDays?: number;
    now?: Date;
  }) {
    const requiredScopes = unique(input.scopes);
    const now = input.now || new Date();
    const renewalWindowDays = Math.max(0, input.renewalWindowDays ?? 30);
    const candidates = (await this.list({
      serviceCode: input.serviceCode,
      subjectId: input.subjectId,
    }))
      .map((receipt) => ({ ...receipt, status: deriveStatus(receipt, now) }))
      .filter((receipt) => {
        if (input.environment && receipt.environment !== input.environment) return false;
        return requiredScopes.every((scope) => receipt.scopes.includes(scope as never));
      })
      .sort((a, b) => new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime());

    const active = candidates.find((receipt) => receipt.status === 'active');
    if (active) {
      const renewalStartsAt = new Date(active.expiresAt).getTime() - renewalWindowDays * 86_400_000;
      const expiringSoon = now.getTime() >= renewalStartsAt;
      return {
        status: expiringSoon ? 'expiring_soon' as const : 'active' as const,
        allowed: true,
        renewalRequired: expiringSoon,
        renewalReason: expiringSoon ? 'CONSENT_EXPIRING_SOON' as const : undefined,
        consentId: active.consentId,
        expiresAt: active.expiresAt,
        scopes: requiredScopes,
        receipt: active,
      };
    }
    const revoked = candidates.find((receipt) => receipt.status === 'revoked');
    if (revoked) return this.deniedEvaluation('revoked', 'CONSENT_REVOKED', requiredScopes, revoked);
    const expired = candidates.find((receipt) => receipt.status === 'expired');
    if (expired) return this.deniedEvaluation('expired', 'CONSENT_EXPIRED', requiredScopes, expired);
    return {
      status: 'missing' as const,
      allowed: false,
      renewalRequired: true,
      renewalReason: 'CONSENT_MISSING' as const,
      scopes: requiredScopes,
    };
  }

  private deniedEvaluation(
    status: 'revoked' | 'expired',
    reason: 'CONSENT_REVOKED' | 'CONSENT_EXPIRED',
    scopes: string[],
    receipt: ConsentReceipt,
  ) {
    return {
      status,
      allowed: false,
      renewalRequired: true,
      renewalReason: reason,
      consentId: receipt.consentId,
      expiresAt: receipt.expiresAt,
      scopes,
      receipt,
    };
  }

  private filterReceipts(receipts: ConsentReceipt[], filters: ConsentFilters) {
    const serviceCode = filters.serviceCode ? normalizeServiceCode(filters.serviceCode) : '';
    return receipts
      .map((receipt) => ({ ...receipt, status: deriveStatus(receipt) }))
      .filter((receipt) => {
        if (serviceCode && receipt.serviceCode !== serviceCode) return false;
        if (filters.subjectId && receipt.subjectId !== filters.subjectId) return false;
        if (filters.status && receipt.status !== filters.status) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async ensureSchema() {
    await this.withClient(async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.pay_gateway_consent_receipts (
          consent_id text PRIMARY KEY,
          service_code text NOT NULL,
          environment text NOT NULL CHECK (environment IN ('sandbox', 'live')),
          subject_type text NOT NULL CHECK (subject_type IN ('user', 'business')),
          subject_id text NOT NULL,
          evidence_hash text NOT NULL,
          status text NOT NULL CHECK (status IN ('active', 'revoked')),
          expires_at timestamptz NOT NULL,
          revoked_at timestamptz,
          receipt jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (service_code, evidence_hash)
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_pay_gateway_consent_subject
        ON public.pay_gateway_consent_receipts
          (service_code, subject_id, environment, expires_at DESC)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_pay_gateway_consent_status
        ON public.pay_gateway_consent_receipts (status, expires_at)
      `);
    });
  }

  private assertReady() {
    if (!this.initialized) throw new Error('CONSENT_RECEIPT_STORE_NOT_INITIALIZED');
  }

  private async withClient<T>(operation: (client: PoolClient) => Promise<T>) {
    if (!this.pool) throw new Error('DATABASE_URL_REQUIRED');
    const client = await this.pool.connect();
    try {
      return await operation(client);
    } finally {
      client.release();
    }
  }
}

export const consentReceiptStore = new ConsentReceiptStore();
