<?php

declare(strict_types=1);

namespace Orbi\PayGateway;

use RuntimeException;

final class OrbiPayGatewayClient
{
    private string $baseUrl;
    private string $serviceKey;
    private ?string $operatorKey;
    private ?string $environment;
    private string $authMode;
    /** @var string[] */
    private array $accessTokenScopes;
    private int $accessTokenRefreshSkewSeconds;
    private bool $requestSigning;
    private ?string $requestSigningSecret;
    private ?string $accessToken = null;
    private float $accessTokenExpiresAt = 0.0;
    private string $accessTokenScope = '';

    public function __construct(array $config)
    {
        $this->baseUrl = rtrim((string)($config['baseUrl'] ?? ''), '/');
        $this->serviceKey = (string)($config['serviceKey'] ?? '');
        $this->operatorKey = isset($config['operatorKey']) ? (string)$config['operatorKey'] : null;
        $this->environment = isset($config['environment']) ? (string)$config['environment'] : null;
        $this->authMode = (string)($config['authMode'] ?? 'api_key');
        $this->accessTokenScopes = array_values(array_filter(array_map('strval', $config['accessTokenScopes'] ?? [])));
        $this->accessTokenRefreshSkewSeconds = max(5, (int)($config['accessTokenRefreshSkewSeconds'] ?? 60));
        $this->requestSigning = $config['requestSigning'] ?? true;
        $this->requestSigningSecret = isset($config['requestSigningSecret']) ? (string)$config['requestSigningSecret'] : null;
        if ($this->baseUrl === '') {
            throw new RuntimeException('ORBI_PAY_GATEWAY_BASE_URL_REQUIRED');
        }
        if ($this->serviceKey === '' && !$this->operatorKey) {
            throw new RuntimeException('ORBI_PAY_GATEWAY_CREDENTIAL_REQUIRED');
        }
    }

    public function createPaymentIntent(array $payload, array $options = []): array
    {
        return $this->request('POST', '/v1/payment-intents', $payload, $options);
    }

    public function createCheckoutPaymentIntent(array $payload, array $options = []): array
    {
        $payload['confirm'] = $payload['confirm'] ?? true;
        return $this->createPaymentIntent($payload, $options);
    }

    public function getPaymentIntent(string $intentId): array
    {
        return $this->request('GET', '/v1/payment-intents/' . rawurlencode($intentId));
    }

    public function nextAction(array $intent): array
    {
        $status = $intent['status'] ?? null;
        if ($status === 'completed') {
            return ['type' => 'complete', 'intent' => $intent];
        }
        if ($status === 'failed' || $status === 'cancelled') {
            return ['type' => 'failed', 'intent' => $intent];
        }
        if ($status === 'requires_action' && ($intent['challengeMode'] ?? null) === 'hosted' && !empty($intent['challengeUrl'])) {
            return ['type' => 'redirect_to_hosted_challenge', 'url' => $intent['challengeUrl'], 'intent' => $intent];
        }
        if ($status === 'requires_action' && ($intent['challengeMode'] ?? null) === 'in_app_required') {
            return ['type' => 'open_in_app_challenge', 'intent' => $intent];
        }
        return ['type' => 'wait_for_payment_update', 'intent' => $intent];
    }

    public function createPaySafeEscrow(array $payload, array $options = []): array
    {
        return $this->request('POST', '/v1/paysafe/escrows', $payload, $options);
    }

    public function paySafeAction(string $escrowId, string $action, array $payload, array $options = []): array
    {
        return $this->request('POST', '/v1/paysafe/escrows/' . rawurlencode($escrowId) . '/' . $action, $payload, $options);
    }

    public function resolveIdentity(array $payload, array $options = []): array
    {
        return $this->request('POST', '/v1/identity/resolve', $payload, $options);
    }

    public function createBusinessRegistration(array $payload, array $options = []): array
    {
        return $this->request('POST', '/v1/business/registrations', $payload, $options);
    }

    public function linkPaymentProfile(array $payload, array $options = []): array
    {
        if (empty($options['idempotencyKey']) && !empty($payload['externalCustomerId'])) {
            $options['idempotencyKey'] = 'payment-profile:' . $payload['externalCustomerId'];
        }
        return $this->request('POST', '/v1/payment-profiles', $payload, $options);
    }

