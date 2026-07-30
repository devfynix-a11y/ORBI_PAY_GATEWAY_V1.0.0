import assert from 'node:assert/strict';
import test from 'node:test';
import { OperatorIncidentStore } from '../src/services/operatorIncidentStore.js';

test('operator incident store tracks acknowledgement, assignment, and resolution', async () => {
  const store = OperatorIncidentStore.inMemory();
  await store.initialize();

  const incident = await store.createFromAlert({
    alertId: 'alert_unit_001',
    alertType: 'reconciliation.exceptions_detected',
    severity: 'critical',
    title: 'Critical reconciliation exceptions detected',
    message: 'Gateway reconciliation found 1 exception.',
    resource: { type: 'reconciliation_evidence_report', id: 'recon_001' },
    metadata: { exceptionCount: 1 },
    runbook: {
      name: 'Gateway reconciliation exception triage',
      steps: ['Open the signed report.', 'Replay failed webhooks safely.'],
    },
  });

  assert.match(incident.incidentId, /^inc_/);
  assert.equal(incident.status, 'open');
  assert.equal(incident.sourceAlertId, 'alert_unit_001');

  const acknowledged = await store.acknowledge(incident.incidentId, {
    acknowledgedBy: 'ops@orbifinancial.com',
    note: 'Checking signed report.',
  });
  assert.equal(acknowledged.status, 'acknowledged');
  assert.equal(acknowledged.acknowledgedBy, 'ops@orbifinancial.com');

  const assigned = await store.assign(incident.incidentId, {
    assignedTo: 'recon-team@orbifinancial.com',
    assignedBy: 'ops@orbifinancial.com',
  });
  assert.equal(assigned.status, 'assigned');
  assert.equal(assigned.assignedTo, 'recon-team@orbifinancial.com');

  const resolved = await store.resolve(incident.incidentId, {
    resolvedBy: 'recon-team@orbifinancial.com',
    resolution: 'Webhook replay completed and report attached.',
  });
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.resolvedBy, 'recon-team@orbifinancial.com');

  const listed = await store.list({ status: 'resolved' });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].incidentId, incident.incidentId);
});
