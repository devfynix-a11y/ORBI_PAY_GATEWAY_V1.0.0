import crypto from 'crypto';
import { config } from '../config.js';

export type ProviderCredentialBinding = {
  providerCode: string;
  mode: 'tokenized' | 'direct';
  baseUrl: string;
  credentialTokenRef?: string;
  webhookSecretTokenRef?: string;
  threeDsProfileId?: string;
  directApiKey?: string;
  directApiSecret?: string;
};

export const tokenFingerprint = (tokenRef?: string): string | undefined => {
  if (!tokenRef) return undefined;
  return crypto.createHash('sha256').update(tokenRef).digest('hex').slice(0, 16);
};

export const credentialBindingStatus = (binding: ProviderCredentialBinding) => ({
  mode: binding.mode,
  configured: isProviderCredentialBound(binding),
  credentialTokenFingerprint: tokenFingerprint(binding.credentialTokenRef),
  webhookTokenFingerprint: tokenFingerprint(binding.webhookSecretTokenRef),
  threeDsProfileId: binding.threeDsProfileId,
});

export const isProviderCredentialBound = (binding: ProviderCredentialBinding) => {
  if (!binding.baseUrl) return false;
  if (binding.mode === 'tokenized') return Boolean(binding.credentialTokenRef && binding.webhookSecretTokenRef);
  return Boolean(binding.directApiKey && binding.directApiSecret);
};

export const assertProviderCredentialBound = (binding: ProviderCredentialBinding) => {
  if (!binding.baseUrl) {
    throw new Error(`${binding.providerCode.toUpperCase()}_BASE_URL_NOT_CONFIGURED`);
  }
  if (binding.mode === 'tokenized' && !binding.credentialTokenRef) {
    throw new Error(`${binding.providerCode.toUpperCase()}_CREDENTIAL_TOKEN_NOT_CONFIGURED`);
  }
  if (binding.mode === 'tokenized' && !binding.webhookSecretTokenRef) {
    throw new Error(`${binding.providerCode.toUpperCase()}_WEBHOOK_TOKEN_NOT_CONFIGURED`);
  }
  if (binding.mode === 'direct' && (!binding.directApiKey || !binding.directApiSecret)) {
    throw new Error(`${binding.providerCode.toUpperCase()}_DIRECT_CREDENTIALS_NOT_CONFIGURED`);
  }
};

export const rejectUnsafeDirectSecretsInProduction = () => {
  const env = process.env.NODE_ENV || config.env;
  const credentialMode = process.env.PAYMENT_GATEWAY_CREDENTIAL_MODE || config.security.credentialMode;
  if (env !== 'production' || credentialMode !== 'tokenized') return;

  const allowedControlPlaneSecrets = new Set([
    'PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY',
    'WORKER_SIGNING_SECRET',
    'ORBI_SHOP_PAY_API_KEY',
    'ORBI_TALK_GATEWAY_API_KEY',
  ]);

  const directSecretKeys = Object.keys(process.env)
    .filter((key) => /_(API_KEY|API_SECRET|CLIENT_SECRET|SECRET_KEY)$/.test(key))
    .filter((key) => !allowedControlPlaneSecrets.has(key))
    .filter((key) => Boolean(process.env[key]?.trim()));

  if (directSecretKeys.length) {
    throw new Error(`Direct provider secrets are forbidden in production tokenized mode: ${directSecretKeys.join(', ')}`);
  }
};
