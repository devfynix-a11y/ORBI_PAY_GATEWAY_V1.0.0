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
import { verifyProviderWebhookSignature } from '../security/webhookSignature.js';
import { protocolEngineRegistry } from '../protocols/ProtocolEngineRegistry.js';

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

  async parseWebhook(
    payload: unknown,
    headers: Record<string, string | undefined>,
    rawBody?: Buffer,
  ): Promise<NormalizedProviderEvent> {
    verifyProviderWebhookSignature(this.definition, headers, rawBody);
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
      ...this.connectionEnvBindings(),
    ]
      .filter((entry): entry is [string, string | undefined] => Boolean(entry[0]) && !entry[1])
      .map(([key]) => key);
    const configured = isProviderCredentialBound(binding);
    const engine = protocolEngineRegistry.get(this.definition.protocol);

    return {
      providerCode: this.code,
      status: configured && engine.capabilities.executionMode !== 'fail-closed' ? 'DEGRADED' : 'DOWN',
      message: configured
        ? `Tokenized provider binding is present; ${this.definition.protocol} protocol engine is selected with ${engine.capabilities.executionMode} execution.`
        : 'Tokenized provider binding is not configured.',
      configured,
      rail: this.definition.rail,
      protocol: this.definition.protocol,
      countries: this.definition.countries,
      currencies: this.definition.currencies,
      operations: this.definition.operations,
      missingEnv,
      protocolCapabilities: engine.capabilities,
      credentialBinding: credentialBindingStatus(binding),
      nextAction: configured && engine.capabilities.executionMode !== 'fail-closed'
        ? 'Complete provider certification, endpoint mapping, webhook verification, and acceptance testing.'
        : configured
          ? 'Install and certify the provider-specific protocol engine before enabling live traffic.'
        : 'Set provider token reference environment variables and restart the gateway.',
    };
  }

  private async execute(operation: PaymentDirection, request: GatewayPaymentRequest): Promise<GatewayPaymentResponse> {
    const credentialBinding = this.credentialBinding();
    assertProviderCredentialBound(credentialBinding);
    if (!this.definition.operations.includes(operation)) {
      throw new Error(`PAYMENT_PROVIDER_OPERATION_UNSUPPORTED:${operation}`);
    }
    const endpoint = this.definition.operationEndpoints?.[operation];
    if (!endpoint) {
      throw new Error(`PAYMENT_PROVIDER_OPERATION_NOT_MAPPED:${operation}`);
    }

    return protocolEngineRegistry.get(this.definition.protocol).execute({
      provider: this.definition,
      operation,
      endpoint,
      request,
      credentialBinding,
    });
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

  private connectionEnvBindings(): Array<[string | undefined, string | undefined]> {
    const connection = this.definition.connection;
    if (!connection) return [];
    return Object.values(connection).map((key) => [key, envValue(key)]);
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
