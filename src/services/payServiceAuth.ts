import crypto from 'crypto';
import type { Request } from 'express';
import type { PayServiceDefinition, PayServiceOperation } from '../types.js';
import { resolveTokenSecret } from '../security/tokenResolver.js';
import { isServiceAccessToken, verifyServiceAccessToken } from '../security/serviceAccessToken.js';
import { developerPortalStore } from './developerPortalStore.js';

export type RuntimeEnvironment = 'demo' | 'production';
export type DeveloperEnvironment = 'sandbox' | 'live';

export type PayServiceCredentialContext = {
  source: 'service_registry' | 'developer_portal';
  environment?: DeveloperEnvironment;
  keyId?: string;
  fingerprint?: string;
};

export type AuthenticatedPayService = {
  service: PayServiceDefinition;
  credential: PayServiceCredentialContext;
};

const safeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const extractServiceApiKey = (req: Request): string => {
  const bearer = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || req.get('x-orbi-pay-service-key') || req.get('x-api-key') || '';
};

export const developerEnvironmentForRuntime = (environment: RuntimeEnvironment): DeveloperEnvironment =>
  environment === 'production' ? 'live' : 'sandbox';

const environmentFromServiceKeyPrefix = (secret: string): DeveloperEnvironment | undefined => {
  if (secret.startsWith('orbi_sandbox_')) return 'sandbox';
  if (secret.startsWith('orbi_live_')) return 'live';
  return undefined;
};

const serviceOperationsForScopes = (scopes: string[]): PayServiceOperation[] => {
  const operations = new Set<PayServiceOperation>();
  if (scopes.includes('payments:create')) {
    operations.add('collection');
    operations.add('payout');
    operations.add('refund');
  }
  if (scopes.includes('escrow:create')) operations.add('paysafe');
  if (scopes.includes('withdrawal:request')) operations.add('payout');
  return [...operations];
};

export const serviceDefinitionFromDeveloperService = (
  service: ReturnType<typeof developerPortalStore.getService>,
  grantedScopes: string[] = service.scopesGranted,
): PayServiceDefinition => {
  const metadata = service.metadata || {};
  const registryOperations = Array.isArray((metadata as any).allowedOperations)
    ? (metadata as any).allowedOperations
    : [];
  const registryCurrencies = Array.isArray((metadata as any).allowedCurrencies)
    ? (metadata as any).allowedCurrencies
    : [];
  const registryCountries = Array.isArray((metadata as any).allowedCountries)
    ? (metadata as any).allowedCountries
    : [];
  const merchant = (metadata as any).merchant && typeof (metadata as any).merchant === 'object'
    ? (metadata as any).merchant
    : undefined;

  return {
    code: service.serviceCode,
    displayName: service.displayName,
    status: service.status === 'active' ? 'ACTIVE' : 'DISABLED',
    apiKeyTokenRefEnv: '',
    webhookSecretTokenRefEnv: '',
    callbackUrlEnv: '',
    allowedOperations: registryOperations.length
      ? registryOperations
      : serviceOperationsForScopes(grantedScopes),
    allowedCurrencies: registryCurrencies.length ? registryCurrencies : ['TZS'],
    allowedCountries: registryCountries,
    merchant,
    metadata: {
      ...metadata,
      developerPortalService: true,
      businessType: service.businessType,
      environments: service.environments,
      scopesGranted: grantedScopes,
      serviceAccessTokenScoped: grantedScopes.length !== service.scopesGranted.length,
      webhookUrls: service.webhookUrls,
    },
  };
};

const resolveDeveloperCredential = (secret: string) => {
  try {
    return developerPortalStore.resolveApiKey(secret);
  } catch (error: any) {
    if (error?.message === 'DEVELOPER_PORTAL_STORE_NOT_INITIALIZED') return undefined;
    throw error;
  }
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
): PayServiceDefinition => authenticatePayServiceCredential(services, req).service;

export const authenticatePayServiceCredential = (
  services: PayServiceDefinition[],
  req: Request,
): AuthenticatedPayService => {
  const provided = extractServiceApiKey(req);
  if (!provided) throw new Error('PAY_SERVICE_AUTH_FAILED');

  if (isServiceAccessToken(provided)) {
    const claims = verifyServiceAccessToken(provided);
    const service = developerPortalStore.getService(claims.serviceCode);
    if (service.status !== 'active') throw new Error('PAY_SERVICE_AUTH_FAILED');
    const key = (service.keys || []).find((item) =>
      item.keyId === claims.keyId &&
      item.fingerprint === claims.fingerprint &&
      item.environment === claims.environment &&
      item.status === 'active' &&
      (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()),
    );
    if (!key) throw new Error('PAY_SERVICE_AUTH_FAILED');
    const grantedScopes = claims.scopes.filter((scope) => service.scopesGranted.includes(scope as any));
    if (grantedScopes.length !== claims.scopes.length || grantedScopes.length === 0) {
      throw new Error('PAY_SERVICE_SCOPE_NOT_GRANTED');
    }
    return {
      service: serviceDefinitionFromDeveloperService(service, grantedScopes),
      credential: {
        source: 'developer_portal',
        environment: claims.environment,
        keyId: claims.keyId,
        fingerprint: claims.fingerprint,
      },
    };
  }

  const developerCredential = resolveDeveloperCredential(provided);
  if (developerCredential) {
    return {
      service: serviceDefinitionFromDeveloperService(developerCredential.service),
      credential: {
        source: 'developer_portal',
        environment: developerCredential.key.environment,
        keyId: developerCredential.key.keyId,
        fingerprint: developerCredential.key.fingerprint,
      },
    };
  }

  for (const service of services) {
    const tokenRef = process.env[service.apiKeyTokenRefEnv]?.trim();
    if (!tokenRef) {
      continue;
    }

    let expected: string;
    try {
      expected = resolveTokenSecret(tokenRef);
    } catch {
      continue;
    }
    if (safeEqual(provided, expected)) {
      return {
        service,
        credential: {
          source: 'service_registry',
          environment: environmentFromServiceKeyPrefix(expected),
          fingerprint: crypto.createHash('sha256').update(expected).digest('hex').slice(0, 24),
        },
      };
    }
  }

  throw new Error('PAY_SERVICE_AUTH_FAILED');
};
