import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');

test('every terminal Core outcome records one service webhook delivery', () => {
  assert.match(server, /const recordTerminalWebhookDelivery = async/);
  assert.match(server, /intent\.webhookDelivery/);
  assert.match(server, /recordTerminalWebhookDelivery\(service, confirmed\.intent\)/);
  assert.match(server, /const deliveredIntent = await recordTerminalWebhookDelivery\(service, updatedIntent\)/);
});
