# Provider Adapter Guide

Provider adapters translate provider-specific APIs into ORBI normalized payment events.

Providers are loaded from a manifest, not hardcoded classes. The manifest chooses a protocol engine:

| Protocol | Purpose | Runtime Status |
| --- | --- | --- |
| `REST_JSON` | Plain HTTPS JSON providers with tokenized credential binding. | Generic executor available. |
| `REST_HMAC` | HTTPS JSON providers requiring HMAC-signed requests. | Generic executor available. |
| `ISO8583_TCP_TLS` | Traditional bank/card/switch integrations over TCP/TLS. | Fail-closed extension point until bank profile certification. |
| `SFTP_SETTLEMENT_FILE` | Settlement files, batch reconciliation, and clearing files. | Fail-closed extension point until partner file contract. |
| `SDK_PROVIDER` | Providers requiring an official SDK. | Fail-closed extension point until SDK wrapper is installed. |
| `VPN_PRIVATE_API` | Private bank/provider APIs reached through VPN or private network. | Fail-closed extension point until network profile is approved. |

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

## Protocol Engine Selection

Example REST/HMAC provider:

```json
{
  "code": "provider-code",
  "displayName": "Provider Display Name",
  "rail": "MOBILE_MONEY",
  "protocol": "REST_HMAC",
  "baseUrlEnv": "PROVIDER_API_BASE_URL",
  "credentialTokenRefEnv": "PROVIDER_CREDENTIAL_TOKEN_REF",
  "webhookSecretTokenRefEnv": "PROVIDER_WEBHOOK_SECRET_TOKEN_REF",
  "operationEndpoints": {
    "collection": { "method": "POST", "path": "/collections", "idempotencyHeader": "Idempotency-Key" }
  }
}
```

Example traditional switch provider:

```json
{
  "code": "bank-switch-code",
  "displayName": "Bank Switch Display Name",
  "rail": "BANK",
  "protocol": "ISO8583_TCP_TLS",
  "protocolProfile": "bank-switch-iso8583-profile-v1",
  "connection": {
    "hostEnv": "BANK_SWITCH_HOST",
    "portEnv": "BANK_SWITCH_PORT",
    "mtlsProfileEnv": "BANK_SWITCH_MTLS_PROFILE",
    "vpnProfileEnv": "BANK_SWITCH_VPN_PROFILE",
    "iso8583ProfileEnv": "BANK_SWITCH_ISO8583_PROFILE"
  }
}
```

Traditional switch engines remain fail-closed until the bank/switch contract, test certificates, VPN profile, ISO8583 field packager, and certification evidence are approved.

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
