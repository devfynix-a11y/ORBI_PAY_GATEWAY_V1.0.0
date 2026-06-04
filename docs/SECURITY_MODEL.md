# ORBI Pay Gateway Security Model

## Boundary

ORBI Pay Gateway is trusted to execute provider calls and normalize provider responses. It is not trusted to mutate balances directly.

It is separate from ORBI Talk Gateway. ORBI Talk Gateway handles SMS, email, push, delivery queues, and templates only; it never handles money movement or provider settlement.

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

## Fail-Closed Rules

- If Core callback signing secret is missing in production, gateway startup fails.
- If provider token bindings are missing, provider readiness returns `DOWN`.
- If card-style rails lack authenticated SCA evidence, the gateway rejects the operation before provider execution.
- If provider webhook parsing fails, event is not forwarded to Core.
- If Core callback fails, the gateway returns an error and logs the failed operation.
