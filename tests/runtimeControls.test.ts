import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRequestAuditContext,
  hasSignedInternalRequestHeaders,
  isInternalGatewayPath,
  isOriginAllowed,
  isProductionBrowserOrigin,
  isProductionPublicHttpsUrl,
  parseOriginAllowlist,
  securityHeadersForRequest,
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

test('production browser origins must be public https domains', () => {
  assert.equal(isProductionBrowserOrigin('https://www.tag.co.tz'), true);
  assert.equal(isProductionBrowserOrigin('https://merchant.example.com'), true);
  assert.equal(isProductionBrowserOrigin('http://merchant.example.com'), false);
  assert.equal(isProductionBrowserOrigin('https://localhost:5173'), false);
  assert.equal(isProductionBrowserOrigin('https://127.0.0.1:5173'), false);
  assert.equal(isProductionBrowserOrigin('https://192.168.1.10'), false);
  assert.equal(isProductionBrowserOrigin('https://*.merchant.example.com'), false);
});

test('production callback urls must be public https urls', () => {
  assert.equal(isProductionPublicHttpsUrl('https://www.tag.co.tz/orbi/callback'), true);
  assert.equal(isProductionPublicHttpsUrl('https://merchant.example.com/api/orbi/webhooks?version=1'), true);
  assert.equal(isProductionPublicHttpsUrl('http://merchant.example.com/api/orbi/webhooks'), false);
  assert.equal(isProductionPublicHttpsUrl('https://localhost/orbi/callback'), false);
  assert.equal(isProductionPublicHttpsUrl('https://10.0.0.5/orbi/callback'), false);
  assert.equal(isProductionPublicHttpsUrl('https://*.merchant.example.com/orbi/callback'), false);
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

test('security headers disable caching for sensitive runtime routes', () => {
  const headers = securityHeadersForRequest({
    path: '/v1/payment-intents',
    env: 'development',
    secure: false,
  });

  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['cache-control'], 'no-store, max-age=0');
  assert.equal(headers.pragma, 'no-cache');
  assert.equal(headers['strict-transport-security'], undefined);
});

test('production secure requests receive HSTS', () => {
  const headers = securityHeadersForRequest({
    path: '/v1/developer/services',
    env: 'production',
    secure: true,
  });

  assert.equal(headers['strict-transport-security'], 'max-age=31536000; includeSubDomains');
  assert.equal(headers['cache-control'], 'no-store, max-age=0');
});
