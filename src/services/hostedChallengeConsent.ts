import crypto from 'crypto';
import { z } from 'zod';
import { ConsentReceiptCreateSchema } from '../contracts/consentCenterContract.js';
import type { PaymentChallenge, PaymentIntent } from '../types.js';
import type { ConsentReceiptStore } from './consentReceiptStore.js';
import { subjectIdForConsent } from './serviceConsentGuard.js';

const ConsentScopeListSchema = z
  .array(z.string().trim().min(1).max(80))
  .min(1)
  .max(20);

const stringFrom = (...values: unknown[]): string => {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
};

const stringArrayFrom = (...values: unknown[]): string[] => {
  for (const value of values) {
    if (Array.isArray(value)) {
      const parsed = ConsentScopeListSchema.safeParse(value);
      if (parsed.success) return parsed.data;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = ConsentScopeListSchema.safeParse(value.split(',').map((item) => item.trim()).filter(Boolean));
      if (parsed.success) return parsed.data;
    }
  }
  return [];
};

const isoInMinutes = (minutes: number) => new Date(Date.now() + minutes * 60 * 1000).toISOString();

const optionalStringField = (key: string, value: string) => (value ? { [key]: value } : {});

export const hostedChallengeConsentEvidenceHash = (intent: PaymentIntent, challenge: PaymentChallenge) =>
  crypto
    .createHash('sha256')
    .update([
      intent.serviceCode,
      intent.id,
      intent.reference,
      challenge.challengeId,
      intent.customer?.userId || '',
      intent.customer?.email || '',
      intent.customer?.phone || '',
    ].join('|'))
    .digest('hex');

export const createConsentReceiptFromHostedChallenge = async (
  store: Pick<ConsentReceiptStore, 'create' | 'findByEvidenceHash'>,
  intent: PaymentIntent,
) => {
  const challenge = intent.coreResult?.challenge;
  if (!challenge) return null;

  const metadata = {
    ...(intent.metadata || {}),
    ...(challenge.metadata || {}),
  };
  const subjectId = subjectIdForConsent({
    userId: intent.customer?.userId || stringFrom(metadata.userId, metadata.user_id, metadata.customerUserId),
    email: intent.customer?.email || stringFrom(metadata.email, metadata.customerEmail),
    phone: intent.customer?.phone || stringFrom(metadata.phone, metadata.customerPhone),
    customerId: stringFrom(metadata.customerId, metadata.customer_id, metadata.externalCustomerId),
  });
  if (!subjectId) return null;

  const scopes = stringArrayFrom(
    metadata.consentScopes,
    metadata.consent_scopes,
    metadata.scopes,
  );
  if (scopes.length === 0) return null;

  const evidenceHash = hostedChallengeConsentEvidenceHash(intent, challenge);
  const existing = await store.findByEvidenceHash(intent.serviceCode, evidenceHash);
  if (existing) return existing;

  const acceptedAt = new Date().toISOString();
  const expiresAt = stringFrom(metadata.consentExpiresAt, metadata.consent_expires_at, challenge.expiresAt) || isoInMinutes(15);
  const parsed = ConsentReceiptCreateSchema.safeParse({
    serviceCode: intent.serviceCode,
    environment: String(metadata.environment || metadata.gatewayEnvironment || 'live') === 'sandbox' ? 'sandbox' : 'live',
    subjectType: String(metadata.subjectType || metadata.subject_type || 'user') === 'business' ? 'business' : 'user',
    subjectId,
    ...optionalStringField(
      'externalSubjectId',
      stringFrom(metadata.externalSubjectId, metadata.external_subject_id, metadata.externalCustomerId),
    ),
    scopes,
    purpose: stringFrom(
      metadata.consentPurpose,
      metadata.consent_purpose,
      intent.description,
      `Authorize ${intent.serviceCode} ${intent.operation}.`,
    ),
    expiresAt,
    context: {
      locale: String(metadata.locale || metadata.language || 'en') === 'sw' ? 'sw' : 'en',
      timezone: stringFrom(
        metadata.timezone,
        (metadata.clientTimeContext as any)?.timezone_name,
        (metadata.clientTimeContext as any)?.timezone,
        'UTC',
      ),
      channel: 'hosted_challenge',
      ...optionalStringField('ipHash', stringFrom(metadata.ipHash, metadata.ip_hash)),
      ...optionalStringField('deviceHash', stringFrom(metadata.deviceHash, metadata.device_hash)),
      ...optionalStringField('userAgentHash', stringFrom(metadata.userAgentHash, metadata.user_agent_hash)),
      ...optionalStringField('countryCode', stringFrom(metadata.countryCode, metadata.country_code)),
    },
    evidence: {
      consentTextVersion: stringFrom(metadata.consentTextVersion, metadata.consent_text_version, 'orbi-hosted-challenge-consent-v1'),
      challengeId: challenge.challengeId,
      challengeType: challenge.type,
      acceptedAt,
      evidenceHash,
      metadata: {
        paymentIntentId: intent.id,
        reference: intent.reference,
        operation: intent.operation,
        amount: intent.amount,
        currency: intent.currency,
      },
    },
    metadata: {
      paymentIntentId: intent.id,
      reference: intent.reference,
      operation: intent.operation,
    },
  });
  if (!parsed.success) return null;

  return store.create(parsed.data);
};
