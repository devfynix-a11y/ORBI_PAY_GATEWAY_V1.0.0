# Provider Adapter Guide

Provider adapters translate provider-specific APIs into ORBI normalized payment events.

## Adapter Contract

Each adapter implements:

```ts
interface PaymentProviderAdapter {
  code: string;
  displayName: string;
  collect(request: GatewayPaymentRequest): Promise<GatewayPaymentResponse>;
  payout(request: GatewayPaymentRequest): Promise<GatewayPaymentResponse>;
  refund(request: GatewayPaymentRequest): Promise<GatewayPaymentResponse>;
  parseWebhook(payload: unknown, headers: Record<string, string | undefined>): Promise<NormalizedProviderEvent>;
  health(): Promise<ProviderHealth>;
}
```

## Required Provider Behaviors

Production adapters must:

- validate credentials during readiness
- use provider idempotency/reference fields
- normalize statuses to `pending`, `processing`, `completed`, or `failed`
- verify webhook signatures and timestamps
- preserve raw provider payloads for audit, without logging secrets
- never call ORBI Core with unverified provider success
- never mutate ORBI balances directly

## Status Mapping

| Provider State | ORBI State |
| --- | --- |
| accepted, queued, initiated | `pending` |
| processing, in_progress | `processing` |
| success, paid, completed, settled | `completed` |
| failed, rejected, cancelled, expired | `failed` |

## Adding A Provider

1. Create `src/adapters/<provider>/<Provider>Adapter.ts`.
2. Implement the adapter contract.
3. Add environment variables to `.env.example`.
4. Register the adapter in `src/adapters/AdapterRegistry.ts`.
5. Add tests for readiness, status mapping, signing, and webhook parsing.
6. Document required provider dashboard callback URLs.

## Provider Callback URL

```txt
https://gateway.orbifinancial.com/v1/webhooks/<providerCode>
```

Examples:

```txt
https://gateway.orbifinancial.com/v1/webhooks/mpesa-tanzania
https://gateway.orbifinancial.com/v1/webhooks/selcom
```
