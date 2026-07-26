<?php

declare(strict_types=1);

namespace Orbi\PayGateway;

final class PaymentProfiles
{
    public function __construct(private OrbiPayGatewayClient $client) {}

    public function link(array $payload, array $options = []): array
    {
        return $this->client->linkPaymentProfile($payload, $options);
    }
}
