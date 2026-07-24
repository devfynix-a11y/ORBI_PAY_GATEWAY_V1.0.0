import assert from 'node:assert/strict';
import test from 'node:test';
import { SandboxSimulatorStore } from '../src/services/sandboxSimulatorStore.js';

test('sandbox simulator moves fake balances without Core ledger commits', () => {
  const store = new SandboxSimulatorStore();
  const before = store.snapshot();
  assert.equal(before.moneyMode, 'simulated');
  assert.equal(before.ledgerMode, 'no_core_ledger_commit');

  const transfer = store.createTransfer({
    fromAccountId: 'sbx_buyer_daniel',
    toAccountId: 'sbx_seller_catherine',
    amount: 25000,
    currency: 'TZS',
    reference: 'SBX-ORDER-1',
  });

  assert.equal(transfer.status, 'completed');
  assert.equal(transfer.balanceAfter.from, 975000);
  assert.equal(transfer.balanceAfter.to, 275000);
  assert.equal(store.buildWebhookEvent(transfer.transferId).eventType, 'payment_intent.updated');
});

test('sandbox simulator rejects invalid fake transfers', () => {
  const store = new SandboxSimulatorStore();
  assert.throws(() => store.createTransfer({
    fromAccountId: 'sbx_buyer_daniel',
    toAccountId: 'sbx_seller_catherine',
    amount: 100,
    currency: 'USD',
    reference: 'SBX-USD',
  }), /SANDBOX_TRANSFER_CURRENCY_MISMATCH/);
});
