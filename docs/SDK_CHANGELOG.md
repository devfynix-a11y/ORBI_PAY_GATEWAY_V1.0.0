# ORBI Pay Gateway SDK Changelog

## 0.1.6

- Added SDK-first OAuth customer connection helpers for Node and Python:
  authorization URL preparation, pushed authorization requests, callback code
  exchange, and refresh token renewal.
- Added PKCE generation inside the SDK so developers do not need to hand-build
  verifier/challenge logic.
- Updated SDK docs with simple customer/seller/member connection examples.

## 0.1.5

- Added SDK-managed stronger token binding for Node with `dpop: true`.
- Added SDK-managed stronger token binding for Python with `dpop=True`.
- Updated developer setup guidance so new production integrations can enable
  stronger token binding without writing proof headers manually.

## 0.1.4

- Added SDK-first OAuth metadata helpers for Node, Python, and PHP.
- Added access token introspection and revocation helpers so developers do not
  need to hand-build token lifecycle HTTP calls.
- Added Gateway OAuth authorization server metadata discovery endpoint.

## 0.1.3

- Added optional `correlationId` and `traceId` request options across official
  SDK runtime calls for end-to-end audit correlation.
- Added Node SDK webhook replay evidence fields: `reason`, `requestedBy`, and
  `metadata`.
- Preserved backward compatibility for existing `idempotencyKey` and
  `requestId` integrations.

## 0.1.2

- Added SDK-first runtime contract support for payment intents, transfers,
  payment profiles, PaySafe actions, consent helpers, and webhook replay.
- Added sandbox/live separation guidance and package release checks.
