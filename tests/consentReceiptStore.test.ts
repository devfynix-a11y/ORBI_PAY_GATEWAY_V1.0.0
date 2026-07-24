import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConsentReceiptStore } from '../src/services/consentReceiptStore.js';

const createInput = () => ({
  serviceCode: 'ORBI Shop',
  environment: 'live' as const,
  subjectType: 'user' as const,
  subjectId: 'user_001',
  externalSubjectId: 'shop_customer_001',
  scopes: ['payment_profile:read' as const, 'payments:create' as const],
  purpose: 'Allow ORBI Shop to initiate protected checkout payments.',
  expiresAt: '2027-07-23T00:00:00.000Z',
  context: {
    locale: 'sw' as const,
    timezone: 'Africa/Dar_es_Salaam',
    channel: 'hosted_challenge' as const,
    ipHash: 'iphash_123456789',
    deviceHash: 'devicehash_123456789',
  },
  evidence: {
    consentTextVersion: 'orbi-checkout-consent-v1',
    challengeType: 'PIN' as const,
    challengeId: 'challenge_001',
    acceptedAt: '2026-07-23T00:00:00.000Z',
    evidenceHash: 'evidence_hash_123456789',
  },
});

test('consent receipt store persists active and revoked consent evidence', () => {
  const store = new ConsentReceiptStore(path.join(os.tmpdir(), `orbi-consent-${crypto.randomUUID()}.json`));
  const receipt = store.create(createInput());

  assert.equal(receipt.serviceCode, 'orbi-shop');
  assert.equal(store.hasActiveConsent({
    serviceCode: 'orbi-shop',
    subjectId: 'user_001',
    scopes: ['payments:create'],
    environment: 'live',
  }), true);

  const revoked = store.revoke(receipt.consentId, {
    revokedBy: 'user_001',
    reason: 'Customer revoked checkout access.',
  });
  assert.equal(revoked.status, 'revoked');
  assert.equal(store.hasActiveConsent({
    serviceCode: 'orbi-shop',
    subjectId: 'user_001',
    scopes: ['payments:create'],
    environment: 'live',
  }), false);
});

test('expired consent is not treated as active', () => {
  const store = new ConsentReceiptStore(path.join(os.tmpdir(), `orbi-consent-${crypto.randomUUID()}.json`));
  const receipt = store.create({
    ...createInput(),
    expiresAt: '2026-01-01T00:00:00.000Z',
  });

  assert.equal(store.get(receipt.consentId).status, 'expired');
  assert.equal(store.hasActiveConsent({
    serviceCode: 'orbi-shop',
    subjectId: 'user_001',
    scopes: ['payments:create'],
  }), false);
});

test('consent evaluation identifies renewal and missing states', () => {
  const store = new ConsentReceiptStore(path.join(os.tmpdir(), `orbi-consent-${crypto.randomUUID()}.json`));
  const receipt = store.create({
    ...createInput(),
    expiresAt: '2026-08-01T00:00:00.000Z',
  });

  const expiring = store.evaluateConsent({
    serviceCode: 'orbi-shop',
    subjectId: 'user_001',
    scopes: ['payments:create'],
    environment: 'live',
    renewalWindowDays: 30,
    now: new Date('2026-07-20T00:00:00.000Z'),
  });
  assert.equal(expiring.status, 'expiring_soon');
  assert.equal(expiring.allowed, true);
  assert.equal(expiring.renewalRequired, true);
  assert.equal(expiring.consentId, receipt.consentId);

  const missing = store.evaluateConsent({
    serviceCode: 'orbi-shop',
    subjectId: 'user_002',
    scopes: ['payments:create'],
    environment: 'live',
  });
  assert.equal(missing.status, 'missing');
  assert.equal(missing.allowed, false);
  assert.equal(missing.renewalReason, 'CONSENT_MISSING');
});
