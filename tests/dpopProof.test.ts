import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { verifyDpopProof } from '../src/security/dpopProof.js';
import { __resetFinancialRequestGuardForTests } from '../src/security/financialRequestGuard.js';

const signProof = async (input: {
  method?: string;
  htu?: string;
  jti?: string;
  iat?: number;
}) => {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = await exportJWK(publicKey);
  const proof = await new SignJWT({
    htm: input.method || 'POST',
    htu: input.htu || 'https://pay.orbifinancial.com/oauth/token',
    iat: input.iat || Math.floor(Date.now() / 1000),
    jti: input.jti || `dpop-test-${crypto.randomUUID()}`,
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk })
    .sign(privateKey);
  return proof;
};

test('DPoP proof verifies and returns a stable public key thumbprint', async () => {
  __resetFinancialRequestGuardForTests();
  const proof = await signProof({});
  const result = await verifyDpopProof({
    proof,
    method: 'POST',
    htu: 'https://pay.orbifinancial.com/oauth/token',
  });

  assert.equal(typeof result.jkt, 'string');
  assert.ok(result.jkt.length > 20);
});

test('DPoP proof rejects replay and endpoint mismatch', async () => {
  __resetFinancialRequestGuardForTests();
  const proof = await signProof({ jti: 'dpop-test-replay-0001' });
  const first = await verifyDpopProof({
    proof,
    method: 'POST',
    htu: 'https://pay.orbifinancial.com/oauth/token',
  });

  await assert.rejects(
    () => verifyDpopProof({
      proof,
      method: 'POST',
      htu: 'https://pay.orbifinancial.com/oauth/token',
      expectedJkt: first.jkt,
    }),
    /PAY_GATEWAY_SIGNATURE_NONCE_REPLAYED/,
  );

  const otherProof = await signProof({ jti: 'dpop-test-mismatch-0001' });
  await assert.rejects(
    () => verifyDpopProof({
      proof: otherProof,
      method: 'POST',
      htu: 'https://pay.orbifinancial.com/v1/payments',
    }),
    /DPOP_HTU_MISMATCH/,
  );
});
