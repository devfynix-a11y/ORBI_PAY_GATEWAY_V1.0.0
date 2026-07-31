import fs from 'node:fs';
import process from 'node:process';

const envFileArg = process.argv.find((arg) => arg.startsWith('--env-file='));
if (envFileArg) {
  const envPath = envFileArg.slice('--env-file='.length).replace(/^["']|["']$/g, '');
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || match[1].startsWith('#')) continue;
    const value = match[2].replace(/^["']|["']$/g, '');
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

const issuer = String(
  process.env.PAYMENT_GATEWAY_OIDC_IDENTITY_ISSUER ||
  process.env.ORBI_KEYCLOAK_ISSUER ||
  'https://auth.orbifinancial.com/realms/orbi',
).replace(/\/+$/, '');
const expectedAudience = String(
  process.env.PAYMENT_GATEWAY_OIDC_IDENTITY_AUDIENCE ||
  process.env.ORBI_KEYCLOAK_AUDIENCE ||
  '',
).trim();
const production = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const checks = [];

const record = (name, passed, detail) => checks.push({ name, passed, detail });

record('issuer_https', !production || issuer.startsWith('https://'), issuer);
record('audience_configured', !production || Boolean(expectedAudience), expectedAudience || 'missing');

try {
  const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
  const discoveryResponse = await fetch(discoveryUrl, { signal: AbortSignal.timeout(10_000) });
  record('discovery_http', discoveryResponse.ok, `HTTP ${discoveryResponse.status}`);
  const discovery = await discoveryResponse.json();
  record('issuer_exact_match', discovery.issuer === issuer, String(discovery.issuer || 'missing'));
  record('authorization_endpoint', /^https:\/\//.test(String(discovery.authorization_endpoint || '')), String(discovery.authorization_endpoint || 'missing'));
  record('token_endpoint', /^https:\/\//.test(String(discovery.token_endpoint || '')), String(discovery.token_endpoint || 'missing'));
  record('jwks_uri', /^https:\/\//.test(String(discovery.jwks_uri || '')), String(discovery.jwks_uri || 'missing'));
  record(
    'pkce_s256',
    Array.isArray(discovery.code_challenge_methods_supported) &&
      discovery.code_challenge_methods_supported.includes('S256'),
    JSON.stringify(discovery.code_challenge_methods_supported || []),
  );
  record(
    'asymmetric_signing',
    Array.isArray(discovery.id_token_signing_alg_values_supported) &&
      discovery.id_token_signing_alg_values_supported.some((alg) => ['RS256', 'PS256', 'ES256'].includes(alg)),
    JSON.stringify(discovery.id_token_signing_alg_values_supported || []),
  );

  if (discovery.jwks_uri) {
    const jwksResponse = await fetch(discovery.jwks_uri, { signal: AbortSignal.timeout(10_000) });
    record('jwks_http', jwksResponse.ok, `HTTP ${jwksResponse.status}`);
    const jwks = await jwksResponse.json();
    const signingKeys = Array.isArray(jwks.keys)
      ? jwks.keys.filter((key) => key.use === 'sig' && key.kid && ['RSA', 'EC'].includes(key.kty))
      : [];
    record('jwks_signing_keys', signingKeys.length > 0, `${signingKeys.length} signing key(s)`);
  }
} catch (error) {
  record('oidc_reachable', false, error instanceof Error ? error.message : String(error));
}

for (const check of checks) {
  console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
}

const failures = checks.filter((check) => !check.passed);
if (failures.length) {
  console.error(`OIDC readiness failed: ${failures.length} check(s) did not pass.`);
  process.exit(1);
}
console.log('OIDC readiness passed.');
