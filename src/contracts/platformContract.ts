import { z } from 'zod';
import type { PaymentIntent } from '../types.js';

export type ApiErrorOptions = {
  message?: string;
  details?: unknown[];
  data?: unknown;
  requestId?: string;
};

export const humanizeErrorCode = (code: string): string =>
  code
    .split(':')[0]
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w|\s\w/g, (match) => match.toUpperCase());

export const errorCodeFromException = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message : String(error || '');
  const code = message.split(':')[0].trim();
  return /^[A-Z0-9_]+$/.test(code) ? code : fallback;
};

export const buildApiErrorBody = (
  error: string,
  options: ApiErrorOptions = {},
) => ({
  success: false,
  error,
  message: options.message || humanizeErrorCode(error),
  details: options.details || [],
  ...(options.data === undefined ? {} : { data: options.data }),
  ...(options.requestId ? { requestId: options.requestId } : {}),
});

export const httpStatusForGatewayError = (error: string, fallback = 502): number => {
  if (
    error.endsWith('_INVALID') ||
    error.endsWith('_REQUIRED') ||
    error.includes('VALIDATION') ||
    error.includes('MISMATCH') ||
    error.includes('UNSUPPORTED') ||
    error.includes('INELIGIBLE') ||
    error.includes('CONFLICT')
  ) {
    return 400;
  }
  if (error.includes('AUTH_FAILED') || error.includes('ACCESS_DENIED') || error.includes('SIGNATURE')) return 403;
  if (error.includes('NOT_FOUND')) return 404;
  if (error.includes('ALREADY_FINALIZED')) return 409;
  return fallback;
};

export const publicPaymentIntentStatus = (status: PaymentIntent['status']) => {
  if (status === 'requires_confirmation') return 'created';
  if (status === 'submitted_to_core' || status === 'pending') return 'processing';
  return status;
};

export const PublicContractStatusSchema = z.enum([
  'created',
  'processing',
  'requires_action',
  'completed',
  'failed',
  'cancelled',
]);

export const ApiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string().min(1),
  message: z.string().min(1),
  details: z.array(z.unknown()),
  data: z.unknown().optional(),
  requestId: z.string().min(1).optional(),
});

export const ApiSuccessResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  });

export const PublicCustomerSchema = z
  .object({
    type: z.enum(['user', 'guest', 'external_customer']).optional(),
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    userId: z.string().optional(),
  })
  .passthrough();

export const PaymentIntentPublicDataSchema = z
  .object({
    id: z.string().min(1),
    serviceCode: z.string().min(1),
    operation: z.enum(['collection', 'payout', 'refund', 'paysafe']),
    paymentCategory: z.enum(['orbi', 'mobile_money', 'bank', 'card']).optional(),
    paymentRail: z.enum(['orbi_wallet', 'mno_tz', 'bank_transfer_tz', 'card_gateway']).optional(),
    providerCode: z.string().optional(),
    reference: z.string().min(1),
    amount: z.number().positive(),
    currency: z.string().min(3),
    status: PublicContractStatusSchema,
    description: z.string().optional(),
    customer: PublicCustomerSchema.optional(),
    checkoutUrl: z.string().min(1),
    challengeMode: z.enum(['hosted', 'in_app_required']).optional(),
    challengeUrl: z.string().url().optional(),
    providerReference: z.string().optional(),
    providerMessage: z.string().optional(),
    webhookDelivery: z
      .object({
        attempted: z.boolean(),
        delivered: z.boolean(),
        statusCode: z.number().int().optional(),
        error: z.string().optional(),
      })
      .passthrough()
      .optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .passthrough();

export const PaymentIntentResponseSchema = ApiSuccessResponseSchema(PaymentIntentPublicDataSchema);

export const HostedChallengeResponseSchema = ApiSuccessResponseSchema(
  PaymentIntentPublicDataSchema.extend({
    status: z.literal('requires_action'),
    challengeMode: z.literal('hosted'),
    challengeUrl: z.string().url(),
  }).passthrough(),
);

export const PaymentProfilePublicDataSchema = z
  .object({
    paymentProfileId: z.string().min(1),
    serviceCode: z.string().min(1).optional(),
    externalCustomerId: z.string().min(1).optional(),
    customerId: z.string().min(1).optional(),
    status: z.enum(['pending', 'active', 'suspended', 'revoked']).optional(),
    scopes: z.array(z.string().min(1)).optional(),
    consentExpiresAt: z.string().min(1).optional(),
  })
  .passthrough();

export const PaymentProfileResponseSchema = ApiSuccessResponseSchema(PaymentProfilePublicDataSchema);

export const PaySafeEscrowIntentResponseSchema = ApiSuccessResponseSchema(
  PaymentIntentPublicDataSchema.extend({
    operation: z.literal('paysafe'),
    paymentCategory: z.literal('orbi'),
    paymentRail: z.literal('orbi_wallet'),
  }).passthrough(),
);

export const WebhookEventPayloadSchema = z
  .object({
    eventId: z.string().min(1),
    eventType: z.string().min(1),
    contractVersion: z.literal('orbi-pay-gateway-contract-v1'),
    serviceCode: z.string().min(1),
    resourceType: z.string().min(1),
    resourceId: z.string().min(1),
    status: z.string().min(1),
    occurredAt: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
  })
  .passthrough();
