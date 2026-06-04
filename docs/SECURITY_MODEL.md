# ORBI Pay Gateway Security Model

## Boundary

ORBI Pay Gateway is trusted to execute provider calls and normalize provider responses. It is not trusted to mutate balances directly.

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
- If provider credentials are missing, provider readiness returns `DOWN`.
- If provider webhook parsing fails, event is not forwarded to Core.
- If Core callback fails, the gateway returns an error and logs the failed operation.
