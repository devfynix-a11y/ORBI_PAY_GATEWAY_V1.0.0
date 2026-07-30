import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PaymentIntentStore } from '../src/services/paymentIntentStore.js';
import { ReconciliationEvidenceService } from '../src/services/reconciliationEvidenceService.js';
import { WebhookDeliveryStore } from '../src/services/webhookDeliveryStore.js';
import type { PayServiceDefinition } from '../src/types.js';

const service: PayServiceDefinition = {
  code: 'orbi-shop',
  displayName: 'ORBI Shop',
  status: 'ACTIVE',
  apiKeyTokenRefEnv: 'ORBI_SHOP_PAY_API_KEY',
  webhookSecretTokenRefEnv: 'ORBI_SHOP_PAY_WEBHOOK_SECRET',
  callbackUrlEnv: 'ORBI_SHOP_PAY_CALLBACK_URL',
  allowedOperations: ['collection', 'paysafe'],
  allowedCurrencies: ['TZS'],
};

test('reconciliation evidence summarizes payment intents and webhook delivery status', async () => {
  const paymentStore = new PaymentIntentStore();
  const webhookStore = new WebhookDeliveryStore(path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'orbi-wh-')), 'store.json'));
  const intent = paymentStore.create({
    service,
    operation: 'collection',
    reference: 'ORDER-10001',
    amount: 5000,
    currency: 'TZS',
  });
  paymentStore.applyCoreEvent(intent, {
    intentId: intent.id,
    serviceCode: service.code,
    status: 'completed',
    message: 'Completed',
    transactionId: 'txn_001',
    raw: {},
  });
  webhookStore.record({
    eventId: 'evt_001',
    serviceCode: service.code,
    intentId: intent.id,
    eventType: 'payment.completed',
    status: 'delivered',
    attempt: 1,
    statusCode: 200,
  });

  const evidence = new ReconciliationEvidenceService({
    paymentStore,
    webhookStore,
    signingSecret: 'unit-test-reconciliation-secret',
    signingKeyId: 'unit-test-key',
    environment: 'sandbox',
  }).generate({ serviceCode: service.code });

  assert.equal(evidence.summary.paymentIntentCount, 1);
  assert.equal(evidence.summary.webhookDeliveryCount, 1);
  assert.equal(evidence.summary.exceptionCount, 0);
  assert.equal(evidence.summary.byStatus.completed, 1);
  assert.equal(evidence.summary.byCurrency.TZS.amount, 5000);
  assert.equal(evidence.summary.webhookByStatus.delivered, 1);
  assert.equal(evidence.records.paymentIntents[0].coreTransactionId, 'txn_001');
  assert.match(evidence.reportHash, /^[a-f0-9]{64}$/);
  assert.equal(evidence.signature.algorithm, 'HMAC-SHA256');
  assert.match(evidence.signature.value, /^[a-f0-9]{64}$/);
});

test('reconciliation evidence export writes signed report file', async () => {
  const exportPath = await fs.mkdtemp(path.join(os.tmpdir(), 'orbi-recon-'));
  const service = new ReconciliationEvidenceService({
    paymentStore: new PaymentIntentStore(),
    webhookStore: new WebhookDeliveryStore(path.join(exportPath, 'webhooks.json')),
    exportPath,
    signingSecret: 'unit-test-reconciliation-secret',
    signingKeyId: 'unit-test-key',
  });

  const result = await service.export({ requestedBy: 'unit-test' });
  assert.ok(result.path);
  const saved = JSON.parse(await fs.readFile(result.path!, 'utf8'));
  assert.equal(saved.reportId, result.report.reportId);
  assert.equal(saved.requestedBy, 'unit-test');
  assert.match(saved.reportHash, /^[a-f0-9]{64}$/);
});

test('reconciliation evidence reports stuck intents and webhook exceptions', async () => {
  const paymentStore = new PaymentIntentStore();
  const webhookStore = new WebhookDeliveryStore(path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'orbi-wh-ex-')), 'store.json'));
  const stuckIntent = paymentStore.create({
    service,
    operation: 'collection',
    reference: 'ORDER-STUCK',
    amount: 12000,
    currency: 'TZS',
  });
  webhookStore.record({
    eventId: 'evt_failed_001',
    serviceCode: service.code,
    intentId: stuckIntent.id,
    eventType: 'payment.pending',
    status: 'failed',
    attempt: 1,
    statusCode: 500,
  });

  const evidence = new ReconciliationEvidenceService({
    paymentStore,
    webhookStore,
    signingSecret: 'unit-test-reconciliation-secret',
    signingKeyId: 'unit-test-key',
    environment: 'sandbox',
    stuckIntentMinutes: 0,
    webhookPendingMinutes: 0,
  }).generate({ serviceCode: service.code });

  assert.equal(evidence.summary.exceptionCount, 2);
  assert.equal(evidence.summary.exceptionsByType.payment_intent_stuck, 1);
  assert.equal(evidence.summary.exceptionsByType.webhook_delivery_failed, 1);
  assert.equal(evidence.summary.exceptionsBySeverity.critical, 1);
  assert.equal(evidence.summary.exceptionsBySeverity.warning, 1);
  assert.deepEqual(
    evidence.exceptions.map((item) => item.type).sort(),
    ['payment_intent_stuck', 'webhook_delivery_failed'],
  );
});
