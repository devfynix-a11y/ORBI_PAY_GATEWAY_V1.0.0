import type {
  BusinessRegistrationRequest,
  ConnectedConsentQuery,
  ConnectedConsentRevocationRequest,
  ConsentReceiptCreateRequest,
  ConsentRevocationRequest,
  ConsentStatusQuery,
  DeveloperEnvironment,
  DeveloperScopeRequest,
  IdentityResolveRequest,
  OrbiPayGatewayConfig,
  OrbiRequestOptions,
  PaySafeActionRequest,
  PaySafeEscrowCreateRequest,
  PaymentIntentCreateRequest,
  PaymentIntentWaitOptions,
  PaymentProfileLinkRequest,
  WebhookDeliveryQuery,
  WebhookReplayFailedOptions,
  WebhookVerificationInput,
} from './types.js';
import { OrbiPayGatewayClient } from './client.js';
import {
  handleOrbiWebhookEvent,
  isOrbiWebhookEventType,
  verifyAndParseOrbiWebhook,
  verifyOrbiWebhookSignature,
} from './webhooks.js';

export type TransferSendRequest = Omit<PaymentIntentCreateRequest, 'operation'>;

export class Orbi {
  readonly client: OrbiPayGatewayClient;

  readonly transfers = {
    send: (payload: TransferSendRequest, options: OrbiRequestOptions = {}) =>
      this.client.createPaymentIntent({
        ...payload,
        operation: 'collection',
        paymentCategory: payload.paymentCategory || 'orbi',
        paymentRail: payload.paymentRail || 'orbi_wallet',
      }, options),
    wait: (intentId: string, options: PaymentIntentWaitOptions = {}) =>
      this.client.waitForPaymentIntent(intentId, options),
  };

  readonly payments = {
    createIntent: (payload: PaymentIntentCreateRequest, options: OrbiRequestOptions = {}) =>
      this.client.createPaymentIntent(payload, options),
    checkout: (payload: PaymentIntentCreateRequest, options: OrbiRequestOptions = {}) =>
      this.client.createCheckoutPaymentIntent(payload, options),
    getIntent: (intentId: string, options?: Parameters<OrbiPayGatewayClient['getPaymentIntent']>[1]) =>
      this.client.getPaymentIntent(intentId, options),
    confirmIntent: (intentId: string, payload: Record<string, unknown> = {}, options: OrbiRequestOptions = {}) =>
      this.client.confirmPaymentIntent(intentId, payload, options),
    nextAction: (intent: Parameters<OrbiPayGatewayClient['getPaymentIntentNextAction']>[0]) =>
      this.client.getPaymentIntentNextAction(intent),
    wait: (intentId: string, options: PaymentIntentWaitOptions = {}) =>
      this.client.waitForPaymentIntent(intentId, options),
  };

  readonly paysafe = {
    createEscrow: (payload: PaySafeEscrowCreateRequest, options: OrbiRequestOptions = {}) =>
      this.client.createPaySafeEscrow(payload, options),
    release: (escrowId: string, payload: PaySafeActionRequest, options: OrbiRequestOptions = {}) =>
      this.client.releasePaySafeEscrow(escrowId, payload, options),
    refund: (escrowId: string, payload: PaySafeActionRequest, options: OrbiRequestOptions = {}) =>
      this.client.refundPaySafeEscrow(escrowId, payload, options),
    dispute: (escrowId: string, payload: PaySafeActionRequest, options: OrbiRequestOptions = {}) =>
      this.client.disputePaySafeEscrow(escrowId, payload, options),
  };

  readonly identity = {
    resolve: (payload: IdentityResolveRequest, options: OrbiRequestOptions = {}) =>
      this.client.resolveIdentity(payload, options),
    registerBusiness: (payload: BusinessRegistrationRequest, options: OrbiRequestOptions = {}) =>
      this.client.createBusinessRegistration(payload, options),
  };

  readonly profiles = {
    link: (payload: PaymentProfileLinkRequest, options: OrbiRequestOptions = {}) =>
      this.client.linkPaymentProfile(payload, options),
  };

