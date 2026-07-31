import fs from 'fs';
import dotenv from 'dotenv';
import { validateMtlsPolicy } from './security/mtlsPolicy.js';
import {
  validateInternalCoreTransportPolicy,
  type InternalCoreTransportMode,
} from './security/internalCoreTransportPolicy.js';

dotenv.config();

const boolFromEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const optionalFile = (path: string | undefined): Buffer | undefined => {
  const trimmed = String(path || '').trim();
  return trimmed ? fs.readFileSync(trimmed) : undefined;
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PAYMENT_GATEWAY_PORT || 3100),
  publicBaseUrl: process.env.PAYMENT_GATEWAY_PUBLIC_BASE_URL || 'https://pay.orbifinancial.com',
  providerMode: process.env.PAYMENT_GATEWAY_PROVIDER_MODE || 'live',
  providerManifestPath: process.env.PAYMENT_GATEWAY_PROVIDER_MANIFEST_PATH || 'config/providers.json',
  serviceRegistryPath: process.env.PAYMENT_GATEWAY_SERVICE_REGISTRY_PATH || 'config/services.json',
  databaseUrl: process.env.DATABASE_URL || '',
  secretEncryptionKey: process.env.ORBI_SECRET_ENCRYPTION_KEY || '',
  webhookDeliveryStorePath:
    process.env.PAYMENT_GATEWAY_WEBHOOK_DELIVERY_STORE_PATH || 'data/webhook-deliveries.json',
  messagingDeliveryStorePath:
    process.env.PAYMENT_GATEWAY_MESSAGING_DELIVERY_STORE_PATH || 'data/messaging-deliveries.json',
  operatorDiscoveryApiKey: process.env.PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY || '',
  sandboxTools: {
    enabled: boolFromEnv(process.env.PAYMENT_GATEWAY_OBP_SANDBOX_TOOLS_ENABLED, false),
  },
  portal: {
    authSecret: process.env.PAYMENT_GATEWAY_PORTAL_AUTH_SECRET || '',
    sessionTtlSeconds: Number(process.env.PAYMENT_GATEWAY_PORTAL_SESSION_TTL_SECONDS || 60 * 60 * 8),
    mfaFreshnessSeconds: Number(process.env.PAYMENT_GATEWAY_PORTAL_MFA_FRESHNESS_SECONDS || 300),
    mfaMaxFailedAttempts: Number(process.env.PAYMENT_GATEWAY_PORTAL_MFA_MAX_FAILED_ATTEMPTS || 5),
    mfaLockoutSeconds: Number(process.env.PAYMENT_GATEWAY_PORTAL_MFA_LOCKOUT_SECONDS || 900),
    emailVerificationTtlSeconds: Number(process.env.PAYMENT_GATEWAY_PORTAL_EMAIL_VERIFICATION_TTL_SECONDS || 900),
    emailVerificationResendSeconds: Number(process.env.PAYMENT_GATEWAY_PORTAL_EMAIL_VERIFICATION_RESEND_SECONDS || 60),
    totpIssuer: process.env.PAYMENT_GATEWAY_PORTAL_TOTP_ISSUER || 'ORBI Pay Developer Portal',
    operatorMfaRequired: boolFromEnv(process.env.PAYMENT_GATEWAY_PORTAL_OPERATOR_MFA_REQUIRED, true),
    bootstrapAdmin: {
      email: process.env.PAYMENT_GATEWAY_PORTAL_ADMIN_EMAIL || '',
      name: process.env.PAYMENT_GATEWAY_PORTAL_ADMIN_NAME || 'ORBI Admin',
      role: process.env.PAYMENT_GATEWAY_PORTAL_ADMIN_ROLE || 'admin',
      passwordHash: process.env.PAYMENT_GATEWAY_PORTAL_ADMIN_PASSWORD_HASH || '',
      passwordSalt: process.env.PAYMENT_GATEWAY_PORTAL_ADMIN_PASSWORD_SALT || '',
      passwordIterations: Number(process.env.PAYMENT_GATEWAY_PORTAL_ADMIN_PASSWORD_ITERATIONS || 210000),
      totpSecret: process.env.PAYMENT_GATEWAY_PORTAL_ADMIN_TOTP_SECRET || '',
      mfaRequired: boolFromEnv(process.env.PAYMENT_GATEWAY_PORTAL_ADMIN_MFA_REQUIRED, false),
    },
  },
  security: {
    credentialMode: (process.env.PAYMENT_GATEWAY_CREDENTIAL_MODE || 'tokenized') as 'tokenized' | 'direct',
    requireStrongCustomerAuth: boolFromEnv(process.env.PAYMENT_GATEWAY_REQUIRE_STRONG_CUSTOMER_AUTH, true),
    requestAuditEnabled: boolFromEnv(process.env.PAYMENT_GATEWAY_REQUEST_AUDIT_ENABLED, true),
    allowedBrowserOrigins: process.env.PAYMENT_GATEWAY_ALLOWED_BROWSER_ORIGINS || '',
    requireSignedInternalIngress:
      boolFromEnv(process.env.PAYMENT_GATEWAY_REQUIRE_SIGNED_INTERNAL_INGRESS, process.env.NODE_ENV === 'production'),
    financialSignatureToleranceSeconds:
      Number(process.env.PAYMENT_GATEWAY_FINANCIAL_SIGNATURE_TOLERANCE_SECONDS || 300),
    financialNonceTtlSeconds:
      Number(process.env.PAYMENT_GATEWAY_FINANCIAL_NONCE_TTL_SECONDS || 600),
    financialNonceMaxEntries:
      Number(process.env.PAYMENT_GATEWAY_FINANCIAL_NONCE_MAX_ENTRIES || 100000),
    financialRateLimitWindowSeconds:
      Number(process.env.PAYMENT_GATEWAY_FINANCIAL_RATE_LIMIT_WINDOW_SECONDS || 60),
    financialRateLimitMaxRequests:
      Number(process.env.PAYMENT_GATEWAY_FINANCIAL_RATE_LIMIT_MAX_REQUESTS || 120),
    financialRateLimitMaxSubjects:
      Number(process.env.PAYMENT_GATEWAY_FINANCIAL_RATE_LIMIT_MAX_SUBJECTS || 50000),
    serviceAccessTokenSecret:
      process.env.PAYMENT_GATEWAY_SERVICE_ACCESS_TOKEN_SECRET || '',
    serviceAccessTokenTtlSeconds:
      Number(process.env.PAYMENT_GATEWAY_SERVICE_ACCESS_TOKEN_TTL_SECONDS || 900),
    oauthIssuerUrl:
      process.env.PAYMENT_GATEWAY_OAUTH_ISSUER_URL || process.env.PAYMENT_GATEWAY_PUBLIC_BASE_URL || 'https://pay.orbifinancial.com',
    oidcIdentityIssuer:
      process.env.PAYMENT_GATEWAY_OIDC_IDENTITY_ISSUER || '',
    oidcIdentityAudience:
      process.env.PAYMENT_GATEWAY_OIDC_IDENTITY_AUDIENCE || '',
    oidcAuthorizationClientId:
      process.env.PAYMENT_GATEWAY_OIDC_AUTHORIZATION_CLIENT_ID || '',
    oauthAuthorizationRequestTtlSeconds:
      Number(process.env.PAYMENT_GATEWAY_OAUTH_AUTHORIZATION_REQUEST_TTL_SECONDS || 600),
    oauthAuthorizationCodeTtlSeconds:
      Number(process.env.PAYMENT_GATEWAY_OAUTH_AUTHORIZATION_CODE_TTL_SECONDS || 120),
    financialTokenAudience:
      process.env.PAYMENT_GATEWAY_FINANCIAL_TOKEN_AUDIENCE || 'orbi-pay-api',
    financialTokenTtlSeconds:
      Number(process.env.PAYMENT_GATEWAY_FINANCIAL_TOKEN_TTL_SECONDS || 300),
    refreshTokenTtlSeconds:
      Number(process.env.PAYMENT_GATEWAY_REFRESH_TOKEN_TTL_SECONDS || 2_592_000),
    refreshTokenAbsoluteTtlSeconds:
      Number(process.env.PAYMENT_GATEWAY_REFRESH_TOKEN_ABSOLUTE_TTL_SECONDS || 7_776_000),
  },
  observability: {
    auditEventSinkUrl:
      process.env.PAYMENT_GATEWAY_AUDIT_EVENT_SINK_URL || process.env.PAYMENT_GATEWAY_SIEM_SINK_URL || '',
    auditEventSinkPath: process.env.PAYMENT_GATEWAY_AUDIT_EVENT_SINK_PATH || '',
    auditEventSinkTimeoutMs: Number(process.env.PAYMENT_GATEWAY_AUDIT_EVENT_SINK_TIMEOUT_MS || 1500),
    operatorAlertSinkUrl: process.env.PAYMENT_GATEWAY_OPERATOR_ALERT_SINK_URL || '',
    operatorAlertSinkPath: process.env.PAYMENT_GATEWAY_OPERATOR_ALERT_SINK_PATH || '',
    operatorAlertSinkTimeoutMs: Number(process.env.PAYMENT_GATEWAY_OPERATOR_ALERT_SINK_TIMEOUT_MS || 1500),
  },
  talk: {
    enabled: boolFromEnv(process.env.PAYMENT_GATEWAY_ORBI_TALK_ENABLED, false),
    baseUrl: process.env.ORBI_TALK_GATEWAY_URL || 'https://talk.orbifinancial.com',
    intentPath: process.env.ORBI_TALK_MESSAGING_INTENT_PATH || '/api/send-email',
    apiKey: process.env.ORBI_TALK_GATEWAY_API_KEY || '',
    ownerEmail: process.env.ORBI_TALK_GATEWAY_USER_EMAIL || '',
    timeoutMs: Number(process.env.ORBI_TALK_GATEWAY_TIMEOUT_MS || 2500),
  },
  reconciliation: {
    exportPath: process.env.PAYMENT_GATEWAY_RECONCILIATION_EXPORT_PATH || '',
    exportBucket: process.env.PAYMENT_GATEWAY_RECONCILIATION_BUCKET || '',
    stuckIntentMinutes: Number(process.env.PAYMENT_GATEWAY_RECONCILIATION_STUCK_INTENT_MINUTES || 30),
    webhookPendingMinutes: Number(process.env.PAYMENT_GATEWAY_RECONCILIATION_WEBHOOK_PENDING_MINUTES || 10),
    scheduleEnabled: boolFromEnv(process.env.PAYMENT_GATEWAY_RECONCILIATION_SCHEDULE_ENABLED, false),
    scheduleIntervalMinutes: Number(process.env.PAYMENT_GATEWAY_RECONCILIATION_SCHEDULE_INTERVAL_MINUTES || 1440),
    scheduleWindowHours: Number(process.env.PAYMENT_GATEWAY_RECONCILIATION_SCHEDULE_WINDOW_HOURS || 24),
    scheduleRunOnStart: boolFromEnv(process.env.PAYMENT_GATEWAY_RECONCILIATION_SCHEDULE_RUN_ON_START, false),
  },
  incidentEscalation: {
    enabled: boolFromEnv(process.env.PAYMENT_GATEWAY_INCIDENT_ESCALATION_ENABLED, false),
    intervalMinutes: Number(process.env.PAYMENT_GATEWAY_INCIDENT_ESCALATION_INTERVAL_MINUTES || 5),
    criticalSlaMinutes: Number(process.env.PAYMENT_GATEWAY_INCIDENT_CRITICAL_SLA_MINUTES || 15),
    warningSlaMinutes: Number(process.env.PAYMENT_GATEWAY_INCIDENT_WARNING_SLA_MINUTES || 60),
    requestedBy: process.env.PAYMENT_GATEWAY_INCIDENT_ESCALATION_REQUESTED_BY || 'gateway-incident-escalation',
  },
  core: {
    baseUrl: process.env.ORBI_CORE_INTERNAL_BASE_URL || 'https://api.orbifinancial.com',
    allowPrivateHttp:
      boolFromEnv(process.env.PAYMENT_GATEWAY_ALLOW_PRIVATE_HTTP_CORE, false),
    internalTransportMode: (
      process.env.PAYMENT_GATEWAY_INTERNAL_CORE_TRANSPORT_MODE ||
      (boolFromEnv(process.env.PAYMENT_GATEWAY_INTERNAL_MTLS_ENABLED, false)
        ? 'mtls'
        : boolFromEnv(process.env.PAYMENT_GATEWAY_ALLOW_PRIVATE_HTTP_CORE, false)
          ? 'private_http'
          : 'public_https')
    ) as InternalCoreTransportMode,
    trustedGatewayEventPath:
      process.env.ORBI_CORE_TRUSTED_GATEWAY_EVENT_PATH || '/api/internal/gateway/provider-events',
    trustedServicePaymentRequestPath:
      process.env.ORBI_CORE_TRUSTED_SERVICE_PAYMENT_REQUEST_PATH || '/api/internal/pay-gateway/service-payment-requests',
    trustedServicePaymentChallengeRespondPath:
      process.env.ORBI_CORE_TRUSTED_SERVICE_PAYMENT_CHALLENGE_RESPOND_PATH ||
      '/api/internal/pay-gateway/service-payment-challenges',
    trustedPaySafeBalancePath:
      process.env.ORBI_CORE_TRUSTED_PAYSAFE_BALANCE_PATH || '/api/internal/pay-gateway/paysafe-balances',
    trustedPaySafeActionPath:
      process.env.ORBI_CORE_TRUSTED_PAYSAFE_ACTION_PATH || '/api/internal/pay-gateway/paysafe-actions',
    trustedIdentityResolvePath:
      process.env.ORBI_CORE_TRUSTED_IDENTITY_RESOLVE_PATH || '/api/internal/pay-gateway/identity-resolve',
    trustedBusinessRegistrationPath:
      process.env.ORBI_CORE_TRUSTED_BUSINESS_REGISTRATION_PATH || '/api/internal/pay-gateway/business/registrations',
    trustedPaymentProfilePath:
      process.env.ORBI_CORE_TRUSTED_PAYMENT_PROFILE_PATH || '/api/internal/pay-gateway/payment-profiles',
    trustedMerchantOrderPaymentStatusPath:
      process.env.ORBI_CORE_TRUSTED_MERCHANT_ORDER_PAYMENT_STATUS_PATH || '/api/internal/pay-gateway/merchant-order-payment-status',
    trustedMerchantSettlementsPath:
      process.env.ORBI_CORE_TRUSTED_MERCHANT_SETTLEMENTS_PATH || '/api/internal/pay-gateway/merchant-settlements',
    callbackTimeoutMs: Number(process.env.ORBI_CORE_CALLBACK_TIMEOUT_MS || 7500),
  },
  worker: {
    id: process.env.PAYMENT_GATEWAY_WORKER_ID || 'orbi-payment-gateway',
    scopes: (process.env.PAYMENT_GATEWAY_WORKER_SCOPES || 'gateway:events:write')
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean),
    signingSecret: process.env.WORKER_SIGNING_SECRET || process.env.WORKER_SECRET || '',
    keyId: process.env.WORKER_KEY_ID || 'payment-gateway-v1',
  },
  mtls: {
    enabled: boolFromEnv(process.env.PAYMENT_GATEWAY_INTERNAL_MTLS_ENABLED, false),
    cert: optionalFile(process.env.PAYMENT_GATEWAY_INTERNAL_MTLS_CERT_PATH),
    key: optionalFile(process.env.PAYMENT_GATEWAY_INTERNAL_MTLS_KEY_PATH),
    ca: optionalFile(process.env.PAYMENT_GATEWAY_INTERNAL_MTLS_CA_PATH),
    rejectUnauthorized: boolFromEnv(process.env.PAYMENT_GATEWAY_INTERNAL_MTLS_REJECT_UNAUTHORIZED, true),
  },
};

