# ORBI Pay Gateway Enterprise Engineering Plan

ORBI Pay Gateway is a standalone payment rail integration service. It must be operated as a separate deployable system from ORBI Core.

The gateway is moving to an ISO 20022-first clearing model. Instead of onboarding every mobile money or bank provider one by one, ORBI can connect through a regulated neighbor bank or sponsored participant path, then speak standardized ISO 20022 messages into TIPS and future regional/global pipelines.

## Target Architecture

```txt
User / Merchant / Agent
  -> ORBI Core Banking Engine
  -> ORBI Pay Gateway
  -> Neighbor Bank / TIPS / External Clearing Network
  -> ORBI Pay Gateway Provider Webhook
  -> signed private callback over Core external root
  -> ORBI Core ledger settlement
```

## Service Responsibilities

ORBI Pay Gateway owns:

- provider API credentials
- provider request signing
- collection, payout, and refund execution
- provider webhook parsing and signature validation
- provider health/readiness
- normalized provider events sent to Core

ORBI Core owns:

- users, wallets, ledger, balances, double-entry posting
- risk and limits
- settlement authorization
- account/wallet freeze and recovery policy
- audit and operator controls

The gateway must never directly mutate Core balances.

## Secure Core Callback

For separate infrastructure, the gateway calls Core through the secure Core root:

```env
ORBI_CORE_INTERNAL_BASE_URL=https://api.orbifinancial.com
ORBI_CORE_TRUSTED_GATEWAY_EVENT_PATH=/api/internal/gateway/provider-events
ORBI_CORE_CALLBACK_TIMEOUT_MS=7500
```

Full callback URL:

```txt
https://api.orbifinancial.com/api/internal/gateway/provider-events
```

This endpoint is private by protocol, not by obscurity. It must reject requests unless all worker-auth controls pass.

## Callback Trust Controls

Every gateway-to-Core callback includes:

- `x-worker-id`
- `x-worker-scopes`
- `x-worker-request-id`
- `x-worker-timestamp`
- `x-worker-nonce`
- `x-worker-signature`
- optional `x-worker-key-id`

Core verifies:

- worker identity
- scope `gateway:events:write`
- timestamp freshness
- nonce replay protection
- body hash
- HMAC signature

Future hardening adds mTLS on top of HMAC. HMAC must remain permanently enabled.

## Active Hardening Memory

The gateway hardening sequence must be executed step by step:

```text
1. Live mTLS cutover after sandbox direct mTLS verification and maintenance
   approval. Keep HMAC enabled permanently.
2. Developer Portal backend-only finalization. The portal must call gateway
   backend APIs only, never databases directly.
3. Merchant domain/origin governance for browser origins, redirect URLs,
   callback URLs, and webhook URLs.
4. Audit correlation across SDK, gateway, Core, hosted challenge, webhooks, and
   operator actions.
5. Production webhook replay with signed replay evidence and delivery lineage.
6. SDK production polish for Node, Python, PHP, and future SDKs.
7. Open Banking/BaaS compliance support through consent, scopes, revocation,
   access grants, rate limits, and audit exports.
```

## Provider Adapter Roadmap

Phase 1:

- manifest-driven provider readiness and request normalization
- generic provider adapter contract for configured rails
- pluggable protocol engine registry for REST, HMAC, ISO8583, SFTP, SDK, and VPN/private APIs
- ISO 20022 canonical mapping for `pacs.008`, `pacs.002`, and `pacs.004`
- signed Core callback bridge
- provider webhook endpoint skeletons

Phase 2:

- TIPS neighbor-bank clearing profile
- ISO 20022 XML/JSON certification samples
- provider-specific webhook signature validation
- amount/currency/reference matching
- provider idempotency keys
- retry queues for provider/network failures
- reconciliation status polling where provider supports it

Phase 3:

- direct mTLS or proxy mTLS between gateway and Core
- provider SLA dashboards
- settlement reconciliation files
- provider failover policies
- dual-control production provider onboarding

## Production Rules

Core production:

```env
ORBI_ENABLE_CORE_PROVIDER_GATEWAY_ROUTES=false
ORBI_ALLOW_STUB_PROVIDER_RECONCILIATION=false
ORBI_PAY_GATEWAY_BASE_URL=https://pay.orbifinancial.com
```

Gateway production:

```env
NODE_ENV=production
PAYMENT_GATEWAY_PUBLIC_BASE_URL=https://pay.orbifinancial.com
PAYMENT_GATEWAY_PROVIDER_MODE=live
ORBI_CORE_INTERNAL_BASE_URL=https://api.orbifinancial.com
WORKER_SIGNING_SECRET=<same-secret-as-core>
```

## Acceptance Criteria

- Gateway can report `/health` and `/ready`.
- Gateway provider readiness shows missing provider credentials without exposing secrets.
- Gateway refuses to start in production without `WORKER_SIGNING_SECRET`.
- Gateway refuses non-HTTPS Core callback roots in production.
- Core rejects unsigned gateway events.
- Core rejects gateway events without `gateway:events:write`.
- Core posts ledger entries only after trusted provider proof.
- Core legacy provider execution routes remain disabled in production.
