import crypto from 'node:crypto';
import { Pool } from 'pg';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { OperatorAlert } from './operatorAlertSink.js';

export type OperatorIncidentSeverity = 'warning' | 'critical';
export type OperatorIncidentStatus = 'open' | 'acknowledged' | 'assigned' | 'resolved';

export type OperatorIncident = {
  incidentId: string;
  sourceAlertId?: string;
  incidentType: string;
  severity: OperatorIncidentSeverity;
  status: OperatorIncidentStatus;
  title: string;
  message: string;
  resource: Record<string, unknown>;
  metadata: Record<string, unknown>;
  runbook?: {
    name: string;
    steps: string[];
  };
  assignedTo?: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  resolution?: string;
  createdAt: string;
  updatedAt: string;
};

type IncidentFilters = {
  status?: string;
  severity?: string;
  incidentType?: string;
};

type OperatorIncidentStoreOptions = {
  databaseUrl?: string;
  memoryOnly?: boolean;
};

const validStatus = (value: unknown): value is OperatorIncidentStatus =>
  value === 'open' || value === 'acknowledged' || value === 'assigned' || value === 'resolved';

const validSeverity = (value: unknown): value is OperatorIncidentSeverity =>
  value === 'warning' || value === 'critical';

const asJsonObject = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
};

const parseJsonObject = (value: unknown): Record<string, unknown> => {
  if (!value) return {};
  if (typeof value === 'object') return asJsonObject(value);
  try {
    return asJsonObject(JSON.parse(String(value)));
  } catch {
    return {};
  }
};

const runbookFrom = (value: unknown): OperatorIncident['runbook'] | undefined => {
  const source = typeof value === 'string' ? parseJsonObject(value) : asJsonObject(value);
  const steps = Array.isArray(source.steps) ? source.steps.map(String).filter(Boolean) : [];
  const name = String(source.name || '').trim();
  if (!name && steps.length === 0) return undefined;
  return { name: name || 'Incident runbook', steps };
};

const rowToIncident = (row: any): OperatorIncident => ({
  incidentId: String(row.incident_id),
  sourceAlertId: row.source_alert_id ? String(row.source_alert_id) : undefined,
  incidentType: String(row.incident_type),
  severity: validSeverity(row.severity) ? row.severity : 'warning',
  status: validStatus(row.status) ? row.status : 'open',
  title: String(row.title),
  message: String(row.message),
  resource: parseJsonObject(row.resource),
  metadata: parseJsonObject(row.metadata),
  runbook: runbookFrom(row.runbook),
  assignedTo: row.assigned_to ? String(row.assigned_to) : undefined,
  acknowledgedBy: row.acknowledged_by ? String(row.acknowledged_by) : undefined,
  acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at).toISOString() : undefined,
  resolvedBy: row.resolved_by ? String(row.resolved_by) : undefined,
  resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : undefined,
  resolution: row.resolution ? String(row.resolution) : undefined,
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
});

export class OperatorIncidentStore {
  private pool?: Pool;
  private readonly databaseUrl?: string;
  private readonly memoryOnly: boolean;
  private initialized = false;
  private readonly incidents = new Map<string, OperatorIncident>();

  constructor(options: OperatorIncidentStoreOptions = {}) {
    this.databaseUrl = options.databaseUrl ?? config.databaseUrl;
    this.memoryOnly = Boolean(options.memoryOnly);
  }

  static inMemory() {
    return new OperatorIncidentStore({ memoryOnly: true });
  }

  async initialize() {
    if (this.initialized) return;
    if (this.databaseUrl && !this.memoryOnly) {
      this.pool = new Pool({ connectionString: this.databaseUrl });
      await this.ensureSchema();
      await this.loadExistingIncidents();
    }
    this.initialized = true;
  }

