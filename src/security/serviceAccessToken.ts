import crypto from 'crypto';
import { z } from 'zod';
import { config } from '../config.js';

export const SERVICE_ACCESS_TOKEN_PREFIX = 'orbi_at_';

export const ServiceAccessTokenClaimsSchema = z.object({
  iss: z.literal('orbi-pay-gateway'),
  typ: z.literal('service_access'),
  sub: z.string().trim().min(1),
  serviceCode: z.string().trim().min(1),
  keyId: z.string().trim().min(1),
  fingerprint: z.string().trim().min(8),
  environment: z.enum(['sandbox', 'live']),
  scopes: z.array(z.string().trim().min(1)).min(1),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
  jti: z.string().trim().min(1),
});

export type ServiceAccessTokenClaims = z.infer<typeof ServiceAccessTokenClaimsSchema>;

const base64urlJson = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

const sign = (payload: string): string => {
  if (!config.security.serviceAccessTokenSecret) throw new Error('SERVICE_ACCESS_TOKEN_SECRET_REQUIRED');
  return crypto
    .createHmac('sha256', config.security.serviceAccessTokenSecret)
    .update(payload)
    .digest('base64url');
};

export const isServiceAccessToken = (value: string): boolean =>
  value.trim().startsWith(SERVICE_ACCESS_TOKEN_PREFIX);

export const issueServiceAccessToken = (input: {
  serviceCode: string;
  keyId: string;
  fingerprint: string;
  environment: 'sandbox' | 'live';
  scopes: string[];
  ttlSeconds?: number;
}) => {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.max(60, Math.min(input.ttlSeconds || config.security.serviceAccessTokenTtlSeconds, 3600));
  const claims: ServiceAccessTokenClaims = {
    iss: 'orbi-pay-gateway',
    typ: 'service_access',
    sub: input.serviceCode,
    serviceCode: input.serviceCode,
    keyId: input.keyId,
    fingerprint: input.fingerprint,
    environment: input.environment,
    scopes: [...new Set(input.scopes.map((scope) => scope.trim()).filter(Boolean))],
    iat: now,
    exp: now + ttlSeconds,
    jti: `sat_${crypto.randomUUID()}`,
  };
  const payload = base64urlJson(claims);
  return {
    accessToken: `${SERVICE_ACCESS_TOKEN_PREFIX}${payload}.${sign(payload)}`,
    claims,
    expiresIn: ttlSeconds,
  };
};

export const verifyServiceAccessToken = (token: string): ServiceAccessTokenClaims => {
  const value = token.trim();
  if (!isServiceAccessToken(value)) throw new Error('SERVICE_ACCESS_TOKEN_INVALID');
  const tokenBody = value.slice(SERVICE_ACCESS_TOKEN_PREFIX.length);
  const separator = tokenBody.lastIndexOf('.');
  if (separator <= 0) throw new Error('SERVICE_ACCESS_TOKEN_INVALID');
  const payload = tokenBody.slice(0, separator);
  const signature = tokenBody.slice(separator + 1);
  const expected = sign(payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw new Error('SERVICE_ACCESS_TOKEN_INVALID');
  }
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('SERVICE_ACCESS_TOKEN_INVALID');
  }
  const parsed = ServiceAccessTokenClaimsSchema.parse(claims);
  if (parsed.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('SERVICE_ACCESS_TOKEN_EXPIRED');
  }
  return parsed;
};
