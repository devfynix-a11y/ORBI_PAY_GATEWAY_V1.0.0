import crypto from 'crypto';
import { Pool, type PoolClient } from 'pg';
import type express from 'express';
import { config } from '../config.js';

export type PortalRole = 'developer' | 'operator' | 'admin';

export type PortalAccount = {
  userId?: string;
  email: string;
  name: string;
  role: PortalRole;
  permissions?: string[];
  liveAccess?: boolean;
  serviceCodes?: string[];
  passwordSalt: string;
  passwordHash: string;
  passwordIterations: number;
  totpSecret?: string;
  mfaRequired?: boolean;
  enabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type PortalSessionClaims = {
  sub: string;
  email: string;
  name: string;
  role: PortalRole;
  liveAccess: boolean;
  serviceCodes: string[];
  permissions: string[];
  mfaVerified: boolean;
  mfaRequired: boolean;
  iat: number;
  exp: number;
};

type PortalAuditEvent = {
  eventId: string;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  target?: string;
  environment?: string;
  ipHash?: string;
  userAgentHash?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

const ROLE_ORDER: Record<PortalRole, number> = { developer: 1, operator: 2, admin: 3 };

const ROLE_PERMISSIONS: Record<PortalRole, string[]> = {
  developer: ['developer:request_access', 'developer:read_own'],
  operator: [
    'developer:request_access',
    'developer:read_own',
    'developer:read_all',
    'developer:approve_applications',
    'developer:manage_scopes',
    'developer:manage_services',
    'developer:manage_keys',
    'developer:replay_webhooks',
    'developer:manage_sandbox',
    'operator:manage_incidents',
  ],
  admin: [
    'developer:request_access',
    'developer:read_own',
    'developer:read_all',
    'developer:approve_applications',
    'developer:manage_scopes',
    'developer:manage_services',
    'developer:manage_keys',
    'developer:replay_webhooks',
    'developer:manage_sandbox',
    'operator:manage_incidents',
    'portal:manage_users',
    'portal:read_audit',
  ],
};

const iso = (value: unknown): string | undefined => {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

const normalizeEmail = (value: unknown): string => String(value || '').trim().toLowerCase();

const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const hashOptional = (value: unknown): string | undefined => {
  const text = String(value || '').trim();
  if (!text) return undefined;
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 24);
};

const roleFrom = (value: unknown): PortalRole => {
  if (value === 'admin' || value === 'operator' || value === 'developer') return value;
  return 'developer';
};

const uniqueStrings = (value: unknown): string[] =>
  [...new Set((Array.isArray(value) ? value : []).map(String).map((item) => item.trim()).filter(Boolean))];

const publicAccount = (account: PortalAccount) => ({
  userId: account.userId,
  email: account.email,
  name: account.name || account.email,
  role: account.role || 'developer',
  permissions: permissionsForAccount(account),
  liveAccess: Boolean(account.liveAccess),
  serviceCodes: Array.isArray(account.serviceCodes) ? account.serviceCodes : [],
  mfaRequired: Boolean(account.mfaRequired),
  enabled: account.enabled !== false,
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
});

const permissionsForAccount = (account: Pick<PortalAccount, 'role' | 'permissions'>): string[] =>
  [...new Set([...(ROLE_PERMISSIONS[roleFrom(account.role)] || []), ...uniqueStrings(account.permissions)])];

const portalMfaRequiredFor = (account: Pick<PortalAccount, 'role' | 'mfaRequired'>): boolean =>
  Boolean(account.mfaRequired) ||
  (config.portal.operatorMfaRequired && ROLE_ORDER[roleFrom(account.role)] >= ROLE_ORDER.operator);

const hashPassword = (password: string, salt: string, iterations: number): string =>
  crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64url');

const base64UrlJson = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

const base32Decode = (value: string): Buffer => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(value || '').replace(/\s+/g, '').replace(/=+$/g, '').toUpperCase();
  let bits = '';
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid TOTP secret.');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};

const randomBase32 = (bytes = 20): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const data = crypto.randomBytes(bytes);
  let bits = '';
  for (const byte of data) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    out += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  }
  return out;
};

