import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DeveloperPortalStore, developerPortalStore } from '../src/services/developerPortalStore.js';
import { buildDeveloperHealthSummary } from '../src/services/developerHealthService.js';
import { WebhookDeliveryStore, webhookDeliveryStore } from '../src/services/webhookDeliveryStore.js';

test('developer health summary reports warnings and webhook failure rate', async () => {
  const devStore = DeveloperPortalStore.inMemory();
  const deliveryStore = new WebhookDeliveryStore(path.join(os.tmpdir(), `orbi-wh-health-${crypto.randomUUID()}.json`));
  const originalListServices = developerPortalStore.listServices;
  const originalGetService = developerPortalStore.getService;
  const originalDeliveryList = webhookDeliveryStore.list;

  try {
    (developerPortalStore as any).listServices = devStore.listServices.bind(devStore);
    (developerPortalStore as any).getService = devStore.getService.bind(devStore);
    (webhookDeliveryStore as any).list = deliveryStore.list.bind(deliveryStore);

    const application = await devStore.submitApplication({
      legalName: 'ORBI Shop Limited',
      displayName: 'ORBI Shop',
      contactEmail: 'ops@orbishop.example',
      businessType: 'marketplace',
      countryCode: 'TZ',
      requestedEnvironments: ['sandbox'],
      requestedScopes: ['payments:create'],
      browserOrigins: [],
      redirectUrls: [],
      webhookUrls: [],
      useCases: ['Protected checkout'],
      termsAccepted: true,
    });
    const service = await devStore.approveApplication(application.applicationId, { initialStatus: 'draft' });
    deliveryStore.record({
      eventId: 'evt_failed',
      serviceCode: service.serviceCode,
      intentId: 'pi_failed',
      eventType: 'payment_intent.updated',
      status: 'failed',
      attempt: 1,
      statusCode: 503,
      error: 'PAY_SERVICE_WEBHOOK_HTTP_503',
    });

    const [summary] = await buildDeveloperHealthSummary(service.serviceCode);
    assert.equal(summary.serviceCode, service.serviceCode);
    assert.equal(summary.status, 'attention');
    assert.equal(summary.webhooks.failureRatePercent, 100);
    assert.equal(summary.warnings.includes('SERVICE_NOT_ACTIVE'), true);
    assert.equal(summary.warnings.includes('API_KEY_NOT_ACTIVE'), true);
    assert.equal(summary.warnings.includes('WEBHOOK_FAILURE_RATE_HIGH'), true);
  } finally {
    (developerPortalStore as any).listServices = originalListServices;
    (developerPortalStore as any).getService = originalGetService;
    (webhookDeliveryStore as any).list = originalDeliveryList;
  }
});
