import crypto from 'crypto';

export type RequestAuditContext = {
  requestId: string;
  traceId: string;
  correlationId: string;
  startedAtMs: number;
};

export type SecurityHeaderInput = {
  path: string;
  env?: string;
  secure?: boolean;
};

export type GatewaySecurityDenialClassification = {
  category: string;
  severity: 'warning' | 'error' | 'critical';
  developerSafeReason: string;
};

const gatewaySecurityDenialMap: Record<string, GatewaySecurityDenialClassification> = {
  PAY_GATEWAY_ORIGIN_NOT_ALLOWED: {
    category: 'browser_origin_denied',
    severity: 'warning',
    developerSafeReason: 'Browser origin is not allowlisted for this integration.',
  },
  PAY_GATEWAY_ENVIRONMENT_REQUIRED: {
    category: 'environment_missing',
    severity: 'warning',
    developerSafeReason: 'Runtime environment header is required.',
  },
  PAY_GATEWAY_ENVIRONMENT_INVALID: {
    category: 'environment_invalid',
    severity: 'warning',
    developerSafeReason: 'Runtime environment header is invalid.',
  },
  PAY_GATEWAY_CREDENTIAL_ENVIRONMENT_UNBOUND: {
    category: 'credential_environment_unbound',
    severity: 'error',
    developerSafeReason: 'Credential is not bound to a runtime environment.',
  },
  PAY_GATEWAY_ENVIRONMENT_KEY_MISMATCH: {
    category: 'credential_environment_mismatch',
    severity: 'error',
    developerSafeReason: 'Credential environment does not match the request environment.',
  },
  PAY_GATEWAY_IDEMPOTENCY_KEY_REQUIRED: {
    category: 'idempotency_missing',
    severity: 'warning',
    developerSafeReason: 'Financial mutation requires an idempotency key.',
  },
  PAY_GATEWAY_SIGNATURE_REQUIRED: {
    category: 'signature_missing',
    severity: 'critical',
    developerSafeReason: 'Financial request signature is required.',
  },
  PAY_GATEWAY_SIGNATURE_TIMESTAMP_REQUIRED: {
    category: 'signature_timestamp_missing',
    severity: 'critical',
    developerSafeReason: 'Financial request signature timestamp is required.',
  },
  PAY_GATEWAY_SIGNATURE_TIMESTAMP_INVALID: {
    category: 'signature_timestamp_invalid',
    severity: 'critical',
    developerSafeReason: 'Financial request signature timestamp is invalid.',
  },
  PAY_GATEWAY_SIGNATURE_TIMESTAMP_STALE: {
    category: 'signature_timestamp_stale',
    severity: 'critical',
    developerSafeReason: 'Financial request signature timestamp is outside the allowed window.',
  },
  PAY_GATEWAY_SIGNATURE_NONCE_REQUIRED: {
    category: 'signature_nonce_missing',
    severity: 'critical',
    developerSafeReason: 'Financial request nonce is required.',
  },
  PAY_GATEWAY_SIGNATURE_SECRET_MISSING: {
    category: 'signature_secret_missing',
    severity: 'critical',
    developerSafeReason: 'Financial request credential secret is missing.',
  },
  PAY_GATEWAY_SIGNATURE_INVALID: {
    category: 'signature_invalid',
    severity: 'critical',
    developerSafeReason: 'Financial request signature did not pass verification.',
  },
  PAY_GATEWAY_SIGNATURE_NONCE_REPLAYED: {
    category: 'signature_nonce_replayed',
    severity: 'critical',
    developerSafeReason: 'Financial request nonce was already used.',
  },
  PAY_GATEWAY_RATE_LIMITED: {
    category: 'rate_limited',
    severity: 'warning',
    developerSafeReason: 'Integration exceeded the allowed request rate.',
  },
  DEVELOPER_REDIRECT_URL_NOT_ALLOWED: {
    category: 'redirect_url_denied',
    severity: 'warning',
    developerSafeReason: 'Return URL is not allowlisted for this integration.',
  },
  DEVELOPER_WEBHOOK_URL_NOT_ALLOWED: {
    category: 'webhook_url_denied',
    severity: 'warning',
    developerSafeReason: 'Webhook URL is not allowlisted for this integration.',
  },
  PAY_SERVICE_SCOPE_NOT_GRANTED: {
    category: 'scope_denied',
    severity: 'warning',
    developerSafeReason: 'Integration does not have the required permission.',
  },
};

