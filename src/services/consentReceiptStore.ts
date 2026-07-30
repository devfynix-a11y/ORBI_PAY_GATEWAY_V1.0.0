import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { config } from '../config.js';
import type {
  ConsentReceiptCreateSchema,
  ConsentReceiptSchema,
  ConsentRevocationSchema,
} from '../contracts/consentCenterContract.js';

type ConsentReceipt = z.infer<typeof ConsentReceiptSchema>;
type ConsentReceiptCreate = z.infer<typeof ConsentReceiptCreateSchema>;
type ConsentRevocation = z.infer<typeof ConsentRevocationSchema>;

type ConsentReceiptState = {
  receipts: ConsentReceipt[];
};

const emptyState = (): ConsentReceiptState => ({
  receipts: [],
});

const normalizeServiceCode = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const unique = <T>(items: T[]): T[] => [...new Set(items)];

const deriveStatus = (receipt: ConsentReceipt, now = new Date()): ConsentReceipt['status'] => {
  if (receipt.revokedAt || receipt.status === 'revoked') return 'revoked';
  return new Date(receipt.expiresAt).getTime() <= now.getTime() ? 'expired' : 'active';
};

export class ConsentReceiptStore {
  private state: ConsentReceiptState;

  constructor(private readonly storePath = config.consentReceiptStorePath) {
    this.state = this.load();
  }

  create(input: ConsentReceiptCreate) {
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
    this.state.receipts.unshift(receipt);
    this.persist();
    return receipt;
  }

  list(filters: { serviceCode?: string; subjectId?: string; status?: string } = {}) {
    const serviceCode = filters.serviceCode ? normalizeServiceCode(filters.serviceCode) : '';
    return this.state.receipts
      .map((receipt) => ({ ...receipt, status: deriveStatus(receipt) }))
      .filter((receipt) => {
        if (serviceCode && receipt.serviceCode !== serviceCode) return false;
        if (filters.subjectId && receipt.subjectId !== filters.subjectId) return false;
        if (filters.status && receipt.status !== filters.status) return false;
        return true;
      });
  }

  exportAudit(filters: { serviceCode?: string; subjectId?: string; status?: string; requestedBy?: string } = {}) {
    const receipts = this.list(filters);
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

  get(consentId: string) {
    const receipt = this.state.receipts.find((item) => item.consentId === consentId);
    if (!receipt) throw new Error('CONSENT_RECEIPT_NOT_FOUND');
    return { ...receipt, status: deriveStatus(receipt) };
  }

  findByEvidenceHash(serviceCode: string, evidenceHash: string) {
    const normalizedServiceCode = normalizeServiceCode(serviceCode);
    const normalizedEvidenceHash = String(evidenceHash || '').trim();
    if (!normalizedEvidenceHash) return null;
    const receipt = this.state.receipts.find((item) =>
      item.serviceCode === normalizedServiceCode &&
      item.evidence.evidenceHash === normalizedEvidenceHash,
    );
    return receipt ? { ...receipt, status: deriveStatus(receipt) } : null;
  }

  revoke(consentId: string, input: ConsentRevocation) {
    const receipt = this.state.receipts.find((item) => item.consentId === consentId);
    if (!receipt) throw new Error('CONSENT_RECEIPT_NOT_FOUND');
    const now = new Date().toISOString();
    receipt.status = 'revoked';
    receipt.revokedAt = now;
    receipt.revokedBy = input.revokedBy;
    receipt.revocationReason = input.reason;
    receipt.updatedAt = now;
    receipt.metadata = {
      ...(receipt.metadata || {}),
      revocationMetadata: input.metadata || {},
    };
    this.persist();
    return receipt;
  }

  hasActiveConsent(input: {
    serviceCode: string;
    subjectId: string;
    scopes: string[];
    environment?: 'sandbox' | 'live';
  }) {
    const requiredScopes = unique(input.scopes);
    return this.list({
      serviceCode: input.serviceCode,
      subjectId: input.subjectId,
      status: 'active',
    }).some((receipt) => {
      if (input.environment && receipt.environment !== input.environment) return false;
      return requiredScopes.every((scope) => receipt.scopes.includes(scope as any));
    });
  }

  evaluateConsent(input: {
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
    const serviceCode = normalizeServiceCode(input.serviceCode);
    const candidates = this.state.receipts
      .map((receipt) => ({ ...receipt, status: deriveStatus(receipt, now) }))
      .filter((receipt) => {
        if (receipt.serviceCode !== serviceCode) return false;
        if (receipt.subjectId !== input.subjectId) return false;
        if (input.environment && receipt.environment !== input.environment) return false;
        return requiredScopes.every((scope) => receipt.scopes.includes(scope as any));
      })
      .sort((a, b) => new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime());

    const active = candidates.find((receipt) => receipt.status === 'active');
    if (active) {
      const expiresAtMs = new Date(active.expiresAt).getTime();
      const renewalStartsAtMs = expiresAtMs - renewalWindowDays * 24 * 60 * 60 * 1000;
      const isExpiringSoon = now.getTime() >= renewalStartsAtMs;
      return {
        status: isExpiringSoon ? 'expiring_soon' as const : 'active' as const,
        allowed: true,
        renewalRequired: isExpiringSoon,
        renewalReason: isExpiringSoon ? 'CONSENT_EXPIRING_SOON' as const : undefined,
        consentId: active.consentId,
        expiresAt: active.expiresAt,
        scopes: requiredScopes,
        receipt: active,
      };
    }

    const revoked = candidates.find((receipt) => receipt.status === 'revoked');
    if (revoked) {
      return {
        status: 'revoked' as const,
        allowed: false,
        renewalRequired: true,
        renewalReason: 'CONSENT_REVOKED' as const,
        consentId: revoked.consentId,
        expiresAt: revoked.expiresAt,
        scopes: requiredScopes,
        receipt: revoked,
      };
    }

    const expired = candidates.find((receipt) => receipt.status === 'expired');
    if (expired) {
      return {
        status: 'expired' as const,
        allowed: false,
        renewalRequired: true,
        renewalReason: 'CONSENT_EXPIRED' as const,
        consentId: expired.consentId,
        expiresAt: expired.expiresAt,
        scopes: requiredScopes,
        receipt: expired,
      };
    }

    return {
      status: 'missing' as const,
      allowed: false,
      renewalRequired: true,
      renewalReason: 'CONSENT_MISSING' as const,
      scopes: requiredScopes,
    };
  }

  private load(): ConsentReceiptState {
    try {
      if (!fs.existsSync(this.storePath)) return emptyState();
      const parsed = JSON.parse(fs.readFileSync(this.storePath, 'utf8')) as Partial<ConsentReceiptState>;
      return {
        ...emptyState(),
        ...parsed,
      };
    } catch {
      return emptyState();
    }
  }

  private persist() {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, JSON.stringify(this.state, null, 2));
  }
}

export const consentReceiptStore = new ConsentReceiptStore();
