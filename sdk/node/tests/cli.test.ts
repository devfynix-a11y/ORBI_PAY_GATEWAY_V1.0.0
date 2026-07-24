import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const runCli = (args: string[], env: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf8',
  });

test('cli prints help', () => {
  const result = runCli(['help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ORBI Pay Gateway CLI/);
  assert.match(result.stdout, /create-intent/);
});

test('cli verifies webhook signature', () => {
  const rawBody = JSON.stringify({ eventId: 'evt_001', eventType: 'payment_intent.updated' });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = 'whsec_test_secret';
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  const result = runCli([
    'verify-webhook',
    '--body',
    rawBody,
    '--signature',
    `sha256=${signature}`,
    '--timestamp',
    timestamp,
  ], {
    ORBI_PAY_WEBHOOK_SECRET: secret,
  });

  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true });
});

test('cli exits non-zero for invalid webhook signature', () => {
  const result = runCli([
    'verify-webhook',
    '--body',
    '{}',
    '--signature',
    'sha256=bad',
    '--timestamp',
    '1780000000',
  ], {
    ORBI_PAY_WEBHOOK_SECRET: 'whsec_test_secret',
  });

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).ok, false);
});
