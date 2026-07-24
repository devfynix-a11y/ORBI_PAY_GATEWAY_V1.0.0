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

test('developer docs catalog includes core integration references', () => {
  const docs = developerDocsCatalog();
  assert.equal(docs.some((entry) => entry.id === 'platform-integration-contracts'), true);
  assert.equal(docs.some((entry) => entry.id === 'developer-portal-contracts'), true);
  assert.equal(docs.some((entry) => entry.id === 'developer-portal-ui-blueprint'), true);
  assert.equal(docs.some((entry) => entry.id === 'language-integration-configs'), true);
  assert.equal(docs.some((entry) => entry.id === 'openapi-spec'), true);
  assert.equal(docs.some((entry) => entry.id === 'postman-collection'), true);
  assert.equal(docs.some((entry) => entry.id === 'environment-separation'), true);
  assert.equal(docs.some((entry) => entry.id === 'merchant-checkout-example'), true);
  assert.equal(docs.some((entry) => entry.id === 'seller-linking-example'), true);
  assert.equal(docs.some((entry) => entry.id === 'saccos-member-payments-example'), true);
  assert.equal(docs.every((entry) => entry.path.startsWith('/docs/') || entry.path.startsWith('/examples/')), true);
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

test('developer sdk catalog exposes generated and planned SDKs', () => {
  const sdks = developerSdkCatalog();
  assert.equal(sdks.some((entry) => entry.id === 'node-sdk' && entry.status === 'bootstrap_available'), true);
  assert.equal(sdks.some((entry) => entry.id === 'openapi-spec' && entry.status === 'bootstrap_available'), true);
  assert.equal(sdks.filter((entry) => entry.status === 'planned').length >= 2, true);
});
