import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSignedInternalHeaders, hashInternalRequestBody } from '../src/security/internalSigner.js';

test('stable body hash is independent of object key order', () => {
  assert.equal(
    hashInternalRequestBody({ b: 2, a: 1, nested: { z: true, c: 'ok' } }),
    hashInternalRequestBody({ nested: { c: 'ok', z: true }, a: 1, b: 2 }),
  );
});

test('signed internal headers include Core worker authentication headers', () => {
  const headers = buildSignedInternalHeaders({
    method: 'POST',
    path: '/api/internal/gateway/provider-events',
    body: { providerId: 'provider-code', reference: 'TX-1', status: 'completed' },
    workerId: 'orbi-payment-gateway',
    scopes: ['gateway:events:write'],
    signingSecret: 'test-secret',
    keyId: 'gateway-test',
  });

  assert.equal(headers['x-worker-id'], 'orbi-payment-gateway');
  assert.equal(headers['x-worker-scopes'], 'gateway:events:write');
  assert.equal(headers['x-worker-key-id'], 'gateway-test');
  assert.match(headers['x-worker-signature'], /^[a-f0-9]{64}$/);
});
