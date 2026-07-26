<?php

declare(strict_types=1);

namespace Orbi\PayGateway;

final class Transfers
{
    public function __construct(private OrbiPayGatewayClient $client) {}

    public function send(array $payload, array $options = []): array
    {
        $payload['operation'] = 'collection';
        $payload['paymentCategory'] = $payload['paymentCategory'] ?? 'orbi';
        $payload['paymentRail'] = $payload['paymentRail'] ?? 'orbi_wallet';
        return $this->client->createPaymentIntent($payload, $options);
    }
}
