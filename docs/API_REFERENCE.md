# ORBI Pay Gateway API Reference

The gateway API is provider-facing and rail-facing. ORBI Core remains the business and ledger authority.

For the stable BaaS/Open Banking contract families used by merchants,
marketplaces, and third-party platforms, see
[Platform Integration Contracts](./PLATFORM_INTEGRATION_CONTRACTS.md).
For service/app onboarding, scope approvals, API key rotation, redirect
allowlists, webhook allowlists, and developer dashboard shapes, see
[Developer Portal Contracts](./DEVELOPER_PORTAL_CONTRACTS.md).
For versioning, lifecycle vocabulary, and stable error codes, see
[Contract Versioning And Error Codes](./CONTRACT_VERSIONING_AND_ERROR_CODES.md).

Canonical external integration families:

```text
Payment Profile
Hosted Challenge
Payment Intent
PaySafe Escrow Lifecycle
Webhook Events
Developer/Merchant Scopes
```

## SDK First

Use the official SDKs for runtime financial operations. They exchange service
keys for short-lived access tokens, send environment headers, HMAC signatures,
nonces, timestamps, and idempotency keys consistently, so developers do not
have to hand-roll raw HTTP for sensitive payment flows.

```bash
npm i @orbifinancial/pay-gateway
pip install orbi-pay-gateway
composer require orbifinancial/pay-gateway
```

Raw endpoint examples remain in this reference for advanced operators, SDK
authors, and platform teams. Merchant applications should prefer SDK methods
such as `orbi.identity.resolve(...)`, `orbi.payments.createIntent(...)`,
`orbi.payments.waitForIntent(...)`, `orbi.paysafe.create(...)`, and
`orbi.webhooks.verify(...)`.

Recommended Node setup:

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

## Health

```http
GET /health
```

Returns service status, provider mode, and timestamp.

## Readiness

```http
GET /ready
```

Returns Core callback target, mTLS mode, provider mode, and provider adapter readiness. Secrets are never returned.
Provider readiness includes `protocolCapabilities` so operators can see whether a rail is `generic-live`, `certified-live`, or intentionally `fail-closed`.

## Trusted Services

Trusted ORBI products such as ORBI Shop use scoped service credentials instead of provider credentials.

```http
GET /v1/services
x-orbi-pay-operator-key: <PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY>
```

Returns sanitized service registry entries. This is operator-only.

```http
GET /v1/service-profile
x-orbi-pay-service-key: <service-api-key>
```

Returns the authenticated service profile without secrets. The service is identified from the key, not from the URL.

## Developer Environment Profiles

Developer Portal tools expose sandbox/live separation explicitly. These are
operator/developer-control endpoints, not runtime financial endpoints.

```http
GET /v1/developer/environment-profiles
GET /v1/developer/environment-profiles/sandbox
GET /v1/developer/environment-profiles/live
GET /v1/developer/sandbox-simulator
x-orbi-pay-operator-key: <PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY>
```

Sandbox is simulated and must not commit real Core ledger movement. Live is
real-money and requires approved scopes, allowlists, live credentials, signed
webhooks, and stable idempotency keys.

## Payment Intents

Payment intents are the production-style entry point for external ORBI products. A product creates an intent, optionally submits it immediately, and Pay Gateway forwards the signed request to ORBI Core. ORBI Core decides whether the movement is internal, external, escrow, refund, or provider-bound.

```http
POST /v1/payment-intents
x-orbi-pay-service-key: <ORBI_SHOP_PAY_API_KEY>
x-orbi-environment: production
Idempotency-Key: payment-intent:SHOP-ORDER-10001
x-orbi-signature: sha256=<hmac>
x-orbi-timestamp: <unix-seconds>
x-orbi-nonce: <unique-nonce>
Content-Type: application/json
```

Financial runtime requests must include `x-orbi-environment` and a stable
`Idempotency-Key`. Demo requests use sandbox keys. Production requests use live
keys. A sandbox key cannot execute production requests, and a live key cannot be
used as a demo key.

Financial POST requests are HMAC signed. The canonical string is:

```text
<timestamp>.<nonce>.<METHOD>.<path-with-query>.<sha256-hex-raw-body>
```

The SDK signs this automatically. Raw HTTP integrations must send
`x-orbi-signature`, `x-orbi-timestamp`, and `x-orbi-nonce`.

