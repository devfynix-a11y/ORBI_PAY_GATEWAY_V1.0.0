import assert from 'node:assert/strict';
import test from 'node:test';
import { OperatorIncidentEscalationScheduler } from '../src/services/operatorIncidentEscalationScheduler.js';
import { OperatorIncidentStore } from '../src/services/operatorIncidentStore.js';

test('operator incident escalation scheduler raises one alert for stale critical incidents', async () => {
  const alerts: any[] = [];
  const store = OperatorIncidentStore.inMemory();
  await store.initialize();
  const incident = await store.createFromAlert({
    alertType: 'reconciliation.exceptions_detected',
    severity: 'critical',
    title: 'Critical reconciliation exceptions detected',
    message: 'Gateway reconciliation found one critical exception.',
    resource: { type: 'reconciliation_evidence_report', id: 'recon_stale' },
    metadata: {},
  });
  const stale = {
    ...incident,
    createdAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  };
  (store as any).incidents.set(incident.incidentId, stale);

  const scheduler = new OperatorIncidentEscalationScheduler({
    enabled: false,
    incidentStore: store,
    criticalSlaMinutes: 10,
    warningSlaMinutes: 60,
    alertSink: {
      send: async (alert: any) => alerts.push(alert),
    } as any,
    requestedBy: 'unit-escalation',
  });

  const first = await scheduler.runOnce('manual');
  assert.equal(first.skipped, false);
  const firstEscalated = 'escalated' in first && Array.isArray(first.escalated) ? first.escalated : [];
  assert.equal(firstEscalated.length, 1);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].alertType, 'operator.incident.sla_escalated');
  assert.equal(alerts[0].metadata.incidentId, incident.incidentId);

  const second = await scheduler.runOnce('manual');
  assert.equal(second.skipped, false);
  const secondEscalated = 'escalated' in second && Array.isArray(second.escalated) ? second.escalated : [];
  assert.equal(secondEscalated.length, 0);
  assert.equal(alerts.length, 1);
});
