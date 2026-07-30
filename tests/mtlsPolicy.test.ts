import assert from 'node:assert/strict';
import test from 'node:test';
import { validateMtlsPolicy } from '../src/security/mtlsPolicy.js';

test('production mTLS requires certificate material and HTTPS Core target', () => {
  const errors = validateMtlsPolicy({
    env: 'production',
    enabled: true,
    hasCert: false,
    hasKey: false,
    hasCa: false,
    rejectUnauthorized: true,
    coreBaseUrl: 'http://core:3000',
  });

  assert.equal(errors.length, 2);
  assert.match(errors.join(' '), /CERT_PATH/);
  assert.match(errors.join(' '), /https:\/\//);
});

test('production mTLS rejects disabled certificate verification', () => {
  const errors = validateMtlsPolicy({
    env: 'production',
    enabled: true,
    hasCert: true,
    hasKey: true,
    hasCa: true,
    rejectUnauthorized: false,
    coreBaseUrl: 'https://core.internal.orbifinancial.com',
  });

  assert.deepEqual(errors, [
    'PAYMENT_GATEWAY_INTERNAL_MTLS_REJECT_UNAUTHORIZED must remain true in production when mTLS is enabled.',
  ]);
});

test('mTLS policy allows disabled or non-production profiles', () => {
  assert.deepEqual(validateMtlsPolicy({
    env: 'production',
    enabled: false,
    hasCert: false,
    hasKey: false,
    hasCa: false,
    rejectUnauthorized: false,
    coreBaseUrl: 'http://core:3000',
  }), []);

  assert.deepEqual(validateMtlsPolicy({
    env: 'development',
    enabled: true,
    hasCert: false,
    hasKey: false,
    hasCa: false,
    rejectUnauthorized: false,
    coreBaseUrl: 'http://core:3000',
  }), []);
});
