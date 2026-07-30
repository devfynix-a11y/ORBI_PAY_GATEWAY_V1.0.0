import crypto from 'node:crypto';
import type {
  BusinessRegistrationRequest,
  ConnectedConsent,
  ConnectedConsentQuery,
  ConnectedConsentRevocationRequest,
  ConsentReceipt,
  ConsentReceiptCreateRequest,
  ConsentReceiptExport,
  ConsentReceiptQuery,
  ConsentRevocationRequest,
  ConsentScopeCatalogEntry,
  ConsentStatusQuery,
  ConsentStatusResult,
  DeveloperAllowlistUpdateRequest,
  DeveloperEnvironment,
  DeveloperEnvironmentProfile,
  DeveloperEnvironmentProfilesResult,
  DeveloperPortalCatalogEntry,
  DeveloperScopeDecisionRequest,
  DeveloperScopeRequest,
  DeveloperSecretIssueRequest,
  DeveloperServiceApplication,
  DeveloperServiceApplicationRequest,
  DeveloperServiceApprovalRequest,
  DeveloperServiceRecord,
  IdentityResolveRequest,
  OrbiApiResponse,
  OAuthAuthorizationServerMetadata,
  OAuthTokenIntrospection,
  OAuthTokenRevocationResult,
  OrbiPayGatewayConfig,
  OrbiRequestOptions,
  OrbiRuntimeEnvironment,
  PaySafeActionRequest,
  PaySafeEscrowCreateRequest,
  PaymentIntent,
  PaymentIntentCreateRequest,
  PaymentIntentNextAction,
  PaymentIntentTerminalStatus,
  PaymentIntentWaitOptions,
  PaymentProfile,
  PaymentProfileCreateRequest,
  PaymentProfileLinkRequest,
  OrbiWebhookEvent,
  SandboxAccount,
  SandboxSimulatorFlow,
  SandboxSimulatorState,
  SandboxTransfer,
  SandboxTransferRequest,
  WebhookDeliveryQuery,
  WebhookDeliveryRecord,
  WebhookReplayFailedOptions,
  WebhookReplayOptions,
} from './types.js';

export class OrbiPayGatewayError extends Error {
  readonly status: number;
  readonly response: unknown;

  constructor(message: string, status: number, response: unknown) {
    super(message);
    this.name = 'OrbiPayGatewayError';
    this.status = status;
    this.response = response;
  }
}

export class OrbiPayGatewayClient {
  private readonly baseUrl: string;
  private readonly serviceKey: string;
  private readonly operatorKey?: string;
  private readonly environment?: OrbiRuntimeEnvironment;
  private readonly authMode: 'access_token' | 'api_key';
  private readonly accessTokenScopes: string[];
  private readonly accessTokenRefreshSkewSeconds: number;
  private readonly requestSigning: boolean;
  private readonly requestSigningSecret?: string;
  private readonly fetchImpl: typeof fetch;
  private accessTokenCache?: {
    token: string;
    expiresAtMs: number;
    scope: string;
  };
  private accessTokenPromise?: Promise<string>;

  constructor(config: OrbiPayGatewayConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.serviceKey = config.serviceKey || '';
    this.operatorKey = config.operatorKey;
    this.environment = config.environment;
    this.authMode = config.authMode || 'api_key';
    this.accessTokenScopes = config.accessTokenScopes || [];
    this.accessTokenRefreshSkewSeconds = Math.max(5, config.accessTokenRefreshSkewSeconds ?? 60);
    this.requestSigning = config.requestSigning ?? true;
    this.requestSigningSecret = config.requestSigningSecret;
    this.fetchImpl = config.fetchImpl || fetch;
    if (!this.baseUrl) throw new Error('ORBI_PAY_GATEWAY_BASE_URL_REQUIRED');
    if (!this.serviceKey && !this.operatorKey) throw new Error('ORBI_PAY_GATEWAY_CREDENTIAL_REQUIRED');
  }

  async getOAuthAuthorizationServerMetadata(): Promise<OAuthAuthorizationServerMetadata> {
    const response = await this.fetchImpl(`${this.baseUrl}/.well-known/oauth-authorization-server`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const error = typeof body?.error === 'string' ? body.error : `ORBI_PAY_GATEWAY_OAUTH_METADATA_HTTP_${response.status}`;
      throw new OrbiPayGatewayError(error, response.status, body);
    }
    return body as OAuthAuthorizationServerMetadata;
  }

