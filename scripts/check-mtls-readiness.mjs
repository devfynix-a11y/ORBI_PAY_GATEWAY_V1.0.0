import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const envFile = process.env.PAYMENT_GATEWAY_ENV_FILE || process.argv[2] || '';
if (envFile) {
  dotenv.config({ path: envFile });
}

const enabled = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.PAYMENT_GATEWAY_INTERNAL_MTLS_ENABLED || '').trim().toLowerCase(),
);

const resolvePath = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return path.resolve(trimmed);
};

if (!enabled) {
  console.log('mTLS readiness: disabled. Set PAYMENT_GATEWAY_INTERNAL_MTLS_ENABLED=true after certificates are installed.');
  process.exit(0);
}

const requiredFiles = [
  ['PAYMENT_GATEWAY_INTERNAL_MTLS_CERT_PATH', resolvePath(process.env.PAYMENT_GATEWAY_INTERNAL_MTLS_CERT_PATH)],
  ['PAYMENT_GATEWAY_INTERNAL_MTLS_KEY_PATH', resolvePath(process.env.PAYMENT_GATEWAY_INTERNAL_MTLS_KEY_PATH)],
  ['PAYMENT_GATEWAY_INTERNAL_MTLS_CA_PATH', resolvePath(process.env.PAYMENT_GATEWAY_INTERNAL_MTLS_CA_PATH)],
];

const failures = [];

for (const [name, filePath] of requiredFiles) {
  if (!filePath) {
    failures.push(`${name} is empty`);
    continue;
  }

  if (!fs.existsSync(filePath)) {
    failures.push(`${name} file not found at ${filePath}`);
  }
}

const coreBaseUrl = String(process.env.ORBI_CORE_INTERNAL_BASE_URL || '').trim();
if (!coreBaseUrl.startsWith('https://')) {
  failures.push('ORBI_CORE_INTERNAL_BASE_URL must use https:// when gateway mTLS is enabled');
}

const rejectUnauthorized = String(process.env.PAYMENT_GATEWAY_INTERNAL_MTLS_REJECT_UNAUTHORIZED || 'true')
  .trim()
  .toLowerCase();
if (rejectUnauthorized === 'false') {
  failures.push('PAYMENT_GATEWAY_INTERNAL_MTLS_REJECT_UNAUTHORIZED must not be false in production mTLS mode');
}

if (failures.length > 0) {
  console.error('mTLS readiness failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('mTLS readiness passed.');
