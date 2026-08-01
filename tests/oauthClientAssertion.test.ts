import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import {
  PRIVATE_KEY_JWT_ASSERTION_TYPE,
  verifyOAuthPrivateKeyJwt,
} from '../src/security/oauthClientAssertion.js';

test('private_key_jwt verifies signed client assertion and blocks replay', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: 'client-key-1', use: 'sig', alg: 'RS256' });
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ environment: 'sandbox' })
    .setProtectedHeader({ alg: 'RS256', kid: 'client-key-1', typ: 'JWT' })
    .setIssuer('orbi-shop')
    .setSubject('orbi-shop')
    .setAudience('https://sandbox-pay.orbifinancial.com/oauth/token')
    .setJti(`jti-${crypto.randomUUID()}`)
    .setIssuedAt(now)
    .setExpirationTime(now + 120)
    .sign(privateKey);

  const claims = await verifyOAuthPrivateKeyJwt({
    assertionType: PRIVATE_KEY_JWT_ASSERTION_TYPE,
    assertion,
    clientId: 'orbi-shop',
    jwks: { keys: [jwk] },
    expectedAudiences: ['https://sandbox-pay.orbifinancial.com/oauth/token'],
  });
  assert.equal(claims.sub, 'orbi-shop');

  await assert.rejects(
    () => verifyOAuthPrivateKeyJwt({
      assertionType: PRIVATE_KEY_JWT_ASSERTION_TYPE,
      assertion,
      clientId: 'orbi-shop',
      jwks: { keys: [jwk] },
      expectedAudiences: ['https://sandbox-pay.orbifinancial.com/oauth/token'],
    }),
    /PAY_GATEWAY_SIGNATURE_NONCE_REPLAYED/,
  );
});

test('private_key_jwt rejects wrong audience', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: 'client-key-2', use: 'sig', alg: 'RS256' });
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'client-key-2', typ: 'JWT' })
    .setIssuer('orbi-shop')
    .setSubject('orbi-shop')
    .setAudience('https://attacker.example.com/oauth/token')
    .setJti(`jti-${crypto.randomUUID()}`)
    .setIssuedAt(now)
    .setExpirationTime(now + 120)
    .sign(privateKey);

  await assert.rejects(
    () => verifyOAuthPrivateKeyJwt({
      assertionType: PRIVATE_KEY_JWT_ASSERTION_TYPE,
      assertion,
      clientId: 'orbi-shop',
      jwks: { keys: [jwk] },
      expectedAudiences: ['https://sandbox-pay.orbifinancial.com/oauth/token'],
    }),
    /OAUTH_CLIENT_ASSERTION_INVALID/,
  );
});
