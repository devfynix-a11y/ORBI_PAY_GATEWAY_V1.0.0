# ORBI Pay Gateway Developer Portal Contracts

This document starts Phase 2 of the ORBI Open Digital Banking and BaaS roadmap.
It defines the control-plane contracts for merchants, developers, organizations,
SACCOS platforms, agent networks, and internal ORBI products.

The Developer Portal is the place where an external platform can:

```text
Register a service/app.
Request sandbox and live access.
Request scopes.
Manage redirect URL allowlists.
Manage browser origin allowlists.
Manage webhook URL allowlists.
Request API key rotation.
Request webhook signing secret rotation.
Inspect integration health.
View event delivery logs.
Read API contracts.
Download SDKs when available.
```

Financial movement still goes through the public Gateway contracts in
[Platform Integration Contracts](./PLATFORM_INTEGRATION_CONTRACTS.md).

## 1. Authority Boundary

```text
Developer Portal
-> controls service/app registration, keys, scopes, allowlists, environment,
   webhook configuration, docs, and integration health.

Pay Gateway runtime
-> executes authenticated payment/profile/escrow/identity requests.

ORBI Core
-> owns identity authority, ledger authority, risk, consent, wallet state,
   PaySafe lifecycle, receipts, and reconciliation truth.
```

The Developer Portal must never expose service API keys, webhook signing
secrets, OTPs, PINs, wallet authority fields, provider credentials, or Core
worker secrets to browsers.

## 1.2 SaaS Portal Access Model

### Developer account lifecycle

Developer signup and production approval are separate controls:

```http
POST /v1/portal/auth/signup
POST /v1/portal/auth/email/verify
POST /v1/portal/auth/email/resend
```

`signup` creates a sandbox-only account in an unverified state. The developer
must enter the six-digit code delivered by ORBI before sign-in is allowed.
Verification codes expire after 15 minutes, are one-time, and resend responses
do not reveal whether an account exists.

Email verification proves control of the contact address; it does not grant
production access. The developer must separately submit a service application
with integration name, use case, approved domains, redirect URLs, and webhook
URLs. An authorized operator reviews that application before production scopes
or credentials can be issued.

The portal has three access levels:

```text
developer -> sees only their own applications, integrations, events, webhook
             deliveries, sandbox tools, SDKs, and docs.
operator  -> reviews applications, approves scopes, manages service status,
             and handles key/webhook-secret operations.
admin     -> manages portal users, roles, permissions, and audit logs.
```

Developer data must be backend-scoped. The browser must never decide which
service belongs to a developer. Gateway derives ownership from the portal
session and returns only records linked by:

```text
serviceCodes on the portal user session
ownerEmail on the application/service
submittedByPortalEmail in application/service metadata
```

The following SaaS control-plane queues are persistent database records and
must survive container restarts:

```text
pay_gateway_developer_service_applications
pay_gateway_developer_scope_requests
pay_gateway_developer_services
pay_gateway_developer_api_keys
pay_gateway_developer_webhook_secrets
pay_gateway_developer_secret_events
pay_gateway_portal_audit_events
```

Developer self-service is allowed for:

```http
POST /v1/developer/service-applications
GET  /v1/developer/service-applications
GET  /v1/developer/services
GET  /v1/developer/events
GET  /v1/developer/integration-health
POST /v1/developer/services/{serviceCode}/scope-requests
POST /v1/developer/services/{serviceCode}/api-key-rotations
POST /v1/developer/services/{serviceCode}/webhook-secret-rotations
```

For developer sessions, `{serviceCode}` must belong to the signed-in developer.
Otherwise the Gateway returns `PORTAL_GATEWAY_SERVICE_ACCESS_DENIED`.

Operator/admin actions still require operator discovery access, a portal
session, role permission, and confirmation/MFA for sensitive changes.

Operator incident actions are exposed only to operator/admin sessions:

```http
GET  /v1/operator/incidents
GET  /v1/operator/incidents/{incidentId}
POST /v1/operator/incidents/{incidentId}/acknowledge
POST /v1/operator/incidents/{incidentId}/assign
POST /v1/operator/incidents/{incidentId}/resolve
```

Portal frontend calls these through `/v1/portal/gateway`; it never receives a
database URL and never writes operational state directly.

## 1.1 Sandbox And Live Trust Zones

Sandbox and live are separate environments with separate credentials, webhook
secrets, URL allowlists, consent evidence, and money behavior.

```http
GET /v1/developer/environment-profiles
GET /v1/developer/environment-profiles/sandbox
GET /v1/developer/environment-profiles/live
GET /v1/developer/sandbox-simulator
```

Sandbox is simulated and must not commit real Core ledger movement. Live is
real-money and requires approved scopes, allowlists, live keys, live webhook
secrets, signed webhook handling, and stable idempotency keys.

The Developer Portal should show this separation before issuing keys, opening
simulator tools, or promoting a service to live.

## 2. Service Application Contract

Service onboarding begins with a service application.

```json
{
  "legalName": "ORBI Shop Limited",
  "displayName": "ORBI Shop",
  "contactEmail": "ops@orbishop.example",
  "contactPhone": "+255700000000",
  "businessType": "marketplace",
  "countryCode": "TZ",
  "requestedEnvironments": ["sandbox", "live"],
  "requestedScopes": [
    "payment_profile:read",
    "payments:create",
    "escrow:create",
    "webhooks:receive"
  ],
  "browserOrigins": [
    "https://shop.orbifinancial.com"
  ],
  "redirectUrls": [
    "https://shop.orbifinancial.com/api/auth/orbi-business/link/callback"
  ],
  "webhookUrls": [
    "https://shop.orbifinancial.com/api/orbi/webhooks"
  ],
  "useCases": [
    "Seller payment profiles",
    "Protected checkout through PaySafe"
  ],
  "termsAccepted": true
}
```