```json
{
  "operation": "collection",
  "reference": "SHOP-ORDER-10001",
  "amount": 125000,
  "currency": "TZS",
  "confirm": true,
  "description": "ORBI Shop escrow checkout",
  "customer": {
    "name": "Daniel",
    "email": "customer@example.com",
    "phone": "+255700000000",
    "userId": "orbi-user-id"
  },
  "metadata": {
    "orderId": "SHOP-ORDER-10001",
    "sellerId": "seller-001"
  }
}
```

Response:

```json
{
  "success": true,
  "data": {
    "id": "pi_xxx",
    "serviceCode": "orbi-shop",
    "operation": "collection",
    "reference": "SHOP-ORDER-10001",
    "amount": 125000,
    "currency": "TZS",
    "status": "processing",
    "checkoutUrl": "https://pay.orbifinancial.com/checkout/pi_xxx"
  }
}
```

Confirm an existing intent:

```http
POST /v1/payment-intents/:intentId/confirm
x-orbi-pay-service-key: <service-api-key>
Content-Type: application/json
```

Read an intent:

```http
GET /v1/payment-intents/:intentId
x-orbi-pay-service-key: <service-api-key>
```

## Payment Profiles

Payment profiles let a trusted service link its own customer record to a
Core-owned ORBI financial profile. The service stores the returned
`paymentProfileId`; Core keeps user identity, consent, scopes, risk, and wallet
authority.

```http
POST /v1/payment-profiles
x-orbi-pay-service-key: <service-api-key>
Idempotency-Key: payment-profile:<service-code>:<external-customer-id>
Content-Type: application/json
```

```json
{
  "customerId": "OB26-9885-6029",
  "externalCustomerId": "shop-customer-456",
  "scopes": [
    "payment_profile:read",
    "payments:create",
    "escrow:create",
    "balance:read"
  ],
  "consent": {
    "consent_captured": true,
    "consent_text_version": "orbi-payment-profile-v1",
    "balance_read_allowed": true
  },
  "metadata": {
    "source_service_code": "orbi_shop",
    "registration_channel": "pay_gateway"
  }
}
```

At least one of `userId`, `customerId`, `email`, or `phone` is required.
Merchants must not store wallet IDs or use a payment profile as automatic
authority to move funds.

## PaySafe Escrow Product

PaySafe uses global product routes. Pay Gateway does not release, dispute, or refund funds by itself. It packages the request, authenticates the service, and sends a signed request to ORBI Core. Core owns escrow policy, customer authorization, ledger movement, and provider routing.

For marketplace products such as ORBI Shop, the service profile must be linked to an active ORBI merchant. The gateway only sends the merchant identity and fee profile. Core resolves the merchant's PaySafe escrow wallet and settlement wallet from its own merchant wallet registry:

```json
{
  "merchant": {
    "merchantIdEnv": "ORBI_SHOP_MERCHANT_ID",
    "feeProfileCode": "ORBI_SHOP_PAYSAFE",
    "feeFlowCode": "MERCHANT_PAYMENT",
    "requireActiveMerchant": true
  }
}
```

Every PaySafe request is merchant-scoped. Core validates that the merchant is active, resolves an active merchant PaySafe escrow wallet, resolves a settlement wallet when needed, and only then returns a customer challenge or balance projection.

Developer Portal backed services must carry the same merchant metadata in
`pay_gateway_developer_services.metadata`. Runtime authentication converts that
metadata into a `PayServiceDefinition` before calling Core. If `merchant` is
missing or `merchantIdEnv` resolves to an empty value, Core must fail closed
with a merchant readiness error instead of creating an unscoped escrow.

Required live readiness for merchant PaySafe:

```text
service.status = active
service.environments contains live
service.scopes_granted contains payments:create and escrow:create
service.metadata.allowedOperations contains paysafe
service.metadata.allowedCurrencies contains the request currency
service.metadata.merchant.merchantIdEnv points to a live env var
ORBI_SHOP_MERCHANT_ID or equivalent resolves to an active Core merchant
Core has an active PaySafe escrow wallet for that merchant
Core has settlement wallet rules for release/settlement flows
```

Create an escrow hold:

```http
POST /v1/paysafe/escrows
x-orbi-pay-service-key: <service-api-key>
Content-Type: application/json
```