  async createFromAlert(alert: OperatorAlert): Promise<OperatorIncident> {
    await this.ensureInitialized();
    const now = new Date().toISOString();
    const incident: OperatorIncident = {
      incidentId: `inc_${crypto.randomUUID()}`,
      sourceAlertId: alert.alertId,
      incidentType: alert.alertType,
      severity: alert.severity,
      status: 'open',
      title: alert.title,
      message: alert.message,
      resource: alert.resource || {},
      metadata: alert.metadata || {},
      runbook: alert.runbook,
      createdAt: now,
      updatedAt: now,
    };

    await this.persist(incident);
    this.incidents.set(incident.incidentId, incident);
    return incident;
  }

  async list(filters: IncidentFilters = {}): Promise<OperatorIncident[]> {
    await this.ensureInitialized();
    return [...this.incidents.values()]
      .filter((incident) => !filters.status || incident.status === filters.status)
      .filter((incident) => !filters.severity || incident.severity === filters.severity)
      .filter((incident) => !filters.incidentType || incident.incidentType === filters.incidentType)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async get(incidentId: string): Promise<OperatorIncident | undefined> {
    await this.ensureInitialized();
    return this.incidents.get(incidentId);
  }

  async acknowledge(incidentId: string, input: { acknowledgedBy: string; note?: string }): Promise<OperatorIncident> {
    const incident = await this.requireIncident(incidentId);
    if (incident.status === 'resolved') return incident;
    const updated = this.withOperatorNote({
      ...incident,
      status: 'acknowledged',
      acknowledgedBy: input.acknowledgedBy,
      acknowledgedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, input.note, 'acknowledged');
    await this.persist(updated);
    this.incidents.set(updated.incidentId, updated);
    return updated;
  }

  async assign(incidentId: string, input: { assignedTo: string; assignedBy?: string; note?: string }): Promise<OperatorIncident> {
    const incident = await this.requireIncident(incidentId);
    if (incident.status === 'resolved') return incident;
    const updated = this.withOperatorNote({
      ...incident,
      status: 'assigned',
      assignedTo: input.assignedTo,
      updatedAt: new Date().toISOString(),
    }, input.note || input.assignedBy ? `Assigned by ${input.assignedBy || 'operator'}${input.note ? `: ${input.note}` : ''}` : undefined, 'assigned');
    await this.persist(updated);
    this.incidents.set(updated.incidentId, updated);
    return updated;
  }

  async resolve(incidentId: string, input: { resolvedBy: string; resolution: string }): Promise<OperatorIncident> {
    const incident = await this.requireIncident(incidentId);
    const updated: OperatorIncident = {
      ...incident,
      status: 'resolved',
      resolvedBy: input.resolvedBy,
      resolvedAt: new Date().toISOString(),
      resolution: input.resolution,
      updatedAt: new Date().toISOString(),
    };
    await this.persist(updated);
    this.incidents.set(updated.incidentId, updated);
    return updated;
  }

  async markEscalated(incidentId: string, input: { escalatedBy: string; reason: string; level: string }): Promise<OperatorIncident> {
    const incident = await this.requireIncident(incidentId);
    if (incident.status === 'resolved') return incident;
    const escalations = Array.isArray(incident.metadata.slaEscalations) ? incident.metadata.slaEscalations : [];
    const updated: OperatorIncident = {
      ...incident,
      metadata: {
        ...incident.metadata,
        slaEscalations: [
          ...escalations,
          {
            level: input.level,
            reason: input.reason,
            escalatedBy: input.escalatedBy,
            at: new Date().toISOString(),
          },
        ],
      },
      updatedAt: new Date().toISOString(),
    };
    await this.persist(updated);
    this.incidents.set(updated.incidentId, updated);
    return updated;
  }

  hasEscalation(incident: OperatorIncident, level: string): boolean {
    const escalations = Array.isArray(incident.metadata.slaEscalations) ? incident.metadata.slaEscalations : [];
    return escalations.some((entry) => asJsonObject(entry).level === level);
  }

  private async ensureInitialized() {
    if (!this.initialized) await this.initialize();
  }

  private async ensureSchema() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS public.pay_gateway_operator_incidents (
        incident_id TEXT PRIMARY KEY,
        source_alert_id TEXT,
        incident_type TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
        status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'assigned', 'resolved')),
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        resource JSONB NOT NULL DEFAULT '{}'::jsonb,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        runbook JSONB NOT NULL DEFAULT '{}'::jsonb,
        assigned_to TEXT,
        acknowledged_by TEXT,
        acknowledged_at TIMESTAMPTZ,
        resolved_by TEXT,
        resolved_at TIMESTAMPTZ,
        resolution TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_pay_gateway_operator_incidents_status ON public.pay_gateway_operator_incidents(status)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_pay_gateway_operator_incidents_severity ON public.pay_gateway_operator_incidents(severity)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_pay_gateway_operator_incidents_type ON public.pay_gateway_operator_incidents(incident_type)');
  }

