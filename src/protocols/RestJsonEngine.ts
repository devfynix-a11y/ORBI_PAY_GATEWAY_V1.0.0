import type { PaymentProtocolEngine, ProtocolExecutionInput } from './PaymentProtocolEngine.js';
import { buildProviderPayload, responseToGatewayPaymentResponse } from './httpMapping.js';

export class RestJsonEngine implements PaymentProtocolEngine {
  protocol = 'REST_JSON' as const;

  async execute(input: ProtocolExecutionInput) {
    const url = new URL(input.endpoint.path, input.credentialBinding.baseUrl.endsWith('/')
      ? input.credentialBinding.baseUrl
      : `${input.credentialBinding.baseUrl}/`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.endpoint.timeoutMs || 15000);

    try {
      const response = await fetch(url, {
        method: input.endpoint.method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(input.endpoint.idempotencyHeader ? { [input.endpoint.idempotencyHeader]: input.request.reference } : {}),
        },
        body: ['GET'].includes(input.endpoint.method)
          ? undefined
          : JSON.stringify(buildProviderPayload(input.request, input.operation)),
        signal: controller.signal,
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error(`PROVIDER_HTTP_${response.status}`);
      }
      return responseToGatewayPaymentResponse(input.provider.code, input.request, input.endpoint, payload);
    } finally {
      clearTimeout(timeout);
    }
  }
}
