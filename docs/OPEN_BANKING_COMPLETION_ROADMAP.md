# ORBI Open Banking And BaaS Completion Roadmap

Status: active engineering roadmap  
Target: production-grade Open Banking and BaaS readiness  
Rule: a stage is complete only when code, tests, deployment configuration,
runbook, monitoring, and audit evidence all exist.

## Current Baseline

ORBI already has sandbox/live separation, scoped developer services, SDKs,
client-credentials access tokens, token introspection and revocation, consent
receipts, signed webhooks, idempotency, reconciliation evidence, operator
incidents, MFA-protected portal operations, and verified developer onboarding.

These controls are a strong foundation, but they do not by themselves make the
platform fully certified for every bank, jurisdiction, or clearing scheme.

## ORBI BaaS Production Foundation v1

Status: active controlled-production foundation

This stage is not positioned as a prototype. It is the first production
foundation for controlled rollout with approved developers and monitored
merchant integrations. It includes the working control plane needed to operate
developer onboarding, access approval, credential lifecycle, domain trust,
webhook recovery, incidents, messaging, MFA, account recovery, and operational
observability.

Controlled rollout rules:

- start with ORBI-owned or trusted merchants before broad public onboarding;
- keep production access approval gated by business details, verified domains,
  approved scopes, one-time credential handover, and operator audit evidence;
- keep financial secrets and operator keys server-side only;
- treat every production permission, key rotation, suspension, replay, and
  recovery action as auditable evidence;
- do not market the platform as fully certified Open Banking until bank,
  regulator, legal, compliance, data-retention, and scheme-specific gates are
  complete.

Next enterprise gates:

- usage metering for API calls, payment intents, webhooks, failed requests, and
  developer-level activity;
- billing plans for sandbox, production access, payment volume, webhook volume,
  and premium BaaS services;
- KYB/business verification workflow with document evidence and review history;
- compliance evidence exports for access changes, consent receipts, key
  rotations, incidents, webhook replay, and reconciliation;
- long-term time-series monitoring for latency, uptime, failure rate, traffic
  pressure, and developer risk scoring.

## Next BaaS Development Plan

Status: active next-build queue

Recently completed foundation:

- persistent gateway usage metering for API calls, status codes, latency,
  integration activity, and route-level operations;
- operator portal usage summary with top integrations and top operations;
- billing plan catalog for Sandbox Free, Starter, Business, and Enterprise;
- operator-controlled plan assignment with confirmation, reason, audit event,
  and portal controls;
- plan enforcement mode remains `observe` until limits, appeals, customer
  communication, and suspension workflows are fully reviewed.

Next build sequence:

1. **Plan enforcement policy**
   - Define warning, grace, throttle, suspend, and emergency override rules.
   - Keep financial safety first: never create accidental duplicate payment
     movement because of a limit check.
   - Add tests for over-limit behavior before switching from observe mode.

2. **Developer usage dashboard**
   - Show each developer their own API usage, webhook attempts, failed
     requests, plan limits, and warning state.
   - Keep language simple: “You used X of Y calls today” rather than internal
     platform terms.
   - Operators see all developers; developers see only their own integrations.

3. **Billing evidence export**
   - Produce monthly usage evidence by integration and environment.
   - Include API calls, payment intents, webhooks, failed requests, retries,
     plan changes, and operator overrides.
   - Export must be auditable and reproducible from stored events.

4. **Plan change workflow**
   - Add developer request flow for upgrades, live access expansion, or higher
     limits.
   - Add operator approval, rejection, notes, and direct developer messaging.
   - Every plan change must include actor, reason, previous plan, next plan,
     and timestamp.

5. **Automated limit notifications**
   - Send direct email/message when usage reaches defined thresholds.
   - Suggested thresholds: 70%, 90%, 100%, grace-started, suspended.
   - Messages must be direct, developer-friendly, and environment-aware.

6. **Production enforcement switch**
   - Add environment flag to move selected integrations from observe mode to
     enforce mode.
   - Support per-service overrides so trusted enterprise integrations can have
     custom limits.
   - Require runbook, audit proof, and rollback path before enforcement is
     enabled broadly.

7. **SaaS revenue readiness**
   - Add plan pricing metadata without exposing internal billing machinery.
   - Prepare invoice-ready records for later finance/accounting integration.
   - Keep payment collection separate from usage measurement until finance
     policy is approved.

8. **Operational risk scoring**
   - Combine metering, failed requests, origin denials, signature failures,
     webhook failures, and support incidents into a service risk score.
   - Use score for operator review and customer protection, not automatic
     punishment until governance rules are approved.

Definition of done:

- every new control has tests, portal visibility, audit evidence, and safe
  rollback;
