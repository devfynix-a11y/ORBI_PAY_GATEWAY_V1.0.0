import type { Request } from 'express';
import { calculateJwkThumbprint, importJWK, jwtVerify, type JWK } from 'jose';
import { config } from '../config.js';
import { assertNonceNotReplayed } from './financialRequestGuard.js';

const DPOP_ALLOWED_ALGS = ['ES256', 'RS256', 'PS256'] as const;
const DPOP_IAT_TOLERANCE_SECONDS = 300;

const DPoPClaimsSchema = {
  htm: 'string',
  htu: 'string',
  iat: 'number',
  jti: 'string',
} as const;

const isPublicJwk = (jwk: JWK | undefined): jwk is JWK => {
  if (!jwk || typeof jwk !== 'object') return false;
  if (!['EC', 'RSA'].includes(String(jwk.kty || ''))) return false;
  return !('d' in jwk) && !('p' in jwk) && !('q' in jwk) && !('oth' in jwk);
};

const assertDpopPayload = (payload: Record<string, unknown>) => {
  for (const [field, type] of Object.entries(DPoPClaimsSchema)) {
    if (typeof payload[field] !== type) throw new Error('DPOP_PROOF_INVALID');
  }
};

export const expectedDpopHtuForRequest = (req: Request): string => {
  const publicBase = String(config.publicBaseUrl || '').replace(/\/+$/, '');
  if (publicBase) return `${publicBase}${req.originalUrl || req.url}`;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host') || '';
  return `${proto}://${host}${req.originalUrl || req.url}`;
};

export const verifyDpopProof = async (input: {
  proof?: string;
  method: string;
  htu: string;
  expectedJkt?: string;
}) => {
  const proof = String(input.proof || '').trim();
  if (!proof) throw new Error('DPOP_PROOF_REQUIRED');

  let untrustedHeader: any;
  try {
    const [encodedHeader] = proof.split('.');
    untrustedHeader = JSON.parse(Buffer.from(encodedHeader || '', 'base64url').toString('utf8'));
  } catch {
    throw new Error('DPOP_PROOF_INVALID');
  }

  const alg = String(untrustedHeader?.alg || '');
  if (!DPOP_ALLOWED_ALGS.includes(alg as never)) throw new Error('DPOP_ALG_UNSUPPORTED');
  if (untrustedHeader?.typ && String(untrustedHeader.typ).toLowerCase() !== 'dpop+jwt') {
    throw new Error('DPOP_PROOF_INVALID');
  }
  if (!isPublicJwk(untrustedHeader?.jwk)) throw new Error('DPOP_PUBLIC_KEY_REQUIRED');

  const jkt = await calculateJwkThumbprint(untrustedHeader.jwk);
  if (input.expectedJkt && input.expectedJkt !== jkt) throw new Error('DPOP_KEY_MISMATCH');

  const key = await importJWK(untrustedHeader.jwk, alg);
  const { payload } = await jwtVerify(proof, key, { algorithms: [alg] });
  assertDpopPayload(payload);

  const htm = String(payload.htm).toUpperCase();
  const htu = String(payload.htu);
  const iat = Number(payload.iat);
  const jti = String(payload.jti);

  if (htm !== input.method.toUpperCase()) throw new Error('DPOP_HTM_MISMATCH');
  if (htu !== input.htu) throw new Error('DPOP_HTU_MISMATCH');
  if (Math.abs(Math.floor(Date.now() / 1000) - iat) > DPOP_IAT_TOLERANCE_SECONDS) {
    throw new Error('DPOP_PROOF_STALE');
  }
  assertNonceNotReplayed(`dpop:${jkt}`, jti, {
    timestampToleranceSeconds: DPOP_IAT_TOLERANCE_SECONDS,
    nonceTtlSeconds: DPOP_IAT_TOLERANCE_SECONDS,
    maxNonces: 20000,
  });

  return { jkt, alg, jwkThumbprint: jkt };
};

