export type MtlsPolicyInput = {
  env: string;
  enabled: boolean;
  hasCert: boolean;
  hasKey: boolean;
  hasCa: boolean;
  rejectUnauthorized: boolean;
  coreBaseUrl: string;
};

export const validateMtlsPolicy = (input: MtlsPolicyInput): string[] => {
  if (input.env !== 'production' || !input.enabled) return [];

  const errors: string[] = [];

  if (!input.hasCert || !input.hasKey || !input.hasCa) {
    errors.push(
      'PAYMENT_GATEWAY_INTERNAL_MTLS_CERT_PATH, PAYMENT_GATEWAY_INTERNAL_MTLS_KEY_PATH, and PAYMENT_GATEWAY_INTERNAL_MTLS_CA_PATH are required when mTLS is enabled.',
    );
  }

  if (!input.coreBaseUrl.startsWith('https://')) {
    errors.push('ORBI_CORE_INTERNAL_BASE_URL must use https:// when PAYMENT_GATEWAY_INTERNAL_MTLS_ENABLED=true.');
  }

  if (!input.rejectUnauthorized) {
    errors.push('PAYMENT_GATEWAY_INTERNAL_MTLS_REJECT_UNAUTHORIZED must remain true in production when mTLS is enabled.');
  }

  return errors;
};
