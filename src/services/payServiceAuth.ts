import crypto from 'crypto';
import type { Request } from 'express';
import type { PayServiceDefinition } from '../types.js';
import { resolveTokenSecret } from '../security/tokenResolver.js';

const safeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const extractServiceApiKey = (req: Request): string => {
  const bearer = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || req.get('x-orbi-pay-service-key') || req.get('x-api-key') || '';
};

export const assertPayServiceApiKey = (service: PayServiceDefinition, req: Request) => {
  const tokenRef = process.env[service.apiKeyTokenRefEnv]?.trim();
  if (!tokenRef) throw new Error('PAY_SERVICE_API_KEY_TOKEN_REF_MISSING');
  const expected = resolveTokenSecret(tokenRef);
  const provided = extractServiceApiKey(req);
  if (!provided || !safeEqual(provided, expected)) {
    throw new Error('PAY_SERVICE_AUTH_FAILED');
  }
};

export const authenticatePayServiceRequest = (
  services: PayServiceDefinition[],
  req: Request,
): PayServiceDefinition => {
  const provided = extractServiceApiKey(req);
  if (!provided) throw new Error('PAY_SERVICE_AUTH_FAILED');

  let unresolvedBinding = false;
  for (const service of services) {
    const tokenRef = process.env[service.apiKeyTokenRefEnv]?.trim();
    if (!tokenRef) {
      unresolvedBinding = true;
      continue;
    }

    const expected = resolveTokenSecret(tokenRef);
    if (safeEqual(provided, expected)) return service;
  }

  if (unresolvedBinding && services.length === 1) {
    throw new Error('PAY_SERVICE_API_KEY_TOKEN_REF_MISSING');
  }

  throw new Error('PAY_SERVICE_AUTH_FAILED');
};
