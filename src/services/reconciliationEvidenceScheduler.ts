import { config } from '../config.js';
import { logger } from '../logger.js';
import { auditEventSink } from './auditEventSink.js';
import { operatorAlertSink, type OperatorAlert } from './operatorAlertSink.js';
import { operatorIncidentStore } from './operatorIncidentStore.js';
import { reconciliationEvidenceService, type ReconciliationEvidenceService } from './reconciliationEvidenceService.js';

type ReconciliationEvidenceSchedulerOptions = {
  service?: ReconciliationEvidenceService;
  alertSink?: typeof operatorAlertSink;
  incidentStore?: typeof operatorIncidentStore;
  enabled?: boolean;
  intervalMinutes?: number;
  windowHours?: number;
  runOnStart?: boolean;
  requestedBy?: string;
};

export class ReconciliationEvidenceScheduler {
  private readonly service: ReconciliationEvidenceService;
  private readonly alertSink: typeof operatorAlertSink;
  private readonly incidentStore: typeof operatorIncidentStore;
  private readonly enabled: boolean;
  private readonly intervalMinutes: number;
  private readonly windowHours: number;
  private readonly runOnStart: boolean;
  private readonly requestedBy: string;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(options: ReconciliationEvidenceSchedulerOptions = {}) {
    this.service = options.service || reconciliationEvidenceService;
    this.alertSink = options.alertSink || operatorAlertSink;
    this.incidentStore = options.incidentStore || operatorIncidentStore;
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
      await this.sendExceptionAlertIfNeeded(result.report, result.path, trigger);
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

  private async sendExceptionAlertIfNeeded(
    report: Awaited<ReturnType<ReconciliationEvidenceService['export']>>['report'],
    exportedPath: string | undefined,
    trigger: 'startup' | 'interval' | 'manual',
  ) {
    if (report.summary.exceptionCount <= 0) return;
    const criticalCount = report.summary.exceptionsBySeverity.critical || 0;
    const warningCount = report.summary.exceptionsBySeverity.warning || 0;
    const severity = criticalCount > 0 ? 'critical' : 'warning';
    const title = criticalCount > 0
      ? 'Critical reconciliation exceptions detected'
      : 'Reconciliation exceptions detected';

    const alert: OperatorAlert = {
      alertType: 'reconciliation.exceptions_detected',
      severity,
      title,
      message: `Gateway reconciliation found ${report.summary.exceptionCount} exception(s): ${criticalCount} critical, ${warningCount} warning.`,
      resource: {
        type: 'reconciliation_evidence_report',
        id: report.reportId,
      },
      metadata: {
        trigger,
        exportedPath,
        exceptionCount: report.summary.exceptionCount,
        criticalCount,
        warningCount,
        exceptionsByType: report.summary.exceptionsByType,
        from: report.window.from,
        to: report.window.to,
      },
      runbook: {
        name: 'Gateway reconciliation exception triage',
        steps: [
          'Open the signed reconciliation report and verify reportHash/signature.',
          'Review critical exceptions first: failed Core submissions and failed webhook deliveries.',
          'Replay failed webhooks only through the signed webhook replay workflow.',
          'For stuck intents, compare Gateway intent status with Core ledger transaction state.',
          'Record operator decision and attach the reportId to the incident record.',
        ],
      },
    };
    const incident = await this.incidentStore.createFromAlert(alert);
    const alertWithIncident = {
      ...alert,
      alertId: incident.incidentId,
      metadata: {
        ...alert.metadata,
        incidentId: incident.incidentId,
      },
    };

    void auditEventSink.emit({
      eventType: 'reconciliation.exception_alert.raised',
      severity,
      outcome: 'pending',
      actor: { requestedBy: this.requestedBy },
      resource: alert.resource,
      metadata: alertWithIncident.metadata,
    });

    await this.alertSink.send(alertWithIncident);
  }
}

export const reconciliationEvidenceScheduler = new ReconciliationEvidenceScheduler();
