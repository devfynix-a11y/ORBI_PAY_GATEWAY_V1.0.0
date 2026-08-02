import assert from 'node:assert/strict';
import { promises as dns } from 'node:dns';
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

test('developer portal store rejects service application with audit reason', async () => {
  const store = DeveloperPortalStore.inMemory();
  const application = await store.submitApplication({
    legalName: 'Unsafe Demo Merchant',
    displayName: 'Unsafe Demo',
    contactEmail: 'ops@unsafe.example',
    businessType: 'merchant',
    countryCode: 'TZ',
    requestedEnvironments: ['live'],
    requestedScopes: ['payments:create'],
    browserOrigins: ['https://unsafe.example'],
    redirectUrls: ['https://unsafe.example/return'],
    webhookUrls: ['https://unsafe.example/webhooks/orbi'],
    useCases: ['Live checkout'],
    termsAccepted: true,
  });

  const rejected = await store.rejectApplication(application.applicationId, {
    decidedBy: 'operator@orbifinancial.com',
    reason: 'Business verification is incomplete.',
  });

  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.decisionReason, 'Business verification is incomplete.');
  assert.equal(store.listServices().length, 0);
  assert.equal(store.listEvents().some((event) => event.eventType === 'developer.service_application.rejected'), true);
});

test('developer portal store grants sandbox scopes and provisions one-time credentials', async () => {
  const store = DeveloperPortalStore.inMemory();
  const application = await store.submitApplication({
    legalName: 'Tag POS Limited',
    displayName: 'Tag POS Sandbox',
    contactEmail: 'dev@tag.example',
    businessType: 'merchant',
    countryCode: 'TZ',
    requestedEnvironments: ['sandbox'],
    requestedScopes: ['identity:resolve', 'payments:create', 'escrow:create', 'webhooks:receive'],
    browserOrigins: ['http://localhost:3000'],
    redirectUrls: ['http://localhost:3000/orbi/return'],
    webhookUrls: ['http://localhost:3000/api/orbi/webhooks'],
    useCases: ['Sandbox POS checkout testing'],
    termsAccepted: true,
  }, { email: 'developer@tag.example', userId: 'portal_user_tag' });

  const service = await store.approveApplication(application.applicationId, {
    initialStatus: 'active',
    grantRequestedScopes: true,
  });
  const credentials = await store.provisionServiceCredentials(service.serviceCode, {
    environment: 'sandbox',
    requestedBy: 'developer@tag.example',
    reason: 'Issue first sandbox credentials during onboarding.',
  });

  assert.equal(service.status, 'active');
  assert.deepEqual(service.scopesPending, []);
  assert.equal(service.scopesGranted.includes('payments:create'), true);
  assert.equal(credentials.apiKeySecret.startsWith('orbi_sandbox_'), true);
  assert.equal(credentials.webhookSigningSecret.startsWith('orbi_whsec_sandbox_'), true);
  assert.equal(JSON.stringify(store.getService(service.serviceCode)).includes(credentials.apiKeySecret), false);
  assert.equal(JSON.stringify(store.getService(service.serviceCode)).includes(credentials.webhookSigningSecret), false);
});

test('developer portal automatic domain verification unlocks live credentials only after proof', async () => {
  const store = DeveloperPortalStore.inMemory();
  const application = await store.submitApplication({
    legalName: 'Verified Domain Merchant Ltd',
    displayName: 'Verified Domain Merchant',
    contactEmail: 'ops@verified.example',
    businessType: 'merchant',
    countryCode: 'TZ',
    requestedEnvironments: ['live'],
    requestedScopes: ['payments:create', 'webhooks:receive'],
    browserOrigins: ['https://checkout.verified.example'],
    redirectUrls: ['https://checkout.verified.example/orbi/return'],
    webhookUrls: ['https://hooks.verified.example/orbi/webhooks'],
    useCases: ['Live checkout with verified domains'],
    termsAccepted: true,
  });
  const service = await store.approveApplication(application.applicationId, {
    initialStatus: 'active',
    grantRequestedScopes: true,
  });

  await assert.rejects(
    () => store.provisionServiceCredentials(service.serviceCode, {
      environment: 'live',
      requestedBy: 'operator@orbi.example',
      reason: 'Attempt live key issue before domain proof.',
    }),
    /DEVELOPER_LIVE_DOMAIN_VERIFICATION_REQUIRED/,
  );

  const instructions = store.domainVerificationInstructions(service.serviceCode);
  assert.deepEqual(instructions.missingDomains.sort(), ['checkout.verified.example', 'hooks.verified.example']);
  assert.equal(instructions.challenges.length, 2);
  assert.equal(String(instructions.challenges[0]?.dnsRecordValue || '').startsWith('orbi-pay-site-verification=orbi_domain_'), true);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    const challenge = instructions.challenges.find((item) => String(url) === item.httpsUrl);
    return new Response(challenge?.token || 'wrong-token', { status: challenge ? 200 : 404 });
  }) as typeof fetch;

  try {
    const result = await store.verifyServiceDomainsAutomatically(service.serviceCode, {
      requestedBy: 'developer@verified.example',
    });
    assert.equal(result.pending.length, 0);
    assert.deepEqual(result.domainVerification.missingDomains, []);
    assert.equal(result.domainVerification.ready, true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const credentials = await store.provisionServiceCredentials(service.serviceCode, {
    environment: 'live',
    requestedBy: 'operator@orbi.example',
    reason: 'Issue live credentials after automatic domain proof.',
  });
  assert.equal(credentials.apiKeySecret.startsWith('orbi_live_'), true);
  assert.equal(credentials.webhookSigningSecret.startsWith('orbi_whsec_live_'), true);
});

