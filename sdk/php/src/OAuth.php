<?php

declare(strict_types=1);

namespace Orbi\PayGateway;

final class OAuth
{
    public function __construct(private OrbiPayGatewayClient $client)
    {
    }

    public function metadata(): array
    {
        return $this->client->getOAuthMetadata();
    }

    public function introspect(string $token): array
    {
        return $this->client->introspectAccessToken($token);
    }

    public function revoke(string $token): array
    {
        return $this->client->revokeAccessToken($token);
    }
}
