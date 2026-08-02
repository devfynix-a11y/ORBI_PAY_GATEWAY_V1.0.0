import { Pool } from 'pg';
import { config } from '../config.js';
import type { UsageMeteringSummary } from './usageMeteringStore.js';

export type BillingPlanCode = 'sandbox_free' | 'starter' | 'business' | 'enterprise';

export type BillingPlanDefinition = {
  planCode: BillingPlanCode;
  displayName: string;
  dailyCallLimit: number;
  monthlyCallLimit: number;
  liveEnabled: boolean;
};

export type BillingPlanAssignment = {
  serviceCode: string;
  planCode: BillingPlanCode;
  status: 'active' | 'suspended';
  dailyCallLimit: number;
  monthlyCallLimit: number;
  assignedBy?: string;
  assignedAt: string;
  updatedAt: string;
};

export type BillingPlanSummary = {
  generatedAt: string;
  enforcementMode: 'observe';
  planCatalog: BillingPlanDefinition[];
  assignments: BillingPlanAssignment[];
  overLimitServices: Array<{
    serviceCode: string;
    planCode: BillingPlanCode;
    requests24h: number;
    dailyCallLimit: number;
    severity: 'warning' | 'critical';
  }>;
};

export type BillingPlanAssignmentInput = {
  planCode: BillingPlanCode;
  assignedBy: string;
  reason: string;
  dailyCallLimit?: number;
  monthlyCallLimit?: number;
  status?: 'active' | 'suspended';
};

const PLAN_CATALOG: BillingPlanDefinition[] = [
  {
    planCode: 'sandbox_free',
    displayName: 'Sandbox Free',
    dailyCallLimit: 1000,
    monthlyCallLimit: 10000,
    liveEnabled: false,
  },
  {
    planCode: 'starter',
    displayName: 'Starter',
    dailyCallLimit: 10000,
    monthlyCallLimit: 150000,
    liveEnabled: true,
  },
  {
    planCode: 'business',
    displayName: 'Business',
    dailyCallLimit: 100000,
    monthlyCallLimit: 2000000,
    liveEnabled: true,
  },
  {
    planCode: 'enterprise',
    displayName: 'Enterprise',
    dailyCallLimit: 1000000,
    monthlyCallLimit: 25000000,
    liveEnabled: true,
  },
];

const planByCode = (code: unknown): BillingPlanDefinition =>
  PLAN_CATALOG.find((plan) => plan.planCode === code) || PLAN_CATALOG[0];

const serviceCodeFrom = (service: Record<string, unknown>): string | undefined =>
  String(service.serviceCode || service.code || '').trim() || undefined;

