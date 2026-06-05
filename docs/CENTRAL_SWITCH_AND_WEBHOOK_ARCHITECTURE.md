# Central Switch And Webhook Architecture

This document maps the ORBI Pay Gateway flow for provider APIs, central switches, callbacks, tokenized credentials, and webhook signing.

## 1. Entry Gate

Public users, merchants, agents, and admins do not call ORBI Pay Gateway directly for financial authorization. They call ORBI Core first.

```txt
Mobile / Web / Merchant
  -> ORBI Core
  -> ORBI Pay Gateway
  -> Provider / Central Switch
```

ORBI Core owns user authentication, wallet authority, risk checks, transaction intent creation, fee locking, idempotency, and final ledger posting.

ORBI Pay Gateway receives only Core-approved execution instructions.

## 2. Gateway Rail Execution

ORBI Pay Gateway exposes rail execution endpoints:

```http
POST /v1/collections
POST /v1/payouts
POST /v1/refunds
```

The request must reference a Core-approved movement. Payloads should never include raw card data, provider passwords, API secrets, OTPs, PINs, or raw KYC data.

For card-style rails, Core must provide redacted SCA/3DS proof:

```json
{
  "rail": "CARD_GATEWAY",
  "sca": {
    "status": "authenticated",
    "protocol": "3DS2",
    "challengeId": "core-issued-challenge-id",
    "dsTransactionId": "directory-server-transaction-id",
    "eci": "05",
    "liabilityShift": true
  }
}
```

## 3. Provider Manifest

Providers are loaded from a manifest, not hardcoded source files.

```env
PAYMENT_GATEWAY_PROVIDER_MANIFEST_PATH=config/providers.json
```

Each provider definition declares provider code, rail type, supported countries/currencies, supported operations, tokenized credential env names, webhook signature rules, and status/reference mapping fields.

The manifest also selects a protocol engine:

```txt
REST_JSON
REST_HMAC
ISO20022_REST_JSON
ISO20022_REST_XML
ISO20022_MTLS
ISO8583_TCP_TLS
SFTP_SETTLEMENT_FILE
SDK_PROVIDER
VPN_PRIVATE_API
```

REST engines can execute through the generic executor. ISO 20022 REST JSON/XML engines provide the preferred bank/switch participant mapping for TIPS-style expansion. Private mTLS and traditional engines are fail-closed until the bank/switch certificate, participant profile, VPN, ISO 20022 implementation guide, ISO8583 profile, settlement-file schema, or SDK contract is certified.

## 4. Tokenized Credential Layer

The gateway stores token references, not the financial credentials themselves.

```env
PROVIDER_CREDENTIAL_TOKEN_REF=vault://orbi-pay/provider-code/api-credential
PROVIDER_WEBHOOK_SECRET_TOKEN_REF=vault://orbi-pay/provider-code/webhook-secret
```

If transaction data is intercepted, it does not contain the underlying provider credential. The credential can only be resolved inside the gateway boundary by an approved vault/HSM/KMS resolver.

Development may use `env://SOME_SECRET_ENV_NAME` token refs. Production should use vault/HSM/KMS-backed token refs.

## 5. Central Switch Communication

Provider adapters translate ORBI-normalized requests into the provider or switch contract.

Typical switch protocols include ISO 20022 XML/JSON over HTTPS or mTLS, HTTPS JSON APIs, ISO 8583 over secure provider networks, provider SDKs, VPN/private tunnel APIs, and TLS or mTLS-protected HTTP APIs.

The gateway maps ORBI reference, amount, currency, rail identity, idempotency key, participant metadata, provider metadata, and SCA/3DS evidence where required.

For ISO 20022 clearing paths, the gateway maps:

- ORBI reference to `InstrId`, `EndToEndId`, and `TxId`
- amount and currency to `IntrBkSttlmAmt`
- sender account/wallet to debtor party/account
- receiver account/wallet to creditor party/account
- clearing route to settlement information and local instrument
- payment return/refund to `pacs.004`

## 6. Inbound Provider Webhooks

Providers call:

```http
POST /v1/webhooks/:providerCode
```

The gateway verifies provider code, raw body signature, timestamp freshness, replay strategy, provider reference mapping, and normalized status.

Manifest example:

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

If signature verification fails, the event is rejected and never reaches ORBI Core.

## 7. Gateway To Core Final Loop

After provider validation, the gateway sends a normalized provider event to Core:

```http
POST /api/internal/gateway/provider-events
```

Every callback is signed with worker headers:

- `x-worker-id`
- `x-worker-scopes`
- `x-worker-request-id`
- `x-worker-timestamp`
- `x-worker-nonce`
- `x-worker-signature`
- `x-worker-key-id`

Core verifies worker identity, scope, HMAC signature, body hash, timestamp, nonce replay protection, reference, amount, currency, provider, and transaction state.

Only Core can mark the transaction final and post ledger entries.

## 8. Outbound Merchant Webhooks And Notifications

Merchant callbacks and customer notifications are Core responsibilities.

```txt
Provider -> Pay Gateway -> signed event -> ORBI Core
ORBI Core -> merchant callback_url
ORBI Core -> ORBI Talk Gateway -> SMS/email/push/WhatsApp
```

This keeps payment execution, ledger authority, and messaging cleanly separated.
