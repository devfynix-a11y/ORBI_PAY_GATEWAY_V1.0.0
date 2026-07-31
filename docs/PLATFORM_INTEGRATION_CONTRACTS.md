# ORBI Pay Gateway Platform Integration Contracts

This document defines the stable integration contracts for external platforms
building on ORBI Pay Gateway. It is intentionally general: ORBI Shop is only
the reference merchant, not a special protocol.

Current public contract version:

```text
orbi-pay-gateway-contract-v1
```

Contract versioning, lifecycle vocabulary, and error codes are maintained in
[Contract Versioning And Error Codes](./CONTRACT_VERSIONING_AND_ERROR_CODES.md).

## 1. Integration Boundary

```text
External platform
-> ORBI Pay API
-> ORBI hosted challenge when required
-> ORBI payment processing
-> PaySafe, risk checks, receipt, notification, reconciliation
-> signed webhook and return URL back to the external platform
```

The external platform owns its product, order, delivery, storefront, customer
experience, and local user profile. ORBI owns financial identity verification,
hosted authorization, payment profile approval, PaySafe lifecycle, transaction
posting, and reconciliation truth.

## 2. Required Headers

Service requests use scoped service credentials:

```http
Content-Type: application/json
Accept: application/json
x-orbi-pay-service-key: <service-api-key>
Idempotency-Key: <stable-operation-key>
```

`Authorization: Bearer <service-api-key>` and `x-api-key` may be accepted where
implemented, but new integrations should use `x-orbi-pay-service-key`.

Financial or retryable actions must include `Idempotency-Key`. A network retry
must reuse the same key for the same operation and must not create a new key
unless the customer starts a new operation.

## 3. Endpoint Directory

These are the public ORBI Pay API contracts for external services. Internal
operations are intentionally omitted from merchant documentation.

### Service And Readiness

```http
GET /health
GET /ready
GET /v1/service-profile
GET /v1/services
```

`/v1/services` is operator-only. External platforms normally use
`/v1/service-profile` to verify which service key they are using.

### Identity And Business Access

```http
POST /v1/identity/resolve
POST /v1/business/registrations
POST /v1/payment-profiles
```

These endpoints let a trusted service resolve ORBI identity, request business
access, and create/link a payment profile reference. They do not move money.

### Checkout And Payment

```http
POST /v1/payment-intents
GET /v1/payment-intents/:intentId
POST /v1/payment-intents/:intentId/confirm
GET /challenges/:intentId
POST /v1/challenges/:intentId/respond
```

Hosted challenge endpoints are user-facing. Server-to-server integrations
should create/read/confirm payment intents and then redirect the customer to
`challengeUrl` when one is returned.

### PaySafe And Escrow

```http
POST /v1/paysafe/escrows
POST /v1/paysafe/escrows/:escrowId/release
POST /v1/paysafe/escrows/:escrowId/refund
POST /v1/paysafe/escrows/:escrowId/dispute
GET /v1/paysafe/users/:userId/balance
GET /v1/paysafe/balances?userId=<orbi-user-id>
GET /v1/paysafe/balances?phone=<phone>
GET /v1/paysafe/balances?email=<email>
```

PaySafe action routes request a lifecycle action. ORBI decides if the action is
allowed.

### Merchant Views

```http
GET /v1/merchant/paysafe/balance
GET /v1/merchant/orders/:orderId/payment-status
GET /v1/merchant/settlements
```

These routes return sanitized merchant-scoped projections. They do not expose
customer secrets, provider credentials, or account authority.

### Provider Webhooks

```http
POST /v1/webhooks/:providerCode
```

This endpoint is for provider callbacks, not merchant callbacks. Merchant
callbacks are sent by ORBI to the merchant `webhookUrl` or configured
service webhook URL.

## 4. Public Response Shapes

All public contract routes return stable machine-readable envelopes.

Success:

```json
{
  "success": true,
  "data": {}
}
```

Failure:

```json
{
  "success": false,
  "error": "PAYMENT_INTENT_INVALID",
  "message": "Request validation failed.",
  "details": [],
  "requestId": "req_..."
}
```

