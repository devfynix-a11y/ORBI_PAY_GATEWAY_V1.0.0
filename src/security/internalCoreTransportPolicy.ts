export type InternalCoreTransportMode = 'private_http' | 'mtls' | 'public_https';

export type InternalCoreTransportPolicyInput = {
  env: string;
  mode: InternalCoreTransportMode;
  coreBaseUrl: string;
  allowPrivateHttp: boolean;
  workerSigningConfigured: boolean;
  mtlsEnabled: boolean;
  hasCert: boolean;
  hasKey: boolean;
  hasCa: boolean;
  rejectUnauthorized: boolean;
};

const privateHttpHostnames = new Set([
  'core',
  'core-sandbox',
  'localhost',
  '127.0.0.1',
  '::1',
]);

const isPrivateIp = (hostname: string): boolean =>
  /^10\./.test(hostname) ||
  /^192\.168\./.test(hostname) ||
  /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);

const coreUrl = (value: string): URL | undefined => {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
};

export const isPrivateCoreHttpTarget = (coreBaseUrl: string): boolean => {
  const url = coreUrl(coreBaseUrl);
  if (!url || url.protocol !== 'http:') return false;
  const hostname = url.hostname.toLowerCase();
  return privateHttpHostnames.has(hostname) || isPrivateIp(hostname);
};

export const validateInternalCoreTransportPolicy = (input: InternalCoreTransportPolicyInput): string[] => {
  if (input.env !== 'production') return [];

  const errors: string[] = [];
  const url = coreUrl(input.coreBaseUrl);
  if (!url) {
    return ['ORBI_CORE_INTERNAL_BASE_URL must be a valid URL.'];
  }

  if (!input.workerSigningConfigured) {
    errors.push('WORKER_SIGNING_SECRET is required for every production Gateway -> Core transport mode.');
  }

  if (input.mode === 'mtls') {
    if (!input.mtlsEnabled) {
      errors.push('PAYMENT_GATEWAY_INTERNAL_MTLS_ENABLED must be true when PAYMENT_GATEWAY_INTERNAL_CORE_TRANSPORT_MODE=mtls.');
    }
    if (url.protocol !== 'https:') {
      errors.push('ORBI_CORE_INTERNAL_BASE_URL must use https:// when PAYMENT_GATEWAY_INTERNAL_CORE_TRANSPORT_MODE=mtls.');
    }
    if (!input.hasCert || !input.hasKey || !input.hasCa) {
      errors.push('Gateway mTLS cert, key, and CA paths are required when PAYMENT_GATEWAY_INTERNAL_CORE_TRANSPORT_MODE=mtls.');
    }
    if (!input.rejectUnauthorized) {
      errors.push('PAYMENT_GATEWAY_INTERNAL_MTLS_REJECT_UNAUTHORIZED must remain true in production mTLS mode.');
    }
    return errors;
  }

  if (input.mode === 'private_http') {
    if (!input.allowPrivateHttp) {
      errors.push('PAYMENT_GATEWAY_ALLOW_PRIVATE_HTTP_CORE must be true when PAYMENT_GATEWAY_INTERNAL_CORE_TRANSPORT_MODE=private_http.');
    }
    if (!isPrivateCoreHttpTarget(input.coreBaseUrl)) {
      errors.push('private_http Core transport is allowed only for Docker/internal/private HTTP targets such as http://core:3000.');
    }
    return errors;
  }

  if (input.mode === 'public_https' && url.protocol !== 'https:') {
    errors.push('ORBI_CORE_INTERNAL_BASE_URL must use https:// when PAYMENT_GATEWAY_INTERNAL_CORE_TRANSPORT_MODE=public_https.');
  }

  return errors;
};
