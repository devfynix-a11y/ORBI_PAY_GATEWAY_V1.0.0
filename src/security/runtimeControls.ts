import crypto from 'crypto';

export type RequestAuditContext = {
  requestId: string;
  traceId: string;
  correlationId: string;
  startedAtMs: number;
};

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

export const isProductionBrowserOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();

    if (url.protocol !== 'https:') return false;
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false;
    if (hostname.includes('*')) return false;
    if (hostname === '0.0.0.0' || hostname === '::1' || hostname === '[::1]') return false;
    if (privateIpv4Ranges.some((range) => range.test(hostname))) return false;
    if (!hostname.includes('.')) return false;

    return true;
  } catch {
    return false;
  }
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
