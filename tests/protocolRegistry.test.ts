import assert from 'node:assert/strict';
import test from 'node:test';
import { protocolEngineRegistry } from '../src/protocols/ProtocolEngineRegistry.js';

test('REST_HMAC protocol is generic live and HMAC protected', () => {
  const engine = protocolEngineRegistry.get('REST_HMAC');

  assert.equal(engine.capabilities.executionMode, 'generic-live');
  assert.equal(engine.capabilities.supportsOnlineAuthorization, true);
  assert.equal(engine.capabilities.supportsWebhookCallbacks, true);
  assert.ok(engine.capabilities.networkControls.includes('HMAC_REQUEST_SIGNING'));
});

test('traditional ISO8583 switch protocol remains fail-closed until certified', () => {
  const engine = protocolEngineRegistry.get('ISO8583_TCP_TLS');

  assert.equal(engine.capabilities.executionMode, 'fail-closed');
  assert.equal(engine.capabilities.certificationRequired, true);
  assert.ok(engine.capabilities.networkControls.includes('ISO8583_PROFILE'));
});

test('ISO 20022 REST XML protocol is available for certified HTTP clearing profiles', () => {
  const engine = protocolEngineRegistry.get('ISO20022_REST_XML');

  assert.equal(engine.capabilities.executionMode, 'generic-live');
  assert.equal(engine.capabilities.supportsOnlineAuthorization, true);
  assert.ok(engine.capabilities.networkControls.includes('ISO20022_XML'));
});

test('ISO 20022 mTLS protocol remains fail-closed until scheme certification', () => {
  const engine = protocolEngineRegistry.get('ISO20022_MTLS');

  assert.equal(engine.capabilities.executionMode, 'fail-closed');
  assert.equal(engine.capabilities.certificationRequired, true);
  assert.ok(engine.capabilities.networkControls.includes('PARTICIPANT_ID'));
});
