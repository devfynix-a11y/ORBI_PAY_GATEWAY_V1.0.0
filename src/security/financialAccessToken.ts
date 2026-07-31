import crypto from 'crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { isAccessTokenIdRevoked } from './serviceAccessToken.js';

export const FINANCIAL_ACCESS_TOKEN_PREFIX = 'orbi_ft_';

export const FinancialAccessTokenClaimsSchema = z.object({
  iss: z.literal('orbi-pay-gateway'),
  aud: z.string().trim().min(1),
  typ: z.literal('financial_access'),
  sub: z.string().trim().min(1),
  azp: z.string().trim().min(1),
  serviceCode: z.string().trim().min(1),
  keyId: z.string().trim().min(1),
  fingerprint: z.string().trim().min(8),
  environment: z.enum(['sandbox', 'live']),
  scopes: z.array(z.string().trim().min(1)).min(1),
  consentId: z.string().trim().min(1),
  identityIssuer: z.string().url(),
  identitySessionId: z.string().trim().min(1).optional(),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
  jti: z.string().trim().min(1),
});

export type FinancialAccessTokenClaims = z.infer<typeof FinancialAccessTokenClaimsSchema>;

const base64urlJson = (value: unknown) =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

const sign = (payload: string) => {
  if (!config.security.serviceAccessTokenSecret) throw new Error('SERVICE_ACCESS_TOKEN_SECRET_REQUIRED');
  return crypto.createHmac('sha256', config.security.serviceAccessTokenSecret).update(payload).digest('base64url');
};

export const isFinancialAccessToken = (value: string) =>
  value.trim().startsWith(FINANCIAL_ACCESS_TOKEN_PREFIX);

export const issueFinancialAccessToken = (input: {
  subject: string;
  serviceCode: string;
  keyId: string;
  fingerprint: string;
  environment: 'sandbox' | 'live';
  scopes: string[];
  consentId: string;
  identityIssuer: string;
  identitySessionId?: string;
  audience?: string;
  ttlSeconds?: number;
}) => {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(60, Math.min(input.ttlSeconds || config.security.financialTokenTtlSeconds, 600));
  const claims: FinancialAccessTokenClaims = {
    iss: 'orbi-pay-gateway',
    aud: input.audience || config.security.financialTokenAudience,
    typ: 'financial_access',
    sub: input.subject,
    azp: input.serviceCode,
    serviceCode: input.serviceCode,
    keyId: input.keyId,
    fingerprint: input.fingerprint,
    environment: input.environment,
    scopes: [...new Set(input.scopes)],
    consentId: input.consentId,
    identityIssuer: input.identityIssuer,
    identitySessionId: input.identitySessionId,
    iat: now,
    exp: now + ttl,
    jti: `fat_${crypto.randomUUID()}`,
  };
  const payload = base64urlJson(claims);
  return {
    accessToken: `${FINANCIAL_ACCESS_TOKEN_PREFIX}${payload}.${sign(payload)}`,
    claims,
    expiresIn: ttl,
  };
};

export const verifyFinancialAccessToken = (token: string) => {
  const value = token.trim();
  if (!isFinancialAccessToken(value)) throw new Error('FINANCIAL_ACCESS_TOKEN_INVALID');
  const body = value.slice(FINANCIAL_ACCESS_TOKEN_PREFIX.length);
  const separator = body.lastIndexOf('.');
  if (separator <= 0) throw new Error('FINANCIAL_ACCESS_TOKEN_INVALID');
  const payload = body.slice(0, separator);
  const signature = Buffer.from(body.slice(separator + 1));
  const expected = Buffer.from(sign(payload));
  if (signature.length !== expected.length || !crypto.timingSafeEqual(signature, expected)) {
    throw new Error('FINANCIAL_ACCESS_TOKEN_INVALID');
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('FINANCIAL_ACCESS_TOKEN_INVALID');
  }
  const claims = FinancialAccessTokenClaimsSchema.parse(decoded);
  if (claims.aud !== config.security.financialTokenAudience) throw new Error('FINANCIAL_ACCESS_TOKEN_AUDIENCE_INVALID');
  if (claims.exp <= Math.floor(Date.now() / 1000)) throw new Error('FINANCIAL_ACCESS_TOKEN_EXPIRED');
  if (isAccessTokenIdRevoked(claims.jti)) throw new Error('FINANCIAL_ACCESS_TOKEN_REVOKED');
  return claims;
};
