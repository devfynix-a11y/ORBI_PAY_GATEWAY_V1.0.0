<?php

declare(strict_types=1);

namespace Orbi\PayGateway;

final class Identity
{
    public function __construct(private OrbiPayGatewayClient $client) {}

    public function resolve(array $payload, array $options = []): array
    {
        return $this->client->resolveIdentity($payload, $options);
    }

    public function registerBusiness(array $payload, array $options = []): array
    {
        return $this->client->createBusinessRegistration($payload, $options);
    }
}