`browserOrigins` are the public website domains allowed to call the Gateway
from a browser for that service. A developer must provide the domain they will
use, for example:

```json
{
  "browserOrigins": ["https://www.tag.co.tz"]
}
```

Sandbox may use local development origins such as `http://localhost:5173`.
Live access must use public HTTPS domains only. Live browser origins must not
use `localhost`, private IP addresses, plain HTTP, or wildcard domains.

The same live safety rule applies to `redirectUrls` and `webhookUrls`: public
HTTPS only. Localhost callbacks, private-network callbacks, plain HTTP, and
wildcard hosts are sandbox-only because live callbacks affect money movement,
consent continuation, and webhook delivery truth.

Live services must also complete automatic DNS domain verification before live
keys or live webhook secrets can be issued. The portal gives the developer a TXT
record for every hostname used by `browserOrigins`, `redirectUrls`, and
`webhookUrls`.

Recommended proof method:

```json
{
  "type": "TXT",
  "name": "_orbi-pay-verify.www.tag.co.tz",
  "value": "orbi-pay-site-verification=orbi_domain_example"
}
```

The developer adds the TXT record in the DNS provider for their domain, for
example Cloudflare, cPanel, Namecheap, GoDaddy, Route 53, or the hosting DNS
panel. After DNS propagation, the developer clicks verify in the portal. The
Gateway checks DNS TXT automatically. HTTPS file proof remains available only as
a fallback when DNS access is not possible.

Every live hostname must be verified. If any live hostname is missing proof,
integration health reports `DOMAIN_VERIFICATION_PENDING` and live credential
issuance fails closed.

Domain verification endpoints:

```http
GET  /v1/developer/services/{serviceCode}/domain-verification
POST /v1/developer/services/{serviceCode}/domain-verification
```

`GET` returns required domains, verified domains, missing domains, and challenge
setup instructions. `POST` attempts verification immediately:

```json
{
  "domains": ["www.tag.co.tz", "api.tag.co.tz"]
}
```

If `domains` is omitted, the Gateway checks every required live hostname for
that service.

Allowed `businessType` values:

```text
merchant
marketplace
organization
saccos
agent_network
platform
internal
```

Allowed environments:

```text
sandbox
live
```

Live access requires review. Sandbox access may be automated later, but it must
still create an auditable service record.

## 3. Service Profile Response

The dashboard service card should use this shape:

```json
{
  "success": true,
  "data": {
    "serviceCode": "orbi-shop",
    "displayName": "ORBI Shop",
    "status": "active",
    "environments": ["sandbox", "live"],
    "scopesGranted": [
      "payment_profile:read",
      "payments:create",
      "escrow:create"
    ],
    "scopesPending": ["balance:read"],
    "browserOrigins": [
      "https://shop.orbifinancial.com"
    ],
    "redirectUrls": [
      "https://shop.orbifinancial.com/api/auth/orbi-business/link/callback"
    ],
    "webhookUrls": [
      "https://shop.orbifinancial.com/api/orbi/webhooks"
    ],
    "keyStatus": "active",
    "webhookSecretStatus": "active",
    "merchant": {
      "merchantIdEnv": "ORBI_SHOP_MERCHANT_ID",
      "feeProfileCode": "ORBI_SHOP_PAYSAFE",
      "feeFlowCode": "MERCHANT_PAYMENT",
      "requireActiveMerchant": true
    },
    "allowedOperations": ["collection", "refund", "paysafe"],
    "allowedCurrencies": ["TZS"],
    "allowedCountries": ["TZ"],
    "createdAt": "2026-07-23T00:00:00.000Z",
    "updatedAt": "2026-07-23T00:00:00.000Z"
  }
}
```

For merchant-scoped financial products, `merchant` is mandatory before live
keys are issued. Developer Portal stores this in service metadata; Gateway must
hydrate it into runtime service auth so Core receives merchant context on every
PaySafe/payment intent request.

Allowed service statuses:

```text
draft
pending_review
active
suspended
rejected
archived
```

## 4. Scope Requests

Services request minimum privileges. Merchant identity alone is never enough to
move money.

```json
{
  "requestedScopes": ["balance:read"],
  "reason": "Seller dashboard needs read-only protected balance projection.",
  "environment": "live"
}
```

Supported Phase 2 scopes:

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

Scope approvals must be auditable and revocable.

## 2.1 Service Access Tokens

Developer Portal API keys are long-lived credentials. Runtime integrations should
exchange them for short-lived service access tokens before calling financial
routes.

Discovery:

```http
GET /.well-known/oauth-authorization-server
GET /v1/.well-known/oauth-authorization-server
```

Response:

```json
{
  "issuer": "https://pay.orbifinancial.com",
  "token_endpoint": "https://pay.orbifinancial.com/oauth/token",
  "introspection_endpoint": "https://pay.orbifinancial.com/oauth/introspect",
  "revocation_endpoint": "https://pay.orbifinancial.com/oauth/revoke",
  "grant_types_supported": [
    "client_credentials",
    "urn:ietf:params:oauth:grant-type:token-exchange"
  ],
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post", "private_key_jwt"],
  "scopes_supported": ["identity:resolve", "payments:create", "escrow:create"]
}
```

SDK-first usage:

```ts
const metadata = await orbi.oauth.metadata();
const tokenState = await orbi.oauth.introspect(accessToken);
await orbi.oauth.revoke(accessToken);
```

Raw OAuth endpoints are documented for certified server-to-server integrations
and SDK authors. Merchant application code should prefer the official SDK so
token exchange, request signatures, idempotency headers, and audit correlation
remain consistent.

```http
POST /oauth/token
content-type: application/x-www-form-urlencoded
authorization: Basic base64(<service-code>:<one-time-api-key-secret>)
```

Body:

```text
grant_type=client_credentials&scope=payments:create escrow:create
```

JSON is also accepted:

```json
{
  "grant_type": "client_credentials",
  "scope": "payments:create escrow:create"
}
```

Response:

