import crypto from 'crypto';
import type {
  OrbiWebhookEvent,
  OrbiWebhookHandlerMap,
  WebhookParseResult,
  WebhookVerificationInput,
  WebhookVerificationResult,
} from './types.js';

const timingSafeEqualHex = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const verifyOrbiWebhookSignature = (input: WebhookVerificationInput): WebhookVerificationResult => {
  if (!input.signatureHeader) return { ok: false, reason: 'missing_signature' };
  if (input.timestampHeader === undefined || input.timestampHeader === null || input.timestampHeader === '') {
    return { ok: false, reason: 'missing_timestamp' };
  }

  const timestamp = Number(input.timestampHeader);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: 'invalid_timestamp' };

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? 300;
  if (Math.abs(now - timestamp) > tolerance) return { ok: false, reason: 'stale_timestamp' };

  const signature = input.signatureHeader.replace(/^sha256=/i, '').trim();
  if (!/^[a-f0-9]{64}$/i.test(signature)) return { ok: false, reason: 'signature_mismatch' };

  const rawBody = Buffer.isBuffer(input.rawBody) ? input.rawBody.toString('utf8') : input.rawBody;
  const expected = crypto
    .createHmac('sha256', input.secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  return timingSafeEqualHex(signature, expected)
    ? { ok: true }
    : { ok: false, reason: 'signature_mismatch' };
};

export const verifyAndParseOrbiWebhook = <TEvent extends OrbiWebhookEvent = OrbiWebhookEvent>(
  input: WebhookVerificationInput,
): WebhookParseResult<TEvent> => {
  const verified = verifyOrbiWebhookSignature(input);
  if (!verified.ok) return { ok: false, reason: verified.reason || 'signature_mismatch' };

  const rawBody = Buffer.isBuffer(input.rawBody) ? input.rawBody.toString('utf8') : input.rawBody;
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  if (!isValidWebhookEvent(event)) return { ok: false, reason: 'invalid_event' };
  return { ok: true, event: event as TEvent };
};

export const isOrbiWebhookEventType = <TType extends OrbiWebhookEvent['eventType']>(
  event: OrbiWebhookEvent,
  eventType: TType,
): event is Extract<OrbiWebhookEvent, { eventType: TType }> => event.eventType === eventType;

export const handleOrbiWebhookEvent = async (
  event: OrbiWebhookEvent,
  handlers: OrbiWebhookHandlerMap,
) => {
  if (isOrbiWebhookEventType(event, 'payment_intent.updated') && handlers['payment_intent.updated']) {
    await handlers['payment_intent.updated'](event);
    return;
  }
  if (isOrbiWebhookEventType(event, 'consent.revoked') && handlers['consent.revoked']) {
    await handlers['consent.revoked'](event);
    return;
  }
  if (handlers.fallback) await handlers.fallback(event);
};

const isValidWebhookEvent = (value: unknown): value is OrbiWebhookEvent => {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return typeof event.eventId === 'string'
    && typeof event.eventType === 'string'
    && typeof event.serviceCode === 'string';
};
