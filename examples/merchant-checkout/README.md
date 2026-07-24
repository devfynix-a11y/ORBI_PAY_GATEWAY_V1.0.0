# ORBI Merchant Checkout Example

Minimal Express checkout integration using `@orbi/pay-gateway`.

It demonstrates:

```text
Create checkout payment intent
Use stable idempotency key
Redirect to hosted challenge
Receive signed webhook
Dedupe webhook events
Treat return URL as UX only
Treat webhook as payment truth
Replay-compatible order state
```

## Setup

```bash
cd examples/merchant-checkout
npm install
```

Environment:

```env
PORT=4090
MERCHANT_BASE_URL=http://localhost:4090
ORBI_PAY_GATEWAY_BASE_URL=https://pay.orbifinancial.com
ORBI_PAY_SERVICE_KEY=orbi_sandbox_replace_me
ORBI_PAY_WEBHOOK_SECRET=orbi_whsec_sandbox_replace_me
```

Run:

```bash
npm run dev
```

## Create Checkout

```bash
curl -X POST http://localhost:4090/checkout \
  -H "Content-Type: application/json" \
  -d "{\"orderId\":\"ORDER-10001\",\"amount\":125000,\"currency\":\"TZS\",\"customerPhone\":\"+255700000000\"}"
```

If ORBI returns `redirectTo`, open it in the browser. The customer completes the
hosted challenge on ORBI Pay Gateway.

## Return URL Is Not Payment Truth

```text
GET /orbi/return?orderId=ORDER-10001
```

This page is only customer UX continuation. Fulfil orders only after signed
webhook confirmation or a trusted payment intent read.

## Webhook Receiver

```text
POST /webhooks/orbi
```

Required headers:

```text
x-orbi-pay-signature
x-orbi-pay-timestamp
```

The example verifies the signature, dedupes by `eventId`, and updates order
status from `payment_intent.updated`.

## Inspect Order

```bash
curl http://localhost:4090/orders/ORDER-10001
```

## Safety Notes

```text
Never expose ORBI service keys in browsers or mobile apps.
Reuse the same idempotency key after network failure.
Do not fulfil from return URL alone.
Verify every webhook before mutating order state.
Dedupe webhook events.
```
