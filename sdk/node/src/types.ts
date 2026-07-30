export type OrbiPayGatewayConfig = {
  baseUrl: string;
  serviceKey?: string;
  operatorKey?: string;
  environment?: OrbiRuntimeEnvironment;
  authMode?: 'access_token' | 'api_key';
  accessTokenScopes?: string[];
  accessTokenRefreshSkewSeconds?: number;
  requestSigning?: boolean;
  requestSigningSecret?: string;
  fetchImpl?: typeof fetch;
};

export type OrbiRuntimeEnvironment = 'demo' | 'production' | 'Demo' | 'Production';

export type OrbiRequestOptions = {
  idempotencyKey?: string;
  requestId?: string;
  correlationId?: string;
  traceId?: string;
  environment?: OrbiRuntimeEnvironment;
  headers?: Record<string, string>;
  subject?: {
    id: string;
    type?: 'user' | 'business';
  };
};

export type OrbiApiSuccess<T> = {
  success: true;
  data: T;
};

export type OrbiApiFailure = {
  success: false;
  error: string;
  message: string;
  details: unknown[];
  requestId?: string;
  data?: unknown;
};

export type OrbiApiResponse<T> = OrbiApiSuccess<T> | OrbiApiFailure;

export type OAuthAuthorizationServerMetadata = {
  issuer: string;
  token_endpoint: string;
  introspection_endpoint: string;
  revocation_endpoint: string;
  service_documentation?: string;
  grant_types_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  revocation_endpoint_auth_methods_supported?: string[];
  introspection_endpoint_auth_methods_supported?: string[];
  scopes_supported: string[];
  response_types_supported?: string[];
  code_challenge_methods_supported?: string[];
  token_endpoint_auth_signing_alg_values_supported?: string[];
};

export type OAuthTokenIntrospection = {
  active: boolean;
  iss?: string;
  aud?: string;
  typ?: string;
  sub?: string;
  service_code?: string;
  environment?: string;
  scope?: string;
  key_id?: string;
  iat?: number;
  exp?: number;
  jti?: string;
};

export type OAuthTokenRevocationResult = {
  revoked: boolean;
  serviceCode?: string;
  environment?: string;
  revokedAt?: string;
};

export type PaymentCustomer = {
  type?: 'user' | 'guest' | 'external_customer';
  name?: string;
  email?: string;
  phone?: string;
  userId?: string;
};

export type PaymentIntentCreateRequest = {
  operation?: 'collection' | 'payout' | 'refund';
  paymentCategory?: 'orbi' | 'mobile_money' | 'bank' | 'card';
  paymentRail?: 'orbi_wallet' | 'mno_tz' | 'bank_transfer_tz' | 'card_gateway';
  providerCode?: string;
  reference: string;
  amount: number;
  currency: string;
  description?: string;
  confirm?: boolean;
  customer?: PaymentCustomer;
  walletId?: string;
  accountNumber?: string;
  returnUrl?: string;
  callbackUrl?: string;
  redirectUrl?: string;
  metadata?: Record<string, unknown>;
};

