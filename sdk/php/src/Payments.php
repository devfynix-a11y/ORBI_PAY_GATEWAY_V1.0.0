<?php

declare(strict_types=1);

namespace Orbi\PayGateway;

final class Payments
{
    public function __construct(private OrbiPayGatewayClient $client) {}

    public function createIntent(array $payload, array $options = []): array
    {
        return $this->client->createPaymentIntent($payload, $options);
    }

    public function checkout(array $payload, array $options = []): array
    {
        return $this->client->createCheckoutPaymentIntent($payload, $options);
    }

    public function getIntent(string $intentId): array
    {
        return $this->client->getPaymentIntent($intentId);
    }

    public function nextAction(array $intent): array
    {
        return $this->client->nextAction($intent);
    }
}
