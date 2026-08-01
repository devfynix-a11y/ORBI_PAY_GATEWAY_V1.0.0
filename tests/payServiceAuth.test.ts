import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request } from 'express';
import {
  authenticatePayServiceCredential,
  developerEnvironmentForRuntime,
} from '../src/services/payServiceAuth.js';
import type { PayServiceDefinition } from '../src/types.js';

const service: PayServiceDefinition = {
  code: 'merchant-test',
  displayName: 'Merchant Test',
  status: 'ACTIVE',
  apiKeyTokenRefEnv: 'TEST_PAY_SERVICE_TOKEN_REF',
  webhookSecretTokenRefEnv: 'TEST_PAY_SERVICE_WEBHOOK_REF',
  callbackUrlEnv: 'TEST_PAY_SERVICE_CALLBACK_URL',
  allowedOperations: ['collection', 'paysafe'],
  allowedCurrencies: ['TZS'],
};

const requestWithKey = (key: string) => ({
  get: (name: string) => {
    const normalized = name.toLowerCase();
    if (normalized === 'x-orbi-pay-service-key') return key;
    return undefined;
  },
}) as Request;

test('pay service auth resolves live environment from production key prefix', async () => {
  process.env.TEST_PAY_SERVICE_TOKEN_REF = 'env://TEST_PAY_SERVICE_SECRET';
  process.env.TEST_PAY_SERVICE_SECRET = 'orbi_live_test_secret';

  const authenticated = await authenticatePayServiceCredential([service], requestWithKey('orbi_live_test_secret'));

  assert.equal(authenticated.service.code, 'merchant-test');
  assert.equal(authenticated.credential.source, 'service_registry');
  assert.equal(authenticated.credential.environment, 'live');
  assert.equal(developerEnvironmentForRuntime('production'), 'live');
});

test('pay service auth resolves sandbox environment from demo key prefix', async () => {
  process.env.TEST_PAY_SERVICE_TOKEN_REF = 'env://TEST_PAY_SERVICE_SECRET';
  process.env.TEST_PAY_SERVICE_SECRET = 'orbi_sandbox_test_secret';

  const authenticated = await authenticatePayServiceCredential([service], requestWithKey('orbi_sandbox_test_secret'));

  assert.equal(authenticated.credential.environment, 'sandbox');
  assert.equal(developerEnvironmentForRuntime('demo'), 'sandbox');
});
