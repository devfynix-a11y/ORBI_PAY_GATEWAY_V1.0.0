import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const serverSource = readFileSync(join(process.cwd(), 'src', 'server.ts'), 'utf8');
const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');

test('merchant checkout example keeps critical payment safety patterns', () => {
  assert.match(serverSource, /createCheckoutPaymentIntent/);
  assert.match(serverSource, /idempotencyKey: `payment-intent:\$\{orderId\}`/);
  assert.match(serverSource, /verifyOrbiWebhookSignature/);
  assert.match(serverSource, /seenWebhookEvents\.has/);
  assert.match(serverSource, /eventType === 'payment_intent\.updated'/);
});

test('merchant checkout docs warn that return url is not payment truth', () => {
  assert.match(readme, /Return URL Is Not Payment Truth/);
  assert.match(readme, /Verify every webhook before mutating order state/);
  assert.match(readme, /Reuse the same idempotency key after network failure/);
});
