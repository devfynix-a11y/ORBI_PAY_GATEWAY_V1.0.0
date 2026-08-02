import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const envArg = process.argv.find((arg) => arg.startsWith('--env-file='));
const envFile = envArg ? envArg.slice('--env-file='.length) : process.env.PAYMENT_GATEWAY_ENV_FILE || '';
const mtlsHostDirArg = process.argv.find((arg) => arg.startsWith('--mtls-host-dir='));
const mtlsHostDir = mtlsHostDirArg
  ? mtlsHostDirArg.slice('--mtls-host-dir='.length)
  : process.env.PAYMENT_GATEWAY_MTLS_HOST_DIRECTORY || process.env.ORBI_PAY_GATEWAY_MTLS_CERT_DIRECTORY || '';

if (envFile) {
  dotenv.config({ path: envFile });
}

const boolFromEnv = (name, fallback = false) => {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const hasValue = (name) => Boolean(String(process.env[name] || '').trim());

const resolveRuntimePathForHost = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (mtlsHostDir && trimmed.startsWith('/opt/orbi/mtls/')) {
    return path.join(mtlsHostDir, trimmed.replace('/opt/orbi/mtls/', ''));
  }
  return trimmed;
};

const fileExists = (name) => {
  const value = String(process.env[name] || '').trim();
  if (!value) return false;
  return fs.existsSync(path.resolve(resolveRuntimePathForHost(value)));
};

const control = (id, status, evidence, nextAction) => ({
  id,
  status,
  evidence,
  ...(nextAction ? { nextAction } : {}),
});

