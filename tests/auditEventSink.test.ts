import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AuditEventSink, redactAuditMetadata } from '../src/services/auditEventSink.js';

test('audit event sink redacts sensitive fields recursively', () => {
  const redacted = redactAuditMetadata({
    serviceCode: 'orbi-shop',
    apiKey: 'live-secret',
    nested: {
      authorization: 'Bearer token',
      safe: 'visible',
    },
  }) as Record<string, any>;

  assert.equal(redacted.serviceCode, 'orbi-shop');
  assert.equal(redacted.apiKey, '[REDACTED]');
  assert.equal(redacted.nested.authorization, '[REDACTED]');
  assert.equal(redacted.nested.safe, 'visible');
});

test('audit event sink writes jsonl events without throwing financial flow', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbi-audit-sink-'));
  const file = path.join(dir, 'events.jsonl');
  const sink = new AuditEventSink({
    sinkPath: file,
    service: 'unit-test-gateway',
    environment: 'sandbox',
  });

  await sink.emit({
    eventType: 'gateway.test_event',
    outcome: 'success',
    requestId: 'req_001',
    actor: { serviceCode: 'orbi-shop', serviceSecret: 'hide-me' },
  });

  const line = (await fs.readFile(file, 'utf8')).trim();
  const event = JSON.parse(line);
  assert.equal(event.eventType, 'gateway.test_event');
  assert.equal(event.service, 'unit-test-gateway');
  assert.equal(event.environment, 'sandbox');
  assert.equal(event.requestId, 'req_001');
  assert.equal(event.actor.serviceCode, 'orbi-shop');
  assert.equal(event.actor.serviceSecret, '[REDACTED]');
});
