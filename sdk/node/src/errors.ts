import type { OrbiApiResponse, OrbiErrorInfo } from './types.js';

export const classifyOrbiErrorCode = (code: string): OrbiErrorInfo => {
  const normalized = String(code || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';

  if (normalized.includes('AUTH_FAILED') || normalized.includes('CREDENTIAL') || normalized.includes('SERVICE_KEY')) {
    return info(normalized, 'authentication', false, 'stop', 'Authentication failed. Check ORBI credentials.');
  }
  if (normalized.includes('SCOPE_NOT_GRANTED') || normalized.includes('OPERATION_NOT_ALLOWED') || normalized.includes('ACCESS_DENIED')) {
    return info(normalized, 'authorization', false, 'request_scope_or_consent', 'Required service permission is not granted.');
  }
  if (normalized.includes('CONSENT')) {
    return info(normalized, 'consent', false, 'request_scope_or_consent', 'Fresh customer consent is required.');
  }
  if (normalized.includes('IDEMPOTENCY_MISMATCH')) {
    return info(normalized, 'idempotency', false, 'stop', 'The idempotency key was reused with a different payload.');
  }
  if (normalized.includes('INVALID') || normalized.includes('VALIDATION') || normalized.includes('REQUIRED')) {
    return info(normalized, 'validation', false, 'show_customer_failure', 'The request payload is invalid.');
  }
  if (normalized.includes('NOT_FOUND')) {
    return info(normalized, 'not_found', false, 'refresh_and_retry', 'The requested ORBI resource was not found.');
  }
  if (normalized.includes('CONFLICT') || normalized.includes('ALREADY_FINALIZED')) {
    return info(normalized, 'conflict', false, 'refresh_and_retry', 'The resource state changed. Refresh the latest state.');
  }
  if (normalized.includes('CHALLENGE') || normalized.includes('STRONG_CUSTOMER_AUTH')) {
    return info(normalized, 'challenge', true, 'redirect_to_hosted_challenge', 'Customer authorization is required.');
  }
  if (normalized.includes('WEBHOOK')) {
    return info(normalized, 'webhook', true, 'verify_webhook_configuration', 'Webhook delivery or verification needs attention.');
  }
  if (normalized.includes('TIMEOUT') || normalized.includes('UNAVAILABLE') || normalized.includes('FAILED')) {
    return info(normalized, 'service_unavailable', true, 'retry_same_idempotency_key', 'The operation may be retried safely with the same idempotency key.');
  }

  return info(normalized, 'unknown', false, 'contact_orbi_operations', 'Unhandled ORBI gateway error.');
};

export const errorInfoFromResponse = (response: OrbiApiResponse<unknown>): OrbiErrorInfo | null => {
  if (response.success) return null;
  return classifyOrbiErrorCode(response.error);
};

export const assertOrbiSuccess = <T>(response: OrbiApiResponse<T>): T => {
  if (response.success) return response.data;
  const details = classifyOrbiErrorCode(response.error);
  throw new Error(`${details.code}:${details.action}:${response.message || details.message}`);
};

const info = (
  code: string,
  category: OrbiErrorInfo['category'],
  retryable: boolean,
  action: OrbiErrorInfo['action'],
  message: string,
): OrbiErrorInfo => ({
  code,
  category,
  retryable,
  action,
  message,
});
