import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  handleOrbiWebhookEvent,
  isOrbiWebhookEventType,
  verifyAndParseOrbiWebhook,
  verifyOrbiWebhookSignature,
} from '../src/index.js';

test('webhook verifier accepts valid ORBI signature', () => {
  const rawBody = '{"eventId":"evt_1","status":"completed"}';
  const timestamp = 1784800000;
  const secret = 'webhook-secret';
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  assert.deepEqual(verifyOrbiWebhookSignature({
    rawBody,
    signatureHeader: `sha256=${signature}`,
    timestampHeader: timestamp,
    secret,
    nowSeconds: timestamp,
  }), { ok: true });
});

test('webhook verifier rejects stale or mismatched signatures', () => {
  assert.equal(verifyOrbiWebhookSignature({
    rawBody: '{}',
    signatureHeader: 'sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    timestampHeader: 1000,
    secret: 'webhook-secret',
    nowSeconds: 2000,
    toleranceSeconds: 30,
  }).reason, 'stale_timestamp');

  assert.equal(verifyOrbiWebhookSignature({
    rawBody: '{}',
    signatureHeader: 'sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    timestampHeader: 1000,
    secret: 'webhook-secret',
    nowSeconds: 1000,
  }).reason, 'signature_mismatch');
});

test('webhook verifier parses and routes typed ORBI events', async () => {
  const event = {
    eventId: 'evt_payment_1',
    eventType: 'payment_intent.updated',
    serviceCode: 'orbi-shop',
    paymentIntent: {
      id: 'pi_001',
      status: 'completed',
    },
  };
  const rawBody = JSON.stringify(event);
  const timestamp = 1784800000;
  const secret = 'webhook-secret';
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  const parsed = verifyAndParseOrbiWebhook({
    rawBody,
    signatureHeader: `sha256=${signature}`,
    timestampHeader: timestamp,
    secret,
    nowSeconds: timestamp,
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error('Expected valid webhook.');
  assert.equal(isOrbiWebhookEventType(parsed.event, 'payment_intent.updated'), true);

  let handledIntentId = '';
  await handleOrbiWebhookEvent(parsed.event, {
    'payment_intent.updated': async (paymentEvent) => {
      handledIntentId = paymentEvent.paymentIntent.id;
    },
  });

  assert.equal(handledIntentId, 'pi_001');
});

test('webhook parser rejects invalid JSON after signature verification', () => {
  const rawBody = '{not-json';
  const timestamp = 1784800000;
  const secret = 'webhook-secret';
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  assert.deepEqual(verifyAndParseOrbiWebhook({
    rawBody,
    signatureHeader: `sha256=${signature}`,
    timestampHeader: timestamp,
    secret,
    nowSeconds: timestamp,
  }), { ok: false, reason: 'invalid_json' });
});