const totpCode = (secret: string, stepOffset = 0): string => {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 30000) + stepOffset;
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);
  const digest = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0xf;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
};

export class PortalAccessStore {
  private pool?: Pool;
  private initialized = false;

  async initialize() {
    if (this.initialized) return;
    if (!config.databaseUrl) throw new Error('DATABASE_URL_REQUIRED');
    this.pool = new Pool({ connectionString: config.databaseUrl });
    await this.ensureSchema();
    await this.ensureBootstrapAdmin();
    this.initialized = true;
  }

  async login(input: { email?: unknown; password?: unknown; otp?: unknown }, req?: express.Request) {
    const account = await this.findAccount(input.email);
    if (!account || !this.verifyPassword(account, String(input.password || ''))) {
      await this.writeAuditEvent(req, {
        action: 'portal.auth.failed',
        target: normalizeEmail(input.email),
        metadata: { reason: 'invalid_credentials' },
      });
      throw new Error('PORTAL_INVALID_CREDENTIALS');
    }
    if (!this.verifyTotp(account, input.otp)) {
      await this.writeAuditEvent(req, {
        action: 'portal.auth.mfa_failed',
        target: account.email,
        metadata: { reason: 'invalid_otp' },
      });
      throw new Error('PORTAL_INVALID_MFA_CODE');
    }
    await this.writeAuditEvent(req, {
      action: 'portal.auth.login',
      target: account.email,
      metadata: { actorEmail: account.email, actorRole: account.role },
    });
    return { token: this.signSession(account), user: publicAccount(account) };
  }