export const requireGatewayRuntimeSecrets = () => {
  if (config.env === 'production' && !config.worker.signingSecret) {
    throw new Error('WORKER_SIGNING_SECRET is required for production payment gateway callbacks.');
  }

  if (config.env === 'production' && !config.operatorDiscoveryApiKey) {
    throw new Error('PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY is required for production discovery endpoints.');
  }

  if (config.env === 'production' && !config.databaseUrl) {
    throw new Error('DATABASE_URL is required for production developer key storage.');
  }

  if (config.env === 'production' && !config.secretEncryptionKey) {
    throw new Error('ORBI_SECRET_ENCRYPTION_KEY is required for encrypted gateway secret storage.');
  }

  if (config.env === 'production' && !config.portal.authSecret) {
    throw new Error('PAYMENT_GATEWAY_PORTAL_AUTH_SECRET is required for production portal sessions.');
  }

  if (config.env === 'production' && !config.security.serviceAccessTokenSecret) {
    throw new Error('PAYMENT_GATEWAY_SERVICE_ACCESS_TOKEN_SECRET is required for production service access tokens.');
  }

  if (
    config.env === 'production' &&
    (!config.security.oidcIdentityIssuer.startsWith('https://') ||
      !config.security.oidcIdentityAudience ||
      !config.security.oidcAuthorizationClientId ||
      !config.security.financialTokenAudience)
  ) {
    throw new Error('Production OIDC issuer, identity audience, and financial token audience are required.');
  }

  if (config.env === 'production' && !config.security.allowedBrowserOrigins) {
    throw new Error('PAYMENT_GATEWAY_ALLOWED_BROWSER_ORIGINS is required for production browser access control.');
  }

  const mtlsErrors = validateMtlsPolicy({
    env: config.env,
    enabled: config.mtls.enabled,
    hasCert: Boolean(config.mtls.cert),
    hasKey: Boolean(config.mtls.key),
    hasCa: Boolean(config.mtls.ca),
    rejectUnauthorized: config.mtls.rejectUnauthorized,
    coreBaseUrl: config.core.baseUrl,
  });

  if (mtlsErrors.length > 0) {
    throw new Error(mtlsErrors.join(' '));
  }

  const transportErrors = validateInternalCoreTransportPolicy({
    env: config.env,
    mode: config.core.internalTransportMode,
    coreBaseUrl: config.core.baseUrl,
    allowPrivateHttp: config.core.allowPrivateHttp,
    workerSigningConfigured: Boolean(config.worker.signingSecret),
    mtlsEnabled: config.mtls.enabled,
    hasCert: Boolean(config.mtls.cert),
    hasKey: Boolean(config.mtls.key),
    hasCa: Boolean(config.mtls.ca),
    rejectUnauthorized: config.mtls.rejectUnauthorized,
  });

  if (transportErrors.length > 0) {
    throw new Error(transportErrors.join(' '));
  }
};