```json
{
  "access_token": "orbi_at_...",
  "token_type": "Bearer",
  "expires_in": 900,
  "scope": "payments:create escrow:create",
  "service_code": "orbi-shop",
  "environment": "live",
  "issued_at": "2026-07-30T09:00:00.000Z",
  "expires_at": "2026-07-30T09:15:00.000Z"
}
```

Rules:

```text
- Token scope must be a subset of granted Developer Portal scopes.
- Token environment is inherited from the API key: sandbox or live.
- Runtime requests may use Authorization: Bearer <access_token>.
- If the token request includes a valid `DPoP` header, Gateway returns
  `token_type: "DPoP"` and binds the token to that proof key. Runtime requests
  must then send `Authorization: DPoP <access_token>` plus a fresh `DPoP`
  proof for the exact URL and method.
- Financial runtime signatures may be calculated with the access token while it is valid.
- Access tokens cannot be exchanged for new access tokens.
- Production requires PAYMENT_GATEWAY_SERVICE_ACCESS_TOKEN_SECRET.
```

### Customer-authorized financial token exchange

Use token exchange when an API action is performed for an authenticated ORBI
customer. A machine token is not customer permission.

```http
POST /oauth/token
content-type: application/x-www-form-urlencoded
authorization: Basic base64(<service-code>:<live-or-sandbox-api-key>)
```

```text
grant_type=urn:ietf:params:oauth:grant-type:token-exchange
subject_token=<OIDC access token>
subject_token_type=urn:ietf:params:oauth:token-type:access_token
requested_token_type=urn:ietf:params:oauth:token-type:access_token
audience=orbi-pay-api
scope=payments:create balance:read
consent_id=consent_...
```

Successful response:

```json
{
  "access_token": "orbi_ft_...",
  "issued_token_type": "urn:ietf:params:oauth:token-type:access_token",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "payments:create balance:read",
  "consent_id": "consent_...",
  "service_code": "orbi-shop",
  "environment": "live",
  "audience": "orbi-pay-api"
}
```

The Gateway validates the OIDC signature through the configured issuer JWKS.
The identity subject must match the consent subject, and requested scopes must
be approved for both the developer service and that consent. Audience,
environment, developer key, and consent are immutable token claims. Every
runtime use checks that consent is still active, so revocation takes effect
without waiting for token expiry.

For sender-constrained integrations, request this token with a `DPoP` proof.
Gateway will return `token_type: "DPoP"` and require a new proof on each
runtime request.

Introspection:

```http
POST /oauth/introspect
content-type: application/json
authorization: Basic base64(<service-code>:<one-time-api-key-secret>)
```

Body:

```json
{
  "token": "orbi_at_..."
}
```

Active response:

```json
{
  "active": true,
  "service_code": "orbi-shop",
  "environment": "live",
  "scope": "payments:create escrow:create",
  "iat": 1785420000,
  "exp": 1785420900,
  "jti": "sat_..."
}
```

Inactive, expired, revoked, invalid, or wrong-service tokens return:

```json
{
  "active": false
}
```

Revocation:

```http
POST /oauth/revoke
content-type: application/json
authorization: Basic base64(<service-code>:<one-time-api-key-secret>)
```

Body:

```json
{
  "token": "orbi_at_..."
}
```

Response:

```json
{
  "success": true,
  "data": {
    "revoked": true,
    "serviceCode": "orbi-shop",
    "environment": "live",
    "revokedAt": "2026-07-30T09:10:00.000Z"
  }
}
```

Revocation is service-scoped: a service cannot introspect or revoke another
service's token. Revoked token IDs are persisted in the Gateway database so a
revoked token remains blocked after container restart until its original expiry
has safely aged out.

Runtime scope enforcement:

```text
POST /v1/identity/resolve                         -> identity:resolve
POST /v1/business/registrations                   -> business_registration:create
POST /v1/payment-profiles                         -> payment_profile:create + active subject consent
POST /v1/payment-intents (collection/refund)      -> payments:create
POST /v1/payment-intents (payout)                 -> withdrawal:request
GET  /v1/payment-intents/:intentId                -> matching intent operation scope
POST /v1/payment-intents/:intentId/confirm        -> matching intent operation scope
POST /v1/paysafe/escrows                          -> escrow:create
POST /v1/paysafe/escrows/:id/release              -> escrow:release:request
POST /v1/paysafe/escrows/:id/refund               -> escrow:refund:request
POST /v1/paysafe/escrows/:id/dispute              -> escrow:dispute:create
GET  /v1/paysafe/users/:userId/balance            -> balance:read + active subject consent
GET  /v1/paysafe/balances                         -> balance:read + active subject consent
GET  /v1/merchant/paysafe/balance                 -> balance:read
GET  /v1/merchant/orders/:orderId/payment-status  -> escrow:read
GET  /v1/merchant/settlements                     -> balance:read
```

Denied runtime scope checks return `PAY_SERVICE_SCOPE_NOT_GRANTED` with HTTP
403. A granted scope does not bypass operation allowlists, currency allowlists,
idempotency, signature/nonce controls, Core policy, consent receipts, or risk
checks.

Developer Portal should render scope labels from the consent scope catalog:

```http
GET /v1/developer/consent-scopes
```

Example response:

```json
{
  "success": true,
  "data": [
    {
      "scope": "payments:create",
      "category": "payment",
      "riskLevel": "high",
      "requiresHostedChallenge": true,
      "title": {
        "en": "Start payments",
        "sw": "Kuanzisha malipo"
      },
      "description": {
        "en": "Allows the service to start ORBI payments that still require ORBI authorization and risk checks.",
        "sw": "Inaruhusu huduma kuanzisha malipo ya ORBI ambayo bado yatahitaji uthibitisho na ukaguzi wa hatari wa ORBI."
      }
    }
  ]
}
```

The UI must show localized scope descriptions for customer/business consent.
Do not show raw scope strings as the primary explanation.

