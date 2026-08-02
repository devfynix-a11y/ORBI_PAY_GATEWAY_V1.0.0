export const developerDocsCatalog = () => [
  {
    id: 'quick-start',
    title: 'Start building with ORBI Pay',
    category: 'Getting started',
    description: 'Create an integration, install an SDK, run sandbox payments, then request live access.',
    sections: [
      {
        heading: '1. Create your developer account',
        body: 'Sign up, verify your email, then create a sandbox integration for your product, store, POS, SACCOS, school, or platform.',
      },
      {
        heading: '2. Add your app details',
        body: 'Provide your integration name, allowed website domains, return URLs, payment update URLs, and the permissions your app needs.',
      },
      {
        heading: '3. Use the SDK',
        body: 'Install the official ORBI SDK for Node.js, Python, or PHP. SDKs handle signing, environment headers, idempotency, and webhook verification for you.',
      },
      {
        heading: '4. Test in sandbox',
        body: 'Use sandbox credentials and simulated users to test payment intents, PaySafe escrow, hosted challenge, webhooks, and replay safely.',
      },
    ],
  },
  {
    id: 'sdk-setup',
    title: 'SDK setup',
    category: 'SDKs',
    description: 'Install official packages and configure sandbox or production credentials.',
    sections: [
      {
        heading: 'Node.js / Express',
        body: 'Install with npm i @orbifinancial/pay-gateway, then create the client with your gateway base URL, service key, environment, and webhook secret.',
        code: 'npm i @orbifinancial/pay-gateway',
      },
      {
        heading: 'Python',
        body: 'Install with pip install orbi-pay-gateway, then use the client in Flask, FastAPI, Django, Celery workers, or back-office services.',
        code: 'pip install orbi-pay-gateway',
      },
      {
        heading: 'PHP / Laravel',
        body: 'Install with composer require orbifinancial/pay-gateway, then keep credentials in server-side environment variables.',
        code: 'composer require orbifinancial/pay-gateway',
      },
    ],
  },
  {
    id: 'domain-verification',
    title: 'Verify your domain',
    category: 'Go live',
    description: 'Live keys are issued only after ORBI confirms you control every live domain used by your integration.',
    sections: [
      {
        heading: 'Use DNS TXT verification',
        body: 'The portal gives you a TXT record for each website, return URL, and payment update URL domain. Add the TXT record where your DNS is hosted, such as Cloudflare, cPanel, Namecheap, GoDaddy, Route 53, or your hosting DNS panel.',
      },
      {
        heading: 'Press Verify DNS',
        body: 'After DNS propagation, press Verify DNS in the portal. ORBI checks the TXT record automatically. Live credentials remain locked until every required domain is verified.',
      },
      {
        heading: 'Cloudflare example',
        body: 'For api.example.com, create a TXT record named _orbi-pay-verify.api and paste the value shown in the portal. Keep TTL on Auto.',
      },
    ],
  },
  {
    id: 'payment-intents',
    title: 'Payment intents',
    category: 'Payments',
    description: 'Start a payment, redirect to ORBI hosted challenge, and receive payment updates through webhooks.',
    sections: [
      {
        heading: 'Create an intent',
        body: 'Use the SDK method orbi.payments.createIntent(...) with a stable reference, amount, currency, customer identity, return URL, and webhook URL.',
      },
      {
        heading: 'Hosted challenge',
        body: 'If customer confirmation is required, redirect the customer to the challenge URL returned by ORBI. After approval or decline, ORBI redirects back to your return URL.',
      },
      {
        heading: 'Idempotency',
        body: 'Always send a stable idempotency key for the same business operation, such as payment-intent:order-10001. This prevents duplicate money movement during network retries.',
      },
    ],
  },
  {
    id: 'paysafe-escrow',
    title: 'PaySafe escrow',
    category: 'PaySafe',
    description: 'Create protected payments that hold funds until release, refund, or dispute actions complete.',
    sections: [
      {
        heading: 'Create PaySafe',
        body: 'Use PaySafe when buyer and seller need protected settlement. Funds are held while both sides follow the PaySafe lifecycle.',
      },
      {
        heading: 'Lifecycle actions',
        body: 'Supported actions include release, refund request, dispute, and status checks. Use SDK methods instead of hand-writing raw HTTP.',
      },
      {
        heading: 'Webhooks',
        body: 'Listen for PaySafe status changes so your platform can update orders, receipts, and customer screens accurately.',
      },
    ],
  },
  {
    id: 'webhooks',
    title: 'Webhooks and replay',
    category: 'Webhooks',
    description: 'Receive signed payment updates and replay failed deliveries without duplicating payments.',
    sections: [
      {
        heading: 'Verify signatures',
        body: 'Use the SDK webhook verifier with your webhook signing secret. Reject unsigned or invalid webhook requests.',
      },
      {
        heading: 'Return fast',
        body: 'Acknowledge webhook delivery quickly, then process heavy work in your queue or job worker.',
      },
      {
        heading: 'Replay safely',
        body: 'Use webhook replay from the portal or SDK when your endpoint was down. Replay does not create a new payment.',
      },
    ],
  },
  {
    id: 'sandbox-live',
    title: 'Sandbox and live environments',
    category: 'Environments',
    description: 'Sandbox is for safe testing. Live is for real payments and requires approval, verified domains, and live keys.',
    sections: [
      {
        heading: 'Sandbox',
        body: 'Use sandbox to test checkout, PaySafe, customer confirmation, webhooks, and replay without real money movement.',
      },
      {
        heading: 'Live',
        body: 'Live requires approved permissions, verified domains, production credentials, secure webhook handling, and stable idempotency keys.',
      },
    ],
  },
  {
    id: 'error-handling',
    title: 'Errors and safe retries',
    category: 'Reliability',
    description: 'Use stable error codes, idempotency keys, and webhook replay to avoid duplicate actions.',
    sections: [
      {
        heading: 'Stable error codes',
        body: 'ORBI returns machine-readable error codes. Show safe messages to users, log the request ID, and avoid retrying validation errors without fixing the payload.',
      },
      {
        heading: 'Network retries',
        body: 'If the network fails after you send a financial request, retry with the same idempotency key. Do not create a new key for the same order or payment attempt.',
      },
    ],
  },
];

