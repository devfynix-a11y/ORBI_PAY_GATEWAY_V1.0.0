<?php

declare(strict_types=1);

namespace Orbi\PayGateway;

final class Webhooks
{
    public static function verify(array $input): array
    {
        $signatureHeader = (string)($input['signatureHeader'] ?? '');
        $timestampHeader = (string)($input['timestampHeader'] ?? '');
        $secret = (string)($input['secret'] ?? '');
        $rawBody = (string)($input['rawBody'] ?? '');
        if ($signatureHeader === '') {
            return ['ok' => false, 'reason' => 'missing_signature'];
        }
        if ($timestampHeader === '') {
            return ['ok' => false, 'reason' => 'missing_timestamp'];
        }
        if (!is_numeric($timestampHeader)) {
            return ['ok' => false, 'reason' => 'invalid_timestamp'];
        }
        $timestamp = (int)$timestampHeader;
        $now = (int)($input['nowSeconds'] ?? time());
        $tolerance = (int)($input['toleranceSeconds'] ?? 300);
        if (abs($now - $timestamp) > $tolerance) {
            return ['ok' => false, 'reason' => 'stale_timestamp'];
        }
        $signature = trim(preg_replace('/^sha256=/i', '', $signatureHeader) ?? '');
        $expected = hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret);
        return hash_equals($expected, $signature) ? ['ok' => true] : ['ok' => false, 'reason' => 'signature_mismatch'];
    }

    public static function verifyAndParse(array $input): array
    {
        $verified = self::verify($input);
        if (!($verified['ok'] ?? false)) {
            return $verified;
        }
        $event = json_decode((string)($input['rawBody'] ?? ''), true);
        if (!is_array($event)) {
            return ['ok' => false, 'reason' => 'invalid_json'];
        }
        if (!isset($event['eventId'], $event['eventType']) || !is_string($event['eventId']) || !is_string($event['eventType'])) {
            return ['ok' => false, 'reason' => 'invalid_event'];
        }
        return ['ok' => true, 'event' => $event];
    }
}
