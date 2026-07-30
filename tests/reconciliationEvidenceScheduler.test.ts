import assert from 'node:assert/strict';
import test from 'node:test';
import { ReconciliationEvidenceScheduler } from '../src/services/reconciliationEvidenceScheduler.js';

test('reconciliation scheduler exports a signed report window on demand', async () => {
  const calls: any[] = [];
  const scheduler = new ReconciliationEvidenceScheduler({
    enabled: false,
    intervalMinutes: 60,
    windowHours: 6,
    requestedBy: 'unit-scheduler',
    service: {
      export: async (input: any) => {
        calls.push(input);
        return {
          report: {
            reportId: 'recon_unit_001',
            window: { from: input.from, to: input.to },
            summary: {
              exceptionCount: 0,
              paymentIntentCount: 0,
              webhookDeliveryCount: 0,
            },
          },
          path: '/tmp/recon_unit_001.json',
        };
      },
    } as any,
  });

  const result = await scheduler.runOnce('manual');
  assert.equal(result.skipped, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].requestedBy, 'unit-scheduler');
  const windowMs = Date.parse(calls[0].to) - Date.parse(calls[0].from);
  assert.ok(windowMs >= 6 * 60 * 60 * 1000 - 1000);
  assert.ok(windowMs <= 6 * 60 * 60 * 1000 + 1000);
});

test('reconciliation scheduler skips overlapping runs', async () => {
  let release!: () => void;
  const firstRun = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scheduler = new ReconciliationEvidenceScheduler({
    enabled: false,
    service: {
      export: async () => {
        await firstRun;
        return {
          report: {
            reportId: 'recon_overlap',
            window: { from: new Date().toISOString(), to: new Date().toISOString() },
            summary: {
              exceptionCount: 0,
              paymentIntentCount: 0,
              webhookDeliveryCount: 0,
            },
          },
        };
      },
    } as any,
  });

  const running = scheduler.runOnce('manual');
  const skipped = await scheduler.runOnce('manual');
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.reason, 'already_running');
  release();
  await running;
});
