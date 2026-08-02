import assert from 'node:assert/strict';
import test from 'node:test';
import { BillingPlanStore } from '../src/services/billingPlanStore.js';

test('billing plan summary defaults services to sandbox free and watches limits', async () => {
  const store = new BillingPlanStore('');
  const summary = await store.summary({
    services: [{ serviceCode: 'svc_demo' }],
    usageMetering: {
      generatedAt: new Date().toISOString(),
      windowHours: 24,
      totalRequests: 900,
      successfulRequests: 850,
      failedRequests: 50,
      averageLatencyMs: 120,
      activeDevelopers: 1,
      activeServices: 1,
      byService: [{ serviceCode: 'svc_demo', requests: 900, failures: 50, averageLatencyMs: 120 }],
      byRoute: [],
    },
  });

  assert.equal(summary.enforcementMode, 'observe');
  assert.equal(summary.assignments[0].serviceCode, 'svc_demo');
  assert.equal(summary.assignments[0].planCode, 'sandbox_free');
  assert.equal(summary.overLimitServices[0].serviceCode, 'svc_demo');
  assert.equal(summary.overLimitServices[0].severity, 'warning');
});
