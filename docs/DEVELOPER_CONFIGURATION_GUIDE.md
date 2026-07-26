# ORBI Pay Gateway Developer Configuration Guide

This guide is the practical setup checklist for merchants, marketplaces,
SACCOS, organizations, and BaaS platforms integrating with ORBI Pay Gateway.

## 1. Choose Environment

Use the same SDK methods in every environment. Only configuration changes.

```text
Demo/Sandbox base URL: https://sandbox-pay.orbifinancial.com
Production/Live base URL: https://pay.orbifinancial.com
```

```ts
import { createOrbi } from '@orbifinancial/pay-gateway';

const orbi = createOrbi({
  baseUrl: process.env.ORBI_PAY_GATEWAY_BASE_URL!,
  serviceKey: process.env.ORBI_PAY_SERVICE_KEY!,
  environment: process.env.ORBI_PAY_ENVIRONMENT === 'Production'
    ? 'Production'
    : 'Demo',
});
```

Required key prefixes:

```text
Demo service keys: orbi_sandbox_...
Live service keys: orbi_live_...
Demo webhook secrets: orbi_whsec_sandbox_...
Live webhook secrets: orbi_whsec_live_...
```

Never use sandbox keys on live endpoints or live keys on sandbox endpoints.

## 2. Server Environment Variables

Keep these variables only on the merchant server. Do not expose them in
browsers, Vite client bundles, APKs, mobile apps, or public JavaScript.

```env
ORBI_PAY_GATEWAY_BASE_URL=https://sandbox-pay.orbifinancial.com
ORBI_PAY_ENVIRONMENT=Demo
ORBI_PAY_SERVICE_KEY=orbi_sandbox_xxx
ORBI_PAY_WEBHOOK_SECRET=orbi_whsec_sandbox_xxx
ORBI_PAY_RETURN_URL=https://merchant.example.com/orbi/return
ORBI_PAY_CANCEL_URL=https://merchant.example.com/orbi/cancel
ORBI_PAY_WEBHOOK_URL=https://merchant.example.com/api/orbi/webhooks
```

Production uses:

```env
ORBI_PAY_GATEWAY_BASE_URL=https://pay.orbifinancial.com
ORBI_PAY_ENVIRONMENT=Production
ORBI_PAY_SERVICE_KEY=orbi_live_xxx
ORBI_PAY_WEBHOOK_SECRET=orbi_whsec_live_xxx
```

## 3. Required Request Headers

The official SDK sends these automatically for financial POST requests.

```http
content-type: application/json
accept: application/json
x-orbi-pay-service-key: <service-key>
x-orbi-environment: demo|production
idempotency-key: <stable-operation-key>
x-request-id: <optional-trace-id>
x-orbi-signature: sha256=<hmac>
x-orbi-timestamp: <unix-timestamp-seconds>
x-orbi-nonce: <unique-nonce>
```

Use one stable idempotency key per business operation:

```text
payment-intent:<merchant-service-code>:<order-id>
paysafe-create:<merchant-service-code>:<order-id>
paysafe-release:<merchant-service-code>:<escrow-id>:<action-id>
webhook-replay:<delivery-id>:<attempt>
```

If a network timeout happens, retry with the same idempotency key. Do not
generate a new key unless the customer starts a new operation.

## 4. Merchant PaySafe Readiness

For merchant-scoped PaySafe/payment requests, Developer Portal or operator
setup must provide:

```json
{
  "serviceCode": "merchant_service",
  "status": "active",
  "environments": ["sandbox", "live"],
  "scopesGranted": [
    "payments:create",
    "escrow:create",
    "escrow:read",
    "webhooks:receive"
  ],
  "metadata": {
    "allowedOperations": ["collection", "refund", "paysafe"],
    "allowedCurrencies": ["TZS"],
    "allowedCountries": ["TZ"],
    "merchant": {
      "merchantIdEnv": "MERCHANT_CORE_ID",
      "feeProfileCode": "MERCHANT_PAYSAFE",
      "feeFlowCode": "MERCHANT_PAYMENT",
      "requireActiveMerchant": true
    }
  }
}
```

Runtime environment must include the merchant ID env var:

```env
MERCHANT_CORE_ID=<core-merchant-uuid>
```

Core must have:

