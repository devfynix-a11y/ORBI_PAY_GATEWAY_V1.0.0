import assert from 'node:assert/strict';
import test from 'node:test';
import { RefreshTokenStore } from '../src/services/refreshTokenStore.js';

const context = {
  serviceCode: 'test-service',
  environment: 'sandbox' as const,
  subjectId: 'subject-001',
  consentId: 'consent-001',
  scopes: ['payments:create'],
  identityIssuer: 'https://auth.orbifinancial.com/realms/orbi',
};

test('refresh tokens rotate and an old-token replay revokes the family', async () => {
  const store = RefreshTokenStore.inMemory();
  const issued = await store.issue(context);
  assert.match(issued.refreshToken, /^orbi_rt_/);

  const firstRotation = await store.rotate(issued.refreshToken, context.serviceCode);
  assert.equal(firstRotation.status, 'rotated');
  if (firstRotation.status !== 'rotated') return;
  assert.notEqual(firstRotation.refreshToken, issued.refreshToken);

  const replay = await store.rotate(issued.refreshToken, context.serviceCode);
  assert.equal(replay.status, 'reuse_detected');

  const familyTokenAfterReplay = await store.rotate(firstRotation.refreshToken, context.serviceCode);
  assert.equal(familyTokenAfterReplay.status, 'invalid');
});

test('consent revocation invalidates refresh tokens without a false reuse alert', async () => {
  const store = RefreshTokenStore.inMemory();
  const issued = await store.issue(context);
  await store.revokeByConsent(context.consentId);
  const result = await store.rotate(issued.refreshToken, context.serviceCode);
  assert.equal(result.status, 'invalid');
});

test('refresh token is bound to its OAuth client', async () => {
  const store = RefreshTokenStore.inMemory();
  const issued = await store.issue(context);
  const result = await store.rotate(issued.refreshToken, 'another-service');
  assert.equal(result.status, 'invalid');
});
