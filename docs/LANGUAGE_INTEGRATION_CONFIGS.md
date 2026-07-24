# ORBI Pay Gateway Language Integration Configs

This guide gives starter configuration patterns for different programming
languages. The protocol stays the same for every language:

```text
Server-side app only
-> x-orbi-pay-service-key
-> Idempotency-Key for every financial/retryable action
-> hosted challenge redirect when returned
-> signed webhook verification before mutating local state
```

Do not expose service keys or webhook secrets in browsers, mobile apps, Vite
client bundles, APKs, or public JavaScript.

## Shared Environment

Use equivalent environment variables in every stack:

```env
ORBI_PAY_GATEWAY_BASE_URL=https://sandbox-pay.orbifinancial.com
ORBI_PAY_ENVIRONMENT=Demo
ORBI_PAY_SERVICE_KEY=orbi_sandbox_service_key
ORBI_PAY_WEBHOOK_SECRET=webhook_secret_from_developer_portal
ORBI_PAY_RETURN_URL=https://merchant.example.com/orbi/return
ORBI_PAY_WEBHOOK_URL=https://merchant.example.com/api/orbi/webhooks
```

Use `https://sandbox-pay.orbifinancial.com` with `ORBI_PAY_ENVIRONMENT=Demo`
and `orbi_sandbox_...` keys for testing. Use
`https://pay.orbifinancial.com` with `ORBI_PAY_ENVIRONMENT=Production` and
`orbi_live_...` keys only after live approval.

Required request headers:

```http
content-type: application/json
accept: application/json
x-orbi-pay-service-key: <service key>
x-orbi-environment: demo|production
idempotency-key: <stable operation key>
x-request-id: <optional trace id>
x-orbi-signature: sha256=<hmac>
x-orbi-timestamp: <unix timestamp seconds>
x-orbi-nonce: <unique nonce>
```

Webhook verification uses:

```http
x-orbi-pay-signature: sha256=<hmac>
x-orbi-pay-timestamp: <unix timestamp seconds>
```

## Node.js / TypeScript

Recommended: use the official SDK.

```bash
npm install @orbi/pay-gateway
```

```ts
import {
  assertOrbiSuccess,
  OrbiPayGatewayClient,
  verifyOrbiWebhookSignature,
} from '@orbi/pay-gateway';

const orbi = new OrbiPayGatewayClient({
  baseUrl: process.env.ORBI_PAY_GATEWAY_BASE_URL!,
  serviceKey: process.env.ORBI_PAY_SERVICE_KEY!,
});

const response = await orbi.createCheckoutPaymentIntent({
  reference: 'ORDER-10001',
  amount: 125000,
  currency: 'TZS',
  paymentCategory: 'orbi',
  paymentRail: 'orbi_wallet',
  customer: { phone: '+255700000000' },
  returnUrl: process.env.ORBI_PAY_RETURN_URL!,
  callbackUrl: process.env.ORBI_PAY_WEBHOOK_URL!,
}, {
  idempotencyKey: 'payment-intent:ORDER-10001',
  requestId: 'checkout:ORDER-10001',
});

const intent = assertOrbiSuccess(response);
const action = orbi.getPaymentIntentNextAction(intent);
```

Webhook:

```ts
const verified = verifyOrbiWebhookSignature({
  rawBody,
  signatureHeader: req.header('x-orbi-pay-signature') || '',
  timestampHeader: req.header('x-orbi-pay-timestamp') || '',
  secret: process.env.ORBI_PAY_WEBHOOK_SECRET!,
});

if (!verified.ok) throw new Error(`Invalid ORBI webhook: ${verified.reason}`);
```

## PHP

Recommended HTTP clients: Guzzle, Symfony HTTP Client, or Laravel HTTP client.

```bash
composer require guzzlehttp/guzzle
```

```php
<?php

use GuzzleHttp\Client;

$client = new Client([
    'base_uri' => getenv('ORBI_PAY_GATEWAY_BASE_URL'),
    'timeout' => 20,
]);

$reference = 'ORDER-10001';
$response = $client->post('/v1/payment-intents', [
    'headers' => [
        'accept' => 'application/json',
        'content-type' => 'application/json',
        'x-orbi-pay-service-key' => getenv('ORBI_PAY_SERVICE_KEY'),
        'idempotency-key' => 'payment-intent:' . $reference,
        'x-request-id' => 'checkout:' . $reference,
    ],
    'json' => [
        'reference' => $reference,
        'amount' => 125000,
        'currency' => 'TZS',
        'paymentCategory' => 'orbi',
        'paymentRail' => 'orbi_wallet',
        'customer' => ['phone' => '+255700000000'],
        'returnUrl' => getenv('ORBI_PAY_RETURN_URL'),
        'callbackUrl' => getenv('ORBI_PAY_WEBHOOK_URL'),
        'confirm' => true,
    ],
]);

$payload = json_decode((string) $response->getBody(), true);
if (!$payload['success']) {
    throw new RuntimeException($payload['error'] . ': ' . $payload['message']);
}

$intent = $payload['data'];
if (($intent['status'] ?? null) === 'requires_action' && !empty($intent['challengeUrl'])) {
    header('Location: ' . $intent['challengeUrl'], true, 303);
    exit;
}
```

