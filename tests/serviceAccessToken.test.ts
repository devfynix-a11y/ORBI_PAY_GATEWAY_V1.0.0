import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.js';
import {
  issueServiceAccessToken,
  introspectServiceAccessToken,
  isServiceAccessToken,
  revokeServiceAccessToken,
  verifyServiceAccessToken,
} from '../src/security/serviceAccessToken.js';

test('service access token is signed and verifies stable claims', () => {
  config.security.serviceAccessTokenSecret = 'unit-test-service-access-token-secret';
  const issued = issueServiceAccessToken({
    serviceCode: 'orbi-shop',
    keyId: 'key_001',
    fingerprint: 'abcdef1234567890abcdef12',
    environment: 'sandbox',
    scopes: ['payments:create', 'escrow:create', 'payments:create'],
    ttlSeconds: 120,
  });

  assert.equal(isServiceAccessToken(issued.accessToken), true);
  assert.equal(issued.expiresIn, 120);
  const claims = verifyServiceAccessToken(issued.accessToken);
  assert.equal(claims.aud, 'orbi-pay-gateway-runtime');
  assert.equal(claims.serviceCode, 'orbi-shop');
  assert.equal(claims.environment, 'sandbox');
  assert.deepEqual(claims.scopes, ['payments:create', 'escrow:create']);
});

test('service access token rejects tampered signatures', () => {
  config.security.serviceAccessTokenSecret = 'unit-test-service-access-token-secret';
  const issued = issueServiceAccessToken({
    serviceCode: 'orbi-shop',
    keyId: 'key_001',
    fingerprint: 'abcdef1234567890abcdef12',
    environment: 'live',
    scopes: ['balance:read'],
    ttlSeconds: 120,
  });

  assert.throws(() => verifyServiceAccessToken(`${issued.accessToken}tampered`), /SERVICE_ACCESS_TOKEN_INVALID/);
});

test('service access token introspection reports revocation state', () => {
  config.security.serviceAccessTokenSecret = 'unit-test-service-access-token-secret';
  const issued = issueServiceAccessToken({
    serviceCode: 'orbi-shop',
    keyId: 'key_revoke_001',
    fingerprint: 'abcdef1234567890abcdef12',
    environment: 'sandbox',
    scopes: ['payments:create'],
    ttlSeconds: 120,
  });

  assert.equal(introspectServiceAccessToken(issued.accessToken).active, true);
  const claims = revokeServiceAccessToken(issued.accessToken);
  assert.equal(claims.serviceCode, 'orbi-shop');
  assert.equal(introspectServiceAccessToken(issued.accessToken).active, false);
  assert.throws(() => verifyServiceAccessToken(issued.accessToken), /SERVICE_ACCESS_TOKEN_REVOKED/);
});
