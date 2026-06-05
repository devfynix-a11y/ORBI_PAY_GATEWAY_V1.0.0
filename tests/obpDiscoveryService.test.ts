import assert from 'node:assert/strict';
import test from 'node:test';
import { obpDiscoveryService } from '../src/discovery/ObpDiscoveryService.js';

const providerManifest = {
  providers: [{
    code: 'nmb-obp-sandbox',
    displayName: 'NMB OBP Sandbox',
    rail: 'BANK',
    protocol: 'REST_JSON',
    countries: ['TZ'],
    currencies: ['TZS'],
    operations: ['collection'],
    baseUrlEnv: 'TEST_NMB_OBP_BASE_URL',
    credentialTokenRefEnv: 'TEST_NMB_OBP_CREDENTIAL_TOKEN_REF',
    credentialScheme: 'OBP_CONSUMER',
    credentialMetadataEnv: 'TEST_NMB_OBP_CREDENTIAL_METADATA',
    webhookSecretTokenRefEnv: 'TEST_NMB_OBP_WEBHOOK_SECRET_TOKEN_REF',
    operationEndpoints: {
      collection: {
        method: 'POST',
        path: '/obp/v4.0.0/banks/nmbb.01.tz.nmbb/transaction-request-types/SANDBOX_TAN/transaction-requests',
      },
    },
  }],
};

test('OBP discovery normalizes transaction request types and dynamic entity candidates', async () => {
  const previous = {
    manifest: process.env.PAYMENT_GATEWAY_PROVIDER_MANIFEST_JSON,
    baseUrl: process.env.TEST_NMB_OBP_BASE_URL,
    tokenRef: process.env.TEST_NMB_OBP_CREDENTIAL_TOKEN_REF,
    key: process.env.TEST_NMB_OBP_CONSUMER_KEY,
    metadata: process.env.TEST_NMB_OBP_CREDENTIAL_METADATA,
    secret: process.env.TEST_NMB_OBP_CONSUMER_SECRET,
    webhookRef: process.env.TEST_NMB_OBP_WEBHOOK_SECRET_TOKEN_REF,
    webhookSecret: process.env.TEST_NMB_OBP_WEBHOOK_SECRET,
    directToken: process.env.NMB_OBP_SANDBOX_DIRECT_LOGIN_TOKEN,
  };
  const previousFetch = globalThis.fetch;

  process.env.PAYMENT_GATEWAY_PROVIDER_MANIFEST_JSON = JSON.stringify(providerManifest);
  process.env.TEST_NMB_OBP_BASE_URL = 'https://obp-api-sandbox.nmbbank.co.tz';
  process.env.TEST_NMB_OBP_CREDENTIAL_TOKEN_REF = 'env://TEST_NMB_OBP_CONSUMER_KEY';
  process.env.TEST_NMB_OBP_CONSUMER_KEY = 'consumer-key';
  process.env.TEST_NMB_OBP_CREDENTIAL_METADATA = '{"consumerSecretEnv":"TEST_NMB_OBP_CONSUMER_SECRET"}';
  process.env.TEST_NMB_OBP_CONSUMER_SECRET = 'consumer-secret';
  process.env.TEST_NMB_OBP_WEBHOOK_SECRET_TOKEN_REF = 'env://TEST_NMB_OBP_WEBHOOK_SECRET';
  process.env.TEST_NMB_OBP_WEBHOOK_SECRET = 'webhook-secret';
  process.env.NMB_OBP_SANDBOX_DIRECT_LOGIN_TOKEN = 'sandbox-token';

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/transaction-request-types')) {
      return new Response(JSON.stringify({
        transaction_request_types: [
          { value: 'M-Pesa Tz', secret: 'must-not-leak' },
          { value: 'TIPS Bank Transfer Tz' },
        ],
      }), { status: 200 });
    }
    if (url.includes('/dynamic-entities')) {
      return new Response(JSON.stringify({
        dynamic_entities: [
          { entityName: 'mobile_money_providers' },
          { entityName: 'unrelated_customer_notes' },
        ],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ banks: [{ id: 'nmbb.01.tz.nmbb', short_name: 'NMB' }] }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await obpDiscoveryService.discover('nmb-obp-sandbox', {
      bankId: 'nmbb.01.tz.nmbb',
      countryCode: 'TZ',
      currency: 'TZS',
    });

    assert.equal(result.provider.code, 'nmb-obp-sandbox');
    assert.ok(result.capabilities.some((item) => item.capabilityCode === 'M_PESA_TZ_TZ'));
    assert.ok(result.capabilities.some((item) => item.capabilityCode === 'TIPS_BANK_TRANSFER_TZ_TZ'));
    assert.ok(result.capabilities.some((item) => item.source === 'OBP_DYNAMIC_ENTITY'));
    const mpesa = result.capabilities.find((item) => item.capabilityCode === 'M_PESA_TZ_TZ');
    assert.equal(mpesa?.rail, 'MOBILE_MONEY');
    assert.deepEqual(mpesa?.requires, { msisdn: true });
    assert.equal((mpesa?.raw || {}).secret, undefined);
  } finally {
    globalThis.fetch = previousFetch;
    if (previous.manifest === undefined) delete process.env.PAYMENT_GATEWAY_PROVIDER_MANIFEST_JSON; else process.env.PAYMENT_GATEWAY_PROVIDER_MANIFEST_JSON = previous.manifest;
    if (previous.baseUrl === undefined) delete process.env.TEST_NMB_OBP_BASE_URL; else process.env.TEST_NMB_OBP_BASE_URL = previous.baseUrl;
    if (previous.tokenRef === undefined) delete process.env.TEST_NMB_OBP_CREDENTIAL_TOKEN_REF; else process.env.TEST_NMB_OBP_CREDENTIAL_TOKEN_REF = previous.tokenRef;
    if (previous.key === undefined) delete process.env.TEST_NMB_OBP_CONSUMER_KEY; else process.env.TEST_NMB_OBP_CONSUMER_KEY = previous.key;
    if (previous.metadata === undefined) delete process.env.TEST_NMB_OBP_CREDENTIAL_METADATA; else process.env.TEST_NMB_OBP_CREDENTIAL_METADATA = previous.metadata;
    if (previous.secret === undefined) delete process.env.TEST_NMB_OBP_CONSUMER_SECRET; else process.env.TEST_NMB_OBP_CONSUMER_SECRET = previous.secret;
    if (previous.webhookRef === undefined) delete process.env.TEST_NMB_OBP_WEBHOOK_SECRET_TOKEN_REF; else process.env.TEST_NMB_OBP_WEBHOOK_SECRET_TOKEN_REF = previous.webhookRef;
    if (previous.webhookSecret === undefined) delete process.env.TEST_NMB_OBP_WEBHOOK_SECRET; else process.env.TEST_NMB_OBP_WEBHOOK_SECRET = previous.webhookSecret;
    if (previous.directToken === undefined) delete process.env.NMB_OBP_SANDBOX_DIRECT_LOGIN_TOKEN; else process.env.NMB_OBP_SANDBOX_DIRECT_LOGIN_TOKEN = previous.directToken;
  }
});
