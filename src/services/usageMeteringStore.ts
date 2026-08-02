import { Pool } from 'pg';
import { createHash } from 'crypto';
import { config } from '../config.js';

export type UsageMeterRecordInput = {
  requestId: string;
  traceId?: string;
  correlationId?: string;
  environment: 'sandbox' | 'live';
  serviceCode?: string;
  actorRef?: string;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  origin?: string;
  userAgent?: string;
  occurredAt?: string;
};

export type UsageMeteringSummary = {
  generatedAt: string;
  windowHours: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatencyMs: number;
  activeDevelopers: number;
  activeServices: number;
  byService: Array<{
    serviceCode: string;
    requests: number;
    failures: number;
    averageLatencyMs: number;
  }>;
  byRoute: Array<{
    route: string;
    requests: number;
    failures: number;
  }>;
};

const normalizeRoute = (route: string) =>
  String(route || '/')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/qt_[^/]+/gi, 'qt_:id')
    .replace(/pi_[^/]+/gi, 'pi_:id')
    .slice(0, 240);

const hashValue = (value?: string) =>
  value ? createHash('sha256').update(value).digest('hex') : null;

export class UsageMeteringStore {
  private pool?: Pool;
  private memory: UsageMeterRecordInput[] = [];
  private initialized = false;