Consent renewal status should be checked before sensitive operations and before
rendering connected-service settings:

```http
GET /v1/developer/consent-status?serviceCode=orbi-shop&subjectId=user_001&scopes=payments:create&environment=live&renewalWindowDays=30
```

Example response:

```json
{
  "success": true,
  "data": {
    "status": "expiring_soon",
    "allowed": true,
    "renewalRequired": true,
    "renewalReason": "CONSENT_EXPIRING_SOON",
    "consentId": "consent_001",
    "expiresAt": "2026-08-01T00:00:00.000Z",
    "scopes": ["payments:create"]
  }
}
```

Status behavior:

```text
active -> continue normally.
expiring_soon -> continue, but show renewal prompt before expiry.
expired -> stop and start hosted consent again.
revoked -> stop and require explicit fresh consent.
missing -> stop and start hosted consent.
```

Consent audit export is operator/admin-facing and returns an evidence envelope:

```http
GET /v1/developer/consent-receipts/export?serviceCode=orbi-shop&subjectId=user_001&status=active&requestedBy=operator@orbi.example
```

```json
{
  "success": true,
  "data": {
    "exportId": "consent_export_...",
    "generatedAt": "2026-07-30T10:00:00.000Z",
    "requestedBy": "operator@orbi.example",
    "filters": {
      "serviceCode": "orbi-shop",
      "subjectId": "user_001",
      "status": "active"
    },
    "count": 1,
    "receipts": []
  }
}
```

Use this export for compliance, support, access-review evidence, and regulator
preparation. Do not query consent storage directly from portal UI or merchant
systems.

## 4.1 Connected Services Consent Center

The Consent Center is user/business-facing. It is not an operator API and it is
not a merchant service-key API.

Trusted ORBI front doors such as Core, Auth, Mobile Shell, or ORBI Business
Portal authenticate the subject, then inject:

```http
x-orbi-subject-id: user_001
x-orbi-subject-type: user
```

For business accounts:

```http
x-orbi-subject-id: business_001
x-orbi-subject-type: business
```

List connected services:

```http
GET /v1/consents?status=active&locale=sw
```

Read one connected service consent:

```http
GET /v1/consents/:consentId?locale=sw
```

Revoke connected service consent:

```http
POST /v1/consents/:consentId/revoke
```

```json
{
  "reason": "Customer revoked connected service access."
}
```

The response includes `scopeSummary`, which is localized for `en` or `sw`.
Connected Services UI should show:

```text
Service name/code.
Status: active, expiring soon, expired, or revoked.
Purpose.
Expiry date.
Localized scope descriptions.
Revoke button for active or expiring soon consent.
Evidence details in a secondary/details screen.
```

Revoking consent sends a signed `consent.revoked` webhook to the affected
service, using the same webhook signing model as payment events.

## 5. Redirect And Webhook Allowlists

Redirect URLs and webhook URLs are explicit per environment.

```json
{
  "browserOrigins": [
    "https://merchant.example.com"
  ],
  "redirectUrls": [
    "https://merchant.example.com/orbi/return"
  ],
  "webhookUrls": [
    "https://merchant.example.com/api/orbi/webhooks"
  ],
  "reason": "Add production checkout return and webhook URLs.",
  "environment": "live"
}
```

Rules:

