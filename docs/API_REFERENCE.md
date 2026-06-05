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
Provider readiness includes `protocolCapabilities` so operators can see whether a rail is `generic-live`, `certified-live`, or intentionally `fail-closed`.

## Provider List

```http
GET /v1/providers
GET /v1/providers/:providerCode/health
```

Provider codes are loaded from the provider manifest. They are not hardcoded in source.

Provider health response includes:

- `rail`: mobile money, bank, card gateway, or crypto.
- `protocol`: selected protocol engine.
- `missingEnv`: required env references that are not configured.
- `credentialBinding`: tokenized credential status without exposing secrets.
- `protocolCapabilities`: online authorization, webhook, batch, network-control, and certification posture.

## OBP/NMB Payment Capability Discovery

```http
GET /v1/discovery/obp/:providerCode/payment-capabilities?bankId=nmbb.01.tz.nmbb&countryCode=TZ&currency=TZS
x-orbi-pay-operator-key: <PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY>
```

This operator-only endpoint discovers payment capability candidates from an Open Bank Project provider such as `nmb-obp-sandbox`.

The gateway inspects:

- `/obp/v4.0.0/banks`
- `/obp/v2.1.0/banks/{BANK_ID}/transaction-request-types`
- `/obp/v6.0.0/management/system-dynamic-entities`
- `/obp/v6.0.0/management/banks/{BANK_ID}/dynamic-entities`
- account-level transaction request types when `accountId` and `viewId` are provided

The response is a review list, not a production switch-on command. ORBI Core and the Admin Portal must approve and save selected entries into `payment_rail_capabilities` before mobile apps display them.

Example response item:

```json
{
  "sourceProviderCode": "nmb-obp-sandbox",
  "source": "OBP_TRANSACTION_REQUEST_TYPE",
  "capabilityCode": "M_PESA_TZ_TZ",
  "displayName": "M Pesa Tz",
  "rail": "MOBILE_MONEY",
  "countryCode": "TZ",
  "currency": "TZS",
  "operations": ["collection", "payout"],
  "operationCodes": ["COLLECTION_REQUEST", "DISBURSEMENT_REQUEST"],
  "status": "REQUIRES_REVIEW",
  "requires": { "msisdn": true }
}
```

Do not expose this endpoint publicly. It uses provider credentials to inspect bank capability metadata and must remain operator/internal only.

## OBP/NMB Sandbox Accounts

```http
GET /v1/discovery/obp/:providerCode/banks/:bankId/accounts?scope=all&accountType=CURRENT
x-orbi-pay-operator-key: <PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY>
```

This operator-only endpoint helps engineers inspect NMB/OBP sandbox accounts after sandbox data has been imported or issued by the bank.

Supported `scope` values:

- `latest`: calls `/obp/v6.0.0/banks/{BANK_ID}/accounts`
- `private`: calls `/obp/v3.0.0/banks/{BANK_ID}/accounts/private`
- `public`: calls `/obp/v2.0.0/banks/{BANK_ID}/accounts/public`
- `all`: inspects all of the above and returns a merged list

Optional `accountType` is forwarded to authenticated account endpoints as `account_type`.

The response includes sanitized account metadata and an `inspected` section showing which OBP endpoints worked. This endpoint is for operator sandbox validation only. Mobile apps must never consume raw OBP account lists directly; they must consume approved ORBI Core payment methods.

## OBP Sandbox Data Import

```http
POST /v1/discovery/obp/:providerCode/sandbox/data-import
x-orbi-pay-operator-key: <PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY>
Content-Type: application/json
```

Passes a sandbox data import payload to:

```txt
/obp/v2.1.0/sandbox/data-import
```

Use this only in sandbox with a user that has the OBP `CanCreateSandbox` entitlement. The payload can create test banks, users, accounts, transactions, branches, and ATMs depending on the OBP sample you provide.

Never enable sandbox data import against production provider profiles.

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
