# ORBI Pay Gateway Node SDK

Official TypeScript/Node.js SDK for ORBI Pay Gateway.

Status:

```text
live on npm
```

This SDK targets server-side merchant, marketplace, SACCOS, organization, and
operator integrations. Do not use service keys in browsers, mobile apps, or
Vite client bundles.

## Install

```bash
npm install @orbifinancial/pay-gateway@^0.1.1
```

Local development from this repo:

```bash
cd sdk/node
npm install
npm run check
```

## Server Setup

Use access-token mode for new production integrations. The SDK exchanges your
server-side service key for a short-lived ORBI access token, caches it, and signs
financial requests with that token.

```ts
import { createOrbi } from '@orbifinancial/pay-gateway';

const orbi = createOrbi({
  baseUrl: process.env.ORBI_PAY_GATEWAY_BASE_URL!,
  serviceKey: process.env.ORBI_PAY_SERVICE_KEY!,
  authMode: 'access_token',
  environment: process.env.ORBI_PAY_ENVIRONMENT === 'Production'
    ? 'Production'
    : 'Demo',
});
```

Legacy/direct-key mode is available only for controlled migration:

```ts
const orbi = createOrbi({
  baseUrl: process.env.ORBI_PAY_GATEWAY_BASE_URL!,
  serviceKey: process.env.ORBI_PAY_SERVICE_KEY!,
  authMode: 'api_key',
});
```

## CLI

When installed, use:

```bash
orbi-pay-gateway help
```

Local development:

```bash
npx tsx src/cli.ts help
```

Examples:

```bash
orbi-pay-gateway create-intent \
  --reference ORDER-10001 \
  --amount 125000 \
  --currency TZS \
  --customer-phone +255700000000 \
  --idempotency-key payment-intent:merchant:ORDER-10001

orbi-pay-gateway get-intent --intent-id pi_123

orbi-pay-gateway replay-webhook \
  --delivery-id whdel_123 \
  --request-id manual-replay-whdel-123

orbi-pay-gateway verify-webhook \
  --body-file webhook.json \
  --signature sha256=... \
  --timestamp 1780000000
```

Sandbox service setup:

```bash
orbi-pay-gateway submit-service \
  --legal-name "Merchant Ltd" \
  --display-name "Merchant" \
  --contact-email ops@merchant.example \
  --business-type merchant \
  --country-code TZ \
  --environments sandbox \
  --scopes payments:create,webhooks:receive \
  --redirect-urls https://merchant.example/orbi/return \
  --webhook-urls https://merchant.example/api/orbi/webhooks

orbi-pay-gateway approve-service \
  --application-id dev_app_123 \
  --service-code merchant \
  --initial-status active

orbi-pay-gateway issue-api-key \
  --service-code merchant \
  --environment sandbox \
  --requested-by ops@merchant.example \
  --reason "Issue sandbox key for integration testing."

orbi-pay-gateway issue-webhook-secret \
  --service-code merchant \
  --environment sandbox \
  --requested-by ops@merchant.example \
  --reason "Issue sandbox webhook secret for integration testing."
```

## Business SDK Contract

Use the same business methods in Demo and Production. The environment is sent
as a constant request context, not as a different transfer API.

```ts
import { createOrbi } from '@orbifinancial/pay-gateway';

const sandboxOrbi = createOrbi({
  baseUrl: 'https://sandbox-pay.orbifinancial.com',
  serviceKey: process.env.ORBI_SANDBOX_SERVICE_KEY!,
  environment: 'Demo', // sends x-orbi-environment: demo
});

const transfer = await sandboxOrbi.transfers.send({
  reference: 'ORDER-10001',
  amount: 125000,
  currency: 'TZS',
  description: 'Order payment',
  customer: {
    phone: '+255700000000',
  },
  returnUrl: 'https://merchant.example.com/orbi/return',
  callbackUrl: 'https://merchant.example.com/api/orbi/webhooks',
}, {
  idempotencyKey: 'transfer:merchant:ORDER-10001',
});

// Capitalized aliases are available for teams that prefer SDK namespaces.
await sandboxOrbi.Transfers.send({ ...payload });
```

Use `https://sandbox-pay.orbifinancial.com` for Demo/Sandbox and
`https://pay.orbifinancial.com` for Production/Live.

```ts
const liveOrbi = createOrbi({
  baseUrl: 'https://pay.orbifinancial.com',
  serviceKey: process.env.ORBI_LIVE_SERVICE_KEY!,
  environment: 'Production',
});

await liveOrbi.Transfers.send({ ...payload });
```

Production requests still require approved live scopes and real production
service keys. Sandbox simulator helpers live under
`orbi.developer.sandboxSimulator.*` and must not be used as the production
money contract.

## Environment Configuration

Use these names in merchant servers and CI/CD secret stores:

```env
ORBI_PAY_GATEWAY_BASE_URL=https://sandbox-pay.orbifinancial.com
ORBI_PAY_ENVIRONMENT=Demo
ORBI_PAY_SERVICE_KEY=orbi_sandbox_xxx
ORBI_PAY_WEBHOOK_SECRET=orbi_whsec_sandbox_xxx
ORBI_PAY_RETURN_URL=https://merchant.example.com/orbi/return
ORBI_PAY_CANCEL_URL=https://merchant.example.com/orbi/cancel
ORBI_PAY_WEBHOOK_URL=https://merchant.example.com/api/orbi/webhooks
```

Production changes only the base URL, environment, and live credentials:

```env
ORBI_PAY_GATEWAY_BASE_URL=https://pay.orbifinancial.com
ORBI_PAY_ENVIRONMENT=Production
ORBI_PAY_SERVICE_KEY=orbi_live_xxx
ORBI_PAY_WEBHOOK_SECRET=orbi_whsec_live_xxx
```

The SDK sends `x-orbi-environment`, `x-orbi-signature`,
`x-orbi-timestamp`, and `x-orbi-nonce` automatically for financial requests.
Always pass a stable `idempotencyKey` for retryable operations.

Merchant-scoped products such as PaySafe also require operator/Developer Portal
setup: active service, approved scopes, allowlisted URLs, merchant metadata,
and a live merchant ID env var inside Gateway. If merchant metadata or merchant
env is missing, Gateway/Core must fail closed.

The Node SDK also signs financial runtime requests automatically with:

```text
x-orbi-signature: sha256=<hmac>
x-orbi-timestamp: <unix-seconds>
x-orbi-nonce: <unique-nonce>
```

Canonical payload:

```text
<timestamp>.<nonce>.<METHOD>.<path-with-query>.<sha256-hex-raw-body>
```

Signed GET/HEAD requests use an empty raw body hash. Financial mutations should
always include a stable `idempotencyKey`.

The current gateway verifier uses the service key as the request signing
secret. `requestSigningSecret` is reserved for the next Developer Portal phase,
where request-signing secrets will be issued separately from API keys.

## Low-Level Client

```ts
import { OrbiPayGatewayClient } from '@orbifinancial/pay-gateway';

const orbi = new OrbiPayGatewayClient({
  baseUrl: 'https://pay.orbifinancial.com',
  serviceKey: process.env.ORBI_PAY_SERVICE_KEY!,
});

const intent = await orbi.createCheckoutPaymentIntent({
  reference: 'ORDER-10001',
  amount: 125000,
  currency: 'TZS',
  paymentCategory: 'orbi',
  paymentRail: 'orbi_wallet',
  customer: {
    phone: '+255700000000',
  },
  returnUrl: 'https://merchant.example.com/orbi/return',
}, {
  idempotencyKey: 'payment-intent:merchant:ORDER-10001',
});
```

## Payment Intent And Hosted Challenge Flow

```ts
if (!intent.success) {
  throw new Error(`${intent.error}: ${intent.message}`);
}

const action = orbi.getPaymentIntentNextAction(intent.data);

if (action.type === 'redirect_to_hosted_challenge') {
  return res.redirect(303, action.url);
}

if (action.type === 'wait_for_webhook') {
  return res.status(202).json({ status: 'processing', intentId: action.intent.id });
}

if (action.type === 'complete') {
  return res.status(200).json({ status: 'completed', intentId: action.intent.id });
}

if (action.type === 'failed') {
  return res.status(409).json({ status: action.intent.status, intentId: action.intent.id });
}
```

For server-side polling in a sandbox or reconciliation worker:

```ts
const finalIntent = await orbi.waitForPaymentIntent('pi_123', {
  intervalMs: 1000,
  timeoutMs: 30000,
});
```

Use return URLs for customer UX only. Signed webhooks and intent reads remain
the source of truth.

## PaySafe Escrow

```ts
const escrow = await orbi.createPaySafeEscrow({
  reference: 'ORDER-10001',
  amount: 125000,
  currency: 'TZS',
  paymentCategory: 'orbi',
  paymentRail: 'orbi_wallet',
  buyer: {
    phone: '+255700000000',
  },
  seller: {
    userId: 'seller-orbi-user-id',
  },
}, {
  idempotencyKey: 'paysafe-create:merchant:ORDER-10001',
});
```

## Payment Profiles

Use payment profiles to link a merchant, seller, SACCOS member, or external
platform customer to an ORBI financial identity. Store `paymentProfileId`; never
store ORBI passwords, OTPs, PINs, raw tokens, wallet IDs as authority, or
challenge evidence.

