# ORBI Pay Gateway SDK Changelog

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