```json
{
  "reference": "SHOP-ORDER-10001",
  "amount": 125000,
  "currency": "TZS",
  "paymentCategory": "orbi",
  "paymentRail": "orbi_wallet",
  "description": "ORBI Shop protected checkout",
  "buyer": {
    "type": "user",
    "userId": "buyer-orbi-user-id",
    "phone": "+255700000000"
  },
  "seller": {
    "userId": "seller-orbi-user-id",
    "walletId": "seller-wallet-id"
  },
  "metadata": {
    "orderId": "SHOP-ORDER-10001"
  }
}
```

`operation=paysafe` always means successful funds must become protected PaySafe
hold/escrow before merchant release or settlement. Every merchant UI must
collect and send a route. The gateway rejects PaySafe requests that omit
`paymentCategory` or `paymentRail`; external rails also require `providerCode`.

| UI choice | `paymentCategory` | `paymentRail` | Required buyer fields |
| --- | --- | --- | --- |
| Pay with ORBI Wallet | `orbi` | `orbi_wallet` | ORBI `userId`, phone, or email for Core lookup |
| Pay with Mobile Money | `mobile_money` | `mno_tz` | `phone` and `providerCode` |
| Pay with Bank | `bank` | `bank_transfer_tz` | `accountNumber` and `providerCode` |
| Pay with Card | `card` | `card_gateway` | card/provider token and `providerCode` |

External PaySafe collection example:

```json
{
  "reference": "SHOP-ORDER-10002",
  "amount": 125000,
  "currency": "TZS",
  "paymentCategory": "mobile_money",
  "paymentRail": "mno_tz",
  "providerCode": "vodacom_mpesa_tz",
  "description": "ORBI Shop protected mobile-money checkout",
  "buyer": {
    "type": "external_customer",
    "name": "Guest Buyer",
    "phone": "+255700000000"
  },
  "seller": {
    "userId": "seller-orbi-user-id"
  },
  "metadata": {
    "orderId": "SHOP-ORDER-10002",
    "guestCheckout": true
  }
}
```

Route mismatches fail closed. For example, `paymentCategory=bank` with
`paymentRail=mno_tz` is rejected because the gateway cannot safely infer where
money should enter before the PaySafe hold.

Release held funds:

```http
POST /v1/paysafe/escrows/:escrowId/release
x-orbi-pay-service-key: <service-api-key>
Content-Type: application/json
```

Dispute an escrow:

```http
POST /v1/paysafe/escrows/:escrowId/dispute
x-orbi-pay-service-key: <service-api-key>
Content-Type: application/json
```

Refund an escrow:

```http
POST /v1/paysafe/escrows/:escrowId/refund
x-orbi-pay-service-key: <service-api-key>
Content-Type: application/json
```

Action body:

```json
{
  "reference": "SHOP-ORDER-10001",
  "reason": "Customer confirmed delivery issue",
  "customer": {
    "phone": "+255700000000"
  },
  "metadata": {
    "orderId": "SHOP-ORDER-10001"
  }
}
```

For release/refund, `amount` may be supplied for partial settlement. For dispute, amount may be omitted because Core decides whether money should move.

### PaySafe Seller/Customer Balance Read

Trusted services can read a customer's PaySafe holding summary through Pay Gateway. This is designed for seller portals such as ORBI Shop so a seller can see protected incoming payments without opening the ORBI mobile app.

```http
GET /v1/paysafe/users/:userId/balance
x-orbi-pay-service-key: <service-api-key>
```

Alternative lookup:

```http
GET /v1/paysafe/balances?userId=<orbi-user-id>&includeHistory=true
GET /v1/paysafe/balances?phone=%2B255700000000
GET /v1/paysafe/balances?email=seller@example.com
```

Response:

```json
{
  "success": true,
  "data": {
    "serviceCode": "orbi-shop",
    "user": {
      "id": "orbi-user-id",
      "displayName": "Seller Name",
      "email": "seller@example.com",
      "phone": "+255700000000",
      "accountStatus": "active"
    },
    "totals": [
      {
        "currency": "TZS",
        "incomingHeld": 125000,
        "outgoingHeld": 0,
        "incomingDisputed": 0,
        "outgoingDisputed": 0,
        "releasedIncoming": 0,
        "refundedOutgoing": 0,
        "totalIncomingProtected": 125000,
        "totalOutgoingProtected": 0
      }
    ],
    "escrows": [
      {
        "escrowId": "escrow-id",
        "direction": "incoming",
        "amount": 125000,
        "currency": "TZS",
        "status": "HELD",
        "reference": "SHOP-ORDER-10001"
      }
    ]
  }
}
```

