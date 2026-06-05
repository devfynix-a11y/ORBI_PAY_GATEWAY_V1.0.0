import type { PaymentProtocolEngine, ProtocolExecutionInput } from './PaymentProtocolEngine.js';
import { buildIso20022CanonicalPayment } from '../iso20022/Iso20022Messages.js';
import { iso20022PaymentToXml } from '../iso20022/Iso20022Xml.js';
import { resolveTokenSecret } from '../security/tokenResolver.js';

export class Iso20022RestXmlEngine implements PaymentProtocolEngine {
  protocol = 'ISO20022_REST_XML' as const;
  capabilities = {
    executionMode: 'generic-live',
    certificationRequired: false,
    supportsOnlineAuthorization: true,
    supportsWebhookCallbacks: true,
    supportsBatchSettlement: false,
    networkControls: ['HTTPS_TLS', 'ISO20022_XML', 'TOKENIZED_CREDENTIAL_REFERENCE', 'IDEMPOTENCY'],
    settlementModel: 'async-callback',
  } as const;

  async execute(input: ProtocolExecutionInput) {
    const url = new URL(input.endpoint.path, input.credentialBinding.baseUrl.endsWith('/')
      ? input.credentialBinding.baseUrl
      : `${input.credentialBinding.baseUrl}/`);
    const isoPayment = buildIso20022CanonicalPayment(input.provider, input.operation, input.request);
    const body = iso20022PaymentToXml(isoPayment);
    const token = resolveTokenSecret(input.credentialBinding.credentialTokenRef);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.endpoint.timeoutMs || 15000);

    try {
      const response = await fetch(url, {
        method: input.endpoint.method,
        headers: {
          accept: 'application/xml,text/xml,application/json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/xml; charset=utf-8',
          'x-iso20022-message-type': isoPayment.messageType,
          ...(input.endpoint.idempotencyHeader ? { [input.endpoint.idempotencyHeader]: input.request.reference } : {}),
        },
        body: input.endpoint.method === 'GET' ? undefined : body,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`ISO20022_HTTP_${response.status}`);

      return {
        providerCode: input.provider.code,
        reference: input.request.reference,
        providerReference: input.request.reference,
        status: 'processing' as const,
        message: 'ISO 20022 message accepted by clearing network endpoint.',
        raw: {
          iso20022MessageType: isoPayment.messageType,
          response: text.slice(0, 4000),
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
