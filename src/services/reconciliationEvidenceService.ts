import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { PaymentIntent, PaymentIntentStatus } from '../types.js';
import { paymentIntentStore, type PaymentIntentStore } from './paymentIntentStore.js';
import { webhookDeliveryStore, type WebhookDeliveryRecord, type WebhookDeliveryStore } from './webhookDeliveryStore.js';

export type ReconciliationEvidenceInput = {
  from?: string;
  to?: string;
  serviceCode?: string;
  requestedBy?: string;
  requestId?: string;
};

export type ReconciliationEvidenceReport = {
  reportId: string;
  reportType: 'gateway_reconciliation_evidence';
  version: '2026-07-30';
  generatedAt: string;
  environment: string;
  window: {
    from: string;
    to: string;
  };
  filters: {
    serviceCode?: string;
  };
  summary: {
    paymentIntentCount: number;
    webhookDeliveryCount: number;
    exceptionCount: number;
    byStatus: Record<string, number>;
    byCurrency: Record<string, { count: number; amount: number }>;
    webhookByStatus: Record<string, number>;
    exceptionsBySeverity: Record<string, number>;
    exceptionsByType: Record<string, number>;
  };
  records: {
    paymentIntents: Array<{
      id: string;
      serviceCode: string;
      operation: string;
      paymentCategory?: string;
      paymentRail?: string;
      providerCode?: string;
      reference: string;
      amount: number;
      currency: string;
      status: PaymentIntentStatus;
      coreTransactionId?: string;
      webhookAttempted: boolean;
      webhookDelivered: boolean;
      createdAt: string;
      updatedAt: string;
    }>;
    webhookDeliveries: Array<{
      deliveryId: string;
      eventId: string;
      serviceCode: string;
      intentId?: string;
      eventType: string;
      status: string;
      attempt: number;
      statusCode?: number;
      replayOf?: string;
      createdAt: string;
      updatedAt: string;
    }>;
  };
  exceptions: Array<{
    id: string;
    type:
      | 'payment_intent_stuck'
      | 'payment_intent_core_submission_failed'
      | 'webhook_delivery_failed'
      | 'webhook_delivery_pending'
      | 'payment_intent_webhook_missing';
    severity: 'warning' | 'critical';
    serviceCode: string;
    intentId?: string;
    deliveryId?: string;
    reference?: string;
    status?: string;
    ageMinutes?: number;
    message: string;
  }>;
  requestedBy?: string;
  requestId?: string;
  reportHash: string;
  signature: {
    algorithm: 'HMAC-SHA256';
    keyId: string;
    value: string;
  };
};

type ReconciliationEvidenceServiceOptions = {
  paymentStore?: PaymentIntentStore;
  webhookStore?: WebhookDeliveryStore;
  exportPath?: string;
  signingSecret?: string;
  signingKeyId?: string;
  environment?: string;
  stuckIntentMinutes?: number;
  webhookPendingMinutes?: number;
};

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const increment = (target: Record<string, number>, key: string) => {
  target[key] = (target[key] || 0) + 1;
};

const addCurrency = (
  target: Record<string, { count: number; amount: number }>,
  currency: string,
  amount: number,
) => {
  const current = target[currency] || { count: 0, amount: 0 };
  target[currency] = {
    count: current.count + 1,
    amount: Number((current.amount + amount).toFixed(2)),
  };
};

const defaultWindow = () => {
  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
};

export class ReconciliationEvidenceService {
  private readonly paymentStore: PaymentIntentStore;
  private readonly webhookStore: WebhookDeliveryStore;
  private readonly exportPath: string;
  private readonly signingSecret: string;
  private readonly signingKeyId: string;
  private readonly environment: string;
  private readonly stuckIntentMinutes: number;
  private readonly webhookPendingMinutes: number;

  constructor(options: ReconciliationEvidenceServiceOptions = {}) {
    this.paymentStore = options.paymentStore || paymentIntentStore;
    this.webhookStore = options.webhookStore || webhookDeliveryStore;
    this.exportPath = String(options.exportPath ?? config.reconciliation.exportPath ?? '').trim();
    this.signingSecret =
      options.signingSecret || config.worker.signingSecret || config.security.serviceAccessTokenSecret || '';
    this.signingKeyId = options.signingKeyId || config.worker.keyId || 'payment-gateway-reconciliation';
    this.environment = options.environment || config.providerMode || 'unknown';
    this.stuckIntentMinutes = Number(options.stuckIntentMinutes ?? config.reconciliation.stuckIntentMinutes ?? 30);
    this.webhookPendingMinutes = Number(options.webhookPendingMinutes ?? config.reconciliation.webhookPendingMinutes ?? 10);
  }

