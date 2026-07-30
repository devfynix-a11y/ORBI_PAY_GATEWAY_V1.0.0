import assert from 'node:assert/strict';
import test from 'node:test';
import {
  scopeForPaymentIntent,
  scopeForPaymentOperation,
  scopeForPaySafeAction,
} from '../src/services/serviceScopePolicy.js';

test('service scope policy maps generic financial operations to granted scopes', () => {
  assert.equal(scopeForPaymentOperation('collection'), 'payments:create');
  assert.equal(scopeForPaymentOperation('refund'), 'payments:create');
  assert.equal(scopeForPaymentOperation('payout'), 'withdrawal:request');
});

test('service scope policy maps PaySafe lifecycle actions explicitly', () => {
  assert.equal(scopeForPaySafeAction('create_escrow'), 'escrow:create');
  assert.equal(scopeForPaySafeAction('release'), 'escrow:release:request');
  assert.equal(scopeForPaySafeAction('refund'), 'escrow:refund:request');
  assert.equal(scopeForPaySafeAction('dispute'), 'escrow:dispute:create');
});

test('service scope policy reads PaySafe action from persisted intent metadata', () => {
  assert.equal(scopeForPaymentOperation('paysafe', { paySafeAction: 'release' }), 'escrow:release:request');
  assert.equal(scopeForPaymentIntent({
    operation: 'paysafe',
    metadata: { paySafeAction: 'refund' },
  } as any), 'escrow:refund:request');
});

test('service scope policy defaults PaySafe operation to create escrow only when action is absent', () => {
  assert.equal(scopeForPaymentOperation('paysafe'), 'escrow:create');
  assert.equal(scopeForPaymentOperation('paysafe', { paySafeAction: 'unknown' }), 'escrow:create');
});
