import type { PayServiceDefinition } from '../types.js';
import type { DeveloperPortalStore } from './developerPortalStore.js';
import type { ConsentReceiptStore } from './consentReceiptStore.js';

export const subjectIdForConsent = (input: {
  userId?: string;
  customerId?: string;
  email?: string;
  phone?: string;
  identifier?: string;
}) => String(input.userId || input.customerId || input.email || input.phone || input.identifier || '').trim();

export class ServiceConsentGuard {
  constructor(
    private readonly portalStore: Pick<DeveloperPortalStore, 'getService'>,
    private readonly consentStore: Pick<ConsentReceiptStore, 'hasActiveConsent'>,
  ) {}

  assertServiceScopeGranted(service: PayServiceDefinition, scope: string) {
    const portalService = this.getPortalServiceIfConfigured(service);
    if (!portalService) return;
    if (!portalService.scopesGranted.includes(scope as any)) {
      throw new Error('PAY_SERVICE_SCOPE_NOT_GRANTED');
    }
  }

  async assertActiveConsent(
    service: PayServiceDefinition,
    input: {
      subjectId: string;
      scopes: string[];
      environment?: 'sandbox' | 'live';
    },
  ) {
    const portalService = this.getPortalServiceIfConfigured(service);
    if (!portalService) return;
    if (!input.subjectId) throw new Error('CONSENT_SUBJECT_REQUIRED');
    const hasConsent = await this.consentStore.hasActiveConsent({
      serviceCode: service.code,
      subjectId: input.subjectId,
      scopes: input.scopes,
      environment: input.environment,
    });
    if (!hasConsent) throw new Error('CONSENT_REQUIRED');
  }

  async assertScopedConsent(
    service: PayServiceDefinition,
    scope: string,
    input: {
      subjectId: string;
      environment?: 'sandbox' | 'live';
    },
  ) {
    this.assertServiceScopeGranted(service, scope);
    await this.assertActiveConsent(service, {
      subjectId: input.subjectId,
      scopes: [scope],
      environment: input.environment,
    });
  }

  private getPortalServiceIfConfigured(service: PayServiceDefinition) {
    try {
      return this.portalStore.getService(service.code);
    } catch {
      return null;
    }
  }
}