  private async loadExistingIncidents() {
    if (!this.pool) return;
    const result = await this.pool.query('SELECT * FROM public.pay_gateway_operator_incidents ORDER BY created_at DESC LIMIT 500');
    for (const row of result.rows) {
      const incident = rowToIncident(row);
      this.incidents.set(incident.incidentId, incident);
    }
  }

  private async persist(incident: OperatorIncident) {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `
          INSERT INTO public.pay_gateway_operator_incidents (
            incident_id, source_alert_id, incident_type, severity, status, title, message,
            resource, metadata, runbook, assigned_to, acknowledged_by, acknowledged_at,
            resolved_by, resolved_at, resolution, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13,
            $14, $15, $16, $17, $18
          )
          ON CONFLICT (incident_id) DO UPDATE SET
            source_alert_id = EXCLUDED.source_alert_id,
            incident_type = EXCLUDED.incident_type,
            severity = EXCLUDED.severity,
            status = EXCLUDED.status,
            title = EXCLUDED.title,
            message = EXCLUDED.message,
            resource = EXCLUDED.resource,
            metadata = EXCLUDED.metadata,
            runbook = EXCLUDED.runbook,
            assigned_to = EXCLUDED.assigned_to,
            acknowledged_by = EXCLUDED.acknowledged_by,
            acknowledged_at = EXCLUDED.acknowledged_at,
            resolved_by = EXCLUDED.resolved_by,
            resolved_at = EXCLUDED.resolved_at,
            resolution = EXCLUDED.resolution,
            updated_at = EXCLUDED.updated_at
        `,
        [
          incident.incidentId,
          incident.sourceAlertId || null,
          incident.incidentType,
          incident.severity,
          incident.status,
          incident.title,
          incident.message,
          JSON.stringify(incident.resource || {}),
          JSON.stringify(incident.metadata || {}),
          JSON.stringify(incident.runbook || {}),
          incident.assignedTo || null,
          incident.acknowledgedBy || null,
          incident.acknowledgedAt || null,
          incident.resolvedBy || null,
          incident.resolvedAt || null,
          incident.resolution || null,
          incident.createdAt,
          incident.updatedAt,
        ],
      );
    } catch (error: any) {
      logger.error('operator_incident_store.persist_failed', {
        incidentId: incident.incidentId,
        incidentType: incident.incidentType,
        error: error?.message || String(error),
      });
      throw error;
    }
  }

  private async requireIncident(incidentId: string): Promise<OperatorIncident> {
    const incident = await this.get(incidentId);
    if (!incident) throw new Error('OPERATOR_INCIDENT_NOT_FOUND');
    return incident;
  }

  private withOperatorNote(incident: OperatorIncident, note: string | undefined, action: string): OperatorIncident {
    const cleanNote = String(note || '').trim();
    if (!cleanNote) return incident;
    const notes = Array.isArray(incident.metadata.operatorNotes) ? incident.metadata.operatorNotes : [];
    return {
      ...incident,
      metadata: {
        ...incident.metadata,
        operatorNotes: [
          ...notes,
          {
            action,
            note: cleanNote,
            at: new Date().toISOString(),
          },
        ],
      },
    };
  }
}

export const operatorIncidentStore = new OperatorIncidentStore();
