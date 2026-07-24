import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const serverSource = readFileSync(join(process.cwd(), 'src', 'server.ts'), 'utf8');
const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');

test('saccos example links members and creates hosted payment intents safely', () => {
  assert.match(serverSource, /linkPaymentProfile/);
  assert.match(serverSource, /createCheckoutPaymentIntent/);
  assert.match(serverSource, /idempotencyKey: `payment-profile:saccos-member:\$\{memberId\}`/);
  assert.match(serverSource, /idempotencyKey: `saccos-payment:\$\{paymentId\}`/);
  assert.match(serverSource, /verifyOrbiWebhookSignature/);
  assert.match(serverSource, /seenWebhookEvents\.has/);
});

test('saccos docs make webhook truth and storage boundaries explicit', () => {
  assert.match(readme, /signed webhook is the source of/);
  assert.match(readme, /not store ORBI passwords/);
  assert.match(readme, /raw wallet IDs/);
  assert.match(readme, /reuse the same idempotency key/);
});
