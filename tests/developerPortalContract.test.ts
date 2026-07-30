import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DeveloperAllowlistUpdateSchema,
  DeveloperApiKeyRotationRequestSchema,
  DeveloperPortalEventSchema,
  DeveloperScopeRequestSchema,
  DeveloperServiceApplicationSchema,
  DeveloperServiceProfileResponseSchema,
} from '../src/contracts/developerPortalContract.js';

test('developer service application captures onboarding controls', () => {
  const application = DeveloperServiceApplicationSchema.parse({
    legalName: 'ORBI Shop Limited',
    displayName: 'ORBI Shop',
    contactEmail: 'ops@orbishop.example',
    contactPhone: '+255700000000',
    businessType: 'marketplace',
    countryCode: 'TZ',
    requestedEnvironments: ['sandbox', 'live'],
    requestedScopes: ['payment_profile:read', 'payments:create', 'escrow:create', 'webhooks:receive'],
    browserOrigins: ['https://www.tag.co.tz/checkout'],
    redirectUrls: ['https://shop.orbifinancial.com/api/auth/orbi-business/link/callback'],
    webhookUrls: ['https://shop.orbifinancial.com/api/orbi/webhooks'],
    useCases: ['Seller payment profiles', 'Protected checkout through PaySafe'],
    termsAccepted: true,
  });

  assert.equal(application.businessType, 'marketplace');
  assert.deepEqual(application.requestedEnvironments, ['sandbox', 'live']);
  assert.deepEqual(application.browserOrigins, ['https://www.tag.co.tz']);
  assert.equal(application.termsAccepted, true);
});

test('developer service live applications reject unsafe browser origins', () => {
  assert.throws(() =>
    DeveloperServiceApplicationSchema.parse({
      legalName: 'Local Merchant Limited',
      displayName: 'Local Merchant',
      contactEmail: 'ops@local.example',
      businessType: 'merchant',
      countryCode: 'TZ',
      requestedEnvironments: ['live'],
      requestedScopes: ['payments:create'],
      browserOrigins: ['http://localhost:5173'],
      redirectUrls: ['https://merchant.example.com/orbi/return'],
      webhookUrls: ['https://merchant.example.com/orbi/webhooks'],
      useCases: ['Production payment checkout'],
      termsAccepted: true,
    }),
  );

  assert.doesNotThrow(() =>
    DeveloperServiceApplicationSchema.parse({
      legalName: 'Sandbox Merchant Limited',
      displayName: 'Sandbox Merchant',
      contactEmail: 'ops@sandbox.example',
      businessType: 'merchant',
      countryCode: 'TZ',
      requestedEnvironments: ['sandbox'],
      requestedScopes: ['payments:create'],
      browserOrigins: ['http://localhost:5173'],
      redirectUrls: ['http://localhost:5173/orbi/return'],
      webhookUrls: ['http://localhost:5173/orbi/webhooks'],
      useCases: ['Sandbox payment checkout testing'],
      termsAccepted: true,
    }),
  );
});

test('developer service profile response is stable for dashboard cards', () => {
  assert.doesNotThrow(() =>
    DeveloperServiceProfileResponseSchema.parse({
      success: true,
      data: {
        serviceCode: 'orbi-shop',
        displayName: 'ORBI Shop',
        status: 'active',
        environments: ['sandbox', 'live'],
        scopesGranted: ['payment_profile:read', 'payments:create', 'escrow:create'],
        scopesPending: ['balance:read'],
        browserOrigins: ['https://www.tag.co.tz'],
        redirectUrls: ['https://shop.orbifinancial.com/api/auth/orbi-business/link/callback'],
        webhookUrls: ['https://shop.orbifinancial.com/api/orbi/webhooks'],
        keyStatus: 'active',
        webhookSecretStatus: 'active',
        createdAt: '2026-07-23T00:00:00.000Z',
        updatedAt: '2026-07-23T00:00:00.000Z',
      },
    }),
  );
});

test('scope requests require a reason and known scopes', () => {
  assert.doesNotThrow(() =>
    DeveloperScopeRequestSchema.parse({
      requestedScopes: ['balance:read'],
      reason: 'Seller dashboard needs read-only protected balance projection.',
      environment: 'live',
    }),
  );

  assert.throws(() =>
    DeveloperScopeRequestSchema.parse({
      requestedScopes: ['wallet:admin'],
      reason: 'Unsafe',
      environment: 'live',
    }),
  );
});

test('allowlist updates must include browser origin, redirect, or webhook urls', () => {
  assert.doesNotThrow(() =>
    DeveloperAllowlistUpdateSchema.parse({
      browserOrigins: ['https://merchant.example.com/app'],
      redirectUrls: ['https://merchant.example.com/orbi/return'],
      reason: 'Add production checkout return URL.',
      environment: 'live',
    }),
  );

  assert.throws(() =>
    DeveloperAllowlistUpdateSchema.parse({
      reason: 'No URLs submitted here.',
      environment: 'live',
    }),
  );

  assert.throws(() =>
    DeveloperAllowlistUpdateSchema.parse({
      browserOrigins: ['https://*.merchant.example.com'],
      reason: 'Wildcard origins are not accepted for live browser requests.',
      environment: 'live',
    }),
  );
});

test('api key rotation request carries environment and actor context', () => {
  assert.doesNotThrow(() =>
    DeveloperApiKeyRotationRequestSchema.parse({
      environment: 'sandbox',
      currentKeyId: 'key_2026_07',
      rotationReason: 'Routine quarterly sandbox key rotation.',
      requestedBy: 'ops@orbishop.example',
    }),
  );
});

test('developer portal events are auditable and environment aware', () => {
  assert.doesNotThrow(() =>
    DeveloperPortalEventSchema.parse({
      eventId: 'dev_evt_001',
      eventType: 'developer.api_key.rotation_requested',
      serviceCode: 'orbi-shop',
      environment: 'live',
      occurredAt: '2026-07-23T00:00:00.000Z',
      data: {
        requestedBy: 'ops@orbishop.example',
      },
    }),
  );
});
