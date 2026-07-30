import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { OperatorAlertSink } from '../src/services/operatorAlertSink.js';

test('operator alert sink writes redacted jsonl alerts', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbi-alert-sink-'));
  const file = path.join(dir, 'alerts.jsonl');
  const sink = new OperatorAlertSink({
    sinkPath: file,
    service: 'unit-test-gateway',
    environment: 'sandbox',
  });

  await sink.send({
    alertType: 'reconciliation.exceptions_detected',
    severity: 'critical',
    title: 'Critical reconciliation exceptions detected',
    message: 'Gateway reconciliation found exceptions.',
    metadata: {
      reportId: 'recon_001',
      serviceSecret: 'hide-me',
    },
  });

  const alert = JSON.parse((await fs.readFile(file, 'utf8')).trim());
  assert.equal(alert.alertType, 'reconciliation.exceptions_detected');
  assert.equal(alert.service, 'unit-test-gateway');
  assert.equal(alert.environment, 'sandbox');
  assert.equal(alert.metadata.reportId, 'recon_001');
  assert.equal(alert.metadata.serviceSecret, '[REDACTED]');
});
