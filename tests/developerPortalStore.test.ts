import assert from 'node:assert/strict';
import test from 'node:test';
import { DeveloperPortalStore } from '../src/services/developerPortalStore.js';

test('developer portal store persists service application lifecycle', async () => {
  const store = DeveloperPortalStore.inMemory();
  const application = await store.submitApplication({
    legalName: 'ORBI Shop Limited',
    displayName: 'ORBI Shop',
    contactEmail: 'ops@orbishop.example',
    businessType: 'marketplace',
    countryCode: 'TZ',
    requestedEnvironments: ['sandbox', 'live'],
    requestedScopes: ['payments:create', 'escrow:create', 'webhooks:receive'],
    browserOrigins: ['https://shop.orbifinancial.com'],
    redirectUrls: ['https://shop.orbifinancial.com/return'],
    webhookUrls: ['https://shop.orbifinancial.com/api/orbi/webhooks'],
    useCases: ['Protected checkout'],
    termsAccepted: true,
  });

  assert.equal(application.status, 'pending_review');
  const service = await store.approveApplication(application.applicationId, { initialStatus: 'draft' });
  assert.equal(service.serviceCode, 'orbi-shop');
  assert.equal(service.status, 'draft');
  assert.deepEqual(service.scopesPending, ['payments:create', 'escrow:create', 'webhooks:receive']);
  assert.equal(service.browserOrigins.includes('https://shop.orbifinancial.com'), true);
});

test('developer portal store filters applications and services by owner', async () => {
  const store = DeveloperPortalStore.inMemory();
  const first = await store.submitApplication({
    legalName: 'Alpha Merchant Ltd',
    displayName: 'Alpha Merchant',
    contactEmail: 'ops@alpha.example',
    businessType: 'merchant',
    countryCode: 'TZ',
    requestedEnvironments: ['sandbox'],
    requestedScopes: ['payments:create'],
    browserOrigins: ['https://alpha.example'],
    redirectUrls: ['https://alpha.example/orbi/return'],
    webhookUrls: ['https://alpha.example/api/orbi/webhooks'],
    useCases: ['Protected checkout'],
    termsAccepted: true,
  }, { email: 'developer@alpha.example', userId: 'portal_user_alpha' });
  const second = await store.submitApplication({
    legalName: 'Beta Merchant Ltd',
    displayName: 'Beta Merchant',
    contactEmail: 'ops@beta.example',
    businessType: 'merchant',
    countryCode: 'TZ',
    requestedEnvironments: ['sandbox'],
    requestedScopes: ['payments:create'],
    browserOrigins: ['https://beta.example'],
    redirectUrls: ['https://beta.example/orbi/return'],
    webhookUrls: ['https://beta.example/api/orbi/webhooks'],
    useCases: ['Protected checkout'],
    termsAccepted: true,
  }, { email: 'developer@beta.example', userId: 'portal_user_beta' });

  await store.approveApplication(first.applicationId, {});
  await store.approveApplication(second.applicationId, {});

  const alphaFilter = { ownerEmail: 'developer@alpha.example', serviceCodes: [] };
  assert.deepEqual(store.listApplications(undefined, alphaFilter).map((item) => item.applicationId), [first.applicationId]);
  assert.deepEqual(store.listServices(alphaFilter).map((item) => item.serviceCode), ['alpha-merchant']);
  assert.equal(store.portalUserCanAccessService('alpha-merchant', alphaFilter), true);
  assert.equal(store.portalUserCanAccessService('beta-merchant', alphaFilter), false);
});

