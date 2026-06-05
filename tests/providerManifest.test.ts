import assert from 'node:assert/strict';
import test from 'node:test';
import { loadProviderManifest } from '../src/providers/providerManifest.js';

const withManifest = (manifest: unknown, fn: () => void) => {
  const previous = process.env.PAYMENT_GATEWAY_PROVIDER_MANIFEST_JSON;
  process.env.PAYMENT_GATEWAY_PROVIDER_MANIFEST_JSON = JSON.stringify(manifest);
  try {
    fn();
  } finally {
    if (previous === undefined) {
      delete process.env.PAYMENT_GATEWAY_PROVIDER_MANIFEST_JSON;
    } else {
      process.env.PAYMENT_GATEWAY_PROVIDER_MANIFEST_JSON = previous;
    }
  }
};

test('manifest rejects providers that declare operations without endpoint mapping', () => {
  withManifest({
    providers: [{
      code: 'bad-provider',
      displayName: 'Bad Provider',
      rail: 'MOBILE_MONEY',
      protocol: 'REST_JSON',
      countries: ['TZ'],
      currencies: ['TZS'],
      operations: ['collection'],
      baseUrlEnv: 'BAD_PROVIDER_BASE_URL',
      credentialTokenRefEnv: 'BAD_PROVIDER_CREDENTIAL_TOKEN_REF',
      webhookSecretTokenRefEnv: 'BAD_PROVIDER_WEBHOOK_SECRET_TOKEN_REF',
    }],
  }, () => {
    assert.throws(() => loadProviderManifest(), /does not map its endpoint/);
  });
});

test('manifest accepts a fully mapped generic REST provider', () => {
  withManifest({
    providers: [{
      code: 'good-provider',
      displayName: 'Good Provider',
      rail: 'MOBILE_MONEY',
      protocol: 'REST_HMAC',
      countries: ['TZ'],
      currencies: ['TZS'],
      operations: ['collection'],
      baseUrlEnv: 'GOOD_PROVIDER_BASE_URL',
      credentialTokenRefEnv: 'GOOD_PROVIDER_CREDENTIAL_TOKEN_REF',
      webhookSecretTokenRefEnv: 'GOOD_PROVIDER_WEBHOOK_SECRET_TOKEN_REF',
      operationEndpoints: {
        collection: {
          method: 'POST',
          path: '/collections',
          idempotencyHeader: 'Idempotency-Key',
        },
      },
    }],
  }, () => {
    const providers = loadProviderManifest();

    assert.equal(providers.length, 1);
    assert.equal(providers[0].code, 'good-provider');
    assert.equal(providers[0].protocol, 'REST_HMAC');
  });
});

test('manifest rejects ISO 20022 providers without clearing profile references', () => {
  withManifest({
    providers: [{
      code: 'tips-profile',
      displayName: 'TIPS Profile',
      rail: 'BANK',
      protocol: 'ISO20022_REST_XML',
      countries: ['TZ'],
      currencies: ['TZS'],
      operations: ['payout'],
      baseUrlEnv: 'TIPS_BASE_URL',
      credentialTokenRefEnv: 'TIPS_CREDENTIAL_TOKEN_REF',
      webhookSecretTokenRefEnv: 'TIPS_WEBHOOK_SECRET_TOKEN_REF',
      operationEndpoints: {
        payout: { method: 'POST', path: '/iso20022/pacs008' },
      },
    }],
  }, () => {
    assert.throws(() => loadProviderManifest(), /ISO 20022 provider tips-profile requires/);
  });
});