- developers receive understandable usage and access messages;
- operators can review, change, suspend, and restore access without direct DB
  edits;
- no billing or limit feature can interrupt completed financial flows or create
  duplicate movement.

## 1. OAuth 2.1 And OIDC Authorization

Status: in progress

Architecture:

- `auth.orbifinancial.com` is the identity authority. It authenticates people
  and provides OIDC identity assertions.
- ORBI Pay Gateway is the financial authorization authority. It validates the
  identity assertion, presents requested financial permissions, records
  consent, and issues scoped financial access tokens.
- Developer API keys are bootstrap client credentials only. They are not
  customer sessions and must not replace explicit user consent.

Existing:

- `client_credentials`
- short-lived scoped service access tokens
- authorization-server metadata
- introspection and revocation
- persistent token revocation
- OIDC discovery and JWKS readiness validation against the public identity
  issuer
- readiness evidence for HTTPS endpoints, exact issuer, PKCE `S256`,
  asymmetric signing, and active signing keys
- PostgreSQL-backed consent authority with relational lookup fields,
  validated receipt evidence, indexed subject access, idempotent evidence
  hashes, and fail-closed startup
- asynchronous consent enforcement so financial decisions always await the
  authoritative store
- RFC 8693-style financial token exchange with strict OIDC/JWKS identity
  verification and consent-bound runtime tokens
- immediate consent and subject revalidation whenever a financial token is
  used
- authorization-code flow with PKCE `S256`
- exact redirect-URI matching
- one-time authorization codes
- refresh-token rotation and reuse detection
- consent-bound token claims and audience/resource binding
- signed logout, risk action, account-lock, and consent revocation propagation
  to token families
- pushed authorization requests through `/oauth/par` and `/v1/oauth/par`
- `private_key_jwt` client authentication foundation for OAuth token, PAR,
  introspection, and revocation endpoints using developer service JWKS metadata
- DPoP sender-constrained token foundation: `/oauth/token` can bind issued
  access tokens to a proof key, and runtime requests enforce fresh DPoP proofs
  whenever a token contains `cnf.jkt`
- official Node and Python SDK helpers for authorization URL preparation,
  pushed authorization requests, callback code exchange, refresh-token renewal,
  and SDK-managed PKCE

Remaining:

- signed authorization request objects (JAR)
- production enforcement switch for SDK-managed DPoP on high-risk live
  integrations
- mTLS certificate-bound access-token profile for certified bank/provider links
- PAR requirement switch for high-risk live integrations after SDK parity

Acceptance:

- no financial user token is issued without authenticated identity and active
  consent;
- authorization codes are one-time and short-lived;
- public clients use PKCE and never require a client secret;
- refresh-token reuse revokes the token family;
- all issued tokens are bound to client, environment, audience, scopes,
  subject, and consent receipt.

Evidence:

- `npm run oidc:readiness` validates the production identity authority;
- readiness passed against `https://auth.orbifinancial.com/realms/orbi` on
  2026-07-31;
- Gateway build and all 117 automated tests passed after the readiness control
  was added.
- `npm run consent:readiness` passed create, authorize, revoke, and deny
  against the production PostgreSQL engine on 2026-07-31;
- consolidated schema `database/main.sql` was
  applied successfully and temporary readiness evidence was removed.
- Gateway build and all 126 automated tests passed after refresh-token
  rotation, reuse detection, and subject revocation propagation were added on
  2026-07-31.
- consolidated schema `database/main.sql` includes
  PostgreSQL-backed PAR records. PAR request URIs are hashed, short-lived,
  one-time, client-bound, and environment-bound.
- `private_key_jwt` assertions require signed JWTs with approved service JWKS,
  exact issuer/subject, endpoint audience, short lifetime, and replay-safe
  `jti`.
- DPoP proof tests verify key thumbprint binding, endpoint/method matching,
  freshness, and replay rejection. Gateway build and all 133 automated tests
  passed after the DPoP foundation was added.
- SDK release `0.1.6` adds OAuth connection helpers for Node and Python and
  was published to npm and PyPI on 2026-08-01.

## Active Production Completion Sprint

Status: started

Focus:

- Developer Portal must remain frontend-only and backend-driven. The browser
  must not connect to financial databases or hold operator/API secrets.
- Developers start in sandbox. Production access requires submitted business
  details, URLs, requested permissions, review, approval, and one-time live
  credential handover.
- Operators/admins manage approvals, suspensions, incidents, key issuance,
  key rotation, webhook replay, portal users, and audit logs.
- Developers can view only their own integrations, request permissions, rotate
  their own keys, and replay only their own payment update deliveries.
- Sandbox and live must expose the same developer contract while using
  separate credentials, base URLs, audit trails, and simulator behavior.
