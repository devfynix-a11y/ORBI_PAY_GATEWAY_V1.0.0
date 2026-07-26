# ORBI Pay Gateway Language Integration Configs

Use official ORBI SDK methods from trusted server code. Developers should not
hand-build financial requests unless they are building a certified SDK or doing
operator diagnostics.

```text
Merchant/SACCOS/Platform server
-> ORBI SDK
-> Demo or Production environment
-> stable idempotency key
-> hosted challenge redirect when required
-> signed webhook verification before updating local records
```

Never expose service keys, signing secrets, webhook secrets, OTP, PIN, wallet
authority fields, or challenge answers in browser JavaScript, mobile apps,
Vite bundles, APKs, or public client code.

## Shared Environment

Use equivalent environment variables in every stack:

```env
ORBI_PAY_GATEWAY_BASE_URL=https://sandbox-pay.orbifinancial.com
ORBI_PAY_ENVIRONMENT=Demo
ORBI_PAY_SERVICE_KEY=orbi_sandbox_service_key
ORBI_PAY_SIGNING_SECRET=orbi_sandbox_signing_secret
ORBI_PAY_WEBHOOK_SECRET=orbi_whsec_sandbox
ORBI_PAY_RETURN_URL=https://merchant.example.com/orbi/return
ORBI_PAY_CANCEL_URL=https://merchant.example.com/orbi/cancel
ORBI_PAY_WEBHOOK_URL=https://merchant.example.com/api/orbi/webhooks
```

Use `https://sandbox-pay.orbifinancial.com` with `Demo` keys for testing. Use
`https://pay.orbifinancial.com` with `Production` keys only after live approval.

## Node.js / Express

Install:

```bash
npm i @orbifinancial/pay-gateway express
```

Create one server-side client:

```ts
import { createOrbi } from '@orbifinancial/pay-gateway';

export const orbi = createOrbi({
  baseUrl: process.env.ORBI_PAY_GATEWAY_BASE_URL,
  serviceKey: process.env.ORBI_PAY_SERVICE_KEY,
  signingSecret: process.env.ORBI_PAY_SIGNING_SECRET,
  environment: process.env.ORBI_PAY_ENVIRONMENT,
});
```

Create a checkout payment:

```ts
app.post('/checkout/orbi', async (req, res) => {
  const intent = await orbi.transfers.send({
    reference: req.body.orderId,
    amount: req.body.amount,
    currency: 'TZS',
    description: 'Protected checkout',
    customer: { phone: req.body.phone },
    returnUrl: process.env.ORBI_PAY_RETURN_URL,
    cancelUrl: process.env.ORBI_PAY_CANCEL_URL,
    callbackUrl: process.env.ORBI_PAY_WEBHOOK_URL,
  }, {
    idempotencyKey: `payment-intent:${req.body.orderId}`,
  });

  const action = orbi.getPaymentIntentNextAction(intent);
  if (action.type === 'redirect_to_hosted_challenge') {
    return res.redirect(303, action.url);
  }

  res.json(intent);
});
```

Verify webhooks before updating orders:

```ts
app.post('/api/orbi/webhooks', express.raw({ type: 'application/json' }), async (req, res) => {
  const event = orbi.webhooks.parse({
    rawBody: req.body,
    signatureHeader: req.header('x-orbi-pay-signature') || '',
    timestampHeader: req.header('x-orbi-pay-timestamp') || '',
    secret: process.env.ORBI_PAY_WEBHOOK_SECRET,
  });

  await updateOrderFromOrbiEvent(event);
  res.sendStatus(200);
});
```

## Python

Install:

```bash
pip install orbi-pay-gateway
```

Create payment:

```py
import os
from orbi_pay_gateway import Orbi

orbi = Orbi(
    base_url=os.environ["ORBI_PAY_GATEWAY_BASE_URL"],
    service_key=os.environ["ORBI_PAY_SERVICE_KEY"],
    signing_secret=os.environ.get("ORBI_PAY_SIGNING_SECRET"),
    environment=os.environ.get("ORBI_PAY_ENVIRONMENT", "Demo"),
)

intent = orbi.transfers.send({
    "reference": order.id,
    "amount": order.amount,
    "currency": "TZS",
    "description": "Protected checkout",
    "customer": {"phone": customer.phone},
    "returnUrl": os.environ["ORBI_PAY_RETURN_URL"],
    "cancelUrl": os.environ["ORBI_PAY_CANCEL_URL"],
    "callbackUrl": os.environ["ORBI_PAY_WEBHOOK_URL"],
}, idempotency_key=f"payment-intent:{order.id}")

action = orbi.payments.next_action(intent)
```

