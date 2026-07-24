import { verifyOrbiWebhookSignature, type OrbiWebhookEvent } from '../src/index.js';

export const verifyIncomingOrbiWebhook = (input: {
  rawBody: string | Buffer;
  signature: string;
  timestamp: string;
}) => {
  const result = verifyOrbiWebhookSignature({
    rawBody: input.rawBody,
    signatureHeader: input.signature,
    timestampHeader: input.timestamp,
    secret: process.env.ORBI_PAY_WEBHOOK_SECRET || '',
  });

  if (!result.ok) {
    throw new Error(`Invalid ORBI webhook: ${result.reason}`);
  }

  return true;
};

export const handleVerifiedOrbiWebhook = (event: OrbiWebhookEvent) => {
  if (event.eventType === 'payment_intent.updated') {
    return {
      kind: event.eventType,
      paymentIntentId: event.paymentIntent.id,
    };
  }

  if (event.eventType === 'consent.revoked') {
    return {
      kind: event.eventType,
      consentId: event.consent.consentId,
    };
  }

  return {
    kind: event.eventType,
  };
};
