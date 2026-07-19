export type PaymentDirection = 'collection' | 'payout' | 'refund';
export type NormalizedProviderStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type PaymentRail = 'MOBILE_MONEY' | 'BANK' | 'CARD_GATEWAY' | 'CRYPTO';
export type PaymentProtocol =
  | 'REST_JSON'
  | 'REST_HMAC'
  | 'ISO20022_REST_JSON'
  | 'ISO20022_REST_XML'
  | 'ISO20022_MTLS'
  | 'ISO8583_TCP_TLS'
  | 'SFTP_SETTLEMENT_FILE'
  | 'SDK_PROVIDER'
  | 'VPN_PRIVATE_API';
export type ProviderCredentialScheme = 'BEARER_TOKEN' | 'HMAC_SHARED_SECRET' | 'OBP_CONSUMER' | 'NONE';
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

export type DiscoveredPaymentCapability = {
  sourceProviderCode: string;
  source: 'OBP_TRANSACTION_REQUEST_TYPE' | 'OBP_DYNAMIC_ENTITY' | 'OBP_BANK' | 'MANIFEST';
  capabilityCode: string;
  displayName: string;
  rail: PaymentRail;
  countryCode: string;
  currency: string;
  operations: PaymentDirection[];
  operationCodes: string[];
  status: 'DISCOVERED' | 'REQUIRES_REVIEW';
  priority: number;
  requires: Record<string, unknown>;
  sourceReference?: string;
  raw?: Record<string, unknown>;
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
  credentialScheme?: ProviderCredentialScheme;
  credentialMetadataEnv?: string;
  connection?: {
    hostEnv?: string;
    portEnv?: string;
    mtlsProfileEnv?: string;
    vpnProfileEnv?: string;
    iso8583ProfileEnv?: string;
    iso20022ProfileEnv?: string;
    clearingNetworkProfileEnv?: string;
    participantIdEnv?: string;
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

export type PayServiceOperation = 'collection' | 'payout' | 'refund' | 'paysafe';
export type PaymentCategory = 'orbi' | 'mobile_money' | 'bank' | 'card';
export type MerchantPaymentRail = 'orbi_wallet' | 'mno_tz' | 'bank_transfer_tz' | 'card_gateway';

export type PayServiceDefinition = {
  code: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  apiKeyTokenRefEnv: string;
  webhookSecretTokenRefEnv: string;
  callbackUrlEnv: string;
  allowedOperations: PayServiceOperation[];
  allowedCurrencies: string[];
  allowedCountries?: string[];
  merchant?: {
    merchantIdEnv?: string;
    feeProfileCode?: string;
    feeFlowCode?: string;
    requireActiveMerchant?: boolean;
  };
  metadata?: Record<string, unknown>;
};

export type PaymentIntentStatus =
  | 'requires_confirmation'
  | 'requires_action'
  | 'submitted_to_core'
  | 'processing'
  | 'pending'
  | 'completed'
  | 'failed';

export type PaymentChallenge = {
  type: 'OTP' | 'PIN' | 'PASSKEY' | 'BIOMETRIC' | '3DS';
  challengeId: string;
  prompt: string;
  expiresAt?: string;
  delivery?: {
    channel?: 'sms' | 'email' | 'push' | 'in_app';
    destinationHint?: string;
  };
  metadata?: Record<string, unknown>;
};

export type PaymentIntent = {
  id: string;
  serviceCode: string;
  operation: PayServiceOperation;
  paymentCategory?: PaymentCategory;
  paymentRail?: MerchantPaymentRail;
  providerCode?: string;
  reference: string;
  amount: number;
  currency: string;
  status: PaymentIntentStatus;
  description?: string;
  customer?: {
    type?: 'user' | 'guest' | 'external_customer';
    name?: string;
    email?: string;
    phone?: string;
    userId?: string;
  };
  walletId?: string;
  accountNumber?: string;
  metadata: Record<string, unknown>;
  checkoutUrl: string;
  providerResponse?: GatewayPaymentResponse;
  coreSubmission?: {
    submitted: boolean;
    response?: unknown;
    error?: string;
  };
  coreResult?: {
    status: PaymentIntentStatus;
    message?: string;
    transactionId?: string;
    challenge?: PaymentChallenge;
    raw?: Record<string, unknown>;
  };
  webhookDelivery?: {
    attempted: boolean;
    delivered: boolean;
    statusCode?: number;
    error?: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type ServicePaymentRequest = {
  intentId: string;
  serviceCode: string;
  operation: PayServiceOperation;
  paymentCategory?: PaymentCategory;
  paymentRail?: MerchantPaymentRail;
  providerCode?: string;
  reference: string;
  amount: number;
  currency: string;
  description?: string;
  customer?: PaymentIntent['customer'];
  walletId?: string;
  accountNumber?: string;
  metadata: Record<string, unknown>;
  checkoutUrl: string;
  createdAt: string;
};

export type ServicePaymentChallengeResponseRequest = {
  challengeId: string;
  decision: 'approve' | 'reject';
  idempotencyKey: string;
  otcRequestId?: string;
  otcCode?: string;
  metadata?: Record<string, unknown>;
};

export type ServicePaymentCoreEvent = {
  intentId: string;
  serviceCode: string;
  status: PaymentIntentStatus;
  message?: string;
  transactionId?: string;
  challenge?: PaymentChallenge;
  raw?: Record<string, unknown>;
};

export type ServicePaySafeBalanceRequest = {
  serviceCode: string;
  merchantId?: string;
  userId?: string;
  customerId?: string;
  email?: string;
  phone?: string;
  includeHistory?: boolean;
  metadata?: Record<string, unknown>;
};

export type ServiceIdentityResolveRequest = {
  serviceCode: string;
  identifier: string;
  metadata?: Record<string, unknown>;
};

export type ServiceIdentityResolveResponse = {
  success: boolean;
  data?: {
    id: string;
    customerId?: string | null;
    displayName?: string | null;
    emailHint?: string | null;
    phoneHint?: string | null;
    activeForPayments?: boolean;
  };
  error?: string;
};

export type ServicePaySafeBalanceResponse = {
  serviceCode: string;
  user: {
    id: string;
    displayName?: string;
    email?: string;
    phone?: string;
    accountStatus?: string;
  };
  totals: Array<{
    currency: string;
    incomingHeld: number;
    outgoingHeld: number;
    incomingDisputed: number;
    outgoingDisputed: number;
    releasedIncoming: number;
    refundedOutgoing: number;
    totalIncomingProtected: number;
    totalOutgoingProtected: number;
  }>;
  escrows: Array<{
    escrowId: string;
    transactionId?: string;
    direction: 'incoming' | 'outgoing';
    amount: number;
    currency: string;
    status: 'HELD' | 'RELEASED' | 'DISPUTED' | 'REFUNDED' | string;
    reference?: string;
    conditions?: Record<string, unknown>;
    disputeMetadata?: Record<string, unknown>;
    createdAt?: string;
    updatedAt?: string;
    expiresAt?: string;
  }>;
};

export type ServiceMerchantOrderPaymentStatusRequest = {
  serviceCode: string;
  merchantId: string;
  orderId: string;
  metadata?: Record<string, unknown>;
};

export type ServiceMerchantSettlementsRequest = {
  serviceCode: string;
  merchantId: string;
  currency?: string;
  status?: string;
  limit?: number;
  offset?: number;
  metadata?: Record<string, unknown>;
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