export const developerSandboxToolsCatalog = () => [
  {
    id: 'sandbox-service-application',
    title: 'Create Sandbox Service Application',
    status: 'available',
    endpoint: 'POST /v1/developer/service-applications',
    description: 'Submit a service/app application with sandbox environment.',
  },
  {
    id: 'sandbox-api-key',
    title: 'Issue Sandbox API Key',
    status: 'available',
    endpoint: 'POST /v1/developer/services/:serviceCode/api-keys/issue',
    description: 'Issue a one-time sandbox key after service approval.',
  },
  {
    id: 'sandbox-api-key-revoke',
    title: 'Revoke Sandbox API Key',
    status: 'available',
    endpoint: 'POST /v1/developer/services/:serviceCode/api-keys/:keyId/revoke',
    description: 'Emergency revoke an API key with operator reason and audit event.',
  },
  {
    id: 'sandbox-webhook-secret',
    title: 'Issue Sandbox Webhook Secret',
    status: 'available',
    endpoint: 'POST /v1/developer/services/:serviceCode/webhook-secrets/issue',
    description: 'Issue one-time sandbox webhook signing secret.',
  },
  {
    id: 'sandbox-webhook-secret-revoke',
    title: 'Revoke Sandbox Webhook Secret',
    status: 'available',
    endpoint: 'POST /v1/developer/services/:serviceCode/webhook-secrets/:secretId/revoke',
    description: 'Emergency revoke a webhook signing secret with operator reason and audit event.',
  },
  {
    id: 'sandbox-payment-intent',
    title: 'Test Payment Intent',
    status: 'contract_ready',
    endpoint: 'POST /v1/payment-intents',
    description: 'Create a test payment intent using sandbox service credentials.',
  },
  {
    id: 'environment-profiles',
    title: 'Sandbox/Live Environment Profiles',
    status: 'available',
    endpoint: '/v1/developer/environment-profiles',
    description: 'Read the explicit safety boundaries, key prefixes, money mode, provider mode, and webhook mode for sandbox and live.',
  },
  {
    id: 'sandbox-simulator-flow',
    title: 'Sandbox Simulator Flow',
    status: 'contract_ready',
    endpoint: '/v1/developer/sandbox-simulator',
    description: 'Developer-facing guide for simulating payment intents, hosted challenge approval/decline, signed webhooks, and replay.',
  },
  {
    id: 'graphql-schema-preview',
    title: 'GraphQL Schema Preview',
    status: 'contract_preview',
    endpoint: '/v1/developer/graphql/schema',
    description: 'Read the draft GraphQL schema. REST remains authoritative until GraphQL reaches parity gates.',
  },
  {
    id: 'postman-sandbox-collection',
    title: 'Postman Sandbox Collection',
    status: 'available',
    endpoint: '/docs/postman/orbi-pay-gateway.postman_collection.json',
    description: 'Import checkout, hosted challenge, consent, and webhook replay requests into Postman or Insomnia.',
  },
  {
    id: 'webhook-replay',
    title: 'Replay Failed Webhook',
    status: 'available',
    endpoint: 'POST /v1/developer/webhook-deliveries/:deliveryId/replay',
    description: 'Replay a signed webhook without changing ledger/payment state.',
  },
  {
    id: 'consent-receipts',
    title: 'Consent Receipt Evidence',
    status: 'available',
    endpoint: '/v1/developer/consent-receipts',
    description: 'Create, list, read, and revoke scoped consent evidence for sandbox or live services.',
  },
  {
    id: 'consent-scope-catalog',
    title: 'Consent Scope Catalog',
    status: 'available',
    endpoint: '/v1/developer/consent-scopes',
    description: 'Read localized scope labels, descriptions, risk levels, and hosted challenge requirements.',
  },
  {
    id: 'consent-status-check',
    title: 'Consent Status Check',
    status: 'available',
    endpoint: '/v1/developer/consent-status',
    description: 'Check whether consent is active, expiring soon, expired, revoked, or missing before prompting renewal.',
  },
  {
    id: 'obp-sandbox-tools',
    title: 'OBP Sandbox Discovery Tools',
    status: 'operator_toggle',
    endpoint: '/v1/discovery/obp/:providerCode/sandbox/*',
    description: 'Sandbox-only OBP banks, entitlements, and account tools guarded by PAYMENT_GATEWAY_OBP_SANDBOX_TOOLS_ENABLED.',
  },
];

