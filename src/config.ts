import fs from 'fs';
import dotenv from 'dotenv';

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
  operatorDiscoveryApiKey: process.env.PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY || '',
  sandboxTools: {
    enabled: boolFromEnv(process.env.PAYMENT_GATEWAY_OBP_SANDBOX_TOOLS_ENABLED, false),
  },
  security: {
    credentialMode: (process.env.PAYMENT_GATEWAY_CREDENTIAL_MODE || 'tokenized') as 'tokenized' | 'direct',
    requireStrongCustomerAuth: boolFromEnv(process.env.PAYMENT_GATEWAY_REQUIRE_STRONG_CUSTOMER_AUTH, true),
  },
  core: {
    baseUrl: process.env.ORBI_CORE_INTERNAL_BASE_URL || 'https://api.orbifinancial.com',
    allowPrivateHttp:
      boolFromEnv(process.env.PAYMENT_GATEWAY_ALLOW_PRIVATE_HTTP_CORE, false),
    trustedGatewayEventPath:
      process.env.ORBI_CORE_TRUSTED_GATEWAY_EVENT_PATH || '/api/internal/gateway/provider-events',
    trustedServicePaymentRequestPath:
      process.env.ORBI_CORE_TRUSTED_SERVICE_PAYMENT_REQUEST_PATH || '/api/internal/pay-gateway/service-payment-requests',
    trustedPaySafeBalancePath:
      process.env.ORBI_CORE_TRUSTED_PAYSAFE_BALANCE_PATH || '/api/internal/pay-gateway/paysafe-balances',
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

  if (
    config.env === 'production' &&
    !config.core.baseUrl.startsWith('https://') &&
    !config.core.allowPrivateHttp
  ) {
    throw new Error('ORBI_CORE_INTERNAL_BASE_URL must use https:// in production.');
  }

  if (config.env === 'production' && !config.operatorDiscoveryApiKey) {
    throw new Error('PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY is required for production discovery endpoints.');
  }

  if (config.env === 'production' && config.mtls.enabled) {
    if (!config.mtls.cert || !config.mtls.key || !config.mtls.ca) {
      throw new Error(
        'PAYMENT_GATEWAY_INTERNAL_MTLS_CERT_PATH, PAYMENT_GATEWAY_INTERNAL_MTLS_KEY_PATH, and PAYMENT_GATEWAY_INTERNAL_MTLS_CA_PATH are required when mTLS is enabled.',
      );
    }
  }
};
