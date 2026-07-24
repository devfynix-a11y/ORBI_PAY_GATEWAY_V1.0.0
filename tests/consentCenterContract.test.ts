import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConsentReceiptCreateSchema,
  ConsentReceiptResponseSchema,
  ConsentRevocationSchema,
} from '../src/contracts/consentCenterContract.js';

test('consent receipt captures scoped user evidence', () => {
  const receipt = ConsentReceiptCreateSchema.parse({
    serviceCode: 'orbi-shop',
    environment: 'live',
    subjectType: 'user',
    subjectId: 'user_001',
    externalSubjectId: 'shop_customer_001',
    scopes: ['payment_profile:read', 'payments:create'],
    purpose: 'Allow ORBI Shop to initiate protected checkout payments.',
    expiresAt: '2027-07-23T00:00:00.000Z',
    context: {
      locale: 'sw',
      timezone: 'Africa/Dar_es_Salaam',
      channel: 'hosted_challenge',
      ipHash: 'iphash_123456789',
      deviceHash: 'devicehash_123456789',
    },
    evidence: {
      consentTextVersion: 'orbi-checkout-consent-v1',
      challengeType: 'PIN',
      challengeId: 'challenge_001',
      acceptedAt: '2026-07-23T00:00:00.000Z',
      evidenceHash: 'evidence_hash_123456789',
    },
  });

  assert.equal(receipt.context.locale, 'sw');
  assert.deepEqual(receipt.scopes, ['payment_profile:read', 'payments:create']);
});

test('consent receipt response shape is stable', () => {
  assert.doesNotThrow(() =>
    ConsentReceiptResponseSchema.parse({
      success: true,
      data: {
        consentId: 'consent_001',
        serviceCode: 'orbi-shop',
        environment: 'live',
        subjectType: 'user',
        subjectId: 'user_001',
        scopes: ['payments:create'],
        purpose: 'Allow checkout payments.',
        status: 'active',
        expiresAt: '2027-07-23T00:00:00.000Z',
        createdAt: '2026-07-23T00:00:00.000Z',
        updatedAt: '2026-07-23T00:00:00.000Z',
        context: {
          locale: 'en',
          timezone: 'UTC',
          channel: 'hosted_challenge',
        },
        evidence: {
          consentTextVersion: 'orbi-checkout-consent-v1',
          acceptedAt: '2026-07-23T00:00:00.000Z',
          evidenceHash: 'evidence_hash_123456789',
        },
      },
    }),
  );
});

test('consent revocation requires accountable actor and reason', () => {
  assert.doesNotThrow(() =>
    ConsentRevocationSchema.parse({
      revokedBy: 'user_001',
      reason: 'Customer revoked ORBI Shop checkout permission.',
    }),
  );

  assert.throws(() =>
    ConsentRevocationSchema.parse({
      revokedBy: 'me',
      reason: 'No',
    }),
  );
});