Rules:

```text
`error` is stable and safe for automation.
`message` is safe for developer dashboards and logs.
`details` contains validation or operator-safe diagnostics.
`requestId` maps to the `x-request-id` response header where available.
Success responses may add optional fields without breaking `v1`.
Clients must ignore unknown optional fields.
Clients must not depend on diagnostic internals or temporary processing labels.
```

### Payment Intent Response

```json
{
  "success": true,
  "data": {
    "id": "pi_...",
    "serviceCode": "orbi_shop",
    "operation": "collection",
    "paymentCategory": "orbi",
    "paymentRail": "orbi_wallet",
    "providerCode": null,
    "reference": "ORDER-10001",
    "amount": 125000,
    "currency": "TZS",
    "status": "processing",
    "description": "Protected checkout",
    "customer": {
      "type": "user",
      "phone": "+255700000000"
    },
    "checkoutUrl": "https://pay.orbifinancial.com/checkout/pi_...",
    "challengeMode": null,
    "challengeUrl": null,
    "providerReference": null,
    "providerMessage": null,
    "webhookDelivery": {
      "attempted": false,
      "delivered": false
    },
    "createdAt": "2026-07-23T00:00:00.000Z",
    "updatedAt": "2026-07-23T00:00:00.000Z"
  }
}
```

Public `status` values:

```text
created
processing
requires_action
completed
failed
cancelled
```

ORBI must not expose temporary internal processing labels as public final
contract statuses.

### Hosted Challenge Response

When customer action is required, the payment intent response uses:

```json
{
  "success": true,
  "data": {
    "id": "pi_...",
    "status": "requires_action",
    "challengeMode": "hosted",
    "challengeUrl": "https://pay.orbifinancial.com/challenges/pi_..."
  }
}
```

The external service redirects to `challengeUrl`. The return URL is only UX
continuation; signed webhook and intent read are the payment truth.

### Payment Profile Response

```json
{
  "success": true,
  "data": {
    "paymentProfileId": "pp_...",
    "serviceCode": "orbi_shop",
    "externalCustomerId": "shop_seller_123",
    "customerId": "OB26-9885-6029",
    "status": "active",
    "scopes": [
      "payment_profile:read",
      "payments:create",
      "escrow:create"
    ],
    "consentExpiresAt": "2027-07-23T00:00:00.000Z"
  }
}
```

The payment profile is a reference, not a password, wallet authority, OTP,
PIN, or token.

### PaySafe Escrow Intent Response

PaySafe creation returns the same public intent envelope with:

```json
{
  "success": true,
  "data": {
    "operation": "paysafe",
    "paymentCategory": "orbi",
    "paymentRail": "orbi_wallet",
    "status": "processing"
  }
}
```

Once funds are held, PaySafe lifecycle actions continue through ORBI rules.
External services may request release, refund, or dispute, but cannot bypass
escrow policy.

### Webhook Event Payload

```json
{
  "eventId": "evt_...",
  "eventType": "payment_intent.completed",
  "contractVersion": "orbi-pay-gateway-contract-v1",
  "serviceCode": "orbi_shop",
  "resourceType": "payment_intent",
  "resourceId": "pi_...",
  "status": "completed",
  "occurredAt": "2026-07-23T00:00:00.000Z",
  "data": {
    "reference": "ORDER-10001",
    "amount": 125000,
    "currency": "TZS"
  }
}
```

Webhook receivers must verify signature, dedupe by `eventId`, and process
events idempotently.

The executable contract schemas live in:

```text
src/contracts/platformContract.ts
tests/platformContract.test.ts
```

## 5. Developer Account vs Financial Account

Developer Portal accounts are integration accounts. They let a builder read
docs, use sandbox, request scopes, manage webhook configuration, and receive
API credentials. A developer account does not receive money, does not own a
wallet, and does not become a receiving account by itself.

Money movement requires an approved ORBI financial profile:

```text
Developer account
-> build/test integration
-> request live access
-> onboard/link merchant, seller, organization, SACCOS, or agent financial profile
-> ORBI verifies the profile and enables the approved payment capabilities
-> your integration uses the approved payment profile for checkout, escrow, or payouts
```

