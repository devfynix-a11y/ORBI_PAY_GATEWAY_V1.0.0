# ORBI Pay Gateway PHP SDK

Official server-side PHP SDK for ORBI Pay Gateway.

Use this SDK from trusted backend code only. Do not expose ORBI service keys in browser or mobile apps.

## Install

Status: source package is ready for Packagist. Use this install command after
the package is published to Packagist.

```bash
composer require orbifinancial/pay-gateway
```

## Create a payment

```php
use Orbi\PayGateway\Orbi;

$orbi = Orbi::create([
    'baseUrl' => getenv('ORBI_PAY_GATEWAY_BASE_URL'),
    'serviceKey' => getenv('ORBI_PAY_SERVICE_KEY'),
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