- Live credential issuance must fail closed until every live website, return,
  and payment update hostname passes automatic DNS TXT or HTTPS file ownership
  verification.

Immediate backlog:

- add richer domain verification audit evidence, including last checked time,
  proof method, and developer-facing troubleshooting hints;
- finish customer-facing consent review and revoke screens;
- expand account recovery with stronger identity proofing beyond the current
  audited password reset, session revocation, MFA-preserving recovery flow;
- add downloadable evidence packs for approved integrations;
- add service-level health scoring and launch readiness checklist;
- add usage metering and billing readiness for production developer accounts;
- expand SDK examples for Node, Python, PHP, and webhook replay without raw
  HTTP as the primary path.

## 2. Live mTLS And Transport Trust

Status: partial

Remaining:

- production certificates for Gateway-to-Core and certified providers;
- certificate rotation, expiry alerts, trust-store ownership, and revocation;
- mTLS plus HMAC enforcement evidence;
- tested rollback and certificate incident runbooks.

Acceptance: unsigned or untrusted internal financial traffic is rejected before
business processing.

## 3. Consent Lifecycle

Status: partial

Remaining:

- customer-facing grant, review, renewal, and revocation journeys;
- consent expiry and permission reduction;
- revocation propagation to tokens, webhooks, and connected services;
- localized consent receipts and regulatory retention rules.

Acceptance: every third-party data or payment action maps to an active,
auditable consent and approved scope.

## 4. Bank And Provider Adapters

Status: partial

Remaining:

- certified provider implementations rather than protocol skeletons;
- ISO 20022 `pacs.008`, `pacs.002`, and `pacs.004` certification samples;
- provider callback signatures, polling, retries, idempotency, and failover;
- scheme-specific amount, currency, account, and reference controls.

Acceptance: each live rail has partner certification and deterministic failure
and reconciliation behavior.

## 5. Automated Reconciliation

Status: partial

Remaining:

- scheduled comparison of Gateway, Core ledger, provider settlement, and
  merchant webhook truth;
- duplicate, missing, reversed, disputed, and amount-mismatch queues;
- operator ownership, aging, resolution evidence, and signed daily exports.

Acceptance: a payment is reconstructable end-to-end without manual database
inspection.

## 6. Security Release Gates

Status: partial

Remaining:

- CI dependency and secret scanning;
- SAST, DAST, container/image scanning, and SBOM;
- threat models and penetration tests;
- migration safety and dual-control production approval.

Acceptance: an unsafe or unreviewed build cannot reach production.

## 7. Monitoring, Resilience, And Disaster Recovery

Status: partial

Remaining:

- defined SLOs, error budgets, and customer-impact dashboards;
- SIEM ingestion and alert ownership;
- encrypted off-host backups and restore drills;
- high-availability database/runtime design;
- measured RTO/RPO and regional recovery evidence.

Acceptance: ORBI can detect, contain, restore, and prove recovery from a major
service or infrastructure failure.

## 8. Developer Lifecycle And Governance

Status: partial

Remaining:

- password recovery and verified account recovery;
- domain ownership verification;
- organization/team membership and separation of duties;
- operator-reviewed live access, suspension, closure, and data retention;
- complete key custody and credential compromise journeys.

Acceptance: every developer, operator, integration, permission, key, and domain
has a clear owner and auditable lifecycle.

## 9. Certification And Evidence Pack

Status: pending

Remaining:

- OpenAPI and SDK release pack;
- ISO 20022 samples and provider test evidence;
- security architecture, penetration-test report, and SBOM;
- consent, reconciliation, incident, backup, and recovery evidence;
- operational contacts, escalation matrix, and change-control records.

Acceptance: a bank or regulated partner can complete technical due diligence
without ad-hoc database access or undocumented explanations.

## 10. Legal, Regulatory, And Scheme Readiness

Status: pending external review

Remaining:

- jurisdiction-specific legal and data-protection review;
- AML/KYC, sanctions, fraud, complaints, and safeguarding control validation;
- regulator, sponsor bank, scheme, and provider approvals where applicable;
- data residency, retention, outsourcing, and third-party risk agreements.

Acceptance: legal counsel, compliance owners, sponsor institutions, and
applicable authorities approve the intended live operating model.

## Execution Order

```text
1 OAuth/OIDC
2 mTLS
3 Consent lifecycle
4 Provider adapters
5 Reconciliation
6 Security gates
7 Resilience/DR
8 Developer governance
9 Certification evidence
10 Regulatory approval
```

Do not mark the platform “100% Open Banking” solely from software completion.
Final readiness depends on certified external rails and applicable regulatory
approval as well as engineering evidence.
