# ORBI Pay Gateway Contract Versioning And Error Codes

This document locks the first public contract rules for ORBI Pay Gateway. It is
part of Phase 1 of the ORBI Open Digital Banking and BaaS roadmap.

## 1. Contract Version

Current public contract version:

```text
orbi-pay-gateway-contract-v1
```

Version `v1` applies to:

```text
/v1/identity/resolve
/v1/business/registrations
/v1/payment-profiles
/v1/payment-intents
/v1/payment-intents/:intentId
/v1/payment-intents/:intentId/confirm
/challenges/:intentId
/v1/challenges/:intentId/respond
/v1/paysafe/escrows
/v1/paysafe/escrows/:escrowId/release
/v1/paysafe/escrows/:escrowId/refund
/v1/paysafe/escrows/:escrowId/dispute
/v1/paysafe/users/:userId/balance
/v1/paysafe/balances
/v1/merchant/paysafe/balance
/v1/merchant/orders/:orderId/payment-status
/v1/merchant/settlements
/v1/webhooks/:providerCode
```

## 2. Versioning Rules

Non-breaking changes inside `v1`:

```text
Add optional request fields.
Add optional response fields.
Add new enum values only when clients are documented to tolerate unknowns.
Add new webhook event types.
Add new error codes.
Add new scopes that do not change existing scope meaning.
Add new metadata keys.
```

Breaking changes requiring a new version or migration window:

```text
Rename or remove request fields.
Rename or remove response fields.
Change amount/currency semantics.
Change lifecycle state meaning.
Change webhook signature payload.
Change idempotency behavior.
Change required headers.
Change scope meaning.
Change success/failure interpretation.
Require a new mandatory field on an existing route.
```

Deprecation rule:

```text
1. Mark old field/endpoint deprecated in docs.
2. Keep old behavior working during migration window.
3. Emit warning metadata where possible.
4. Provide replacement field/endpoint.
5. Remove only after contract review and release note.
```

