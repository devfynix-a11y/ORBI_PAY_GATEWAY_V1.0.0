import crypto from 'crypto';
import type { ProviderDefinition } from '../types.js';
import { resolveTokenSecret } from './tokenResolver.js';

const normalizeHeaderName = (value: string) => value.toLowerCase();

const stripPrefix = (value: string) => value.replace(/^(sha256|sha512)=/i, '').trim();

export const verifyProviderWebhookSignature = (
  definition: ProviderDefinition,
  headers: Record<string, string | undefined>,
  rawBody?: Buffer,
) => {
  const signatureConfig = definition.webhookSignature;
  if (!signatureConfig) return;
  if (!rawBody?.length) throw new Error('WEBHOOK_RAW_BODY_REQUIRED');

  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [normalizeHeaderName(key), value]),
  );
  const signature = normalizedHeaders[normalizeHeaderName(signatureConfig.signatureHeader)];
  if (!signature) throw new Error('WEBHOOK_SIGNATURE_MISSING');

  const timestampHeader = signatureConfig.timestampHeader
    ? normalizedHeaders[normalizeHeaderName(signatureConfig.timestampHeader)]
    : undefined;

  if (signatureConfig.timestampHeader) {
    if (!timestampHeader) throw new Error('WEBHOOK_TIMESTAMP_MISSING');
    const timestamp = Number(timestampHeader);
    const toleranceMs = (signatureConfig.toleranceSeconds || 300) * 1000;
    if (!Number.isFinite(timestamp)) throw new Error('WEBHOOK_TIMESTAMP_INVALID');
    const timestampMs = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
    if (Math.abs(Date.now() - timestampMs) > toleranceMs) throw new Error('WEBHOOK_TIMESTAMP_STALE');
  }

  const secret = resolveTokenSecret(process.env[definition.webhookSecretTokenRefEnv]);
  const payload = signatureConfig.signedPayloadFormat === 'timestamp.raw' && timestampHeader
    ? Buffer.concat([Buffer.from(`${timestampHeader}.`), rawBody])
    : rawBody;
  const expected = crypto.createHmac(signatureConfig.algorithm, secret).update(payload).digest('hex');
  const provided = stripPrefix(signature);

  const expectedBuffer = Buffer.from(expected, 'hex');
  const providedBuffer = Buffer.from(provided, 'hex');
  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    throw new Error('WEBHOOK_SIGNATURE_INVALID');
  }
};
