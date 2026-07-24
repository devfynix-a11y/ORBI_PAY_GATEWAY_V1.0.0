import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const serverSource = readFileSync(join(process.cwd(), 'src', 'server.ts'), 'utf8');
const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');

test('seller linking example uses payment profile helper and stable idempotency', () => {
  assert.match(serverSource, /linkPaymentProfile/);
  assert.match(serverSource, /idempotencyKey: `payment-profile:seller:\$\{sellerId\}`/);
  assert.match(serverSource, /ORBI_IDENTITY_REQUIRED/);
  assert.match(serverSource, /payment_profile:read/);
  assert.match(serverSource, /escrow:create/);
});

test('seller linking docs keep ORBI secrets out of merchant storage', () => {
  assert.match(readme, /Never store ORBI passwords/);
  assert.match(readme, /raw wallet IDs/);
  assert.match(readme, /Use the same idempotency key/);
});
