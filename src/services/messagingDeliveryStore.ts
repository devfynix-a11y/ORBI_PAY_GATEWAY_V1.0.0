import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { MessagingDeliveryStatus, MessagingIntent } from '../contracts/messagingIntentContract.js';

export type MessagingDeliveryRecord = {
  deliveryId: string;
  eventId: string;
  correlationId: string;
  serviceCode?: string;
  environment?: 'sandbox' | 'live';
  templateCode: string;
  channel: string;
  language: string;
  recipientIdentityRef: string;
  status: MessagingDeliveryStatus;
  providerMessageId?: string;
  statusCode?: number;
  error?: string;
  attempt: number;
  safeMetadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type MessagingDeliveryState = {
  deliveries: MessagingDeliveryRecord[];
};

const emptyState = (): MessagingDeliveryState => ({ deliveries: [] });

export class MessagingDeliveryStore {
  private state: MessagingDeliveryState;

  constructor(private readonly storePath = config.messagingDeliveryStorePath) {
    this.state = this.load();
  }

  static inMemory() {
    return new MessagingDeliveryStore('');
  }

  record(intent: MessagingIntent, result: {
    status: MessagingDeliveryStatus;
    providerMessageId?: string;
    statusCode?: number;
    error?: string;
  }) {
    const now = new Date().toISOString();
    const previousAttempts = this.state.deliveries.filter((item) => item.eventId === intent.eventId).length;
    const record: MessagingDeliveryRecord = {
      deliveryId: `msgdel_${crypto.randomUUID()}`,
      eventId: intent.eventId,
      correlationId: intent.correlationId,
      serviceCode: intent.serviceCode,
      environment: intent.environment,
      templateCode: intent.templateCode,
      channel: intent.channel,
      language: intent.language,
      recipientIdentityRef: intent.recipientIdentityRef,
      status: result.status,
      providerMessageId: result.providerMessageId,
      statusCode: result.statusCode,
      error: result.error,
      attempt: previousAttempts + 1,
      safeMetadata: intent.safeMetadata,
      createdAt: now,
      updatedAt: now,
    };
    this.state.deliveries.unshift(record);
    this.persist();
    return record;
  }

  list(filters: { serviceCode?: string; eventId?: string; status?: string; environment?: string } = {}) {
    return this.state.deliveries.filter((record) => {
      if (filters.serviceCode && record.serviceCode !== filters.serviceCode) return false;
      if (filters.eventId && record.eventId !== filters.eventId) return false;
      if (filters.status && record.status !== filters.status) return false;
      if (filters.environment && record.environment !== filters.environment) return false;
      return true;
    });
  }

  private load(): MessagingDeliveryState {
    if (!this.storePath) return emptyState();
    try {
      if (!fs.existsSync(this.storePath)) return emptyState();
      const parsed = JSON.parse(fs.readFileSync(this.storePath, 'utf8')) as Partial<MessagingDeliveryState>;
      return { ...emptyState(), ...parsed };
    } catch {
      return emptyState();
    }
  }

  private persist() {
    if (!this.storePath) return;
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, JSON.stringify(this.state, null, 2));
  }
}

export const messagingDeliveryStore = new MessagingDeliveryStore();

