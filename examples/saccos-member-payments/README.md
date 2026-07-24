# ORBI SACCOS Member Payments Example

This example shows how a SACCOS or member organization can keep its own member
registry while using ORBI for payment profile linking, hosted authorization,
payment intents, and signed webhooks.

The SACCOS owns member records, shares, loans, dues, and business rules. ORBI
owns financial authorization, risk checks, wallet authority, ledger posting,
and webhook evidence.

## Run

```bash
npm install
npm run dev
```

Environment:

```env
PORT=4092
SACCOS_BASE_URL=http://localhost:4092
ORBI_PAY_GATEWAY_BASE_URL=https://pay.orbifinancial.com
ORBI_PAY_SERVICE_KEY=service_live_or_sandbox_key
ORBI_PAY_WEBHOOK_SECRET=webhook_secret_from_developer_portal
```

## Link A Member

```http
POST /members/member-001/link-orbi
content-type: application/json

{
  "fullName": "Catherine Daniel",
  "customerId": "OB26-0000-0001",
  "locale": "sw",
  "timezone": "Africa/Dar_es_Salaam"
}
```

The example stores `paymentProfileId` and a local member ID mapping. It does
not store ORBI passwords, PINs, challenge answers, or raw wallet IDs.

## Create A Member Payment

```http
POST /members/member-001/payments
content-type: application/json

{
  "paymentId": "DUES-2026-07",
  "amount": 25000,
  "currency": "TZS",
  "category": "dues"
}
```

The response may include a hosted challenge redirect URL. Redirect the member
there, then wait for the signed webhook before marking the SACCOS payment as
paid.

## Webhook Truth

The return URL is only customer experience. The signed webhook is the source of
truth for payment status. Verify every webhook, deduplicate by `eventId`, and
reuse the same idempotency key after network failure.

This pattern is suitable for SACCOS dues, savings deposits, loan repayments,
member fees, and similar organization payments where ORBI must remain the
financial authority.
