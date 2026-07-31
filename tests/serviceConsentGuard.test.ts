import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceConsentGuard, subjectIdForConsent } from '../src/services/serviceConsentGuard.js';
import type { PayServiceDefinition } from '../src/types.js';

const service: PayServiceDefinition = {
  code: 'orbi-shop',
  displayName: 'ORBI Shop',
  status: 'ACTIVE',
  apiKeyTokenRefEnv: 'ORBI_SHOP_PAY_API_KEY_TOKEN_REF',
  callbackUrlEnv: 'ORBI_SHOP_PAY_WEBHOOK_URL',
  webhookSecretTokenRefEnv: 'ORBI_SHOP_PAY_WEBHOOK_SECRET_TOKEN_REF',
  allowedOperations: ['paysafe'],
  allowedCurrencies: ['TZS'],
};

const portalStore = (scopesGranted: string[]) => ({
  getService: () => ({
    serviceCode: 'orbi-shop',
    displayName: 'ORBI Shop',
    status: 'active',
    environments: ['live'],
    scopesGranted,
    scopesPending: [],
    redirectUrls: [],
    webhookUrls: [],
    keyStatus: 'active',
    webhookSecretStatus: 'active',
    keys: [],
    webhookSecrets: [],
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  }),
});

test('service consent guard requires granted portal scope', () => {
  const guard = new ServiceConsentGuard(portalStore(['payments:create']) as any, {
    hasActiveConsent: async () => true,
  });

  assert.throws(() => guard.assertServiceScopeGranted(service, 'balance:read'), /PAY_SERVICE_SCOPE_NOT_GRANTED/);
  assert.doesNotThrow(() => guard.assertServiceScopeGranted(service, 'payments:create'));
});

test('service consent guard requires active consent for scoped subject', async () => {
  const guard = new ServiceConsentGuard(portalStore(['balance:read']) as any, {
    hasActiveConsent: async (input) =>
      input.serviceCode === 'orbi-shop' &&
      input.subjectId === 'user_001' &&
      input.scopes.includes('balance:read') &&
      input.environment === 'live',
  });

  await assert.doesNotReject(() =>
    guard.assertScopedConsent(service, 'balance:read', {
      subjectId: 'user_001',
      environment: 'live',
    }),
  );

  await assert.rejects(() =>
    guard.assertScopedConsent(service, 'balance:read', {
      subjectId: 'user_002',
      environment: 'live',
    }),
  /CONSENT_REQUIRED/);
});

test('service consent guard requires consent subject identity', async () => {
  const guard = new ServiceConsentGuard(portalStore(['balance:read']) as any, {
    hasActiveConsent: async () => false,
  });

  await assert.rejects(() =>
    guard.assertScopedConsent(service, 'balance:read', {
      subjectId: '',
      environment: 'live',
    }),
  /CONSENT_SUBJECT_REQUIRED/);
});

test('subject id for consent is deterministic across supported identifiers', () => {
  assert.equal(subjectIdForConsent({ userId: 'user_001', email: 'person@example.com' }), 'user_001');
  assert.equal(subjectIdForConsent({ customerId: 'customer_001' }), 'customer_001');
  assert.equal(subjectIdForConsent({ email: 'person@example.com' }), 'person@example.com');
  assert.equal(subjectIdForConsent({ phone: '+255700000000' }), '+255700000000');
  assert.equal(subjectIdForConsent({ identifier: 'OB26-0000-0001' }), 'OB26-0000-0001');
});
