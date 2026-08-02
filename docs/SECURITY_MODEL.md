# ORBI Pay Gateway Security Model

## Boundary

ORBI Pay Gateway is trusted to execute provider calls and normalize provider responses. It is not trusted to mutate balances directly.

It is separate from ORBI Talk Gateway. ORBI Talk Gateway handles SMS, email, push, and delivery queues only; it never handles money movement or provider settlement. Pay Gateway sends explicit transactional subject/body payloads for developer security events.

Only ORBI Core may:

- post ledger entries
- update wallet balances
- approve settlement commits
- reverse or refund Core transactions
- apply risk policy and account freezes

## Gateway-To-Core Authentication

The gateway calls Core through a secure Core external root, for example:

```txt
https://api.orbifinancial.com/api/internal/gateway/provider-events
```

This route is not a public user endpoint. It is a private service endpoint exposed through the Core root and protected by worker authentication.

Every callback to Core uses signed internal worker headers:

- `x-worker-id`
- `x-worker-scopes`
- `x-worker-request-id`
- `x-worker-timestamp`
- `x-worker-nonce`
- `x-worker-signature`
- optional `x-worker-key-id`

Core validates:

- worker identity
- required scope `gateway:events:write`
- timestamp freshness
- nonce replay protection
- body hash
- HMAC signature

## Internal mTLS Roadmap

HMAC remains required even after mTLS.

- HMAC proves request integrity and replay safety.
- mTLS proves service identity at transport level.

Rollout:

1. HMAC over private networking.
2. Proxy mTLS through Nginx or service mesh.
3. Direct mTLS with Gateway client certificate and Core server certificate.

## Provider Webhook Verification

Each production provider adapter must verify provider-specific webhook signatures, freshness, event IDs, and replay keys before forwarding events to Core.

Adapters must reject:

- missing signatures when the provider supports signatures
- stale timestamps
- replayed event IDs
- amount/currency mismatches when provider payload contains expected values
- callbacks for unknown references

## Browser And Response Hardening

Gateway responses apply a common security header policy before route handling:

- `x-content-type-options: nosniff`
- `x-frame-options: DENY`
- `referrer-policy: no-referrer`
- restrictive `permissions-policy`
- `cache-control: no-store` on OAuth, Developer Portal, payment, PaySafe,
  payment profile, and transfer routes
- HSTS on production HTTPS traffic

The global browser origin allowlist is only for ORBI-owned browser surfaces.
Merchant or developer domains are approved through Developer Portal domain and
callback allowlists, then enforced per service at runtime.

## Request Audit Correlation

Every non-health request receives a request ID, trace ID, and correlation ID.
The same IDs are returned in response headers and emitted into gateway audit
events. Developers should send their own stable request or correlation ID from
server-side integrations so failed payments, webhook retries, and support cases
can be traced without exposing customer secrets.

## Tokenized Provider Credentials

Provider credentials are represented by token references such as:

```env
PROVIDER_CREDENTIAL_TOKEN_REF=vault://orbi-pay/provider-code/api-credential
PROVIDER_WEBHOOK_SECRET_TOKEN_REF=vault://orbi-pay/provider-code/webhook-secret
```

The token reference is safe to store in service configuration because it is not the credential itself. A future vault/HSM adapter resolves the token at signing time inside the gateway process boundary. Logs and readiness responses expose only token fingerprints, never the token value or underlying provider secret.

Production default:

```env
PAYMENT_GATEWAY_CREDENTIAL_MODE=tokenized
```

Direct provider secrets are development-only and rejected when production runs in tokenized mode.

## 3D Secure / Strong Customer Authentication

Card-style rails must include authenticated SCA evidence from ORBI Core before the gateway executes the provider call. The gateway accepts redacted proof fields only:

```json
{
  "rail": "CARD_GATEWAY",
  "sca": {
    "status": "authenticated",
    "protocol": "3DS2",
    "challengeId": "core-issued-challenge-id",
    "dsTransactionId": "directory-server-transaction-id",
    "eci": "05",
    "liabilityShift": true,
    "authenticatedAt": "2026-06-04T10:30:00.000Z"
  }
}
```

Never send raw card data, OTP values, passwords, PINs, or provider credentials through gateway payment payloads.

## Secrets

Never commit:

- provider API keys
- provider API secrets
- worker signing secret
- mTLS private keys
- internal CA private key
- generated service certificates

## Developer Portal MFA

The Developer Portal uses a server-controlled TOTP lifecycle:

1. `disabled`: no authenticator factor is active.
2. `pending`: a one-time QR enrollment has started but has not been verified.
3. `active`: the factor was verified and is required at sign-in.

Operator and administrator accounts require MFA. An account that requires MFA but has not completed enrollment receives a restricted session that can only be used to complete account security setup. Protected operator actions remain blocked.

TOTP secrets are encrypted with AES-256-GCM using `ORBI_SECRET_ENCRYPTION_KEY`. The QR and manual setup key are returned only during pending enrollment. Once MFA becomes active, the setup key must never be returned by status or profile endpoints.

After successful enrollment, the user receives ten one-time recovery codes. They are displayed once and must be stored in a password manager or encrypted offline storage. Gateway stores only keyed HMAC hashes in `pay_gateway_portal_recovery_codes`; a used code is atomically marked as consumed and cannot be reused.

Every accepted TOTP counter is recorded. Reusing the same authenticator code is rejected. Repeated invalid authenticator or recovery-code attempts temporarily lock MFA verification:

```env
PAYMENT_GATEWAY_PORTAL_MFA_FRESHNESS_SECONDS=300
PAYMENT_GATEWAY_PORTAL_MFA_MAX_FAILED_ATTEMPTS=5
PAYMENT_GATEWAY_PORTAL_MFA_LOCKOUT_SECONDS=900
```

Portal sessions are registered in `pay_gateway_portal_sessions`. A signed token is valid only while its server-side session record remains active. Logout revokes that record, expired records are cleaned up, and MFA step-up rotates the previous session.

An administrator may reset another user's MFA only with `portal:manage_users`, a fresh MFA session, explicit confirmation, and a recorded reason. Reset removes the factor and recovery codes, clears lockout state, revokes every active session for the affected user, and requires fresh enrollment at the next sign-in. Self-reset is rejected.

Operational rules:

- Never disable MFA merely because a user lost a device.
- Verify the account owner through the approved support process.
- Revoke active sessions before resetting a factor.
- Audit the operator, reason, affected user, and reset time.
- Never send a TOTP secret, QR payload, password, authenticator code, or recovery code through logs, email, chat, or support tickets.

## Developer Email Verification

New developer accounts cannot create a portal session until their email address is verified. Gateway creates a six-digit, 15-minute verification code and stores only a keyed HMAC hash. The clear code is sent directly to ORBI Talk over authenticated server-to-server transport and is never written to portal audit metadata or the messaging delivery evidence store.

Only the newest unconsumed code is valid. A code is consumed atomically, expires automatically, and stops accepting attempts after five failures. Resend requests use a server-side cooldown and return a neutral response so callers cannot discover whether an email address is registered. Existing accounts are marked verified during the additive schema migration; newly registered accounts explicitly begin unverified.

## Fail-Closed Rules

- If Core callback signing secret is missing in production, gateway startup fails.
- If provider token bindings are missing, provider readiness returns `DOWN`.
- If card-style rails lack authenticated SCA evidence, the gateway rejects the operation before provider execution.
- If provider webhook parsing fails, event is not forwarded to Core.
- If Core callback fails, the gateway returns an error and logs the failed operation.
