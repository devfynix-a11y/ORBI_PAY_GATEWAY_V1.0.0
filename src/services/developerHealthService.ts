import { adapterRegistry } from '../adapters/AdapterRegistry.js';
import { developerPortalStore } from './developerPortalStore.js';
import { webhookDeliveryStore } from './webhookDeliveryStore.js';

const percent = (value: number) => Math.round(value * 1000) / 10;

const maxDate = (values: Array<string | undefined>) =>
  values
    .filter(Boolean)
    .sort()
    .at(-1);

export const buildDeveloperHealthSummary = async (serviceCode?: string) => {
  const services = serviceCode
    ? [developerPortalStore.getService(serviceCode)]
    : developerPortalStore.listServices();
  const providerReadiness = await adapterRegistry.readiness();

  return services.map((service) => {
    const deliveries = webhookDeliveryStore.list({ serviceCode: service.serviceCode });
    const failedDeliveries = deliveries.filter((delivery) => delivery.status === 'failed');
    const deliveredDeliveries = deliveries.filter((delivery) => delivery.status === 'delivered');
    const warnings: string[] = [];

    if (service.status !== 'active') warnings.push('SERVICE_NOT_ACTIVE');
    if (!service.keys?.some((key) => key.status === 'active')) warnings.push('API_KEY_NOT_ACTIVE');
    if (!service.webhookSecrets?.some((secret) => secret.status === 'active')) {
      warnings.push('WEBHOOK_SECRET_NOT_ACTIVE');
    }
    if (!service.redirectUrls?.length) warnings.push('REDIRECT_ALLOWLIST_EMPTY');
    if (!service.webhookUrls?.length) warnings.push('WEBHOOK_ALLOWLIST_EMPTY');
    if (service.scopesPending?.length) warnings.push('SCOPES_PENDING_REVIEW');
    if (deliveries.length && failedDeliveries.length / deliveries.length >= 0.2) {
      warnings.push('WEBHOOK_FAILURE_RATE_HIGH');
    }

    return {
      serviceCode: service.serviceCode,
      displayName: service.displayName,
      status: warnings.length ? 'attention' : 'healthy',
      serviceStatus: service.status,
      environments: service.environments,
      scopes: {
        granted: service.scopesGranted || [],
        pending: service.scopesPending || [],
      },
      keys: {
        status: service.keyStatus,
        active: service.keys?.filter((key) => key.status === 'active').length || 0,
        rotationPending: service.keys?.filter((key) => key.status === 'pending_cutover').length || 0,
      },
      webhooks: {
        secretStatus: service.webhookSecretStatus,
        activeSecrets: service.webhookSecrets?.filter((secret) => secret.status === 'active').length || 0,
        totalDeliveries: deliveries.length,
        delivered: deliveredDeliveries.length,
        failed: failedDeliveries.length,
        failureRatePercent: deliveries.length ? percent(failedDeliveries.length / deliveries.length) : 0,
        lastDeliveredAt: maxDate(deliveredDeliveries.map((delivery) => delivery.updatedAt)),
        lastFailedAt: maxDate(failedDeliveries.map((delivery) => delivery.updatedAt)),
        recentErrors: failedDeliveries.slice(0, 5).map((delivery) => ({
          deliveryId: delivery.deliveryId,
          eventId: delivery.eventId,
          intentId: delivery.intentId,
          statusCode: delivery.statusCode,
          error: delivery.error,
          updatedAt: delivery.updatedAt,
        })),
      },
      allowlists: {
        redirectUrls: service.redirectUrls || [],
        webhookUrls: service.webhookUrls || [],
      },
      providerReadiness,
      warnings,
      updatedAt: new Date().toISOString(),
    };
  });
};
