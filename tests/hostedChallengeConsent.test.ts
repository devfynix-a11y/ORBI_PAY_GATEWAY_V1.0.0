import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createConsentReceiptFromHostedChallenge } from '../src/services/hostedChallengeConsent.js';
import { ConsentReceiptStore } from '../src/services/consentReceiptStore.js';
import type { PaymentIntent } from '../src/types.js';

const intent = (metadata: Record<string, unknown> = {}): PaymentIntent => ({
  id: 'pi_test_001',
  serviceCode: 'orbi-shop',
  operation: 'paysafe',
  reference: 'ORDER-001',
  amount: 5000,
  currency: 'TZS',
  status: 'completed',
  description: 'Protected checkout payment.',
  customer: {
    userId: 'user_001',
    email: 'customer@example.com',
    phone: '+255700000000',
  },
  metadata,
  checkoutUrl: 'https://pay.orbifinancial.com/checkout/pi_test_001',
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:01:00.000Z',
  coreResult: {
    status: 'completed',
    challenge: {
      type: 'PIN',
      challengeId: 'challenge_001',
      prompt: 'Approve ORBI payment.',
      expiresAt: '2026-07-23T00:15:00.000Z',
      metadata,
    },
  },
});

test('hosted challenge approval creates consent receipt from explicit scopes', () => {
  const store = new ConsentReceiptStore(path.join(os.tmpdir(), `orbi-consent-hosted-${crypto.randomUUID()}.json`));
  const receipt = createConsentReceiptFromHostedChallenge(store, intent({
    consentScopes: ['payments:create'],
    consentPurpose: 'Allow ORBI Shop checkout payment.',
    locale: 'sw',
    timezone: 'Africa/Dar_es_Salaam',
  }));

  assert.equal(receipt?.serviceCode, 'orbi-shop');
  assert.equal(receipt?.subjectId, 'user_001');
  assert.deepEqual(receipt?.scopes, ['payments:create']);
  assert.equal(receipt?.context.locale, 'sw');
  assert.equal(receipt?.evidence.challengeId, 'challenge_001');
});

test('hosted challenge consent creation is idempotent by evidence hash', () => {
  const store = new ConsentReceiptStore(path.join(os.tmpdir(), `orbi-consent-hosted-${crypto.randomUUID()}.json`));
  const payload = intent({ consentScopes: ['payments:create'] });
  const first = createConsentReceiptFromHostedChallenge(store, payload);
  const second = createConsentReceiptFromHostedChallenge(store, payload);

  assert.equal(first?.consentId, second?.consentId);
  assert.equal(store.list({ serviceCode: 'orbi-shop' }).length, 1);
});

test('hosted challenge consent skips missing subject or scopes', () => {
  const store = new ConsentReceiptStore(path.join(os.tmpdir(), `orbi-consent-hosted-${crypto.randomUUID()}.json`));
  const withoutScopes = createConsentReceiptFromHostedChallenge(store, intent({}));
  const withoutSubject = createConsentReceiptFromHostedChallenge(store, {
    ...intent({ consentScopes: ['payments:create'] }),
    customer: undefined,
  });

  assert.equal(withoutScopes, null);
  assert.equal(withoutSubject, null);
});