Webhook verification:

```php
<?php

$rawBody = file_get_contents('php://input');
$timestamp = $_SERVER['HTTP_X_ORBI_PAY_TIMESTAMP'] ?? '';
$signature = $_SERVER['HTTP_X_ORBI_PAY_SIGNATURE'] ?? '';
$secret = getenv('ORBI_PAY_WEBHOOK_SECRET');

$expected = 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret);

if (!hash_equals($expected, $signature)) {
    http_response_code(401);
    echo json_encode(['error' => 'WEBHOOK_SIGNATURE_INVALID']);
    exit;
}
```

## Python

Recommended HTTP clients: `httpx` or `requests`. Use `httpx` for async-ready
services.

```bash
pip install httpx
```

```py
import os
import httpx

reference = "ORDER-10001"

response = httpx.post(
    f"{os.environ['ORBI_PAY_GATEWAY_BASE_URL']}/v1/payment-intents",
    headers={
        "accept": "application/json",
        "content-type": "application/json",
        "x-orbi-pay-service-key": os.environ["ORBI_PAY_SERVICE_KEY"],
        "idempotency-key": f"payment-intent:{reference}",
        "x-request-id": f"checkout:{reference}",
    },
    json={
        "reference": reference,
        "amount": 125000,
        "currency": "TZS",
        "paymentCategory": "orbi",
        "paymentRail": "orbi_wallet",
        "customer": {"phone": "+255700000000"},
        "returnUrl": os.environ["ORBI_PAY_RETURN_URL"],
        "callbackUrl": os.environ["ORBI_PAY_WEBHOOK_URL"],
        "confirm": True,
    },
    timeout=20,
)
payload = response.json()
if not payload.get("success"):
    raise RuntimeError(f"{payload.get('error')}: {payload.get('message')}")

intent = payload["data"]
challenge_url = intent.get("challengeUrl")
```

Webhook verification:

```py
import hmac
import hashlib
import os

def verify_orbi_webhook(raw_body: bytes, signature: str, timestamp: str) -> bool:
    secret = os.environ["ORBI_PAY_WEBHOOK_SECRET"].encode("utf-8")
    signed_payload = timestamp.encode("utf-8") + b"." + raw_body
    expected = "sha256=" + hmac.new(secret, signed_payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

## Laravel

Use Laravel's HTTP client server-side:

```php
$reference = 'ORDER-10001';

$response = Http::withHeaders([
    'x-orbi-pay-service-key' => config('services.orbi_pay.service_key'),
    'idempotency-key' => 'payment-intent:' . $reference,
    'x-request-id' => 'checkout:' . $reference,
])->post(config('services.orbi_pay.base_url') . '/v1/payment-intents', [
    'reference' => $reference,
    'amount' => 125000,
    'currency' => 'TZS',
    'paymentCategory' => 'orbi',
    'paymentRail' => 'orbi_wallet',
    'customer' => ['phone' => '+255700000000'],
    'returnUrl' => route('orbi.return'),
    'callbackUrl' => route('orbi.webhook'),
    'confirm' => true,
]);
```

Recommended `config/services.php`:

```php
'orbi_pay' => [
    'base_url' => env('ORBI_PAY_GATEWAY_BASE_URL'),
    'service_key' => env('ORBI_PAY_SERVICE_KEY'),
    'webhook_secret' => env('ORBI_PAY_WEBHOOK_SECRET'),
],
```

## Django / FastAPI

Use the Python pattern above. Store ORBI settings in environment variables or
your secret manager, not in source code.

FastAPI webhook route rule:

```py
raw_body = await request.body()
signature = request.headers.get("x-orbi-pay-signature", "")
timestamp = request.headers.get("x-orbi-pay-timestamp", "")
```

Verify the raw body before parsing JSON or mutating payment/order state.

## cURL Smoke Test

```bash
curl -X POST "$ORBI_PAY_GATEWAY_BASE_URL/v1/payment-intents" \
  -H "accept: application/json" \
  -H "content-type: application/json" \
  -H "x-orbi-pay-service-key: $ORBI_PAY_SERVICE_KEY" \
  -H "idempotency-key: payment-intent:ORDER-10001" \
  -H "x-request-id: checkout:ORDER-10001" \
  -d '{
    "reference": "ORDER-10001",
    "amount": 125000,
    "currency": "TZS",
    "paymentCategory": "orbi",
    "paymentRail": "orbi_wallet",
    "customer": { "phone": "+255700000000" },
    "returnUrl": "https://merchant.example.com/orbi/return",
    "callbackUrl": "https://merchant.example.com/api/orbi/webhooks",
    "confirm": true
  }'
```

## Safety Checklist For Every Language

- Keep service keys and webhook secrets server-side only.
- Use `Idempotency-Key` on every financial action.
- Reuse the same idempotency key after timeout or network retry.
- Redirect to `challengeUrl` when status is `requires_action`.
- Treat return URL as customer UX only.
- Verify signed webhooks before updating local orders, sellers, members, or
  settlement records.
- Deduplicate webhook events by `eventId`.
- Never store ORBI PIN, OTP, password, challenge answer, or raw wallet authority
  fields in the external platform.
