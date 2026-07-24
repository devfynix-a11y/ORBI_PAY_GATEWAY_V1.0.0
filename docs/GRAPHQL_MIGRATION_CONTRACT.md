# GraphQL Migration Contract

ORBI Pay Gateway is moving toward GraphQL, but REST remains the stable
authoritative runtime contract until GraphQL reaches full security and audit
parity.

## Current Status

```text
Status: contract_preview
Schema endpoint: GET /v1/developer/graphql/schema
Migration plan endpoint: GET /v1/developer/graphql/migration-plan
Future execution endpoint: POST /graphql
```

## SDK Contract Shape

Developer-facing SDK methods should use product language, not raw transport
language:

```ts
await orbi.transfers.send({
  reference: 'ORDER-10001',
  amount: 50000,
  currency: 'TZS',
  customer: { phone: '+255700000000' },
});

await orbi.Transfers.send({
  reference: 'ORDER-10002',
  amount: 75000,
  currency: 'TZS',
  customer: { phone: '+255711111111' },
});

await orbi.payments.checkout({
  reference: 'SHOP-ORDER-10001',
  amount: 125000,
  currency: 'TZS',
  returnUrl: 'https://merchant.example/return',
  callbackUrl: 'https://merchant.example/api/orbi/webhooks',
});

await orbi.developer.sandboxSimulator.transfer({
  fromAccountId: 'sbx_buyer_daniel',
  toAccountId: 'sbx_seller_catherine',
  amount: 25000,
  currency: 'TZS',
  reference: 'SBX-ORDER-1',
});
```

`orbi.transfers.send(...)` and `orbi.Transfers.send(...)` are the same public
contract. Demo and Production are selected through SDK config or request
headers, not through a different money API:

```ts
const orbi = createOrbi({
  baseUrl: 'https://sandbox-pay.orbifinancial.com',
  serviceKey: process.env.ORBI_SANDBOX_SERVICE_KEY!,
  environment: 'Demo', // sends x-orbi-environment: demo
});

await orbi.transfers.send({
  reference: 'ORDER-10003',
  amount: 50000,
  currency: 'TZS',
  customer: { phone: '+255700000000' },
});
```

The SDK may later call GraphQL internally, but the public SDK method names and
business contracts should stay stable.

## GraphQL Safety Gates

GraphQL mutations can go live only after:

- service-key and operator-key parity with REST
- subject/session context parity for user-facing consent APIs
- idempotency key support for every financial mutation
- consent and scope guard parity
- webhook event parity with REST payment intent events
- full audit trail with operation name, variables hash, actor, and service code
- sandbox-only execution before live mutation access
- contract tests for REST/GraphQL equivalent behavior

## Separation Rule

Sandbox GraphQL execution may simulate balances and payment outcomes. Live
GraphQL execution must never bypass Core ledger authority, PaySafe lifecycle
rules, consent evidence, risk controls, or webhook signing.