  async introspectAccessToken(token: string): Promise<OAuthTokenIntrospection> {
    const response = await this.fetchImpl(`${this.baseUrl}/oauth/introspect`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        token,
        client_secret: this.serviceKey,
      }),
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const error = typeof body?.error === 'string' ? body.error : `ORBI_PAY_GATEWAY_OAUTH_INTROSPECT_HTTP_${response.status}`;
      throw new OrbiPayGatewayError(error, response.status, body);
    }
    return body as OAuthTokenIntrospection;
  }

  async revokeAccessToken(token: string): Promise<OrbiApiResponse<OAuthTokenRevocationResult>> {
    const response = await this.fetchImpl(`${this.baseUrl}/oauth/revoke`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        token,
        client_secret: this.serviceKey,
      }),
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const error = typeof body?.error === 'string' ? body.error : `ORBI_PAY_GATEWAY_OAUTH_REVOKE_HTTP_${response.status}`;
      throw new OrbiPayGatewayError(error, response.status, body);
    }
    if (this.accessTokenCache?.token === token) {
      this.accessTokenCache = undefined;
    }
    return body as OrbiApiResponse<OAuthTokenRevocationResult>;
  }

  createPaymentIntent(payload: PaymentIntentCreateRequest, options: OrbiRequestOptions = {}) {
    return this.request<PaymentIntent>('POST', '/v1/payment-intents', payload, options);
  }

  createCheckoutPaymentIntent(payload: PaymentIntentCreateRequest, options: OrbiRequestOptions = {}) {
    return this.createPaymentIntent({
      ...payload,
      confirm: payload.confirm ?? true,
    }, options);
  }

  getPaymentIntent(intentId: string, options: OrbiRequestOptions = {}) {
    return this.request<PaymentIntent>('GET', `/v1/payment-intents/${encodeURIComponent(intentId)}`, undefined, options);
  }

  confirmPaymentIntent(intentId: string, payload: Record<string, unknown> = {}, options: OrbiRequestOptions = {}) {
    return this.request<PaymentIntent>('POST', `/v1/payment-intents/${encodeURIComponent(intentId)}/confirm`, payload, options);
  }

  getPaymentIntentNextAction(intent: PaymentIntent): PaymentIntentNextAction {
    if (intent.status === 'completed') {
      return { type: 'complete', intent: intent as PaymentIntent & { status: 'completed' } };
    }
    if (intent.status === 'failed' || intent.status === 'cancelled') {
      return { type: 'failed', intent: intent as PaymentIntent & { status: 'failed' | 'cancelled' } };
    }
    if (intent.status === 'requires_action' && intent.challengeMode === 'hosted' && intent.challengeUrl) {
      return { type: 'redirect_to_hosted_challenge', url: intent.challengeUrl, intent };
    }
    if (intent.status === 'requires_action' && intent.challengeMode === 'in_app_required') {
      return { type: 'open_in_app_challenge', intent };
    }
    return { type: 'wait_for_webhook', intent };
  }

  requireHostedChallengeUrl(intent: PaymentIntent): string {
    const action = this.getPaymentIntentNextAction(intent);
    if (action.type !== 'redirect_to_hosted_challenge') {
      throw new Error(`ORBI_PAY_GATEWAY_HOSTED_CHALLENGE_NOT_AVAILABLE:${intent.status}`);
    }
    return action.url;
  }

  async waitForPaymentIntent(
    intentId: string,
    options: PaymentIntentWaitOptions = {},
  ) {
    const intervalMs = Math.max(250, options.intervalMs ?? 1000);
    const timeoutMs = Math.max(intervalMs, options.timeoutMs ?? 30000);
    const terminalStatuses = new Set<PaymentIntentTerminalStatus>(
      options.terminalStatuses || ['completed', 'failed', 'cancelled'],
    );
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeoutMs) {
      const response = await this.getPaymentIntent(intentId);
      if (!response.success) return response;
      if (terminalStatuses.has(response.data.status as PaymentIntentTerminalStatus)) return response;
      await sleep(intervalMs);
    }

    throw new Error(`ORBI_PAY_GATEWAY_PAYMENT_INTENT_WAIT_TIMEOUT:${intentId}`);
  }

  createPaySafeEscrow(payload: PaySafeEscrowCreateRequest, options: OrbiRequestOptions = {}) {
    return this.request<PaymentIntent>('POST', '/v1/paysafe/escrows', payload, options);
  }

  releasePaySafeEscrow(escrowId: string, payload: PaySafeActionRequest, options: OrbiRequestOptions = {}) {
    return this.request<unknown>('POST', `/v1/paysafe/escrows/${encodeURIComponent(escrowId)}/release`, payload, options);
  }

  refundPaySafeEscrow(escrowId: string, payload: PaySafeActionRequest, options: OrbiRequestOptions = {}) {
    return this.request<unknown>('POST', `/v1/paysafe/escrows/${encodeURIComponent(escrowId)}/refund`, payload, options);
  }

  disputePaySafeEscrow(escrowId: string, payload: PaySafeActionRequest, options: OrbiRequestOptions = {}) {
    return this.request<unknown>('POST', `/v1/paysafe/escrows/${encodeURIComponent(escrowId)}/dispute`, payload, options);
  }

  resolveIdentity(payload: IdentityResolveRequest, options: OrbiRequestOptions = {}) {
    return this.request<unknown>('POST', '/v1/identity/resolve', payload, options);
  }

  createBusinessRegistration(payload: BusinessRegistrationRequest, options: OrbiRequestOptions = {}) {
    return this.request<unknown>('POST', '/v1/business/registrations', payload, options);
  }

  createPaymentProfile(payload: PaymentProfileCreateRequest, options: OrbiRequestOptions = {}) {
    return this.request<PaymentProfile>('POST', '/v1/payment-profiles', payload, options);
  }

  linkPaymentProfile(payload: PaymentProfileLinkRequest, options: OrbiRequestOptions = {}) {
    return this.createPaymentProfile(payload, {
      ...options,
      idempotencyKey: options.idempotencyKey || `payment-profile:${payload.externalCustomerId}`,
    });
  }

  createConsentReceipt(payload: ConsentReceiptCreateRequest, options: OrbiRequestOptions = {}) {
    return this.operatorRequest<ConsentReceipt>('POST', '/v1/developer/consent-receipts', payload, options);
  }

  submitDeveloperServiceApplication(payload: DeveloperServiceApplicationRequest, options: OrbiRequestOptions = {}) {
    return this.operatorRequest<DeveloperServiceApplication>('POST', '/v1/developer/service-applications', payload, options);
  }

  listDeveloperServiceApplications(query: { status?: string } = {}) {
    return this.operatorRequest<DeveloperServiceApplication[]>(
      'GET',
      `/v1/developer/service-applications${queryString(query)}`,
    );
  }

  approveDeveloperServiceApplication(
    applicationId: string,
    payload: DeveloperServiceApprovalRequest = {},
    options: OrbiRequestOptions = {},
  ) {
    return this.operatorRequest<DeveloperServiceRecord>(
      'POST',
      `/v1/developer/service-applications/${encodeURIComponent(applicationId)}/approve`,
      payload,
      options,
    );
  }

  listDeveloperServices() {
    return this.operatorRequest<DeveloperServiceRecord[]>('GET', '/v1/developer/services');
  }

  getDeveloperService(serviceCode: string) {
    return this.operatorRequest<DeveloperServiceRecord>('GET', `/v1/developer/services/${encodeURIComponent(serviceCode)}`);
  }

  requestDeveloperScopes(serviceCode: string, payload: DeveloperScopeRequest, options: OrbiRequestOptions = {}) {
    return this.operatorRequest<unknown>(
      'POST',
      `/v1/developer/services/${encodeURIComponent(serviceCode)}/scope-requests`,
      payload,
      options,
    );
  }

  decideDeveloperScopeRequest(requestId: string, payload: DeveloperScopeDecisionRequest, options: OrbiRequestOptions = {}) {
    return this.operatorRequest<unknown>(
      'POST',
      `/v1/developer/scope-requests/${encodeURIComponent(requestId)}/decision`,
      payload,
      options,
    );
  }

  updateDeveloperAllowlists(serviceCode: string, payload: DeveloperAllowlistUpdateRequest, options: OrbiRequestOptions = {}) {
    return this.operatorRequest<unknown>(
      'POST',
      `/v1/developer/services/${encodeURIComponent(serviceCode)}/allowlists`,
      payload,
      options,
    );
  }

  issueDeveloperApiKey(serviceCode: string, payload: DeveloperSecretIssueRequest, options: OrbiRequestOptions = {}) {
    return this.operatorRequest<unknown>(
      'POST',
      `/v1/developer/services/${encodeURIComponent(serviceCode)}/api-keys/issue`,
      payload,
      options,
    );
  }

  issueDeveloperWebhookSecret(serviceCode: string, payload: DeveloperSecretIssueRequest, options: OrbiRequestOptions = {}) {
    return this.operatorRequest<unknown>(
      'POST',
      `/v1/developer/services/${encodeURIComponent(serviceCode)}/webhook-secrets/issue`,
      payload,
      options,
    );
  }

  getDeveloperDocsCatalog() {
    return this.operatorRequest<DeveloperPortalCatalogEntry[]>('GET', '/v1/developer/docs-catalog');
  }

  getDeveloperSandboxTools() {
    return this.operatorRequest<DeveloperPortalCatalogEntry[]>('GET', '/v1/developer/sandbox-tools');
  }

  getDeveloperEnvironmentProfiles() {
    return this.operatorRequest<DeveloperEnvironmentProfilesResult>('GET', '/v1/developer/environment-profiles');
  }

  getDeveloperEnvironmentProfile(environment: DeveloperEnvironment) {
    return this.operatorRequest<DeveloperEnvironmentProfile>(
      'GET',
      `/v1/developer/environment-profiles/${encodeURIComponent(environment)}`,
    );
  }

  getSandboxSimulatorFlow() {
    return this.operatorRequest<SandboxSimulatorFlow>('GET', '/v1/developer/sandbox-simulator');
  }

  getSandboxSimulatorState() {
    return this.operatorRequest<SandboxSimulatorState>('GET', '/v1/developer/sandbox-simulator/state');
  }

  resetSandboxSimulator() {
    return this.operatorRequest<SandboxSimulatorState>('POST', '/v1/developer/sandbox-simulator/reset', {});
  }

  listSandboxAccounts() {
    return this.operatorRequest<SandboxAccount[]>('GET', '/v1/developer/sandbox-simulator/accounts');
  }

  createSandboxTransfer(payload: SandboxTransferRequest, options: OrbiRequestOptions = {}) {
    return this.operatorRequest<SandboxTransfer>('POST', '/v1/developer/sandbox-simulator/transfers', payload, options);
  }

  buildSandboxTransferWebhookEvent(transferId: string) {
    return this.operatorRequest<OrbiWebhookEvent>(
      'POST',
      `/v1/developer/sandbox-simulator/transfers/${encodeURIComponent(transferId)}/webhook-event`,
      {},
    );
  }

  getDeveloperSdkCatalog() {
    return this.operatorRequest<DeveloperPortalCatalogEntry[]>('GET', '/v1/developer/sdk-catalog');
  }

  getConsentScopeCatalog() {
    return this.operatorRequest<ConsentScopeCatalogEntry[]>('GET', '/v1/developer/consent-scopes');
  }

  getConsentStatus(query: ConsentStatusQuery) {
    return this.operatorRequest<ConsentStatusResult>('GET', `/v1/developer/consent-status${queryString({
      ...query,
      scopes: query.scopes.join(','),
    })}`);
  }

  listConnectedConsents(query: ConnectedConsentQuery = {}, options: OrbiRequestOptions = {}) {
    return this.subjectRequest<ConnectedConsent[]>('GET', `/v1/consents${queryString(query)}`, undefined, options);
  }

  getConnectedConsent(consentId: string, query: Pick<ConnectedConsentQuery, 'locale'> = {}, options: OrbiRequestOptions = {}) {
    return this.subjectRequest<ConnectedConsent>(
      'GET',
      `/v1/consents/${encodeURIComponent(consentId)}${queryString(query)}`,
      undefined,
      options,
    );
  }

  revokeConnectedConsent(
    consentId: string,
    payload: ConnectedConsentRevocationRequest,
    options: OrbiRequestOptions = {},
  ) {
    return this.subjectRequest<ConnectedConsent>(
      'POST',
      `/v1/consents/${encodeURIComponent(consentId)}/revoke`,
      payload,
      options,
    );
  }

  listConsentReceipts(query: ConsentReceiptQuery = {}) {
    return this.operatorRequest<ConsentReceipt[]>('GET', `/v1/developer/consent-receipts${queryString(query)}`);
  }

  exportConsentReceipts(query: ConsentReceiptQuery & { requestedBy?: string } = {}) {
    return this.operatorRequest<ConsentReceiptExport>('GET', `/v1/developer/consent-receipts/export${queryString(query)}`);
  }

  getConsentReceipt(consentId: string) {
    return this.operatorRequest<ConsentReceipt>('GET', `/v1/developer/consent-receipts/${encodeURIComponent(consentId)}`);
  }

  revokeConsentReceipt(consentId: string, payload: ConsentRevocationRequest, options: OrbiRequestOptions = {}) {
    return this.operatorRequest<ConsentReceipt>(
      'POST',
      `/v1/developer/consent-receipts/${encodeURIComponent(consentId)}/revoke`,
      payload,
      options,
    );
  }

  listWebhookDeliveries(query: WebhookDeliveryQuery = {}) {
    return this.operatorRequest<WebhookDeliveryRecord[]>('GET', `/v1/developer/webhook-deliveries${queryString(query)}`);
  }

  replayWebhookDelivery(deliveryId: string, options: WebhookReplayOptions = {}) {
    return this.operatorRequest<WebhookDeliveryRecord>(
      'POST',
      `/v1/developer/webhook-deliveries/${encodeURIComponent(deliveryId)}/replay`,
      {
        ...(options.reason ? { reason: options.reason } : {}),
        ...(options.requestedBy ? { requestedBy: options.requestedBy } : {}),
        ...(options.metadata ? { metadata: options.metadata } : {}),
      },
      options,
    );
  }

  async replayFailedWebhookDeliveries(
    query: Omit<WebhookDeliveryQuery, 'status'> = {},
    options: WebhookReplayFailedOptions = {},
  ) {
    const listResponse = await this.listWebhookDeliveries({
      ...query,
      status: 'failed',
    });
    if (!listResponse.success) return listResponse;

    const limit = Math.max(1, options.limit ?? listResponse.data.length);
    const failedDeliveries = listResponse.data.slice(0, limit);
    const replayed: WebhookDeliveryRecord[] = [];

    for (const delivery of failedDeliveries) {
      const response = await this.replayWebhookDelivery(delivery.deliveryId, {
        ...options,
        requestId: options.requestId || `manual-replay-${delivery.deliveryId}`,
      });
      if (!response.success) return response;
      replayed.push(response.data);
    }

    return {
      success: true,
      data: replayed,
    } as OrbiApiResponse<WebhookDeliveryRecord[]>;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    payload?: unknown,
    options: OrbiRequestOptions = {},
    requireServiceKey = true,
    includeServiceKey = requireServiceKey,
  ): Promise<OrbiApiResponse<T>> {
    if (requireServiceKey && !this.serviceKey) throw new Error('ORBI_PAY_GATEWAY_SERVICE_KEY_REQUIRED');
    const serviceAuth = includeServiceKey && this.serviceKey
      ? await this.serviceAuthorization()
      : undefined;
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(serviceAuth ? serviceAuth.headers : {}),
      ...(options.headers || {}),
    };
    const environment = normalizeRuntimeEnvironment(options.environment || this.environment);
    if (environment) headers['x-orbi-environment'] = environment;
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
    if (options.requestId) headers['x-request-id'] = options.requestId;
    if (options.correlationId) headers['x-correlation-id'] = options.correlationId;
    if (options.traceId) headers['x-trace-id'] = options.traceId;
    const requestBody = method === 'GET' ? undefined : JSON.stringify(payload || {});
    if (method !== 'GET') headers['content-type'] = 'application/json';
    if (this.requestSigning && includeServiceKey && this.serviceKey) {
      Object.assign(headers, signOrbiRuntimeRequest({
        method,
        path,
        body: requestBody || '',
        secret: this.requestSigningSecret || serviceAuth?.signingSecret || this.serviceKey,
      }));
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: requestBody,
    });
    const text = await response.text();
    const responseBody = text ? JSON.parse(text) : {};
    if (!response.ok && (!responseBody || typeof responseBody !== 'object')) {
      throw new OrbiPayGatewayError(`ORBI_PAY_GATEWAY_HTTP_${response.status}`, response.status, responseBody);
    }
    return responseBody as OrbiApiResponse<T>;
  }

  private async serviceAuthorization(): Promise<{
    headers: Record<string, string>;
    signingSecret: string;
  }> {
    if (this.authMode === 'api_key') {
      return {
        headers: { 'x-orbi-pay-service-key': this.serviceKey },
        signingSecret: this.serviceKey,
      };
    }
    const token = await this.getServiceAccessToken();
    return {
      headers: { authorization: `Bearer ${token}` },
      signingSecret: token,
    };
  }

  private async getServiceAccessToken(): Promise<string> {
    const now = Date.now();
    const scope = this.accessTokenScopes.join(' ');
    if (
      this.accessTokenCache &&
      this.accessTokenCache.scope === scope &&
      this.accessTokenCache.expiresAtMs - (this.accessTokenRefreshSkewSeconds * 1000) > now
    ) {
      return this.accessTokenCache.token;
    }
    if (!this.accessTokenPromise) {
      this.accessTokenPromise = this.issueServiceAccessToken(scope).finally(() => {
        this.accessTokenPromise = undefined;
      });
    }
    return this.accessTokenPromise;
  }

  private async issueServiceAccessToken(scope: string): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_secret: this.serviceKey,
        ...(scope ? { scope } : {}),
      }),
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok || !body?.access_token) {
      const error = typeof body?.error === 'string' ? body.error : `ORBI_PAY_GATEWAY_TOKEN_HTTP_${response.status}`;
      throw new OrbiPayGatewayError(error, response.status, body);
    }
    const expiresInSeconds = Number(body.expires_in || 900);
    const token = String(body.access_token);
    this.accessTokenCache = {
      token,
      scope,
      expiresAtMs: Date.now() + (expiresInSeconds * 1000),
    };
    return token;
  }

  private operatorRequest<T>(
    method: 'GET' | 'POST',
    path: string,
    payload?: unknown,
    options: OrbiRequestOptions = {},
  ): Promise<OrbiApiResponse<T>> {
    if (!this.operatorKey) throw new Error('ORBI_PAY_GATEWAY_OPERATOR_KEY_REQUIRED');
    return this.request<T>(method, path, payload, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'x-orbi-pay-operator-key': this.operatorKey,
      },
    }, false, false);
  }

  private subjectRequest<T>(
    method: 'GET' | 'POST',
    path: string,
    payload?: unknown,
    options: OrbiRequestOptions = {},
  ): Promise<OrbiApiResponse<T>> {
    const subjectId = options.subject?.id?.trim();
    if (!subjectId) throw new Error('ORBI_PAY_GATEWAY_SUBJECT_CONTEXT_REQUIRED');
    return this.request<T>(method, path, payload, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'x-orbi-subject-id': subjectId,
        'x-orbi-subject-type': options.subject?.type || 'user',
      },
    }, false, false);
  }
}

const queryString = (query: Record<string, unknown>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : '';
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeRuntimeEnvironment = (environment?: OrbiRuntimeEnvironment) => {
  if (!environment) return undefined;
  const normalized = String(environment).trim().toLowerCase();
  if (normalized === 'demo') return 'demo';
  if (normalized === 'production') return 'production';
  throw new Error('ORBI_PAY_GATEWAY_ENVIRONMENT_INVALID');
};

const signOrbiRuntimeRequest = (input: {
  method: string;
  path: string;
  body: string;
  secret: string;
}) => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();
  const bodyHash = crypto.createHash('sha256').update(input.body).digest('hex');
  const canonical = [
    timestamp,
    nonce,
    input.method.toUpperCase(),
    input.path,
    bodyHash,
  ].join('.');
  const signature = crypto.createHmac('sha256', input.secret).update(canonical).digest('hex');
  return {
    'x-orbi-timestamp': timestamp,
    'x-orbi-nonce': nonce,
    'x-orbi-signature': `sha256=${signature}`,
  };
};
