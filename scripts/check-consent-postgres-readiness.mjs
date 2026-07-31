import crypto from 'node:crypto';
import { Pool } from 'pg';
import { ConsentReceiptStore } from '../dist/src/services/consentReceiptStore.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL_REQUIRED');
}

const serviceCode = `stage1b-readiness-${crypto.randomUUID()}`;
const subjectId = `readiness-subject-${crypto.randomUUID()}`;
const evidenceHash = crypto.createHash('sha256').update(serviceCode).digest('hex');
const store = new ConsentReceiptStore({
  mode: 'postgres',
  databaseUrl: process.env.DATABASE_URL,
});
const cleanupPool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  await store.initialize();
  const receipt = await store.create({
    serviceCode,
    environment: 'live',
    subjectType: 'user',
    subjectId,
    scopes: ['payments:create'],
    purpose: 'Verify the PostgreSQL consent authority before deployment.',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    context: {
      locale: 'en',
      timezone: 'UTC',
      channel: 'operator',
    },
    evidence: {
      consentTextVersion: 'stage1b-readiness-v1',
      challengeType: 'OPERATOR',
      acceptedAt: new Date().toISOString(),
      evidenceHash,
    },
  });
  const active = await store.hasActiveConsent({
    serviceCode,
    subjectId,
    scopes: ['payments:create'],
    environment: 'live',
  });
  if (!active) throw new Error('CONSENT_ACTIVE_CHECK_FAILED');

  const revoked = await store.revoke(receipt.consentId, {
    revokedBy: 'stage1b-readiness',
    reason: 'Readiness evidence completed; revoke the temporary consent.',
  });
  if (revoked.status !== 'revoked') throw new Error('CONSENT_REVOCATION_CHECK_FAILED');

  const activeAfterRevoke = await store.hasActiveConsent({
    serviceCode,
    subjectId,
    scopes: ['payments:create'],
    environment: 'live',
  });
  if (activeAfterRevoke) throw new Error('CONSENT_REVOCATION_NOT_ENFORCED');

  console.log('Consent PostgreSQL readiness passed: create, authorize, revoke, deny.');
} finally {
  await cleanupPool.query(
    'DELETE FROM public.pay_gateway_consent_receipts WHERE service_code = $1',
    [serviceCode],
  );
  await cleanupPool.end();
}
