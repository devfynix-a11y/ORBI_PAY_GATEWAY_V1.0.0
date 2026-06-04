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

export const __test = { stableSerialize };
