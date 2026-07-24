import crypto from 'crypto';
import type { PaymentIntent, PayServiceDefinition } from '../types.js';
import { resolveTokenSecret } from '../security/tokenResolver.js';
import { developerPortalStore } from './developerPortalStore.js';

const stableJson = (value: unknown): string => {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(',')}}`;
};

export type ServiceWebhookDelivery = {
  attempted: boolean;
  delivered: boolean;
  eventId?: string;
  eventType?: string;
  payload?: Record<string, unknown>;
  callbackUrl?: string;
  statusCode?: number;
  error?: string;
};

export const buildServiceWebhookPayload = (intent: PaymentIntent) => ({
  eventId: crypto.randomUUID(),
  eventType: 'payment_intent.updated',
  serviceCode: intent.serviceCode,
  paymentIntent: {
    id: intent.id,
    operation: intent.operation,
    providerCode: intent.providerCode,
    reference: intent.reference,
    amount: intent.amount,
    currency: intent.currency,
    status: intent.status,
    description: intent.description,
    providerReference: intent.providerResponse?.providerReference,
    message: intent.providerResponse?.message,
    coreMessage: intent.coreResult?.message,
    transactionId: intent.coreResult?.transactionId,
    challenge: intent.coreResult?.challenge,
    metadata: intent.metadata,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
  },
});

export const deliverServiceWebhookPayload = async (
  service: PayServiceDefinition,
  payload: {
    eventId: string;
    eventType: string;
    serviceCode: string;
    [key: string]: unknown;
  },
): Promise<ServiceWebhookDelivery> => {
  const isDeveloperPortalService = Boolean(service.metadata?.developerPortalService);
  const developerWebhookUrls = Array.isArray(service.metadata?.webhookUrls)
    ? service.metadata.webhookUrls.filter((url): url is string => typeof url === 'string' && Boolean(url.trim()))
    : [];
  const callbackUrl = isDeveloperPortalService
    ? developerWebhookUrls[0]?.trim()
    : process.env[service.callbackUrlEnv]?.trim();
  if (!callbackUrl) return { attempted: false, delivered: false, error: 'PAY_SERVICE_CALLBACK_URL_MISSING' };

  const tokenRef = service.webhookSecretTokenRefEnv
    ? process.env[service.webhookSecretTokenRefEnv]?.trim()
    : '';
  if (!isDeveloperPortalService && !tokenRef) {
    return { attempted: false, delivered: false, error: 'PAY_SERVICE_WEBHOOK_SECRET_TOKEN_REF_MISSING' };
  }

  const eventId = payload.eventId;
  const eventType = payload.eventType;
  const archivedPayload = payload as Record<string, unknown>;
  const body = stableJson(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const environment = Array.isArray(service.metadata?.environments) && service.metadata.environments.includes('live')
    ? 'live'
    : 'sandbox';
  const secret = isDeveloperPortalService
    ? developerPortalStore.getActiveWebhookSigningSecret(service.code, environment)
    : resolveTokenSecret(tokenRef);
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

  try {
    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orbi-pay-service-code': service.code,
        'x-orbi-pay-event-id': payload.eventId,
        'x-orbi-pay-timestamp': timestamp,
        'x-orbi-pay-signature': `sha256=${signature}`,
      },
      body,
    });

    return {
      attempted: true,
      delivered: response.ok,
      eventId,
      eventType,
      payload: archivedPayload,
      callbackUrl,
      statusCode: response.status,
      error: response.ok ? undefined : `PAY_SERVICE_WEBHOOK_HTTP_${response.status}`,
    };
  } catch (error: any) {
    return {
      attempted: true,
      delivered: false,
      eventId,
      eventType,
      payload: archivedPayload,
      callbackUrl,
      error: error.message || 'PAY_SERVICE_WEBHOOK_DELIVERY_FAILED',
    };
  }
};

export const deliverServiceWebhook = async (
  service: PayServiceDefinition,
  intent: PaymentIntent,
): Promise<ServiceWebhookDelivery> =>
  deliverServiceWebhookPayload(service, buildServiceWebhookPayload(intent));
