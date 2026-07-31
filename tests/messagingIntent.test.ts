import assert from 'node:assert/strict';
import test from 'node:test';
import { MessagingIntentSchema } from '../src/contracts/messagingIntentContract.js';
import { DeveloperMessagingDispatcher } from '../src/services/developerMessagingDispatcher.js';
import { MessagingDeliveryStore } from '../src/services/messagingDeliveryStore.js';

test('messaging intent contract carries safe delivery context', () => {
  const intent = MessagingIntentSchema.parse({
    eventId: 'dev_evt_rotation_001',
    correlationId: 'dev_evt_rotation_001',
    templateCode: 'developer.api_key.emergency_rotated',
    recipientIdentityRef: 'ops@merchant.example',
    language: 'sw',
    channel: 'email',
    serviceCode: 'merchant-service',
    environment: 'live',
    safeMetadata: {
      fingerprint: 'abc123',
      status: 'revoked',
    },
  });

  assert.equal(intent.channel, 'email');
  assert.equal(intent.language, 'sw');
  assert.equal(intent.safeMetadata.fingerprint, 'abc123');
});

test('developer messaging dispatcher records delivery evidence without raw secret', async () => {
  const deliveryStore = MessagingDeliveryStore.inMemory();
  const talkClient = {
    async sendIntent() {
      return { status: 'queued' as const, providerMessageId: 'talk_msg_001', statusCode: 202 };
    },
  };
  const dispatcher = new DeveloperMessagingDispatcher(talkClient as any, deliveryStore);

  await dispatcher.handleDeveloperEvent({
    eventId: 'dev_evt_rotation_002',
    eventType: 'developer.api_key.emergency_rotated',
    serviceCode: 'merchant-service',
    environment: 'live',
    occurredAt: new Date().toISOString(),
    data: {
      requestedBy: 'ops@merchant.example',
      keyId: 'key_new',
      fingerprint: 'safe-fingerprint',
      oneTimeSecret: 'orbi_live_should_not_be_recorded',
    },
  });

  const deliveries = deliveryStore.list({ serviceCode: 'merchant-service' });
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].status, 'queued');
  assert.equal(JSON.stringify(deliveries[0]).includes('orbi_live_should_not_be_recorded'), false);
  assert.equal(deliveries[0].templateCode, 'developer.api_key.emergency_rotated');
});

