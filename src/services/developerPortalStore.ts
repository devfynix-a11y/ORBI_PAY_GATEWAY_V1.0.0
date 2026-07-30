import crypto from 'crypto';
import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';
import { config } from '../config.js';
import { decryptSecret, encryptSecret } from '../security/secretVaultCrypto.js';
import type {
  DeveloperAllowlistUpdateSchema,
  DeveloperApiKeyRotationDecisionSchema,
  DeveloperApiKeyRotationRequestSchema,
  DeveloperPortalEventSchema,
  DeveloperScopeDecisionSchema,
  DeveloperScopeRequestSchema,
  DeveloperSecretIssueRequestSchema,
  DeveloperSecretRevokeRequestSchema,
  DeveloperServiceApplicationSchema,
  DeveloperServiceRecordSchema,
  DeveloperServiceStatusUpdateSchema,
  DeveloperWebhookSecretRotationRequestSchema,
} from '../contracts/developerPortalContract.js';

type DeveloperServiceApplication = z.infer<typeof DeveloperServiceApplicationSchema> & {
  applicationId: string;
  status: 'pending_review' | 'approved' | 'rejected';
  serviceCode?: string;
  submittedAt: string;
  updatedAt: string;
};

type DeveloperServiceRecord = z.infer<typeof DeveloperServiceRecordSchema>;
type DeveloperWebhookSecretRecord = DeveloperServiceRecord['webhookSecrets'][number] & {
  encryptedSecret?: unknown;
};
type DeveloperPortalEvent = z.infer<typeof DeveloperPortalEventSchema>;
type DeveloperScopeRequest = z.infer<typeof DeveloperScopeRequestSchema> & {
  requestId: string;
  serviceCode: string;
  status: 'pending_review' | 'approved' | 'rejected';
  submittedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
};
type DeveloperAllowlistUpdate = z.infer<typeof DeveloperAllowlistUpdateSchema> & {
  updateId: string;
  serviceCode: string;
  appliedAt: string;
};
type DeveloperApiKeyRotationRequest = z.infer<typeof DeveloperApiKeyRotationRequestSchema> & {
  rotationId: string;
  serviceCode: string;
  status: 'pending_review' | 'approved' | 'completed' | 'rejected';
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
};
type DeveloperWebhookSecretRotationRequest = z.infer<typeof DeveloperWebhookSecretRotationRequestSchema> & {
  rotationId: string;
  serviceCode: string;
  status: 'pending_review' | 'approved' | 'completed' | 'rejected';
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
};

type DeveloperPortalState = {
  applications: DeveloperServiceApplication[];
  services: DeveloperServiceRecord[];
  scopeRequests: DeveloperScopeRequest[];
  allowlistUpdates: DeveloperAllowlistUpdate[];
  keyRotations: DeveloperApiKeyRotationRequest[];
  webhookSecretRotations: DeveloperWebhookSecretRotationRequest[];
  events: DeveloperPortalEvent[];
};

type StoreOptions = {
  mode?: 'postgres' | 'memory';
  databaseUrl?: string;
};

const emptyState = (): DeveloperPortalState => ({
  applications: [],
  services: [],
  scopeRequests: [],
  allowlistUpdates: [],
  keyRotations: [],
  webhookSecretRotations: [],
  events: [],
});

const slug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'service';

const unique = <T>(items: T[]): T[] => [...new Set(items)];

const fingerprint = (secret: string): string =>
  crypto.createHash('sha256').update(secret).digest('hex').slice(0, 24);

