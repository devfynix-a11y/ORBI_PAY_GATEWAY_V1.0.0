import type {
  GatewayPaymentRequest,
  GatewayPaymentResponse,
  NormalizedProviderStatus,
  ProviderOperationDefinition,
} from '../types.js';

export const buildProviderPayload = (request: GatewayPaymentRequest, operation: string) => ({
  reference: request.reference,
  amount: request.amount,
  currency: request.currency,
  phone: request.phone,
  accountNumber: request.accountNumber,
  walletId: request.walletId,
  description: request.description,
  rail: request.rail,
  operation,
  metadata: request.metadata || {},
});

const firstField = (source: Record<string, unknown>, fields: string[], fallback = '') => {
  for (const field of fields) {
    const value = source[field];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return fallback;
};

export const normalizeProviderStatus = (value: unknown): NormalizedProviderStatus => {
  const status = String(value || '').toLowerCase();
  if (['000', '0', 'success', 'successful', 'completed', 'paid', 'approved'].includes(status)) return 'completed';
  if (['failed', 'failure', 'cancelled', 'rejected', 'declined', 'error'].includes(status)) return 'failed';
  if (['pending', 'queued', 'accepted'].includes(status)) return 'pending';
  return 'processing';
};

export const responseToGatewayPaymentResponse = (
  providerCode: string,
  request: GatewayPaymentRequest,
  endpoint: ProviderOperationDefinition,
  payload: Record<string, unknown>,
): GatewayPaymentResponse => {
  const rawStatus = endpoint.responseStatusField ? payload[endpoint.responseStatusField] : payload.status || payload.resultcode || payload.code;
  return {
    providerCode,
    reference: request.reference,
    providerReference: firstField(payload, endpoint.responseReferenceFields || ['providerReference', 'transactionId', 'transid', 'reference'], request.reference),
    status: normalizeProviderStatus(rawStatus),
    message: firstField(payload, endpoint.responseMessageField ? [endpoint.responseMessageField] : ['message', 'result', 'description'], 'Provider response received.'),
    raw: payload,
  };
};