test('developer portal store records scope, allowlist, key rotation, and events', async () => {
  const store = DeveloperPortalStore.inMemory();
  const application = await store.submitApplication({
    legalName: 'Merchant Platform Ltd',
    displayName: 'Merchant Platform',
    contactEmail: 'ops@merchant.example',
    businessType: 'platform',
    countryCode: 'TZ',
    requestedEnvironments: ['sandbox'],
    requestedScopes: ['payment_profile:read'],
    browserOrigins: [],
    redirectUrls: [],
    webhookUrls: [],
    useCases: ['Seller onboarding'],
    termsAccepted: true,
  });
  const service = await store.approveApplication(application.applicationId, {});

  const scopeRequest = await store.submitScopeRequest(service.serviceCode, {
    requestedScopes: ['balance:read'],
    reason: 'Read-only seller dashboard balance projection.',
    environment: 'sandbox',
  });
  assert.equal(scopeRequest.status, 'pending_review');
  const scopeDecision = await store.decideScopeRequest(scopeRequest.requestId, {
    decision: 'approve',
    reason: 'Approved for read-only sandbox seller dashboard projection.',
    decidedBy: 'operator@orbi.example',
  });
  assert.equal(scopeDecision.request.status, 'approved');
  assert.equal(scopeDecision.service.scopesGranted.includes('balance:read'), true);

  const allowlist = await store.applyAllowlistUpdate(service.serviceCode, {
    browserOrigins: ['https://merchant.example'],
    redirectUrls: ['https://merchant.example/orbi/return'],
    webhookUrls: ['https://merchant.example/api/orbi/webhooks'],
    reason: 'Add sandbox return URL.',
    environment: 'sandbox',
  });
  assert.equal(allowlist.service.browserOrigins.includes('https://merchant.example'), true);
  assert.equal(store.isBrowserOriginAllowed(service.serviceCode, 'https://merchant.example'), true);
  assert.equal(store.isAnyBrowserOriginAllowed('https://merchant.example'), true);
  assert.equal(allowlist.service.redirectUrls.includes('https://merchant.example/orbi/return'), true);
  assert.equal(store.isReturnUrlAllowed(service.serviceCode, 'https://merchant.example/orbi/return'), true);
  assert.equal(store.isReturnUrlAllowed(service.serviceCode, 'https://evil.example/return'), false);
  assert.equal(store.isWebhookUrlAllowed(service.serviceCode, 'https://merchant.example/api/orbi/webhooks'), true);
  assert.equal(store.isWebhookUrlAllowed(service.serviceCode, 'https://evil.example/webhook'), false);

  const rotation = await store.requestApiKeyRotation(service.serviceCode, {
    environment: 'sandbox',
    rotationReason: 'Routine sandbox key rotation.',
    requestedBy: 'ops@merchant.example',
  });
  assert.equal(rotation.status, 'pending_review');
  assert.equal(store.getService(service.serviceCode).keyStatus, 'rotation_pending');
  const rotationDecision = await store.decideApiKeyRotation(rotation.rotationId, {
    decision: 'complete',
    reason: 'New sandbox key installed and old key revoked.',
    decidedBy: 'operator@orbi.example',
  });
  assert.equal(rotationDecision.rotation.status, 'completed');
  assert.equal(rotationDecision.service.keyStatus, 'active');

  const issuedKey = await store.issueApiKey(service.serviceCode, {
    environment: 'sandbox',
    reason: 'Issue first sandbox key for merchant platform tests.',
    requestedBy: 'operator@orbi.example',
  });
  assert.equal(issuedKey.oneTimeSecret.startsWith('orbi_sandbox_'), true);
  assert.equal(issuedKey.key.fingerprint.length, 24);
  assert.equal(JSON.stringify(store.getService(service.serviceCode)).includes(issuedKey.oneTimeSecret), false);

  const webhookRotation = await store.requestWebhookSecretRotation(service.serviceCode, {
    environment: 'sandbox',
    rotationReason: 'Routine sandbox webhook secret rotation.',
    requestedBy: 'ops@merchant.example',
  });
  assert.equal(webhookRotation.status, 'pending_review');
  const webhookRotationDecision = await store.decideWebhookSecretRotation(webhookRotation.rotationId, {
    decision: 'approve',
    reason: 'Approved for sandbox webhook rotation.',
    decidedBy: 'operator@orbi.example',
  });
  assert.equal(webhookRotationDecision.rotation.status, 'approved');
  const issuedWebhookSecret = await store.issueWebhookSecret(service.serviceCode, {
    environment: 'sandbox',
    reason: 'Issue first sandbox webhook signing secret.',
    requestedBy: 'operator@orbi.example',
  });
  assert.equal(issuedWebhookSecret.oneTimeSecret.startsWith('orbi_whsec_sandbox_'), true);
  assert.equal(JSON.stringify(store.getService(service.serviceCode)).includes(issuedWebhookSecret.oneTimeSecret), false);
  assert.equal(store.listEvents(service.serviceCode).length >= 8, true);
});