test('developer portal automatic domain verification rejects domains outside service allowlist', async () => {
  const store = DeveloperPortalStore.inMemory();
  const application = await store.submitApplication({
    legalName: 'Strict Domain Merchant Ltd',
    displayName: 'Strict Domain Merchant',
    contactEmail: 'ops@strict.example',
    businessType: 'merchant',
    countryCode: 'TZ',
    requestedEnvironments: ['live'],
    requestedScopes: ['payments:create'],
    browserOrigins: ['https://strict.example'],
    redirectUrls: ['https://strict.example/orbi/return'],
    webhookUrls: ['https://strict.example/orbi/webhooks'],
    useCases: ['Strict allowlist verification'],
    termsAccepted: true,
  });
  const service = await store.approveApplication(application.applicationId, { initialStatus: 'active' });

  await assert.rejects(
    () => store.verifyServiceDomainsAutomatically(service.serviceCode, {
      domains: ['attacker.example'],
      requestedBy: 'developer@strict.example',
    }),
    /DEVELOPER_DOMAIN_NOT_ON_ALLOWLIST/,
  );
});

test('developer portal automatic domain verification accepts DNS TXT proof', async () => {
  const store = DeveloperPortalStore.inMemory();
  const application = await store.submitApplication({
    legalName: 'DNS Domain Merchant Ltd',
    displayName: 'DNS Domain Merchant',
    contactEmail: 'ops@dns-domain.example',
    businessType: 'merchant',
    countryCode: 'TZ',
    requestedEnvironments: ['live'],
    requestedScopes: ['payments:create'],
    browserOrigins: ['https://dns-domain.example'],
    redirectUrls: ['https://dns-domain.example/orbi/return'],
    webhookUrls: ['https://dns-domain.example/orbi/webhooks'],
    useCases: ['DNS TXT verification'],
    termsAccepted: true,
  });
  const service = await store.approveApplication(application.applicationId, { initialStatus: 'active' });
  const instructions = store.domainVerificationInstructions(service.serviceCode);
  const challenge = instructions.challenges[0];
  const originalResolveTxt = dns.resolveTxt;
  dns.resolveTxt = (async (hostname: string) => {
    assert.equal(hostname, challenge.dnsRecordName);
    return [[challenge.dnsRecordValue]];
  }) as typeof dns.resolveTxt;

  try {
    const result = await store.verifyServiceDomainsAutomatically(service.serviceCode, {
      requestedBy: 'developer@dns-domain.example',
    });
    assert.deepEqual(result.pending, []);
    assert.deepEqual(result.verifiedDomains, ['dns-domain.example']);
    assert.equal(result.domainVerification.ready, true);
    assert.equal(result.domainVerification.metadata.challenges?.['dns-domain.example']?.verificationMethod, 'dns_txt');
  } finally {
    dns.resolveTxt = originalResolveTxt;
  }
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

  const alphaService = await store.approveApplication(first.applicationId, {});
  const betaService = await store.approveApplication(second.applicationId, {});
  const alphaScopeRequest = await store.submitScopeRequest(alphaService.serviceCode, {
    requestedScopes: ['escrow:read'],
    reason: 'Read PaySafe status for Alpha-owned checkout transactions.',
    environment: 'sandbox',
  });
  await store.submitScopeRequest(betaService.serviceCode, {
    requestedScopes: ['balance:read'],
    reason: 'Read approved balance data for Beta-owned customer profiles.',
    environment: 'sandbox',
  });

  const alphaFilter = { ownerEmail: 'developer@alpha.example', serviceCodes: [] };
  assert.deepEqual(store.listApplications(undefined, alphaFilter).map((item) => item.applicationId), [first.applicationId]);
  assert.deepEqual(store.listServices(alphaFilter).map((item) => item.serviceCode), ['alpha-merchant']);
  assert.deepEqual(store.listScopeRequests(alphaFilter).map((item) => item.requestId), [alphaScopeRequest.requestId]);
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
  await assert.rejects(
    () => store.submitScopeRequest(service.serviceCode, {
      requestedScopes: ['balance:read'],
      reason: 'Attempt to request a permission that is already granted.',
      environment: 'sandbox',
    }),
    /DEVELOPER_SCOPE_ALREADY_GRANTED/,
  );
  await assert.rejects(
    () => store.submitScopeRequest(service.serviceCode, {
      requestedScopes: ['payment_profile:read'],
      reason: 'Attempt to duplicate a permission that is already pending.',
      environment: 'sandbox',
    }),
    /DEVELOPER_SCOPE_ALREADY_PENDING/,
  );
  await assert.rejects(
    () => store.submitScopeRequest(service.serviceCode, {
      requestedScopes: ['payments:create'],
      reason: 'Attempt to request access in an environment not enabled for this service.',
      environment: 'live',
    }),
    /DEVELOPER_SCOPE_ENVIRONMENT_NOT_ENABLED/,
  );
  await assert.rejects(
    () => store.decideScopeRequest(scopeRequest.requestId, {
      decision: 'reject',
      reason: 'A decided permission request cannot be reviewed for a second time.',
      decidedBy: 'other-operator@orbi.example',
    }),
    /DEVELOPER_SCOPE_REQUEST_ALREADY_DECIDED/,
  );

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

test('developer portal emergency key rotation issues a one-time secret and audits old key status', async () => {
  const store = DeveloperPortalStore.inMemory();
  const application = await store.submitApplication({
    legalName: 'Emergency Merchant Ltd',
    displayName: 'Emergency Merchant',
    contactEmail: 'ops@emergency.example',
    businessType: 'merchant',
    countryCode: 'TZ',
    requestedEnvironments: ['live'],
    requestedScopes: ['payments:create'],
    browserOrigins: ['https://emergency.example'],
    redirectUrls: ['https://emergency.example/orbi/return'],
    webhookUrls: ['https://emergency.example/api/orbi/webhooks'],
    useCases: ['Emergency key recovery'],
    termsAccepted: true,
  });
  const service = await store.approveApplication(application.applicationId, { initialStatus: 'active' });
  await store.verifyServiceDomains(service.serviceCode, {
    domains: ['emergency.example'],
    verifiedBy: 'operator@orbi.example',
    verificationMethod: 'manual_review',
    reason: 'Verified live domain ownership before issuing credentials.',
  });
  const first = await store.issueApiKey(service.serviceCode, {
    environment: 'live',
    reason: 'Issue initial live key for emergency rotation test.',
    requestedBy: 'operator@orbi.example',
  });

  const rotated = await store.emergencyRotateApiKey(service.serviceCode, {
    environment: 'live',
    reason: 'Confirmed live API key exposure during incident response.',
    requestedBy: 'developer@emergency.example',
    exposureType: 'confirmed_exposure',
  });

  assert.equal(rotated.oneTimeSecret.startsWith('orbi_live_'), true);
  assert.equal(rotated.previousKeys[0]?.nextStatus, 'revoked');
  assert.equal(JSON.stringify(store.getService(service.serviceCode)).includes(rotated.oneTimeSecret), false);
  assert.equal(store.resolveApiKey(first.oneTimeSecret), undefined);
  assert.equal(store.resolveApiKey(rotated.oneTimeSecret)?.key.keyId, rotated.key.keyId);
  assert.equal(store.getService(service.serviceCode).keys.find((key) => key.keyId === first.key.keyId)?.status, 'revoked');
  assert.equal(store.listEvents(service.serviceCode).some((event) => event.eventType === 'developer.api_key.emergency_rotated'), true);
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
