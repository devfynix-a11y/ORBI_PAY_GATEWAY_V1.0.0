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
8. SaaS control-plane readiness. Developer Portal must persist onboarding and
   scope queues in Postgres, scope developer sessions to owned services only,
   and keep operator/admin approvals separated from developer self-service.
9. Bank-grade enterprise readiness. Complete live mTLS, OAuth/OIDC consent
   authority, KMS-compatible secret custody, reconciliation evidence, SIEM
   monitoring, security testing, and bank/provider certification packs.
```

## Bank-Grade Enterprise Readiness Plan

This plan is the Gateway-side execution order for connecting ORBI to large
banks, sponsored participant rails, clearing partners, and enterprise BaaS
customers.

Do not skip evidence. A control is considered complete only when code,
configuration, tests, operational runbook, and audit evidence exist.

Use the readiness gate before bank-review work, live cutovers, and major
partner pilots:

```powershell
npm run bank-grade:readiness -- --env-file="D:\FYNIX\ORBI\SECREATES\ORBI PAY GATEWAY LIVE ENV.txt"
```

When checking host-mounted mTLS files for a container path such as
`/opt/orbi/mtls`, pass the host mount directory:

```powershell
node scripts/check-bank-grade-readiness.mjs --env-file="D:\FYNIX\ORBI\SECREATES\ORBI PAY GATEWAY LIVE ENV.txt" --mtls-host-dir="D:\FYNIX\ORBI\SECREATES\ORBI_MTLS"
```

For release blocking, run it in strict mode:

```powershell
node scripts/check-bank-grade-readiness.mjs --env-file="D:\FYNIX\ORBI\SECREATES\ORBI PAY GATEWAY LIVE ENV.txt" --strict
```

The script prints control status only. It must never print secret values.

### Stage 1: Live mTLS Cutover

Goal:

```text
Add certificate-backed trust between Gateway and Core while keeping HMAC
worker signatures permanently enabled.
```

Tasks:

- Verify live certificate material exists outside the repo.
- Run `npm run mtls:readiness`.
- Enable live mTLS during a maintenance window.
- Smoke `/health`, `/ready`, signed Core callback denial/allow paths, and
  provider event callback paths.
- Document rollback to HMAC-only if transport cutover fails.

Acceptance:

```text
Gateway readiness reports `mtlsEnabled=true` for live, Core still rejects
unsigned callbacks, and HMAC remains mandatory.
```

### Stage 2: OAuth2/OIDC Service Authorization

Goal:

```text
Move developer/service authorization from simple service keys toward
OAuth2/OIDC-grade access tokens and explicit consent.
```

Tasks:

- Define OAuth2 client registration through Developer Portal approval.
- Add authorization-code + PKCE for browser/mobile-safe consent.
- Add client-credentials for server-to-server approved services.
- Add token introspection and revocation.
- Persist service access token revocations in Postgres so revoked tokens remain
  blocked across container restarts.
- Bind access tokens to service, environment, scopes, consent receipt, and
  risk profile.
- Keep API keys only as bootstrap credentials for token exchange.

Acceptance:

```text
Runtime financial APIs accept short-lived scoped access tokens, reject expired
or revoked tokens across restarts, and record consent/audit evidence.
```

### Stage 3: KMS-Compatible Secret Custody

Goal:

```text
Make live secrets recoverable, rotatable, and auditable without exposing them
to code, browsers, logs, or manual SQL.
```

Tasks:

- Define secret owners for service keys, webhook secrets, worker signing,
  mTLS keys, provider credentials, and SDK release tokens.
- Store encrypted live secrets in the official secrets storage layer.
- Add rotation runbooks and dual-control approvals.
- Add emergency revoke/break-glass runbook.
- Add backup/restore proof for encrypted secrets.

Acceptance:

```text
No live financial secret depends on local JSON fallback or undocumented
operator memory, and every secret has custody, rotation, and recovery evidence.
```

### Stage 4: Reconciliation Evidence Layer

Goal:

```text
Prove every external payment state against Core ledger truth and webhook
delivery truth.
```

Tasks:

- Export daily Gateway/Core/provider reconciliation files.
- Correlate merchant order, payment intent, hosted challenge, PaySafe escrow,
  Core ledger transaction, provider proof, webhook delivery, and final status.
- Add exception queues for stuck, duplicated, mismatched, reversed, and
  disputed records.
- Add signed report hashes.

Acceptance:

```text
Operators can reconstruct a payment from merchant request to ledger movement
and webhook delivery without manual database inspection.
```

### Stage 5: Observability And SIEM

Goal:

```text
Detect security, reliability, and reconciliation issues before customers or
partners report them.
```

Tasks:

- Add dashboards for Gateway, Core callbacks, provider readiness, webhook
  delivery, hosted challenges, payment intents, reconciliation, and mTLS.
- Stream security/audit events to SIEM-compatible sinks.
- Add alerts for callback failures, mTLS expiry, webhook failure spikes,
  auth anomalies, idempotency reuse, and reconciliation mismatches.
- Define SLOs and error budgets.

Acceptance:

```text
Production incidents have dashboards, alerts, trace IDs, owner, severity, and
runbook links.
```

### Stage 6: Security Testing And Release Gates

Goal:

```text
Make every release prove security posture before it reaches live.
```

Tasks:

- Add threat model for Gateway, Developer Portal, SDK, hosted challenge,
  webhook replay, and merchant callbacks.
- Add dependency/SAST scans.
- Add DAST smoke checks for public routes.
- Add penetration-test checklist.
- Add release gate script that checks tests, OpenAPI, SDK metadata, mTLS
  readiness, runtime controls, and migration safety.

Acceptance:

```text
Live release cannot proceed without passing automated tests and a documented
operator approval gate.
```

### Stage 7: Bank/Provider Certification Pack

Goal:

```text
Prepare ORBI evidence for a bank, clearing partner, or regulated enterprise
technical review.
```

Tasks:

- Produce ISO 20022 samples for `pacs.008`, `pacs.002`, and `pacs.004`.
- Produce OpenAPI and SDK integration package.
- Produce sandbox/live separation evidence.
- Produce webhook signing and replay evidence.
- Produce consent receipt and revocation evidence.
- Produce reconciliation and incident-response evidence.

Acceptance:

```text
ORBI can hand a partner a complete technical pack without exposing secrets or
requiring ad-hoc engineering explanations.
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