By default only active PaySafe states are returned (`HELD`, `DISPUTED`). Use `includeHistory=true` to include released/refunded history for seller reconciliation pages. Results are filtered to the authenticated service's merchant context, so one merchant cannot see another merchant's PaySafe holdings for the same ORBI user.

## Business Registration

Trusted services submit business access registration through Pay Gateway, not
directly to Core.

```http
POST /v1/business/registrations
x-orbi-pay-service-key: <service-api-key>
Content-Type: application/json
```

Request:

```json
{
  "email": "seller@example.com",
  "phone": "+255700000000",
  "requestedRole": "MERCHANT",
  "businessName": "Zakaria Supplies",
  "externalBusinessId": "shop-seller-123",
  "note": "Seller registration from trusted service",
  "metadata": {
    "storeName": "Zakaria Supplies",
    "registrationChannel": "orbi_shop"
  }
}
```

At least one of `userId`, `email`, or `phone` is required. Gateway signs and
forwards the request to Core:

```text
POST /api/internal/pay-gateway/business/registrations
scope: gateway:business-registration:write
```

Core remains the authority for `users`, `registry_type`, `role`,
`service_access_requests`, merchant approval, merchant wallets, and settlement
state.

Merchant-native seller portal endpoints:

```http
GET /v1/merchant/paysafe/balance
x-orbi-pay-service-key: <service-api-key>
```

Returns PaySafe holdings for the authenticated service merchant.

```http
GET /v1/merchant/orders/:orderId/payment-status
x-orbi-pay-service-key: <service-api-key>
```

Returns the escrow/payment state for one merchant order.

```http
GET /v1/merchant/settlements?currency=TZS&status=completed&limit=50&offset=0
x-orbi-pay-service-key: <service-api-key>
```

Returns merchant settlement report projections from Core.

## Service Webhooks

When Core later returns or emits a service-facing payment result, Pay Gateway can post an event to the service callback URL configured in `config/services.json`. Provider execution callbacks still flow provider -> Pay Gateway -> Core.

Core posts service-facing results to Pay Gateway here:

```http
POST /v1/internal/core/service-payment-events
content-type: application/json
x-worker-id: orbi-core
x-worker-scopes: gateway:service-payments:result
x-worker-request-id: <uuid>
x-worker-timestamp: <iso-date>
x-worker-nonce: <uuid>
x-worker-signature: <hmac>
```

Example challenge response:

```json
{
  "intentId": "pi_xxx",
  "serviceCode": "orbi-shop",
  "status": "requires_action",
  "message": "Customer authorization is required.",
  "challenge": {
    "type": "PIN",
    "challengeId": "ch_xxx",
    "prompt": "Enter your ORBI PIN to approve this payment.",
    "expiresAt": "2026-06-17T10:45:00.000Z",
    "delivery": {
      "channel": "in_app",
      "destinationHint": "ORBI mobile app"
    }
  }
}
```

ORBI Shop should show a waiting state while ORBI Core locates the customer and decides the challenge. If Core returns `requires_action`, Shop/mobile UI should open the relevant OTP/PIN/passkey confirmation flow. External services must never bypass Pay Gateway or call Core/provider routes directly.

Headers:

```txt
x-orbi-pay-service-code: orbi-shop
x-orbi-pay-event-id: <uuid>
x-orbi-pay-timestamp: <unix-seconds>
x-orbi-pay-signature: sha256=<hmac>
```

Signature payload:

```txt
<timestamp>.<stable-json-body>
```

The webhook secret is resolved from the service registry `webhookSecretTokenRefEnv`, for example:

```env
ORBI_SHOP_PAY_WEBHOOK_SECRET_TOKEN_REF=env://ORBI_SHOP_PAY_WEBHOOK_SECRET
ORBI_SHOP_PAY_WEBHOOK_SECRET=<strong-secret>
```

## Provider List

```http
GET /v1/providers
GET /v1/providers/:providerCode/health
```

Provider codes are loaded from the provider manifest. They are not hardcoded in source.

