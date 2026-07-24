import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const blueprint = readFileSync(
  join(process.cwd(), 'docs', 'DEVELOPER_PORTAL_UI_BLUEPRINT.md'),
  'utf8',
);

test('developer portal UI blueprint defines required first screens', () => {
  for (const section of [
    'Overview',
    'Services',
    'Sandbox Setup',
    'Keys And Webhook Secrets',
    'Scopes And Consent',
    'Webhooks',
    'Integration Health',
    'Docs And SDKs',
    'Audit Events',
  ]) {
    assert.match(blueprint, new RegExp(section));
  }
});

test('developer portal UI blueprint preserves control-plane safety boundary', () => {
  assert.match(blueprint, /must not execute wallet movements/i);
  assert.match(blueprint, /Raw service API keys/i);
  assert.match(blueprint, /Replay does not create a new payment/i);
});
