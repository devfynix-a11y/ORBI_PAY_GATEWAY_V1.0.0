import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentIntentStore } from '../src/services/paymentIntentStore.js';
import type { PayServiceDefinition } from '../src/types.js';

const service: PayServiceDefinition = {
  code: 'orbi-shop-test',
  displayName: 'ORBI Shop Test',
  status: 'ACTIVE',
  apiKeyTokenRefEnv: 'TEST_PAY_SERVICE_KEY',
  webhookSecretTokenRefEnv: 'TEST_PAY_SERVICE_WEBHOOK_SECRET',
  callbackUrlEnv: 'TEST_PAY_SERVICE_CALLBACK_URL',
  allowedOperations: ['paysafe'],
  allowedCurrencies: ['TZS'],
};

test('payment intents replay safely by idempotency key', () => {
  const first = paymentIntentStore.create({
    service,
    operation: 'paysafe',
    reference: 'ORD-IDEM-1',
    amount: 5000,
    currency: 'TZS',
    idempotencyKey: 'checkout-key-1',
    idempotencyFingerprint: 'same-payload',
  });

  const replayed = paymentIntentStore.create({
    service,
    operation: 'paysafe',
    reference: 'ORD-IDEM-1-RETRY',
    amount: 5000,
    currency: 'TZS',
    idempotencyKey: 'checkout-key-1',
    idempotencyFingerprint: 'same-payload',
  });

  assert.equal(replayed.id, first.id);
  assert.equal(replayed.reference, 'ORD-IDEM-1');
});

test('payment intents reject idempotency key reuse with a different payload', () => {
  paymentIntentStore.create({
    service,
    operation: 'paysafe',
    reference: 'ORD-IDEM-2',
    amount: 7500,
    currency: 'TZS',
    idempotencyKey: 'checkout-key-2',
    idempotencyFingerprint: 'original-payload',
  });

  assert.throws(
    () => paymentIntentStore.create({
      service,
      operation: 'paysafe',
      reference: 'ORD-IDEM-2',
      amount: 10000,
      currency: 'TZS',
      idempotencyKey: 'checkout-key-2',
      idempotencyFingerprint: 'changed-payload',
    }),
    /PAYMENT_INTENT_IDEMPOTENCY_MISMATCH/,
  );
});
