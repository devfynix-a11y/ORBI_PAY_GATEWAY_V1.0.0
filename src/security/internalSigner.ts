import crypto from 'crypto';

const stableSerialize = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`).join(',')}}`;
};

export const hashInternalRequestBody = (body: unknown): string =>
  crypto.createHash('sha256').update(stableSerialize(body)).digest('hex');

export type SignedInternalHeadersInput = {
  method: string;
  path: string;
  body: unknown;
  workerId: string;
  scopes: string[];
  signingSecret: string;
  keyId?: string;
};

export type VerifySignedInternalHeadersInput = SignedInternalHeadersInput & {
  headers: Record<string, string | string[] | undefined>;
  requiredScope?: string;
  toleranceSeconds?: number;
};

export const buildSignedInternalHeaders = (input: SignedInternalHeadersInput): Record<string, string> => {
  if (!input.signingSecret) {
    throw new Error('WORKER_SIGNING_SECRET_REQUIRED');
  }

  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const bodySha256 = hashInternalRequestBody(input.body);
  const canonicalPayload = [
    input.method.toUpperCase(),
    input.path,
    input.workerId,
    input.scopes.join(','),
    timestamp,
    nonce,
    requestId,
    bodySha256,
  ].join('\n');
  const signature = crypto.createHmac('sha256', input.signingSecret).update(canonicalPayload).digest('hex');

  return {
    'content-type': 'application/json',
    'x-worker-id': input.workerId,
    'x-worker-scopes': input.scopes.join(','),
    'x-worker-request-id': requestId,
    'x-worker-timestamp': timestamp,
    'x-worker-nonce': nonce,
    'x-worker-signature': signature,
    ...(input.keyId ? { 'x-worker-key-id': input.keyId } : {}),
  };
};

const headerValue = (headers: Record<string, string | string[] | undefined>, key: string): string => {
  const value = headers[key] || headers[key.toLowerCase()];
  return Array.isArray(value) ? value.join(',') : String(value || '');
};

export const verifySignedInternalHeaders = (input: VerifySignedInternalHeadersInput): void => {
  if (!input.signingSecret) throw new Error('WORKER_SIGNING_SECRET_REQUIRED');

  const workerId = headerValue(input.headers, 'x-worker-id');
  const scopes = headerValue(input.headers, 'x-worker-scopes');
  const timestamp = headerValue(input.headers, 'x-worker-timestamp');
  const nonce = headerValue(input.headers, 'x-worker-nonce');
  const requestId = headerValue(input.headers, 'x-worker-request-id');
  const signature = headerValue(input.headers, 'x-worker-signature');
  if (!workerId || !scopes || !timestamp || !nonce || !requestId || !signature) {
    throw new Error('INTERNAL_SIGNATURE_HEADERS_MISSING');
  }

  if (input.requiredScope && !scopes.split(',').map((scope) => scope.trim()).includes(input.requiredScope)) {
    throw new Error('INTERNAL_SIGNATURE_SCOPE_MISSING');
  }

  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) throw new Error('INTERNAL_SIGNATURE_TIMESTAMP_INVALID');
  const toleranceMs = (input.toleranceSeconds || 300) * 1000;
  if (Math.abs(Date.now() - timestampMs) > toleranceMs) {
    throw new Error('INTERNAL_SIGNATURE_TIMESTAMP_STALE');
  }

  const bodySha256 = hashInternalRequestBody(input.body);
  const canonicalPayload = [
    input.method.toUpperCase(),
    input.path,
    workerId,
    scopes,
    timestamp,
    nonce,
    requestId,
    bodySha256,
  ].join('\n');
  const expected = crypto.createHmac('sha256', input.signingSecret).update(canonicalPayload).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const providedBuffer = Buffer.from(signature, 'hex');
  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    throw new Error('INTERNAL_SIGNATURE_INVALID');
  }
};

export const __test = { stableSerialize };
