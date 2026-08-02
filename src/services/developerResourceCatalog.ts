export const developerDocsCatalog = () => [
  {
    id: 'quick-start',
    title: 'Start building with ORBI Pay',
    category: 'Getting started',
    description: 'Create an integration, install an official SDK, run sandbox payments, then request production access.',
    sections: [
      {
        heading: 'What you can build',
        body: 'ORBI Pay lets approved businesses and developers add secure payment collection, customer confirmation, PaySafe escrow, payment profiles, signed webhooks, and reconciliation flows to their own apps. Common use cases include online stores, POS systems, schools, SACCOS, marketplaces, ticketing apps, contribution platforms, and service booking platforms.',
      },
      {
        heading: '1. Create your developer account',
        body: 'Sign up with your real business or developer details. Use a work email where possible. The email is used for account verification, production access communication, key rotation notices, and security alerts.',
      },
      {
        heading: '2. Create a sandbox integration',
        body: 'Add your integration name, website domain, return URL, payment update URL, and the features you want to use. Start in sandbox so you can test safely without real money movement.',
      },
      {
        heading: '3. Install an official SDK',
        body: 'Use Node.js, Python, or PHP SDKs instead of manually building raw HTTP calls. SDKs keep request shape consistent, attach environment context, support idempotency, and provide webhook verification helpers.',
        code: `# Node.js
npm i @orbifinancial/pay-gateway

# Python
pip install orbi-pay-gateway

# PHP
composer require orbifinancial/pay-gateway`,
      },
      {
        heading: '4. Make your first sandbox payment intent',
        body: 'Create a payment intent with a stable business reference, amount, currency, customer identity, return URL, and payment update URL. If customer confirmation is required, redirect the customer to the hosted challenge URL returned by ORBI.',
        code: `const intent = await orbi.payments.createIntent({
  reference: 'ORDER-10001',
  amount: 125000,
  currency: 'TZS',
  customer: { phone: '+255700000000' },
  description: 'Order #10001',
  returnUrl: 'https://merchant.example/checkout/return',
  webhookUrl: 'https://merchant.example/webhooks/orbi-pay'
}, {
  idempotencyKey: 'payment-intent:ORDER-10001'
});`,
      },
      {
        heading: '5. Go live safely',
        body: 'Request production access only after sandbox testing is complete. Production requires approved permissions, verified domains, server-side secret storage, HTTPS URLs, webhook verification, and stable idempotency keys.',
      },
    ],
  },
  {
    id: 'sdk-setup',
    title: 'SDK setup',
    category: 'SDKs',
    description: 'Install official packages, configure credentials, and call ORBI with the same SDK methods in sandbox and production.',
    sections: [
      {
        heading: 'Server-side only',
        body: 'Initialize the SDK only on your trusted server. Never place service keys or webhook signing secrets in browser JavaScript, mobile apps, public repositories, screenshots, or support tickets.',
      },
      {
        heading: 'Node.js / Express install',
        body: 'Install the official Node.js package from npm.',
        code: 'npm i @orbifinancial/pay-gateway',
      },
      {
        heading: 'Node.js / Express configuration',
        body: 'Keep credentials in environment variables and create the SDK client once in your server process.',
        code: `import { createOrbi } from '@orbifinancial/pay-gateway';

export const orbi = createOrbi({
  baseUrl: process.env.ORBI_PAY_BASE_URL!,
  serviceKey: process.env.ORBI_PAY_SERVICE_KEY!,
  environment: process.env.ORBI_PAY_ENVIRONMENT === 'Production' ? 'Production' : 'Demo',
  webhookSecret: process.env.ORBI_PAY_WEBHOOK_SECRET
});`,
      },
      {
        heading: 'Python install',
        body: 'Install the official Python package from PyPI for Flask, FastAPI, Django, workers, or back-office jobs.',
        code: 'pip install orbi-pay-gateway',
      },
      {
        heading: 'Python configuration',
        body: 'Use environment variables and keep the client in your server application context.',
        code: `from orbi_pay_gateway import Orbi
import os

orbi = Orbi(
    base_url=os.environ["ORBI_PAY_BASE_URL"],
    service_key=os.environ["ORBI_PAY_SERVICE_KEY"],
    environment=os.getenv("ORBI_PAY_ENVIRONMENT", "Demo"),
    webhook_secret=os.getenv("ORBI_PAY_WEBHOOK_SECRET"),
)`,
      },
      {
        heading: 'PHP / Laravel install',
        body: 'Install the official PHP package from Packagist.',
        code: 'composer require orbifinancial/pay-gateway',
      },
      {
        heading: 'PHP / Laravel configuration',
        body: 'Store credentials in your `.env` file and instantiate the client inside server-side services/controllers.',
        code: `use Orbifinancial\\PayGateway\\Orbi;

$orbi = Orbi::create([
    'baseUrl' => getenv('ORBI_PAY_BASE_URL'),
    'serviceKey' => getenv('ORBI_PAY_SERVICE_KEY'),
    'environment' => getenv('ORBI_PAY_ENVIRONMENT') ?: 'Demo',
    'webhookSecret' => getenv('ORBI_PAY_WEBHOOK_SECRET'),
]);`,
      },
      {
        heading: 'Required environment variables',
        body: 'Use sandbox values while testing and production values only after approval. Keep sandbox and production keys separate.',
        code: `ORBI_PAY_BASE_URL=https://sandbox-pay.orbifinancial.com
ORBI_PAY_ENVIRONMENT=Demo
ORBI_PAY_SERVICE_KEY=orbi_sandbox_xxxxxxxxx
ORBI_PAY_WEBHOOK_SECRET=whsec_xxxxxxxxx`,
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
        heading: 'Why domain verification is required',
        body: 'Production integrations can redirect customers and receive payment updates. ORBI verifies your domains to reduce impersonation, callback hijacking, and accidental use of untrusted URLs.',
      },
      {
        heading: 'Use DNS TXT verification',
        body: 'The portal gives you a TXT record for each website domain, return URL domain, and payment update URL domain. Add the TXT record where DNS is hosted, such as Cloudflare, cPanel, Namecheap, GoDaddy, Route 53, or your hosting DNS panel.',
        code: `Type: TXT
Name: _orbi-pay-verify
Value: orbi-pay-verify=example_generated_value
TTL: Auto or 300 seconds`,
      },
      {
        heading: 'Verify DNS from the portal',
        body: 'After DNS propagation, press Verify DNS. ORBI checks the record automatically. Live credentials remain locked until all required domains are verified.',
      },
      {
        heading: 'Good production URL examples',
        body: 'Use HTTPS and stable URLs. Do not use localhost, temporary tunnels, personal domains, or URLs controlled by another company for production.',
        code: `Website: https://merchant.example
Return URL: https://merchant.example/orbi-pay/return
Webhook URL: https://merchant.example/webhooks/orbi-pay`,
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
        heading: 'When to use payment intents',
        body: 'Use payment intents when your platform needs to request a customer payment and wait for customer confirmation. This is ideal for checkout, invoices, POS payment links, school fees, contribution requests, and service bookings.',
      },
      {
        heading: 'Create an intent with the SDK',
        body: 'Send a stable business reference, amount, currency, customer identity, return URL, webhook URL, and description. Use the same idempotency key for retries of the same order.',
        code: `const intent = await orbi.payments.createIntent({
  reference: 'ORDER-10001',
  amount: 125000,
  currency: 'TZS',
  customer: {
    phone: '+255700000000',
    email: 'customer@example.com'
  },
  description: 'Checkout payment for Order #10001',
  returnUrl: 'https://merchant.example/checkout/return',
  webhookUrl: 'https://merchant.example/webhooks/orbi-pay'
}, {
  idempotencyKey: 'payment-intent:ORDER-10001'
});`,
      },
      {
        heading: 'Redirect to hosted challenge',
        body: 'If ORBI returns a challenge URL, redirect the customer to that URL. The customer approves or declines on the secure hosted page. Your app should not collect ORBI PINs or secrets directly unless you are using an approved hosted component.',
        code: `if (intent.challengeUrl) {
  return res.redirect(intent.challengeUrl);
}`,
      },
      {
        heading: 'Confirm final status by webhook',
        body: 'The return URL improves customer experience, but your order status should be updated after receiving a verified webhook. This protects your platform from browser interruptions and manual URL refreshes.',
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
        heading: 'When to use PaySafe',
        body: 'Use PaySafe when a customer and merchant need protected settlement. ORBI holds the payment while the parties complete the agreed service or delivery. Status updates are sent through webhooks so your platform can show accurate order state.',
      },
      {
        heading: 'Create a PaySafe escrow intent',
        body: 'Use the SDK to create a PaySafe payment request. The customer confirms through the hosted challenge. After confirmation, the payment follows PaySafe lifecycle rules.',
        code: `const escrow = await orbi.paysafe.create({
  reference: 'ESCROW-ORDER-10001',
  amount: 125000,
  currency: 'TZS',
  payer: { phone: '+255700000000' },
  payee: { merchantReference: 'seller-42' },
  purpose: 'Protected marketplace order #10001',
  expiresAt: '2026-08-08T12:00:00Z',
  returnUrl: 'https://merchant.example/orders/10001/return',
  webhookUrl: 'https://merchant.example/webhooks/orbi-pay'
}, {
  idempotencyKey: 'paysafe:ORDER-10001'
});`,
      },
      {
        heading: 'Lifecycle states',
        body: 'Common PaySafe states include pending confirmation, active hold, release requested, released, refund requested, refunded, disputed, expired, and closed. Display state from webhook updates, not from assumptions in your frontend.',
      },
      {
        heading: 'Lifecycle actions',
        body: 'Use SDK methods for release, refund request, cancel, and dispute actions. Every action should have a user confirmation step in your UI and should be retried with the same idempotency key if the network fails.',
        code: `await orbi.paysafe.requestRelease({
  escrowId: 'esc_123',
  reason: 'Goods delivered and accepted'
}, {
  idempotencyKey: 'paysafe-release:esc_123'
});`,
      },
      {
        heading: 'Reconciliation',
        body: 'Store your own order ID, ORBI reference, escrow ID, amount, currency, and latest PaySafe status. Use webhooks for automated reconciliation and support screens.',
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
        heading: 'Webhook endpoint requirements',
        body: 'Your webhook URL must be HTTPS, publicly reachable, stable, and controlled by your business. It should accept POST requests, verify signatures, store the event ID, and return a 2xx response quickly.',
      },
      {
        heading: 'Verify signatures',
        body: 'Use the SDK webhook verifier with your webhook signing secret. Reject missing, expired, replayed, or invalid signatures.',
        code: `app.post('/webhooks/orbi-pay', express.raw({ type: 'application/json' }), async (req, res) => {
  const event = orbi.webhooks.verify({
    payload: req.body,
    headers: req.headers
  });

  // Store event.id before processing to prevent duplicate work.
  await saveWebhookEvent(event.id, event.type, event.data);
  res.status(200).send('ok');
});`,
      },
      {
        heading: 'Process asynchronously',
        body: 'Acknowledge the webhook quickly, then update your order in a queue or background job. This prevents timeouts and duplicate delivery pressure.',
      },
      {
        heading: 'Replay safely',
        body: 'Use webhook replay from the portal or SDK when your endpoint was down. Replay sends the same event again and does not create a new payment.',
        code: `await orbi.webhooks.replay({
  deliveryId: 'whd_123'
});`,
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
        heading: 'Sandbox base URL',
        body: 'Sandbox is for development and testing. It uses simulated money and test identities. Use it for checkout, PaySafe, customer confirmation, webhooks, replay, and error handling drills.',
        code: `ORBI_PAY_BASE_URL=https://sandbox-pay.orbifinancial.com
ORBI_PAY_ENVIRONMENT=Demo`,
      },
      {
        heading: 'Production base URL',
        body: 'Production handles real customer activity. Use production only after approval, domain verification, live credentials, secure webhook handling, and operational readiness checks.',
        code: `ORBI_PAY_BASE_URL=https://pay.orbifinancial.com
ORBI_PAY_ENVIRONMENT=Production`,
      },
      {
        heading: 'Use the same routes and SDK methods',
        body: 'Sandbox and production use the same SDK methods and request shapes. Move from sandbox to production by changing credentials and environment configuration, not by rewriting your payment code.',
      },
      {
        heading: 'Do not mix keys',
        body: 'Never send sandbox keys to production or production keys to sandbox. Treat keys as environment-specific secrets.',
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
        body: 'ORBI returns machine-readable error codes for developer handling. Show a friendly user message, log the request ID, and keep enough context for support without exposing secret keys or customer-sensitive data.',
      },
      {
        heading: 'Validation errors',
        body: 'Do not retry validation errors blindly. Fix the payload first, such as missing currency, invalid amount, unsupported customer identifier, unverified domain, or missing permission.',
        code: `try {
  await orbi.payments.createIntent(payload, { idempotencyKey });
} catch (error) {
  if (error.code === 'VALIDATION_FAILED') {
    // Fix payload. Do not retry unchanged.
  }
}`,
      },
      {
        heading: 'Network retries',
        body: 'If the network fails after sending a financial request, retry with the same idempotency key. Do not create a new key for the same order or payment attempt.',
        code: `const idempotencyKey = 'payment-intent:ORDER-10001';

await orbi.payments.createIntent(payload, { idempotencyKey });
// If the request times out, retry with the same idempotencyKey.`,
      },
      {
        heading: 'User-facing messages',
        body: 'Avoid technical messages such as raw validation traces or signature errors in customer screens. Use clear messages such as "We could not complete this payment. Please try again or contact support if money was deducted."',
      },
    ],
  },
  {
    id: 'terms-of-use',
    title: 'Developer terms of use',
    category: 'Policy',
    description: 'Security, privacy, and production rules every ORBI Pay integration must follow.',
    sections: [
      {
        heading: 'Protect customer trust',
        body: 'Use ORBI Pay only for approved business purposes. Do not misrepresent payment status, customer identity, merchant identity, escrow state, fees, or settlement timelines.',
      },
      {
        heading: 'Keep secrets private',
        body: 'Store service keys and webhook secrets only on trusted servers. Rotate keys immediately if exposed. Never place secrets in frontend bundles, mobile apps, browser storage, screenshots, chat messages, or public repositories.',
      },
      {
        heading: 'Respect consent and data minimization',
        body: 'Request only the permissions your service needs. Do not store or display customer financial information beyond the approved use case. Remove data when it is no longer needed for service, audit, or legal obligations.',
      },
      {
        heading: 'Use safe payment handling',
        body: 'Use idempotency keys, verify webhooks, show clear customer confirmation, and reconcile final status through verified payment updates.',
      },
      {
        heading: 'Production access can be restricted',
        body: 'ORBI may suspend, limit, or revoke access for risky activity, suspicious traffic, invalid domains, unsafe webhook handling, policy violations, or customer protection concerns.',
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
