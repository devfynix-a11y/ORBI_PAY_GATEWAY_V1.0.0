import type { PaymentProtocolEngine, ProtocolExecutionInput } from './PaymentProtocolEngine.js';
import { responseToGatewayPaymentResponse } from './httpMapping.js';
import { buildIso20022CanonicalPayment, iso20022PaymentToJson } from '../iso20022/Iso20022Messages.js';
import { resolveTokenSecret } from '../security/tokenResolver.js';

export class Iso20022RestJsonEngine implements PaymentProtocolEngine {
  protocol = 'ISO20022_REST_JSON' as const;
  capabilities = {
    executionMode: 'generic-live',
    certificationRequired: false,
    supportsOnlineAuthorization: true,
    supportsWebhookCallbacks: true,
    supportsBatchSettlement: false,
    networkControls: ['HTTPS_TLS', 'ISO20022_JSON', 'TOKENIZED_CREDENTIAL_REFERENCE', 'IDEMPOTENCY'],
    settlementModel: 'async-callback',
  } as const;

  async execute(input: ProtocolExecutionInput) {
    const url = new URL(input.endpoint.path, input.credentialBinding.baseUrl.endsWith('/')
      ? input.credentialBinding.baseUrl
      : `${input.credentialBinding.baseUrl}/`);
    const isoPayment = buildIso20022CanonicalPayment(input.provider, input.operation, input.request);
    const body = JSON.stringify(iso20022PaymentToJson(isoPayment));
    const token = resolveTokenSecret(input.credentialBinding.credentialTokenRef);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.endpoint.timeoutMs || 15000);

    try {
      const response = await fetch(url, {
        method: input.endpoint.method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-iso20022-message-type': isoPayment.messageType,
          ...(input.endpoint.idempotencyHeader ? { [input.endpoint.idempotencyHeader]: input.request.reference } : {}),
        },
        body: input.endpoint.method === 'GET' ? undefined : body,
        signal: controller.signal,
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(`ISO20022_HTTP_${response.status}`);
      return responseToGatewayPaymentResponse(input.provider.code, input.request, input.endpoint, payload);
    } finally {
      clearTimeout(timeout);
    }
  }
}