The rule is simple:

```text
Developer access lets you build.
Financial profiles let an approved business receive or move money.
```

### POS Example

A POS software company can register a Developer Portal account first and build
against sandbox without owning a receiving wallet. When a shop wants to receive
real money through that POS, the shop must link or create an ORBI merchant
financial account.

```json
{
  "posDeveloper": "Tag POS Limited",
  "merchant": "Zakaria Supermarket",
  "merchantPaymentProfileId": "pp_merchant_...",
  "merchantFinancialStatus": "approved",
  "posTerminalId": "POS-DAR-001"
}
```

The POS creates a checkout/payment request using the merchant payment profile:

```js
await orbi.payments.createIntent({
  amount: 25000,
  currency: 'TZS',
  paymentProfileId: 'pp_merchant_...',
  reference: 'POS-ORDER-1001',
  returnUrl: 'https://pos.example.com/orbi/return',
  webhookUrl: 'https://pos.example.com/api/orbi/webhooks'
}, {
  idempotencyKey: 'payment-intent:pos:POS-ORDER-1001'
});
```

The POS developer owns software behavior and order screens. ORBI owns hosted
authorization, payment profile validity, transaction posting, PaySafe holds,
receipts, reconciliation, and signed payment updates.

### Organization/SACCOS Rule

An organization such as a SACCOS can maintain its own member records, products,
contribution schedules, and member portal. It can only create ORBI-powered
financial capability after ORBI approval and customer/member authorization
where required.

Approved organization flows use contracts such as:

```http
POST /v1/business/registrations
POST /v1/identity/resolve
POST /v1/payment-profiles
POST /v1/payment-intents
POST /v1/paysafe/escrows
```

ORBI decides whether a payment profile, PaySafe hold, collection, payout, or
balance permission is allowed. Your integration receives clean payment
references and signed updates without handling ORBI secrets or customer PINs.

## 6. Platform User Models

External platforms may have their own users, but financial capability is linked
through ORBI identity and payment profiles.

### ORBI Shop Seller Example

ORBI Shop may create and manage a local seller profile:

```json
{
  "sellerId": "shop_seller_123",
  "storeName": "Zakaria Supplies",
  "ownerName": "Daniel Zakaria",
  "ownerEmail": "seller@example.com",
  "ownerPhone": "+255700000000",
  "localStatus": "pending_payment_profile",
  "marketplaceRole": "seller"
}
```

When the seller selects ORBI Pay settlement, Shop starts ORBI hosted
login/signup, receives a payment profile, and stores only references:

```json
{
  "sellerId": "shop_seller_123",
  "orbiPaymentProfileId": "pp_...",
  "orbiCustomerId": "OB26-9885-6029",
  "orbiLinkStatus": "linked",
  "settlementMethod": "orbi_pay",
  "paymentProfileScopes": [
    "payment_profile:read",
    "payments:create",
    "escrow:create"
  ]
}
```

Shop owns seller products and orders. ORBI owns payment authorization, PaySafe
escrow, merchant approval, settlement proof, and payout controls.

### SACCOS Member Example

A SACCOS platform may create its own member profile:

```json
{
  "memberId": "saccos_member_456",
  "membershipNo": "SAC-2026-00045",
  "fullName": "Catherine Daniel",
  "phone": "+255711000000",
  "memberStatus": "active",
  "shareClass": "ordinary"
}
```

When that member needs ORBI-powered deposits, dues, loan repayments, savings
wallet links, or protected disbursements, the SACCOS links a payment profile:

```json
{
  "memberId": "saccos_member_456",
  "orbiPaymentProfileId": "pp_...",
  "orbiCustomerId": "OB26-1122-3344",
  "allowedScopes": [
    "payment_profile:read",
    "payments:create",
    "balance:read",
    "withdrawal:request"
  ],
  "consentExpiresAt": "2027-07-20T00:00:00.000Z"
}
```

