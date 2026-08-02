import assert from 'node:assert/strict';
import test from 'node:test';
import {
  developerDocsCatalog,
  developerSandboxToolsCatalog,
  developerSdkCatalog,
} from '../src/services/developerResourceCatalog.js';
import {
  developerEnvironmentProfiles,
  developerEnvironmentSeparationMatrix,
} from '../src/services/developerEnvironmentCatalog.js';

test('developer docs catalog exposes public rendered guides only', () => {
  const docs = developerDocsCatalog();
  assert.equal(docs.some((entry) => entry.id === 'quick-start'), true);
  assert.equal(docs.some((entry) => entry.id === 'sdk-setup'), true);
  assert.equal(docs.some((entry) => entry.id === 'domain-verification'), true);
  assert.equal(docs.some((entry) => entry.id === 'payment-intents'), true);
  assert.equal(docs.some((entry) => entry.id === 'paysafe-escrow'), true);
  assert.equal(docs.some((entry) => entry.id === 'webhooks'), true);
  assert.equal(docs.some((entry) => entry.id === 'sandbox-live'), true);
  assert.equal(docs.some((entry) => entry.id === 'error-handling'), true);
  assert.equal(docs.some((entry) => entry.id === 'developer-portal-ui-blueprint'), false);
  assert.equal(docs.some((entry) => entry.id === 'security-model'), false);
  assert.equal(docs.some((entry) => entry.id === 'deployment-runbook'), false);
  assert.equal(docs.every((entry) => !('path' in entry)), true);
  assert.equal(docs.every((entry) => Array.isArray(entry.sections) && entry.sections.length > 0), true);
});

test('developer sandbox catalog exposes safe bootstrap tools', () => {
  const tools = developerSandboxToolsCatalog();
  assert.equal(tools.some((entry) => entry.id === 'sandbox-api-key'), true);
  assert.equal(tools.some((entry) => entry.id === 'postman-sandbox-collection'), true);
  assert.equal(tools.some((entry) => entry.id === 'webhook-replay'), true);
  assert.equal(tools.some((entry) => entry.id === 'consent-receipts'), true);
  assert.equal(tools.some((entry) => entry.id === 'consent-scope-catalog'), true);
  assert.equal(tools.some((entry) => entry.id === 'consent-status-check'), true);
  assert.equal(tools.some((entry) => entry.id === 'environment-profiles'), true);
  assert.equal(tools.some((entry) => entry.id === 'sandbox-simulator-flow'), true);
  assert.equal(tools.some((entry) => entry.status === 'operator_toggle'), true);
});

test('developer environment catalog separates sandbox and live trust zones', () => {
  const profiles = developerEnvironmentProfiles();
  const sandbox = profiles.find((entry) => entry.environment === 'sandbox');
  const live = profiles.find((entry) => entry.environment === 'live');
  assert.equal(sandbox?.moneyMode, 'simulated');
  assert.equal(live?.moneyMode, 'real');
  assert.equal(sandbox?.allowedKeyPrefix, 'orbi_sandbox_');
  assert.equal(live?.allowedKeyPrefix, 'orbi_live_');
  assert.equal(developerEnvironmentSeparationMatrix().rules.length >= 4, true);
});

test('developer sdk catalog exposes live SDK registries and OpenAPI contract', () => {
  const sdks = developerSdkCatalog();
  assert.equal(sdks.some((entry) => entry.id === 'node-sdk' && entry.status === 'live_npm'), true);
  assert.equal(sdks.some((entry) => entry.id === 'python-sdk' && entry.status === 'live_pypi'), true);
  assert.equal(sdks.some((entry) => entry.id === 'php-sdk' && entry.status === 'live_packagist'), true);
  assert.equal(sdks.some((entry) => entry.id === 'openapi-spec' && entry.status === 'bootstrap_available'), true);
  assert.equal(sdks.every((entry) => String(entry.packageName || '').length > 0), true);
});
