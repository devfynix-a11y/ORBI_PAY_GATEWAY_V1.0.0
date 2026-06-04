# ORBI Pay Gateway API Reference

The gateway API is provider-facing and rail-facing. ORBI Core remains the business and ledger authority.

## Health

```http
GET /health
```

Returns service status, provider mode, and timestamp.

## Readiness

```http
GET /ready
```

Returns Core callback target, mTLS mode, provider mode, and provider adapter readiness. Secrets are never returned.

## Provider List

```http
GET /v1/providers
GET /v1/providers/:providerCode/health
```

Provider codes are loaded from the provider manifest. They are not hardcoded in source.

## Collections

```http
POST /v1/collections
Content-Type: application/json
```

Use collections when external money is moving into ORBI, for example external rail to ORBI wallet.

```json
{
  "providerCode": "provider-code",
  "reference": "ORBI-DEP-20260604-0001",
  "amount": 10000,
  "currency": "TZS",
  "phone": "+255700000000",
  "walletId": "target-orbi-wallet-id",
  "description": "Wallet deposit",
  "metadata": {
    "coreMovementId": "external-fund-movement-id",
    "userId": "orbi-user-id"
  }
}
```

## Payouts

```http
POST /v1/payouts
Content-Type: application/json
```

Use payouts when ORBI-approved money is moving out to an external provider rail.

```json
{
  "providerCode": "provider-code",
  "reference": "ORBI-WDR-20260604-0001",
  "amount": 5000,
  "currency": "TZS",
  "phone": "+255700000000",
  "description": "Wallet withdrawal",
  "metadata": {
    "coreMovementId": "external-fund-movement-id",
    "sourceWalletId": "orbi-wallet-id"
  }
}
```

## Refunds

```http
POST /v1/refunds
Content-Type: application/json
```

Refunds must reference the original ORBI transaction or provider reference so Core keeps the money lifecycle closed.

```json
{
  "providerCode": "provider-code",
  "reference": "ORBI-RFD-20260604-0001",
  "amount": 5000,
  "currency": "TZS",
  "phone": "+255700000000",
  "description": "Refund for original transaction",
  "metadata": {
    "originalTransactionId": "core-transaction-id",
    "originalProviderReference": "provider-reference"
  }
}
```

## Provider Webhooks

```http
POST /v1/webhooks/:providerCode
Content-Type: application/json
```

Provider adapters parse provider-specific callbacks into normalized events:

Provider callbacks are verified against the manifest-defined signature contract before normalization. Unsigned, stale, replayed, or tampered callbacks are rejected before ORBI Core receives any event.

```json
{
  "providerId": "provider-code",
  "reference": "ORBI-DEP-20260604-0001",
  "status": "completed",
  "message": "Provider confirmed payment",
  "providerEventId": "provider-event-id",
  "rawStatus": "0",
  "payload": {}
}
```

The gateway then signs the normalized event and sends it to ORBI Core:

```http
POST /api/internal/gateway/provider-events
```

Required worker scope:

```txt
gateway:events:write
```
