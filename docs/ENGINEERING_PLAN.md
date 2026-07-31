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
1. Secure the Core connection.
   Gateway must prove its identity to Core. HMAC stays on forever; live mTLS is
   added after approved smoke evidence.
2. Keep Developer Portal backend-driven.
   The portal must call Gateway APIs only. No browser database access, no
   browser operator keys, no browser service secrets.
3. Verify developer domains.
   Website origins, return URLs, callback URLs, and payment update URLs must be
   registered, approved, environment-scoped, and enforced.
4. Make every payment easy to trace.
   SDK, Gateway, Core, hosted challenge, payment updates, operator actions, and
   reconciliation must carry shared request evidence.
5. Make payment update replay safe.
   Replay must be operator-controlled, signed, logged, and visible to the
   developer/service owner.
6. Polish SDKs for normal developers.
   Node, Python, PHP, and future SDKs must hide signing and retry details behind
   simple methods such as `orbi.transfers.send(...)`.
7. Finish Open Banking/BaaS controls.
   Consent, permissions, revocation, access grants, rate limits, audit exports,
   and certification packs must be production-grade.
8. Finish SaaS control-plane ownership.
   Developer sessions must only see their own services. Operator/admin approval
   must stay separate from developer self-service.
9. Prepare bank-grade evidence.
   mTLS, OAuth/OIDC, secret custody, reconciliation reports, monitoring,
   security tests, and provider certification evidence must be ready for bank
   review.
```

Developer-facing path:

```text
Create account -> build in sandbox -> add trusted domains -> request live access
-> receive keys -> use SDK -> receive signed payment updates -> reconcile.
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
- Declare `PAYMENT_GATEWAY_INTERNAL_CORE_TRANSPORT_MODE`.
- Keep `private_http` limited to Docker/private Core targets such as
  `http://core:3000` with HMAC worker signatures.
- Run `npm run mtls:readiness`.
- Enable live mTLS during a maintenance window.
- Smoke `/health`, `/ready`, signed Core callback denial/allow paths, and
  provider event callback paths.
- Document rollback to HMAC-only if transport cutover fails.

Acceptance:

```text
Gateway readiness reports internal Core transport as pass. During the current
self-hosted phase this may be `private_http` + HMAC on Docker private networks;
the bank-grade cutover target is `mtls` + HMAC with Core still rejecting
unsigned callbacks.
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
  - Current Gateway implementation exposes signed internal evidence export via
    `GET/POST /v1/internal/reconciliation/evidence/export`.
  - If `PAYMENT_GATEWAY_RECONCILIATION_EXPORT_PATH` is configured, the report is
    also written as a JSON file for operator retention.
  - Self-hosted runtime can schedule exports with
    `PAYMENT_GATEWAY_RECONCILIATION_SCHEDULE_ENABLED`, interval minutes, and
    lookback window hours.
- Correlate merchant order, payment intent, hosted challenge, PaySafe escrow,
  Core ledger transaction, provider proof, webhook delivery, and final status.
- Add exception queues for stuck, duplicated, mismatched, reversed, and
  disputed records.
  - Current Gateway evidence reports include exception queues for stuck payment
    intents, failed Core submissions, failed/pending webhooks, and final intents
    without delivered webhook evidence.
  - Thresholds are configurable with
    `PAYMENT_GATEWAY_RECONCILIATION_STUCK_INTENT_MINUTES` and
    `PAYMENT_GATEWAY_RECONCILIATION_WEBHOOK_PENDING_MINUTES`.
- Add signed report hashes.
  - Current reports include a SHA-256 `reportHash` plus HMAC-SHA256 signature
    using the gateway worker signing key id.

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
  - Current gateway implementation supports non-blocking HTTP JSON sinks through
    `PAYMENT_GATEWAY_AUDIT_EVENT_SINK_URL` or JSONL sinks through
    `PAYMENT_GATEWAY_AUDIT_EVENT_SINK_PATH`.
  - Events redact secrets, API keys, signatures, authorization tokens, OTPs,
    PINs, and private keys before delivery.
  - Sink failures are logged as warnings and must not block payment, escrow,
    webhook, or OAuth runtime flows.
- Add alerts for callback failures, mTLS expiry, webhook failure spikes,
  auth anomalies, idempotency reuse, and reconciliation mismatches.
  - Current Gateway scheduled reconciliation raises actionable operator alerts
    when exception queues are non-empty. Alerts can be delivered to HTTP JSON via
    `PAYMENT_GATEWAY_OPERATOR_ALERT_SINK_URL` or JSONL via
    `PAYMENT_GATEWAY_OPERATOR_ALERT_SINK_PATH`.
  - Alert payloads include report id, critical/warning counts, exception type
    counts, and runbook triage steps.
  - Current Gateway also opens persistent operator incidents for reconciliation
    exceptions. Incidents support `open -> acknowledged -> assigned -> resolved`
    lifecycle through `/v1/operator/incidents...`, and Developer Portal
    operator/admin tools must access them through the portal gateway BFF.
  - Current Gateway can run incident SLA escalation checks. Unresolved critical
    and warning incidents emit one-time escalation alerts and audit evidence
    after configurable SLA thresholds.
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