The SACCOS may store member records, contribution schedules, loan files, and
meeting history. ORBI still owns payment confirmation, transaction posting,
settlement proof, dispute handling, and financial audit trail.

### Guest Buyer Example

Guest buyers should not be forced into permanent merchant profiles. For
checkout, the platform can submit the selected rail and customer contact:

```json
{
  "reference": "ORDER-10002",
  "amount": 35000,
  "currency": "TZS",
  "paymentCategory": "mobile_money",
  "paymentRail": "mno_tz",
  "providerCode": "vodacom_mpesa_tz",
  "buyer": {
    "type": "external_customer",
    "name": "Guest Buyer",
    "phone": "+255700000000"
  }
}
```

Guest checkout may create a payment/escrow record, but it should not create a
durable ORBI payment profile unless the customer explicitly signs up or links
one.

## 7. Identity Resolve Contract

Use identity resolve to confirm an ORBI customer before creating a payment
profile or starting a financial request.

```http
POST /v1/identity/resolve
x-orbi-pay-service-key: <service-api-key>
Content-Type: application/json
```

```json
{
  "identifier": "OB26-9885-6029",
  "metadata": {
    "source_service_code": "merchant_service",
    "lookup_reason": "seller_payment_profile_link"
  }
}
```

`identifier` may be an ORBI customer ID, phone, or email according to the
resolver policy. A successful lookup is not authority to move funds.

## 7. Business Registration Contract

Use business registration when an external platform needs ORBI to create or
review business access such as merchant, agent, organization, SACCOS operator,
or seller settlement access.

```http
POST /v1/business/registrations
x-orbi-pay-service-key: <service-api-key>
Idempotency-Key: business-registration:<service-code>:<external-business-id>
Content-Type: application/json
```

```json
{
  "email": "seller@example.com",
  "phone": "+255700000000",
  "requestedRole": "MERCHANT",
  "businessName": "Zakaria Supplies",
  "externalBusinessId": "shop_seller_123",
  "note": "Seller settlement access submitted by merchant platform.",
  "metadata": {
    "registration_channel": "pay_gateway",
    "source_service_code": "orbi_shop",
    "storeName": "Zakaria Supplies",
    "businessCategory": "retail",
    "documentsUploaded": true
  }
}
```

SACCOS/organization example:

```json
{
  "email": "admin@saccos.example",
  "phone": "+255744000000",
  "requestedRole": "ORGANIZATION",
  "businessName": "Mshikamano SACCOS",
  "externalBusinessId": "saccos_001",
  "note": "Organization account for member payments and collections.",
  "metadata": {
    "organizationType": "SACCOS",
    "registrationNumber": "SAC-REG-2026-001",
    "source_service_code": "saccos_platform",
    "requestedCapabilities": [
      "member_collections",
      "loan_repayments",
      "protected_disbursements"
    ]
  }
}
```

At least one of `userId`, `email`, or `phone` is required. ORBI may create a
service access request, require review, or reject the request based on policy.

## 8. Payment Profile Contract

Payment profiles link an external platform identity to an approved ORBI
financial identity.

```http
POST /v1/payment-profiles
x-orbi-pay-service-key: <service-api-key>
Idempotency-Key: payment-profile:<service-code>:<external-customer-id>
Content-Type: application/json
```

```json
{
  "customerId": "OB26-9885-6029",
  "externalCustomerId": "merchant-customer-456",
  "scopes": [
    "payment_profile:read",
    "payments:create",
    "escrow:create",
    "balance:read"
  ],
  "consent": {
    "consent_captured": true,
    "consent_text_version": "orbi-payment-profile-v1",
    "balance_read_allowed": true,
    "expires_at": "2027-07-20T00:00:00.000Z"
  },
  "metadata": {
    "registration_channel": "pay_gateway",
    "source_service_code": "merchant_service"
  }
}
```

At least one identity field is required: `userId`, `customerId`, `email`, or
`phone`.

The response returns `paymentProfileId`. External platforms may store that
reference. They must not store ORBI passwords, OTPs, PINs, wallet IDs as
authority, raw tokens, or challenge evidence.

## 9. Hosted Challenge Contract