```ts
const profile = await orbi.linkPaymentProfile({
  externalCustomerId: 'shop-seller-001',
  customerId: 'OB26-9885-6029',
  scopes: ['payment_profile:read', 'payments:create', 'escrow:create'],
  consent: {
    consent_captured: true,
    consent_text_version: 'orbi-payment-profile-v1',
    expires_at: '2027-07-23T00:00:00.000Z',
  },
});
```

`linkPaymentProfile()` automatically uses a stable idempotency key based on
`externalCustomerId` unless you provide one.

## Error Helpers

```ts
import { assertOrbiSuccess, classifyOrbiErrorCode, errorInfoFromResponse } from '@orbifinancial/pay-gateway';

const data = assertOrbiSuccess(profile);

const failure = errorInfoFromResponse(profile);
if (failure?.action === 'request_scope_or_consent') {
  // Start hosted consent/challenge again or request Developer Portal scope approval.
}

const details = classifyOrbiErrorCode('PAYMENT_INTENT_IDEMPOTENCY_MISMATCH');
console.log(details.action); // stop
```

## Webhook Verification

```ts
import {
  handleOrbiWebhookEvent,
  verifyAndParseOrbiWebhook,
} from '@orbifinancial/pay-gateway';

const parsed = verifyAndParseOrbiWebhook({
  rawBody,
  signatureHeader: req.headers['x-orbi-pay-signature'],
  timestampHeader: req.headers['x-orbi-pay-timestamp'],
  secret: process.env.ORBI_PAY_WEBHOOK_SECRET!,
});

if (!parsed.ok) {
  throw new Error(`Invalid ORBI webhook: ${parsed.reason}`);
}

await handleOrbiWebhookEvent(parsed.event, {
  'payment_intent.updated': async (event) => {
    // Update local order/payment state after deduping event.eventId.
    console.log(event.paymentIntent.id, event.paymentIntent.status);
  },
  'consent.revoked': async (event) => {
    // Disconnect local access for the affected user/business.
    console.log(event.consent.consentId, event.consent.subjectId);
  },
  fallback: async (event) => {
    // Log unknown future event types safely.
    console.log(event.eventType);
  },
});
```

## Consent Receipts And Webhook Replay

Developer Portal/operator APIs use `operatorKey`. Runtime payment APIs use
`serviceKey`. Keep both server-side only.

```ts
const operator = new OrbiPayGatewayClient({
  baseUrl: 'https://pay.orbifinancial.com',
  operatorKey: process.env.ORBI_PAY_OPERATOR_KEY!,
});

const activeConsent = await operator.listConsentReceipts({
  serviceCode: 'orbi-shop',
  subjectId: 'user_001',
  status: 'active',
});

await operator.revokeConsentReceipt('consent_001', {
  revokedBy: 'user_001',
  reason: 'Customer revoked checkout permission.',
});

await operator.replayWebhookDelivery('whdel_001', {
  requestId: 'manual-replay-whdel-001',
});

await operator.replayFailedWebhookDeliveries({
  serviceCode: 'orbi-shop',
}, {
  limit: 10,
});

const scopeCatalog = await operator.getConsentScopeCatalog();

const environments = await operator.getDeveloperEnvironmentProfiles();
const liveProfile = await operator.getDeveloperEnvironmentProfile('live');
const simulator = await operator.getSandboxSimulatorFlow();

const consentStatus = await operator.getConsentStatus({
  serviceCode: 'orbi-shop',
  subjectId: 'user_001',
  scopes: ['payments:create'],
  environment: 'live',
  renewalWindowDays: 30,
});
```

Use the consent scope catalog to render customer-facing permission labels in
English or Swahili instead of exposing raw scope strings. Use consent status
to decide whether to continue, show renewal copy, or redirect the customer
through hosted consent again.

Customer-facing Consent Center APIs use trusted subject context injected by
your ORBI front door/session layer. They are useful for "Connected services"
screens where a user or business can review and disconnect merchant access.

```ts
const connected = await client.listConnectedConsents({ status: 'active', locale: 'sw' }, {
  subject: { id: 'user_001', type: 'user' },
});

const receipt = await client.getConnectedConsent('consent_001', { locale: 'en' }, {
  subject: { id: 'user_001', type: 'user' },
});

await client.revokeConnectedConsent('consent_001', {
  reason: 'Customer disconnected the service.',
}, {
  subject: { id: 'user_001', type: 'user' },
  requestId: 'req-revoke-consent-001',
});
```

Webhook payloads are typed with `OrbiWebhookEvent`, including:

```text
payment_intent.updated
consent.revoked
```

## Idempotency

Always reuse the same idempotency key when retrying the same operation after a
network failure. Never generate a new idempotency key for the same checkout,
escrow, refund, release, or dispute attempt.

## Security Rules

```text
Keep service keys server-side.
Keep webhook signing secrets server-side.
Verify every webhook before processing it.
Dedupe webhook events in your system.
Use return URLs for UX only.
Use signed webhooks and intent reads for payment truth.
```
