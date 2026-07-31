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
    event.data?.contactEmail ||
    event.data?.ownerEmail ||
    event.serviceCode ||
    'orbi-operator',
  );

const templateForEvent = (eventType: string): string | undefined => {
  if (eventType === 'developer.api_key.rotation_requested') return 'developer.api_key.rotation_requested';
  if (eventType === 'developer.api_key.emergency_rotated') return 'developer.api_key.emergency_rotated';
  if (eventType === 'developer.service.approved') return 'developer.service.approved';
  if (eventType === 'developer.allowlist.updated') return 'developer.domain.allowlist.updated';
  if (eventType === 'developer.webhook_secret.rotation_requested') return 'developer.webhook_secret.rotation_requested';
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
});

export class DeveloperMessagingDispatcher {
  constructor(
    private readonly talkClient: OrbiTalkClient = orbiTalkClient,
    private readonly deliveryStore: MessagingDeliveryStore = messagingDeliveryStore,
  ) {}

  async handleDeveloperEvent(event: DeveloperPortalEvent) {
    const templateCode = templateForEvent(event.eventType);
    if (!templateCode) return;
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
      safeMetadata: safeMetadataForEvent(event),
    };
    const result = await this.talkClient.sendIntent(intent);
    this.deliveryStore.record(intent, result);
  }
}

export const developerMessagingDispatcher = new DeveloperMessagingDispatcher();