  readonly oauth = {
    metadata: () => this.client.getOAuthAuthorizationServerMetadata(),
    authorizeUrl: (input: Parameters<OrbiPayGatewayClient['createOAuthAuthorizationUrl']>[0]) =>
      this.client.createOAuthAuthorizationUrl(input),
    pushedAuthorizeUrl: (input: Parameters<OrbiPayGatewayClient['createPushedOAuthAuthorizationUrl']>[0]) =>
      this.client.createPushedOAuthAuthorizationUrl(input),
    exchangeCode: (input: Parameters<OrbiPayGatewayClient['exchangeOAuthAuthorizationCode']>[0]) =>
      this.client.exchangeOAuthAuthorizationCode(input),
    refresh: (input: Parameters<OrbiPayGatewayClient['refreshOAuthAccessToken']>[0]) =>
      this.client.refreshOAuthAccessToken(input),
    introspect: (token: string) => this.client.introspectAccessToken(token),
    revoke: (token: string) => this.client.revokeAccessToken(token),
  };

  readonly consents = {
    createReceipt: (payload: ConsentReceiptCreateRequest, options: OrbiRequestOptions = {}) =>
      this.client.createConsentReceipt(payload, options),
    listReceipts: (query: Parameters<OrbiPayGatewayClient['listConsentReceipts']>[0] = {}) =>
      this.client.listConsentReceipts(query),
    revokeReceipt: (consentId: string, payload: ConsentRevocationRequest, options: OrbiRequestOptions = {}) =>
      this.client.revokeConsentReceipt(consentId, payload, options),
    status: (query: ConsentStatusQuery) => this.client.getConsentStatus(query),
    scopes: () => this.client.getConsentScopeCatalog(),
    connected: {
      list: (query: ConnectedConsentQuery = {}, options: OrbiRequestOptions = {}) =>
        this.client.listConnectedConsents(query, options),
      get: (consentId: string, query: Pick<ConnectedConsentQuery, 'locale'> = {}, options: OrbiRequestOptions = {}) =>
        this.client.getConnectedConsent(consentId, query, options),
      revoke: (consentId: string, payload: ConnectedConsentRevocationRequest, options: OrbiRequestOptions = {}) =>
        this.client.revokeConnectedConsent(consentId, payload, options),
    },
  };

  readonly developer = {
    submitService: (payload: Parameters<OrbiPayGatewayClient['submitDeveloperServiceApplication']>[0], options: OrbiRequestOptions = {}) =>
      this.client.submitDeveloperServiceApplication(payload, options),
    requestScopes: (serviceCode: string, payload: DeveloperScopeRequest, options: OrbiRequestOptions = {}) =>
      this.client.requestDeveloperScopes(serviceCode, payload, options),
    environmentProfiles: () => this.client.getDeveloperEnvironmentProfiles(),
    environmentProfile: (environment: DeveloperEnvironment) => this.client.getDeveloperEnvironmentProfile(environment),
    sandboxSimulator: {
      flow: () => this.client.getSandboxSimulatorFlow(),
      state: () => this.client.getSandboxSimulatorState(),
      reset: () => this.client.resetSandboxSimulator(),
      accounts: () => this.client.listSandboxAccounts(),
      transfer: (payload: Parameters<OrbiPayGatewayClient['createSandboxTransfer']>[0], options: OrbiRequestOptions = {}) =>
        this.client.createSandboxTransfer(payload, options),
      webhookEvent: (transferId: string) => this.client.buildSandboxTransferWebhookEvent(transferId),
    },
    docs: () => this.client.getDeveloperDocsCatalog(),
    sdk: () => this.client.getDeveloperSdkCatalog(),
  };

  readonly webhooks = {
    verify: (input: WebhookVerificationInput) => verifyOrbiWebhookSignature(input),
    parse: (input: WebhookVerificationInput) => verifyAndParseOrbiWebhook(input),
    handle: handleOrbiWebhookEvent,
    isType: isOrbiWebhookEventType,
    listDeliveries: (query: WebhookDeliveryQuery = {}) => this.client.listWebhookDeliveries(query),
    replay: (deliveryId: string, options: OrbiRequestOptions = {}) => this.client.replayWebhookDelivery(deliveryId, options),
    replayFailed: (query: Omit<WebhookDeliveryQuery, 'status'> = {}, options: WebhookReplayFailedOptions = {}) =>
      this.client.replayFailedWebhookDeliveries(query, options),
  };

  get Transfers() {
    return this.transfers;
  }

  get Payments() {
    return this.payments;
  }

  get PaySafe() {
    return this.paysafe;
  }

  get Identity() {
    return this.identity;
  }

  get Profiles() {
    return this.profiles;
  }

  get Consents() {
    return this.consents;
  }

  get Developer() {
    return this.developer;
  }

  get Webhooks() {
    return this.webhooks;
  }

  constructor(config: OrbiPayGatewayConfig) {
    this.client = new OrbiPayGatewayClient(config);
  }
}

export const createOrbi = (config: OrbiPayGatewayConfig) => new Orbi(config);
