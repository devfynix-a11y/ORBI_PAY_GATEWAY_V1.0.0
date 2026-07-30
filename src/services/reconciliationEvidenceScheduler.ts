import { config } from '../config.js';
import { logger } from '../logger.js';
import { auditEventSink } from './auditEventSink.js';
import { reconciliationEvidenceService, type ReconciliationEvidenceService } from './reconciliationEvidenceService.js';

type ReconciliationEvidenceSchedulerOptions = {
  service?: ReconciliationEvidenceService;
  enabled?: boolean;
  intervalMinutes?: number;
  windowHours?: number;
  runOnStart?: boolean;
  requestedBy?: string;
};

export class ReconciliationEvidenceScheduler {
  private readonly service: ReconciliationEvidenceService;
  private readonly enabled: boolean;
  private readonly intervalMinutes: number;
  private readonly windowHours: number;
  private readonly runOnStart: boolean;
  private readonly requestedBy: string;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(options: ReconciliationEvidenceSchedulerOptions = {}) {
    this.service = options.service || reconciliationEvidenceService;
    this.enabled = Boolean(options.enabled ?? config.reconciliation.scheduleEnabled);
    this.intervalMinutes = Math.max(1, Number(options.intervalMinutes ?? config.reconciliation.scheduleIntervalMinutes));
    this.windowHours = Math.max(1, Number(options.windowHours ?? config.reconciliation.scheduleWindowHours));
    this.runOnStart = Boolean(options.runOnStart ?? config.reconciliation.scheduleRunOnStart);
    this.requestedBy = options.requestedBy || 'gateway-scheduled-reconciliation';
  }

  start() {
    if (!this.enabled) {
      logger.info('reconciliation_scheduler_disabled', {
        intervalMinutes: this.intervalMinutes,
        windowHours: this.windowHours,
      });
      return;
    }

    if (this.timer) return;
    const intervalMs = this.intervalMinutes * 60 * 1000;
    this.timer = setInterval(() => {
      void this.runOnce('interval');
    }, intervalMs);
    this.timer.unref?.();

    logger.info('reconciliation_scheduler_started', {
      intervalMinutes: this.intervalMinutes,
      windowHours: this.windowHours,
      runOnStart: this.runOnStart,
    });

    if (this.runOnStart) {
      void this.runOnce('startup');
    }
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async runOnce(trigger: 'startup' | 'interval' | 'manual' = 'manual') {
    if (this.running) {
      logger.warn('reconciliation_scheduler_run_skipped', { trigger, reason: 'already_running' });
      return { skipped: true as const, reason: 'already_running' };
    }

    this.running = true;
    const to = new Date();
    const from = new Date(to.getTime() - this.windowHours * 60 * 60 * 1000);

    try {
      const result = await this.service.export({
        from: from.toISOString(),
        to: to.toISOString(),
        requestedBy: this.requestedBy,
      });
      logger.info('reconciliation_scheduler_run_completed', {
        trigger,
        reportId: result.report.reportId,
        exportedPath: result.path,
        exceptionCount: result.report.summary.exceptionCount,
        paymentIntentCount: result.report.summary.paymentIntentCount,
        webhookDeliveryCount: result.report.summary.webhookDeliveryCount,
      });
      void auditEventSink.emit({
        eventType: 'reconciliation.evidence.scheduled_export_completed',
        severity: result.report.summary.exceptionCount > 0 ? 'warning' : 'info',
        outcome: 'success',
        actor: { requestedBy: this.requestedBy },
        resource: {
          type: 'reconciliation_evidence_report',
          id: result.report.reportId,
        },
        metadata: {
          trigger,
          exportedPath: result.path,
          exceptionCount: result.report.summary.exceptionCount,
          paymentIntentCount: result.report.summary.paymentIntentCount,
          webhookDeliveryCount: result.report.summary.webhookDeliveryCount,
          from: result.report.window.from,
          to: result.report.window.to,
        },
      });
      return { skipped: false as const, result };
    } catch (error: any) {
      logger.error('reconciliation_scheduler_run_failed', {
        trigger,
        error: error?.message || String(error),
      });
      void auditEventSink.emit({
        eventType: 'reconciliation.evidence.scheduled_export_failed',
        severity: 'critical',
        outcome: 'failure',
        actor: { requestedBy: this.requestedBy },
        metadata: {
          trigger,
          error: error?.message || String(error),
        },
      });
      return { skipped: false as const, error };
    } finally {
      this.running = false;
    }
  }
}

export const reconciliationEvidenceScheduler = new ReconciliationEvidenceScheduler();
