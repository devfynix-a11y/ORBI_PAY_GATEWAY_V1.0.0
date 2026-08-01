import { createLocalJWKSet, jwtVerify, type JWTPayload, type JWK } from 'jose';
import { assertNonceNotReplayed } from './financialRequestGuard.js';

export const PRIVATE_KEY_JWT_ASSERTION_TYPE =
  'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

export type OAuthClientAssertionInput = {
  assertionType?: string;
  assertion?: string;
  clientId?: string;
  jwks?: unknown;
  expectedAudiences: string[];
};

const extractKeys = (jwks: unknown): JWK[] => {
  const value = jwks as { keys?: unknown } | JWK[] | undefined;
  if (Array.isArray(value)) return value as JWK[];
  if (Array.isArray(value?.keys)) return value.keys as JWK[];
  return [];
};

const assertClaim = (value: unknown, expected: string, code: string) => {
  if (String(value || '') !== expected) throw new Error(code);
};

export const verifyOAuthPrivateKeyJwt = async (input: OAuthClientAssertionInput): Promise<JWTPayload> => {
  if (!input.assertionType && !input.assertion) throw new Error('OAUTH_CLIENT_ASSERTION_MISSING');
  if (input.assertionType !== PRIVATE_KEY_JWT_ASSERTION_TYPE || !input.assertion) {
    throw new Error('OAUTH_CLIENT_ASSERTION_INVALID');
  }
  const clientId = String(input.clientId || '').trim();
  if (!clientId) throw new Error('OAUTH_CLIENT_ID_REQUIRED');
  const keys = extractKeys(input.jwks);
  if (!keys.length) throw new Error('OAUTH_CLIENT_JWKS_NOT_CONFIGURED');

  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(input.assertion, createLocalJWKSet({ keys }), {
      algorithms: ['RS256', 'PS256', 'ES256'],
      audience: input.expectedAudiences,
      issuer: clientId,
      subject: clientId,
      maxTokenAge: '5m',
    });
    payload = verified.payload;
  } catch {
    throw new Error('OAUTH_CLIENT_ASSERTION_INVALID');
  }

  assertClaim(payload.iss, clientId, 'OAUTH_CLIENT_ASSERTION_INVALID');
  assertClaim(payload.sub, clientId, 'OAUTH_CLIENT_ASSERTION_INVALID');
  const jti = String(payload.jti || '').trim();
  if (jti.length < 12 || jti.length > 160) throw new Error('OAUTH_CLIENT_ASSERTION_JTI_REQUIRED');
  assertNonceNotReplayed(`oauth-client-assertion:${clientId}`, jti, {
    timestampToleranceSeconds: 300,
    nonceTtlSeconds: 600,
    maxNonces: 100000,
  });
  return payload;
};
