import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { redactAuditMetadata } from './auditEventSink.js';

export type OperatorAlert = {
  alertId?: string;
  alertType: string;
  severity: 'warning' | 'critical';
  title: string;
  message: string;
  occurredAt?: string;
  resource?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  runbook?: {
    name: string;
    steps: string[];
  };
};

type OperatorAlertSinkOptions = {
  sinkUrl?: string;
  sinkPath?: string;
  timeoutMs?: number;
  service?: string;
  environment?: string;
};

export class OperatorAlertSink {
  private readonly sinkUrl: string;
  private readonly sinkPath: string;
  private readonly timeoutMs: number;
  private readonly service: string;
  private readonly environment: string;

  constructor(options: OperatorAlertSinkOptions = {}) {
    this.sinkUrl = String(options.sinkUrl ?? config.observability.operatorAlertSinkUrl ?? '').trim();
    this.sinkPath = String(options.sinkPath ?? config.observability.operatorAlertSinkPath ?? '').trim();
    this.timeoutMs = Number(options.timeoutMs ?? config.observability.operatorAlertSinkTimeoutMs ?? 1500);
    this.service = options.service || 'orbi-payment-gateway';
    this.environment = options.environment || config.providerMode || 'unknown';
  }

  get enabled(): boolean {
    return Boolean(this.sinkUrl || this.sinkPath);
  }

  async send(alert: OperatorAlert): Promise<void> {
    if (!this.enabled) return;

    const payload = {
      alertId: alert.alertId || `alert_${crypto.randomUUID()}`,
      alertType: alert.alertType,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      occurredAt: alert.occurredAt || new Date().toISOString(),
      service: this.service,
      environment: this.environment,
      resource: redactAuditMetadata(alert.resource),
      metadata: redactAuditMetadata(alert.metadata),
      runbook: alert.runbook,
    };

    try {
      await Promise.all([
        this.sinkPath ? this.writeJsonl(payload) : Promise.resolve(),
        this.sinkUrl ? this.postJson(payload) : Promise.resolve(),
      ]);
    } catch (error: any) {
      logger.warn('operator_alert_sink.delivery_failed', {
        alertType: alert.alertType,
        severity: alert.severity,
        sinkUrlConfigured: Boolean(this.sinkUrl),
        sinkPathConfigured: Boolean(this.sinkPath),
        error: error?.message || String(error),
      });
    }
  }

  private async writeJsonl(payload: Record<string, unknown>): Promise<void> {
    const target = path.resolve(this.sinkPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.appendFile(target, `${JSON.stringify(payload)}\n`, 'utf8');
  }

  private async postJson(payload: Record<string, unknown>): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.sinkUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`OPERATOR_ALERT_SINK_HTTP_${response.status}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const operatorAlertSink = new OperatorAlertSink();
