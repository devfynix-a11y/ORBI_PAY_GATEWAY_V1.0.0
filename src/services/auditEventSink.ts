import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';

export type AuditEventSeverity = 'debug' | 'info' | 'warning' | 'error' | 'critical';
export type AuditEventOutcome = 'success' | 'failure' | 'denied' | 'pending' | 'unknown';

export type AuditEvent = {
  eventId?: string;
  eventType: string;
  severity?: AuditEventSeverity;
  outcome?: AuditEventOutcome;
  occurredAt?: string;
  requestId?: string;
  traceId?: string;
  correlationId?: string;
  actor?: Record<string, unknown>;
  resource?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

type AuditEventSinkOptions = {
  sinkUrl?: string;
  sinkPath?: string;
  timeoutMs?: number;
  service?: string;
  environment?: string;
};

const sensitiveKeyPattern = /(secret|password|token|authorization|signature|api[-_]?key|private[-_]?key|otp|pin)/i;

export const redactAuditMetadata = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => redactAuditMetadata(item));
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      sensitiveKeyPattern.test(key) ? '[REDACTED]' : redactAuditMetadata(entry),
    ]),
  );
};

export class AuditEventSink {
  private readonly sinkUrl: string;
  private readonly sinkPath: string;
  private readonly timeoutMs: number;
  private readonly service: string;
  private readonly environment: string;

  constructor(options: AuditEventSinkOptions = {}) {
    this.sinkUrl = String(options.sinkUrl ?? config.observability.auditEventSinkUrl ?? '').trim();
    this.sinkPath = String(options.sinkPath ?? config.observability.auditEventSinkPath ?? '').trim();
    this.timeoutMs = Number(options.timeoutMs ?? config.observability.auditEventSinkTimeoutMs ?? 1500);
    this.service = options.service || 'orbi-payment-gateway';
    this.environment = options.environment || config.providerMode || 'unknown';
  }

  get enabled(): boolean {
    return Boolean(this.sinkUrl || this.sinkPath);
  }

  async emit(event: AuditEvent): Promise<void> {
    if (!this.enabled) return;

    const payload = {
      eventId: event.eventId || crypto.randomUUID(),
      eventType: event.eventType,
      severity: event.severity || 'info',
      outcome: event.outcome || 'unknown',
      occurredAt: event.occurredAt || new Date().toISOString(),
      service: this.service,
      environment: this.environment,
      requestId: event.requestId,
      traceId: event.traceId,
      correlationId: event.correlationId,
      actor: redactAuditMetadata(event.actor),
      resource: redactAuditMetadata(event.resource),
      metadata: redactAuditMetadata(event.metadata),
    };

    try {
      await Promise.all([
        this.sinkPath ? this.writeJsonl(payload) : Promise.resolve(),
        this.sinkUrl ? this.postJson(payload) : Promise.resolve(),
      ]);
    } catch (error: any) {
      logger.warn('audit_event_sink.delivery_failed', {
        eventType: event.eventType,
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
      if (!response.ok) {
        throw new Error(`AUDIT_EVENT_SINK_HTTP_${response.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const auditEventSink = new AuditEventSink();