Provider health response includes:

- `rail`: mobile money, bank, card gateway, or crypto.
- `protocol`: selected protocol engine.
- `missingEnv`: required env references that are not configured.
- `credentialBinding`: tokenized credential status without exposing secrets.
- `protocolCapabilities`: online authorization, webhook, batch, network-control, and certification posture.

## OBP/NMB Payment Capability Discovery

```http
GET /v1/discovery/obp/:providerCode/payment-capabilities?bankId=nmbb.01.tz.nmbb&countryCode=TZ&currency=TZS
x-orbi-pay-operator-key: <PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY>
```

This operator-only endpoint discovers payment capability candidates from an Open Bank Project provider such as `nmb-obp-sandbox`.

The gateway inspects:

- `/obp/v4.0.0/banks`
- `/obp/v2.1.0/banks/{BANK_ID}/transaction-request-types`
- `/obp/v6.0.0/management/system-dynamic-entities`
- `/obp/v6.0.0/management/banks/{BANK_ID}/dynamic-entities`
- account-level transaction request types when `accountId` and `viewId` are provided

The response is a review list, not a production switch-on command. ORBI Core and the Admin Portal must approve and save selected entries into `payment_rail_capabilities` before mobile apps display them.

Example response item:

```json
{
  "sourceProviderCode": "nmb-obp-sandbox",
  "source": "OBP_TRANSACTION_REQUEST_TYPE",
  "capabilityCode": "M_PESA_TZ_TZ",
  "displayName": "M Pesa Tz",
  "rail": "MOBILE_MONEY",
  "countryCode": "TZ",
  "currency": "TZS",
  "operations": ["collection", "payout"],
  "operationCodes": ["COLLECTION_REQUEST", "DISBURSEMENT_REQUEST"],
  "status": "REQUIRES_REVIEW",
  "requires": { "msisdn": true }
}
```

Do not expose this endpoint publicly. It uses provider credentials to inspect bank capability metadata and must remain operator/internal only.

## OBP/NMB Sandbox Accounts

```http
GET /v1/discovery/obp/:providerCode/banks/:bankId/accounts?scope=all&accountType=CURRENT
x-orbi-pay-operator-key: <PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY>
```

This operator-only endpoint helps engineers inspect NMB/OBP sandbox accounts after sandbox data has been imported or issued by the bank.

Supported `scope` values:

- `latest`: calls `/obp/v6.0.0/banks/{BANK_ID}/accounts`
- `private`: calls `/obp/v3.0.0/banks/{BANK_ID}/accounts/private`
- `public`: calls `/obp/v2.0.0/banks/{BANK_ID}/accounts/public`
- `all`: inspects all of the above and returns a merged list

Optional `accountType` is forwarded to authenticated account endpoints as `account_type`.

The response includes sanitized account metadata and an `inspected` section showing which OBP endpoints worked. This endpoint is for operator sandbox validation only. Mobile apps must never consume raw OBP account lists directly; they must consume approved ORBI Core payment methods.

## OBP Sandbox Data Import

```http
POST /v1/discovery/obp/:providerCode/sandbox/data-import
x-orbi-pay-operator-key: <PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY>
Content-Type: application/json
```

Passes a sandbox data import payload to:

```txt
/obp/v2.1.0/sandbox/data-import
```

Use this only in sandbox with a user that has the OBP `CanCreateSandbox` entitlement. The payload can create test banks, users, accounts, transactions, branches, and ATMs depending on the OBP sample you provide.

Never enable sandbox data import against production provider profiles.

## OBP Sandbox Operator Tools

These routes are separated from live payment execution and are disabled by default.

Required env:

```env
PAYMENT_GATEWAY_OBP_SANDBOX_TOOLS_ENABLED=true
PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY=<strong-operator-key>
```

Keep `PAYMENT_GATEWAY_OBP_SANDBOX_TOOLS_ENABLED=false` in production unless you are intentionally operating a sandbox profile from a locked-down operator session.

### List Sandbox Banks

```http
GET /v1/sandbox/obp/:providerCode/banks
x-orbi-pay-operator-key: <PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY>
```

Returns sanitized bank records from `/obp/v4.0.0/banks`. Use these IDs for sandbox account discovery and account creation.

### Request Sandbox Entitlement

