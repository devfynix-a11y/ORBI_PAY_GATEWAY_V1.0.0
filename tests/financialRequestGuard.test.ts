import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __resetFinancialRequestGuardForTests,
  assertFinancialRateLimit,
  assertFreshTimestamp,
  assertNonceNotReplayed,
} from '../src/security/financialRequestGuard.js';

test('financial request guard rejects stale timestamps', () => {
  assert.throws(
    () => assertFreshTimestamp(String(Math.floor(Date.now() / 1000) - 1000), 300),
    /PAY_GATEWAY_SIGNATURE_TIMESTAMP_STALE/,
  );
});

test('financial request guard rejects nonce replay per subject', () => {
  __resetFinancialRequestGuardForTests();
  const config = {
    timestampToleranceSeconds: 300,
    nonceTtlSeconds: 600,
    maxNonces: 100,
  };

  assert.doesNotThrow(() => assertNonceNotReplayed('service-a:key-1', 'nonce-1234567890', config));
  assert.throws(
    () => assertNonceNotReplayed('service-a:key-1', 'nonce-1234567890', config),
    /PAY_GATEWAY_SIGNATURE_NONCE_REPLAYED/,
  );
  assert.doesNotThrow(() => assertNonceNotReplayed('service-b:key-1', 'nonce-1234567890', config));
});

test('financial request guard rate limits per subject', () => {
  __resetFinancialRequestGuardForTests();
  const config = {
    windowMs: 60_000,
    maxRequests: 2,
    maxSubjects: 100,
  };

  assert.doesNotThrow(() => assertFinancialRateLimit('service-a:key-1', config));
  assert.doesNotThrow(() => assertFinancialRateLimit('service-a:key-1', config));
  assert.throws(
    () => assertFinancialRateLimit('service-a:key-1', config),
    /PAY_GATEWAY_RATE_LIMITED/,
  );
  assert.doesNotThrow(() => assertFinancialRateLimit('service-b:key-1', config));
});
