import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPrivateCoreHttpTarget,
  validateInternalCoreTransportPolicy,
} from '../src/security/internalCoreTransportPolicy.js';

test('internal core transport allows Docker private HTTP only with HMAC signing', () => {
  assert.equal(isPrivateCoreHttpTarget('http://core:3000'), true);
  assert.equal(isPrivateCoreHttpTarget('http://core-sandbox:3000'), true);
  assert.equal(isPrivateCoreHttpTarget('http://10.0.0.10:3000'), true);
  assert.equal(isPrivateCoreHttpTarget('http://api.orbifinancial.com'), false);

  assert.deepEqual(validateInternalCoreTransportPolicy({
    env: 'production',
    mode: 'private_http',
    coreBaseUrl: 'http://core:3000',
    allowPrivateHttp: true,
    workerSigningConfigured: true,
    mtlsEnabled: false,
    hasCert: false,
    hasKey: false,
    hasCa: false,
    rejectUnauthorized: true,
  }), []);
});

test('internal core transport rejects public HTTP and unsigned private HTTP', () => {
  const publicErrors = validateInternalCoreTransportPolicy({
    env: 'production',
    mode: 'private_http',
    coreBaseUrl: 'http://api.orbifinancial.com',
    allowPrivateHttp: true,
    workerSigningConfigured: true,
    mtlsEnabled: false,
    hasCert: false,
    hasKey: false,
    hasCa: false,
    rejectUnauthorized: true,
  });
  assert.match(publicErrors.join(' '), /Docker\/internal\/private HTTP/);

  const unsignedErrors = validateInternalCoreTransportPolicy({
    env: 'production',
    mode: 'private_http',
    coreBaseUrl: 'http://core:3000',
    allowPrivateHttp: true,
    workerSigningConfigured: false,
    mtlsEnabled: false,
    hasCert: false,
    hasKey: false,
    hasCa: false,
    rejectUnauthorized: true,
  });
  assert.match(unsignedErrors.join(' '), /WORKER_SIGNING_SECRET/);
});

test('internal core transport enforces mTLS certificate readiness', () => {
  const errors = validateInternalCoreTransportPolicy({
    env: 'production',
    mode: 'mtls',
    coreBaseUrl: 'https://core.internal.orbifinancial.com',
    allowPrivateHttp: false,
    workerSigningConfigured: true,
    mtlsEnabled: true,
    hasCert: false,
    hasKey: true,
    hasCa: true,
    rejectUnauthorized: true,
  });

  assert.match(errors.join(' '), /cert, key, and CA/);
});
