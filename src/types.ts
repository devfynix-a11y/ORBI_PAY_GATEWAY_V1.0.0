export type PaymentDirection = 'collection' | 'payout' | 'refund';
export type NormalizedProviderStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type PaymentRail = 'MOBILE_MONEY' | 'BANK' | 'CARD_GATEWAY' | 'CRYPTO';
export type PaymentProtocol =
  | 'REST_JSON'
  | 'REST_HMAC'
  | 'ISO8583_TCP_TLS'
  | 'SFTP_SETTLEMENT_FILE'
  | 'SDK_PROVIDER'
  | 'VPN_PRIVATE_API';
export type StrongCustomerAuthStatus = 'not_required' | 'required' | 'challenged' | 'authenticated' | 'failed';

export type StrongCustomerAuthContext = {
  status: StrongCustomerAuthStatus;
  protocol?: '3DS2' | '3DS1' | 'OTP' | 'BIOMETRIC' | 'PASSKEY';
  challengeId?: string;
  authenticationValue?: string;
  eci?: string;
  dsTransactionId?: string;
  liabilityShift?: boolean;
  authenticatedAt?: string;
};

export type GatewayPaymentRequest = {
  providerCode: string;
  reference: string;
  amount: number;
  currency: string;
  phone?: string;
  accountNumber?: string;
  walletId?: string;
  description?: string;
  rail?: PaymentRail;
  sca?: StrongCustomerAuthContext;
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
  rail: PaymentRail;
  protocol: PaymentProtocol;
  countries: string[];
  currencies: string[];
  operations: PaymentDirection[];
  missingEnv: string[];
  nextAction?: string;
  protocolCapabilities?: {
    executionMode: 'generic-live' | 'certified-live' | 'fail-closed';
    certificationRequired: boolean;
    supportsOnlineAuthorization: boolean;
    supportsWebhookCallbacks: boolean;
    supportsBatchSettlement: boolean;
    networkControls: readonly string[];
    settlementModel: 'realtime' | 'async-callback' | 'batch-file' | 'provider-specific';
  };
  credentialBinding?: {
    mode: 'tokenized' | 'direct';
    configured: boolean;
    credentialTokenFingerprint?: string;
    webhookTokenFingerprint?: string;
    threeDsProfileId?: string;
  };
};

export type ProviderOperationDefinition = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  path: string;
  requiresStrongCustomerAuth?: boolean;
  timeoutMs?: number;
  idempotencyHeader?: string;
  responseReferenceFields?: string[];
  responseStatusField?: string;
  responseMessageField?: string;
};

export type ProviderDefinition = {
  code: string;
  displayName: string;
  rail: PaymentRail;
  protocol: PaymentProtocol;
  protocolProfile?: string;
  countries: string[];
  currencies: string[];
  operations: PaymentDirection[];
  baseUrlEnv: string;
  credentialTokenRefEnv: string;
  webhookSecretTokenRefEnv: string;
  threeDsProfileIdEnv?: string;
  directApiKeyEnv?: string;
  directApiSecretEnv?: string;
  connection?: {
    hostEnv?: string;
    portEnv?: string;
    mtlsProfileEnv?: string;
    vpnProfileEnv?: string;
    iso8583ProfileEnv?: string;
    sdkProfileEnv?: string;
    settlementFileProfileEnv?: string;
  };
  operationEndpoints?: Partial<Record<PaymentDirection, ProviderOperationDefinition>>;
  webhookStatusField?: string;
  webhookReferenceFields?: string[];
  webhookEventIdFields?: string[];
  webhookSignature?: {
    algorithm: 'sha256' | 'sha512';
    signatureHeader: string;
    timestampHeader?: string;
    toleranceSeconds?: number;
    signedPayloadFormat?: 'raw' | 'timestamp.raw';
  };
};

export interface PaymentProviderAdapter {
  code: string;
  displayName: string;
  collect(request: GatewayPaymentRequest): Promise<GatewayPaymentResponse>;
  payout(request: GatewayPaymentRequest): Promise<GatewayPaymentResponse>;
  refund(request: GatewayPaymentRequest): Promise<GatewayPaymentResponse>;
  parseWebhook(payload: unknown, headers: Record<string, string | undefined>, rawBody?: Buffer): Promise<NormalizedProviderEvent>;
  health(): Promise<ProviderHealth>;
}