export type PaymentIntent = {
  id: string;
  serviceCode: string;
  operation: 'collection' | 'payout' | 'refund' | 'paysafe';
  paymentCategory?: 'orbi' | 'mobile_money' | 'bank' | 'card';
  paymentRail?: 'orbi_wallet' | 'mno_tz' | 'bank_transfer_tz' | 'card_gateway';
  providerCode?: string;
  reference: string;
  amount: number;
  currency: string;
  status: 'created' | 'processing' | 'requires_action' | 'completed' | 'failed' | 'cancelled';
  description?: string;
  customer?: PaymentCustomer;
  checkoutUrl: string;
  challengeMode?: 'hosted' | 'in_app_required';
  challengeUrl?: string;
  providerReference?: string;
  providerMessage?: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

export type PaymentIntentTerminalStatus = 'completed' | 'failed' | 'cancelled';

export type PaymentIntentNextAction =
  | {
      type: 'redirect_to_hosted_challenge';
      url: string;
      intent: PaymentIntent;
    }
  | {
      type: 'open_in_app_challenge';
      intent: PaymentIntent;
    }
  | {
      type: 'wait_for_webhook';
      intent: PaymentIntent;
    }
  | {
      type: 'complete';
      intent: PaymentIntent & { status: 'completed' };
    }
  | {
      type: 'failed';
      intent: PaymentIntent & { status: 'failed' | 'cancelled' };
    };

export type PaymentIntentWaitOptions = {
  intervalMs?: number;
  timeoutMs?: number;
  terminalStatuses?: PaymentIntentTerminalStatus[];
};

export type PaySafeEscrowCreateRequest = Omit<PaymentIntentCreateRequest, 'operation' | 'customer'> & {
  buyer?: PaymentCustomer;
  seller?: {
    name?: string;
    email?: string;
    phone?: string;
    userId?: string;
    walletId?: string;
  };
};

export type PaySafeActionRequest = {
  reference: string;
  amount?: number;
  currency?: string;
  reason?: string;
  customer?: PaymentCustomer;
  metadata?: Record<string, unknown>;
};

export type IdentityResolveRequest = {
  identifier: string;
  metadata?: Record<string, unknown>;
};

export type BusinessRegistrationRequest = {
  userId?: string;
  email?: string;
  phone?: string;
  requestedRole?: string;
  businessName?: string;
  externalBusinessId?: string;
  note?: string;
  metadata?: Record<string, unknown>;
};

export type PaymentProfileCreateRequest = {
  userId?: string;
  customerId?: string;
  email?: string;
  phone?: string;
  externalCustomerId?: string;
  scopes?: string[];
  consent?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  expiresAt?: string;
};

export type PaymentProfile = {
  paymentProfileId: string;
  serviceCode?: string;
  externalCustomerId?: string;
  customerId?: string;
  status?: 'pending' | 'active' | 'suspended' | 'revoked';
  scopes?: string[];
  consentExpiresAt?: string;
  [key: string]: unknown;
};

export type PaymentProfileLinkRequest = PaymentProfileCreateRequest & {
  externalCustomerId: string;
};

export type OrbiErrorCategory =
  | 'authentication'
  | 'authorization'
  | 'consent'
  | 'validation'
  | 'idempotency'
  | 'not_found'
  | 'conflict'
  | 'challenge'
  | 'webhook'
  | 'service_unavailable'
  | 'unknown';

export type OrbiErrorAction =
  | 'stop'
  | 'retry_same_idempotency_key'
  | 'refresh_and_retry'
  | 'request_scope_or_consent'
  | 'redirect_to_hosted_challenge'
  | 'verify_webhook_configuration'
  | 'contact_orbi_operations'
  | 'show_customer_failure';

export type OrbiErrorInfo = {
  code: string;
  category: OrbiErrorCategory;
  retryable: boolean;
  action: OrbiErrorAction;
  message: string;
};

export type DeveloperEnvironment = 'sandbox' | 'live';

export type DeveloperEnvironmentProfile = {
  environment: DeveloperEnvironment;
  title: string;
  moneyMode: 'simulated' | 'real';
  ledgerMode: 'no_core_ledger_commit' | 'core_ledger_commit_required';
  providerMode: 'simulator' | 'certified_or_live_provider';
  allowedKeyPrefix: string;
  allowedWebhookSecretPrefix: string;
  hostedChallengeMode: 'simulated_approval' | 'real_customer_authorization';
  webhookMode: 'signed_test_events' | 'signed_live_events';
  idempotencyRequired: true;
  recommendedBaseUrl: string;
  safetyRules: string[];
};

export type DeveloperEnvironmentProfilesResult = {
  profiles: DeveloperEnvironmentProfile[];
  separation: {
    summary: string;
    rules: Array<{
      boundary: string;
      sandbox: string;
      live: string;
    }>;
  };
};

export type SandboxSimulatorFlow = {
  environment: 'sandbox';
  title: string;
  warning: string;
  steps: Array<Record<string, unknown>>;
  livePromotionChecklist: string[];
};

export type SandboxAccount = {
  accountId: string;
  displayName: string;
  customerId: string;
  role: 'buyer' | 'seller' | 'member' | 'agent';
  currency: string;
  balance: number;
  status: 'active';
};

export type SandboxTransferRequest = {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  currency: string;
  reference: string;
  description?: string;
};

export type SandboxTransfer = SandboxTransferRequest & {
  transferId: string;
  status: 'completed';
  balanceAfter: {
    from: number;
    to: number;
  };
  createdAt: string;
};

export type SandboxSimulatorState = {
  environment: 'sandbox';
  moneyMode: 'simulated';
  ledgerMode: 'no_core_ledger_commit';
  accounts: SandboxAccount[];
  transfers: SandboxTransfer[];
  totals: Record<string, number>;
};

export type GraphqlMigrationPlan = {
  status: 'contract_preview';
  restPolicy: string;
  endpointPlan: {
    schema: string;
    futureExecution: string;
  };
  safetyGates: string[];
};

export type DeveloperScope = ConsentScope;

export type DeveloperServiceApplicationRequest = {
  externalDeveloperId?: string;
  legalName: string;
  displayName: string;
  contactEmail: string;
  contactPhone?: string;
  businessType: 'merchant' | 'marketplace' | 'organization' | 'saccos' | 'agent_network' | 'platform' | 'internal';
  countryCode: string;
  requestedEnvironments: DeveloperEnvironment[];
  requestedScopes: DeveloperScope[];
  redirectUrls?: string[];
  webhookUrls?: string[];
  useCases: string[];
  supportEmail?: string;
  metadata?: Record<string, unknown>;
  termsAccepted: true;
};

export type DeveloperServiceApplication = DeveloperServiceApplicationRequest & {
  applicationId: string;
  status: 'pending_review' | 'approved' | 'rejected';
  serviceCode?: string;
  submittedAt: string;
  updatedAt: string;
};

export type DeveloperServiceRecord = {
  serviceCode: string;
  displayName: string;
  status: 'draft' | 'pending_review' | 'active' | 'suspended' | 'rejected' | 'archived';
  environments: DeveloperEnvironment[];
  scopesGranted: DeveloperScope[];
  scopesPending: DeveloperScope[];
  redirectUrls: string[];
  webhookUrls: string[];
  keyStatus: 'not_issued' | 'active' | 'rotation_pending' | 'revoked';
  webhookSecretStatus: 'not_issued' | 'active' | 'rotation_pending' | 'revoked';
  keys?: Array<Record<string, unknown>>;
  webhookSecrets?: Array<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

export type DeveloperServiceApprovalRequest = {
  serviceCode?: string;
  initialStatus?: 'draft' | 'active';
};

export type DeveloperScopeRequest = {
  requestedScopes: DeveloperScope[];
  reason: string;
  environment: DeveloperEnvironment;
  metadata?: Record<string, unknown>;
};

export type DeveloperScopeDecisionRequest = {
  decision: 'approve' | 'reject';
  reason: string;
  decidedBy: string;
  metadata?: Record<string, unknown>;
};

export type DeveloperAllowlistUpdateRequest = {
  redirectUrls?: string[];
  webhookUrls?: string[];
  reason: string;
  environment: DeveloperEnvironment;
};

export type DeveloperSecretIssueRequest = {
  environment: DeveloperEnvironment;
  expiresAt?: string;
  requestedBy: string;
  reason: string;
};

export type DeveloperPortalCatalogEntry = {
  id: string;
  title?: string;
  language?: string;
  status?: string;
  endpoint?: string;
  path?: string;
  docsPath?: string;
  description: string;
  [key: string]: unknown;
};

export type ConsentScope =
  | 'identity:resolve'
  | 'payment_profile:create'
  | 'payment_profile:read'
  | 'payments:create'
  | 'escrow:create'
  | 'escrow:read'
  | 'escrow:release:request'
  | 'escrow:refund:request'
  | 'escrow:dispute:create'
  | 'withdrawal:request'
  | 'balance:read'
  | 'webhooks:receive';

export type ConsentScopeCatalogEntry = {
  scope: ConsentScope;
  category: 'identity' | 'profile' | 'payment' | 'escrow' | 'withdrawal' | 'account' | 'webhook';
  riskLevel: 'low' | 'medium' | 'high';
  requiresHostedChallenge: boolean;
  title: {
    en: string;
    sw: string;
  };
  description: {
    en: string;
    sw: string;
  };
};

export type ConsentStatusQuery = {
  serviceCode: string;
  subjectId: string;
  scopes: ConsentScope[];
  environment?: 'sandbox' | 'live';
  renewalWindowDays?: number;
};

export type ConsentStatusResult = {
  status: 'active' | 'expiring_soon' | 'expired' | 'revoked' | 'missing';
  allowed: boolean;
  renewalRequired: boolean;
  renewalReason?: 'CONSENT_EXPIRING_SOON' | 'CONSENT_EXPIRED' | 'CONSENT_REVOKED' | 'CONSENT_MISSING';
  consentId?: string;
  expiresAt?: string;
  scopes: ConsentScope[];
  receipt?: ConsentReceipt;
};

export type ConnectedConsentQuery = {
  status?: 'active' | 'revoked' | 'expired';
  locale?: 'en' | 'sw';
};

export type ConnectedConsentRevocationRequest = {
  reason: string;
  metadata?: Record<string, unknown>;
};

export type ConsentReceiptCreateRequest = {
  serviceCode: string;
  environment: 'sandbox' | 'live';
  subjectType: 'user' | 'business';
  subjectId: string;
  externalSubjectId?: string;
  scopes: ConsentScope[];
  purpose: string;
  expiresAt: string;
  context: {
    locale?: 'en' | 'sw';
    timezone: string;
    ipHash?: string;
    deviceHash?: string;
    userAgentHash?: string;
    countryCode?: string;
    channel: 'hosted_challenge' | 'developer_portal' | 'operator' | 'mobile_app';
  };
  evidence: {
    consentTextVersion: string;
    challengeId?: string;
    challengeType?: 'OTP' | 'PIN' | 'PASSKEY' | 'BIOMETRIC' | 'OIDC' | 'OPERATOR';
    acceptedAt: string;
    evidenceHash: string;
    metadata?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
};

export type ConsentReceipt = ConsentReceiptCreateRequest & {
  consentId: string;
  status: 'active' | 'revoked' | 'expired';
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  revokedBy?: string;
  revocationReason?: string;
};

export type ConsentReceiptQuery = {
  serviceCode?: string;
  subjectId?: string;
  status?: 'active' | 'revoked' | 'expired';
};

export type ConsentReceiptExport = {
  exportId: string;
  generatedAt: string;
  requestedBy?: string;
  filters: ConsentReceiptQuery;
  count: number;
  receipts: ConsentReceipt[];
};

export type ConnectedConsent = ConsentReceipt & {
  scopeSummary: Array<{
    scope: ConsentScope;
    title: string;
    description: string;
    riskLevel: 'low' | 'medium' | 'high';
  }>;
};

export type ConsentRevocationRequest = {
  revokedBy: string;
  reason: string;
  metadata?: Record<string, unknown>;
};

export type WebhookDeliveryRecord = {
  deliveryId: string;
  eventId: string;
  serviceCode: string;
  intentId?: string;
  resourceId?: string;
  eventType: string;
  payload?: Record<string, unknown>;
  callbackUrl?: string;
  status: 'pending' | 'delivered' | 'failed';
  attempt: number;
  statusCode?: number;
  error?: string;
  replayOf?: string;
  replayReason?: string;
  replayRequestedBy?: string;
  replayRequestId?: string;
  replayMetadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type WebhookDeliveryQuery = {
  serviceCode?: string;
  intentId?: string;
  status?: 'pending' | 'delivered' | 'failed';
};

export type WebhookReplayFailedOptions = OrbiRequestOptions & {
  limit?: number;
  reason?: string;
  requestedBy?: string;
  metadata?: Record<string, unknown>;
};

export type WebhookReplayOptions = OrbiRequestOptions & {
  reason?: string;
  requestedBy?: string;
  metadata?: Record<string, unknown>;
};

export type OrbiWebhookEvent =
  | {
      eventId: string;
      eventType: 'payment_intent.updated';
      serviceCode: string;
      paymentIntent: Partial<PaymentIntent> & { id: string };
    }
  | {
      eventId: string;
      eventType: 'consent.revoked';
      serviceCode: string;
      consent: {
        consentId: string;
        serviceCode: string;
        environment: 'sandbox' | 'live';
        subjectType: 'user' | 'business';
        subjectId: string;
        externalSubjectId?: string;
        scopes: ConsentScope[];
        purpose: string;
        status: 'revoked';
        expiresAt: string;
        revokedAt?: string;
        revokedBy?: string;
        revocationReason?: string;
      };
    }
  | {
      eventId: string;
      eventType: string;
      serviceCode: string;
      [key: string]: unknown;
    };

export type WebhookVerificationInput = {
  rawBody: string | Buffer;
  signatureHeader: string;
  timestampHeader: string | number;
  secret: string;
  toleranceSeconds?: number;
  nowSeconds?: number;
};

export type WebhookVerificationResult = {
  ok: boolean;
  reason?: 'missing_signature' | 'missing_timestamp' | 'invalid_timestamp' | 'stale_timestamp' | 'signature_mismatch';
};

export type WebhookParseResult<TEvent extends OrbiWebhookEvent = OrbiWebhookEvent> =
  | {
      ok: true;
      event: TEvent;
    }
  | {
      ok: false;
      reason: WebhookVerificationResult['reason'] | 'invalid_json' | 'invalid_event';
    };

export type OrbiWebhookHandlerMap = {
  'payment_intent.updated'?: (event: Extract<OrbiWebhookEvent, { eventType: 'payment_intent.updated' }>) => void | Promise<void>;
  'consent.revoked'?: (event: Extract<OrbiWebhookEvent, { eventType: 'consent.revoked' }>) => void | Promise<void>;
  fallback?: (event: OrbiWebhookEvent) => void | Promise<void>;
};