```text
No wildcard hosts for live.
No localhost for live.
HTTPS required for live.
Browser origin is the website origin allowed to call or embed ORBI-hosted flows,
for example `https://www.tag.co.tz`.
Redirect and webhook URLs must also be public HTTPS URLs in live.
Return URL is UX continuation, not payment truth.
Webhook URL is server-to-server payment truth.
```

## 6. API Key Rotation

Key rotation must be controlled and auditable.

```json
{
  "environment": "live",
  "currentKeyId": "key_2026_07",
  "rotationReason": "Routine quarterly production key rotation.",
  "requestedBy": "ops@merchant.example"
}
```

Required behavior:

```text
Generate new key server-side only.
Show secret once.
Move the previous active key to pending_cutover during rotation window.
Accept both active and pending_cutover keys during approved cutover.
Allow explicit cutover.
Revoke old key after cutover or expiry.
Allow emergency self-rotation with MFA, clear reason, and audit event.
Emit audit event.
Never expose keys through API reads.
```

Issue API key:

```http
POST /v1/developer/services/:serviceCode/api-keys/issue
Content-Type: application/json
```

```json
{
  "environment": "sandbox",
  "requestedBy": "operator@orbi.example",
  "reason": "Issue first sandbox key for integration testing."
}
```

Response contains the raw secret once:

```json
{
  "success": true,
  "data": {
    "key": {
      "keyId": "key_...",
      "environment": "sandbox",
      "status": "active",
      "fingerprint": "7b4fd1...",
      "issuedAt": "2026-07-23T00:00:00.000Z"
    },
    "oneTimeSecret": "orbi_sandbox_..."
  }
}
```

Portal UI rule:

```text
Show the one-time secret once.
Require operator to confirm it has been copied.
Never show it again.
Tell the developer to store it only in server secret storage.
Never place it in browser code, mobile apps, Git, logs, screenshots, chat
messages, support tickets, or shared documents.
If the secret is copied to an unsafe place, rotate it before live payments.
Service profile cards show keyId, environment, status, fingerprint, issuedAt,
and expiry/revocation dates only.
```

Emergency self-rotation:

```http
POST /v1/developer/services/:serviceCode/api-keys/emergency-rotate
Content-Type: application/json
```

```json
{
  "environment": "live",
  "requestedBy": "ops@merchant.example",
  "reason": "Confirmed live API key exposure from an accidentally shared server log.",
  "exposureType": "confirmed_exposure",
  "revokePreviousImmediately": true,
  "overlapMinutes": 0,
  "metadata": {
    "incidentId": "sec_2026_07_30_001"
  }
}
```

Emergency rotation is available to the owning developer account and to ORBI
operators. It must require an active portal session, MFA/confirmation, and a
clear reason. The response returns the new API key secret once only.

```json
{
  "success": true,
  "data": {
    "key": {
      "keyId": "key_...",
      "environment": "live",
      "status": "active",
      "fingerprint": "7b4fd1...",
      "issuedAt": "2026-07-30T00:00:00.000Z"
    },
    "oneTimeSecret": "orbi_live_...",
    "previousKeys": [
      {
        "keyId": "key_old",
        "fingerprint": "2bc9a1...",
        "nextStatus": "revoked"
      }
    ],
    "overlapMinutes": 0
  }
}
```

Emergency behavior:

```text
confirmed_exposure or revokePreviousImmediately=true -> old active key is revoked immediately.
suspected_exposure -> old active key moves to pending_cutover for a short live cutover window.
lost_key -> issue new key and move old active key to pending_cutover unless immediate revoke is requested.
routine_fast_rotation -> same endpoint shape, but still audited as emergency rotation.
```

Audit event:

```text
developer.api_key.emergency_rotated
```

Messaging intent:

```text
developer.api_key.emergency_rotated -> ORBI Talk
```

The message must include the service name/code, environment, new key
fingerprint, old key next status, rotation reason category, and timestamp. It
must never include the raw API key secret. Delivery evidence should be visible
to operators as notification status, not as message secrets.

Revoke API key:

```http
POST /v1/developer/services/:serviceCode/api-keys/:keyId/revoke
Content-Type: application/json
```

```json
{
  "revokedBy": "operator@orbi.example",
  "reason": "Emergency key revoke after suspected exposure.",
  "metadata": {
    "incidentId": "sec_2026_07_30_001"
  }
}
```

Key status lifecycle:

```text
active -> pending_cutover -> revoked
active -> revoked
```

`pending_cutover` means the old key is still accepted only to give the
merchant a controlled migration window. Completing the rotation revokes old
pending-cutover keys for that environment.

## 7. Webhook Signing Secret Rotation

Webhook secrets follow the same pattern as API keys:

```text
Create new signing secret.
Move previous active signing secret to pending_cutover.
Sign outbound events with the newest active secret.
Merchant verifies both current and next secret during overlap.
Revoke old secret after cutover.
Allow emergency revoke with operator reason.
```

Request webhook signing secret rotation:

```http
POST /v1/developer/services/:serviceCode/webhook-secret-rotations
Content-Type: application/json
```

Approve, reject, or complete webhook signing secret rotation:

```http
POST /v1/developer/webhook-secret-rotations/:rotationId/decision
Content-Type: application/json
```

Issue webhook signing secret:

```http
POST /v1/developer/services/:serviceCode/webhook-secrets/issue
Content-Type: application/json
```

The raw webhook signing secret is also one-time display only. Store only
`secretId`, `fingerprint`, `environment`, `status`, and timestamps in portal
records.

Revoke webhook signing secret:

```http
POST /v1/developer/services/:serviceCode/webhook-secrets/:secretId/revoke
Content-Type: application/json
```

```json
{
  "revokedBy": "operator@orbi.example",
  "reason": "Emergency webhook secret revoke after suspected exposure.",
  "metadata": {
    "incidentId": "sec_2026_07_30_002"
  }
}
```

Webhook secret status lifecycle:

```text
active -> pending_cutover -> revoked
active -> revoked
```

## 8. Developer Portal Events

Developer Portal actions must emit auditable events:

```json
{
  "eventId": "dev_evt_001",
  "eventType": "developer.api_key.rotation_requested",
  "serviceCode": "orbi-shop",
  "environment": "live",
  "occurredAt": "2026-07-23T00:00:00.000Z",
  "data": {
    "requestedBy": "ops@orbishop.example"
  }
}
```

Recommended event names:

```text
developer.service_application.submitted
developer.service.approved
developer.service.suspended
developer.scope_request.submitted
developer.scope_request.approved
developer.allowlist.updated
developer.api_key.rotation_requested
developer.api_key.rotation_approved
developer.api_key.rotation_rejected
developer.api_key.rotated
developer.api_key.issued
developer.api_key.revoked
developer.webhook_secret.rotation_requested
developer.webhook_secret.rotation_approved
developer.webhook_secret.rotation_rejected
developer.webhook_secret.rotated
developer.webhook_secret.issued
developer.webhook_secret.revoked
```

Messaging delivery evidence:

```http
GET /v1/developer/messaging-deliveries
GET /v1/developer/messaging-deliveries?serviceCode=orbi-shop&status=failed
```

Response:

```json
{
  "success": true,
  "data": [
    {
      "deliveryId": "msgdel_...",
      "eventId": "dev_evt_...",
      "correlationId": "dev_evt_...",
      "serviceCode": "orbi-shop",
      "environment": "live",
      "templateCode": "developer.api_key.emergency_rotated",
      "channel": "email",
      "language": "en",
      "recipientIdentityRef": "ops@merchant.example",
      "status": "queued",
      "attempt": 1,
      "createdAt": "2026-07-30T00:00:00.000Z"
    }
  ]
}
```

Rules:

```text
Delivery evidence may show template, channel, recipient reference, status,
attempt, safe metadata, and timestamps.
It must never show raw OTP, PIN, password, API key, webhook secret, provider
credential, authorization token, or signature material.
```

## 9. Developer Portal UI Blueprint

Build the first portal UI around these screens:

```text
Service Applications
Service Detail
Scopes And Capabilities
Redirect And Webhook Allowlists
API Keys
Webhook Signing Secrets
Event Logs
Integration Health
API Docs
Sandbox Tools
SDK Links
```

### Service Applications

Purpose:

```text
Submit merchant/platform service details.
Review pending applications.
Approve into draft or active service record.
Reject with operator reason.
```

Primary endpoints:

```text
POST /v1/developer/service-applications
GET /v1/developer/service-applications
POST /v1/developer/service-applications/:applicationId/approve
```

### Service Detail

Purpose:

```text
Show service status, environments, granted scopes, pending scopes, key status,
webhook secret status, redirect URLs, webhook URLs, and event health.
```

Primary endpoints:

```text
GET /v1/developer/services
GET /v1/developer/services/:serviceCode
```

### Scopes And Capabilities

Purpose:

```text
Request minimum scopes.
Operator approves or rejects each scope request.
Show granted and pending scopes clearly.
```

Primary endpoints:

```text
POST /v1/developer/services/:serviceCode/scope-requests
POST /v1/developer/scope-requests/:requestId/decision
```

### Redirect And Webhook Allowlists

Purpose:

```text
Manage runtime-safe URLs.
Prevent payment redirects and webhook callbacks to unapproved hosts.
```

Primary endpoint:

```text
POST /v1/developer/services/:serviceCode/allowlists
```

### API Keys

Purpose:

```text
Issue sandbox/live keys.
Request rotation.
Approve/reject/complete rotation.
Display raw key only once.
Display fingerprint and status afterward.
```

Primary endpoints:

```text
POST /v1/developer/services/:serviceCode/api-keys/issue
POST /v1/developer/services/:serviceCode/api-key-rotations
POST /v1/developer/services/:serviceCode/api-keys/:keyId/revoke
POST /v1/developer/api-key-rotations/:rotationId/decision
```

### Webhook Signing Secrets

Purpose:

```text
Issue signing secrets.
Rotate signing secrets with overlap.
Display raw secret only once.
Display fingerprint and status afterward.
```

Primary endpoints:

```text
POST /v1/developer/services/:serviceCode/webhook-secrets/issue
POST /v1/developer/services/:serviceCode/webhook-secret-rotations
POST /v1/developer/services/:serviceCode/webhook-secrets/:secretId/revoke
POST /v1/developer/webhook-secret-rotations/:rotationId/decision
```

### Event Logs

Purpose:

```text
Show onboarding, scope, key, allowlist, and webhook delivery activity.
Make support and audit investigations straightforward.
```

Primary endpoint:

```text
GET /v1/developer/events
```

### Webhook Delivery Logs And Replay

Purpose:

```text
Show each webhook attempt.
Expose HTTP status/error safely.
Allow operator replay without manually entering containers.
Preserve attempt number and replay lineage.
```

Primary endpoints:

```text
GET /v1/developer/webhook-deliveries
GET /v1/developer/webhook-deliveries?serviceCode=orbi-shop
GET /v1/developer/webhook-deliveries?intentId=pi_...
GET /v1/developer/webhook-deliveries?status=failed
POST /v1/developer/webhook-deliveries/:deliveryId/replay
```

Replay request body:

```json
{
  "reason": "Retry after merchant endpoint recovery.",
  "requestedBy": "orbi-operator",
  "metadata": {
    "ticketId": "SUP-1001"
  }
}
```

Delivery record shape:

```json
{
  "deliveryId": "whdel_...",
  "eventId": "evt_...",
  "serviceCode": "orbi-shop",
  "intentId": "pi_...",
  "eventType": "payment_intent.updated",
  "callbackUrl": "https://shop.orbifinancial.com/api/orbi/webhooks",
  "status": "failed",
  "attempt": 1,
  "statusCode": 503,
  "error": "PAY_SERVICE_WEBHOOK_HTTP_503",
  "replayOf": "whdel_original",
  "replayReason": "Retry after merchant endpoint recovery.",
  "replayRequestedBy": "orbi-operator",
  "replayRequestId": "req-replay-001",
  "createdAt": "2026-07-23T00:00:00.000Z",
  "updatedAt": "2026-07-23T00:00:00.000Z"
}
```

Replay rules:

```text
Replay signs a fresh webhook using the service webhook secret.
Replay creates a new delivery record with replayOf=<original-delivery-id>.
Replay stores operator reason, requestedBy, request ID, and metadata as evidence.
Replay must not mutate ledger, payment intent, or escrow state.
Replay is for merchant notification recovery only.
Merchant must dedupe by eventId/resource state and process idempotently.
```

### Integration Health

Purpose:

```text
Give operators and merchants one health summary per service.
Show service status, keys, webhook secrets, allowlists, scopes, webhook
delivery health, provider readiness, and recent errors.
```

Primary endpoints:

```text
GET /v1/developer/integration-health
GET /v1/developer/integration-health?serviceCode=orbi-shop
```

Health summary shape:

```json
{
  "serviceCode": "orbi-shop",
  "displayName": "ORBI Shop",
  "status": "attention",
  "serviceStatus": "draft",
  "environments": ["sandbox", "live"],
  "scopes": {
    "granted": ["payments:create"],
    "pending": ["balance:read"]
  },
  "keys": {
    "status": "active",
    "active": 1,
    "rotationPending": 0
  },
  "webhooks": {
    "secretStatus": "active",
    "activeSecrets": 1,
    "totalDeliveries": 20,
    "delivered": 18,
    "failed": 2,
    "failureRatePercent": 10,
    "lastDeliveredAt": "2026-07-23T00:00:00.000Z",
    "lastFailedAt": "2026-07-23T00:05:00.000Z",
    "recentErrors": []
  },
  "allowlists": {
    "redirectUrls": ["https://merchant.example.com/orbi/return"],
    "webhookUrls": ["https://merchant.example.com/api/orbi/webhooks"]
  },
  "warnings": [
    "SCOPES_PENDING_REVIEW"
  ],
  "updatedAt": "2026-07-23T00:10:00.000Z"
}
```

Recommended warning codes:

```text
SERVICE_NOT_ACTIVE
API_KEY_NOT_ACTIVE
WEBHOOK_SECRET_NOT_ACTIVE
REDIRECT_ALLOWLIST_EMPTY
WEBHOOK_ALLOWLIST_EMPTY
SCOPES_PENDING_REVIEW
WEBHOOK_FAILURE_RATE_HIGH
```

### API Docs Browser

Purpose:

```text
Give developers a browsable catalog of maintained Gateway docs.
Avoid stale external PDFs or informal integration instructions.
```

Primary endpoint:

```text
GET /v1/developer/docs-catalog
```

Catalog entry shape:

```json
{
  "id": "platform-integration-contracts",
  "title": "Platform Integration Contracts",
  "category": "contracts",
  "path": "/docs/PLATFORM_INTEGRATION_CONTRACTS.md",
  "description": "Payment profiles, hosted challenge, payment intents, PaySafe lifecycle, webhooks, scopes."
}
```

### Sandbox Tools

Purpose:

```text
Expose available sandbox actions without mixing them with live financial
controls.
Show which tools are available, contract-ready, planned, or operator-gated.
```

Primary endpoint:

```text
GET /v1/developer/sandbox-tools
```

Catalog statuses:

```text
available
contract_ready
operator_toggle
planned
```

### SDK Links

Purpose:

```text
Show supported and planned SDKs from the portal.
Prepare for future generated OpenAPI and typed SDK releases.
```

Primary endpoint:

```text
GET /v1/developer/sdk-catalog
```

SDK catalog entry shape:

```json
{
  "id": "node-sdk",
  "language": "TypeScript/Node.js",
  "status": "bootstrap_available",
  "packageName": "@orbifinancial/pay-gateway",
  "docsPath": "/sdk/node/README.md",
  "description": "Typed client for payment intents, PaySafe actions, webhook verification, and replay."
}
```

## 10. Implementation Order

Build the portal in this order:

```text
1. Persist service applications and service records.
2. Add operator approval workflow.
3. Add sandbox service key generation.
4. Add live key approval and rotation.
5. Add redirect/webhook allowlist enforcement in runtime routes.
6. Add scope enforcement beyond operation/currency checks. [done]
7. Add webhook delivery logs and replay controls.
8. Add SDK/docs browser.
```

Executable schemas and tests:

```text
src/contracts/developerPortalContract.ts
tests/developerPortalContract.test.ts
src/services/webhookDeliveryStore.ts
tests/webhookDeliveryStore.test.ts
```

## 11. Phase 2 Bootstrap Endpoints

These endpoints are operator-only during bootstrap. They require:

```http
x-orbi-pay-operator-key: <PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY>
```

Developer Portal BFF calls also require a signed portal session:

```http
Authorization: Bearer <portal-session-token>
```

Sensitive operator/admin actions require all of the following:

```text
MFA-verified session.
confirmationAccepted: true.
Clear reason or rotationReason.
Permission matching the action.
Audit event written before forwarding the action.
```

Submit service application:

```http
POST /v1/developer/service-applications
Content-Type: application/json
```

List service applications:

```http
GET /v1/developer/service-applications
GET /v1/developer/service-applications?status=pending_review
```

Approve service application:

```http
POST /v1/developer/service-applications/:applicationId/approve
Content-Type: application/json
```

```json
{
  "serviceCode": "orbi-shop",
  "initialStatus": "draft"
}
```

List/read developer services:

```http
GET /v1/developer/services
GET /v1/developer/services/:serviceCode
```

Request scopes:

```http
POST /v1/developer/services/:serviceCode/scope-requests
Content-Type: application/json
```

One request may contain several permissions:

```json
{
  "environment": "sandbox",
  "requestedScopes": [
    "payments:create",
    "escrow:create",
    "webhooks:receive"
  ],
  "reason": "Create protected checkout payments and receive signed payment status updates."
}
```

Permission controls are fail-closed:

- the signed-in developer may request access only for an integration owned by that account;
- the request environment must match both the Gateway runtime and the integration environment;
- production requests require approved production access on the developer account;
- granted and pending permissions cannot be requested again;
- suspended, rejected, or archived integrations cannot request permissions;
- operators must use an MFA-verified session, confirmation, and a review reason;
- reviewer identity is taken from the verified operator session, not client input;
- approved permissions do not bypass customer consent or runtime operation policies.

Approve or reject a scope request:

```http
POST /v1/developer/scope-requests/:requestId/decision
Content-Type: application/json
```

```json
{
  "decision": "approve",
  "reason": "Approved for read-only seller dashboard projection.",
  "decidedBy": "operator@orbi.example"
}
```

Update allowlists:

```http
POST /v1/developer/services/:serviceCode/allowlists
Content-Type: application/json
```

Once a service has portal allowlists, runtime payment and PaySafe requests must
use URLs present in the matching allowlist:

```text
Origin header -> browser origin allowlist
returnUrl, return_url, redirectUrl, redirect_url -> redirect allowlist
callbackUrl, callback_url, webhookUrl, webhook_url -> webhook allowlist
```

Request API key rotation:

```http
POST /v1/developer/services/:serviceCode/api-key-rotations
Content-Type: application/json
```

Issue API key:

```http
POST /v1/developer/services/:serviceCode/api-keys/issue
Content-Type: application/json
```

Revoke API key:

```http
POST /v1/developer/services/:serviceCode/api-keys/:keyId/revoke
Content-Type: application/json
```

Approve, reject, or complete API key rotation:

```http
POST /v1/developer/api-key-rotations/:rotationId/decision
Content-Type: application/json
```

```json
{
  "decision": "complete",
  "reason": "New live key installed and old key revoked.",
  "decidedBy": "operator@orbi.example"
}
```

Request webhook secret rotation:

```http
POST /v1/developer/services/:serviceCode/webhook-secret-rotations
Content-Type: application/json
```

Approve, reject, or complete webhook secret rotation:

```http
POST /v1/developer/webhook-secret-rotations/:rotationId/decision
Content-Type: application/json
```

Issue webhook signing secret:

```http
POST /v1/developer/services/:serviceCode/webhook-secrets/issue
Content-Type: application/json
```

Revoke webhook signing secret:

```http
POST /v1/developer/services/:serviceCode/webhook-secrets/:secretId/revoke
Content-Type: application/json
```

Read portal events:

```http
GET /v1/developer/events
GET /v1/developer/events?serviceCode=orbi-shop
```

Create consent receipt:

```http
POST /v1/developer/consent-receipts
Content-Type: application/json
```

```json
{
  "serviceCode": "orbi-shop",
  "environment": "live",
  "subjectType": "user",
  "subjectId": "user_001",
  "externalSubjectId": "shop_customer_001",
  "scopes": ["payment_profile:read", "payments:create"],
  "purpose": "Allow ORBI Shop to initiate protected checkout payments.",
  "expiresAt": "2027-07-23T00:00:00.000Z",
  "context": {
    "locale": "sw",
    "timezone": "Africa/Dar_es_Salaam",
    "channel": "hosted_challenge",
    "ipHash": "iphash_123456789",
    "deviceHash": "devicehash_123456789"
  },
  "evidence": {
    "consentTextVersion": "orbi-checkout-consent-v1",
    "challengeType": "PIN",
    "challengeId": "challenge_001",
    "acceptedAt": "2026-07-23T00:00:00.000Z",
    "evidenceHash": "evidence_hash_123456789"
  }
}
```

List/read consent receipts:

```http
GET /v1/developer/consent-receipts
GET /v1/developer/consent-receipts?serviceCode=orbi-shop&subjectId=user_001&status=active
GET /v1/developer/consent-receipts/:consentId
```

Revoke consent receipt:

```http
POST /v1/developer/consent-receipts/:consentId/revoke
Content-Type: application/json
```

```json
{
  "revokedBy": "user_001",
  "reason": "Customer revoked ORBI Shop checkout permission."
}
```

Read integration health:

```http
GET /v1/developer/integration-health
GET /v1/developer/integration-health?serviceCode=orbi-shop
```

Read docs, sandbox tools, and SDK catalogs:

```http
GET /v1/developer/docs-catalog
GET /v1/developer/sandbox-tools
GET /v1/developer/sdk-catalog
```

Machine-readable contract:

```text
docs/openapi/orbi-pay-gateway.openapi.json
docs/postman/orbi-pay-gateway.postman_collection.json
docs/postman/orbi-pay-gateway.postman_environment.json
```

The OpenAPI 3.1 document is the bootstrap source for Developer Portal API
browser pages, generated SDKs, and API tools. The Postman collection is the
bootstrap sandbox runner for checkout, hosted challenge, consent receipts, and
webhook replay. Keep both aligned with SDK helpers so developers do not need to
hand-build raw HTTP payloads.

Read/replay webhook deliveries:

```http
GET /v1/developer/webhook-deliveries
POST /v1/developer/webhook-deliveries/:deliveryId/replay
```

Webhook delivery records store the sanitized outbound event payload used for
signature generation. Replay works for `payment_intent.updated`,
`consent.revoked`, and future signed service events as long as the original
delivery record contains archived payload data.

SDK-first operator usage:

```ts
import { OrbiPayGatewayClient } from '@orbifinancial/pay-gateway';

