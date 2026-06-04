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
  parseWebhook(payload: unknown, headers: Record<string, string | undefined>, rawBody?: Buffer): Promise<NormalizedProviderEvent>;
  health(): Promise<ProviderHealth>;
}
```

## Required Provider Behaviors

Production adapters must:

- validate tokenized credential bindings during readiness
- use provider idempotency/reference fields
- normalize statuses to `pending`, `processing`, `completed`, or `failed`
- verify webhook signatures and timestamps
- preserve raw provider payloads for audit, without logging secrets
- never call ORBI Core with unverified provider success
- never mutate ORBI balances directly
- never log raw provider credentials, token refs, OTPs, PINs, card data, or SCA authentication values
- reject unsigned, stale, or tampered provider callbacks before forwarding to Core

## Status Mapping

| Provider State | ORBI State |
| --- | --- |
| accepted, queued, initiated | `pending` |
| processing, in_progress | `processing` |
| success, paid, completed, settled | `completed` |
| failed, rejected, cancelled, expired | `failed` |

## Adding A Provider

1. Add a provider definition to `config/providers.json` or `PAYMENT_GATEWAY_PROVIDER_MANIFEST_JSON`.
2. Set provider token reference env vars from the manifest.
3. Add a custom adapter plugin only when the provider cannot be represented by the generic HTTP contract.
4. Add tests for readiness, status mapping, signing, and webhook parsing.
5. Document required provider dashboard callback URLs.

Providers are not hardcoded into the gateway source. The default registry loads provider definitions from the manifest and creates generic adapters dynamically.

## Webhook Signature Manifest

Each provider can declare its callback signature contract:

```json
{
  "webhookSignature": {
    "algorithm": "sha256",
    "signatureHeader": "x-provider-signature",
    "timestampHeader": "x-provider-timestamp",
    "toleranceSeconds": 300,
    "signedPayloadFormat": "timestamp.raw"
  }
}
```

The gateway signs/verifies the raw request body, not the parsed JSON object. This prevents attackers from changing payload fields and replaying a fake success callback.

## Provider Callback URL

```txt
https://pay.orbifinancial.com/v1/webhooks/<providerCode>
```

Examples:

```txt
https://pay.orbifinancial.com/v1/webhooks/provider-code
https://pay.orbifinancial.com/v1/webhooks/bank-rail-provider
```