const mtlsEnabled = boolFromEnv('PAYMENT_GATEWAY_INTERNAL_MTLS_ENABLED');
const mtlsFilesReady = [
  'PAYMENT_GATEWAY_INTERNAL_MTLS_CERT_PATH',
  'PAYMENT_GATEWAY_INTERNAL_MTLS_KEY_PATH',
  'PAYMENT_GATEWAY_INTERNAL_MTLS_CA_PATH',
].every(fileExists);
const coreBaseUrl = String(process.env.ORBI_CORE_INTERNAL_BASE_URL || '');
const allowPrivateHttpCore = boolFromEnv('PAYMENT_GATEWAY_ALLOW_PRIVATE_HTTP_CORE');
const internalTransportMode = String(
  process.env.PAYMENT_GATEWAY_INTERNAL_CORE_TRANSPORT_MODE ||
    (mtlsEnabled ? 'mtls' : allowPrivateHttpCore ? 'private_http' : 'public_https'),
).trim().toLowerCase();
const coreHost = (() => {
  try {
    return new URL(coreBaseUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
})();
const privateHttpCoreTarget =
  coreBaseUrl.startsWith('http://') &&
  (
    ['core', 'core-sandbox', 'localhost', '127.0.0.1', '::1'].includes(coreHost) ||
    /^10\./.test(coreHost) ||
    /^192\.168\./.test(coreHost) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(coreHost)
  );
const hmacWorkerSigningConfigured = hasValue('WORKER_SIGNING_SECRET') || hasValue('WORKER_SECRET');
const transportReady =
  internalTransportMode === 'mtls'
    ? mtlsEnabled && mtlsFilesReady && coreBaseUrl.startsWith('https://') && hmacWorkerSigningConfigured
    : internalTransportMode === 'private_http'
      ? allowPrivateHttpCore && privateHttpCoreTarget && hmacWorkerSigningConfigured
      : coreBaseUrl.startsWith('https://') && hmacWorkerSigningConfigured;

const controls = [
  control(
    'transport.internal_core',
    transportReady ? 'pass' : 'attention',
    {
      mode: internalTransportMode,
      mtlsEnabled,
      certFilesReady: mtlsFilesReady,
      coreTargetUsesHttps: coreBaseUrl.startsWith('https://'),
      privateHttpCoreTarget,
      hmacWorkerSigningConfigured,
    },
    'Use private_http only for Docker/private Core targets with HMAC; cut over to mTLS during a coordinated maintenance window.',
  ),
  control(
    'auth.service_access_tokens',
    hasValue('PAYMENT_GATEWAY_SERVICE_ACCESS_TOKEN_SECRET') ? 'pass' : 'fail',
    {
      serviceAccessTokenSecretConfigured: hasValue('PAYMENT_GATEWAY_SERVICE_ACCESS_TOKEN_SECRET'),
      operatorDiscoveryKeyConfigured: hasValue('PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY'),
      persistentRevocationConfigured:
        hasValue('PAYMENT_GATEWAY_SERVICE_ACCESS_TOKEN_SECRET') && hasValue('DATABASE_URL'),
    },
    'Configure service access token secret, keep runtime tokens short-lived, and persist revocations in the Gateway database.',
  ),
  control(
    'secrets.encryption',
    hasValue('ORBI_SECRET_ENCRYPTION_KEY') ? 'pass' : 'fail',
    {
      encryptedSecretStorageConfigured: hasValue('ORBI_SECRET_ENCRYPTION_KEY'),
      databaseConfigured: hasValue('DATABASE_URL'),
      directCredentialModeDisabled: String(process.env.PAYMENT_GATEWAY_CREDENTIAL_MODE || '').toLowerCase() !== 'direct',
    },
    'Keep live secrets encrypted at rest and remove direct credential fallbacks from live.',
  ),
  control(
    'browser.origin_governance',
    hasValue('PAYMENT_GATEWAY_ALLOWED_BROWSER_ORIGINS') ? 'pass' : 'fail',
    {
      browserOriginsConfigured: hasValue('PAYMENT_GATEWAY_ALLOWED_BROWSER_ORIGINS'),
      requestAuditEnabled: boolFromEnv('PAYMENT_GATEWAY_REQUEST_AUDIT_ENABLED', true),
    },
    'Register browser origins per service and verify live domains before live access.',
  ),
  control(
    'portal.control_plane',
    hasValue('PAYMENT_GATEWAY_PORTAL_AUTH_SECRET') ? 'pass' : 'fail',
    {
      portalAuthConfigured: hasValue('PAYMENT_GATEWAY_PORTAL_AUTH_SECRET'),
      operatorMfaRequired: boolFromEnv('PAYMENT_GATEWAY_PORTAL_OPERATOR_MFA_REQUIRED', true),
      databaseConfigured: hasValue('DATABASE_URL'),
    },
    'Keep portal backend-driven, MFA-protected for operators, and database-backed.',
  ),
  control(
    'oauth.token_authority',
    hasValue('PAYMENT_GATEWAY_OAUTH_ISSUER_URL') &&
      hasValue('PAYMENT_GATEWAY_OAUTH_INTROSPECTION_URL')
      ? 'pass'
      : 'attention',
    {
      issuerConfigured: hasValue('PAYMENT_GATEWAY_OAUTH_ISSUER_URL'),
      jwksConfigured: hasValue('PAYMENT_GATEWAY_OAUTH_JWKS_URL'),
      tokenIntrospectionConfigured: hasValue('PAYMENT_GATEWAY_OAUTH_INTROSPECTION_URL'),
      asymmetricJwtAccessTokensEnabled: hasValue('PAYMENT_GATEWAY_OAUTH_JWKS_URL'),
    },
    'Use issuer metadata, token introspection, and revocation for opaque access tokens. Add JWKS when asymmetric JWT access tokens are introduced.',
  ),
  control(
    'observability.siem',
    hasValue('PAYMENT_GATEWAY_AUDIT_EVENT_SINK_URL') ||
      hasValue('PAYMENT_GATEWAY_SIEM_SINK_URL') ||
      hasValue('PAYMENT_GATEWAY_AUDIT_EVENT_SINK_PATH')
      ? 'pass'
      : 'attention',
    {
      auditSinkConfigured: hasValue('PAYMENT_GATEWAY_AUDIT_EVENT_SINK_URL'),
      siemSinkConfigured: hasValue('PAYMENT_GATEWAY_SIEM_SINK_URL'),
      auditJsonlSinkConfigured: hasValue('PAYMENT_GATEWAY_AUDIT_EVENT_SINK_PATH'),
    },
    'Stream security, audit, webhook, and reconciliation events to SIEM-compatible storage.',
  ),
  control(
    'reconciliation.evidence',
    hasValue('PAYMENT_GATEWAY_RECONCILIATION_EXPORT_PATH') || hasValue('PAYMENT_GATEWAY_RECONCILIATION_BUCKET') ? 'pass' : 'attention',
    {
      exportPathConfigured: hasValue('PAYMENT_GATEWAY_RECONCILIATION_EXPORT_PATH'),
      exportBucketConfigured: hasValue('PAYMENT_GATEWAY_RECONCILIATION_BUCKET'),
    },
    'Add daily Core/Gateway/provider reconciliation exports with signed report hashes.',
  ),
];

const statusRank = { pass: 0, attention: 1, fail: 2 };
const overall = controls.reduce((current, item) =>
  statusRank[item.status] > statusRank[current] ? item.status : current, 'pass');

const report = {
  service: 'orbi-pay-gateway',
  generatedAtUtc: new Date().toISOString(),
  envFileLoaded: Boolean(envFile),
  overall,
  controls,
};

console.log(JSON.stringify(report, null, 2));

if (strict && overall !== 'pass') {
  process.exit(1);
}