const oneTimeSecret = (prefix: string): string =>
  `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;

const iso = (value: unknown): string | undefined => {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

export class DeveloperPortalStore {
  private state: DeveloperPortalState = emptyState();
  private readonly mode: 'postgres' | 'memory';
  private readonly databaseUrl?: string;
  private pool?: Pool;
  private initialized = false;

  constructor(options: StoreOptions = {}) {
    this.mode = options.mode || 'postgres';
    this.databaseUrl = options.databaseUrl || config.databaseUrl;
  }

  static inMemory() {
    const store = new DeveloperPortalStore({ mode: 'memory' });
    store.initialized = true;
    return store;
  }

  async initialize() {
    if (this.initialized) return;
    if (this.mode === 'postgres') {
      if (!this.databaseUrl) throw new Error('DATABASE_URL_REQUIRED');
      this.pool = new Pool({ connectionString: this.databaseUrl });
      await this.loadFromDatabase();
    }
    this.initialized = true;
  }

  async submitApplication(application: z.infer<typeof DeveloperServiceApplicationSchema>) {
    this.assertReady();
    const now = new Date().toISOString();
    const record: DeveloperServiceApplication = {
      ...application,
      applicationId: `dev_app_${crypto.randomUUID()}`,
      status: 'pending_review',
      submittedAt: now,
      updatedAt: now,
    };
    this.state.applications.unshift(record);
    this.addEvent('developer.service_application.submitted', {
      data: {
        applicationId: record.applicationId,
        displayName: record.displayName,
        businessType: record.businessType,
        requestedEnvironments: record.requestedEnvironments,
        requestedScopes: record.requestedScopes,
      },
    });
    await this.persist();
    return record;
  }

  listApplications(status?: string) {
    this.assertReady();
    const normalized = String(status || '').trim();
    return normalized
      ? this.state.applications.filter((application) => application.status === normalized)
      : this.state.applications;
  }

  listServices() {
    this.assertReady();
    return this.state.services.map((service) => this.publicService(service));
  }

  getService(serviceCode: string) {
    this.assertReady();
    return this.publicService(this.getMutableService(serviceCode));
  }

  private getMutableService(serviceCode: string) {
    const normalized = slug(serviceCode);
    const service = this.state.services.find((item) => item.serviceCode === normalized);
    if (!service) throw new Error('DEVELOPER_SERVICE_NOT_FOUND');
    return service;
  }

  private publicService(service: DeveloperServiceRecord): DeveloperServiceRecord {
    return {
      ...service,
      webhookSecrets: (service.webhookSecrets || []).map((secret) => {
        const { encryptedSecret: _encryptedSecret, ...publicSecret } = secret as DeveloperWebhookSecretRecord;
        return publicSecret;
      }),
    };
  }

  resolveApiKey(secret: string) {
    this.assertReady();
    const fp = fingerprint(secret);
    for (const service of this.state.services) {
      if (service.status !== 'active') continue;
      const key = (service.keys || []).find((item) =>
        (item.status === 'active' || item.status === 'pending_cutover') &&
        item.fingerprint === fp &&
        (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()),
      );
      if (!key) continue;
      return {
        service,
        key: {
          keyId: key.keyId,
          environment: key.environment,
          fingerprint: key.fingerprint,
          issuedAt: key.issuedAt,
          expiresAt: key.expiresAt,
        },
      };
    }
    return undefined;
  }

  async approveApplication(applicationId: string, input: { serviceCode?: string; initialStatus?: 'draft' | 'active' }) {
    this.assertReady();
    const application = this.state.applications.find((item) => item.applicationId === applicationId);
    if (!application) throw new Error('DEVELOPER_APPLICATION_NOT_FOUND');
    if (application.status === 'approved' && application.serviceCode) {
      return this.getService(application.serviceCode);
    }

    const now = new Date().toISOString();
    const serviceCode = this.nextServiceCode(input.serviceCode || application.displayName);
    const service: DeveloperServiceRecord = {
      serviceCode,
      displayName: application.displayName,
      status: input.initialStatus || 'draft',
      environments: unique(application.requestedEnvironments),
      scopesGranted: [],
      scopesPending: unique(application.requestedScopes),
      redirectUrls: unique(application.redirectUrls || []),
      webhookUrls: unique(application.webhookUrls || []),
      keyStatus: 'not_issued',
      webhookSecretStatus: 'not_issued',
      keys: [],
      webhookSecrets: [],
      createdAt: now,
      updatedAt: now,
      legalName: application.legalName,
      businessType: application.businessType,
      countryCode: application.countryCode,
      contactEmail: application.contactEmail,
      contactPhone: application.contactPhone,
      externalDeveloperId: application.externalDeveloperId,
      metadata: application.metadata || {},
    };

    application.status = 'approved';
    application.serviceCode = serviceCode;
    application.updatedAt = now;
    this.state.services.unshift(service);
    this.addEvent('developer.service.approved', {
      serviceCode,
      environment: service.environments.includes('live') ? 'live' : service.environments[0],
      data: {
        applicationId,
        scopesPending: service.scopesPending,
      },
    });
    await this.persist();
    return service;
  }

  async submitScopeRequest(serviceCode: string, request: z.infer<typeof DeveloperScopeRequestSchema>) {
    this.assertReady();
    const service = this.getMutableService(serviceCode);
    const now = new Date().toISOString();
    service.scopesPending = unique([...service.scopesPending, ...request.requestedScopes]);
    service.updatedAt = now;
    const record: DeveloperScopeRequest = {
      ...request,
      requestId: `scope_req_${crypto.randomUUID()}`,
      serviceCode: service.serviceCode,
      status: 'pending_review',
      submittedAt: now,
    };
    this.state.scopeRequests.unshift(record);
    this.addEvent('developer.scope_request.submitted', {
      serviceCode: service.serviceCode,
      environment: request.environment,
      data: {
        requestId: record.requestId,
        requestedScopes: record.requestedScopes,
      },
    });
    await this.persist();
    return record;
  }

  async decideScopeRequest(requestId: string, decision: z.infer<typeof DeveloperScopeDecisionSchema>) {
    this.assertReady();
    const record = this.state.scopeRequests.find((item) => item.requestId === requestId);
    if (!record) throw new Error('DEVELOPER_SCOPE_REQUEST_NOT_FOUND');
    const service = this.getMutableService(record.serviceCode);
    const now = new Date().toISOString();
    record.status = decision.decision === 'approve' ? 'approved' : 'rejected';
    record.decidedAt = now;
    record.decidedBy = decision.decidedBy;
    record.decisionReason = decision.reason;

    if (decision.decision === 'approve') {
      service.scopesGranted = unique([...service.scopesGranted, ...record.requestedScopes]);
    }
    service.scopesPending = service.scopesPending.filter((scope) => !record.requestedScopes.includes(scope));
    service.updatedAt = now;
    this.addEvent(
      decision.decision === 'approve'
        ? 'developer.scope_request.approved'
        : 'developer.scope_request.rejected',
      {
        serviceCode: service.serviceCode,
        environment: record.environment,
        data: {
          requestId: record.requestId,
          requestedScopes: record.requestedScopes,
          decidedBy: decision.decidedBy,
        },
      },
    );
    await this.persist();
    return { service, request: record };
  }

  async updateServiceStatus(serviceCode: string, input: z.infer<typeof DeveloperServiceStatusUpdateSchema>) {
    this.assertReady();
    const service = this.getMutableService(serviceCode);
    const previousStatus = service.status;
    const now = new Date().toISOString();

    service.status = input.status;
    service.updatedAt = now;

    this.addEvent(input.status === 'suspended' ? 'developer.service.suspended' : 'developer.service.status_updated', {
      serviceCode: service.serviceCode,
      environment: service.environments.includes('live') ? 'live' : service.environments[0],
      data: {
        previousStatus,
        status: input.status,
        reason: input.reason,
        decidedBy: input.decidedBy,
        metadata: input.metadata || {},
      },
    });

    await this.persist();
    return this.publicService(service);
  }

  async applyAllowlistUpdate(serviceCode: string, update: z.infer<typeof DeveloperAllowlistUpdateSchema>) {
    this.assertReady();
    const service = this.getMutableService(serviceCode);
    const now = new Date().toISOString();
    service.redirectUrls = unique([...(service.redirectUrls || []), ...(update.redirectUrls || [])]);
    service.webhookUrls = unique([...(service.webhookUrls || []), ...(update.webhookUrls || [])]);
    service.updatedAt = now;
    const record: DeveloperAllowlistUpdate = {
      ...update,
      updateId: `allowlist_${crypto.randomUUID()}`,
      serviceCode: service.serviceCode,
      appliedAt: now,
    };
    this.state.allowlistUpdates.unshift(record);
    this.addEvent('developer.allowlist.updated', {
      serviceCode: service.serviceCode,
      environment: update.environment,
      data: {
        updateId: record.updateId,
        redirectUrls: update.redirectUrls || [],
        webhookUrls: update.webhookUrls || [],
      },
    });
    await this.persist();
    return { service, update: record };
  }

  async requestApiKeyRotation(serviceCode: string, request: z.infer<typeof DeveloperApiKeyRotationRequestSchema>) {
    this.assertReady();
    const service = this.getMutableService(serviceCode);
    const now = new Date().toISOString();
    service.keyStatus = 'rotation_pending';
    service.updatedAt = now;
    const record: DeveloperApiKeyRotationRequest = {
      ...request,
      rotationId: `key_rot_${crypto.randomUUID()}`,
      serviceCode: service.serviceCode,
      status: 'pending_review',
      requestedAt: now,
    };
    this.state.keyRotations.unshift(record);
    this.addEvent('developer.api_key.rotation_requested', {
      serviceCode: service.serviceCode,
      environment: request.environment,
      data: {
        rotationId: record.rotationId,
        requestedBy: request.requestedBy,
      },
    });
    await this.persist();
    return record;
  }

  async decideApiKeyRotation(rotationId: string, decision: z.infer<typeof DeveloperApiKeyRotationDecisionSchema>) {
    this.assertReady();
    const record = this.state.keyRotations.find((item) => item.rotationId === rotationId);
    if (!record) throw new Error('DEVELOPER_API_KEY_ROTATION_NOT_FOUND');
    const service = this.getMutableService(record.serviceCode);
    const now = new Date().toISOString();

    if (decision.decision === 'approve') {
      record.status = 'approved';
      service.keyStatus = 'rotation_pending';
      this.addEvent('developer.api_key.rotation_approved', {
        serviceCode: service.serviceCode,
        environment: record.environment,
        data: { rotationId, decidedBy: decision.decidedBy },
      });
    } else if (decision.decision === 'complete') {
      record.status = 'completed';
      service.keys = (service.keys || []).map((key) =>
        key.environment === record.environment && key.status === 'pending_cutover'
          ? { ...key, status: 'revoked' as const, revokedAt: now }
          : key,
      );
      service.keyStatus = 'active';
      this.addEvent('developer.api_key.rotated', {
        serviceCode: service.serviceCode,
        environment: record.environment,
        data: { rotationId, decidedBy: decision.decidedBy },
      });
    } else {
      record.status = 'rejected';
      service.keyStatus = 'active';
      this.addEvent('developer.api_key.rotation_rejected', {
        serviceCode: service.serviceCode,
        environment: record.environment,
        data: { rotationId, decidedBy: decision.decidedBy },
      });
    }

    record.decidedAt = now;
    record.decidedBy = decision.decidedBy;
    record.decisionReason = decision.reason;
    service.updatedAt = now;
    await this.persist();
    return { service, rotation: record };
  }

  async issueApiKey(serviceCode: string, request: z.infer<typeof DeveloperSecretIssueRequestSchema>) {
    this.assertReady();
    const service = this.getMutableService(serviceCode);
    const now = new Date().toISOString();
    const keyId = `key_${crypto.randomUUID()}`;
    const secret = oneTimeSecret(`orbi_${request.environment}`);
    const record = {
      keyId,
      environment: request.environment,
      status: 'active' as const,
      fingerprint: fingerprint(secret),
      issuedAt: now,
      ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
    };
    service.keys = [
      ...(service.keys || []).map((key) =>
        key.environment === request.environment && key.status === 'active'
          ? { ...key, status: 'pending_cutover' as const }
          : key,
      ),
      record,
    ];
    service.keyStatus = 'active';
    service.updatedAt = now;
    this.addEvent('developer.api_key.issued', {
      serviceCode: service.serviceCode,
      environment: request.environment,
      data: {
        keyId,
        fingerprint: record.fingerprint,
        requestedBy: request.requestedBy,
      },
    });
    await this.persist();
    return { service, key: record, oneTimeSecret: secret };
  }

  async revokeApiKey(
    serviceCode: string,
    keyId: string,
    request: z.infer<typeof DeveloperSecretRevokeRequestSchema>,
  ) {
    this.assertReady();
    const service = this.getMutableService(serviceCode);
    const now = new Date().toISOString();
    const key = (service.keys || []).find((item) => item.keyId === keyId);
    if (!key) throw new Error('DEVELOPER_API_KEY_NOT_FOUND');
    key.status = 'revoked';
    key.revokedAt = now;
    service.keyStatus = (service.keys || []).some((item) =>
      item.environment === key.environment &&
      item.status === 'active' &&
      (!item.expiresAt || Date.parse(item.expiresAt) > Date.now())
    ) ? 'active' : 'revoked';
    service.updatedAt = now;
    this.addEvent('developer.api_key.revoked', {
      serviceCode: service.serviceCode,
      environment: key.environment,
      data: {
        keyId,
        fingerprint: key.fingerprint,
        revokedBy: request.revokedBy,
        reason: request.reason,
        metadata: request.metadata || {},
      },
    });
    await this.persist();
    return { service, key };
  }

  async requestWebhookSecretRotation(serviceCode: string, request: z.infer<typeof DeveloperWebhookSecretRotationRequestSchema>) {
    this.assertReady();
    const service = this.getMutableService(serviceCode);
    const now = new Date().toISOString();
    service.webhookSecretStatus = 'rotation_pending';
    service.updatedAt = now;
    const record: DeveloperWebhookSecretRotationRequest = {
      ...request,
      rotationId: `whsec_rot_${crypto.randomUUID()}`,
      serviceCode: service.serviceCode,
      status: 'pending_review',
      requestedAt: now,
    };
    this.state.webhookSecretRotations.unshift(record);
    this.addEvent('developer.webhook_secret.rotation_requested', {
      serviceCode: service.serviceCode,
      environment: request.environment,
      data: {
        rotationId: record.rotationId,
        requestedBy: request.requestedBy,
      },
    });
    await this.persist();
    return record;
  }

  async decideWebhookSecretRotation(
    rotationId: string,
    decision: z.infer<typeof DeveloperApiKeyRotationDecisionSchema>,
  ) {
    this.assertReady();
    const record = this.state.webhookSecretRotations.find((item) => item.rotationId === rotationId);
    if (!record) throw new Error('DEVELOPER_WEBHOOK_SECRET_ROTATION_NOT_FOUND');
    const service = this.getMutableService(record.serviceCode);
    const now = new Date().toISOString();

    if (decision.decision === 'approve') {
      record.status = 'approved';
      service.webhookSecretStatus = 'rotation_pending';
      this.addEvent('developer.webhook_secret.rotation_approved', {
        serviceCode: service.serviceCode,
        environment: record.environment,
        data: { rotationId, decidedBy: decision.decidedBy },
      });
    } else if (decision.decision === 'complete') {
      record.status = 'completed';
      service.webhookSecrets = (service.webhookSecrets || []).map((secret) =>
        secret.environment === record.environment && secret.status === 'pending_cutover'
          ? { ...secret, status: 'revoked' as const, revokedAt: now }
          : secret,
      );
      service.webhookSecretStatus = 'active';
      this.addEvent('developer.webhook_secret.rotated', {
        serviceCode: service.serviceCode,
        environment: record.environment,
        data: { rotationId, decidedBy: decision.decidedBy },
      });
    } else {
      record.status = 'rejected';
      service.webhookSecretStatus = 'active';
      this.addEvent('developer.webhook_secret.rotation_rejected', {
        serviceCode: service.serviceCode,
        environment: record.environment,
        data: { rotationId, decidedBy: decision.decidedBy },
      });
    }

    record.decidedAt = now;
    record.decidedBy = decision.decidedBy;
    record.decisionReason = decision.reason;
    service.updatedAt = now;
    await this.persist();
    return { service, rotation: record };
  }

  async issueWebhookSecret(serviceCode: string, request: z.infer<typeof DeveloperSecretIssueRequestSchema>) {
    this.assertReady();
    const service = this.getMutableService(serviceCode);
    const now = new Date().toISOString();
    const secretId = `whsec_${crypto.randomUUID()}`;
    const secret = oneTimeSecret(`orbi_whsec_${request.environment}`);
    const record: DeveloperWebhookSecretRecord = {
      secretId,
      environment: request.environment,
      status: 'active' as const,
      fingerprint: fingerprint(secret),
      ...(config.secretEncryptionKey ? { encryptedSecret: encryptSecret(secret) } : {}),
      issuedAt: now,
      ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
    };
    service.webhookSecrets = [
      ...(service.webhookSecrets || []).map((item) =>
        item.environment === request.environment && item.status === 'active'
          ? { ...item, status: 'pending_cutover' as const }
          : item,
      ),
      record,
    ];
    service.webhookSecretStatus = 'active';
    service.updatedAt = now;
    this.addEvent('developer.webhook_secret.issued', {
      serviceCode: service.serviceCode,
      environment: request.environment,
      data: {
        secretId,
        fingerprint: record.fingerprint,
        requestedBy: request.requestedBy,
      },
    });
    await this.persist();
    return { service, webhookSecret: record, oneTimeSecret: secret };
  }

  async revokeWebhookSecret(
    serviceCode: string,
    secretId: string,
    request: z.infer<typeof DeveloperSecretRevokeRequestSchema>,
  ) {
    this.assertReady();
    const service = this.getMutableService(serviceCode);
    const now = new Date().toISOString();
    const secret = (service.webhookSecrets || []).find((item) => item.secretId === secretId);
    if (!secret) throw new Error('DEVELOPER_WEBHOOK_SECRET_NOT_FOUND');
    secret.status = 'revoked';
    secret.revokedAt = now;
    service.webhookSecretStatus = (service.webhookSecrets || []).some((item) =>
      item.environment === secret.environment &&
      item.status === 'active' &&
      (!item.expiresAt || Date.parse(item.expiresAt) > Date.now())
    ) ? 'active' : 'revoked';
    service.updatedAt = now;
    this.addEvent('developer.webhook_secret.revoked', {
      serviceCode: service.serviceCode,
      environment: secret.environment,
      data: {
        secretId,
        fingerprint: secret.fingerprint,
        revokedBy: request.revokedBy,
        reason: request.reason,
        metadata: request.metadata || {},
      },
    });
    await this.persist();
    return { service, webhookSecret: secret };
  }

  getActiveWebhookSigningSecret(serviceCode: string, environment?: 'sandbox' | 'live') {
    this.assertReady();
    const service = this.getMutableService(serviceCode);
    const now = Date.now();
    const secret = (service.webhookSecrets || [])
      .filter((item) =>
        (item.status === 'active' || item.status === 'pending_cutover') &&
        (!environment || item.environment === environment) &&
        (!item.expiresAt || Date.parse(item.expiresAt) > now),
      )
      .sort((left, right) => Date.parse(right.issuedAt) - Date.parse(left.issuedAt))[0] as
      | DeveloperWebhookSecretRecord
      | undefined;
    if (!secret?.encryptedSecret) throw new Error('DEVELOPER_WEBHOOK_SECRET_NOT_AVAILABLE');
    return decryptSecret(secret.encryptedSecret);
  }

  isReturnUrlAllowed(serviceCode: string, value: string | undefined) {
    this.assertReady();
    if (!value) return true;
    const service = this.state.services.find((item) => item.serviceCode === slug(serviceCode));
    if (!service || !service.redirectUrls?.length) return true;
    return service.redirectUrls.includes(value);
  }

  isWebhookUrlAllowed(serviceCode: string, value: string | undefined) {
    this.assertReady();
    if (!value) return true;
    const service = this.state.services.find((item) => item.serviceCode === slug(serviceCode));
    if (!service || !service.webhookUrls?.length) return true;
    return service.webhookUrls.includes(value);
  }

  listEvents(serviceCode?: string) {
    this.assertReady();
    const normalized = serviceCode ? slug(serviceCode) : '';
    return normalized
      ? this.state.events.filter((event) => event.serviceCode === normalized)
      : this.state.events;
  }

  private nextServiceCode(seed: string) {
    const base = slug(seed);
    let candidate = base;
    let index = 2;
    while (this.state.services.some((service) => service.serviceCode === candidate)) {
      candidate = `${base}-${index}`;
      index += 1;
    }
    return candidate;
  }

  private addEvent(
    eventType: DeveloperPortalEvent['eventType'],
    options: {
      serviceCode?: string;
      environment?: DeveloperPortalEvent['environment'];
      data: Record<string, unknown>;
    },
  ) {
    this.state.events.unshift({
      eventId: `dev_evt_${crypto.randomUUID()}`,
      eventType,
      serviceCode: options.serviceCode,
      environment: options.environment,
      occurredAt: new Date().toISOString(),
      data: options.data,
    });
  }

  private assertReady() {
    if (!this.initialized) throw new Error('DEVELOPER_PORTAL_STORE_NOT_INITIALIZED');
  }

  private async loadFromDatabase() {
    if (!this.pool) throw new Error('DATABASE_URL_REQUIRED');
    const [serviceRows, keyRows, secretRows, eventRows] = await Promise.all([
      this.pool.query('select * from public.pay_gateway_developer_services order by created_at desc'),
      this.pool.query('select * from public.pay_gateway_developer_api_keys order by issued_at asc'),
      this.pool.query('select * from public.pay_gateway_developer_webhook_secrets order by issued_at asc'),
      this.pool.query('select * from public.pay_gateway_developer_secret_events order by occurred_at desc'),
    ]);

    const services = serviceRows.rows.map((row): DeveloperServiceRecord => ({
      serviceCode: row.service_code,
      displayName: row.display_name,
      status: row.status,
      environments: row.environments || [],
      scopesGranted: row.scopes_granted || [],
      scopesPending: row.scopes_pending || [],
      redirectUrls: row.redirect_urls || [],
      webhookUrls: row.webhook_urls || [],
      keyStatus: 'not_issued',
      webhookSecretStatus: 'not_issued',
      keys: [],
      webhookSecrets: [],
      createdAt: iso(row.created_at) || new Date().toISOString(),
      updatedAt: iso(row.updated_at) || new Date().toISOString(),
      legalName: row.legal_name,
      businessType: row.business_type,
      countryCode: row.country_code,
      contactEmail: row.contact_email,
      contactPhone: row.contact_phone,
      externalDeveloperId: row.external_developer_id,
      metadata: row.metadata || {},
    }));

    const byService = new Map(services.map((service) => [service.serviceCode, service]));
    for (const row of keyRows.rows) {
      const service = byService.get(row.service_code);
      if (!service) continue;
      service.keys.push({
        keyId: row.key_id,
        environment: row.environment,
        status: row.status === 'revoked'
          ? 'revoked'
          : row.status === 'pending_cutover'
            ? 'pending_cutover'
            : 'active',
        fingerprint: row.fingerprint,
        issuedAt: iso(row.issued_at) || new Date().toISOString(),
        expiresAt: iso(row.expires_at),
        revokedAt: iso(row.revoked_at),
      });
    }
    for (const row of secretRows.rows) {
      const service = byService.get(row.service_code);
      if (!service) continue;
      service.webhookSecrets.push({
        secretId: row.secret_id,
        environment: row.environment,
        status: row.status === 'revoked'
          ? 'revoked'
          : row.status === 'pending_cutover'
            ? 'pending_cutover'
            : 'active',
        fingerprint: row.fingerprint,
        encryptedSecret: row.encrypted_secret || undefined,
        issuedAt: iso(row.issued_at) || new Date().toISOString(),
        expiresAt: iso(row.expires_at),
        revokedAt: iso(row.revoked_at),
      } as DeveloperWebhookSecretRecord);
    }
    for (const service of services) {
      service.keyStatus = service.keys.some((key) => key.status === 'pending_cutover')
        ? 'rotation_pending'
        : service.keys.some((key) => key.status === 'active')
          ? 'active'
          : 'not_issued';
      service.webhookSecretStatus = service.webhookSecrets.some((secret) => secret.status === 'pending_cutover')
        ? 'rotation_pending'
        : service.webhookSecrets.some((secret) => secret.status === 'active')
          ? 'active'
          : 'not_issued';
    }

    this.state = {
      ...emptyState(),
      services,
      events: eventRows.rows.map((row): DeveloperPortalEvent => ({
        eventId: row.event_id,
        eventType: row.event_type,
        serviceCode: row.service_code || undefined,
        environment: row.environment || undefined,
        occurredAt: iso(row.occurred_at) || new Date().toISOString(),
        data: row.metadata || {},
      })),
    };
  }

  private async persist() {
    if (this.mode === 'memory') return;
    if (!this.pool) throw new Error('DATABASE_URL_REQUIRED');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await this.persistServices(client);
      await this.persistSecrets(client);
      await this.persistEvents(client);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async persistServices(client: PoolClient) {
    for (const service of this.state.services) {
      await client.query(
        `insert into public.pay_gateway_developer_services (
          service_code, display_name, legal_name, business_type, country_code,
          contact_email, contact_phone, status, environments, scopes_granted,
          scopes_pending, redirect_urls, webhook_urls, external_developer_id,
          metadata, created_at, updated_at
        ) values (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
        ) on conflict (service_code) do update set
          display_name = excluded.display_name,
          legal_name = excluded.legal_name,
          business_type = excluded.business_type,
          country_code = excluded.country_code,
          contact_email = excluded.contact_email,
          contact_phone = excluded.contact_phone,
          status = excluded.status,
          environments = excluded.environments,
          scopes_granted = excluded.scopes_granted,
          scopes_pending = excluded.scopes_pending,
          redirect_urls = excluded.redirect_urls,
          webhook_urls = excluded.webhook_urls,
          external_developer_id = excluded.external_developer_id,
          metadata = excluded.metadata,
          updated_at = excluded.updated_at`,
        [
          service.serviceCode,
          service.displayName,
          service.legalName || null,
          service.businessType || null,
          service.countryCode || null,
          service.contactEmail || null,
          service.contactPhone || null,
          service.status,
          service.environments || [],
          service.scopesGranted || [],
          service.scopesPending || [],
          service.redirectUrls || [],
          service.webhookUrls || [],
          service.externalDeveloperId || null,
          service.metadata || {},
          service.createdAt,
          service.updatedAt,
        ],
      );
    }
  }

  private async persistSecrets(client: PoolClient) {
    await client.query('delete from public.pay_gateway_developer_api_keys');
    await client.query('delete from public.pay_gateway_developer_webhook_secrets');
    for (const service of this.state.services) {
      for (const key of service.keys || []) {
        await client.query(
          `insert into public.pay_gateway_developer_api_keys (
            key_id, service_code, environment, fingerprint, status,
            issued_at, expires_at, revoked_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            key.keyId,
            service.serviceCode,
            key.environment,
            key.fingerprint,
            key.status,
            key.issuedAt,
            key.expiresAt || null,
            key.revokedAt || null,
          ],
        );
      }
      for (const secret of service.webhookSecrets || []) {
        const webhookSecret = secret as DeveloperWebhookSecretRecord;
        await client.query(
          `insert into public.pay_gateway_developer_webhook_secrets (
            secret_id, service_code, environment, fingerprint, status,
            encrypted_secret, issued_at, expires_at, revoked_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            webhookSecret.secretId,
            service.serviceCode,
            webhookSecret.environment,
            webhookSecret.fingerprint,
            webhookSecret.status,
            webhookSecret.encryptedSecret || null,
            webhookSecret.issuedAt,
            webhookSecret.expiresAt || null,
            webhookSecret.revokedAt || null,
          ],
        );
      }
    }
  }

  private async persistEvents(client: PoolClient) {
    await client.query('delete from public.pay_gateway_developer_secret_events');
    for (const event of this.state.events) {
      await client.query(
        `insert into public.pay_gateway_developer_secret_events (
          event_id, service_code, environment, event_type, metadata, occurred_at
        ) values ($1,$2,$3,$4,$5,$6)`,
        [
          event.eventId,
          event.serviceCode || null,
          event.environment || null,
          event.eventType,
          event.data || {},
          event.occurredAt,
        ],
      );
    }
  }
}

export const developerPortalStore = new DeveloperPortalStore();
