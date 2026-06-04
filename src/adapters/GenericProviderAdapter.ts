import type {
  GatewayPaymentRequest,
  GatewayPaymentResponse,
  NormalizedProviderEvent,
  PaymentDirection,
  PaymentProviderAdapter,
  ProviderDefinition,
  ProviderHealth,
} from '../types.js';
import {
  assertProviderCredentialBound,
  credentialBindingStatus,
  isProviderCredentialBound,
  type ProviderCredentialBinding,
} from '../security/providerCredentialVault.js';
import { config } from '../config.js';

const envValue = (key?: string) => (key ? process.env[key]?.trim() || '' : '');

export class GenericProviderAdapter implements PaymentProviderAdapter {
  code: string;
  displayName: string;

  constructor(private readonly definition: ProviderDefinition) {
    this.code = definition.code;
    this.displayName = definition.displayName;
  }

  collect(request: GatewayPaymentRequest): Promise<GatewayPaymentResponse> {
    return this.execute('collection', request);
  }

  payout(request: GatewayPaymentRequest): Promise<GatewayPaymentResponse> {
    return this.execute('payout', request);
  }

  refund(request: GatewayPaymentRequest): Promise<GatewayPaymentResponse> {
    return this.execute('refund', request);
  }

  async parseWebhook(payload: unknown): Promise<NormalizedProviderEvent> {
    const event = payload as Record<string, unknown>;
    const reference = this.firstField(event, this.definition.webhookReferenceFields || ['reference', 'order_id', 'transid', 'ConversationID']);
    const providerEventId = this.firstField(event, this.definition.webhookEventIdFields || ['event_id', 'transid', 'TransactionID', 'reference']);
    const rawStatus = String(event[this.definition.webhookStatusField || 'status'] || event.resultcode || event.ResultCode || '');

    return {
      providerId: this.code,
      reference,
      status: this.normalizeStatus(rawStatus),
      message: String(event.message || event.result || event.ResultDesc || 'Provider callback received.'),
      providerEventId,
      rawStatus: rawStatus || undefined,
      payload: event,
    };
  }

  async health(): Promise<ProviderHealth> {
    const binding = this.credentialBinding();
    const missingEnv = [
      [this.definition.baseUrlEnv, binding.baseUrl],
      [this.definition.credentialTokenRefEnv, binding.credentialTokenRef],
      [this.definition.webhookSecretTokenRefEnv, binding.webhookSecretTokenRef],
    ]
      .filter((entry): entry is [string, string | undefined] => Boolean(entry[0]) && !entry[1])
      .map(([key]) => key);
    const configured = isProviderCredentialBound(binding);

    return {
      providerCode: this.code,
      status: configured ? 'DEGRADED' : 'DOWN',
      message: configured
        ? 'Tokenized provider binding is present; operation executor still requires provider contract mapping.'
        : 'Tokenized provider binding is not configured.',
      configured,
      rail: this.definition.rail,
      countries: this.definition.countries,
      currencies: this.definition.currencies,
      operations: this.definition.operations,
      missingEnv,
      credentialBinding: credentialBindingStatus(binding),
      nextAction: configured
        ? 'Complete provider-specific request signing, endpoint mapping, and webhook verification.'
        : 'Set provider token reference environment variables and restart the gateway.',
    };
  }

  private async execute(operation: PaymentDirection, _request: GatewayPaymentRequest): Promise<GatewayPaymentResponse> {
    assertProviderCredentialBound(this.credentialBinding());
    if (!this.definition.operations.includes(operation)) {
      throw new Error(`PAYMENT_PROVIDER_OPERATION_UNSUPPORTED:${operation}`);
    }
    if (!this.definition.operationEndpoints?.[operation]) {
      throw new Error(`PAYMENT_PROVIDER_OPERATION_NOT_MAPPED:${operation}`);
    }

    throw new Error(`PAYMENT_PROVIDER_EXECUTOR_NOT_IMPLEMENTED:${this.code}:${operation}`);
  }

  private credentialBinding(): ProviderCredentialBinding {
    return {
      providerCode: this.code,
      mode: config.security.credentialMode,
      baseUrl: envValue(this.definition.baseUrlEnv),
      credentialTokenRef: envValue(this.definition.credentialTokenRefEnv),
      webhookSecretTokenRef: envValue(this.definition.webhookSecretTokenRefEnv),
      threeDsProfileId: envValue(this.definition.threeDsProfileIdEnv),
      directApiKey: envValue(this.definition.directApiKeyEnv),
      directApiSecret: envValue(this.definition.directApiSecretEnv),
    };
  }

  private firstField(event: Record<string, unknown>, fields: string[]) {
    for (const field of fields) {
      const value = event[field];
      if (value !== undefined && value !== null && String(value).trim()) return String(value);
    }
    return '';
  }

  private normalizeStatus(value: unknown): NormalizedProviderEvent['status'] {
    const status = String(value || '').toLowerCase();
    if (['000', '0', 'success', 'successful', 'completed', 'paid'].includes(status)) return 'completed';
    if (['failed', 'failure', 'cancelled', 'rejected', 'declined'].includes(status)) return 'failed';
    if (['pending'].includes(status)) return 'pending';
    return 'processing';
  }
}
