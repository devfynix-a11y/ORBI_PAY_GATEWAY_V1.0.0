# ORBI Pay Bank-Grade Review Pack

This pack is for external readiness review, partner due diligence, and internal release approval. It describes controls developers and reviewers can validate without exposing private implementation details.

## Review Scope

- Hosted payment intents, PaySafe escrow, transfers, identity lookup, payment profiles, consent receipts, webhook delivery, webhook replay, SDKs, sandbox simulation, and developer access control.
- Sandbox and live environments must run the same public API contract. Sandbox uses simulated balances and test identities. Live requires approved credentials, verified domains, and active permissions.
- Developers should use official SDKs where possible: Node.js, Python, and PHP.

## Required Evidence Before Production Release

- Release gate evidence from `npm run release:gate`.
- OpenAPI contract check and SDK catalog check.
- Runtime smoke showing health, readiness, CORS allow/deny, signed financial request enforcement, and internal ingress enforcement.
- Sandbox certification smoke using sandbox services.
- SDK package version sync across Node, Python, PHP metadata, docs, and changelog.
- Operator security evidence showing denied financial requests, CORS denials, rate/security classes, and audit correlation.

## Security Controls

- TLS is required for public traffic.
- OAuth/OIDC subject verification is required for hosted consent and sensitive developer operations.
- Financial requests require signed request context, idempotency keys, and replay protection.
- Webhook handlers must verify signatures before processing events.
- Developer domains must be verified before live credentials are issued.
- Secret keys are shown once, stored encrypted, rotated through audited workflows, and must never be exposed in browser code.
- Internal service communication must use signed gateway context, and mTLS can be enabled for stronger runtime isolation.

## Operational Controls

- Every sensitive request must carry a traceable request ID or correlation ID.
- Denied security events must be written to operator evidence.
- Failed webhooks must be replayable with a clear audit trail.
- Reconciliation exports must be written to a configured durable path.
- Production incidents must have severity, owner, SLA, and resolution evidence.

## Developer Responsibilities

- Keep production keys server-side.
- Use idempotency keys for every financial operation.
- Verify webhook signatures.
- Use stable business references for orders, invoices, transfers, and escrow requests.
- Register and verify every live domain and callback URL.
- Request only the permissions required by the integration.

## Go/No-Go Checklist

- `npm run release:gate` passes without skipped gates.
- Sandbox and live health endpoints are reachable.
- SDK package versions match documented install commands.
- Domain verification works for at least one owned test domain.
- A sandbox payment intent can be created, challenged, completed, and reconciled.
- A denied financial request appears in operator evidence.
- Webhook replay works for a failed sandbox delivery.
- Live credentials are locked until access approval and domain verification are complete.
