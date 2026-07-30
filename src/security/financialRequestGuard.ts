import crypto from 'crypto';

export type FinancialRequestReplayConfig = {
  timestampToleranceSeconds: number;
  nonceTtlSeconds: number;
  maxNonces: number;
};

export type FinancialRateLimitConfig = {
  windowMs: number;
  maxRequests: number;
  maxSubjects: number;
};

type NonceRecord = {
  expiresAt: number;
};

type RateRecord = {
  resetAt: number;
  count: number;
};

const nonceCache = new Map<string, NonceRecord>();
const rateBuckets = new Map<string, RateRecord>();

const nowMs = () => Date.now();

const pruneExpired = <T extends { expiresAt?: number; resetAt?: number }>(cache: Map<string, T>, maxEntries: number) => {
  const now = nowMs();
  for (const [key, value] of cache.entries()) {
    const expiresAt = value.expiresAt ?? value.resetAt ?? 0;
    if (expiresAt <= now) cache.delete(key);
  }

  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
};

export const assertFreshTimestamp = (
  timestampHeader: string,
  toleranceSeconds: number,
) => {
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) throw new Error('PAY_GATEWAY_SIGNATURE_TIMESTAMP_INVALID');
  if (Math.abs(Math.floor(nowMs() / 1000) - timestamp) > toleranceSeconds) {
    throw new Error('PAY_GATEWAY_SIGNATURE_TIMESTAMP_STALE');
  }
};

export const assertNonceNotReplayed = (
  subject: string,
  nonce: string,
  config: FinancialRequestReplayConfig,
) => {
  const normalizedSubject = subject.trim() || 'anonymous';
  const normalizedNonce = nonce.trim();
  if (!normalizedNonce || normalizedNonce.length < 12 || normalizedNonce.length > 120) {
    throw new Error('PAY_GATEWAY_SIGNATURE_NONCE_REQUIRED');
  }

  pruneExpired(nonceCache, config.maxNonces);
  const key = crypto
    .createHash('sha256')
    .update(`${normalizedSubject}:${normalizedNonce}`)
    .digest('hex');
  if (nonceCache.has(key)) throw new Error('PAY_GATEWAY_SIGNATURE_NONCE_REPLAYED');
  nonceCache.set(key, { expiresAt: nowMs() + config.nonceTtlSeconds * 1000 });
};

export const assertFinancialRateLimit = (
  subject: string,
  config: FinancialRateLimitConfig,
) => {
  if (config.maxRequests <= 0 || config.windowMs <= 0) return;

  pruneExpired(rateBuckets, config.maxSubjects);
  const key = crypto.createHash('sha256').update(subject.trim() || 'anonymous').digest('hex');
  const now = nowMs();
  const existing = rateBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + config.windowMs });
    return;
  }

  existing.count += 1;
  if (existing.count > config.maxRequests) throw new Error('PAY_GATEWAY_RATE_LIMITED');
};

export const __resetFinancialRequestGuardForTests = () => {
  nonceCache.clear();
  rateBuckets.clear();
};
