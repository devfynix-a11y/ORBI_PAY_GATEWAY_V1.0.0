import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { config, requireGatewayRuntimeSecrets } from './config.js';
import { logger } from './logger.js';
import { adapterRegistry } from './adapters/AdapterRegistry.js';
import { orbiCoreClient } from './core/orbiCoreClient.js';
import { obpDiscoveryService } from './discovery/ObpDiscoveryService.js';
import { rejectUnsafeDirectSecretsInProduction } from './security/providerCredentialVault.js';
import { assertStrongCustomerAuth, redactedScaForCore } from './security/strongCustomerAuth.js';
import { payServiceRegistry } from './services/payServiceRegistry.js';
import {
  authenticatePayServiceCredential,
  developerEnvironmentForRuntime,
  extractServiceApiKey,
  type AuthenticatedPayService,
  type RuntimeEnvironment,
} from './services/payServiceAuth.js';
import { paymentIntentStore } from './services/paymentIntentStore.js';
import {
  buildServiceWebhookPayload,
  deliverServiceWebhook,
  deliverServiceWebhookPayload,
} from './services/serviceWebhook.js';
import { webhookDeliveryStore } from './services/webhookDeliveryStore.js';
import { verifySignedInternalHeaders } from './security/internalSigner.js';
import {
  buildApiErrorBody,
  errorCodeFromException,
  httpStatusForGatewayError,
  publicPaymentIntentStatus,
} from './contracts/platformContract.js';
import { graphqlGatewaySchema, graphqlMigrationPlan } from './contracts/graphqlContract.js';
import {
  ConsentReceiptCreateSchema,
  ConsentRevocationSchema,
} from './contracts/consentCenterContract.js';
import {
  DeveloperAllowlistUpdateSchema,
  DeveloperApiKeyRotationDecisionSchema,
  DeveloperApiKeyRotationRequestSchema,
  DeveloperSecretIssueRequestSchema,
  DeveloperScopeDecisionSchema,
  DeveloperScopeRequestSchema,
  DeveloperServiceApplicationSchema,
  DeveloperWebhookSecretRotationRequestSchema,
} from './contracts/developerPortalContract.js';
import { consentReceiptStore } from './services/consentReceiptStore.js';
import { developerPortalStore } from './services/developerPortalStore.js';
import { ServiceConsentGuard, subjectIdForConsent } from './services/serviceConsentGuard.js';
import { buildDeveloperHealthSummary } from './services/developerHealthService.js';
import {
  developerDocsCatalog,
  developerSandboxToolsCatalog,
  developerSdkCatalog,
} from './services/developerResourceCatalog.js';
import {
  developerEnvironmentProfile,
  developerEnvironmentProfiles,
  developerEnvironmentSeparationMatrix,
} from './services/developerEnvironmentCatalog.js';
import { consentScopeCatalog, consentScopeSummary, type ConsentLocale } from './services/consentScopeCatalog.js';
import { createConsentReceiptFromHostedChallenge } from './services/hostedChallengeConsent.js';
import { sandboxSimulatorStore } from './services/sandboxSimulatorStore.js';
import type {
  GatewayPaymentRequest,
  GatewayPaymentResponse,
  NormalizedProviderEvent,
  PaymentCategory,
  PaymentIntent,
  MerchantPaymentRail,
  PayServiceDefinition,
  PayServiceOperation,
  ServicePaymentCoreEvent,
  ServicePaymentRequest,
} from './types.js';

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