  verifySessionToken(token: string) {
    if (!token) return { ok: false as const, status: 401, error: 'Sign in to continue.' };
    const parts = token.split('.');
    if (parts.length !== 3) return { ok: false as const, status: 401, error: 'Invalid portal session.' };
    const [header, payload, signature] = parts;
    const expected = this.hmac(`${header}.${payload}`);
    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(signature);
    if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
      return { ok: false as const, status: 401, error: 'Invalid portal session.' };
    }
    let claims: PortalSessionClaims;
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PortalSessionClaims;
    } catch {
      return { ok: false as const, status: 401, error: 'Invalid portal session.' };
    }
    if (!claims.exp || Number(claims.exp) <= Math.floor(Date.now() / 1000)) {
      return { ok: false as const, status: 401, error: 'Your session has expired. Sign in again.' };
    }
    return { ok: true as const, claims };
  }

  requireSession(req: express.Request, minRole: PortalRole = 'developer') {
    const session = this.verifySessionToken(this.readBearer(req));
    if (!session.ok) return session;
    const role = roleFrom(session.claims.role);
    if (ROLE_ORDER[role] < ROLE_ORDER[minRole]) {
      return { ok: false as const, status: 403, error: 'Your account does not have access to this action.' };
    }
    return { ok: true as const, claims: session.claims, role };
  }

  requirePermission(req: express.Request, permission: string, minRole: PortalRole = 'developer') {
    const session = this.requireSession(req, minRole);
    if (!session.ok) return session;
    if (!session.claims.permissions.includes(permission)) {
      return { ok: false as const, status: 403, error: 'Your account does not have permission for this action.' };
    }
    return session;
  }

  requireMfa(req: express.Request, minRole: PortalRole = 'operator') {
    const session = this.requireSession(req, minRole);
    if (!session.ok) return session;
    if (!session.claims.mfaVerified) {
      return { ok: false as const, status: 403, error: 'MFA is required for this sensitive action.' };
    }
    return session;
  }

  async mfaSetup(req: express.Request) {
    const session = this.requireSession(req, 'developer');
    if (!session.ok) return session;
    const account = await this.findAccount(session.claims.email);
    if (!account?.totpSecret) return { ok: false as const, status: 404, error: 'MFA setup is not configured for this account.' };
    return {
      ok: true as const,
      data: {
        otpauthUri: this.totpSetupUri(account),
        secret: account.totpSecret,
        mfaRequired: Boolean(account.mfaRequired),
      },
    };
  }

  async listUsers(req: express.Request) {
    const session = this.requirePermission(req, 'portal:manage_users', 'admin');
    if (!session.ok) return session;
    const result = await this.db().query('select * from public.pay_gateway_portal_users order by created_at desc');
    return { ok: true as const, data: result.rows.map((row) => publicAccount(this.accountFromRow(row))) };
  }

  async createUser(req: express.Request, input: Record<string, unknown>) {
    const session = this.requirePermission(req, 'portal:manage_users', 'admin');
    if (!session.ok) return session;
    const sensitive = this.requireSensitiveWrite(req, 'portal.user.create');
    if (!sensitive.ok) return sensitive;
    const password = String(input.password || '').trim();
    if (password.length < 12) return { ok: false as const, status: 400, error: 'Password must contain at least 12 characters.' };
    const role = roleFrom(input.role);
    const salt = crypto.randomBytes(16).toString('base64url');
    const iterations = 210000;
    const userId = `portal_user_${crypto.randomUUID()}`;
    const totpSecret = input.totpSecret
      ? String(input.totpSecret).trim().replace(/\s+/g, '').toUpperCase()
      : (Boolean(input.mfaRequired) || ROLE_ORDER[role] >= ROLE_ORDER.operator)
        ? randomBase32(20)
        : null;
    const result = await this.db().query(
      `insert into public.pay_gateway_portal_users (
        user_id, email, name, role, permissions, live_access, service_codes,
        password_salt, password_hash, password_iterations, totp_secret, mfa_required, enabled
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)
      returning *`,
      [
        userId,
        normalizeEmail(input.email),
        String(input.name || input.email || '').trim(),
        role,
        uniqueStrings(input.permissions),
        Boolean(input.liveAccess),
        uniqueStrings(input.serviceCodes),
        salt,
        hashPassword(password, salt, iterations),
        iterations,
        totpSecret,
        Boolean(input.mfaRequired) || ROLE_ORDER[role] >= ROLE_ORDER.operator,
      ],
    );
    const account = this.accountFromRow(result.rows[0]);
    await this.writeAuditEvent(req, {
      action: 'portal.user.created',
      target: account.email,
      metadata: { role, liveAccess: Boolean(input.liveAccess), createdUserId: userId },
    });
    return {
      ok: true as const,
      data: {
        ...publicAccount(account),
        mfaSetup: account.mfaRequired ? { otpauthUri: this.totpSetupUri(account), secret: account.totpSecret } : undefined,
      },
    };
  }

  async signupDeveloper(req: express.Request, input: Record<string, unknown>) {
    const email = normalizeEmail(input.email);
    const name = String(input.name || '').trim();
    const password = String(input.password || '').trim();
    const companyName = String(input.companyName || '').trim();
    const countryCode = String(input.countryCode || '').trim().toUpperCase();
    const useCase = String(input.useCase || '').trim();

    if (!isValidEmail(email)) return { ok: false as const, status: 400, error: 'Enter a valid business email address.' };
    if (name.length < 2) return { ok: false as const, status: 400, error: 'Enter your full name.' };
    if (password.length < 12) return { ok: false as const, status: 400, error: 'Password must contain at least 12 characters.' };
    if (companyName.length < 2) return { ok: false as const, status: 400, error: 'Enter your business or project name.' };
    if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
      return { ok: false as const, status: 400, error: 'Country code must use two letters, for example TZ.' };
    }
    if (useCase.length < 12) return { ok: false as const, status: 400, error: 'Tell us briefly what you want to build with ORBI.' };
    if (input.termsAccepted !== true) return { ok: false as const, status: 400, error: 'Accept the developer terms to continue.' };

    const existing = await this.db().query('select user_id from public.pay_gateway_portal_users where lower(email) = lower($1) limit 1', [email]);
    if (existing.rows[0]) return { ok: false as const, status: 409, error: 'A developer account already exists for this email.' };

    const salt = crypto.randomBytes(16).toString('base64url');
    const iterations = 210000;
    const userId = `portal_user_${crypto.randomUUID()}`;
    const result = await this.db().query(
      `insert into public.pay_gateway_portal_users (
        user_id, email, name, role, permissions, live_access, service_codes,
        password_salt, password_hash, password_iterations, totp_secret, mfa_required, enabled
      ) values ($1,$2,$3,'developer',$4,false,'{}',$5,$6,$7,null,false,true)
      returning *`,
      [
        userId,
        email,
        name,
        ROLE_PERMISSIONS.developer,
        salt,
        hashPassword(password, salt, iterations),
        iterations,
      ],
    );
    const account = this.accountFromRow(result.rows[0]);
    await this.writeAuditEvent(req, {
      action: 'portal.developer.signup',
      target: account.email,
      metadata: {
        companyName,
        countryCode: countryCode || undefined,
        useCase,
        sandboxOnly: true,
        createdUserId: userId,
      },
    });
    return {
      ok: true as const,
      data: {
        user: publicAccount(account),
        nextStep: 'Sign in and start building in sandbox. Request production access when your integration is ready.',
      },
    };
  }

  async updateUser(req: express.Request, userId: string, input: Record<string, unknown>) {
    const session = this.requirePermission(req, 'portal:manage_users', 'admin');
    if (!session.ok) return session;
    const sensitive = this.requireSensitiveWrite(req, 'portal.user.update');
    if (!sensitive.ok) return sensitive;
    const current = await this.db().query('select * from public.pay_gateway_portal_users where user_id = $1 limit 1', [userId]);
    if (!current.rows[0]) return { ok: false as const, status: 404, error: 'Portal user not found.' };
    const existing = this.accountFromRow(current.rows[0]);
    const role = input.role ? roleFrom(input.role) : existing.role;
    const result = await this.db().query(
      `update public.pay_gateway_portal_users set
        name = $2,
        role = $3,
        permissions = $4,
        live_access = $5,
        service_codes = $6,
        mfa_required = $7,
        enabled = $8,
        updated_at = now()
      where user_id = $1
      returning *`,
      [
        userId,
        String(input.name || existing.name),
        role,
        input.permissions === undefined ? existing.permissions || [] : uniqueStrings(input.permissions),
        input.liveAccess === undefined ? Boolean(existing.liveAccess) : Boolean(input.liveAccess),
        input.serviceCodes === undefined ? existing.serviceCodes || [] : uniqueStrings(input.serviceCodes),
        input.mfaRequired === undefined
          ? Boolean(existing.mfaRequired) || ROLE_ORDER[role] >= ROLE_ORDER.operator
          : Boolean(input.mfaRequired) || ROLE_ORDER[role] >= ROLE_ORDER.operator,
        input.enabled === undefined ? existing.enabled !== false : Boolean(input.enabled),
      ],
    );
    await this.writeAuditEvent(req, { action: 'portal.user.updated', target: existing.email, metadata: { userId, role } });
    return { ok: true as const, data: publicAccount(this.accountFromRow(result.rows[0])) };
  }

  async listAuditEvents(req: express.Request) {
    const session = this.requirePermission(req, 'portal:read_audit', 'admin');
    if (!session.ok) return session;
    const result = await this.db().query('select * from public.pay_gateway_portal_audit_events order by created_at desc limit 200');
    return {
      ok: true as const,
      data: result.rows.map((row) => ({
        eventId: row.event_id,
        actorEmail: row.actor_email,
        actorRole: row.actor_role,
        action: row.action,
        target: row.target,
        environment: row.environment,
        createdAt: iso(row.created_at),
        metadata: row.metadata || {},
      })),
    };
  }

  async writeAuditEvent(
    req: express.Request | undefined,
    input: { action: string; target?: string; environment?: string; metadata?: Record<string, unknown> },
  ) {
    const session = req ? this.verifySessionToken(this.readBearer(req)) : { ok: false as const };
    const claims = session.ok ? session.claims : undefined;
    const event: PortalAuditEvent = {
      eventId: `portal_audit_${crypto.randomUUID()}`,
      actorEmail: claims?.email || String(input.metadata?.actorEmail || '') || undefined,
      actorRole: claims?.role || String(input.metadata?.actorRole || '') || undefined,
      action: input.action,
      target: input.target,
      environment: input.environment,
      ipHash: req ? hashOptional(req.headers['x-forwarded-for'] || req.socket?.remoteAddress) : undefined,
      userAgentHash: req ? hashOptional(req.headers['user-agent']) : undefined,
      metadata: input.metadata || {},
      createdAt: new Date().toISOString(),
    };
    await this.db().query(
      `insert into public.pay_gateway_portal_audit_events (
        event_id, actor_email, actor_role, action, target, environment,
        ip_hash, user_agent_hash, metadata, created_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        event.eventId,
        event.actorEmail || null,
        event.actorRole || null,
        event.action,
        event.target || null,
        event.environment || null,
        event.ipHash || null,
        event.userAgentHash || null,
        event.metadata || {},
        event.createdAt,
      ],
    );
    return event;
  }

  publicUserFromClaims(claims: PortalSessionClaims) {
    return {
      email: claims.email,
      name: claims.name,
      role: claims.role,
      liveAccess: Boolean(claims.liveAccess),
      serviceCodes: Array.isArray(claims.serviceCodes) ? claims.serviceCodes : [],
      permissions: Array.isArray(claims.permissions) ? claims.permissions : [],
      mfaRequired: Boolean(claims.mfaRequired),
      mfaVerified: Boolean(claims.mfaVerified),
    };
  }

  private signSession(account: PortalAccount) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64UrlJson({ alg: 'HS256', typ: 'ORBI_PORTAL_SESSION' });
    const payload = base64UrlJson({
      sub: account.email,
      name: account.name || account.email,
      email: account.email,
      role: account.role || 'developer',
      liveAccess: Boolean(account.liveAccess),
      serviceCodes: Array.isArray(account.serviceCodes) ? account.serviceCodes : [],
      permissions: permissionsForAccount(account),
      mfaVerified: portalMfaRequiredFor(account) ? Boolean(account.totpSecret) : true,
      mfaRequired: portalMfaRequiredFor(account),
      iat: now,
      exp: now + config.portal.sessionTtlSeconds,
    });
    const unsigned = `${header}.${payload}`;
    return `${unsigned}.${this.hmac(unsigned)}`;
  }

  private hmac(value: string) {
    if (!config.portal.authSecret) throw new Error('PORTAL_AUTH_SECRET_REQUIRED');
    return crypto.createHmac('sha256', config.portal.authSecret).update(value).digest('base64url');
  }

  private verifyPassword(account: PortalAccount, password: string) {
    const calculated = hashPassword(password, account.passwordSalt, account.passwordIterations || 210000);
    const actual = Buffer.from(account.passwordHash);
    const expected = Buffer.from(calculated);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }

  private verifyTotp(account: PortalAccount, code: unknown) {
    if (!portalMfaRequiredFor(account)) return true;
    if (!account.totpSecret) return false;
    const clean = String(code || '').trim();
    if (!/^\d{6}$/.test(clean)) return false;
    return [-1, 0, 1].some((offset) => totpCode(account.totpSecret!, offset) === clean);
  }

  private totpSetupUri(account: PortalAccount) {
    if (!account.totpSecret) return undefined;
    const issuer = encodeURIComponent(config.portal.totpIssuer);
    const label = encodeURIComponent(`${config.portal.totpIssuer}:${account.email}`);
    return `otpauth://totp/${label}?secret=${encodeURIComponent(account.totpSecret)}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  }

  private async findAccount(email: unknown) {
    const normalized = normalizeEmail(email);
    if (!normalized) return undefined;
    const result = await this.db().query(
      'select * from public.pay_gateway_portal_users where lower(email) = lower($1) and enabled = true limit 1',
      [normalized],
    );
    return result.rows[0] ? this.accountFromRow(result.rows[0]) : undefined;
  }

  private async ensureBootstrapAdmin() {
    const admin = config.portal.bootstrapAdmin;
    if (!admin.email || !admin.passwordHash || !admin.passwordSalt) return;
    await this.db().query(
      `insert into public.pay_gateway_portal_users (
        user_id, email, name, role, permissions, live_access, service_codes,
        password_salt, password_hash, password_iterations, totp_secret, mfa_required, enabled
      ) values ($1,$2,$3,$4,$5,true,'{}',$6,$7,$8,$9,$10,true)
      on conflict (email) do nothing`,
      [
        `portal_user_${crypto.createHash('sha256').update(admin.email).digest('hex').slice(0, 24)}`,
        normalizeEmail(admin.email),
        admin.name,
        roleFrom(admin.role),
        ROLE_PERMISSIONS.admin,
        admin.passwordSalt,
        admin.passwordHash,
        admin.passwordIterations,
        admin.totpSecret || null,
        portalMfaRequiredFor({ role: roleFrom(admin.role), mfaRequired: admin.mfaRequired }),
      ],
    );
  }

  private requireSensitiveWrite(req: express.Request, action: string) {
    const mfa = this.requireMfa(req, 'admin');
    if (!mfa.ok) return mfa;
    if (!req.body?.confirmationAccepted) {
      return { ok: false as const, status: 409, error: 'Confirmation is required before this admin action can continue.' };
    }
    if (!String(req.body?.reason || '').trim()) {
      return { ok: false as const, status: 400, error: 'A clear reason is required for this admin action.' };
    }
    return { ok: true as const, claims: mfa.claims, action };
  }

  private accountFromRow(row: any): PortalAccount {
    return {
      userId: row.user_id,
      email: row.email,
      name: row.name,
      role: roleFrom(row.role),
      permissions: row.permissions || [],
      liveAccess: Boolean(row.live_access),
      serviceCodes: row.service_codes || [],
      passwordSalt: row.password_salt,
      passwordHash: row.password_hash,
      passwordIterations: Number(row.password_iterations || 210000),
      totpSecret: row.totp_secret || undefined,
      mfaRequired: Boolean(row.mfa_required),
      enabled: Boolean(row.enabled),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  private async ensureSchema() {
    await this.withClient(async (client) => {
      await client.query(`
        create table if not exists public.pay_gateway_portal_users (
          user_id text primary key,
          email text not null unique,
          name text not null,
          role text not null check (role in ('developer','operator','admin')),
          permissions text[] not null default '{}',
          live_access boolean not null default false,
          service_codes text[] not null default '{}',
          password_salt text not null,
          password_hash text not null,
          password_iterations integer not null default 210000,
          totp_secret text,
          mfa_required boolean not null default false,
          enabled boolean not null default true,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );
        create table if not exists public.pay_gateway_portal_audit_events (
          event_id text primary key,
          actor_email text,
          actor_role text,
          action text not null,
          target text,
          environment text,
          ip_hash text,
          user_agent_hash text,
          metadata jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now()
        );
        create index if not exists pay_gateway_portal_audit_created_idx
          on public.pay_gateway_portal_audit_events (created_at desc);
      `);
    });
  }

  private readBearer(req: express.Request) {
    const header = String(req.headers.authorization || '');
    return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  }

  private db() {
    if (!this.pool) throw new Error('PORTAL_ACCESS_STORE_NOT_INITIALIZED');
    return this.pool;
  }

  private async withClient<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db().connect();
    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }
}

export const portalAccessStore = new PortalAccessStore();
