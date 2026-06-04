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
  publicBaseUrl: process.env.PAYMENT_GATEWAY_PUBLIC_BASE_URL || 'https://gateway.orbifinancial.com',
  providerMode: process.env.PAYMENT_GATEWAY_PROVIDER_MODE || 'live',
  core: {
    baseUrl: process.env.ORBI_CORE_INTERNAL_BASE_URL || 'https://api.orbifinancial.com',
    trustedGatewayEventPath:
      process.env.ORBI_CORE_TRUSTED_GATEWAY_EVENT_PATH || '/api/internal/gateway/provider-events',
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
  providers: {
    selcom: {
      baseUrl: process.env.SELCOM_API_BASE_URL || '',
      apiKey: process.env.SELCOM_API_KEY || '',
      apiSecret: process.env.SELCOM_API_SECRET || '',
    },
    mpesaTanzania: {
      baseUrl: process.env.MPESA_TZ_API_BASE_URL || '',
      apiKey: process.env.MPESA_TZ_API_KEY || '',
      apiSecret: process.env.MPESA_TZ_API_SECRET || '',
    },
  },
};

export const requireGatewayRuntimeSecrets = () => {
  if (config.env === 'production' && !config.worker.signingSecret) {
    throw new Error('WORKER_SIGNING_SECRET is required for production payment gateway callbacks.');
  }

  if (config.env === 'production' && !config.core.baseUrl.startsWith('https://')) {
    throw new Error('ORBI_CORE_INTERNAL_BASE_URL must use https:// in production.');
  }
};
