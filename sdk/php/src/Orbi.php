<?php

declare(strict_types=1);

namespace Orbi\PayGateway;

final class Orbi
{
    private OrbiPayGatewayClient $client;

    private function __construct(array $config)
    {
        $this->client = new OrbiPayGatewayClient($config);
    }

    public static function create(array $config): self
    {
        return new self($config);
    }

    public function transfers(): Transfers
    {
        return new Transfers($this->client);
    }

    public function payments(): Payments
    {
        return new Payments($this->client);
    }

    public function paysafe(): PaySafe
    {
        return new PaySafe($this->client);
    }

    public function identity(): Identity
    {
        return new Identity($this->client);
    }

    public function paymentProfiles(): PaymentProfiles
    {
        return new PaymentProfiles($this->client);
    }

    public function oauth(): OAuth
    {
        return new OAuth($this->client);
    }
}
