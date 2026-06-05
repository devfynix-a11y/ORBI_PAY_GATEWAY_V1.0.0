import assert from 'node:assert/strict';
import test from 'node:test';
import { rejectUnsafeDirectSecretsInProduction } from '../src/security/providerCredentialVault.js';

const withEnv = (values: Record<string, string | undefined>, fn: () => void) => {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(values)) {
    previous.set(key, process.env[key]);
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test('tokenized production allows control-plane discovery and worker secrets', () => {
  withEnv({
    NODE_ENV: 'production',
    PAYMENT_GATEWAY_CREDENTIAL_MODE: 'tokenized',
    PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY: 'operator-key',
    WORKER_SIGNING_SECRET: 'worker-secret',
    PROVIDER_API_KEY: undefined,
  }, () => {
    assert.doesNotThrow(() => rejectUnsafeDirectSecretsInProduction());
  });
});

test('tokenized production rejects direct provider secrets', () => {
  withEnv({
    NODE_ENV: 'production',
    PAYMENT_GATEWAY_CREDENTIAL_MODE: 'tokenized',
    PROVIDER_API_KEY: 'provider-secret',
  }, () => {
    assert.throws(() => rejectUnsafeDirectSecretsInProduction(), /PROVIDER_API_KEY/);
  });
});
