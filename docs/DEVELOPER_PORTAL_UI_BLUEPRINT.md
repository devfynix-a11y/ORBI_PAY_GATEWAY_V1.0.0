# ORBI Developer Portal UI Blueprint

This blueprint defines the first Developer Portal UI for ORBI Pay Gateway,
Open Digital Banking, and BaaS integrations.

The portal is a control-plane surface. It must not execute wallet movements,
hold ledger authority, or expose secrets to browsers.

## 1. Product Goal

```text
Help merchants, platforms, SACCOS, organizations, and internal ORBI teams
integrate safely without hand-building raw HTTP, secrets, scopes, webhook
replay, or consent evidence workflows.
```

## 2. Audience

```text
Developer
Merchant operator
SACCOS/organization operator
ORBI support/operator
ORBI compliance/risk reviewer
```

## 3. Navigation

```text
Overview
Services
Sandbox Setup
Keys And Webhook Secrets
Scopes And Consent
Webhooks
Integration Health
Docs And SDKs
Audit Events
```

## 4. Screen Contracts

### Overview

Purpose:

```text
Show the integration status without exposing secret material.
```

Data sources:

```text
GET /v1/developer/services
GET /v1/developer/integration-health
GET /v1/developer/webhook-deliveries?status=failed
GET /v1/developer/events
```

Cards:

```text
Active services
Pending applications
Webhook health
Consent revocations
Failed deliveries
Required actions
```

### Services

Purpose:

```text
Register, approve, inspect, and operate service/app records.
```

Data sources:

```text
POST /v1/developer/service-applications
GET /v1/developer/service-applications
POST /v1/developer/service-applications/:applicationId/approve
GET /v1/developer/services
GET /v1/developer/services/:serviceCode
```

UI states:

```text
draft
pending_review
active
suspended
rejected
archived
```

Do not expose:

```text
Raw service API keys
Raw webhook secrets
Core worker secrets
Provider credentials
OTP/PIN/passkey evidence
Wallet authority fields
```

### Sandbox Setup

Purpose:

```text
Guide a developer from empty account to a working sandbox checkout.
```

Stepper:

```text
1. Submit service application
2. Approve sandbox service
3. Request scopes
4. Add redirect and webhook allowlists
5. Issue sandbox API key
6. Issue sandbox webhook secret
7. Create test payment intent
8. Open hosted challenge
9. Verify signed webhook
10. Replay failed webhook
```

Primary APIs:

```text
POST /v1/developer/service-applications
POST /v1/developer/service-applications/:applicationId/approve
POST /v1/developer/services/:serviceCode/scope-requests
POST /v1/developer/services/:serviceCode/allowlists
POST /v1/developer/services/:serviceCode/api-keys/issue
POST /v1/developer/services/:serviceCode/webhook-secrets/issue
POST /v1/payment-intents
GET /challenges/:intentId
POST /v1/developer/webhook-deliveries/:deliveryId/replay
```

### Keys And Webhook Secrets

Purpose:

```text
Manage key status, rotation requests, and one-time issuance.
```

Data sources:

```text
POST /v1/developer/services/:serviceCode/api-keys/issue
POST /v1/developer/services/:serviceCode/api-key-rotations
POST /v1/developer/services/:serviceCode/api-keys/:keyId/revoke
POST /v1/developer/api-key-rotations/:rotationId/decision
POST /v1/developer/services/:serviceCode/webhook-secrets/issue
POST /v1/developer/services/:serviceCode/webhook-secret-rotations
POST /v1/developer/services/:serviceCode/webhook-secrets/:secretId/revoke
POST /v1/developer/webhook-secret-rotations/:rotationId/decision
```

Rules:

```text
One-time secrets are shown once.
Only fingerprints remain visible afterward.
Copy action requires operator acknowledgement.
Never log or persist raw secret in portal UI state.
Issue, rotate, revoke, and cutover actions require MFA-verified operator/admin
session, explicit confirmation, and a clear reason.
```

### Scopes And Consent

Purpose:

```text
Control service permissions and customer/business consent evidence.
```

Data sources:

```text
POST /v1/developer/services/:serviceCode/scope-requests
POST /v1/developer/scope-requests/:requestId/decision
GET /v1/developer/consent-receipts
GET /v1/developer/consent-receipts/:consentId
POST /v1/developer/consent-receipts/:consentId/revoke
```

UI rules:

```text
Scopes pending approval must look different from granted scopes.
Consent status must be active, revoked, or expired.
Revocation must show accountable actor, reason, and timestamp.
The portal can show evidence hashes, not raw OTP/PIN/passkey evidence.
```

### Webhooks

Purpose:

```text
Make event delivery observable and replayable without creating duplicate
financial movement.
```

Data sources:

```text
GET /v1/developer/webhook-deliveries
POST /v1/developer/webhook-deliveries/:deliveryId/replay
```

UI rules:

```text
Replay must show replayOf and attempt number.
Replay does not create a new payment, escrow, ledger movement, or consent.
Webhook payload view must be sanitized.
Copy event ID and delivery ID actions are allowed.
```

### Integration Health

Purpose:

```text
Expose service readiness and warnings before production incidents.
```

Data source:

```text
GET /v1/developer/integration-health
```

Health sections:

```text
Service status
Scope readiness
Allowlist readiness
API key status
Webhook secret status
Webhook failure rate
Recent failed deliveries
Required operator actions
```

### Docs And SDKs

Purpose:

```text
Centralize integration materials for developers.
```

Data sources:

```text
GET /v1/developer/docs-catalog
GET /v1/developer/sdk-catalog
GET /v1/developer/sandbox-tools
```

Materials:

```text
Node SDK
CLI
OpenAPI 3.1
Postman/Insomnia collection
Platform contracts
Error-code catalog
Security model
Webhook verification guide
```

### Audit Events

Purpose:

```text
Show service onboarding, key, scope, allowlist, consent, and webhook history.
```

Data source:

```text
GET /v1/developer/events
GET /v1/developer/events?serviceCode=:serviceCode
```

## 5. Role Access

```text
Developer: own service docs, sandbox setup, own service health.
Merchant operator: own service configuration, webhook logs, profile docs.
ORBI operator: approve services, issue/rotate keys, replay webhooks.
Compliance/risk reviewer: read-only services, consent receipts, audit events.
```

Sensitive operator actions:

```text
Approve service application
Suspend/archive service
Issue API key
Request/complete API key rotation
Revoke API key
Issue webhook signing secret
Request/complete webhook secret rotation
Revoke webhook signing secret
Replay webhook delivery
Reset sandbox simulator
Create/update portal users
```

These actions must show a confirmation dialog, collect a reason, and require an
MFA-verified operator/admin session. The UI should not submit them silently.

## 6. UX Principles

```text
Show action required, not internal noise.
Separate sandbox and live visually.
Use plain language for scopes and consent.
Never make a user copy raw secrets twice.
Use SDK snippets before raw HTTP examples.
Show replay and idempotency warnings near dangerous actions.
```

## 7. First Implementation Slice

```text
1. Read-only dashboard with services, health, docs, SDKs, and sandbox tools.
2. Sandbox setup wizard backed by current operator endpoints.
3. Webhook delivery log with replay button.
4. Consent receipt list/read/revoke.
5. Key issuance modal with one-time secret copy acknowledgement.
```

## 8. Completion Gate

```text
A developer can register a sandbox service, receive a sandbox API key and
webhook secret, create a hosted checkout payment, receive or replay a signed
webhook, inspect consent evidence, and read SDK/OpenAPI/Postman docs without
engineer help.
```