    private function request(string $method, string $path, array $payload = [], array $options = []): array
    {
        if ($this->serviceKey === '') {
            throw new RuntimeException('ORBI_PAY_GATEWAY_SERVICE_KEY_REQUIRED');
        }
        $body = $method === 'GET' ? '' : json_encode($payload, JSON_UNESCAPED_SLASHES);
        [$authHeaders, $signingSecret] = $this->serviceAuthorization();
        $headers = [
            'accept: application/json',
            ...$authHeaders,
        ];
        $environment = self::normalizeEnvironment($options['environment'] ?? $this->environment);
        if ($environment) {
            $headers[] = 'x-orbi-environment: ' . $environment;
        }
        if (!empty($options['idempotencyKey'])) {
            $headers[] = 'idempotency-key: ' . $options['idempotencyKey'];
        }
        if (!empty($options['requestId'])) {
            $headers[] = 'x-request-id: ' . $options['requestId'];
        }
        if ($method !== 'GET') {
            $headers[] = 'content-type: application/json';
        }
        if ($this->requestSigning && $method !== 'GET') {
            foreach (self::signRequest($method, $path, $body ?: '', $this->requestSigningSecret ?: $signingSecret) as $key => $value) {
                $headers[] = $key . ': ' . $value;
            }
        }

        [$status, $decoded] = $this->sendHttpRequest($method, $path, $headers, $body ?: '');
        if ($status >= 400 && empty($decoded)) {
            throw new RuntimeException('ORBI_PAY_GATEWAY_HTTP_' . $status);
        }
        return $decoded;
    }

    /**
     * @return array{0: string[], 1: string}
     */
    private function serviceAuthorization(): array
    {
        if ($this->authMode === 'api_key') {
            return [['x-orbi-pay-service-key: ' . $this->serviceKey], $this->serviceKey];
        }
        if ($this->authMode !== 'access_token') {
            throw new RuntimeException('ORBI_PAY_GATEWAY_AUTH_MODE_INVALID');
        }
        $token = $this->getServiceAccessToken();
        return [['authorization: Bearer ' . $token], $token];
    }

    private function getServiceAccessToken(): string
    {
        $scope = implode(' ', $this->accessTokenScopes);
        if (
            $this->accessToken &&
            $this->accessTokenScope === $scope &&
            $this->accessTokenExpiresAt - $this->accessTokenRefreshSkewSeconds > microtime(true)
        ) {
            return $this->accessToken;
        }
        $body = json_encode(array_filter([
            'grant_type' => 'client_credentials',
            'client_secret' => $this->serviceKey,
            'scope' => $scope ?: null,
        ], static fn($value) => $value !== null), JSON_UNESCAPED_SLASHES);
        $headers = [
            'accept: application/json',
            'content-type: application/json',
        ];
        [$status, $response] = $this->sendHttpRequest('POST', '/oauth/token', $headers, $body ?: '{}');
        if ($status >= 400 || empty($response['access_token'])) {
            throw new RuntimeException((string)($response['error'] ?? ('ORBI_PAY_GATEWAY_TOKEN_HTTP_' . $status)));
        }
        $this->accessToken = (string)$response['access_token'];
        $this->accessTokenScope = $scope;
        $this->accessTokenExpiresAt = microtime(true) + (int)($response['expires_in'] ?? 900);
        return $this->accessToken;
    }

    /**
     * @return array{0: int, 1: array<string, mixed>}
     */
    private function sendHttpRequest(string $method, string $path, array $headers, ?string $body): array
    {
        $ch = curl_init($this->baseUrl . $path);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 30,
        ]);
        if ($method !== 'GET') {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $response = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        if ($response === false) {
            $error = curl_error($ch);
            curl_close($ch);
            throw new RuntimeException($error);
        }
        curl_close($ch);
        $decoded = $response !== '' ? json_decode((string)$response, true) : [];
        if (!is_array($decoded)) {
            throw new RuntimeException('ORBI_PAY_GATEWAY_INVALID_JSON_RESPONSE');
        }
        return [$status, $decoded];
    }

    private static function normalizeEnvironment(?string $environment): ?string
    {
        if (!$environment) {
            return null;
        }
        $normalized = strtolower(trim($environment));
        if ($normalized === 'demo') {
            return 'demo';
        }
        if ($normalized === 'production') {
            return 'production';
        }
        throw new RuntimeException('ORBI_PAY_GATEWAY_ENVIRONMENT_INVALID');
    }

    private static function signRequest(string $method, string $path, string $body, string $secret): array
    {
        $timestamp = (string)time();
        $nonce = self::uuidV4();
        $bodyHash = hash('sha256', $body);
        $canonical = implode('.', [$timestamp, $nonce, strtoupper($method), $path, $bodyHash]);
        return [
            'x-orbi-timestamp' => $timestamp,
            'x-orbi-nonce' => $nonce,
            'x-orbi-signature' => 'sha256=' . hash_hmac('sha256', $canonical, $secret),
        ];
    }

    private static function uuidV4(): string
    {
        $data = random_bytes(16);
        $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
        $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }
}