export const classifyGatewaySecurityDenial = (
  errorCode: string,
): GatewaySecurityDenialClassification | undefined =>
  gatewaySecurityDenialMap[errorCode.trim()];

export const parseOriginAllowlist = (value: string | undefined, defaults: string[] = []): string[] => {
  const configured = String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return Array.from(new Set([...defaults, ...configured]));
};

const normalizeOrigin = (value: string): string => {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
};

export const isOriginAllowed = (origin: string | undefined, allowlist: string[]): boolean => {
  if (!origin) return true;
  const normalizedOrigin = normalizeOrigin(origin);
  return allowlist.some((entry) => {
    const allowed = normalizeOrigin(entry);
    if (allowed === normalizedOrigin) return true;
    if (!allowed.includes('*')) return false;
    const pattern = `^${allowed
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[a-z0-9-]+')}$`;
    return new RegExp(pattern, 'i').test(normalizedOrigin);
  });
};

const privateIpv4Ranges = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
];

const isUnsafeProductionHostname = (hostname: string): boolean => {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (hostname.includes('*')) return true;
  if (hostname === '0.0.0.0' || hostname === '::1' || hostname === '[::1]') return true;
  if (privateIpv4Ranges.some((range) => range.test(hostname))) return true;
  if (!hostname.includes('.')) return true;
  return false;
};

export const isProductionPublicHttpsUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();

    if (url.protocol !== 'https:') return false;
    if (isUnsafeProductionHostname(hostname)) return false;

    return true;
  } catch {
    return false;
  }
};

export const isProductionBrowserOrigin = (origin: string): boolean => {
  if (!isProductionPublicHttpsUrl(origin)) return false;
  const url = new URL(origin);
  return `${url.protocol}//${url.host}` === origin;
};

export const isInternalGatewayPath = (path: string): boolean =>
  /^\/(?:v1|api\/v1)?\/?internal(?:\/|$)/i.test(path) ||
  /^\/v1\/internal(?:\/|$)/i.test(path);

type HeaderGetter = { get: (name: string) => unknown };

export const hasSignedInternalRequestHeaders = (req: HeaderGetter): boolean =>
  Boolean(
    req.get('x-worker-id') &&
    req.get('x-worker-scopes') &&
    req.get('x-worker-request-id') &&
    req.get('x-worker-timestamp') &&
    req.get('x-worker-nonce') &&
    req.get('x-worker-signature'),
  );

const requestHeader = (req: HeaderGetter, name: string): string =>
  String(req.get(name) || '').trim();

export const createRequestAuditContext = (req: HeaderGetter): RequestAuditContext => {
  const requestId = requestHeader(req, 'x-request-id') || crypto.randomUUID();
  return {
    requestId,
    traceId: requestHeader(req, 'x-trace-id') || requestId,
    correlationId: requestHeader(req, 'x-correlation-id') || requestId,
    startedAtMs: Date.now(),
  };
};

const sensitiveRuntimePath = (path: string): boolean =>
  /^\/(?:oauth|v1\/developer|v1\/portal|v1\/payment-intents|v1\/paysafe|v1\/payment-profiles|v1\/transfers)(?:\/|$)/i.test(path);

export const securityHeadersForRequest = (input: SecurityHeaderInput): Record<string, string> => {
  const headers: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-site',
    'permissions-policy': [
      'camera=()',
      'microphone=()',
      'geolocation=()',
      'payment=()',
      'usb=()',
    ].join(', '),
  };

  if (sensitiveRuntimePath(input.path)) {
    headers['cache-control'] = 'no-store, max-age=0';
    headers.pragma = 'no-cache';
  }

  if (input.env === 'production' && input.secure) {
    headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  }

  return headers;
};
