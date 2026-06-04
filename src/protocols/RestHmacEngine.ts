import crypto from 'crypto';
import type { PaymentProtocolEngine, ProtocolExecutionInput } from './PaymentProtocolEngine.js';
import { buildProviderPayload, responseToGatewayPaymentResponse } from './httpMapping.js';
import { resolveTokenSecret } from '../security/tokenResolver.js';

export class RestHmacEngine implements PaymentProtocolEngine {
  protocol = 'REST_HMAC' as const;
  capabilities = {
    executionMode: 'generic-live',
    certificationRequired: false,
    supportsOnlineAuthorization: true,
    supportsWebhookCallbacks: true,
    supportsBatchSettlement: false,
    networkControls: ['HTTPS_TLS', 'HMAC_REQUEST_SIGNING', 'TOKENIZED_CREDENTIAL_REFERENCE', 'IDEMPOTENCY'],
    settlementModel: 'async-callback',
  } as const;

  async execute(input: ProtocolExecutionInput) {
    const url = new URL(input.endpoint.path, input.credentialBinding.baseUrl.endsWith('/')
      ? input.credentialBinding.baseUrl
      : `${input.credentialBinding.baseUrl}/`);
    const body = JSON.stringify(buildProviderPayload(input.request, input.operation));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const secret = resolveTokenSecret(input.credentialBinding.credentialTokenRef);
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.endpoint.timeoutMs || 15000);

    try {
      const response = await fetch(url, {
        method: input.endpoint.method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-provider-timestamp': timestamp,
          'x-provider-signature': `sha256=${signature}`,
          ...(input.endpoint.idempotencyHeader ? { [input.endpoint.idempotencyHeader]: input.request.reference } : {}),
        },
        body: ['GET'].includes(input.endpoint.method) ? undefined : body,
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
