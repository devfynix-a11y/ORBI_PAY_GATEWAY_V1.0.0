export type DeveloperEnvironmentName = 'sandbox' | 'live';

export type DeveloperEnvironmentProfile = {
  environment: DeveloperEnvironmentName;
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

export const developerEnvironmentProfiles = (): DeveloperEnvironmentProfile[] => [
  {
    environment: 'sandbox',
    title: 'Sandbox',
    moneyMode: 'simulated',
    ledgerMode: 'no_core_ledger_commit',
    providerMode: 'simulator',
    allowedKeyPrefix: 'orbi_sandbox_',
    allowedWebhookSecretPrefix: 'orbi_whsec_sandbox_',
    hostedChallengeMode: 'simulated_approval',
    webhookMode: 'signed_test_events',
    idempotencyRequired: true,
    recommendedBaseUrl: 'https://sandbox-pay.orbifinancial.com',
    safetyRules: [
      'Never move real customer money.',
      'Use test identities, test payment profiles, and synthetic webhooks.',
      'Do not use sandbox API keys against live endpoints.',
      'Replay is allowed for testing webhook recovery and idempotent merchant processing.',
    ],
  },
  {
    environment: 'live',
    title: 'Live',
    moneyMode: 'real',
    ledgerMode: 'core_ledger_commit_required',
    providerMode: 'certified_or_live_provider',
    allowedKeyPrefix: 'orbi_live_',
    allowedWebhookSecretPrefix: 'orbi_whsec_live_',
    hostedChallengeMode: 'real_customer_authorization',
    webhookMode: 'signed_live_events',
    idempotencyRequired: true,
    recommendedBaseUrl: 'https://pay.orbifinancial.com',
    safetyRules: [
      'Every financial commit must have a stable idempotency key.',
      'Use signed webhooks and intent reads as payment truth.',
      'Never enable sandbox provider tools in live.',
      'Live access requires approved scopes, allowlists, and active webhook secrets.',
    ],
  },
];

export const developerEnvironmentProfile = (environment: DeveloperEnvironmentName) => {
  const profile = developerEnvironmentProfiles().find((item) => item.environment === environment);
  if (!profile) throw new Error('DEVELOPER_ENVIRONMENT_NOT_FOUND');
  return profile;
};

export const developerEnvironmentSeparationMatrix = () => ({
  summary: 'Sandbox and live are separate trust zones. Keys, webhook secrets, URLs, consent receipts, and provider behavior must not be mixed.',
  rules: [
    {
      boundary: 'credentials',
      sandbox: 'orbi_sandbox_* keys and orbi_whsec_sandbox_* webhook secrets',
      live: 'orbi_live_* keys and orbi_whsec_live_* webhook secrets',
    },
    {
      boundary: 'money',
      sandbox: 'simulated balances and synthetic payment results only',
      live: 'real Core ledger commits and certified/live provider settlement',
    },
    {
      boundary: 'webhooks',
      sandbox: 'signed test events can be replayed freely for integration testing',
      live: 'signed live events are auditable operational actions; replay requires operator context',
    },
    {
      boundary: 'consent',
      sandbox: 'test consent receipts for integration proof',
      live: 'customer/business consent evidence tied to real scopes and revocation webhooks',
    },
  ],
});
