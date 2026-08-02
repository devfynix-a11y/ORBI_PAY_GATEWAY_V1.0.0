import type { z } from 'zod';
import type { DeveloperPortalEventSchema } from '../contracts/developerPortalContract.js';
import type { MessagingIntent } from '../contracts/messagingIntentContract.js';
import { messagingDeliveryStore, type MessagingDeliveryStore } from './messagingDeliveryStore.js';
import { orbiTalkClient, type OrbiTalkClient } from './orbiTalkClient.js';

type DeveloperPortalEvent = z.infer<typeof DeveloperPortalEventSchema>;

const recipientFromEvent = (event: DeveloperPortalEvent): string =>
  String(
    event.data?.requestedBy ||
    event.data?.decidedBy ||
    event.data?.actorEmail ||
    event.data?.contactEmail ||
    event.data?.ownerEmail ||
    event.data?.email ||
    event.serviceCode ||
    'orbi-operator',
  );

const importantDeveloperEventTypes = new Set([
  'developer.service.approved',
  'developer.service_application.rejected',
  'developer.service.suspended',
  'developer.service.status_updated',
  'developer.api_key.rotation_requested',
  'developer.api_key.rotation_approved',
  'developer.api_key.rotation_rejected',
  'developer.api_key.rotated',
  'developer.api_key.emergency_rotated',
  'developer.api_key.revoked',
  'developer.webhook_secret.rotation_requested',
  'developer.webhook_secret.rotation_approved',
  'developer.webhook_secret.rotation_rejected',
  'developer.webhook_secret.rotated',
  'developer.webhook_secret.revoked',
  'developer.allowlist.updated',
  'developer.integration.failed',
  'developer.webhook_delivery.failed',
  'developer.account.lockout',
]);

const isImportantDeveloperEvent = (eventType: string): boolean =>
  importantDeveloperEventTypes.has(eventType)
  || eventType.includes('suspended')
  || eventType.includes('revoked')
  || eventType.includes('failed')
  || eventType.includes('lockout');

const directEmailForEvent = (event: DeveloperPortalEvent): { subject: string; body: string } | undefined => {
  if (!isImportantDeveloperEvent(event.eventType)) return undefined;
  const serviceCode = String(event.serviceCode || event.data?.serviceCode || 'your ORBI integration');
  const environment = environmentFromEvent(event) || 'sandbox';
  const status = String(event.data?.status || event.data?.nextStatus || '').trim();
  const reason = String(event.data?.reason || event.data?.decisionReason || event.data?.error || '').trim();
  const supportLine = 'If this was not expected, sign in to the ORBI Developer Portal and review your audit trail.';
  if (event.eventType === 'developer.service.approved') {
    return {
      subject: `ORBI integration approved: ${serviceCode}`,
      body: `Your ORBI integration ${serviceCode} has been approved for ${environment}. You can now continue with the approved credentials and permissions. ${supportLine}`,
    };
  }
  if (event.eventType === 'developer.service_application.rejected') {
    return {
      subject: `ORBI integration request rejected: ${serviceCode}`,
      body: `Your ORBI integration request for ${serviceCode} was rejected.${reason ? ` Reason: ${reason}.` : ''} Review the request and submit corrected details when ready.`,
    };
  }
  if (event.eventType === 'developer.service.suspended' || status === 'suspended') {
    return {
      subject: `ORBI integration suspended: ${serviceCode}`,
      body: `ORBI has suspended ${serviceCode}.${reason ? ` Reason: ${reason}.` : ''} Payments and sensitive access may be blocked until the issue is resolved. ${supportLine}`,
    };
  }
  if (event.eventType.includes('revoked')) {
    return {
      subject: `ORBI access revoked: ${serviceCode}`,
      body: `Access was revoked for ${serviceCode}.${reason ? ` Reason: ${reason}.` : ''} Review your integration security and contact ORBI support if you need assistance.`,
    };
  }
  if (event.eventType.includes('rotation') || event.eventType.includes('rotated')) {
    return {
      subject: `ORBI credential security update: ${serviceCode}`,
      body: `A credential security change occurred for ${serviceCode}. No secret is included in this email. Sign in to the ORBI Developer Portal to review the audited activity.`,
    };
  }
  if (event.eventType.includes('failed')) {
    return {
      subject: `ORBI integration needs attention: ${serviceCode}`,
      body: `ORBI detected a failed integration activity for ${serviceCode}.${reason ? ` Detail: ${reason}.` : ''} Review the event and retry only through the approved portal or SDK flow.`,
    };
  }
  if (event.eventType.includes('lockout')) {
    return {
      subject: 'ORBI portal security lockout',
      body: `ORBI detected repeated failed security attempts on your portal account.${reason ? ` Detail: ${reason}.` : ''} Wait for the lockout window or contact ORBI support if this was not you.`,
    };
  }
  return {
    subject: `ORBI developer account update: ${serviceCode}`,
    body: `There is an important ORBI developer account update for ${serviceCode}. ${supportLine}`,
  };
};