Verify webhook:

```py
from orbi_pay_gateway import verify_and_parse_webhook

event = verify_and_parse_webhook(
    raw_body=request.data,
    signature_header=request.headers.get("x-orbi-pay-signature", ""),
    timestamp_header=request.headers.get("x-orbi-pay-timestamp", ""),
    secret=os.environ["ORBI_PAY_WEBHOOK_SECRET"],
)

update_order_from_orbi_event(event["event"])
```

## PHP / Laravel

Install:

```bash
composer require orbifinancial/pay-gateway
```

Create payment:

```php
use Orbi\PayGateway\Orbi;

$orbi = Orbi::create([
    'baseUrl' => env('ORBI_PAY_GATEWAY_BASE_URL'),
    'serviceKey' => env('ORBI_PAY_SERVICE_KEY'),
    'signingSecret' => env('ORBI_PAY_SIGNING_SECRET'),
    'environment' => env('ORBI_PAY_ENVIRONMENT', 'Demo'),
]);

$intent = $orbi->transfers()->send([
    'reference' => $order->id,
    'amount' => $order->amount,
    'currency' => 'TZS',
    'description' => 'Protected checkout',
    'customer' => ['phone' => $customer->phone],
    'returnUrl' => env('ORBI_PAY_RETURN_URL'),
    'cancelUrl' => env('ORBI_PAY_CANCEL_URL'),
    'callbackUrl' => env('ORBI_PAY_WEBHOOK_URL'),
], [
    'idempotencyKey' => 'payment-intent:' . $order->id,
]);
```

Verify webhook:

```php
use Orbi\PayGateway\Webhooks;

$event = Webhooks::verifyAndParse(
    $request->getContent(),
    $request->header('x-orbi-pay-signature', ''),
    $request->header('x-orbi-pay-timestamp', ''),
    env('ORBI_PAY_WEBHOOK_SECRET')
);

updateOrderFromOrbiEvent($event);
```

## Django / FastAPI

Use the Python SDK from your backend service. For FastAPI webhooks, read the raw
body before parsing JSON:

```py
raw_body = await request.body()
event = verify_and_parse_webhook(
    raw_body=raw_body,
    signature_header=request.headers.get("x-orbi-pay-signature", ""),
    timestamp_header=request.headers.get("x-orbi-pay-timestamp", ""),
    secret=os.environ["ORBI_PAY_WEBHOOK_SECRET"],
)
```

## cURL Smoke Test

Use cURL only for connectivity checks from a secure machine. Production systems
should use the SDK so HMAC, idempotency, request IDs, and webhook verification
stay consistent.

```bash
curl -X POST "$ORBI_PAY_GATEWAY_BASE_URL/v1/payment-intents" \
  -H "accept: application/json" \
  -H "content-type: application/json" \
  -H "x-orbi-pay-service-key: $ORBI_PAY_SERVICE_KEY" \
  -H "x-orbi-environment: demo" \
  -H "idempotency-key: payment-intent:ORDER-10001" \
  -d '{
    "reference": "ORDER-10001",
    "amount": 125000,
    "currency": "TZS",
    "customer": { "phone": "+255700000000" },
    "returnUrl": "https://merchant.example.com/orbi/return",
    "cancelUrl": "https://merchant.example.com/orbi/cancel",
    "callbackUrl": "https://merchant.example.com/api/orbi/webhooks"
  }'
```

## Safety Checklist

- Keep ORBI keys and webhook secrets server-side only.
- Use one stable idempotency key for every financial action.
- Reuse the same idempotency key after timeout or network retry.
- Redirect to `challengeUrl` when ORBI returns hosted challenge.
- Treat return URL as customer UX only.
- Verify signed webhooks before updating orders, sellers, members, or balances.
- Deduplicate webhook events by `eventId`.
- Never store ORBI PIN, OTP, password, challenge answer, or wallet authority
  fields in external platforms.
