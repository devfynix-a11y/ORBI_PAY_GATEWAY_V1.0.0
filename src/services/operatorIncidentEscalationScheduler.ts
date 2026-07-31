import { config } from '../config.js';
import { logger } from '../logger.js';
import { auditEventSink } from './auditEventSink.js';
import { operatorAlertSink } from './operatorAlertSink.js';
import { operatorIncidentStore, type OperatorIncidentStore } from './operatorIncidentStore.js';

type OperatorIncidentEscalationSchedulerOptions = {
  incidentStore?: OperatorIncidentStore;
  alertSink?: typeof operatorAlertSink;
  enabled?: boolean;
  intervalMinutes?: number;
  criticalSlaMinutes?: number;
  warningSlaMinutes?: number;
  requestedBy?: string;
};

export class OperatorIncidentEscalationScheduler {
  private readonly incidentStore: OperatorIncidentStore;
  private readonly alertSink: typeof operatorAlertSink;
  private readonly enabled: boolean;
  private readonly intervalMinutes: number;
  private readonly criticalSlaMinutes: number;
  private readonly warningSlaMinutes: number;
  private readonly requestedBy: string;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(options: OperatorIncidentEscalationSchedulerOptions = {}) {
    this.incidentStore = options.incidentStore || operatorIncidentStore;
    this.alertSink = options.alertSink || operatorAlertSink;
    this.enabled = Boolean(options.enabled ?? config.incidentEscalation.enabled);
    this.intervalMinutes = Math.max(1, Number(options.intervalMinutes ?? config.incidentEscalation.intervalMinutes));
    this.criticalSlaMinutes = Math.max(1, Number(options.criticalSlaMinutes ?? config.incidentEscalation.criticalSlaMinutes));
    this.warningSlaMinutes = Math.max(1, Number(options.warningSlaMinutes ?? config.incidentEscalation.warningSlaMinutes));
    this.requestedBy = options.requestedBy || config.incidentEscalation.requestedBy;
  }

  start() {
    if (!this.enabled) {
      logger.info('operator_incident_escalation_scheduler_disabled', {
        intervalMinutes: this.intervalMinutes,
        criticalSlaMinutes: this.criticalSlaMinutes,
        warningSlaMinutes: this.warningSlaMinutes,
      });
      return;
    }

    if (this.timer) return;
    const intervalMs = this.intervalMinutes * 60 * 1000;
    this.timer = setInterval(() => {
      void this.runOnce('interval');
    }, intervalMs);
    this.timer.unref?.();

    logger.info('operator_incident_escalation_scheduler_started', {
      intervalMinutes: this.intervalMinutes,
      criticalSlaMinutes: this.criticalSlaMinutes,
      warningSlaMinutes: this.warningSlaMinutes,
    });
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async runOnce(trigger: 'interval' | 'manual' = 'manual') {
    if (this.running) {
      logger.warn('operator_incident_escalation_run_skipped', { trigger, reason: 'already_running' });
      return { skipped: true as const, reason: 'already_running' };
    }

    this.running = true;
    try {
      const incidents = await this.incidentStore.list();
      const escalated = [];
      for (const incident of incidents) {
        if (incident.status === 'resolved') continue;
        const slaMinutes = incident.severity === 'critical' ? this.criticalSlaMinutes : this.warningSlaMinutes;
        const level = `${incident.severity}_sla_${slaMinutes}m`;
        const ageMinutes = Math.floor((Date.now() - Date.parse(incident.createdAt)) / 60000);
        if (ageMinutes < slaMinutes) continue;
        if (this.incidentStore.hasEscalation(incident, level)) continue;

        const reason = `${incident.severity} incident exceeded ${slaMinutes} minute SLA.`;
        const updated = await this.incidentStore.markEscalated(incident.incidentId, {
          escalatedBy: this.requestedBy,
          reason,
          level,
        });
        await this.raiseEscalationAlert(updated, reason, ageMinutes, trigger);
        escalated.push(updated);
      }

      if (escalated.length > 0) {
        logger.warn('operator_incident_escalation_run_completed', {
          trigger,
          escalatedCount: escalated.length,
          incidentIds: escalated.map((incident) => incident.incidentId),
        });
      }
      return { skipped: false as const, escalated };
    } catch (error: any) {
      logger.error('operator_incident_escalation_run_failed', {
        trigger,
        error: error?.message || String(error),
      });
      return { skipped: false as const, error };
    } finally {
      this.running = false;
    }
  }

  private async raiseEscalationAlert(
    incident: Awaited<ReturnType<OperatorIncidentStore['markEscalated']>>,
    reason: string,
    ageMinutes: number,
    trigger: 'interval' | 'manual',
  ) {
    const severity = incident.severity;
    const metadata = {
      incidentId: incident.incidentId,
      incidentType: incident.incidentType,
      incidentStatus: incident.status,
      ageMinutes,
      trigger,
      sourceAlertId: incident.sourceAlertId,
      assignedTo: incident.assignedTo,
    };

    void auditEventSink.emit({
      eventType: 'operator.incident.sla_escalated',
      severity,
      outcome: 'pending',
      actor: { requestedBy: this.requestedBy },
      resource: { type: 'operator_incident', id: incident.incidentId },
      metadata,
    });

    await this.alertSink.send({
      alertId: `alert_${incident.incidentId}_sla`,
      alertType: 'operator.incident.sla_escalated',
      severity,
      title: severity === 'critical' ? 'Critical incident SLA exceeded' : 'Incident SLA exceeded',
      message: `${reason} Incident ${incident.incidentId} is still ${incident.status}.`,
      resource: { type: 'operator_incident', id: incident.incidentId },
      metadata,
      runbook: {
        name: 'Operator incident escalation',
        steps: [
          'Open the incident queue and review the linked resource.',
          'Assign an accountable owner if no owner is set.',
          'Record the investigation outcome before resolving.',
          'If money movement may be affected, compare Gateway evidence with Core ledger state.',
        ],
      },
    });
  }
}

export const operatorIncidentEscalationScheduler = new OperatorIncidentEscalationScheduler();
