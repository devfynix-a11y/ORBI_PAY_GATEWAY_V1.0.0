<?php

declare(strict_types=1);

namespace Orbi\PayGateway;

final class PaySafe
{
    public function __construct(private OrbiPayGatewayClient $client) {}

    public function createEscrow(array $payload, array $options = []): array
    {
        return $this->client->createPaySafeEscrow($payload, $options);
    }

    public function release(string $escrowId, array $payload, array $options = []): array
    {
        return $this->client->paySafeAction($escrowId, 'release', $payload, $options);
    }

    public function refund(string $escrowId, array $payload, array $options = []): array
    {
        return $this->client->paySafeAction($escrowId, 'refund', $payload, $options);
    }

    public function dispute(string $escrowId, array $payload, array $options = []): array
    {
        return $this->client->paySafeAction($escrowId, 'dispute', $payload, $options);
    }
}
