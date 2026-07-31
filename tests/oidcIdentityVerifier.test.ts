import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
} from 'jose';
import { OidcIdentityVerifier } from '../src/security/oidcIdentityVerifier.js';

test('OIDC verifier accepts only correctly signed issuer and audience assertions', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: 'unit-key-1', use: 'sig', alg: 'RS256' });
  const server = http.createServer((req, res) => {
    if (req.url === '/realms/orbi/protocol/openid-connect/certs') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const issuer = `http://127.0.0.1:${address.port}/realms/orbi`;
  const verifier = new OidcIdentityVerifier({ issuer, audience: 'orbi-core' });
  const now = Math.floor(Date.now() / 1000);
  const valid = await new SignJWT({ sid: 'session_001', auth_time: now })
    .setProtectedHeader({ alg: 'RS256', kid: 'unit-key-1', typ: 'JWT' })
    .setIssuer(issuer)
    .setAudience('orbi-core')
    .setSubject('user_001')
    .setIssuedAt(now)
    .setExpirationTime(now + 120)
    .sign(privateKey);
  const wrongAudience = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'unit-key-1', typ: 'JWT' })
    .setIssuer(issuer)
    .setAudience('wrong-audience')
    .setSubject('user_001')
    .setIssuedAt(now)
    .setExpirationTime(now + 120)
    .sign(privateKey);

  try {
    const identity = await verifier.verify(valid);
    assert.equal(identity.subject, 'user_001');
    assert.equal(identity.sessionId, 'session_001');
    await assert.rejects(() => verifier.verify(wrongAudience), /OIDC_SUBJECT_TOKEN_INVALID/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
});
