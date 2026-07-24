import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WebhookDeliveryStore } from '../src/services/webhookDeliveryStore.js';

test('webhook delivery store records deliveries and computes replay attempts', () => {
  const store = new WebhookDeliveryStore(path.join(os.tmpdir(), `orbi-webhook-delivery-${crypto.randomUUID()}.json`));
  const failed = store.record({
    eventId: 'evt_001',
    serviceCode: 'orbi-shop',
    intentId: 'pi_001',
    eventType: 'payment_intent.updated',
    payload: {
      eventId: 'evt_001',
      eventType: 'payment_intent.updated',
      serviceCode: 'orbi-shop',
      paymentIntent: { id: 'pi_001' },
    },
    callbackUrl: 'https://shop.orbifinancial.com/api/orbi/webhooks',
    status: 'failed',
    attempt: 1,
    statusCode: 503,
    error: 'PAY_SERVICE_WEBHOOK_HTTP_503',
  });

  assert.equal(store.list({ serviceCode: 'orbi-shop' }).length, 1);
  assert.equal(store.list({ status: 'failed' })[0].deliveryId, failed.deliveryId);
  assert.equal(store.get(failed.deliveryId).payload?.eventType, 'payment_intent.updated');
  assert.equal(store.nextReplayAttempt(failed.deliveryId).attempt, 2);

  store.record({
    eventId: 'evt_002',
    serviceCode: 'orbi-shop',
    resourceId: 'consent_001',
    eventType: 'payment_intent.updated',
    callbackUrl: 'https://shop.orbifinancial.com/api/orbi/webhooks',
    status: 'delivered',
    attempt: 2,
    replayOf: failed.deliveryId,
  });

  assert.equal(store.nextReplayAttempt(failed.deliveryId).attempt, 3);
});