test('developer portal key lifecycle keeps grace window then revokes on cutover', async () => {
  const store = DeveloperPortalStore.inMemory();
  const application = await store.submitApplication({
    legalName: 'Rotation Merchant Ltd',
    displayName: 'Rotation Merchant',
    contactEmail: 'ops@rotation.example',
    businessType: 'merchant',
    countryCode: 'TZ',
    requestedEnvironments: ['sandbox'],
    requestedScopes: ['payments:create'],
    browserOrigins: ['https://rotation.example'],
    redirectUrls: ['https://rotation.example/orbi/return'],
    webhookUrls: ['https://rotation.example/api/orbi/webhooks'],
    useCases: ['Checkout key rotation'],
    termsAccepted: true,
  });
  const service = await store.approveApplication(application.applicationId, { initialStatus: 'active' });

  const first = await store.issueApiKey(service.serviceCode, {
    environment: 'sandbox',
    reason: 'Issue initial sandbox key.',
    requestedBy: 'operator@orbi.example',
  });
  const rotation = await store.requestApiKeyRotation(service.serviceCode, {
    environment: 'sandbox',
    rotationReason: 'Routine sandbox API key rotation.',
    requestedBy: 'ops@rotation.example',
  });
  await store.decideApiKeyRotation(rotation.rotationId, {
    decision: 'approve',
    reason: 'Approved for controlled cutover.',
    decidedBy: 'operator@orbi.example',
  });
  const second = await store.issueApiKey(service.serviceCode, {
    environment: 'sandbox',
    reason: 'Issue replacement sandbox key.',
    requestedBy: 'operator@orbi.example',
  });

  const duringCutover = store.getService(service.serviceCode);
  assert.equal(duringCutover.keys.find((key) => key.keyId === first.key.keyId)?.status, 'pending_cutover');
  assert.equal(duringCutover.keys.find((key) => key.keyId === second.key.keyId)?.status, 'active');
  assert.equal(store.resolveApiKey(first.oneTimeSecret)?.key.keyId, first.key.keyId);
  assert.equal(store.resolveApiKey(second.oneTimeSecret)?.key.keyId, second.key.keyId);

  await store.decideApiKeyRotation(rotation.rotationId, {
    decision: 'complete',
    reason: 'Merchant confirmed replacement key is installed.',
    decidedBy: 'operator@orbi.example',
  });
  const afterCutover = store.getService(service.serviceCode);
  assert.equal(afterCutover.keys.find((key) => key.keyId === first.key.keyId)?.status, 'revoked');
  assert.equal(store.resolveApiKey(first.oneTimeSecret), undefined);
  assert.equal(store.resolveApiKey(second.oneTimeSecret)?.key.keyId, second.key.keyId);

  const revoked = await store.revokeApiKey(service.serviceCode, second.key.keyId, {
    revokedBy: 'operator@orbi.example',
    reason: 'Emergency key revoke after suspected exposure.',
  });
  assert.equal(revoked.key.status, 'revoked');
  assert.equal(store.resolveApiKey(second.oneTimeSecret), undefined);
});

test('developer portal webhook secret lifecycle supports cutover and explicit revoke', async () => {
  const store = DeveloperPortalStore.inMemory();
  const application = await store.submitApplication({
    legalName: 'Webhook Merchant Ltd',
    displayName: 'Webhook Merchant',
    contactEmail: 'ops@webhook.example',
    businessType: 'merchant',
    countryCode: 'TZ',
    requestedEnvironments: ['sandbox'],
    requestedScopes: ['webhooks:receive'],
    browserOrigins: ['https://webhook.example'],
    redirectUrls: ['https://webhook.example/orbi/return'],
    webhookUrls: ['https://webhook.example/api/orbi/webhooks'],
    useCases: ['Webhook secret rotation'],
    termsAccepted: true,
  });
  const service = await store.approveApplication(application.applicationId, { initialStatus: 'active' });

  const first = await store.issueWebhookSecret(service.serviceCode, {
    environment: 'sandbox',
    reason: 'Issue initial sandbox webhook secret.',
    requestedBy: 'operator@orbi.example',
  });
  const second = await store.issueWebhookSecret(service.serviceCode, {
    environment: 'sandbox',
    reason: 'Issue replacement sandbox webhook secret.',
    requestedBy: 'operator@orbi.example',
  });

  const duringCutover = store.getService(service.serviceCode);
  assert.equal(duringCutover.webhookSecrets.find((secret) => secret.secretId === first.webhookSecret.secretId)?.status, 'pending_cutover');
  assert.equal(duringCutover.webhookSecrets.find((secret) => secret.secretId === second.webhookSecret.secretId)?.status, 'active');
  assert.equal(JSON.stringify(duringCutover).includes(first.oneTimeSecret), false);
  assert.equal(JSON.stringify(duringCutover).includes(second.oneTimeSecret), false);

  const revoked = await store.revokeWebhookSecret(service.serviceCode, second.webhookSecret.secretId, {
    revokedBy: 'operator@orbi.example',
    reason: 'Emergency webhook secret revoke after suspected exposure.',
  });
  assert.equal(revoked.webhookSecret.status, 'revoked');
});
