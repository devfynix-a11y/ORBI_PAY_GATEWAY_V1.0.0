import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveObpConsumerCredential } from '../src/security/tokenResolver.js';

test('OBP consumer credential resolves consumer key, id, and secret from env references', () => {
  const previous = {
    key: process.env.TEST_OBP_CONSUMER_KEY,
    secret: process.env.TEST_OBP_CONSUMER_SECRET,
    id: process.env.TEST_OBP_CONSUMER_ID,
    metadata: process.env.TEST_OBP_METADATA,
  };
  process.env.TEST_OBP_CONSUMER_KEY = 'consumer-key';
  process.env.TEST_OBP_CONSUMER_SECRET = 'consumer-secret';
  process.env.TEST_OBP_CONSUMER_ID = 'consumer-id';
  process.env.TEST_OBP_METADATA = JSON.stringify({
    consumerIdEnv: 'TEST_OBP_CONSUMER_ID',
    consumerSecretEnv: 'TEST_OBP_CONSUMER_SECRET',
  });

  try {
    const credential = resolveObpConsumerCredential('env://TEST_OBP_CONSUMER_KEY', 'TEST_OBP_METADATA');

    assert.equal(credential.consumerKey, 'consumer-key');
    assert.equal(credential.consumerSecret, 'consumer-secret');
    assert.equal(credential.consumerId, 'consumer-id');
  } finally {
    if (previous.key === undefined) delete process.env.TEST_OBP_CONSUMER_KEY; else process.env.TEST_OBP_CONSUMER_KEY = previous.key;
    if (previous.secret === undefined) delete process.env.TEST_OBP_CONSUMER_SECRET; else process.env.TEST_OBP_CONSUMER_SECRET = previous.secret;
    if (previous.id === undefined) delete process.env.TEST_OBP_CONSUMER_ID; else process.env.TEST_OBP_CONSUMER_ID = previous.id;
    if (previous.metadata === undefined) delete process.env.TEST_OBP_METADATA; else process.env.TEST_OBP_METADATA = previous.metadata;
  }
});