  constructor(databaseUrl = config.databaseUrl) {
    if (databaseUrl) this.pool = new Pool({ connectionString: databaseUrl });
  }

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;
    if (!this.pool) return;
    await this.pool.query(`
      create table if not exists public.pay_gateway_usage_meter_events (
        request_id text primary key,
        trace_id text,
        correlation_id text,
        environment text not null check (environment in ('sandbox','live')),
        service_code text,
        actor_ref text,
        method text not null,
        route text not null,
        status_code integer not null,
        duration_ms integer not null,
        origin text,
        user_agent_hash text,
        occurred_at timestamptz not null default now()
      );
      create index if not exists pay_gateway_usage_meter_events_time_idx
        on public.pay_gateway_usage_meter_events (occurred_at desc);
      create index if not exists pay_gateway_usage_meter_events_service_idx
        on public.pay_gateway_usage_meter_events (service_code, occurred_at desc);
      create index if not exists pay_gateway_usage_meter_events_environment_idx
        on public.pay_gateway_usage_meter_events (environment, occurred_at desc);
    `);
  }

  async record(input: UsageMeterRecordInput) {
    const record = {
      ...input,
      route: normalizeRoute(input.route),
      occurredAt: input.occurredAt || new Date().toISOString(),
    };
    if (!this.pool) {
      this.memory.unshift(record);
      this.memory = this.memory.slice(0, 20000);
      return;
    }
    await this.initialize();
    await this.pool.query(
      `insert into public.pay_gateway_usage_meter_events (
         request_id, trace_id, correlation_id, environment, service_code,
         actor_ref, method, route, status_code, duration_ms, origin,
         user_agent_hash, occurred_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (request_id) do nothing`,
      [
        record.requestId,
        record.traceId || null,
        record.correlationId || null,
        record.environment,
        record.serviceCode || null,
        record.actorRef || null,
        record.method,
        record.route,
        record.statusCode,
        Math.max(0, Math.round(record.durationMs)),
        record.origin || null,
        hashValue(record.userAgent),
        record.occurredAt,
      ],
    );
  }

  async summary(windowHours = 24): Promise<UsageMeteringSummary> {
    const hours = Math.max(1, Math.min(24 * 31, Math.round(windowHours)));
    if (!this.pool) return this.memorySummary(hours);
    await this.initialize();
    const [total, byService, byRoute] = await Promise.all([
      this.pool.query(
        `select
           count(*)::int as total_requests,
           count(*) filter (where status_code < 400)::int as successful_requests,
           count(*) filter (where status_code >= 400)::int as failed_requests,
           coalesce(round(avg(duration_ms)), 0)::int as average_latency_ms,
           count(distinct actor_ref) filter (where actor_ref is not null)::int as active_developers,
           count(distinct service_code) filter (where service_code is not null)::int as active_services
         from public.pay_gateway_usage_meter_events
         where occurred_at > now() - ($1::text || ' hours')::interval`,
        [String(hours)],
      ),
      this.pool.query(
        `select coalesce(service_code, 'unassigned') as service_code,
           count(*)::int as requests,
           count(*) filter (where status_code >= 400)::int as failures,
           coalesce(round(avg(duration_ms)), 0)::int as average_latency_ms
         from public.pay_gateway_usage_meter_events
         where occurred_at > now() - ($1::text || ' hours')::interval
         group by coalesce(service_code, 'unassigned')
         order by requests desc
         limit 10`,
        [String(hours)],
      ),
      this.pool.query(
        `select route,
           count(*)::int as requests,
           count(*) filter (where status_code >= 400)::int as failures
         from public.pay_gateway_usage_meter_events
         where occurred_at > now() - ($1::text || ' hours')::interval
         group by route
         order by requests desc
         limit 10`,
        [String(hours)],
      ),
    ]);
    const row = total.rows[0] || {};
    return {
      generatedAt: new Date().toISOString(),
      windowHours: hours,
      totalRequests: Number(row.total_requests || 0),
      successfulRequests: Number(row.successful_requests || 0),
      failedRequests: Number(row.failed_requests || 0),
      averageLatencyMs: Number(row.average_latency_ms || 0),
      activeDevelopers: Number(row.active_developers || 0),
      activeServices: Number(row.active_services || 0),
      byService: byService.rows.map((item) => ({
        serviceCode: String(item.service_code),
        requests: Number(item.requests || 0),
        failures: Number(item.failures || 0),
        averageLatencyMs: Number(item.average_latency_ms || 0),
      })),
      byRoute: byRoute.rows.map((item) => ({
        route: String(item.route),
        requests: Number(item.requests || 0),
        failures: Number(item.failures || 0),
      })),
    };
  }

  private memorySummary(windowHours: number): UsageMeteringSummary {
    const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
    const records = this.memory.filter((item) => Date.parse(item.occurredAt || '') > cutoff);
    const failures = records.filter((item) => item.statusCode >= 400);
    const averageLatencyMs = records.length
      ? Math.round(records.reduce((sum, item) => sum + item.durationMs, 0) / records.length)
      : 0;
    const byService = this.groupMemory(records, 'serviceCode').map(([serviceCode, items]) => ({
      serviceCode: serviceCode || 'unassigned',
      requests: items.length,
      failures: items.filter((item) => item.statusCode >= 400).length,
      averageLatencyMs: items.length ? Math.round(items.reduce((sum, item) => sum + item.durationMs, 0) / items.length) : 0,
    })).slice(0, 10);
    const byRoute = this.groupMemory(records, 'route').map(([route, items]) => ({
      route,
      requests: items.length,
      failures: items.filter((item) => item.statusCode >= 400).length,
    })).slice(0, 10);
    return {
      generatedAt: new Date().toISOString(),
      windowHours,
      totalRequests: records.length,
      successfulRequests: records.length - failures.length,
      failedRequests: failures.length,
      averageLatencyMs,
      activeDevelopers: new Set(records.map((item) => item.actorRef).filter(Boolean)).size,
      activeServices: new Set(records.map((item) => item.serviceCode).filter(Boolean)).size,
      byService,
      byRoute,
    };
  }

  private groupMemory(records: UsageMeterRecordInput[], key: 'serviceCode' | 'route') {
    const grouped = new Map<string, UsageMeterRecordInput[]>();
    for (const record of records) {
      const value = String(record[key] || (key === 'serviceCode' ? 'unassigned' : '/'));
      grouped.set(value, [...(grouped.get(value) || []), record]);
    }
    return [...grouped.entries()].sort((a, b) => b[1].length - a[1].length);
  }
}

export const usageMeteringStore = new UsageMeteringStore();
