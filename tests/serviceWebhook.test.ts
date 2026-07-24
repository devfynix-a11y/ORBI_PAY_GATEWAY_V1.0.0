import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverServiceWebhookPayload } from '../src/services/serviceWebhook.js';
import type { PayServiceDefinition } from '../src/types.js';

const service: PayServiceDefinition = {
  code: 'orbi-shop',
  displayName: 'ORBI Shop',
  status: 'ACTIVE',
  apiKeyTokenRefEnv: 'ORBI_SHOP_PAY_API_KEY_TOKEN_REF',
  callbackUrlEnv: 'ORBI_TEST_WEBHOOK_URL',
  webhookSecretTokenRefEnv: 'ORBI_TEST_WEBHOOK_SECRET_TOKEN_REF',
  allowedOperations: ['paysafe'],
  allowedCurrencies: ['TZS'],
};

test('service webhook delivers generic consent revoked events with ORBI signature headers', async () => {
  const previousFetch = globalThis.fetch;
  process.env.ORBI_TEST_WEBHOOK_URL = 'https://merchant.example/webhook';
  process.env.ORBI_TEST_WEBHOOK_SECRET_TOKEN_REF = 'env://ORBI_TEST_WEBHOOK_SECRET';
  process.env.ORBI_TEST_WEBHOOK_SECRET = 'test_webhook_secret';
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  try {
    const delivery = await deliverServiceWebhookPayload(service, {
      eventId: 'evt_consent_001',
      eventType: 'consent.revoked',
      serviceCode: 'orbi-shop',
      consent: {
        consentId: 'consent_001',
        status: 'revoked',
      },
    });

    assert.equal(delivery.delivered, true);
    assert.equal(delivery.eventType, 'consent.revoked');
    assert.equal(delivery.payload?.eventType, 'consent.revoked');
    assert.equal((delivery.payload?.consent as any)?.consentId, 'consent_001');
    const request = requests[0];
    assert.equal(request?.url, 'https://merchant.example/webhook');
    const headers = request?.init?.headers as Record<string, string>;
    assert.equal(headers['x-orbi-pay-event-id'], 'evt_consent_001');
    assert.equal(headers['x-orbi-pay-service-code'], 'orbi-shop');
    assert.match(headers['x-orbi-pay-signature'], /^sha256=/);
  } finally {
    globalThis.fetch = previousFetch;
    delete process.env.ORBI_TEST_WEBHOOK_URL;
    delete process.env.ORBI_TEST_WEBHOOK_SECRET_TOKEN_REF;
    delete process.env.ORBI_TEST_WEBHOOK_SECRET;
  }
});
