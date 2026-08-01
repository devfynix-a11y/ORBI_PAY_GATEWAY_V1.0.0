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

Remaining:

- SDK methods for authorization URL, callback exchange, refresh, and revoke
- signed authorization request objects (JAR)
- SDK-level DPoP proof generation and production enforcement switch for
  high-risk live integrations
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
- migration `database/migrations/001_pay_gateway_consent_authority.sql` was
  applied successfully and temporary readiness evidence was removed.
- Gateway build and all 126 automated tests passed after refresh-token
  rotation, reuse detection, and subject revocation propagation were added on
  2026-07-31.
- migration `database/migrations/004_pay_gateway_oauth_par.sql` adds
  PostgreSQL-backed PAR records. PAR request URIs are hashed, short-lived,
  one-time, client-bound, and environment-bound.
- `private_key_jwt` assertions require signed JWTs with approved service JWKS,
  exact issuer/subject, endpoint audience, short lifetime, and replay-safe
  `jti`.
- DPoP proof tests verify key thumbprint binding, endpoint/method matching,
  freshness, and replay rejection. Gateway build and all 133 automated tests
  passed after the DPoP foundation was added.

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