When ORBI requires customer authorization, the response returns a hosted
challenge:

```json
{
  "status": "requires_action",
  "challengeMode": "hosted",
  "challengeUrl": "https://pay.orbifinancial.com/challenges/pi_xxx",
  "returnUrl": "https://merchant.example.com/checkout/return",
  "cancelUrl": "https://merchant.example.com/checkout/cancel"
}
```

The external platform should redirect the user to `challengeUrl`. The hosted
page collects OTP/PIN/passkey/consent evidence and continues the payment
operation safely.

When hosted challenge approval includes explicit consent metadata, ORBI also
creates a consent receipt. This receipt is idempotent by payment intent and
challenge evidence, so repeated browser submits or network retries do not create
duplicate consent records.

Required metadata for auto consent receipt creation:

```json
{
  "consentScopes": ["payments:create"],
  "consentPurpose": "Allow protected checkout payment.",
  "consentTextVersion": "orbi-hosted-challenge-consent-v1",
  "consentExpiresAt": "2027-07-23T00:00:00.000Z",
  "locale": "sw",
  "timezone": "Africa/Dar_es_Salaam"
}
```

If `consentScopes` or a stable subject identity is missing, ORBI still lets
the payment challenge complete but does not create a consent receipt.

SDK event handling:

```ts
import {
  handleOrbiWebhookEvent,
  verifyAndParseOrbiWebhook,
} from '@orbifinancial/pay-gateway';

const parsed = verifyAndParseOrbiWebhook({
  rawBody,
  signatureHeader: headers['x-orbi-pay-signature'],
  timestampHeader: headers['x-orbi-pay-timestamp'],
  secret: process.env.ORBI_WEBHOOK_SECRET!,
});

if (!parsed.ok) {
  throw new Error(`Invalid ORBI webhook: ${parsed.reason}`);
}

await handleOrbiWebhookEvent(parsed.event, {
  'payment_intent.updated': async (event) => {
    await markOrderFromPaymentIntent(event.paymentIntent);
  },
  'consent.revoked': async (event) => {
    await unlinkMerchantAccess(event.consent);
  },
});
```

Merchant and BaaS platforms should handle signed `payment_intent.updated` and
`consent.revoked` events through the SDK verifier. Manual webhook replay should
be requested through `replayWebhookDelivery()` or `replayFailedWebhookDeliveries()`
from the SDK operator client so the replay lineage and attempt count remain
auditable.

Rules:

```text
Return URL is UX continuation, not payment truth.
Webhook is payment truth.
Hosted challenge must expire.
Decline must cancel the active challenge/payment intent.
The same idempotency key must protect retry after poor network.
```

Challenge response:

```http
POST /v1/challenges/:intentId/respond
Content-Type: application/x-www-form-urlencoded
```

```text
challengeId=pay_ch_xxx
decision=approve
otp=123456
```

Decline/cancel response:

```text
challengeId=pay_ch_xxx
decision=reject
reason=customer_declined
```

ORBI marks the intent as cancelled/declined and notifies the external platform
according to the challenge state.

## 10. Payment Intent Contract

Payment intents are the recommended entry point for checkout-style flows.

```http
POST /v1/payment-intents
x-orbi-pay-service-key: <service-api-key>
Idempotency-Key: payment-intent:<service-code>:<external-reference>
Content-Type: application/json
```

```json
{
  "operation": "collection",
  "reference": "ORDER-10001",
  "amount": 125000,
  "currency": "TZS",
  "confirm": true,
  "description": "Protected checkout",
  "customer": {
    "phone": "+255700000000",
    "email": "customer@example.com",
    "userId": "optional-orbi-user-id"
  },
  "returnUrl": "https://merchant.example.com/checkout/return",
  "cancelUrl": "https://merchant.example.com/checkout/cancel",
  "webhookUrl": "https://merchant.example.com/api/orbi/webhooks",
  "metadata": {
    "orderId": "ORDER-10001"
  }
}
```

ORBI records the intent, authenticates the service, and returns `processing`,
`requires_action`, `completed`, or `failed`.

Read intent:

```http
GET /v1/payment-intents/:intentId
x-orbi-pay-service-key: <service-api-key>
```

Confirm existing intent:

```http
POST /v1/payment-intents/:intentId/confirm
x-orbi-pay-service-key: <service-api-key>
Idempotency-Key: payment-intent-confirm:<intentId>
Content-Type: application/json
```

```json
{
  "metadata": {
    "confirmSource": "merchant_checkout_retry"
  }
}
```

## 11. PaySafe Escrow Lifecycle Contract

PaySafe routes are global product routes:

```http
POST /v1/paysafe/escrows
POST /v1/paysafe/escrows/:escrowId/release
POST /v1/paysafe/escrows/:escrowId/refund
POST /v1/paysafe/escrows/:escrowId/dispute
```

External platforms may request actions, but ORBI decides validity. Third-party
checkout can skip only the initial native app escrow invitation when hosted
challenge has already authenticated the payer and service context. After money
is held, the standard escrow rules apply:

```text
held
release requested
release confirmed
released
refund requested
refunded
disputed
expired
reconciled
```

No service may bypass release, refund, dispute, or expiry rules after funds are
held.

Create ORBI wallet PaySafe hold:

```http
POST /v1/paysafe/escrows
x-orbi-pay-service-key: <service-api-key>
Idempotency-Key: paysafe-create:<service-code>:<external-reference>
Content-Type: application/json
```

```json
{
  "reference": "ORDER-10001",
  "amount": 125000,
  "currency": "TZS",
  "paymentCategory": "orbi",
  "paymentRail": "orbi_wallet",
  "description": "Protected merchant checkout",
  "buyer": {
    "type": "user",
    "customerId": "OB26-9885-6029",
    "phone": "+255700000000"
  },
  "seller": {
    "userId": "seller-orbi-user-id"
  },
  "returnUrl": "https://merchant.example.com/checkout/return",
  "cancelUrl": "https://merchant.example.com/checkout/cancel",
  "webhookUrl": "https://merchant.example.com/api/orbi/webhooks",
  "metadata": {
    "orderId": "ORDER-10001",
    "purpose": "Laptop purchase"
  }
}
```

Release request:

```http
POST /v1/paysafe/escrows/:escrowId/release
x-orbi-pay-service-key: <service-api-key>
Idempotency-Key: paysafe-release:<escrowId>:<external-action-id>
Content-Type: application/json
```

```json
{
  "reference": "ORDER-10001",
  "reason": "Customer confirmed delivery.",
  "metadata": {
    "orderId": "ORDER-10001",
    "requestedBy": "merchant_platform"
  }
}
```

Refund request:

```json
{
  "reference": "ORDER-10001",
  "amount": 125000,
  "reason": "Order cancelled before delivery.",
  "metadata": {
    "orderId": "ORDER-10001"
  }
}
```

Dispute request:

```json
{
  "reference": "ORDER-10001",
  "reason": "Customer raised delivery dispute.",
  "metadata": {
    "orderId": "ORDER-10001",
    "evidenceUrl": "https://merchant.example.com/orders/ORDER-10001/evidence"
  }
}
```

## 12. Balance And Merchant Projection Contracts

Seller or organization portals can read sanitized PaySafe and settlement
projections when their scopes permit it.

```http
GET /v1/merchant/paysafe/balance
x-orbi-pay-service-key: <service-api-key>
```

```http
GET /v1/merchant/orders/:orderId/payment-status
x-orbi-pay-service-key: <service-api-key>
```

```http
GET /v1/merchant/settlements?currency=TZS&status=completed&limit=50&offset=0
x-orbi-pay-service-key: <service-api-key>
```

Expected payment-status response shape:

```json
{
  "success": true,
  "data": {
    "serviceCode": "merchant_service",
    "orderId": "ORDER-10001",
    "status": "HELD",
    "escrowId": "ESC-...",
    "amount": 125000,
    "currency": "TZS",
    "updatedAt": "2026-07-20T04:30:00.000Z"
  }
}
```

## 13. Webhook Event Contract

ORBI signs service webhooks:

```http
x-orbi-pay-service-code: <service-code>
x-orbi-pay-event-id: <event-id>
x-orbi-pay-timestamp: <unix-seconds>
x-orbi-pay-signature: sha256=<hmac>
```

Signature payload:

```text
<timestamp>.<stable-json-body>
```

Typical event body:

```json
{
  "eventId": "evt_...",
  "eventType": "payment_intent.completed",
  "occurredAt": "2026-07-20T04:30:00.000Z",
  "serviceCode": "merchant_service",
  "intentId": "pi_...",
  "externalReference": "ORDER-10001",
  "orbiReference": "ESC-...",
  "status": "completed",
  "metadata": {}
}
```

External platforms must verify the signature, dedupe by `eventId`, and update
orders or settlements only after webhook verification.

Recommended webhook event families:

```text
payment_profile.created
payment_profile.updated
payment_profile.revoked
payment_intent.created
payment_intent.requires_action
payment_intent.completed
payment_intent.failed
payment_intent.cancelled
escrow.created
escrow.held
escrow.release_requested
escrow.released
escrow.refund_requested
escrow.refunded
escrow.disputed
escrow.expired
withdrawal.requested
withdrawal.completed
withdrawal.failed
```

## 14. Developer And Merchant Scopes

Recommended scope families:

```text
identity:resolve
business_registration:create
user:provision
payment_profile:create
payment_profile:read
payments:create
escrow:create
escrow:read
escrow:release:request
escrow:refund:request
escrow:dispute:create
withdrawal:request
balance:read
webhooks:receive
```

Service registration should grant the minimum scopes needed by that service.
Merchant identity is not enough to move money; action scopes and ORBI policy
must both allow the operation.

Service access token flow:

```http
POST /oauth/token
Authorization: Basic base64(<service-code>:<developer-api-key-secret>)
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&scope=payments:create escrow:create
```

The response `access_token` is short-lived and may be used as:

```http
Authorization: Bearer <access_token>
```

Use requested scopes narrowly. For example, a checkout server creating only a
PaySafe hold should request `escrow:create`, not every granted scope. Live
financial requests still require environment headers, idempotency keys, signed
request headers, allowlists, consent where applicable, and ORBI policy approval.

Runtime gateway enforcement:

```text
identity:resolve              Required before identity lookup.
business_registration:create  Required before business registration submission.
payment_profile:create        Required before creating payment profiles.
payments:create               Required for collection/refund payment intents.
withdrawal:request            Required for payout payment intents.
escrow:create                 Required for new PaySafe escrow holds.
escrow:release:request        Required for PaySafe release requests.
escrow:refund:request         Required for PaySafe refund requests.
escrow:dispute:create         Required for PaySafe disputes.
escrow:read                   Required for merchant escrow/order status reads.
balance:read                  Required for balance and settlement reads.
```

`PAY_SERVICE_SCOPE_NOT_GRANTED` is a permission denial, not a transient gateway
failure. Developers must request the missing scope in the Developer Portal and
wait for operator approval before retrying in live mode.

## 15. Reference ORBI Business Auth Client

For the reference ORBI Shop business account-link flow:

```text
Issuer: https://auth.orbifinancial.com/realms/orbi
Discovery: https://auth.orbifinancial.com/realms/orbi/.well-known/openid-configuration
Client ID: orbi-shop-business
Redirect URI: https://shop.orbifinancial.com/api/auth/orbi-business/link/callback
```

The client is confidential. The client secret must remain server-side in the
merchant application secret store. It must never be exposed to browsers, Vite
client bundles, mobile apps, logs, or Git.

## 16. Integration Rules For External Platforms

```text
Create local users in your own domain when needed.
Link financial capability through ORBI payment profiles.
Use hosted challenge for sensitive ORBI actions.
Use payment intents for checkout.
Use PaySafe routes for protected holds.
Use signed webhooks as truth.
Use return URLs only for user experience.
Reuse idempotency keys on network retry.
Never send wallet IDs as authority.
Never infer balance or payment status from UI redirect alone.
Never bypass ORBI PaySafe lifecycle after funds are held.
```