```http
POST /v1/sandbox/obp/:providerCode/entitlement-requests
x-orbi-pay-operator-key: <PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY>
Content-Type: application/json
```

```json
{
  "bankId": "",
  "roleName": "CanCreateSandbox"
}
```

This proxies to `/obp/v3.0.0/entitlement-requests`. OBP infers the requesting user from the authenticated DirectLogin token and may create a pending request rather than approving the role immediately.

### Check My Sandbox Entitlement Requests

```http
GET /v1/sandbox/obp/:providerCode/my/entitlement-requests
x-orbi-pay-operator-key: <PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY>
```

Returns pending/current entitlement requests for the authenticated OBP provider user when supported by the bank sandbox. The gateway probes supported OBP versions and returns an `inspected` list.

### Check My Sandbox Entitlements

```http
GET /v1/sandbox/obp/:providerCode/my/entitlements
x-orbi-pay-operator-key: <PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY>
```

Returns active entitlements for the authenticated OBP provider user when supported by the bank sandbox. Use this to confirm whether roles like `CanCreateSandbox` or `CanCreateAccount` are active before running account/data import tools.

### Create Sandbox Account

```http
PUT /v1/sandbox/obp/:providerCode/banks/:bankId/accounts/:accountId
x-orbi-pay-operator-key: <PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY>
Content-Type: application/json
```

```json
{
  "userId": "obp-user-id",
  "label": "ORBI Test Current Account",
  "productCode": "CURRENT",
  "branchId": "BRANCH1",
  "currency": "TZS",
  "amount": "0",
  "accountRoutings": [
    {
      "scheme": "OBP",
      "address": "orbi-test-current-001"
    }
  ]
}
```

This proxies to `/obp/v5.0.0/banks/{BANK_ID}/accounts/{ACCOUNT_ID}`. It usually requires `CanCreateAccount`. Keep initial balance `0`; test balances should be created through sanctioned sandbox data or transaction flows, not arbitrary hidden credits.

## Collections

```http
POST /v1/collections
Content-Type: application/json
```

Use collections when external money is moving into ORBI, for example external rail to ORBI wallet.

```json
{
  "providerCode": "provider-code",
  "reference": "ORBI-DEP-20260604-0001",
  "amount": 10000,
  "currency": "TZS",
  "phone": "+255700000000",
  "walletId": "target-orbi-wallet-id",
  "description": "Wallet deposit",
  "metadata": {
    "coreMovementId": "external-fund-movement-id",
    "userId": "orbi-user-id"
  }
}
```

## Payouts

```http
POST /v1/payouts
Content-Type: application/json
```

Use payouts when ORBI-approved money is moving out to an external provider rail.

```json
{
  "providerCode": "provider-code",
  "reference": "ORBI-WDR-20260604-0001",
  "amount": 5000,
  "currency": "TZS",
  "phone": "+255700000000",
  "description": "Wallet withdrawal",
  "metadata": {
    "coreMovementId": "external-fund-movement-id",
    "sourceWalletId": "orbi-wallet-id"
  }
}
```

## Refunds

```http
POST /v1/refunds
Content-Type: application/json
```

Refunds must reference the original ORBI transaction or provider reference so Core keeps the money lifecycle closed.

```json
{
  "providerCode": "provider-code",
  "reference": "ORBI-RFD-20260604-0001",
  "amount": 5000,
  "currency": "TZS",
  "phone": "+255700000000",
  "description": "Refund for original transaction",
  "metadata": {
    "originalTransactionId": "core-transaction-id",
    "originalProviderReference": "provider-reference"
  }
}
```

## Provider Webhooks

```http
POST /v1/webhooks/:providerCode
Content-Type: application/json
```

Provider adapters parse provider-specific callbacks into normalized events:

Provider callbacks are verified against the manifest-defined signature contract before normalization. Unsigned, stale, replayed, or tampered callbacks are rejected before ORBI Core receives any event.

```json
{
  "providerId": "provider-code",
  "reference": "ORBI-DEP-20260604-0001",
  "status": "completed",
  "message": "Provider confirmed payment",
  "providerEventId": "provider-event-id",
  "rawStatus": "0",
  "payload": {}
}
```

The gateway then signs the normalized event and sends it to ORBI Core:

```http
POST /api/internal/gateway/provider-events
```

Required worker scope:

```txt
gateway:events:write
```
