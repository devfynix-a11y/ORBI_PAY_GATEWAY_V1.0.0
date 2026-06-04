import { config } from '../../config.js';
import type {
  GatewayPaymentRequest,
  GatewayPaymentResponse,
  NormalizedProviderEvent,
  PaymentProviderAdapter,
  ProviderHealth,
} from '../../types.js';

export class SelcomAdapter implements PaymentProviderAdapter {
  code = 'selcom';
  displayName = 'Selcom Tanzania';

  async collect(_request: GatewayPaymentRequest): Promise<GatewayPaymentResponse> {
    this.assertConfigured();
    throw new Error('SELCOM_COLLECTION_ADAPTER_PENDING_PROVIDER_CONTRACT');
  }

  async payout(_request: GatewayPaymentRequest): Promise<GatewayPaymentResponse> {
    this.assertConfigured();
    throw new Error('SELCOM_PAYOUT_ADAPTER_PENDING_PROVIDER_CONTRACT');
  }

  async refund(_request: GatewayPaymentRequest): Promise<GatewayPaymentResponse> {
    this.assertConfigured();
    throw new Error('SELCOM_REFUND_ADAPTER_PENDING_PROVIDER_CONTRACT');
  }

  async parseWebhook(payload: unknown): Promise<NormalizedProviderEvent> {
    const event = payload as Record<string, unknown>;
    return {
      providerId: this.code,
      reference: String(event.reference || event.order_id || event.transid || ''),
      status: this.normalizeStatus(event.status || event.resultcode),
      message: String(event.message || event.result || 'Selcom provider callback received.'),
      providerEventId: String(event.event_id || event.transid || event.reference || ''),
      rawStatus: event.status ? String(event.status) : undefined,
      payload: event,
    };
  }

  async health(): Promise<ProviderHealth> {
    const missingEnv = [
      ['SELCOM_API_BASE_URL', config.providers.selcom.baseUrl],
      ['SELCOM_API_KEY', config.providers.selcom.apiKey],
      ['SELCOM_API_SECRET', config.providers.selcom.apiSecret],
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key);
    const configured = missingEnv.length === 0;
    return {
      providerCode: this.code,
      status: configured ? 'DEGRADED' : 'DOWN',
      message: configured
        ? 'Selcom credentials are present; live operation contract still requires final adapter mapping.'
        : 'Selcom credentials are not configured.',
      configured,
      rail: 'MOBILE_MONEY',
      countries: ['TZ'],
      currencies: ['TZS'],
      operations: ['collection', 'payout', 'refund'],
      missingEnv,
      nextAction: configured
        ? 'Complete Selcom live API request signing and callback verification from the official provider contract.'
        : 'Set Selcom credentials in the payment gateway environment, then restart the gateway.',
    };
  }

  private assertConfigured() {
    if (!config.providers.selcom.baseUrl || !config.providers.selcom.apiKey || !config.providers.selcom.apiSecret) {
      throw new Error('SELCOM_PROVIDER_NOT_CONFIGURED');
    }
  }

  private normalizeStatus(value: unknown): NormalizedProviderEvent['status'] {
    const status = String(value || '').toLowerCase();
    if (['000', '0', 'success', 'successful', 'completed', 'paid'].includes(status)) return 'completed';
    if (['failed', 'failure', 'cancelled', 'rejected', 'declined'].includes(status)) return 'failed';
    if (['pending'].includes(status)) return 'pending';
    return 'processing';
  }
}