const PaymentRequestSchema = z.object({
  providerCode: z.string().min(1),
  reference: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().min(3).max(8),
  phone: z.string().optional(),
  accountNumber: z.string().optional(),
  walletId: z.string().optional(),
  description: z.string().max(500).optional(),
  rail: z.enum(['MOBILE_MONEY', 'BANK', 'CARD_GATEWAY', 'CRYPTO']).optional(),
  sca: z.object({
    status: z.enum(['not_required', 'required', 'challenged', 'authenticated', 'failed']),
    protocol: z.enum(['3DS2', '3DS1', 'OTP', 'BIOMETRIC', 'PASSKEY']).optional(),
    challengeId: z.string().optional(),
    authenticationValue: z.string().optional(),
    eci: z.string().optional(),
    dsTransactionId: z.string().optional(),
    liabilityShift: z.boolean().optional(),
    authenticatedAt: z.string().optional(),
  }).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const ObpSandboxEntitlementRequestSchema = z.object({
  bankId: z.string().trim().optional(),
  roleName: z.string().trim().min(1),
});

const ObpSandboxAccountCreateSchema = z.object({
  accountId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  label: z.string().trim().min(1).default('ORBI Sandbox Account'),
  productCode: z.string().trim().min(1).default('CURRENT'),
  branchId: z.string().trim().min(1).default('BRANCH1'),
  currency: z.string().trim().min(3).max(8).default('TZS'),
  amount: z.union([z.string(), z.number()]).default('0'),
  accountRoutings: z.array(z.object({
    scheme: z.string().trim().min(1),
    address: z.string().trim().min(1),
  })).optional(),
  rawBody: z.record(z.string(), z.unknown()).optional(),
});

const PaymentCategorySchema = z.enum(['orbi', 'mobile_money', 'bank', 'card']);
const PaymentRailSchema = z.enum(['orbi_wallet', 'mno_tz', 'bank_transfer_tz', 'card_gateway']);

const PaymentIntentCreateSchema = z.object({
  operation: z.enum(['collection', 'payout', 'refund']).default('collection'),
  paymentCategory: PaymentCategorySchema.optional(),
  paymentRail: PaymentRailSchema.optional(),
  providerCode: z.string().trim().optional(),
  idempotencyKey: z.string().trim().min(8).max(160).optional(),
  idempotency_key: z.string().trim().min(8).max(160).optional(),
  reference: z.string().trim().min(1),
  amount: z.number().positive(),
  currency: z.string().trim().min(3).max(8),
  description: z.string().trim().max(500).optional(),
  confirm: z.boolean().optional(),
  customer: z.object({
    type: z.enum(['user', 'guest', 'external_customer']).optional(),
    name: z.string().trim().optional(),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().optional(),
    userId: z.string().trim().optional(),
  }).optional(),
  walletId: z.string().trim().optional(),
  accountNumber: z.string().trim().optional(),
  returnUrl: z.string().trim().url().optional(),
  return_url: z.string().trim().url().optional(),
  callbackUrl: z.string().trim().url().optional(),
  callback_url: z.string().trim().url().optional(),
  redirectUrl: z.string().trim().url().optional(),
  redirect_url: z.string().trim().url().optional(),
  sca: PaymentRequestSchema.shape.sca,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const PaySafeEscrowCreateSchema = z.object({
  reference: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(8).max(160).optional(),
  idempotency_key: z.string().trim().min(8).max(160).optional(),
  amount: z.number().positive(),
  currency: z.string().trim().min(3).max(8),
  paymentCategory: PaymentCategorySchema.optional(),
  paymentRail: PaymentRailSchema.optional(),
  providerCode: z.string().trim().optional(),
  description: z.string().trim().max(500).optional(),
  confirm: z.boolean().optional().default(true),
  buyer: PaymentIntentCreateSchema.shape.customer,
  seller: z.object({
    name: z.string().trim().optional(),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().optional(),
    userId: z.string().trim().optional(),
    walletId: z.string().trim().optional(),
  }).optional(),
  returnUrl: z.string().trim().url().optional(),
  return_url: z.string().trim().url().optional(),
  callbackUrl: z.string().trim().url().optional(),
  callback_url: z.string().trim().url().optional(),
  redirectUrl: z.string().trim().url().optional(),
  redirect_url: z.string().trim().url().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const PaySafeEscrowActionSchema = z.object({
  reference: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(8).max(160).optional(),
  idempotency_key: z.string().trim().min(8).max(160).optional(),
  amount: z.number().nonnegative().optional(),
  currency: z.string().trim().min(3).max(8).optional(),
  reason: z.string().trim().max(500).optional(),
  customer: PaymentIntentCreateSchema.shape.customer,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const PaySafeBalanceQuerySchema = z.object({
  userId: z.string().trim().optional(),
  customerId: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().optional(),
  includeHistory: z.coerce.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).refine((value) => Boolean(value.userId || value.customerId || value.email || value.phone), {
  message: 'Provide userId, customerId, email, or phone.',
  path: ['userId'],
});

const IdentityResolveSchema = z.object({
  identifier: z.string().trim().min(3).max(120),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const BusinessRegistrationSchema = z.object({
  userId: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().min(1).max(40).optional(),
  requestedRole: z.string().trim().min(1).max(40).optional(),
  requested_role: z.string().trim().min(1).max(40).optional(),
  businessName: z.string().trim().min(1).max(160).optional(),
  business_name: z.string().trim().min(1).max(160).optional(),
  externalBusinessId: z.string().trim().max(160).optional(),
  external_business_id: z.string().trim().max(160).optional(),
  note: z.string().trim().max(1000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).refine((value) => Boolean(value.userId || value.email || value.phone), {
  message: 'Provide userId, email, or phone.',
  path: ['userId'],
});

const PaymentProfileCreateSchema = z.object({
  userId: z.string().trim().optional(),
  customerId: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().min(1).max(40).optional(),
  externalCustomerId: z.string().trim().min(1).max(160).optional(),
  external_customer_id: z.string().trim().min(1).max(160).optional(),
  scopes: z.array(z.string().trim().min(1).max(80)).min(1).max(20).default([
    'payment_profile:read',
    'payments:create',
  ]),
  consent: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  expiresAt: z.string().datetime().optional(),
  expires_at: z.string().datetime().optional(),
  idempotencyKey: z.string().trim().min(8).max(160).optional(),
  idempotency_key: z.string().trim().min(8).max(160).optional(),
}).refine((value) => Boolean(value.userId || value.customerId || value.email || value.phone), {
  message: 'Provide userId, customerId, email, or phone.',
  path: ['userId'],
});

const MerchantSettlementsQuerySchema = z.object({
  currency: z.string().trim().min(3).max(8).optional(),
  status: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const ConsentStatusQuerySchema = z.object({
  serviceCode: z.string().trim().min(1),
  subjectId: z.string().trim().min(1),
  scopes: z.union([
    z.string().trim().min(1),
    z.array(z.string().trim().min(1)),
  ]),
  environment: z.enum(['sandbox', 'live']).optional(),
  renewalWindowDays: z.coerce.number().int().min(0).max(365).optional(),
});

const ConnectedConsentsQuerySchema = z.object({
  status: z.enum(['active', 'revoked', 'expired']).optional(),
  locale: z.enum(['en', 'sw']).optional(),
});

const SandboxTransferSchema = z.object({
  fromAccountId: z.string().trim().min(1),
  toAccountId: z.string().trim().min(1),
  amount: z.number().positive(),
  currency: z.string().trim().min(3).max(8),
  reference: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});

const CoreServicePaymentEventSchema = z.object({
  intentId: z.string().trim().min(1),
  serviceCode: z.string().trim().min(1),
  status: z.enum(['requires_action', 'submitted_to_core', 'processing', 'pending', 'completed', 'failed']),
  message: z.string().trim().optional(),
  transactionId: z.string().trim().optional(),
  challenge: z.object({
    type: z.enum(['OTP', 'PIN', 'PASSKEY', 'BIOMETRIC', '3DS']),
    challengeId: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    expiresAt: z.string().trim().optional(),
    delivery: z.object({
      channel: z.enum(['sms', 'email', 'push', 'in_app']).optional(),
      destinationHint: z.string().trim().optional(),
    }).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

type ServicePaymentIntentPayload = Omit<z.infer<typeof PaymentIntentCreateSchema>, 'operation' | 'amount'> & {
  operation: PayServiceOperation;
  amount: number;
};

type NormalizedPaymentRoute = {
  paymentCategory: PaymentCategory;
  paymentRail: MerchantPaymentRail;
  providerCode?: string;
  routingContractVersion: 'v1';
};

const normalizeHeaders = (headers: Record<string, string | string[] | undefined>): Record<string, string | undefined> =>
  Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(',') : value === undefined ? undefined : String(value),
    ]),
  );

const shouldNotifyCore = (response: GatewayPaymentResponse): boolean =>
  ['processing', 'pending', 'completed', 'failed'].includes(response.status);

const requestIdFromResponse = (res: express.Response): string | undefined => {
  const value = res.getHeader('x-request-id');
  return typeof value === 'string' ? value : undefined;
};

const apiErrorBody = (
  res: express.Response,
  error: string,
  options: {
    message?: string;
    details?: unknown[];
    data?: unknown;
  } = {},
) => buildApiErrorBody(error, {
  ...options,
  requestId: requestIdFromResponse(res),
});

const sendApiError = (
  res: express.Response,
  status: number,
  error: string,
  options: Parameters<typeof apiErrorBody>[2] = {},
) => res.status(status).json(apiErrorBody(res, error, options));

const sendValidationError = (
  res: express.Response,
  error: string,
  issues: z.ZodIssue[],
) => sendApiError(res, 400, error, {
  message: 'Request validation failed.',
  details: issues,
});

const trustedSubjectContext = (req: express.Request) => {
  const subjectId = String(
    req.get('x-orbi-subject-id') ||
    req.get('x-orbi-user-id') ||
    req.get('x-orbi-business-id') ||
    '',
  ).trim();
  const subjectTypeRaw = String(req.get('x-orbi-subject-type') || 'user').trim().toLowerCase();
  const subjectType = subjectTypeRaw === 'business' ? 'business' : 'user';
  return subjectId ? { subjectId, subjectType } : null;
};

const requireConsentSubjectAccess = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const context = trustedSubjectContext(req);
  if (!context) {
    return sendApiError(res, 401, 'CONSENT_SUBJECT_SESSION_REQUIRED', {
      message: 'Authenticated ORBI subject context is required.',
    });
  }
  res.locals.consentSubject = context;
  return next();
};

const presentConsentReceipt = (receipt: ReturnType<typeof consentReceiptStore.get>, locale: ConsentLocale = 'en') => ({
  ...receipt,
  scopeSummary: consentScopeSummary(receipt.scopes, locale),
});

const deliverConsentRevocationWebhook = (receipt: ReturnType<typeof consentReceiptStore.revoke>) => {
  const service = payServiceRegistry.get(receipt.serviceCode);
  deliverServiceWebhookPayload(service, {
    eventId: crypto.randomUUID(),
    eventType: 'consent.revoked',
    serviceCode: receipt.serviceCode,
    consent: {
      consentId: receipt.consentId,
      serviceCode: receipt.serviceCode,
      environment: receipt.environment,
      subjectType: receipt.subjectType,
      subjectId: receipt.subjectId,
      externalSubjectId: receipt.externalSubjectId,
      scopes: receipt.scopes,
      purpose: receipt.purpose,
      status: receipt.status,
      expiresAt: receipt.expiresAt,
      revokedAt: receipt.revokedAt,
      revokedBy: receipt.revokedBy,
      revocationReason: receipt.revocationReason,
    },
  }).then((delivery) => {
    if (!delivery.attempted) return;
    webhookDeliveryStore.record({
      eventId: delivery.eventId || crypto.randomUUID(),
      serviceCode: receipt.serviceCode,
      resourceId: receipt.consentId,
      eventType: delivery.eventType || 'consent.revoked',
      payload: delivery.payload,
      callbackUrl: delivery.callbackUrl,
      status: delivery.delivered ? 'delivered' : 'failed',
      attempt: 1,
      statusCode: delivery.statusCode,
      error: delivery.error,
    });
  }).catch((error) => {
    logger.error('consent_revocation_webhook_failed', {
      serviceCode: receipt.serviceCode,
      consentId: receipt.consentId,
      error: error.message,
    });
  });
};

const sanitizeIdempotencyKey = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length >= 8 && trimmed.length <= 160 ? trimmed : undefined;
};

const requestIdempotencyKey = (req: express.Request, body: Record<string, unknown> = {}): string | undefined =>
  sanitizeIdempotencyKey(req.headers['idempotency-key']) ||
  sanitizeIdempotencyKey(req.headers['x-idempotency-key']) ||
  sanitizeIdempotencyKey(req.headers['x-orbi-idempotency-key']) ||
  sanitizeIdempotencyKey(body.idempotencyKey) ||
  sanitizeIdempotencyKey(body.idempotency_key);

const requestRuntimeEnvironment = (req: express.Request): RuntimeEnvironment | undefined => {
  const raw = String(
    req.headers['x-orbi-environment'] ||
    req.headers['x-orbi-pay-environment'] ||
    req.headers['x-orbi-mode'] ||
    '',
  ).trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === 'demo' || raw === 'sandbox') return 'demo';
  if (raw === 'production' || raw === 'live') return 'production';
  throw new Error('PAY_GATEWAY_ENVIRONMENT_INVALID');
};

const requireRuntimeEnvironment = (req: express.Request): RuntimeEnvironment => {
  const environment = requestRuntimeEnvironment(req);
  if (!environment) throw new Error('PAY_GATEWAY_ENVIRONMENT_REQUIRED');
  return environment;
};

const assertServiceCredentialEnvironment = (
  credential: AuthenticatedPayService['credential'] | undefined,
  runtimeEnvironment: RuntimeEnvironment,
) => {
  const expected = developerEnvironmentForRuntime(runtimeEnvironment);
  if (!credential?.environment) throw new Error('PAY_GATEWAY_CREDENTIAL_ENVIRONMENT_UNBOUND');
  if (credential.environment !== expected) throw new Error('PAY_GATEWAY_ENVIRONMENT_KEY_MISMATCH');
};

const timingSafeEqualHex = (left: string, right: string): boolean => {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const assertFinancialRequestSignature = (req: express.Request) => {
  const signatureHeader = String(req.headers['x-orbi-signature'] || '').trim();
  const timestampHeader = String(req.headers['x-orbi-timestamp'] || '').trim();
  const nonceHeader = String(req.headers['x-orbi-nonce'] || '').trim();
  if (!signatureHeader) throw new Error('PAY_GATEWAY_SIGNATURE_REQUIRED');
  if (!timestampHeader) throw new Error('PAY_GATEWAY_SIGNATURE_TIMESTAMP_REQUIRED');
  if (!nonceHeader || nonceHeader.length < 12 || nonceHeader.length > 120) {
    throw new Error('PAY_GATEWAY_SIGNATURE_NONCE_REQUIRED');
  }
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) throw new Error('PAY_GATEWAY_SIGNATURE_TIMESTAMP_INVALID');
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) {
    throw new Error('PAY_GATEWAY_SIGNATURE_TIMESTAMP_STALE');
  }
  const secret = extractServiceApiKey(req);
  if (!secret) throw new Error('PAY_GATEWAY_SIGNATURE_SECRET_MISSING');
  const signature = signatureHeader.replace(/^sha256=/i, '').trim();
  if (!/^[a-f0-9]{64}$/i.test(signature)) throw new Error('PAY_GATEWAY_SIGNATURE_INVALID');
  const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  const canonical = [
    timestampHeader,
    nonceHeader,
    req.method.toUpperCase(),
    req.originalUrl,
    bodyHash,
  ].join('.');
  const expected = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
  if (!timingSafeEqualHex(signature, expected)) throw new Error('PAY_GATEWAY_SIGNATURE_INVALID');
};

const assertFinancialRuntimeRequest = (
  req: express.Request,
  res: express.Response,
  payload: Record<string, unknown> = {},
) => {
  const environment = requireRuntimeEnvironment(req);
  const credential = res.locals.payServiceCredential as AuthenticatedPayService['credential'] | undefined;
  assertServiceCredentialEnvironment(credential, environment);
  if (!requestIdempotencyKey(req, payload)) throw new Error('PAY_GATEWAY_IDEMPOTENCY_KEY_REQUIRED');
  assertFinancialRequestSignature(req);
  return environment;
};

const safeServiceReturnUrl = (value: unknown): string | undefined => {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol)) return undefined;
    if (config.env === 'production' && url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
};

const serviceReturnUrl = (payload: Record<string, unknown>): string | undefined => {
  const metadata = (payload.metadata && typeof payload.metadata === 'object')
    ? payload.metadata as Record<string, unknown>
    : {};
  return safeServiceReturnUrl(payload.returnUrl) ||
    safeServiceReturnUrl(payload.return_url) ||
    safeServiceReturnUrl(payload.callbackUrl) ||
    safeServiceReturnUrl(payload.callback_url) ||
    safeServiceReturnUrl(payload.redirectUrl) ||
    safeServiceReturnUrl(payload.redirect_url) ||
    safeServiceReturnUrl(metadata.returnUrl) ||
    safeServiceReturnUrl(metadata.return_url) ||
    safeServiceReturnUrl(metadata.callbackUrl) ||
    safeServiceReturnUrl(metadata.callback_url) ||
    safeServiceReturnUrl(metadata.redirectUrl) ||
    safeServiceReturnUrl(metadata.redirect_url);
};

const callbackUrlFromPayload = (payload: Record<string, unknown>): string | undefined => {
  const metadata = (payload.metadata && typeof payload.metadata === 'object')
    ? payload.metadata as Record<string, unknown>
    : {};
  return safeServiceReturnUrl(payload.callbackUrl) ||
    safeServiceReturnUrl(payload.callback_url) ||
    safeServiceReturnUrl(payload.webhookUrl) ||
    safeServiceReturnUrl(payload.webhook_url) ||
    safeServiceReturnUrl(metadata.callbackUrl) ||
    safeServiceReturnUrl(metadata.callback_url) ||
    safeServiceReturnUrl(metadata.webhookUrl) ||
    safeServiceReturnUrl(metadata.webhook_url);
};

const assertDeveloperPortalUrlAllowlists = (
  service: PayServiceDefinition,
  payload: Record<string, unknown>,
  returnUrl: string | undefined,
) => {
  if (returnUrl && !developerPortalStore.isReturnUrlAllowed(service.code, returnUrl)) {
    throw new Error('DEVELOPER_REDIRECT_URL_NOT_ALLOWED');
  }

  const callbackUrl = callbackUrlFromPayload(payload);
  if (callbackUrl && !developerPortalStore.isWebhookUrlAllowed(service.code, callbackUrl)) {
    throw new Error('DEVELOPER_WEBHOOK_URL_NOT_ALLOWED');
  }
};

const paymentIntentFingerprint = (payload: ServicePaymentIntentPayload): string =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify({
      operation: payload.operation,
      paymentCategory: payload.paymentCategory || null,
      paymentRail: payload.paymentRail || null,
      providerCode: payload.providerCode || null,
      reference: payload.reference,
      amount: payload.amount,
      currency: payload.currency.toUpperCase(),
      walletId: payload.walletId || null,
      accountNumber: payload.accountNumber || null,
      customer: {
        type: payload.customer?.type || null,
        userId: payload.customer?.userId || null,
        email: payload.customer?.email || null,
        phone: payload.customer?.phone || null,
      },
    }))
    .digest('hex');

const eventFromProviderResponse = (response: GatewayPaymentResponse): NormalizedProviderEvent => ({
  providerId: response.providerCode,
  reference: response.reference,
  status: response.status,
  message: response.message,
  providerEventId: response.providerReference,
  rawStatus: response.status,
  payload: response.raw || {},
});

type ProviderExecutableOperation = 'collect' | 'payout' | 'refund';

const methodForOperation = (operation: ProviderExecutableOperation) => {
  if (operation === 'collect') return 'collect';
  return operation;
};

const executeProviderOperation = async (
  operation: ProviderExecutableOperation,
  request: GatewayPaymentRequest,
): Promise<{ response: GatewayPaymentResponse; coreResult: unknown }> => {
  const adapter = adapterRegistry.get(request.providerCode);
  assertStrongCustomerAuth(request);
  const method = methodForOperation(operation);
  const response = await adapter[method]({
    ...request,
    metadata: {
      ...(request.metadata || {}),
      direction: operation === 'collect' ? 'collect' : operation,
      sca: redactedScaForCore(request.sca),
    },
  });

  let coreResult: unknown = null;
  if (shouldNotifyCore(response)) {
    coreResult = await orbiCoreClient.submitProviderEvent(eventFromProviderResponse(response));
  }

  return { response, coreResult };
};

const assertServicePaymentAllowed = (
  service: PayServiceDefinition,
  operation: PayServiceOperation,
  currency: string,
) => {
  if (!service.allowedOperations.includes(operation)) {
    throw new Error('PAY_SERVICE_OPERATION_NOT_ALLOWED');
  }

  if (!service.allowedCurrencies.includes(currency.toUpperCase())) {
    throw new Error('PAY_SERVICE_CURRENCY_NOT_ALLOWED');
  }
};

const serviceConsentGuard = new ServiceConsentGuard(developerPortalStore, consentReceiptStore);

const categoryForRail = (rail: MerchantPaymentRail): PaymentCategory => {
  if (rail === 'orbi_wallet') return 'orbi';
  if (rail === 'mno_tz') return 'mobile_money';
  if (rail === 'bank_transfer_tz') return 'bank';
  return 'card';
};

const normalizePaySafePaymentRoute = (payload: ServicePaymentIntentPayload): NormalizedPaymentRoute => {
  const metadata = payload.metadata || {};
  const metadataCategory = typeof metadata.paymentCategory === 'string'
    ? metadata.paymentCategory
    : typeof metadata.payment_category === 'string'
      ? metadata.payment_category
      : '';
  const metadataRail = typeof metadata.paymentRail === 'string'
    ? metadata.paymentRail
    : typeof metadata.payment_rail === 'string'
      ? metadata.payment_rail
      : '';
  const category = (payload.paymentCategory || metadataCategory || '') as PaymentCategory | '';
  const rail = (payload.paymentRail || metadataRail || '') as MerchantPaymentRail | '';
  const inferredCategory = rail ? categoryForRail(rail as MerchantPaymentRail) : '';
  if (!category || !rail) {
    throw new Error('PAYSAFE_PAYMENT_ROUTE_REQUIRED');
  }

  const finalCategory = category as PaymentCategory;
  const finalRail = rail as MerchantPaymentRail;
  const railCategory = categoryForRail(finalRail);

  if (railCategory !== finalCategory) {
    throw new Error('PAYSAFE_PAYMENT_ROUTE_MISMATCH');
  }

  const providerCode = String(payload.providerCode || metadata.providerCode || metadata.provider_code || '').trim() || undefined;
  if (finalCategory !== 'orbi' && !providerCode) {
    throw new Error('PAYSAFE_EXTERNAL_PROVIDER_CODE_REQUIRED');
  }

  if (finalCategory === 'mobile_money' && !payload.customer?.phone) {
    throw new Error('PAYSAFE_MOBILE_MONEY_PHONE_REQUIRED');
  }

  if (finalCategory === 'bank' && !payload.accountNumber && !payload.customer?.userId) {
    throw new Error('PAYSAFE_BANK_ACCOUNT_REFERENCE_REQUIRED');
  }

  return {
    paymentCategory: finalCategory,
    paymentRail: finalRail,
    providerCode,
    routingContractVersion: 'v1',
  };
};

const isMerchantPaymentRequestError = (message: string) => [
  'PAYSAFE_PAYMENT_ROUTE_MISMATCH',
  'PAYSAFE_PAYMENT_ROUTE_REQUIRED',
  'PAYSAFE_EXTERNAL_PROVIDER_CODE_REQUIRED',
  'PAYSAFE_MOBILE_MONEY_PHONE_REQUIRED',
  'PAYSAFE_BANK_ACCOUNT_REFERENCE_REQUIRED',
].includes(message);

const serviceMerchantContext = (service: PayServiceDefinition): Record<string, unknown> => {
  const profile = service.merchant || {};
  const readEnv = (envName?: string) => {
    const key = String(envName || '').trim();
    return key ? String(process.env[key] || '').trim() : '';
  };
  const merchantId = readEnv(profile.merchantIdEnv);
  return {
    merchantId: merchantId || undefined,
    feeProfileCode: profile.feeProfileCode || undefined,
    feeFlowCode: profile.feeFlowCode || undefined,
    requireActiveMerchant: profile.requireActiveMerchant !== false,
  };
};

const requireServiceMerchantContext = (service: PayServiceDefinition) => {
  const context = serviceMerchantContext(service);
  const merchantId = String(context.merchantId || '').trim();
  if (!merchantId) {
    throw new Error('PAY_SERVICE_MERCHANT_CONTEXT_REQUIRED');
  }
  return {
    ...context,
    merchantId,
  };
};

const buildCoreServicePaymentRequest = (intent: PaymentIntent): ServicePaymentRequest => ({
  intentId: intent.id,
  serviceCode: intent.serviceCode,
  operation: intent.operation,
  paymentCategory: intent.paymentCategory,
  paymentRail: intent.paymentRail,
  providerCode: intent.providerCode,
  reference: intent.reference,
  amount: intent.amount,
  currency: intent.currency,
  description: intent.description,
  customer: intent.customer,
  walletId: intent.walletId,
  accountNumber: intent.accountNumber,
  metadata: intent.metadata,
  checkoutUrl: intent.checkoutUrl,
  returnUrl: intent.returnUrl,
  createdAt: intent.createdAt,
});

const hostedChallengeUrlForIntent = (intent: PaymentIntent): string | undefined =>
  intent.coreResult?.challenge
    ? `${config.publicBaseUrl.replace(/\/$/, '')}/challenges/${encodeURIComponent(intent.id)}`
    : undefined;

const hostedChallengeReturnUrlForIntent = (
  intent: PaymentIntent,
  status: 'approved' | 'declined' | 'failed',
): string | undefined => {
  const rawReturnUrl = intent.returnUrl || serviceReturnUrl({ metadata: intent.metadata });
  if (!rawReturnUrl) return undefined;
  try {
    const url = new URL(rawReturnUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    url.searchParams.set('orbi_payment_status', status);
    url.searchParams.set('payment_intent_id', intent.id);
    url.searchParams.set('order_ref', String(intent.metadata?.orderId || intent.reference || ''));
    url.searchParams.set('reference', intent.reference);
    return url.toString();
  } catch {
    return undefined;
  }
};

const challengeModeForIntent = (intent: PaymentIntent): 'hosted' | 'in_app_required' | undefined => {
  if (!intent.coreResult?.challenge) return undefined;
  const metadata = intent.coreResult.challenge.metadata || {};
  const explicit = String(metadata.challengeMode || metadata.challenge_mode || '').trim().toLowerCase();
  if (explicit === 'in_app_required') return 'in_app_required';
  if (explicit === 'hosted') return 'hosted';
  const risk = String(
    metadata.riskDecision ||
      metadata.risk_decision ||
      metadata.riskLevel ||
      metadata.risk_level ||
      '',
  ).trim().toUpperCase();
  if (['HIGH', 'CRITICAL', 'BLOCK', 'STEP_UP_APP'].includes(risk)) return 'in_app_required';
  return 'hosted';
};

const hostedChallengeResponses = new Map<string, Promise<PaymentIntent>>();

const sanitizePaymentIntent = (intent: PaymentIntent) => {
  const challengeMode = challengeModeForIntent(intent);
  const challengeUrl = hostedChallengeUrlForIntent(intent);
  return {
    id: intent.id,
    serviceCode: intent.serviceCode,
    operation: intent.operation,
    paymentCategory: intent.paymentCategory,
    paymentRail: intent.paymentRail,
    providerCode: intent.providerCode,
    reference: intent.reference,
    amount: intent.amount,
    currency: intent.currency,
    status: publicPaymentIntentStatus(intent.status),
    description: intent.description,
    customer: intent.customer,
    checkoutUrl: intent.checkoutUrl,
    challengeMode,
    challengeUrl: challengeMode === 'hosted' ? challengeUrl : undefined,
    providerReference: intent.providerResponse?.providerReference,
    providerMessage: intent.providerResponse?.message,
    coreSubmission: intent.coreSubmission,
    coreResult: intent.coreResult,
    webhookDelivery: intent.webhookDelivery,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
  };
};

const app = express();
app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => {
    (req as express.Request).rawBody = Buffer.from(buf);
  },
}));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

app.use((req, res, next) => {
  const requestId = req.get('x-request-id') || crypto.randomUUID();
  res.setHeader('x-request-id', requestId);
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ONLINE',
    service: 'orbi-payment-gateway',
    mode: config.providerMode,
    ts: Date.now(),
  });
});

app.get('/ready', async (_req, res) => {
  const providers = await adapterRegistry.readiness();
  res.json({
    success: true,
    data: {
      coreTarget: config.core.baseUrl,
      mtlsEnabled: config.mtls.enabled,
      providerMode: config.providerMode,
      providers,
    },
  });
});

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const hostedChallengeHtml = (intent: PaymentIntent, error = '') => {
  const challenge = intent.coreResult?.challenge;
  const metadata = challenge?.metadata || {};
  const merchantName = String(metadata.merchantName || metadata.serviceName || intent.serviceCode || 'ORBI service');
  const amount = `${intent.currency.toUpperCase()} ${Number(intent.amount || 0).toLocaleString('en-US')}`;
  const reference = String(metadata.reference || intent.reference || '');
  const prompt = String(challenge?.prompt || `Approve ${amount} for ${merchantName}.`);
  const expiresAt = challenge?.expiresAt ? new Date(challenge.expiresAt).toLocaleString() : '';
  const otcRequestId = String(metadata.otcRequestId || metadata.otc_request_id || '');
  const challengeId = String(challenge?.challengeId || '');
  const mode = challengeModeForIntent(intent);
  const disabled = mode === 'in_app_required';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>ORBI Payment Challenge</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:linear-gradient(135deg,#f8fafc,#e0f2fe); color:#0f172a; }
    .card { width:min(92vw,440px); background:#fff; border:1px solid #dbeafe; border-radius:28px; box-shadow:0 24px 60px rgba(15,23,42,.16); padding:26px; }
    .brand { display:flex; justify-content:center; margin:-4px 0 10px; }
    .brand img { width:min(100%,300px); height:auto; object-fit:contain; display:block; }
    .pill { display:inline-flex; padding:8px 12px; border-radius:999px; background:#eff6ff; color:#2563eb; font-weight:800; font-size:13px; margin-top:10px; }
    h1 { font-size:24px; margin:22px 0 8px; }
    p { color:#475569; line-height:1.5; }
    .amount { font-size:38px; font-weight:950; letter-spacing:-.05em; margin:18px 0 4px; }
    .ref { background:#f8fafc; border:1px solid #e2e8f0; border-radius:16px; padding:12px; font-weight:750; overflow-wrap:anywhere; }
    input { width:100%; box-sizing:border-box; margin-top:14px; padding:16px; border-radius:16px; border:1px solid #cbd5e1; font-size:22px; text-align:center; letter-spacing:.18em; font-weight:850; }
    .actions { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:18px; }
    button { border:0; border-radius:16px; padding:15px 12px; font-weight:900; font-size:15px; cursor:pointer; }
    button[disabled] { opacity:.6; cursor:progress; }
    .approve { background:#2563eb; color:#fff; }
    .reject { background:#f1f5f9; color:#0f172a; border:1px solid #cbd5e1; }
    .error { background:#fef2f2; color:#b91c1c; border:1px solid #fecaca; border-radius:14px; padding:10px 12px; margin-top:14px; }
    .note { font-size:12px; color:#64748b; margin-top:14px; }
  </style>
</head>
<body>
  <main class="card">
    <div class="brand">
      <img src="https://media-stock.orbifinancial.com/OrbiPaysafe%20Logo.png" alt="ORBI PaySafe Escrow Services" />
    </div>
    <span class="pill">Secure hosted challenge</span>
    <h1>Approve ORBI payment</h1>
    <p>${escapeHtml(prompt)}</p>
    <div class="amount">${escapeHtml(amount)}</div>
    <p>Merchant: <strong>${escapeHtml(merchantName)}</strong></p>
    ${reference ? `<div class="ref">Ref: ${escapeHtml(reference)}</div>` : ''}
    ${expiresAt ? `<p class="note">Expires: ${escapeHtml(expiresAt)}</p>` : ''}
    ${disabled ? '<div class="error">This request requires approval inside your ORBI app because extra security is needed.</div>' : ''}
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    <form method="post" action="/v1/challenges/${encodeURIComponent(intent.id)}/respond" onsubmit="if(this.dataset.submitted==='1'){return false;}this.dataset.submitted='1';for(const b of this.querySelectorAll('button')){b.disabled=true;b.textContent=b.value==='reject'?'Rejecting...':'Approving...';}return true;">
      <input type="hidden" name="challengeId" value="${escapeHtml(challengeId)}" />
      <input type="hidden" name="otcRequestId" value="${escapeHtml(otcRequestId)}" />
      ${disabled ? '' : '<input name="otcCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" required />'}
      <div class="actions">
        <button class="approve" name="decision" value="approve" ${disabled ? 'disabled' : ''}>Approve</button>
        <button class="reject" name="decision" value="reject" ${disabled ? 'disabled' : ''}>Reject</button>
      </div>
    </form>
    <p class="note">Never share this code with anyone. ORBI verifies this request directly with Core.</p>
  </main>
</body>
</html>`;
};

app.get('/challenges/:intentId', (req, res) => {
  try {
    const intent = paymentIntentStore.getById(String(req.params.intentId || ''));
    if (!intent.coreResult?.challenge) {
      return res.status(404).send('Payment challenge not found.');
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.send(hostedChallengeHtml(intent));
  } catch (e: any) {
    return res.status(404).send(escapeHtml(e.message || 'Payment challenge not found.'));
  }
});

app.post('/v1/challenges/:intentId/respond', async (req, res) => {
  let intent: PaymentIntent;
  try {
    intent = paymentIntentStore.getById(String(req.params.intentId || ''));
  } catch (e: any) {
    return res.status(404).send(escapeHtml(e.message || 'Payment challenge not found.'));
  }
  const challenge = intent.coreResult?.challenge;
  if (!challenge) return res.status(404).send('Payment challenge not found.');
  if (challengeModeForIntent(intent) === 'in_app_required') {
    return res.status(403).send(hostedChallengeHtml(intent, 'This request must be approved inside your ORBI app.'));
  }
  const decision = String(req.body?.decision || '').trim().toLowerCase() === 'reject' ? 'reject' : 'approve';
  const idempotencyKey = `hosted-${intent.id}-${decision}`;
  const responseLockKey = `${intent.id}:${decision}`;
  try {
    console.info(JSON.stringify({
      level: 'info',
      service: 'orbi-payment-gateway',
      message: 'hosted_challenge_response_started',
      intentId: intent.id,
      challengeId: challenge.challengeId,
      decision,
      hasReturnUrl: Boolean(intent.returnUrl || serviceReturnUrl({ metadata: intent.metadata })),
    }));
    let responsePromise = hostedChallengeResponses.get(responseLockKey);
    if (!responsePromise) {
      responsePromise = (async () => {
        const result = await orbiCoreClient.respondToServicePaymentChallenge({
          challengeId: String(challenge.challengeId),
          decision,
          idempotencyKey,
          otcRequestId: String(req.body?.otcRequestId || challenge.metadata?.otcRequestId || ''),
          otcCode: String(req.body?.otcCode || req.body?.code || ''),
          metadata: {
            hostedChallenge: true,
            paymentIntentId: intent.id,
            serviceCode: intent.serviceCode,
          },
        });
        const event = (result as any)?.data || result;
        return paymentIntentStore.applyCoreEvent(intent, event as ServicePaymentCoreEvent);
      })();
      hostedChallengeResponses.set(responseLockKey, responsePromise);
      responsePromise.then(() => {
        setTimeout(() => hostedChallengeResponses.delete(responseLockKey), 5000).unref?.();
      }, () => {
        setTimeout(() => hostedChallengeResponses.delete(responseLockKey), 5000).unref?.();
      });
    } else {
      console.info(JSON.stringify({
        level: 'info',
        service: 'orbi-payment-gateway',
        message: 'hosted_challenge_response_joined_inflight',
        intentId: intent.id,
        challengeId: challenge.challengeId,
        decision,
      }));
    }
    const updated = await responsePromise;
    const consentReceipt = decision === 'approve' && updated.status !== 'failed'
      ? createConsentReceiptFromHostedChallenge(consentReceiptStore, updated)
      : null;
    const returnUrl = hostedChallengeReturnUrlForIntent(
      updated,
      updated.status === 'failed' || decision === 'reject' ? 'declined' : 'approved',
    );
    console.info(JSON.stringify({
      level: 'info',
      service: 'orbi-payment-gateway',
      message: 'hosted_challenge_response_completed',
      intentId: updated.id,
      challengeId: challenge.challengeId,
      decision,
      status: updated.status,
      consentId: consentReceipt?.consentId,
      hasReturnUrl: Boolean(returnUrl),
    }));
    if (returnUrl) {
      return res.redirect(303, returnUrl);
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>ORBI Payment</title><style>body{font-family:system-ui;margin:0;min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#0f172a}.card{max-width:420px;margin:24px;padding:26px;background:#fff;border-radius:26px;box-shadow:0 20px 50px #0002}.ok{color:#16a34a}.bad{color:#dc2626}</style></head><body><main class="card"><h1 class="${updated.status === 'failed' ? 'bad' : 'ok'}">${updated.status === 'failed' ? 'Payment declined' : 'Payment approved'}</h1><p>${escapeHtml(updated.coreResult?.message || 'You may now return to checkout.')}</p><p><strong>Reference:</strong> ${escapeHtml(updated.reference)}</p></main></body></html>`);
  } catch (e: any) {
    const returnUrl = hostedChallengeReturnUrlForIntent(intent, 'failed');
    console.warn(JSON.stringify({
      level: 'warn',
      service: 'orbi-payment-gateway',
      message: 'hosted_challenge_response_failed',
      intentId: intent.id,
      challengeId: challenge.challengeId,
      decision,
      error: e.message || 'Unable to complete challenge.',
      hasReturnUrl: Boolean(returnUrl),
    }));
    if (returnUrl) {
      return res.redirect(303, returnUrl);
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.status(400).send(hostedChallengeHtml(intent, e.message || 'Unable to complete challenge.'));
  }
});

app.get('/v1/providers', async (_req, res) => {
  const providers = await adapterRegistry.readiness();
  res.json({ success: true, data: providers });
});

app.get('/v1/providers/:providerCode/health', async (req, res) => {
  try {
    const result = await adapterRegistry.get(req.params.providerCode).health();
    res.json({ success: true, data: result });
  } catch (e: any) {
    sendApiError(res, 404, errorCodeFromException(e, 'PAYMENT_PROVIDER_NOT_FOUND'));
  }
});

const requirePayServiceAccess = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const authenticated = authenticatePayServiceCredential(payServiceRegistry.activeServices(), req);
    res.locals.payService = authenticated.service;
    res.locals.payServiceCredential = authenticated.credential;
    return next();
  } catch (e: any) {
    const error = errorCodeFromException(e, 'PAY_SERVICE_ACCESS_DENIED');
    const status = error === 'PAY_SERVICE_AUTH_FAILED' ? 403 : 404;
    return sendApiError(res, status, error);
  }
};

app.get('/v1/service-profile', requirePayServiceAccess, (_req, res) => {
  const service = res.locals.payService as PayServiceDefinition;
  res.json({ success: true, data: payServiceRegistry.publicView(service) });
});

const submitPaymentIntentToCore = async (service: PayServiceDefinition, intent: PaymentIntent) => {
  const merchantContext = serviceMerchantContext(service);
  const request = buildCoreServicePaymentRequest({
    ...intent,
    metadata: {
      ...intent.metadata,
      serviceCode: service.code,
      paymentIntentId: intent.id,
      merchantContext,
      merchantId: merchantContext.merchantId,
      feeProfileCode: merchantContext.feeProfileCode,
      feeFlowCode: merchantContext.feeFlowCode,
      customerEmail: intent.customer?.email,
      customerUserId: intent.customer?.userId,
      gatewayRole: 'service-intake',
    },
  });

  try {
    const coreResult = await orbiCoreClient.submitServicePaymentRequest(request);
    const coreEvent = (coreResult as any)?.data;
    if (
      coreEvent &&
      coreEvent.intentId === intent.id &&
      coreEvent.serviceCode === service.code &&
      typeof coreEvent.status === 'string'
    ) {
      return {
        intent: paymentIntentStore.applyCoreEvent(intent, coreEvent),
        coreResult,
      };
    }

    return {
      intent: paymentIntentStore.markSubmittedToCore(intent, coreResult),
      coreResult,
    };
  } catch (e: any) {
    const failedIntent = paymentIntentStore.markCoreSubmissionFailed(intent, e.message || 'CORE_SERVICE_PAYMENT_REQUEST_FAILED');
    throw Object.assign(new Error(e.message || 'CORE_SERVICE_PAYMENT_REQUEST_FAILED'), { intent: failedIntent });
  }
};

const createPaymentIntentForService = async (
  req: express.Request,
  res: express.Response,
  payload: ServicePaymentIntentPayload,
) => {
  try {
    const service = res.locals.payService as PayServiceDefinition;
    const currency = payload.currency.toUpperCase();
    const gatewayEnvironment = assertFinancialRuntimeRequest(req, res, payload as Record<string, unknown>);
    const idempotencyKey = requestIdempotencyKey(req, payload as Record<string, unknown>);
    const idempotencyFingerprint = idempotencyKey ? paymentIntentFingerprint({ ...payload, currency }) : undefined;
    assertServicePaymentAllowed(service, payload.operation, currency);
    const returnUrl = serviceReturnUrl(payload as Record<string, unknown>);
    assertDeveloperPortalUrlAllowlists(service, payload as Record<string, unknown>, returnUrl);
    const paySafeRoute = payload.operation === 'paysafe'
      ? normalizePaySafePaymentRoute(payload)
      : null;

    const intent = paymentIntentStore.create({
      service,
      operation: payload.operation,
      paymentCategory: paySafeRoute?.paymentCategory || payload.paymentCategory,
      paymentRail: paySafeRoute?.paymentRail || payload.paymentRail,
      providerCode: paySafeRoute?.providerCode || payload.providerCode,
      reference: payload.reference,
      amount: payload.amount,
      currency,
      description: payload.description,
      customer: payload.customer,
      walletId: payload.walletId,
      accountNumber: payload.accountNumber,
      returnUrl,
      idempotencyKey,
      idempotencyFingerprint,
      metadata: {
        ...(payload.metadata || {}),
        ...(gatewayEnvironment ? { gatewayEnvironment } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        ...(returnUrl ? { returnUrl } : {}),
        ...(paySafeRoute ? {
          paymentCategory: paySafeRoute.paymentCategory,
          paymentRail: paySafeRoute.paymentRail,
          providerCode: paySafeRoute.providerCode || null,
          routingContractVersion: paySafeRoute.routingContractVersion,
          settlementPolicy: 'paysafe_hold_required',
        } : {}),
      },
    });

    if (!payload.confirm) {
      return res.status(201).json({ success: true, data: sanitizePaymentIntent(intent) });
    }

    const confirmed = await submitPaymentIntentToCore(service, intent);
    return res.status(201).json({
      success: true,
      data: sanitizePaymentIntent(confirmed.intent),
      core: confirmed.coreResult,
    });
  } catch (e: any) {
    logger.error('payment_intent_create_failed', {
      serviceCode: (res.locals.payService as PayServiceDefinition | undefined)?.code,
      error: e.message,
    });
    const error = errorCodeFromException(e, 'PAYMENT_INTENT_CREATE_FAILED');
    return sendApiError(res, isMerchantPaymentRequestError(error) ? 400 : httpStatusForGatewayError(error), error, {
      data: e.intent ? sanitizePaymentIntent(e.intent) : undefined,
    });
  }
};

app.post('/v1/payment-intents', requirePayServiceAccess, async (req, res) => {
  const parsed = PaymentIntentCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, 'PAYMENT_INTENT_INVALID', parsed.error.issues);
  }

  return createPaymentIntentForService(req, res, parsed.data);
});

app.get('/v1/payment-intents/:intentId', requirePayServiceAccess, (req, res) => {
  try {
    const service = res.locals.payService as PayServiceDefinition;
    const intent = paymentIntentStore.get(service.code, String(req.params.intentId || ''));
    return res.json({ success: true, data: sanitizePaymentIntent(intent) });
  } catch (e: any) {
    return sendApiError(res, 404, errorCodeFromException(e, 'PAYMENT_INTENT_NOT_FOUND'));
  }
});

app.post('/v1/payment-intents/:intentId/confirm', requirePayServiceAccess, async (req, res) => {
  try {
    const service = res.locals.payService as PayServiceDefinition;
    assertFinancialRuntimeRequest(req, res, req.body as Record<string, unknown>);
    const intent = paymentIntentStore.get(service.code, String(req.params.intentId || ''));
    if (!['requires_confirmation', 'pending', 'failed'].includes(intent.status)) {
      return sendApiError(res, 409, 'PAYMENT_INTENT_ALREADY_FINALIZED');
    }

    const confirmed = await submitPaymentIntentToCore(service, intent);
    return res.json({ success: true, data: sanitizePaymentIntent(confirmed.intent), core: confirmed.coreResult });
  } catch (e: any) {
    logger.error('payment_intent_confirm_failed', {
      serviceCode: (res.locals.payService as PayServiceDefinition | undefined)?.code,
      error: e.message,
    });
    const error = errorCodeFromException(e, 'PAYMENT_INTENT_CONFIRM_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error, {
      data: e.intent ? sanitizePaymentIntent(e.intent) : undefined,
    });
  }
});

app.post('/v1/paysafe/escrows', requirePayServiceAccess, async (req, res) => {
  const parsed = PaySafeEscrowCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, 'PAYSAFE_ESCROW_INVALID', parsed.error.issues);
  }

  const buyerType = String(
    parsed.data.buyer?.type ||
      (parsed.data.metadata?.guestCheckout === true ? 'guest' : '') ||
      '',
  ).trim();
  const guestCheckout = buyerType === 'guest' || buyerType === 'external_customer';

  return createPaymentIntentForService(req, res, {
    operation: 'paysafe',
    paymentCategory: parsed.data.paymentCategory,
    paymentRail: parsed.data.paymentRail,
    providerCode: parsed.data.providerCode,
    idempotencyKey: parsed.data.idempotencyKey || parsed.data.idempotency_key,
    idempotency_key: parsed.data.idempotency_key || parsed.data.idempotencyKey,
    reference: parsed.data.reference,
    amount: parsed.data.amount,
    currency: parsed.data.currency,
    confirm: parsed.data.confirm,
    description: parsed.data.description || 'ORBI PaySafe escrow hold',
    customer: parsed.data.buyer,
    returnUrl: parsed.data.returnUrl || parsed.data.return_url || parsed.data.callbackUrl || parsed.data.callback_url || parsed.data.redirectUrl || parsed.data.redirect_url,
    metadata: {
      ...(parsed.data.metadata || {}),
      paymentProduct: 'paysafe',
      paySafeAction: 'create_escrow',
      customerType: buyerType || (parsed.data.buyer?.userId ? 'user' : undefined),
      guestCheckout,
      buyer: parsed.data.buyer || null,
      seller: parsed.data.seller || null,
    },
  });
});

const paySafeActionHandler = (action: 'release' | 'dispute' | 'refund') => async (req: express.Request, res: express.Response) => {
  const parsed = PaySafeEscrowActionSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, 'PAYSAFE_ACTION_INVALID', parsed.error.issues);
  }

  return createPaymentIntentForService(req, res, {
    operation: 'paysafe',
    idempotencyKey: parsed.data.idempotencyKey || parsed.data.idempotency_key,
    idempotency_key: parsed.data.idempotency_key || parsed.data.idempotencyKey,
    reference: parsed.data.reference,
    amount: parsed.data.amount ?? 0,
    currency: parsed.data.currency || 'TZS',
    confirm: true,
    description: parsed.data.reason || `ORBI PaySafe ${action}`,
    customer: parsed.data.customer,
    metadata: {
      ...(parsed.data.metadata || {}),
      paymentProduct: 'paysafe',
      paySafeAction: action,
      escrowId: String(req.params.escrowId || ''),
      reason: parsed.data.reason || null,
    },
  });
};

app.post('/v1/paysafe/escrows/:escrowId/release', requirePayServiceAccess, paySafeActionHandler('release'));
app.post('/v1/paysafe/escrows/:escrowId/dispute', requirePayServiceAccess, paySafeActionHandler('dispute'));
app.post('/v1/paysafe/escrows/:escrowId/refund', requirePayServiceAccess, paySafeActionHandler('refund'));

const queryPaySafeBalancesForService = async (req: express.Request, res: express.Response, input: unknown) => {
  const parsed = PaySafeBalanceQuerySchema.safeParse(input);
  if (!parsed.success) {
    return sendValidationError(res, 'PAYSAFE_BALANCE_QUERY_INVALID', parsed.error.issues);
  }

  try {
    const service = res.locals.payService as PayServiceDefinition;
    const subjectId = subjectIdForConsent(parsed.data);
    serviceConsentGuard.assertScopedConsent(service, 'balance:read', {
      subjectId,
      environment: 'live',
    });
    const merchantContext = serviceMerchantContext(service);
    const coreResult = await orbiCoreClient.queryPaySafeBalances({
      serviceCode: service.code,
      ...parsed.data,
      metadata: {
        ...(parsed.data.metadata || {}),
        merchantContext,
        merchantId: merchantContext.merchantId,
        gatewayRole: 'service-paysafe-balance-read',
      },
    });
    return res.json(coreResult);
  } catch (e: any) {
    logger.error('paysafe_balance_query_failed', {
      serviceCode: (res.locals.payService as PayServiceDefinition | undefined)?.code,
      error: e.message,
    });
    const error = errorCodeFromException(e, 'PAYSAFE_BALANCE_QUERY_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
};

app.get('/v1/paysafe/users/:userId/balance', requirePayServiceAccess, async (req, res) =>
  queryPaySafeBalancesForService(req, res, {
    userId: String(req.params.userId || '').trim(),
    includeHistory: req.query.includeHistory,
  }),
);

app.get('/v1/paysafe/balances', requirePayServiceAccess, async (req, res) =>
  queryPaySafeBalancesForService(req, res, {
    userId: req.query.userId,
    customerId: req.query.customerId,
    email: req.query.email,
    phone: req.query.phone,
    includeHistory: req.query.includeHistory,
  }),
);

app.post('/v1/identity/resolve', requirePayServiceAccess, async (req, res) => {
  const parsed = IdentityResolveSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, 'IDENTITY_RESOLVE_INVALID', parsed.error.issues);
  }

  try {
    const service = res.locals.payService as PayServiceDefinition;
    serviceConsentGuard.assertServiceScopeGranted(service, 'identity:resolve');
    const coreResult = await orbiCoreClient.resolveIdentity({
      serviceCode: service.code,
      identifier: parsed.data.identifier,
      metadata: {
        ...(parsed.data.metadata || {}),
        gatewayRole: 'service-identity-resolve',
      },
    });
    return res.json(coreResult);
  } catch (e: any) {
    logger.error('identity_resolve_failed', {
      serviceCode: (res.locals.payService as PayServiceDefinition | undefined)?.code,
      error: e.message,
    });
    const error = errorCodeFromException(e, 'IDENTITY_RESOLVE_FAILED');
    return sendApiError(res, error === 'IDENTITY_NOT_FOUND' ? 404 : httpStatusForGatewayError(error), error);
  }
});

app.post('/v1/business/registrations', requirePayServiceAccess, async (req, res) => {
  const parsed = BusinessRegistrationSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, 'BUSINESS_REGISTRATION_INVALID', parsed.error.issues);
  }

  try {
    const service = res.locals.payService as PayServiceDefinition;
    const body = parsed.data;
    const coreResult = await orbiCoreClient.submitBusinessRegistration({
      serviceCode: service.code,
      userId: body.userId,
      email: body.email,
      phone: body.phone,
      requestedRole: body.requestedRole || body.requested_role || 'MERCHANT',
      businessName: body.businessName || body.business_name,
      externalBusinessId: body.externalBusinessId || body.external_business_id,
      note: body.note,
      metadata: {
        ...(body.metadata || {}),
        gatewayRole: 'service-business-registration',
        gatewayServiceName: service.displayName,
        gatewayServiceCode: service.code,
      },
    });
    return res.json(coreResult);
  } catch (e: any) {
    logger.error('business_registration_failed', {
      serviceCode: (res.locals.payService as PayServiceDefinition | undefined)?.code,
      error: e.message,
    });
    const error = errorCodeFromException(e, 'BUSINESS_REGISTRATION_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.post('/v1/payment-profiles', requirePayServiceAccess, async (req, res) => {
  const parsed = PaymentProfileCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, 'PAYMENT_PROFILE_INVALID', parsed.error.issues);
  }

  try {
    const service = res.locals.payService as PayServiceDefinition;
    const body = parsed.data;
    serviceConsentGuard.assertServiceScopeGranted(service, 'payment_profile:create');
    const subjectId = subjectIdForConsent(body);
    serviceConsentGuard.assertActiveConsent(service, {
      subjectId,
      scopes: body.scopes,
      environment: 'live',
    });
    const idempotencyKey = requestIdempotencyKey(req, body as Record<string, unknown>);
    const coreResult = await orbiCoreClient.createPaymentProfile({
      serviceCode: service.code,
      userId: body.userId,
      customerId: body.customerId,
      email: body.email,
      phone: body.phone,
      externalCustomerId: body.externalCustomerId || body.external_customer_id,
      scopes: body.scopes,
      consent: body.consent || {},
      expiresAt: body.expiresAt || body.expires_at,
      idempotencyKey,
      metadata: {
        ...(body.metadata || {}),
        gatewayRole: 'service-payment-profile',
        gatewayServiceName: service.displayName,
        gatewayServiceCode: service.code,
      },
    });
    return res.json(coreResult);
  } catch (e: any) {
    logger.error('payment_profile_failed', {
      serviceCode: (res.locals.payService as PayServiceDefinition | undefined)?.code,
      error: e.message,
    });
    const error = errorCodeFromException(e, 'PAYMENT_PROFILE_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.get('/v1/merchant/paysafe/balance', requirePayServiceAccess, async (req, res) => {
  try {
    const service = res.locals.payService as PayServiceDefinition;
    const merchantContext = requireServiceMerchantContext(service);
    const coreResult = await orbiCoreClient.queryPaySafeBalances({
      serviceCode: service.code,
      merchantId: merchantContext.merchantId,
      includeHistory: req.query.includeHistory === 'true',
      metadata: {
        merchantContext,
        merchantId: merchantContext.merchantId,
        gatewayRole: 'merchant-paysafe-balance-read',
      },
    });
    return res.json(coreResult);
  } catch (e: any) {
    const error = errorCodeFromException(e, 'MERCHANT_PAYSAFE_BALANCE_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.get('/v1/merchant/orders/:orderId/payment-status', requirePayServiceAccess, async (req, res) => {
  try {
    const service = res.locals.payService as PayServiceDefinition;
    const merchantContext = requireServiceMerchantContext(service);
    const orderId = String(req.params.orderId || '').trim();
    if (!orderId) return sendApiError(res, 400, 'ORDER_ID_REQUIRED');
    const coreResult = await orbiCoreClient.queryMerchantOrderPaymentStatus({
      serviceCode: service.code,
      merchantId: merchantContext.merchantId,
      orderId,
      metadata: {
        merchantContext,
        gatewayRole: 'merchant-order-payment-status-read',
      },
    });
    return res.json(coreResult);
  } catch (e: any) {
    const error = errorCodeFromException(e, 'MERCHANT_ORDER_PAYMENT_STATUS_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.get('/v1/merchant/settlements', requirePayServiceAccess, async (req, res) => {
  const parsed = MerchantSettlementsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendValidationError(res, 'MERCHANT_SETTLEMENTS_QUERY_INVALID', parsed.error.issues);
  }

  try {
    const service = res.locals.payService as PayServiceDefinition;
    const merchantContext = requireServiceMerchantContext(service);
    const coreResult = await orbiCoreClient.queryMerchantSettlements({
      serviceCode: service.code,
      merchantId: merchantContext.merchantId,
      ...parsed.data,
      metadata: {
        merchantContext,
        gatewayRole: 'merchant-settlements-read',
      },
    });
    return res.json(coreResult);
  } catch (e: any) {
    const error = errorCodeFromException(e, 'MERCHANT_SETTLEMENTS_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.post('/v1/internal/core/service-payment-events', async (req, res) => {
  try {
    verifySignedInternalHeaders({
      method: req.method,
      path: req.path,
      body: req.body,
      workerId: '',
      scopes: [],
      signingSecret: config.worker.signingSecret,
      headers: req.headers,
      requiredScope: 'gateway:service-payments:result',
    });

    const event = CoreServicePaymentEventSchema.parse(req.body) as ServicePaymentCoreEvent;
    const service = payServiceRegistry.get(event.serviceCode);
    const intent = paymentIntentStore.get(service.code, event.intentId);
    const updatedIntent = paymentIntentStore.applyCoreEvent(intent, event);
    const webhookDelivery = await deliverServiceWebhook(service, updatedIntent);
    if (webhookDelivery.attempted) {
      webhookDeliveryStore.record({
        eventId: webhookDelivery.eventId || crypto.randomUUID(),
        serviceCode: service.code,
        intentId: updatedIntent.id,
        eventType: webhookDelivery.eventType || 'payment_intent.updated',
        payload: webhookDelivery.payload,
        callbackUrl: webhookDelivery.callbackUrl,
        status: webhookDelivery.delivered ? 'delivered' : 'failed',
        attempt: 1,
        statusCode: webhookDelivery.statusCode,
        error: webhookDelivery.error,
      });
    }
    const deliveredIntent = paymentIntentStore.applyWebhookDelivery(updatedIntent, webhookDelivery);

    return res.json({
      success: true,
      data: sanitizePaymentIntent(deliveredIntent),
    });
  } catch (e: any) {
    logger.error('core_service_payment_event_failed', { error: e.message });
    const error = errorCodeFromException(e, 'CORE_SERVICE_PAYMENT_EVENT_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error, 403), error);
  }
});

const requireOperatorDiscoveryAccess = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!config.operatorDiscoveryApiKey && config.env !== 'production') return next();

  const provided = req.get('x-orbi-pay-operator-key') || req.get('x-api-key') || '';
  if (!config.operatorDiscoveryApiKey || provided !== config.operatorDiscoveryApiKey) {
    return sendApiError(res, 403, 'PAY_GATEWAY_DISCOVERY_ACCESS_DENIED');
  }

  return next();
};

app.get('/v1/consents', requireConsentSubjectAccess, (req, res) => {
  try {
    const query = ConnectedConsentsQuerySchema.parse(req.query);
    const subject = res.locals.consentSubject as { subjectId: string; subjectType: 'user' | 'business' };
    const locale = query.locale || 'en';
    const receipts = consentReceiptStore
      .list({ subjectId: subject.subjectId, status: query.status })
      .filter((receipt) => receipt.subjectType === subject.subjectType)
      .map((receipt) => presentConsentReceipt(receipt, locale));
    return res.json({ success: true, data: receipts });
  } catch (e: any) {
    if (e instanceof z.ZodError) return sendValidationError(res, 'CONNECTED_CONSENTS_QUERY_INVALID', e.issues);
    const error = errorCodeFromException(e, 'CONNECTED_CONSENTS_QUERY_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.get('/v1/consents/:consentId', requireConsentSubjectAccess, (req, res) => {
  try {
    const query = ConnectedConsentsQuerySchema.pick({ locale: true }).parse(req.query);
    const subject = res.locals.consentSubject as { subjectId: string; subjectType: 'user' | 'business' };
    const receipt = consentReceiptStore.get(String(req.params.consentId || ''));
    if (receipt.subjectId !== subject.subjectId || receipt.subjectType !== subject.subjectType) {
      return sendApiError(res, 404, 'CONSENT_RECEIPT_NOT_FOUND');
    }
    return res.json({ success: true, data: presentConsentReceipt(receipt, query.locale || 'en') });
  } catch (e: any) {
    if (e instanceof z.ZodError) return sendValidationError(res, 'CONNECTED_CONSENT_QUERY_INVALID', e.issues);
    const error = errorCodeFromException(e, 'CONSENT_RECEIPT_NOT_FOUND');
    return sendApiError(res, httpStatusForGatewayError(error, 404), error);
  }
});

app.post('/v1/consents/:consentId/revoke', requireConsentSubjectAccess, (req, res) => {
  try {
    const subject = res.locals.consentSubject as { subjectId: string; subjectType: 'user' | 'business' };
    const existing = consentReceiptStore.get(String(req.params.consentId || ''));
    if (existing.subjectId !== subject.subjectId || existing.subjectType !== subject.subjectType) {
      return sendApiError(res, 404, 'CONSENT_RECEIPT_NOT_FOUND');
    }
    const payload = ConsentRevocationSchema.parse({
      ...(req.body || {}),
      revokedBy: subject.subjectId,
      reason: String(req.body?.reason || 'Subject revoked connected service consent.'),
    });
    const receipt = consentReceiptStore.revoke(existing.consentId, payload);
    deliverConsentRevocationWebhook(receipt);
    return res.json({ success: true, data: presentConsentReceipt(receipt, existing.context.locale || 'en') });
  } catch (e: any) {
    if (e instanceof z.ZodError) return sendValidationError(res, 'CONNECTED_CONSENT_REVOCATION_INVALID', e.issues);
    const error = errorCodeFromException(e, 'CONNECTED_CONSENT_REVOCATION_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.get('/v1/services', requireOperatorDiscoveryAccess, (_req, res) => {
  res.json({ success: true, data: payServiceRegistry.list() });
});

const DeveloperServiceApproveSchema = z.object({
  serviceCode: z.string().trim().min(2).max(80).optional(),
  initialStatus: z.enum(['draft', 'active']).optional(),
});

app.post('/v1/developer/service-applications', requireOperatorDiscoveryAccess, async (req, res) => {
  try {
    const payload = DeveloperServiceApplicationSchema.parse(req.body || {});
    const application = await developerPortalStore.submitApplication(payload);
    return res.status(201).json({ success: true, data: application });
  } catch (e: any) {
    if (e instanceof z.ZodError) return sendValidationError(res, 'DEVELOPER_SERVICE_APPLICATION_INVALID', e.issues);
    return sendApiError(res, httpStatusForGatewayError(errorCodeFromException(e, 'DEVELOPER_SERVICE_APPLICATION_FAILED')), errorCodeFromException(e, 'DEVELOPER_SERVICE_APPLICATION_FAILED'));
  }
});

app.get('/v1/developer/service-applications', requireOperatorDiscoveryAccess, (req, res) => {
  const status = String(req.query.status || '').trim() || undefined;
  return res.json({ success: true, data: developerPortalStore.listApplications(status) });
});

app.post('/v1/developer/service-applications/:applicationId/approve', requireOperatorDiscoveryAccess, async (req, res) => {
  try {
    const payload = DeveloperServiceApproveSchema.parse(req.body || {});
    const service = await developerPortalStore.approveApplication(String(req.params.applicationId || ''), payload);
    return res.json({ success: true, data: service });
  } catch (e: any) {
    if (e instanceof z.ZodError) return sendValidationError(res, 'DEVELOPER_SERVICE_APPROVAL_INVALID', e.issues);
    const error = errorCodeFromException(e, 'DEVELOPER_SERVICE_APPROVAL_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.get('/v1/developer/services', requireOperatorDiscoveryAccess, (_req, res) => {
  return res.json({ success: true, data: developerPortalStore.listServices() });
});

app.get('/v1/developer/services/:serviceCode', requireOperatorDiscoveryAccess, (req, res) => {
  try {
    return res.json({ success: true, data: developerPortalStore.getService(String(req.params.serviceCode || '')) });
  } catch (e: any) {
    const error = errorCodeFromException(e, 'DEVELOPER_SERVICE_NOT_FOUND');
    return sendApiError(res, httpStatusForGatewayError(error, 404), error);
  }
});

app.post('/v1/developer/services/:serviceCode/scope-requests', requireOperatorDiscoveryAccess, async (req, res) => {
  try {
    const payload = DeveloperScopeRequestSchema.parse(req.body || {});
    const record = await developerPortalStore.submitScopeRequest(String(req.params.serviceCode || ''), payload);
    return res.status(201).json({ success: true, data: record });
  } catch (e: any) {
    if (e instanceof z.ZodError) return sendValidationError(res, 'DEVELOPER_SCOPE_REQUEST_INVALID', e.issues);
    const error = errorCodeFromException(e, 'DEVELOPER_SCOPE_REQUEST_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.post('/v1/developer/scope-requests/:requestId/decision', requireOperatorDiscoveryAccess, async (req, res) => {
  try {
    const payload = DeveloperScopeDecisionSchema.parse(req.body || {});
    const result = await developerPortalStore.decideScopeRequest(String(req.params.requestId || ''), payload);
    return res.json({ success: true, data: result });
  } catch (e: any) {
    if (e instanceof z.ZodError) return sendValidationError(res, 'DEVELOPER_SCOPE_DECISION_INVALID', e.issues);
    const error = errorCodeFromException(e, 'DEVELOPER_SCOPE_DECISION_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.post('/v1/developer/services/:serviceCode/allowlists', requireOperatorDiscoveryAccess, async (req, res) => {
  try {
    const payload = DeveloperAllowlistUpdateSchema.parse(req.body || {});
    const result = await developerPortalStore.applyAllowlistUpdate(String(req.params.serviceCode || ''), payload);
    return res.json({ success: true, data: result });
  } catch (e: any) {
    if (e instanceof z.ZodError) return sendValidationError(res, 'DEVELOPER_ALLOWLIST_INVALID', e.issues);
    const error = errorCodeFromException(e, 'DEVELOPER_ALLOWLIST_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.post('/v1/developer/services/:serviceCode/api-key-rotations', requireOperatorDiscoveryAccess, async (req, res) => {
  try {
    const payload = DeveloperApiKeyRotationRequestSchema.parse(req.body || {});
    const record = await developerPortalStore.requestApiKeyRotation(String(req.params.serviceCode || ''), payload);
    return res.status(202).json({ success: true, data: record });
  } catch (e: any) {
    if (e instanceof z.ZodError) return sendValidationError(res, 'DEVELOPER_API_KEY_ROTATION_INVALID', e.issues);
    const error = errorCodeFromException(e, 'DEVELOPER_API_KEY_ROTATION_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.post('/v1/developer/services/:serviceCode/api-keys/issue', requireOperatorDiscoveryAccess, async (req, res) => {
  try {
    const payload = DeveloperSecretIssueRequestSchema.parse(req.body || {});
    const result = await developerPortalStore.issueApiKey(String(req.params.serviceCode || ''), payload);
    return res.status(201).json({ success: true, data: result });
  } catch (e: any) {
    if (e instanceof z.ZodError) return sendValidationError(res, 'DEVELOPER_API_KEY_ISSUE_INVALID', e.issues);
    const error = errorCodeFromException(e, 'DEVELOPER_API_KEY_ISSUE_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.post('/v1/developer/api-key-rotations/:rotationId/decision', requireOperatorDiscoveryAccess, async (req, res) => {
  try {
    const payload = DeveloperApiKeyRotationDecisionSchema.parse(req.body || {});
    const result = await developerPortalStore.decideApiKeyRotation(String(req.params.rotationId || ''), payload);
    return res.json({ success: true, data: result });
  } catch (e: any) {
    if (e instanceof z.ZodError) return sendValidationError(res, 'DEVELOPER_API_KEY_ROTATION_DECISION_INVALID', e.issues);
    const error = errorCodeFromException(e, 'DEVELOPER_API_KEY_ROTATION_DECISION_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.post('/v1/developer/services/:serviceCode/webhook-secret-rotations', requireOperatorDiscoveryAccess, async (req, res) => {
  try {
    const payload = DeveloperWebhookSecretRotationRequestSchema.parse(req.body || {});
    const record = await developerPortalStore.requestWebhookSecretRotation(String(req.params.serviceCode || ''), payload);
    return res.status(202).json({ success: true, data: record });
  } catch (e: any) {
    if (e instanceof z.ZodError) return sendValidationError(res, 'DEVELOPER_WEBHOOK_SECRET_ROTATION_INVALID', e.issues);
    const error = errorCodeFromException(e, 'DEVELOPER_WEBHOOK_SECRET_ROTATION_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.post('/v1/developer/webhook-secret-rotations/:rotationId/decision', requireOperatorDiscoveryAccess, async (req, res) => {
  try {
    const payload = DeveloperApiKeyRotationDecisionSchema.parse(req.body || {});
    const result = await developerPortalStore.decideWebhookSecretRotation(String(req.params.rotationId || ''), payload);
    return res.json({ success: true, data: result });
  } catch (e: any) {
    if (e instanceof z.ZodError) return sendValidationError(res, 'DEVELOPER_WEBHOOK_SECRET_ROTATION_DECISION_INVALID', e.issues);
    const error = errorCodeFromException(e, 'DEVELOPER_WEBHOOK_SECRET_ROTATION_DECISION_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.post('/v1/developer/services/:serviceCode/webhook-secrets/issue', requireOperatorDiscoveryAccess, async (req, res) => {
  try {
    const payload = DeveloperSecretIssueRequestSchema.parse(req.body || {});
    const result = await developerPortalStore.issueWebhookSecret(String(req.params.serviceCode || ''), payload);
    return res.status(201).json({ success: true, data: result });
  } catch (e: any) {
    if (e instanceof z.ZodError) return sendValidationError(res, 'DEVELOPER_WEBHOOK_SECRET_ISSUE_INVALID', e.issues);
    const error = errorCodeFromException(e, 'DEVELOPER_WEBHOOK_SECRET_ISSUE_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.get('/v1/developer/events', requireOperatorDiscoveryAccess, (req, res) => {
  const serviceCode = String(req.query.serviceCode || '').trim() || undefined;
  return res.json({ success: true, data: developerPortalStore.listEvents(serviceCode) });
});

app.post('/v1/developer/consent-receipts', requireOperatorDiscoveryAccess, (req, res) => {
  try {
    const payload = ConsentReceiptCreateSchema.parse(req.body || {});
    const receipt = consentReceiptStore.create(payload);
    return res.status(201).json({ success: true, data: receipt });
  } catch (e: any) {
    if (e instanceof z.ZodError) return sendValidationError(res, 'CONSENT_RECEIPT_INVALID', e.issues);
    const error = errorCodeFromException(e, 'CONSENT_RECEIPT_CREATE_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.get('/v1/developer/consent-receipts', requireOperatorDiscoveryAccess, (req, res) => {
  const serviceCode = String(req.query.serviceCode || '').trim() || undefined;
  const subjectId = String(req.query.subjectId || '').trim() || undefined;
  const status = String(req.query.status || '').trim() || undefined;
  return res.json({
    success: true,
    data: consentReceiptStore.list({ serviceCode, subjectId, status }),
  });
});

app.get('/v1/developer/consent-receipts/:consentId', requireOperatorDiscoveryAccess, (req, res) => {
  try {
    return res.json({
      success: true,
      data: consentReceiptStore.get(String(req.params.consentId || '')),
    });
  } catch (e: any) {
    const error = errorCodeFromException(e, 'CONSENT_RECEIPT_NOT_FOUND');
    return sendApiError(res, httpStatusForGatewayError(error, 404), error);
  }
});

app.post('/v1/developer/consent-receipts/:consentId/revoke', requireOperatorDiscoveryAccess, (req, res) => {
  try {
    const payload = ConsentRevocationSchema.parse(req.body || {});
    const receipt = consentReceiptStore.revoke(String(req.params.consentId || ''), payload);
    deliverConsentRevocationWebhook(receipt);
    return res.json({ success: true, data: receipt });
  } catch (e: any) {
    if (e instanceof z.ZodError) return sendValidationError(res, 'CONSENT_REVOCATION_INVALID', e.issues);
    const error = errorCodeFromException(e, 'CONSENT_REVOCATION_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.get('/v1/developer/integration-health', requireOperatorDiscoveryAccess, async (req, res) => {
  try {
    const serviceCode = String(req.query.serviceCode || '').trim() || undefined;
    const data = await buildDeveloperHealthSummary(serviceCode);
    return res.json({ success: true, data });
  } catch (e: any) {
    const error = errorCodeFromException(e, 'DEVELOPER_INTEGRATION_HEALTH_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.get('/v1/developer/docs-catalog', requireOperatorDiscoveryAccess, (_req, res) => {
  return res.json({ success: true, data: developerDocsCatalog() });
});

app.get('/v1/developer/sandbox-tools', requireOperatorDiscoveryAccess, (_req, res) => {
  return res.json({ success: true, data: developerSandboxToolsCatalog() });
});

app.get('/v1/developer/environment-profiles', requireOperatorDiscoveryAccess, (_req, res) => {
  return res.json({
    success: true,
    data: {
      profiles: developerEnvironmentProfiles(),
      separation: developerEnvironmentSeparationMatrix(),
    },
  });
});

app.get('/v1/developer/environment-profiles/:environment', requireOperatorDiscoveryAccess, (req, res) => {
  try {
    return res.json({
      success: true,
      data: developerEnvironmentProfile(String(req.params.environment || '') as any),
    });
  } catch (e: any) {
    const error = errorCodeFromException(e, 'DEVELOPER_ENVIRONMENT_NOT_FOUND');
    return sendApiError(res, httpStatusForGatewayError(error, 404), error);
  }
});

app.get('/v1/developer/sandbox-simulator', requireOperatorDiscoveryAccess, (_req, res) => {
  return res.json({
    success: true,
    data: {
      environment: 'sandbox',
      title: 'Sandbox Simulator Flow',
      warning: 'This flow is for simulated integration only. It must not create live ledger movement.',
      steps: [
        {
          order: 1,
          name: 'Create sandbox payment intent',
          endpoint: 'POST /v1/payment-intents',
          keyType: 'orbi_sandbox_* service key',
          idempotencyRequired: true,
        },
        {
          order: 2,
          name: 'Open hosted challenge',
          endpoint: 'challengeUrl from payment intent response',
          result: 'approve or decline using test identity/challenge data',
        },
        {
          order: 3,
          name: 'Receive signed webhook',
          eventTypes: ['payment_intent.updated', 'consent.revoked'],
          verification: 'verifyAndParseOrbiWebhook() then handleOrbiWebhookEvent()',
        },
        {
          order: 4,
          name: 'Reconcile intent state',
          endpoint: 'GET /v1/payment-intents/:intentId',
          truthRule: 'Webhook plus intent read is payment truth; return URL is UX only.',
        },
        {
          order: 5,
          name: 'Replay failed webhook',
          endpoint: 'POST /v1/developer/webhook-deliveries/:deliveryId/replay',
          sdkMethod: 'replayWebhookDelivery() or replayFailedWebhookDeliveries()',
        },
      ],
      livePromotionChecklist: [
        'Service is approved for live environment.',
        'Live scopes are approved.',
        'Live redirect and webhook URLs are allowlisted.',
        'Live API key and webhook secret are issued and stored server-side.',
        'Merchant webhook receiver verifies signatures and dedupes eventId.',
        'Every financial request uses stable idempotency keys.',
      ],
    },
  });
});

app.get('/v1/developer/sandbox-simulator/state', requireOperatorDiscoveryAccess, (_req, res) => {
  return res.json({ success: true, data: sandboxSimulatorStore.snapshot() });
});

app.post('/v1/developer/sandbox-simulator/reset', requireOperatorDiscoveryAccess, (_req, res) => {
  return res.json({ success: true, data: sandboxSimulatorStore.reset() });
});

app.get('/v1/developer/sandbox-simulator/accounts', requireOperatorDiscoveryAccess, (_req, res) => {
  return res.json({ success: true, data: sandboxSimulatorStore.listAccounts() });
});

app.post('/v1/developer/sandbox-simulator/transfers', requireOperatorDiscoveryAccess, (req, res) => {
  try {
    const payload = SandboxTransferSchema.parse(req.body || {});
    return res.status(201).json({ success: true, data: sandboxSimulatorStore.createTransfer(payload) });
  } catch (e: any) {
    if (e instanceof z.ZodError) return sendValidationError(res, 'SANDBOX_TRANSFER_INVALID', e.issues);
    const error = errorCodeFromException(e, 'SANDBOX_TRANSFER_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.post('/v1/developer/sandbox-simulator/transfers/:transferId/webhook-event', requireOperatorDiscoveryAccess, (req, res) => {
  try {
    return res.json({
      success: true,
      data: sandboxSimulatorStore.buildWebhookEvent(String(req.params.transferId || '')),
    });
  } catch (e: any) {
    const error = errorCodeFromException(e, 'SANDBOX_WEBHOOK_EVENT_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.get('/v1/developer/graphql/schema', requireOperatorDiscoveryAccess, (_req, res) => {
  return res.type('text/plain').send(graphqlGatewaySchema);
});

app.get('/v1/developer/graphql/migration-plan', requireOperatorDiscoveryAccess, (_req, res) => {
  return res.json({ success: true, data: graphqlMigrationPlan() });
});

app.get('/v1/developer/sdk-catalog', requireOperatorDiscoveryAccess, (_req, res) => {
  return res.json({ success: true, data: developerSdkCatalog() });
});

app.get('/v1/developer/consent-scopes', requireOperatorDiscoveryAccess, (_req, res) => {
  return res.json({ success: true, data: consentScopeCatalog() });
});

app.get('/v1/developer/consent-status', requireOperatorDiscoveryAccess, (req, res) => {
  try {
    const query = ConsentStatusQuerySchema.parse(req.query);
    const scopes = Array.isArray(query.scopes)
      ? query.scopes
      : query.scopes.split(',').map((scope) => scope.trim()).filter(Boolean);
    return res.json({
      success: true,
      data: consentReceiptStore.evaluateConsent({
        serviceCode: query.serviceCode,
        subjectId: query.subjectId,
        scopes,
        environment: query.environment,
        renewalWindowDays: query.renewalWindowDays,
      }),
    });
  } catch (e: any) {
    if (e instanceof z.ZodError) return sendValidationError(res, 'CONSENT_STATUS_QUERY_INVALID', e.issues);
    const error = errorCodeFromException(e, 'CONSENT_STATUS_QUERY_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.get('/v1/developer/webhook-deliveries', requireOperatorDiscoveryAccess, (req, res) => {
  const serviceCode = String(req.query.serviceCode || '').trim() || undefined;
  const intentId = String(req.query.intentId || '').trim() || undefined;
  const status = String(req.query.status || '').trim() || undefined;
  return res.json({
    success: true,
    data: webhookDeliveryStore.list({ serviceCode, intentId, status }),
  });
});

app.post('/v1/developer/webhook-deliveries/:deliveryId/replay', requireOperatorDiscoveryAccess, async (req, res) => {
  try {
    const replay = webhookDeliveryStore.nextReplayAttempt(String(req.params.deliveryId || ''));
    const service = payServiceRegistry.get(replay.original.serviceCode);
    const payload = replay.original.payload || (
      replay.original.intentId
        ? buildServiceWebhookPayload(paymentIntentStore.get(service.code, replay.original.intentId))
        : null
    );
    if (!payload) return sendApiError(res, 409, 'WEBHOOK_DELIVERY_REPLAY_PAYLOAD_MISSING');
    const delivery = await deliverServiceWebhookPayload(service, {
      ...payload,
      eventId: crypto.randomUUID(),
      replayOf: replay.original.eventId,
      replayAttempt: replay.attempt,
    } as any);
    const record = webhookDeliveryStore.record({
      eventId: delivery.eventId || crypto.randomUUID(),
      serviceCode: service.code,
      intentId: replay.original.intentId,
      resourceId: replay.original.resourceId,
      eventType: delivery.eventType || replay.original.eventType,
      payload: delivery.payload,
      callbackUrl: delivery.callbackUrl,
      status: delivery.delivered ? 'delivered' : 'failed',
      attempt: replay.attempt,
      statusCode: delivery.statusCode,
      error: delivery.error,
      replayOf: replay.original.deliveryId,
    });
    return res.status(delivery.delivered ? 200 : 502).json({ success: delivery.delivered, data: record });
  } catch (e: any) {
    const error = errorCodeFromException(e, 'WEBHOOK_DELIVERY_REPLAY_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

const requireObpSandboxToolsEnabled = (_req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!config.sandboxTools.enabled) {
    return sendApiError(res, 404, 'OBP_SANDBOX_TOOLS_DISABLED', {
      message: 'OBP sandbox operator tools are disabled. Set PAYMENT_GATEWAY_OBP_SANDBOX_TOOLS_ENABLED=true only in sandbox/dev operations.',
    });
  }
  return next();
};

app.get('/v1/discovery/obp/:providerCode/payment-capabilities', requireOperatorDiscoveryAccess, async (req, res) => {
  try {
    const providerCode = String(req.params.providerCode || '');
    const data = await obpDiscoveryService.discover(providerCode, {
      bankId: String(req.query.bankId || '').trim() || undefined,
      accountId: String(req.query.accountId || '').trim() || undefined,
      viewId: String(req.query.viewId || '').trim() || undefined,
      countryCode: String(req.query.countryCode || '').trim() || undefined,
      currency: String(req.query.currency || '').trim() || undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    logger.error('obp_payment_capability_discovery_failed', {
      providerCode: req.params.providerCode,
      error: e.message,
    });
    const error = errorCodeFromException(e, 'OBP_PAYMENT_CAPABILITY_DISCOVERY_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.get('/v1/discovery/obp/:providerCode/banks/:bankId/accounts', requireOperatorDiscoveryAccess, async (req, res) => {
  try {
    const scopeInput = String(req.query.scope || 'all').trim().toLowerCase();
    const scope = ['latest', 'private', 'public', 'all'].includes(scopeInput)
      ? (scopeInput as 'latest' | 'private' | 'public' | 'all')
      : 'all';
    const data = await obpDiscoveryService.discoverAccounts(String(req.params.providerCode || ''), {
      bankId: String(req.params.bankId || ''),
      scope,
      accountType: String(req.query.accountType || '').trim() || undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    logger.error('obp_account_discovery_failed', {
      providerCode: req.params.providerCode,
      bankId: req.params.bankId,
      error: e.message,
    });
    const error = errorCodeFromException(e, 'OBP_ACCOUNT_DISCOVERY_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

app.post('/v1/discovery/obp/:providerCode/sandbox/data-import', requireOperatorDiscoveryAccess, async (req, res) => {
  try {
    const data = await obpDiscoveryService.importSandboxData(String(req.params.providerCode || ''), req.body);
    const status = data.ok ? 200 : 502;
    return res.status(status).json({ success: data.ok, data, error: data.error });
  } catch (e: any) {
    logger.error('obp_sandbox_data_import_failed', {
      providerCode: req.params.providerCode,
      error: e.message,
    });
    return res.status(502).json({ success: false, error: e.message || 'OBP_SANDBOX_DATA_IMPORT_FAILED' });
  }
});

const obpSandboxRouter = express.Router({ mergeParams: true });
obpSandboxRouter.use(requireOperatorDiscoveryAccess, requireObpSandboxToolsEnabled);

obpSandboxRouter.get('/banks', async (req, res) => {
  try {
    const providerCode = String((req.params as any).providerCode || '');
    const data = await obpDiscoveryService.listBanks(providerCode);
    const status = data.ok ? 200 : 502;
    return res.status(status).json({ success: data.ok, data, error: data.error });
  } catch (e: any) {
    logger.error('obp_sandbox_banks_failed', {
      providerCode: (req.params as any).providerCode,
      error: e.message,
    });
    return res.status(502).json({ success: false, error: e.message || 'OBP_SANDBOX_BANKS_FAILED' });
  }
});

obpSandboxRouter.post('/entitlement-requests', async (req, res) => {
  try {
    const providerCode = String((req.params as any).providerCode || '');
    const payload = ObpSandboxEntitlementRequestSchema.parse(req.body || {});
    const data = await obpDiscoveryService.requestSandboxEntitlement(providerCode, {
      bankId: payload.bankId,
      roleName: payload.roleName,
    });
    const status = data.ok ? 200 : 502;
    return res.status(status).json({ success: data.ok, data, error: data.error });
  } catch (e: any) {
    logger.error('obp_sandbox_entitlement_request_failed', {
      providerCode: (req.params as any).providerCode,
      error: e.message,
    });
    return res.status(502).json({ success: false, error: e.message || 'OBP_SANDBOX_ENTITLEMENT_REQUEST_FAILED' });
  }
});

obpSandboxRouter.get('/my/entitlement-requests', async (req, res) => {
  try {
    const providerCode = String((req.params as any).providerCode || '');
    const data = await obpDiscoveryService.listMyEntitlementRequests(providerCode);
    const status = data.ok ? 200 : 502;
    return res.status(status).json({ success: data.ok, data, error: data.error });
  } catch (e: any) {
    logger.error('obp_sandbox_my_entitlement_requests_failed', {
      providerCode: (req.params as any).providerCode,
      error: e.message,
    });
    return res.status(502).json({ success: false, error: e.message || 'OBP_SANDBOX_MY_ENTITLEMENT_REQUESTS_FAILED' });
  }
});

obpSandboxRouter.get('/my/entitlements', async (req, res) => {
  try {
    const providerCode = String((req.params as any).providerCode || '');
    const data = await obpDiscoveryService.listMyEntitlements(providerCode);
    const status = data.ok ? 200 : 502;
    return res.status(status).json({ success: data.ok, data, error: data.error });
  } catch (e: any) {
    logger.error('obp_sandbox_my_entitlements_failed', {
      providerCode: (req.params as any).providerCode,
      error: e.message,
    });
    return res.status(502).json({ success: false, error: e.message || 'OBP_SANDBOX_MY_ENTITLEMENTS_FAILED' });
  }
});

obpSandboxRouter.put('/banks/:bankId/accounts/:accountId', async (req, res) => {
  try {
    const providerCode = String((req.params as any).providerCode || '');
    const payload = ObpSandboxAccountCreateSchema.parse({
      ...(req.body || {}),
      accountId: req.params.accountId,
    });
    const body = payload.rawBody || {
      user_id: payload.userId,
      label: payload.label,
      product_code: payload.productCode,
      branch_id: payload.branchId,
      balance: {
        currency: payload.currency.toUpperCase(),
        amount: String(payload.amount),
      },
      account_routings: payload.accountRoutings || [
        {
          scheme: 'OBP',
          address: payload.accountId,
        },
      ],
    };

    const data = await obpDiscoveryService.createSandboxAccount(providerCode, {
      bankId: String(req.params.bankId || ''),
      accountId: payload.accountId,
      body,
    });
    const status = data.ok ? 200 : 502;
    return res.status(status).json({ success: data.ok, data, error: data.error });
  } catch (e: any) {
    logger.error('obp_sandbox_account_create_failed', {
      providerCode: (req.params as any).providerCode,
      bankId: req.params.bankId,
      accountId: req.params.accountId,
      error: e.message,
    });
    return res.status(502).json({ success: false, error: e.message || 'OBP_SANDBOX_ACCOUNT_CREATE_FAILED' });
  }
});

app.use('/v1/sandbox/obp/:providerCode', obpSandboxRouter);

const operationHandler = (operation: 'collect' | 'payout' | 'refund') => async (req: express.Request, res: express.Response) => {
  const parsed = PaymentRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, 'PAYMENT_REQUEST_INVALID', parsed.error.issues);
  }

  try {
    assertFinancialRuntimeRequest(req, res, parsed.data as Record<string, unknown>);
    const { response, coreResult } = await executeProviderOperation(operation, parsed.data);

    return res.json({
      success: true,
      data: response,
      core: coreResult,
    });
  } catch (e: any) {
    logger.error('payment_operation_failed', { operation, error: e.message });
    const error = errorCodeFromException(e, 'PAYMENT_OPERATION_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
};

app.post('/v1/collections', requirePayServiceAccess, operationHandler('collect'));
app.post('/v1/payouts', requirePayServiceAccess, operationHandler('payout'));
app.post('/v1/refunds', requirePayServiceAccess, operationHandler('refund'));

app.post('/v1/webhooks/:providerCode', async (req, res) => {
  try {
    const adapter = adapterRegistry.get(req.params.providerCode);
    const event = await adapter.parseWebhook(req.body, normalizeHeaders(req.headers), req.rawBody);
    const coreResult = await orbiCoreClient.submitProviderEvent(event);
    logger.info('provider_webhook_forwarded_to_core', {
      providerCode: req.params.providerCode,
      reference: event.reference,
      status: event.status,
    });
    return res.json({ success: true, data: event, core: coreResult });
  } catch (e: any) {
    logger.error('provider_webhook_failed', { providerCode: req.params.providerCode, error: e.message });
    const error = errorCodeFromException(e, 'PROVIDER_WEBHOOK_FAILED');
    return sendApiError(res, httpStatusForGatewayError(error), error);
  }
});

const start = async () => {
  requireGatewayRuntimeSecrets();
  rejectUnsafeDirectSecretsInProduction();
  await developerPortalStore.initialize();

  app.listen(config.port, () => {
    logger.info('payment_gateway_started', {
      port: config.port,
      publicBaseUrl: config.publicBaseUrl,
      coreTarget: config.core.baseUrl,
      mtlsEnabled: config.mtls.enabled,
    });
  });
};

start().catch((error) => {
  logger.error('payment_gateway_start_failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
