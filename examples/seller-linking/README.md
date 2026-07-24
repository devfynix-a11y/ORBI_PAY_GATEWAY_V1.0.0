# ORBI Seller Linking Example

This example shows how a merchant platform links its own durable seller record
to an ORBI payment profile without storing ORBI secrets, wallet IDs, passwords,
or PINs.

Sellers belong to the merchant platform. ORBI owns payment authorization,
consent, escrow policy, wallet authority, and ledger posting.

## Run

```bash
npm install
npm run dev
```

Environment:

```env
PORT=4091
SELLER_PORTAL_BASE_URL=http://localhost:4091
ORBI_PAY_GATEWAY_BASE_URL=https://pay.orbifinancial.com
ORBI_PAY_SERVICE_KEY=service_live_or_sandbox_key
```

## Link A Seller

```http
POST /sellers/seller-001/link-orbi
content-type: application/json

{
  "displayName": "Zakaria Shop",
  "customerId": "OB26-9885-6029",
  "locale": "sw",
  "timezone": "Africa/Dar_es_Salaam"
}
```

The example calls `linkPaymentProfile` with:

```txt
idempotency-key: payment-profile:seller:<sellerId>
```

Store only the returned `paymentProfileId`, status, scopes, and merchant-side
seller ID. Never store ORBI passwords, PINs, raw wallet IDs, or challenge
answers in the merchant database.

## Security Notes

- A seller profile is durable because the seller will receive funds, escrow
  releases, settlement status, and business reporting.
- Buyers or checkout guests should not be created as durable seller profiles.
- ORBI consent is scoped and revocable. The merchant must handle revocation
  webhooks before continuing ORBI-powered seller operations.
- Use the same idempotency key when retrying after network failure.
