import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRequestAuditContext,
  hasSignedInternalRequestHeaders,
  isInternalGatewayPath,
  isOriginAllowed,
  parseOriginAllowlist,
} from '../src/security/runtimeControls.js';

const reqWithHeaders = (headers: Record<string, string>) => ({
  get: (name: string) => headers[name.toLowerCase()] || headers[name] || '',
});

test('runtime origin allowlist supports exact and subdomain matches', () => {
  const allowlist = parseOriginAllowlist(
    'https://shop.orbifinancial.com, https://*.trusted.orbifinancial.com',
    ['https://pay.orbifinancial.com'],
  );

  assert.equal(isOriginAllowed(undefined, allowlist), true);
  assert.equal(isOriginAllowed('https://pay.orbifinancial.com', allowlist), true);
  assert.equal(isOriginAllowed('https://shop.orbifinancial.com', allowlist), true);
  assert.equal(isOriginAllowed('https://portal.trusted.orbifinancial.com', allowlist), true);
  assert.equal(isOriginAllowed('https://evil.example.com', allowlist), false);
});

test('internal gateway paths require signed worker header set', () => {
  assert.equal(isInternalGatewayPath('/v1/internal/core/service-payment-events'), true);
  assert.equal(isInternalGatewayPath('/api/v1/internal/reconcile'), true);
  assert.equal(isInternalGatewayPath('/v1/payment-intents'), false);

  assert.equal(hasSignedInternalRequestHeaders(reqWithHeaders({})), false);
  assert.equal(hasSignedInternalRequestHeaders(reqWithHeaders({
    'x-worker-id': 'gateway',
    'x-worker-scopes': 'gateway:events:write',
    'x-worker-request-id': 'req_1',
    'x-worker-timestamp': new Date().toISOString(),
    'x-worker-nonce': 'nonce',
    'x-worker-signature': 'abc',
  })), true);
});

test('request audit context preserves supplied correlation ids', () => {
  const context = createRequestAuditContext(reqWithHeaders({
    'x-request-id': 'req_123',
    'x-trace-id': 'trace_123',
    'x-correlation-id': 'corr_123',
  }));

  assert.equal(context.requestId, 'req_123');
  assert.equal(context.traceId, 'trace_123');
  assert.equal(context.correlationId, 'corr_123');
  assert.equal(typeof context.startedAtMs, 'number');
});