const templateForEvent = (eventType: string): string | undefined => {
  if (isImportantDeveloperEvent(eventType)) return 'developer.direct.email';
  return undefined;
};

const environmentFromEvent = (event: DeveloperPortalEvent): 'sandbox' | 'live' | undefined => {
  if (event.environment === 'sandbox' || event.environment === 'live') return event.environment;
  const dataEnvironment = String(event.data?.environment || '').toLowerCase();
  if (dataEnvironment === 'sandbox' || dataEnvironment === 'demo') return 'sandbox';
  if (dataEnvironment === 'live' || dataEnvironment === 'production') return 'live';
  return undefined;
};

const safeMetadataForEvent = (event: DeveloperPortalEvent): Record<string, unknown> => ({
  eventType: event.eventType,
  serviceCode: event.serviceCode,
  environment: event.environment,
  fingerprint: event.data?.fingerprint,
  previousKeyFingerprints: event.data?.previousKeyFingerprints,
  keyId: event.data?.keyId,
  status: event.data?.status,
  exposureType: event.data?.exposureType,
  revokePreviousImmediately: event.data?.revokePreviousImmediately,
  overlapMinutes: event.data?.overlapMinutes,
  reason: event.data?.reason || event.data?.decisionReason || event.data?.error,
});

export class DeveloperMessagingDispatcher {
  constructor(
    private readonly talkClient: OrbiTalkClient = orbiTalkClient,
    private readonly deliveryStore: MessagingDeliveryStore = messagingDeliveryStore,
  ) {}

  async handleDeveloperEvent(event: DeveloperPortalEvent) {
    const templateCode = templateForEvent(event.eventType);
    if (!templateCode) return;
    const directEmail = directEmailForEvent(event);
    const environment = environmentFromEvent(event);
    if (!environment) {
      this.deliveryStore.record({
        eventId: event.eventId,
        correlationId: event.eventId,
        templateCode,
        recipientIdentityRef: recipientFromEvent(event),
        language: 'en',
        channel: 'email',
        serviceCode: event.serviceCode,
        safeMetadata: {
          ...safeMetadataForEvent(event),
          ...(directEmail ? { emailSubject: directEmail.subject, emailBody: directEmail.body } : {}),
          dispatchBlocked: true,
          reason: 'MESSAGE_ENVIRONMENT_REQUIRED',
        },
      }, { status: 'failed', error: 'MESSAGE_ENVIRONMENT_REQUIRED' });
      return;
    }
    const intent: MessagingIntent = {
      eventId: event.eventId,
      correlationId: event.eventId,
      templateCode,
      recipientIdentityRef: recipientFromEvent(event),
      language: 'en',
      channel: 'email',
      serviceCode: event.serviceCode,
      environment,
      safeMetadata: {
        ...safeMetadataForEvent(event),
        ...(directEmail ? { emailSubject: directEmail.subject, emailBody: directEmail.body } : {}),
      },
    };
    const result = await this.talkClient.sendIntent(intent);
    this.deliveryStore.record(intent, result);
  }
}

export const developerMessagingDispatcher = new DeveloperMessagingDispatcher();