```text
active merchant record
active merchant PaySafe escrow wallet
settlement wallet/rules for release and payout lifecycle
```

If any of these are missing, the request must fail closed with a merchant
readiness error.

## 5. Checkout Payment Intent

Use the SDK wrapper. Developers should not hand-roll raw HTTP unless building a
new SDK.

```ts
const intent = await orbi.transfers.send({
  reference: 'ORDER-10001',
  amount: 125000,
  currency: 'TZS',
  description: 'Protected checkout',
  customer: {
    phone: '+255700000000',
  },
  returnUrl: process.env.ORBI_PAY_RETURN_URL!,
  cancelUrl: process.env.ORBI_PAY_CANCEL_URL!,
  callbackUrl: process.env.ORBI_PAY_WEBHOOK_URL!,
  metadata: {
    orderId: 'ORDER-10001',
    locale: 'sw',
    timezone: 'Africa/Dar_es_Salaam',
  },
}, {
  idempotencyKey: 'payment-intent:merchant:ORDER-10001',
  requestId: 'checkout:ORDER-10001',
});
```

If `challengeUrl` is returned, redirect the customer to the hosted challenge.
When the challenge completes, use webhook + intent read as payment truth.
Return URL is UX continuation only.

## 6. Webhook Receiver

Webhook receiver must:

```text
verify x-orbi-pay-signature
dedupe eventId
persist raw event payload for audit
update local order by intentId/reference
return 2xx only after local state is safely persisted
retry or replay failed events from Developer Portal/SDK
```

Node SDK:

```ts
const event = orbi.webhooks.parse({
  rawBody,
  signatureHeader: req.header('x-orbi-pay-signature') || '',
  timestampHeader: req.header('x-orbi-pay-timestamp') || '',
  secret: process.env.ORBI_PAY_WEBHOOK_SECRET!,
});
```

## 7. Sandbox Simulation

Sandbox has the same developer contract shape as live:

```text
same SDK methods
same request/response envelope
same idempotency expectation
same hosted challenge concept
same webhook event family
same public statuses
```

Sandbox differs only here:

```text
money is simulated
no Core ledger commit
provider mode is simulator
test webhook events are signed with sandbox webhook secret
fake accounts are used for simulator tools
```

Simulation helpers are operator/developer tooling, not production money APIs:

```ts
await orbi.developer.sandboxSimulator.reset();

const accounts = await orbi.developer.sandboxSimulator.accounts();

const transfer = await orbi.developer.sandboxSimulator.transfer({
  fromAccountId: 'sbx_buyer_daniel',
  toAccountId: 'sbx_seller_catherine',
  amount: 25000,
  currency: 'TZS',
  reference: 'SBX-ORDER-1',
});

const event = await orbi.developer.sandboxSimulator.webhookEvent(
  transfer.success ? transfer.data.transferId : 'sbx_tx_id',
);
```

Expected seeded sandbox accounts:

```text
sbx_buyer_daniel       buyer   TZS 1,000,000
sbx_seller_catherine   seller  TZS 250,000
sbx_saccos_member      member  TZS 500,000
sbx_agent_dar          agent   TZS 750,000
```

## 8. Go-Live Checklist

Before switching to Production:

```text
service status is active
live environment is approved
required live scopes are granted
live API key is issued and stored server-side
live webhook secret is issued and stored server-side
redirect URLs are allowlisted
webhook URLs are allowlisted
merchant metadata is configured for merchant-scoped products
merchant env var resolves inside live container
webhook verification and event dedupe are tested
idempotency retry behavior is tested
payment status reconciliation job is tested
sandbox keys are removed from production server env
```

## 9. Common Misconfigurations

```text
PAY_GATEWAY_ENVIRONMENT_REQUIRED:
Missing x-orbi-environment or SDK environment.

PAY_SERVICE_SCOPE_NOT_GRANTED:
Service lacks required scope such as identity:resolve, payments:create, or escrow:create.

Merchant account is not ready:
Service is missing merchant metadata, merchant env var is blank, Core merchant is inactive, or merchant PaySafe wallet is missing.

Webhook signature invalid:
Wrong webhook secret, wrong environment, modified raw body, or timestamp outside tolerance.

Duplicate payment after timeout:
Retry used a new idempotency key instead of reusing the original key.
```

