import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { MessagingDeliveryStatus, MessagingIntent } from '../contracts/messagingIntentContract.js';

export type MessagingDeliveryRecord = {
  deliveryId: string;
  eventId: string;
  correlationId: string;
  threadId?: string;
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
  readBy?: string[];
  readAtBy?: Record<string, string>;
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
    const threadId = this.threadIdFor(intent);
    const record: MessagingDeliveryRecord = {
      deliveryId: `msgdel_${crypto.randomUUID()}`,
      eventId: intent.eventId,
      correlationId: intent.correlationId,
      threadId,
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
      readBy: [],
      readAtBy: {},
      safeMetadata: {
        ...(intent.safeMetadata || {}),
        threadId,
      },
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

  markRead(deliveryId: string, actorEmail: string) {
    const actor = actorEmail.trim().toLowerCase();
    if (!actor) throw new Error('MESSAGING_READ_ACTOR_REQUIRED');
    const record = this.state.deliveries.find((item) => item.deliveryId === deliveryId);
    if (!record) throw new Error('MESSAGING_DELIVERY_NOT_FOUND');
    this.applyRead(record, actor);
    this.persist();
    return record;
  }

  markThreadRead(threadId: string, actorEmail: string) {
    const actor = actorEmail.trim().toLowerCase();
    if (!actor) throw new Error('MESSAGING_READ_ACTOR_REQUIRED');
    const thread = threadId.trim();
    if (!thread) throw new Error('MESSAGING_THREAD_REQUIRED');
    const records = this.state.deliveries.filter((item) => item.threadId === thread || item.safeMetadata?.threadId === thread);
    for (const record of records) this.applyRead(record, actor);
    this.persist();
    return records;
  }

  private applyRead(record: MessagingDeliveryRecord, actor: string) {
    const now = new Date().toISOString();
    const readBy = new Set((record.readBy || []).map((item) => item.toLowerCase()));
    readBy.add(actor);
    record.readBy = [...readBy];
    record.readAtBy = {
      ...(record.readAtBy || {}),
      [actor]: now,
    };
    record.updatedAt = now;
  }

  private threadIdFor(intent: MessagingIntent) {
    const metadataThreadId = typeof intent.safeMetadata?.threadId === 'string' ? intent.safeMetadata.threadId.trim() : '';
    if (metadataThreadId) return metadataThreadId;
    const stableKey = [
      intent.serviceCode || 'general',
      intent.safeMetadata?.sentBy || 'orbi',
      intent.recipientIdentityRef,
    ].map((part) => String(part).trim().toLowerCase()).join(':');
    return `thread_${crypto.createHash('sha256').update(stableKey).digest('hex').slice(0, 24)}`;
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
