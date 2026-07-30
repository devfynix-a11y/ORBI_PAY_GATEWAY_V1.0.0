import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export type WebhookDeliveryRecord = {
  deliveryId: string;
  eventId: string;
  serviceCode: string;
  intentId?: string;
  resourceId?: string;
  eventType: string;
  payload?: Record<string, unknown>;
  callbackUrl?: string;
  status: 'pending' | 'delivered' | 'failed';
  attempt: number;
  statusCode?: number;
  error?: string;
  replayOf?: string;
  replayReason?: string;
  replayRequestedBy?: string;
  replayRequestId?: string;
  replayMetadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type WebhookDeliveryState = {
  deliveries: WebhookDeliveryRecord[];
};

const emptyState = (): WebhookDeliveryState => ({ deliveries: [] });

export class WebhookDeliveryStore {
  private state: WebhookDeliveryState;

  constructor(private readonly storePath = config.webhookDeliveryStorePath) {
    this.state = this.load();
  }

  record(input: Omit<WebhookDeliveryRecord, 'deliveryId' | 'createdAt' | 'updatedAt'>) {
    const now = new Date().toISOString();
    const record: WebhookDeliveryRecord = {
      ...input,
      deliveryId: `whdel_${crypto.randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    };
    this.state.deliveries.unshift(record);
    this.persist();
    return record;
  }

  list(filters: { serviceCode?: string; intentId?: string; status?: string } = {}) {
    return this.state.deliveries.filter((record) => {
      if (filters.serviceCode && record.serviceCode !== filters.serviceCode) return false;
      if (filters.intentId && record.intentId !== filters.intentId) return false;
      if (filters.status && record.status !== filters.status) return false;
      return true;
    });
  }

  get(deliveryId: string) {
    const record = this.state.deliveries.find((item) => item.deliveryId === deliveryId);
    if (!record) throw new Error('WEBHOOK_DELIVERY_NOT_FOUND');
    return record;
  }

  nextReplayAttempt(deliveryId: string) {
    const original = this.get(deliveryId);
    const existingReplays = this.state.deliveries.filter((item) => item.replayOf === deliveryId).length;
    return {
      original,
      attempt: existingReplays + 2,
    };
  }

  private load(): WebhookDeliveryState {
    try {
      if (!fs.existsSync(this.storePath)) return emptyState();
      const parsed = JSON.parse(fs.readFileSync(this.storePath, 'utf8')) as Partial<WebhookDeliveryState>;
      return {
        ...emptyState(),
        ...parsed,
      };
    } catch {
      return emptyState();
    }
  }

  private persist() {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, JSON.stringify(this.state, null, 2));
  }
}

export const webhookDeliveryStore = new WebhookDeliveryStore();