const operator = new OrbiPayGatewayClient({
  baseUrl: 'https://pay.orbifinancial.com',
  operatorKey: process.env.ORBI_OPERATOR_KEY!,
});

const receipts = await operator.listConsentReceipts({
  serviceCode: 'orbi-shop',
  subjectId: 'user_001',
  status: 'active',
});

await operator.revokeConsentReceipt(receipts.items[0].id, {
  revokedBy: 'user_001',
  reason: 'Customer revoked merchant access.',
});

await operator.replayWebhookDelivery('whdel_001', {
  requestId: 'manual-replay-whdel-001',
});

await operator.replayFailedWebhookDeliveries({
  serviceCode: 'orbi-shop',
}, {
  limit: 10,
});
```

Developers should use SDK helpers for consent receipts, webhook verification,
typed webhook events, and webhook replay. Raw HTTP remains part of the public
contract, but SDK usage prevents fragile hand-built signatures, replay payloads,
or event type parsing.

SDK payment profile and error usage:

```ts
import { assertOrbiSuccess, errorInfoFromResponse, OrbiPayGatewayClient } from '@orbifinancial/pay-gateway';

const orbi = new OrbiPayGatewayClient({
  baseUrl: 'https://pay.orbifinancial.com',
  serviceKey: process.env.ORBI_PAY_SERVICE_KEY!,
});