const assignmentFromRow = (row: any): BillingPlanAssignment => {
  const plan = planByCode(row.plan_code);
  return {
    serviceCode: String(row.service_code),
    planCode: plan.planCode,
    status: row.status === 'suspended' ? 'suspended' : 'active',
    dailyCallLimit: Number(row.daily_call_limit || plan.dailyCallLimit),
    monthlyCallLimit: Number(row.monthly_call_limit || plan.monthlyCallLimit),
    assignedBy: row.assigned_by ? String(row.assigned_by) : undefined,
    assignedAt: row.assigned_at ? new Date(row.assigned_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  };
};

export class BillingPlanStore {
  private pool?: Pool;
  private initialized = false;
  private memory = new Map<string, BillingPlanAssignment>();

  constructor(databaseUrl = config.databaseUrl) {
    if (databaseUrl) this.pool = new Pool({ connectionString: databaseUrl });
  }

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;
    if (!this.pool) return;
    await this.pool.query(`
      create table if not exists public.pay_gateway_service_billing_plans (
        service_code text primary key,
        plan_code text not null,
        status text not null default 'active' check (status in ('active','suspended')),
        daily_call_limit integer not null,
        monthly_call_limit integer not null,
        assigned_by text,
        assigned_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create index if not exists pay_gateway_service_billing_plans_status_idx
        on public.pay_gateway_service_billing_plans (status, plan_code);
    `);
  }

  planCatalog() {
    return PLAN_CATALOG;
  }

  async assignPlan(serviceCode: string, input: BillingPlanAssignmentInput): Promise<BillingPlanAssignment> {
    const normalized = String(serviceCode || '').trim();
    if (!normalized) throw new Error('BILLING_PLAN_SERVICE_REQUIRED');
    if (!String(input.reason || '').trim()) throw new Error('BILLING_PLAN_REASON_REQUIRED');
    const plan = planByCode(input.planCode);
    const now = new Date().toISOString();
    const assignment: BillingPlanAssignment = {
      serviceCode: normalized,
      planCode: plan.planCode,
      status: input.status || 'active',
      dailyCallLimit: Math.max(1, Math.round(input.dailyCallLimit || plan.dailyCallLimit)),
      monthlyCallLimit: Math.max(1, Math.round(input.monthlyCallLimit || plan.monthlyCallLimit)),
      assignedBy: input.assignedBy,
      assignedAt: now,
      updatedAt: now,
    };
    await this.initialize();
    if (!this.pool) {
      this.memory.set(normalized, assignment);
      return assignment;
    }
    await this.pool.query(
      `insert into public.pay_gateway_service_billing_plans (
         service_code, plan_code, status, daily_call_limit, monthly_call_limit,
         assigned_by, assigned_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (service_code) do update set
         plan_code = excluded.plan_code,
         status = excluded.status,
         daily_call_limit = excluded.daily_call_limit,
         monthly_call_limit = excluded.monthly_call_limit,
         assigned_by = excluded.assigned_by,
         updated_at = excluded.updated_at
       returning *`,
      [
        assignment.serviceCode,
        assignment.planCode,
        assignment.status,
        assignment.dailyCallLimit,
        assignment.monthlyCallLimit,
        assignment.assignedBy || null,
        assignment.assignedAt,
        assignment.updatedAt,
      ],
    );
    return assignment;
  }

  async listAssignments(serviceCodes: string[] = []): Promise<BillingPlanAssignment[]> {
    await this.initialize();
    if (!this.pool) {
      const assignments = [...this.memory.values()];
      return serviceCodes.length ? assignments.filter((item) => serviceCodes.includes(item.serviceCode)) : assignments;
    }
    if (serviceCodes.length === 0) {
      const result = await this.pool.query('select * from public.pay_gateway_service_billing_plans order by service_code asc');
      return result.rows.map(assignmentFromRow);
    }
    const result = await this.pool.query(
      'select * from public.pay_gateway_service_billing_plans where service_code = any($1::text[]) order by service_code asc',
      [serviceCodes],
    );
    return result.rows.map(assignmentFromRow);
  }

  async summary(input: {
    services: Array<Record<string, unknown>>;
    usageMetering?: UsageMeteringSummary;
  }): Promise<BillingPlanSummary> {
    const serviceCodes = input.services.map(serviceCodeFrom).filter((item): item is string => Boolean(item));
    const persisted = await this.listAssignments(serviceCodes);
    const assignmentMap = new Map(persisted.map((item) => [item.serviceCode, item]));
    const assignments = serviceCodes.map((serviceCode) => assignmentMap.get(serviceCode) || this.defaultAssignment(serviceCode));
    const usageByService = new Map(
      (input.usageMetering?.byService || []).map((item) => [String(item.serviceCode || 'unassigned'), Number(item.requests || 0)]),
    );
    const overLimitServices = assignments
      .map((assignment) => {
        const requests24h = usageByService.get(assignment.serviceCode) || 0;
        const ratio = assignment.dailyCallLimit > 0 ? requests24h / assignment.dailyCallLimit : 0;
        if (ratio < 0.8) return undefined;
        return {
          serviceCode: assignment.serviceCode,
          planCode: assignment.planCode,
          requests24h,
          dailyCallLimit: assignment.dailyCallLimit,
          severity: ratio >= 1 ? 'critical' as const : 'warning' as const,
        };
      })
      .filter((item): item is BillingPlanSummary['overLimitServices'][number] => Boolean(item));

    return {
      generatedAt: new Date().toISOString(),
      enforcementMode: 'observe',
      planCatalog: PLAN_CATALOG,
      assignments,
      overLimitServices,
    };
  }

  private defaultAssignment(serviceCode: string): BillingPlanAssignment {
    const plan = planByCode('sandbox_free');
    const now = new Date().toISOString();
    return {
      serviceCode,
      planCode: plan.planCode,
      status: 'active',
      dailyCallLimit: plan.dailyCallLimit,
      monthlyCallLimit: plan.monthlyCallLimit,
      assignedAt: now,
      updatedAt: now,
    };
  }
}

export const billingPlanStore = new BillingPlanStore();
