import assert from 'node:assert/strict';
import test from 'node:test';
import { PushedAuthorizationRequestStore } from '../src/services/pushedAuthorizationRequestStore.js';

const payload = {
  response_type: 'code',
  client_id: 'orbi-shop',
  redirect_uri: 'https://shop.example.com/callback',
  scope: 'payments:create consent:read',
  state: 'state-value-with-enough-length',
  code_challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  code_challenge_method: 'S256',
};

test('pushed authorization request is one-time and client-bound', async () => {
  const store = PushedAuthorizationRequestStore.inMemory();
  const record = await store.create({
    serviceCode: 'orbi-shop',
    environment: 'sandbox',
    payload,
  }, 90);

  assert.match(record.requestUri, /^urn:ietf:params:oauth:request_uri:orbi:/);
  const consumed = await store.consume(record.requestUri, 'orbi-shop');
  assert.deepEqual(consumed.payload, payload);

  await assert.rejects(
    () => store.consume(record.requestUri, 'orbi-shop'),
    /OAUTH_PAR_REQUEST_URI_INVALID/,
  );
});

test('pushed authorization request rejects another OAuth client', async () => {
  const store = PushedAuthorizationRequestStore.inMemory();
  const record = await store.create({
    serviceCode: 'orbi-shop',
    environment: 'sandbox',
    payload,
  }, 90);

  await assert.rejects(
    () => store.consume(record.requestUri, 'another-client'),
    /OAUTH_PAR_REQUEST_URI_INVALID/,
  );
});

test('pushed authorization request expires quickly', async () => {
  const store = PushedAuthorizationRequestStore.inMemory();
  const record = await store.create({
    serviceCode: 'orbi-shop',
    environment: 'sandbox',
    payload,
  }, -1);

  await assert.rejects(
    () => store.consume(record.requestUri, 'orbi-shop'),
    /OAUTH_PAR_REQUEST_URI_INVALID/,
  );
});