const profile = await orbi.linkPaymentProfile({
  externalCustomerId: 'merchant-user-001',
  customerId: 'OB26-9885-6029',
  scopes: ['payment_profile:read', 'payments:create'],
});

const failure = errorInfoFromResponse(profile);
if (failure?.action === 'request_scope_or_consent') {
  // Redirect the customer through hosted consent/challenge.
}

const paymentProfile = assertOrbiSuccess(profile);
```

Bootstrap persistence path:

```env
DATABASE_URL=postgresql://orbi:***@postgres:5432/orbi
ORBI_SECRET_ENCRYPTION_KEY=***
PAYMENT_GATEWAY_CONSENT_RECEIPT_STORE_PATH=data/consent-receipts.json
PAYMENT_GATEWAY_WEBHOOK_DELIVERY_STORE_PATH=data/webhook-deliveries.json
```

Developer services, API-key fingerprints, encrypted webhook signing secrets, and
developer secret events are stored in PostgreSQL control-plane tables. Raw API
keys are displayed once during issue and are never persisted. Webhook secrets are
never stored in plaintext; ORBI stores encrypted vault material only because the
gateway must sign outbound callbacks after restart.

To migrate service-registry credentials such as ORBI Shop into the database
vault:

```bash
npm run secrets:migrate-service-registry
```

The migration reads secrets from the server environment, writes API-key
fingerprints, writes encrypted webhook signing secrets, and does not print raw
secret values.
