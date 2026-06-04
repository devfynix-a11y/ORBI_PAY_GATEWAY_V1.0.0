import { config } from '../../config.js';
import type {
  GatewayPaymentRequest,
  GatewayPaymentResponse,
  NormalizedProviderEvent,
  PaymentProviderAdapter,
  ProviderHealth,
} from '../../types.js';

export class MpesaTanzaniaAdapter implements PaymentProviderAdapter {
  code = 'mpesa-tanzania';
  displayName = 'M-Pesa Tanzania';

  async collect(_request: GatewayPaymentRequest): Promise<GatewayPaymentResponse> {
    this.assertConfigured();
    throw new Error('MPESA_TZ_COLLECTION_ADAPTER_PENDING_PROVIDER_CONTRACT');
  }

  async payout(_request: GatewayPaymentRequest): Promise<GatewayPaymentResponse> {
    this.assertConfigured();
    throw new Error('MPESA_TZ_PAYOUT_ADAPTER_PENDING_PROVIDER_CONTRACT');
  }

  async refund(_request: GatewayPaymentRequest): Promise<GatewayPaymentResponse> {
    this.assertConfigured();
    throw new Error('MPESA_TZ_REFUND_ADAPTER_PENDING_PROVIDER_CONTRACT');
  }

  async parseWebhook(payload: unknown): Promise<NormalizedProviderEvent> {
    const event = payload as Record<string, unknown>;
    return {
      providerId: this.code,
      reference: String(event.reference || event.ConversationID || event.OriginatorConversationID || ''),
      status: this.normalizeStatus(event.ResultCode || event.status),
      message: String(event.ResultDesc || event.message || 'M-Pesa Tanzania provider callback received.'),
      providerEventId: String(event.TransactionID || event.ConversationID || event.reference || ''),
      rawStatus: event.ResultCode ? String(event.ResultCode) : undefined,
      payload: event,
    };
  }

  async health(): Promise<ProviderHealth> {
    const missingEnv = [
      ['MPESA_TZ_API_BASE_URL', config.providers.mpesaTanzania.baseUrl],
      ['MPESA_TZ_API_KEY', config.providers.mpesaTanzania.apiKey],
      ['MPESA_TZ_API_SECRET', config.providers.mpesaTanzania.apiSecret],
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key);
    const configured = missingEnv.length === 0;
    return {
      providerCode: this.code,
      status: configured ? 'DEGRADED' : 'DOWN',
      message: configured
        ? 'M-Pesa credentials are present; live operation contract still requires final adapter mapping.'
        : 'M-Pesa Tanzania credentials are not configured.',
      configured,
      rail: 'MOBILE_MONEY',
      countries: ['TZ'],
      currencies: ['TZS'],
      operations: ['collection', 'payout', 'refund'],
      missingEnv,
      nextAction: configured
        ? 'Complete M-Pesa Tanzania live API request signing and callback verification from the official provider contract.'
        : 'Set M-Pesa Tanzania credentials in the payment gateway environment, then restart the gateway.',
    };
  }

  private assertConfigured() {
    if (
      !config.providers.mpesaTanzania.baseUrl ||
      !config.providers.mpesaTanzania.apiKey ||
      !config.providers.mpesaTanzania.apiSecret
    ) {
      throw new Error('MPESA_TZ_PROVIDER_NOT_CONFIGURED');
    }
  }

  private normalizeStatus(value: unknown): NormalizedProviderEvent['status'] {
    const status = String(value || '').toLowerCase();
    if (['0', 'success', 'successful', 'completed', 'paid'].includes(status)) return 'completed';
    if (['failed', 'failure', 'cancelled', 'rejected', 'declined'].includes(status)) return 'failed';
    if (['pending'].includes(status)) return 'pending';
    return 'processing';
  }
}
