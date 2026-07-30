# ORBI Pay Gateway PHP SDK

Official server-side PHP SDK for ORBI Pay Gateway.

Use this SDK from trusted backend code only. Do not expose ORBI service keys in browser or mobile apps.

## Install

Status: live on Packagist.

```bash
composer require orbifinancial/pay-gateway
```

## Create a payment

```php
use Orbi\PayGateway\Orbi;

$orbi = Orbi::create([
    'baseUrl' => getenv('ORBI_PAY_GATEWAY_BASE_URL'),
    'serviceKey' => getenv('ORBI_PAY_SERVICE_KEY'),
    'authMode' => 'access_token',
    'environment' => getenv('ORBI_PAY_ENVIRONMENT') ?: 'Demo',
]);

$intent = $orbi->transfers()->send([
    'reference' => 'ORDER-10001',
    'amount' => 125000,
    'currency' => 'TZS',
    'description' => 'Protected checkout',
    'customer' => ['phone' => '+255700000000'],
    'returnUrl' => getenv('ORBI_PAY_RETURN_URL'),
    'cancelUrl' => getenv('ORBI_PAY_CANCEL_URL'),
    'callbackUrl' => getenv('ORBI_PAY_WEBHOOK_URL'),
], [
    'idempotencyKey' => 'payment-intent:merchant:ORDER-10001',
]);
```

`authMode => access_token` is recommended for new production integrations. The
SDK exchanges your server-side service key for a short-lived ORBI access token,
caches it, and signs financial requests with that token. Use
`authMode => api_key` only for controlled legacy migration.

## OAuth metadata and token control

Use SDK helpers instead of hand-building OAuth calls:

```php
$metadata = $orbi->oauth()->metadata();
echo $metadata['token_endpoint'];

$state = $orbi->oauth()->introspect($accessToken);
if (!$state['active']) {
    // Request a fresh token before making financial requests.
}

$orbi->oauth()->revoke($accessToken);
```

## Verify payment updates

```php
use Orbi\PayGateway\Webhooks;

$event = Webhooks::verifyAndParse([
    'rawBody' => file_get_contents('php://input'),
    'signatureHeader' => $_SERVER['HTTP_X_ORBI_PAY_SIGNATURE'] ?? '',
    'timestampHeader' => $_SERVER['HTTP_X_ORBI_PAY_TIMESTAMP'] ?? '',
    'secret' => getenv('ORBI_PAY_WEBHOOK_SECRET'),
]);
```