  generate(input: ReconciliationEvidenceInput = {}): ReconciliationEvidenceReport {
    if (!this.signingSecret) throw new Error('RECONCILIATION_EVIDENCE_SIGNING_SECRET_REQUIRED');
    const fallbackWindow = defaultWindow();
    const from = input.from || fallbackWindow.from;
    const to = input.to || fallbackWindow.to;

    const paymentIntents = this.paymentStore.list({
      serviceCode: input.serviceCode,
      from,
      to,
    });
    const webhookDeliveries = this.webhookStore.list({
      serviceCode: input.serviceCode,
      from,
      to,
    });

    const byStatus: Record<string, number> = {};
    const byCurrency: Record<string, { count: number; amount: number }> = {};
    const webhookByStatus: Record<string, number> = {};
    const exceptionsBySeverity: Record<string, number> = {};
    const exceptionsByType: Record<string, number> = {};

    for (const intent of paymentIntents) {
      increment(byStatus, intent.status);
      addCurrency(byCurrency, intent.currency, intent.amount);
    }

    for (const delivery of webhookDeliveries) {
      increment(webhookByStatus, delivery.status);
    }

    const exceptions = this.detectExceptions(paymentIntents, webhookDeliveries, to);
    for (const exception of exceptions) {
      increment(exceptionsBySeverity, exception.severity);
      increment(exceptionsByType, exception.type);
    }

    const unsigned = {
      reportId: `recon_${crypto.randomUUID()}`,
      reportType: 'gateway_reconciliation_evidence' as const,
      version: '2026-07-30' as const,
      generatedAt: new Date().toISOString(),
      environment: this.environment,
      window: { from, to },
      filters: {
        ...(input.serviceCode ? { serviceCode: input.serviceCode } : {}),
      },
      summary: {
        paymentIntentCount: paymentIntents.length,
        webhookDeliveryCount: webhookDeliveries.length,
        exceptionCount: exceptions.length,
        byStatus,
        byCurrency,
        webhookByStatus,
        exceptionsBySeverity,
        exceptionsByType,
      },
      records: {
        paymentIntents: paymentIntents.map((intent) => this.publicIntentRecord(intent)),
        webhookDeliveries: webhookDeliveries.map((delivery) => this.publicWebhookRecord(delivery)),
      },
      exceptions,
      ...(input.requestedBy ? { requestedBy: input.requestedBy } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    };

    const reportHash = crypto.createHash('sha256').update(stableJson(unsigned)).digest('hex');
    const signatureValue = crypto.createHmac('sha256', this.signingSecret).update(reportHash).digest('hex');

    return {
      ...unsigned,
      reportHash,
      signature: {
        algorithm: 'HMAC-SHA256',
        keyId: this.signingKeyId,
        value: signatureValue,
      },
    };
  }

  async export(input: ReconciliationEvidenceInput = {}) {
    const report = this.generate(input);
    if (!this.exportPath) return { report };

    const targetDirectory = path.resolve(this.exportPath);
    await fs.mkdir(targetDirectory, { recursive: true });
    const safeWindow = report.window.to.slice(0, 10);
    const targetPath = path.join(targetDirectory, `${report.reportId}-${report.environment}-${safeWindow}.json`);
    await fs.writeFile(targetPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return { report, path: targetPath };
  }

  private publicIntentRecord(intent: PaymentIntent) {
    return {
      id: intent.id,
      serviceCode: intent.serviceCode,
      operation: intent.operation,
      paymentCategory: intent.paymentCategory,
      paymentRail: intent.paymentRail,
      providerCode: intent.providerCode,
      reference: intent.reference,
      amount: intent.amount,
      currency: intent.currency,
      status: intent.status,
      coreTransactionId: intent.coreResult?.transactionId,
      webhookAttempted: Boolean(intent.webhookDelivery?.attempted),
      webhookDelivered: Boolean(intent.webhookDelivery?.delivered),
      createdAt: intent.createdAt,
      updatedAt: intent.updatedAt,
    };
  }

  private publicWebhookRecord(delivery: WebhookDeliveryRecord) {
    return {
      deliveryId: delivery.deliveryId,
      eventId: delivery.eventId,
      serviceCode: delivery.serviceCode,
      intentId: delivery.intentId,
      eventType: delivery.eventType,
      status: delivery.status,
      attempt: delivery.attempt,
      statusCode: delivery.statusCode,
      replayOf: delivery.replayOf,
      createdAt: delivery.createdAt,
      updatedAt: delivery.updatedAt,
    };
  }

  private detectExceptions(paymentIntents: PaymentIntent[], webhookDeliveries: WebhookDeliveryRecord[], to: string) {
    const reportToMs = Number.isFinite(Date.parse(to)) ? Date.parse(to) : Date.now();
    const latestWebhookByIntent = new Map<string, WebhookDeliveryRecord>();
    for (const delivery of webhookDeliveries) {
      if (!delivery.intentId) continue;
      const existing = latestWebhookByIntent.get(delivery.intentId);
      if (!existing || delivery.updatedAt > existing.updatedAt) latestWebhookByIntent.set(delivery.intentId, delivery);
    }

    const exceptions: ReconciliationEvidenceReport['exceptions'] = [];

    for (const intent of paymentIntents) {
      const ageMinutes = Math.max(0, Math.floor((reportToMs - Date.parse(intent.updatedAt)) / 60000));
      const isStuckStatus = ['requires_confirmation', 'requires_action', 'submitted_to_core', 'processing', 'pending']
        .includes(intent.status);
      if (isStuckStatus && ageMinutes >= this.stuckIntentMinutes) {
        exceptions.push({
          id: `ex_${crypto.createHash('sha256').update(`stuck:${intent.id}`).digest('hex').slice(0, 24)}`,
          type: 'payment_intent_stuck',
          severity: 'warning',
          serviceCode: intent.serviceCode,
          intentId: intent.id,
          reference: intent.reference,
          status: intent.status,
          ageMinutes,
          message: 'Payment intent has remained in a non-final state beyond the reconciliation threshold.',
        });
      }

      if (intent.coreSubmission && !intent.coreSubmission.submitted) {
        exceptions.push({
          id: `ex_${crypto.createHash('sha256').update(`core_failed:${intent.id}`).digest('hex').slice(0, 24)}`,
          type: 'payment_intent_core_submission_failed',
          severity: 'critical',
          serviceCode: intent.serviceCode,
          intentId: intent.id,
          reference: intent.reference,
          status: intent.status,
          message: 'Payment intent has a failed Core submission and needs operator review.',
        });
      }

      if (['completed', 'failed'].includes(intent.status)) {
        const latestDelivery = latestWebhookByIntent.get(intent.id);
        if (!latestDelivery || latestDelivery.status !== 'delivered') {
          exceptions.push({
            id: `ex_${crypto.createHash('sha256').update(`missing_webhook:${intent.id}`).digest('hex').slice(0, 24)}`,
            type: 'payment_intent_webhook_missing',
            severity: 'warning',
            serviceCode: intent.serviceCode,
            intentId: intent.id,
            reference: intent.reference,
            status: intent.status,
            message: 'Payment intent is final but no delivered webhook evidence exists in the report window.',
          });
        }
      }
    }

    for (const delivery of webhookDeliveries) {
      const ageMinutes = Math.max(0, Math.floor((reportToMs - Date.parse(delivery.updatedAt)) / 60000));
      if (delivery.status === 'failed') {
        exceptions.push({
          id: `ex_${crypto.createHash('sha256').update(`webhook_failed:${delivery.deliveryId}`).digest('hex').slice(0, 24)}`,
          type: 'webhook_delivery_failed',
          severity: 'critical',
          serviceCode: delivery.serviceCode,
          intentId: delivery.intentId,
          deliveryId: delivery.deliveryId,
          status: delivery.status,
          ageMinutes,
          message: 'Webhook delivery failed and should be replayed or investigated.',
        });
      }
      if (delivery.status === 'pending' && ageMinutes >= this.webhookPendingMinutes) {
        exceptions.push({
          id: `ex_${crypto.createHash('sha256').update(`webhook_pending:${delivery.deliveryId}`).digest('hex').slice(0, 24)}`,
          type: 'webhook_delivery_pending',
          severity: 'warning',
          serviceCode: delivery.serviceCode,
          intentId: delivery.intentId,
          deliveryId: delivery.deliveryId,
          status: delivery.status,
          ageMinutes,
          message: 'Webhook delivery has remained pending beyond the reconciliation threshold.',
        });
      }
    }

    return exceptions.sort((a, b) => {
      const severityRank = { critical: 0, warning: 1 };
      return severityRank[a.severity] - severityRank[b.severity] || a.type.localeCompare(b.type);
    });
  }
}

export const reconciliationEvidenceService = new ReconciliationEvidenceService();