## 3. Standard Response Shape

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
  "error": "ERROR_CODE",
  "message": "Human readable message.",
  "details": [],
  "requestId": "optional-request-id"
}
```

Rules:

```text
error is stable and machine-readable.
message is safe for logs and developer dashboards.
details may include validation issues.
Do not expose secrets, tokens, OTPs, PINs, provider credentials, or wallet
authority fields.
```

Executable public response schemas are maintained in:

```text
src/contracts/platformContract.ts
tests/platformContract.test.ts
```

The schemas currently lock:

```text
Standard API error envelope
Payment intent public response
Hosted challenge public response
Payment profile public response
PaySafe escrow intent public response
Webhook event payload
```

Contract tests must pass before a public route shape is treated as production
stable.

## 4. Error Code Catalog

### Authentication And Service Access

| Code | Meaning | Client action |
| :--- | :--- | :--- |
| `PAY_SERVICE_AUTH_FAILED` | Service key is missing, invalid, or cannot be verified. | Stop. Check service key and environment. |
| `PAY_SERVICE_NOT_REGISTERED` | Service key does not map to an active service. | Stop. Register service or rotate key. |
| `PAY_SERVICE_DISABLED` | Service exists but is disabled. | Stop. Contact ORBI operations. |
| `PAY_SERVICE_API_KEY_TOKEN_REF_MISSING` | Service registry is missing token reference. | Operator fix required. |
| `PAY_SERVICE_OPERATION_NOT_ALLOWED` | Service is not allowed to perform requested operation. | Request scope/capability approval. |
| `PAY_SERVICE_CURRENCY_NOT_ALLOWED` | Service cannot operate in requested currency. | Use allowed currency or request approval. |
| `PAY_SERVICE_MERCHANT_CONTEXT_REQUIRED` | Merchant-scoped operation lacks valid merchant context. | Link merchant/profile first. |
| `PAY_SERVICE_SCOPE_NOT_GRANTED` | Developer Portal service exists but the requested scope is not granted. | Request and wait for scope approval. |
| `PAY_GATEWAY_ENVIRONMENT_REQUIRED` | Financial runtime request did not declare Demo/Production environment. | Send `x-orbi-environment: demo` or `x-orbi-environment: production`. |
| `PAY_GATEWAY_ENVIRONMENT_INVALID` | Environment header is not recognized. | Use `demo`, `sandbox`, `production`, or `live`. |
| `PAY_GATEWAY_CREDENTIAL_ENVIRONMENT_UNBOUND` | Service key cannot be tied to sandbox/live trust zone. | Rotate to an issued `orbi_sandbox_...` or `orbi_live_...` key. |
| `PAY_GATEWAY_ENVIRONMENT_KEY_MISMATCH` | Key environment does not match request environment. | Use sandbox keys for Demo and live keys for Production. |
| `PAY_GATEWAY_IDEMPOTENCY_KEY_REQUIRED` | Financial runtime request has no stable idempotency key. | Retry with a stable `Idempotency-Key` for the same business operation. |
| `PAY_GATEWAY_SIGNATURE_REQUIRED` | Financial runtime request is missing HMAC signature. | Use SDK signing or send `x-orbi-signature`. |
| `PAY_GATEWAY_SIGNATURE_TIMESTAMP_REQUIRED` | HMAC timestamp header is missing. | Send `x-orbi-timestamp`. |
| `PAY_GATEWAY_SIGNATURE_TIMESTAMP_INVALID` | HMAC timestamp is not numeric. | Send Unix timestamp in seconds. |
| `PAY_GATEWAY_SIGNATURE_TIMESTAMP_STALE` | HMAC timestamp is outside replay tolerance. | Recreate signature with current timestamp. |
| `PAY_GATEWAY_SIGNATURE_NONCE_REQUIRED` | HMAC nonce is missing or malformed. | Send a unique `x-orbi-nonce`. |
| `PAY_GATEWAY_SIGNATURE_NONCE_REPLAYED` | HMAC nonce was already used for this service/key. | Generate a new nonce; do not replay signed financial requests. |
| `PAY_GATEWAY_SIGNATURE_SECRET_MISSING` | Gateway could not resolve a signing secret for this request. | Check service key/auth headers. |
| `PAY_GATEWAY_SIGNATURE_INVALID` | HMAC signature does not match request body/path. | Do not retry unchanged; rebuild signature over the exact raw body. |
| `PAY_GATEWAY_RATE_LIMITED` | Service/key exceeded the financial runtime request rate limit. | Back off and retry with the same idempotency key only if the operation is retry-safe. |
| `SERVICE_ACCESS_TOKEN_SECRET_REQUIRED` | Gateway cannot issue or verify service access tokens because token signing secret is missing. | Operator must configure `PAYMENT_GATEWAY_SERVICE_ACCESS_TOKEN_SECRET`. |
| `SERVICE_ACCESS_TOKEN_INVALID` | Bearer access token is malformed or signature verification failed. | Request a fresh token with valid service credentials. |
| `SERVICE_ACCESS_TOKEN_EXPIRED` | Bearer access token is expired. | Request a fresh token and retry. |
| `OAUTH_TOKEN_REQUEST_INVALID` | Token request payload failed validation. | Send `grant_type=client_credentials` and optional space-separated `scope`. |
| `OAUTH_CLIENT_AUTH_INVALID` | Token request client credentials are missing or invalid. | Use Basic auth, `client_secret`, or `x-orbi-pay-service-key` with a Developer Portal API key secret. |
| `OAUTH_DEVELOPER_PORTAL_SERVICE_REQUIRED` | Token exchange was attempted with a legacy service registry key. | Migrate service to Developer Portal issued keys. |
| `CONSENT_SUBJECT_REQUIRED` | Request needs consent but no subject identity was supplied. | Send a stable user, customer, email, phone, or identifier. |
| `CONSENT_REQUIRED` | Active consent receipt for the requested subject and scope is missing, revoked, or expired. | Start hosted consent/challenge again. |

### Identity And Business

| Code | Meaning | Client action |
| :--- | :--- | :--- |
| `IDENTITY_RESOLVE_INVALID` | Identity resolve payload failed validation. | Correct payload and retry. |
| `BUSINESS_REGISTRATION_INVALID` | Business registration payload failed validation. | Correct payload and retry with same idempotency key if same operation. |
| `PAYMENT_PROFILE_INVALID` | Payment profile payload failed validation. | Correct identity/scopes/consent payload. |

### Developer Portal Control Plane

| Code | Meaning | Client action |
| :--- | :--- | :--- |
| `DEVELOPER_SERVICE_APPLICATION_INVALID` | Service application payload failed validation. | Correct onboarding data. |
| `DEVELOPER_SERVICE_APPLICATION_FAILED` | Service application could not be saved. | Retry safely or contact operator. |
| `DEVELOPER_APPLICATION_NOT_FOUND` | Service application ID does not exist. | Refresh application list. |
| `DEVELOPER_SERVICE_APPROVAL_INVALID` | Approval payload failed validation. | Correct approval request. |
| `DEVELOPER_SERVICE_APPROVAL_FAILED` | Approval could not be completed. | Retry or investigate store/operator state. |
| `DEVELOPER_SERVICE_NOT_FOUND` | Developer service code does not exist. | Refresh service list. |
| `DEVELOPER_SCOPE_REQUEST_INVALID` | Scope request failed validation. | Correct requested scopes and reason. |
| `DEVELOPER_SCOPE_REQUEST_FAILED` | Scope request could not be saved. | Retry or contact operator. |
| `DEVELOPER_SCOPE_REQUEST_NOT_FOUND` | Scope request ID does not exist. | Refresh scope request list. |
| `DEVELOPER_SCOPE_DECISION_INVALID` | Scope decision payload failed validation. | Correct decision, reason, and operator identity. |
| `DEVELOPER_SCOPE_DECISION_FAILED` | Scope decision could not be applied. | Retry or investigate operator state. |
| `DEVELOPER_ALLOWLIST_INVALID` | Redirect/webhook allowlist payload failed validation. | Correct URL list and environment. |
| `DEVELOPER_ALLOWLIST_FAILED` | Allowlist update could not be applied. | Retry or contact operator. |
| `DEVELOPER_REDIRECT_URL_NOT_ALLOWED` | Runtime return/redirect URL is not allowlisted for this service. | Use an allowlisted redirect URL. |
| `DEVELOPER_WEBHOOK_URL_NOT_ALLOWED` | Runtime callback/webhook URL is not allowlisted for this service. | Use an allowlisted webhook URL. |
| `DEVELOPER_API_KEY_ROTATION_INVALID` | API key rotation request failed validation. | Correct actor, reason, and environment. |
| `DEVELOPER_API_KEY_ROTATION_FAILED` | API key rotation request could not be saved. | Retry or contact operator. |
| `DEVELOPER_API_KEY_ROTATION_NOT_FOUND` | API key rotation request ID does not exist. | Refresh key rotation requests. |
| `DEVELOPER_API_KEY_ROTATION_DECISION_INVALID` | API key rotation decision failed validation. | Correct decision, reason, and operator identity. |
| `DEVELOPER_API_KEY_ROTATION_DECISION_FAILED` | API key rotation decision could not be applied. | Retry or investigate operator state. |
| `DEVELOPER_API_KEY_ISSUE_INVALID` | API key issue payload failed validation. | Correct environment, reason, and operator identity. |
| `DEVELOPER_API_KEY_ISSUE_FAILED` | API key could not be issued. | Retry or investigate secret store. |
| `DEVELOPER_WEBHOOK_SECRET_ROTATION_INVALID` | Webhook secret rotation request failed validation. | Correct actor, reason, and environment. |
| `DEVELOPER_WEBHOOK_SECRET_ROTATION_FAILED` | Webhook secret rotation request could not be saved. | Retry or contact operator. |
| `DEVELOPER_WEBHOOK_SECRET_ROTATION_NOT_FOUND` | Webhook secret rotation request ID does not exist. | Refresh webhook secret rotation requests. |
| `DEVELOPER_WEBHOOK_SECRET_ROTATION_DECISION_INVALID` | Webhook secret rotation decision failed validation. | Correct decision, reason, and operator identity. |
| `DEVELOPER_WEBHOOK_SECRET_ROTATION_DECISION_FAILED` | Webhook secret rotation decision could not be applied. | Retry or investigate operator state. |
| `DEVELOPER_WEBHOOK_SECRET_ISSUE_INVALID` | Webhook secret issue payload failed validation. | Correct environment, reason, and operator identity. |
| `DEVELOPER_WEBHOOK_SECRET_ISSUE_FAILED` | Webhook secret could not be issued. | Retry or investigate secret store. |
| `WEBHOOK_DELIVERY_NOT_FOUND` | Webhook delivery ID does not exist. | Refresh delivery log. |
| `WEBHOOK_DELIVERY_REPLAY_FAILED` | Webhook replay could not be completed. | Retry or investigate service callback health. |
| `WEBHOOK_DELIVERY_REPLAY_PAYLOAD_MISSING` | Delivery record does not contain archived payload data and cannot be reconstructed. | Resend through the source workflow or inspect older delivery format. |
| `DEVELOPER_INTEGRATION_HEALTH_FAILED` | Integration health summary could not be generated. | Retry or investigate portal/provider stores. |
| `DEVELOPER_ENVIRONMENT_NOT_FOUND` | Requested developer environment profile is unknown. | Use `sandbox` or `live`. |
| `CONSENT_RECEIPT_INVALID` | Consent receipt payload failed validation. | Correct service, subject, scopes, context, evidence, and expiry. |
| `CONSENT_RECEIPT_CREATE_FAILED` | Consent receipt could not be saved. | Retry or investigate consent store. |
| `CONSENT_RECEIPT_NOT_FOUND` | Consent receipt ID does not exist. | Refresh consent receipt list. |
| `CONSENT_REVOCATION_INVALID` | Consent revocation payload failed validation. | Correct actor and revocation reason. |
| `CONSENT_REVOCATION_FAILED` | Consent receipt could not be revoked. | Retry or investigate consent store. |
| `CONSENT_SUBJECT_SESSION_REQUIRED` | Connected services API was called without trusted authenticated subject context. | Authenticate user/business through ORBI front door first. |
| `CONNECTED_CONSENTS_QUERY_INVALID` | Connected consents query failed validation. | Correct status or locale. |
| `CONNECTED_CONSENTS_QUERY_FAILED` | Connected consents could not be listed. | Retry or inspect consent store. |
| `CONNECTED_CONSENT_QUERY_INVALID` | Connected consent read query failed validation. | Correct locale. |
| `CONNECTED_CONSENT_REVOCATION_INVALID` | Connected consent revocation failed validation. | Send a clear revocation reason. |
| `CONNECTED_CONSENT_REVOCATION_FAILED` | Connected consent could not be revoked. | Retry or inspect consent/webhook state. |

### Payment Intent

| Code | Meaning | Client action |
| :--- | :--- | :--- |
| `PAYMENT_INTENT_INVALID` | Intent payload failed validation. | Correct payload. |
| `PAYMENT_INTENT_NOT_FOUND` | Intent does not exist or belongs to another service. | Stop or recreate with new operation. |
| `PAYMENT_INTENT_IDEMPOTENCY_MISMATCH` | Same idempotency key was reused with different payload. | Stop. Use the original payload or start a new operation with a new key. |

### Hosted Challenge

| Code | Meaning | Client action |
| :--- | :--- | :--- |
| `STRONG_CUSTOMER_AUTH_REQUIRED` | Core requires OTP/PIN/passkey or equivalent challenge. | Redirect/open hosted challenge. |
| `PAYMENT_CHALLENGE_NOT_FOUND` | Hosted challenge or intent cannot be found. | Refresh intent state. |
| `PAYMENT_CHALLENGE_IN_APP_REQUIRED` | Core requires in-app challenge instead of hosted challenge. | Show app challenge instructions. |
| `PAYMENT_CHALLENGE_FAILED` | Challenge response could not be completed. | Show failure and allow safe retry if intent remains actionable. |

### PaySafe And Escrow

| Code | Meaning | Client action |
| :--- | :--- | :--- |
| `PAYSAFE_ESCROW_INVALID` | Escrow create payload failed validation. | Correct payload. |
| `PAYSAFE_ACTION_INVALID` | Release/refund/dispute payload failed validation. | Correct action payload. |
| `PAYSAFE_BALANCE_QUERY_INVALID` | Balance query failed validation. | Correct query params. |
| `PAYSAFE_PAYMENT_ROUTE_REQUIRED` | `paymentCategory` or `paymentRail` is missing. | Send explicit payment route. |
| `PAYSAFE_PAYMENT_ROUTE_MISMATCH` | Category and rail do not match. | Correct route selection. |
| `PAYSAFE_EXTERNAL_PROVIDER_CODE_REQUIRED` | External rail requires `providerCode`. | Add provider code. |
| `PAYSAFE_MOBILE_MONEY_PHONE_REQUIRED` | Mobile-money rail requires buyer phone. | Add phone. |
| `PAYSAFE_BANK_ACCOUNT_REFERENCE_REQUIRED` | Bank rail requires account reference. | Add bank account reference. |

### Merchant Projections

| Code | Meaning | Client action |
| :--- | :--- | :--- |
| `ORDER_ID_REQUIRED` | Merchant order status request lacks order ID. | Provide order ID. |
| `MERCHANT_SETTLEMENTS_QUERY_INVALID` | Settlement query params failed validation. | Correct query. |

### Provider And Webhook

| Code | Meaning | Client action |
| :--- | :--- | :--- |
| `WEBHOOK_SIGNATURE_MISSING` | Provider webhook signature missing. | Provider/operator fix. |
| `WEBHOOK_SIGNATURE_INVALID` | Provider webhook signature invalid. | Reject event. |
| `WEBHOOK_TIMESTAMP_MISSING` | Provider webhook timestamp missing. | Provider/operator fix. |
| `WEBHOOK_TIMESTAMP_INVALID` | Provider webhook timestamp invalid. | Reject event. |
| `WEBHOOK_TIMESTAMP_STALE` | Provider webhook timestamp outside tolerance. | Reject or investigate replay. |
| `WEBHOOK_RAW_BODY_REQUIRED` | Raw body unavailable for signature validation. | Operator fix. |
| `PAYMENT_PROVIDER_NOT_SUPPORTED` | Provider code unsupported. | Select supported provider. |
| `PAYMENT_PROVIDER_OPERATION_UNSUPPORTED` | Provider does not support operation. | Select another route/provider. |
| `PAYMENT_PROVIDER_OPERATION_NOT_MAPPED` | Provider manifest lacks endpoint mapping. | Operator configuration fix. |

### Internal Worker Security

| Code | Meaning | Client action |
| :--- | :--- | :--- |
| `WORKER_SIGNING_SECRET_REQUIRED` | Worker signing secret missing. | Operator fix. |
| `INTERNAL_SIGNATURE_HEADERS_MISSING` | Required internal signature headers missing. | Reject event. |
| `INTERNAL_SIGNATURE_SCOPE_MISSING` | Worker lacks required scope. | Reject event. |
| `INTERNAL_SIGNATURE_TIMESTAMP_INVALID` | Worker timestamp invalid. | Reject event. |
| `INTERNAL_SIGNATURE_TIMESTAMP_STALE` | Worker timestamp outside tolerance. | Reject event. |
| `INTERNAL_SIGNATURE_INVALID` | Worker signature invalid. | Reject event and alert. |

## 5. Lifecycle State Vocabulary

Payment intent statuses:

```text
created
processing
requires_action
completed
failed
cancelled
```

Hosted challenge modes:

```text
hosted
in_app_required
```

PaySafe states:

```text
requested
held
release_requested
release_confirmed
released
refund_requested
refunded
disputed
expired
reconciled
failed
cancelled
```

Webhook delivery statuses:

```text
pending
delivered
failed
dead_lettered
replayed
```

## 6. Contract Lock Checklist

Before a contract is marked locked:

```text
Endpoint exists in docs.
Headers are documented.
Request payload sample exists.
Success response sample exists.
Failure response shape exists.
Idempotency rule exists for retryable action.
Webhook event exists for async state change.
Scope requirement exists.
Lifecycle state is named in this document.
Error code exists in this catalog.
Core/Gateway authority boundary is explicit.
```