export const developerSdkCatalog = () => [
  {
    id: 'node-sdk',
    language: 'TypeScript/Node.js',
    status: 'live_npm',
    packageName: '@orbifinancial/pay-gateway',
    docsPath: 'https://www.npmjs.com/package/@orbifinancial/pay-gateway',
    description: 'Live npm package with typed client and CLI for payment intents, PaySafe actions, webhook verification, and replay.',
  },
  {
    id: 'php-sdk',
    language: 'PHP',
    status: 'live_packagist',
    packageName: 'orbifinancial/pay-gateway',
    docsPath: 'https://packagist.org/packages/orbifinancial/pay-gateway',
    description: 'Live Packagist package for PHP/Laravel commerce stacks.',
  },
  {
    id: 'python-sdk',
    language: 'Python',
    status: 'live_pypi',
    packageName: 'orbi-pay-gateway',
    docsPath: 'https://pypi.org/project/orbi-pay-gateway/',
    description: 'Live PyPI package for SACCOS, organizations, and custom back offices.',
  },
  {
    id: 'openapi-spec',
    language: 'OpenAPI',
    status: 'bootstrap_available',
    packageName: 'orbi-pay-gateway.openapi.json',
    docsPath: '/v1/developer/openapi',
    description: 'OpenAPI 3.1 contract for portal docs, SDK generation, and API tools.',
  },
];
