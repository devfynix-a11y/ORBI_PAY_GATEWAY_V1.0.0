export type PaymentDirection = 'collection' | 'payout' | 'refund';
export type NormalizedProviderStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type GatewayPaymentRequest = {
  providerCode: string;
  reference: string;
  amount: number;
  currency: string;
  phone?: string;
  accountNumber?: string;
  walletId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

export type GatewayPaymentResponse = {
  providerCode: string;
  reference: string;
  providerReference: string;
  status: NormalizedProviderStatus;
  message: string;
  raw?: Record<string, unknown>;
};

export type NormalizedProviderEvent = {
  providerId: string;
  reference: string;
  status: NormalizedProviderStatus;
  message: string;
  providerEventId?: string;
  rawStatus?: string;
  payload?: Record<string, unknown>;
};

export type ProviderHealth = {
  providerCode: string;
  status: 'UP' | 'DOWN' | 'DEGRADED';
  message: string;
  configured: boolean;
  rail: 'MOBILE_MONEY' | 'BANK' | 'CARD_GATEWAY' | 'CRYPTO';
  countries: string[];
  currencies: string[];
  operations: PaymentDirection[];
  missingEnv: string[];
  nextAction?: string;
};

export interface PaymentProviderAdapter {
  code: string;
  displayName: string;
  collect(request: GatewayPaymentRequest): Promise<GatewayPaymentResponse>;
  payout(request: GatewayPaymentRequest): Promise<GatewayPaymentResponse>;
  refund(request: GatewayPaymentRequest): Promise<GatewayPaymentResponse>;
  parseWebhook(payload: unknown, headers: Record<string, string | undefined>): Promise<NormalizedProviderEvent>;
  health(): Promise<ProviderHealth>;
}
