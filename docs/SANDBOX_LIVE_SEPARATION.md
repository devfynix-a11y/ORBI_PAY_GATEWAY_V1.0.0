# Sandbox And Live Separation

ORBI Pay Gateway treats `sandbox` and `live` as separate trust zones.
Developers must never mix credentials, webhook secrets, redirect URLs, consent
evidence, or provider behavior across these environments.

## Environment Profiles

```http
GET /v1/developer/environment-profiles
GET /v1/developer/environment-profiles/sandbox
GET /v1/developer/environment-profiles/live
```

Sandbox:

```text
Money mode: simulated
Ledger mode: no Core ledger commit
Provider mode: simulator
API key prefix: orbi_sandbox_
Webhook secret prefix: orbi_whsec_sandbox_
Webhook mode: signed test events
```

Live:

```text
Money mode: real
Ledger mode: Core ledger commit required
Provider mode: certified or live provider
API key prefix: orbi_live_
Webhook secret prefix: orbi_whsec_live_
Webhook mode: signed live events
```

## Sandbox Simulator Flow

```http
GET /v1/developer/sandbox-simulator
GET /v1/developer/sandbox-simulator/state
GET /v1/developer/sandbox-simulator/accounts
POST /v1/developer/sandbox-simulator/reset
POST /v1/developer/sandbox-simulator/transfers
POST /v1/developer/sandbox-simulator/transfers/{transferId}/webhook-event
```

The simulator guide helps developers test:

- payment intent creation with sandbox service keys
- hosted challenge approve/decline behavior
- signed `payment_intent.updated` webhook handling
- signed `consent.revoked` webhook handling
- intent reconciliation after redirect
- webhook replay and idempotent merchant processing

Sandbox simulator flows must not create real ledger movement.

Sandbox parity rule:

```text
The public API envelope, SDK method names, idempotency behavior, public status
names, hosted challenge contract, and webhook event family must match live.
Only the money source differs: sandbox uses fake balances and live uses Core
ledger/provider settlement.
```

Developers should test both layers:

```text
Runtime sandbox:
Use orbi.transfers.send(...) against https://sandbox-pay.orbifinancial.com.
This validates real request signing, idempotency, hosted challenge behavior,
webhook signing, and intent reconciliation without live money movement.

Simulator tools:
Use orbi.developer.sandboxSimulator.* for fake account movement, webhook event
payload practice, and developer portal demos. These routes are not production
money APIs and require operator/developer tooling credentials.
```

## One Business SDK Contract

Developers should not learn separate transfer methods for Demo and Production.
The transfer contract is always:

```ts
await orbi.transfers.send({
  reference: 'ORDER-10001',
  amount: 50000,
  currency: 'TZS',
  customer: { phone: '+255700000000' },
});
```

Use SDK config to select the runtime environment:

```ts
const sandboxOrbi = createOrbi({
  baseUrl: 'https://sandbox-pay.orbifinancial.com',
  serviceKey: process.env.ORBI_SANDBOX_SERVICE_KEY!,
  environment: 'Demo',
});

const liveOrbi = createOrbi({
  baseUrl: 'https://pay.orbifinancial.com',
  serviceKey: process.env.ORBI_LIVE_SERVICE_KEY!,
  environment: 'Production',
});

await sandboxOrbi.transfers.send(payload);
await liveOrbi.transfers.send(payload);
```

Use `https://sandbox-pay.orbifinancial.com` for Demo/Sandbox and
`https://pay.orbifinancial.com` for Production/Live. The SDK sends
`x-orbi-environment: demo|production`. Production still requires real
production service keys and approved live scopes. The sandbox simulator is
developer tooling only:

```ts
await orbi.developer.sandboxSimulator.transfer({
  fromAccountId: 'sbx_buyer_daniel',
  toAccountId: 'sbx_seller_catherine',
  amount: 25000,
  currency: 'TZS',
  reference: 'SBX-ORDER-1',
});
```

## Live Promotion Checklist

- Service is approved for `live`.
- Requested live scopes are approved.
- Live redirect and webhook URLs are allowlisted.
- Live API key and webhook secret are issued and stored server-side.
- Merchant-scoped products have `metadata.merchant` configured.
- Merchant ID env vars resolve inside the live Gateway container.
- Webhook receiver verifies signatures and dedupes `eventId`.
- Every financial request uses a stable idempotency key.
- Return URL is UX continuation only; signed webhook plus intent read is payment
  truth.

## SDK Usage

```ts
const profiles = await operator.getDeveloperEnvironmentProfiles();
const live = await operator.getDeveloperEnvironmentProfile('live');
const simulator = await operator.getSandboxSimulatorFlow();
```

Use these APIs in the Developer Portal before showing keys, webhook setup,
payment simulators, or live promotion controls.
