import crypto from 'crypto';
import { Pool, type PoolClient } from 'pg';
import type express from 'express';
import { config } from '../config.js';
import { decryptSecret, encryptSecret, type EncryptedSecretEnvelope } from '../security/secretVaultCrypto.js';
import { orbiTalkClient } from './orbiTalkClient.js';

export type PortalRole = 'developer' | 'operator' | 'admin';

export type PortalAccount = {
  userId?: string;
  username?: string;
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
  totpSecretEncrypted?: EncryptedSecretEnvelope;
  mfaStatus?: 'disabled' | 'pending' | 'active';
  lastTotpCounter?: number;
  mfaFailedAttempts?: number;
  mfaLockedUntil?: string;
  emailVerifiedAt?: string;
  mfaRequired?: boolean;
  enabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type PortalSessionClaims = {
  sid: string;
  sub: string;
  username?: string;
  email: string;
  name: string;
  role: PortalRole;
  liveAccess: boolean;
  serviceCodes: string[];
  permissions: string[];
  mfaVerified: boolean;
  mfaRequired: boolean;
  mfaStatus: 'disabled' | 'pending' | 'active';
  mfaAt?: number;
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

type PortalTeamInvitation = {
  invitationId: string;
  email: string;
  name?: string;
  role: PortalRole;
  permissions: string[];
  liveAccess: boolean;
  serviceCodes: string[];
  invitedBy: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  deliveryStatus?: string;
  createdAt: string;
  updatedAt: string;
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

const normalizeUsername = (value: unknown): string => String(value || '').trim().toLowerCase();

const isValidUsername = (value: string): boolean => /^[a-z0-9][a-z0-9_-]{2,31}$/.test(value);

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
  username: account.username,
  email: account.email,
  name: account.name || account.email,
  role: account.role || 'developer',
  permissions: permissionsForAccount(account),
  liveAccess: Boolean(account.liveAccess),
  serviceCodes: Array.isArray(account.serviceCodes) ? account.serviceCodes : [],
  mfaRequired: Boolean(account.mfaRequired),
  mfaStatus: account.mfaStatus || (account.totpSecret || account.totpSecretEncrypted ? 'active' : 'disabled'),
  enabled: account.enabled !== false,
  emailVerified: Boolean(account.emailVerifiedAt),
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

const hashInviteToken = (token: string): string =>
  crypto.createHash('sha256').update(`portal-team-invite:${token}`).digest('base64url');

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

const totpAtCounter = (secret: string, counter: number): string => {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);
  const digest = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0xf;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
};

const currentTotpCounter = (): number => Math.floor(Date.now() / 30000);

const normalizeRecoveryCode = (value: unknown): string =>
  String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

const newRecoveryCode = (): string => {
  const raw = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `ORBI-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
};

export class PortalAccessStore {
  private pool?: Pool;
  private initialized = false;
  private activeSessions = new Set<string>();

  async initialize() {
    if (this.initialized) return;
    if (!config.databaseUrl) throw new Error('DATABASE_URL_REQUIRED');
    this.pool = new Pool({ connectionString: config.databaseUrl });
    await this.ensureSchema();
    await this.ensureBootstrapAdmin();
    await this.migrateLegacyTotpSecrets();
    await this.loadActiveSessions();
    this.initialized = true;
  }

  async login(input: { email?: unknown; password?: unknown; otp?: unknown; recoveryCode?: unknown }, req?: express.Request) {
    const account = await this.findAccount(input.email);
    if (!account || !this.verifyPassword(account, String(input.password || ''))) {
      await this.writeAuditEvent(req, {
        action: 'portal.auth.failed',
        target: normalizeEmail(input.email),
        metadata: { reason: 'invalid_credentials' },
      });
      throw new Error('PORTAL_INVALID_CREDENTIALS');
    }
    if (!account.emailVerifiedAt) {
      await this.writeAuditEvent(req, {
        action: 'portal.auth.email_verification_required',
        target: account.email,
      });
      throw new Error('PORTAL_EMAIL_VERIFICATION_REQUIRED');
    }
    const mfaRequired = portalMfaRequiredFor(account);
    const mfaActive = account.mfaStatus === 'active';
    let mfaVerified = false;
    if (mfaRequired && mfaActive) {
      if (account.mfaLockedUntil && new Date(account.mfaLockedUntil).getTime() > Date.now()) {
        await this.writeAuditEvent(req, {
          action: 'portal.auth.mfa_locked',
          target: account.email,
          metadata: { lockedUntil: account.mfaLockedUntil },
        });
        await this.sendPortalSecurityEmail(account, 'portal.auth.mfa_locked', {
          reason: 'Existing MFA lockout window is still active.',
          lockedUntil: account.mfaLockedUntil,
        }, req);
        throw new Error('PORTAL_MFA_TEMPORARILY_LOCKED');
      }
      const usedRecoveryCode = Boolean(normalizeRecoveryCode(input.recoveryCode));
      const verified = usedRecoveryCode
        ? await this.consumeRecoveryCode(account, input.recoveryCode)
        : await this.verifyTotp(account, input.otp);
      if (!verified) {
        const lock = await this.recordMfaFailure(account);
        await this.writeAuditEvent(req, {
          action: 'portal.auth.mfa_failed',
          target: account.email,
          metadata: {
            reason: usedRecoveryCode ? 'invalid_or_used_recovery_code' : 'invalid_or_replayed_otp',
            failedAttempts: lock.failedAttempts,
            lockedUntil: lock.lockedUntil,
          },
        });
        if (lock.lockedUntil) {
          await this.sendPortalSecurityEmail(account, 'portal.auth.mfa_locked', {
            reason: usedRecoveryCode ? 'Invalid or used recovery code.' : 'Invalid or replayed authenticator code.',
            failedAttempts: lock.failedAttempts,
            lockedUntil: lock.lockedUntil,
          }, req);
        }
        throw new Error(lock.lockedUntil ? 'PORTAL_MFA_TEMPORARILY_LOCKED' : 'PORTAL_INVALID_MFA_CODE');
      }
      await this.clearMfaFailures(account);
      mfaVerified = true;
      if (usedRecoveryCode) {
        await this.writeAuditEvent(req, {
          action: 'portal.auth.recovery_code_used',
          target: account.email,
          metadata: { remainingCodes: await this.recoveryCodeCount(account.userId!) },
        });
      }
    } else if (!mfaRequired) {
      mfaVerified = true;
    }
    if (mfaRequired && !mfaActive) {
      await this.writeAuditEvent(req, {
        action: 'portal.auth.mfa_enrollment_required',
        target: account.email,
        metadata: { mfaStatus: account.mfaStatus || 'disabled' },
      });
    }
    await this.writeAuditEvent(req, {
      action: 'portal.auth.login',
      target: account.email,
      metadata: { actorEmail: account.email, actorRole: account.role },
    });
    return {
      ...(await this.issueSession(account, mfaVerified, req)),
      user: publicAccount(account),
      mfaEnrollmentRequired: mfaRequired && !mfaActive,
    };
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
    if (!claims.sid || !this.activeSessions.has(claims.sid)) {
      return { ok: false as const, status: 401, error: 'Your session is no longer active. Sign in again.' };
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
    const freshness = Math.max(30, config.portal.mfaFreshnessSeconds);
    if (!session.claims.mfaAt || Math.floor(Date.now() / 1000) - session.claims.mfaAt > freshness) {
      return { ok: false as const, status: 403, error: 'Fresh MFA verification is required for this sensitive action.' };
    }
    return session;
  }

  async logout(req: express.Request) {
    const session = this.verifySessionToken(this.readBearer(req));
    if (!session.ok) return { ok: true as const, data: { revoked: false } };
    this.activeSessions.delete(session.claims.sid);
    await this.db().query(
      `update public.pay_gateway_portal_sessions
       set revoked_at = now(), revoke_reason = 'user_logout'
       where session_id = $1 and revoked_at is null`,
      [session.claims.sid],
    );
    await this.writeAuditEvent(undefined, {
      action: 'portal.auth.logout',
      target: session.claims.email,
      metadata: { actorEmail: session.claims.email, actorRole: session.claims.role, sessionId: session.claims.sid },
    });
    return { ok: true as const, data: { revoked: true } };
  }

  async mfaStatus(req: express.Request) {
    const session = this.requireSession(req, 'developer');
    if (!session.ok) return session;
    const account = await this.findAccount(session.claims.email);
    if (!account) return { ok: false as const, status: 404, error: 'Portal account not found.' };
    return {
      ok: true as const,
      data: {
        mfaRequired: Boolean(account.mfaRequired),
        status: account.mfaStatus || 'disabled',
      },
    };
  }

  async startMfaEnrollment(req: express.Request) {
    const session = this.requireSession(req, 'developer');
    if (!session.ok) return session;
    const account = await this.findAccount(session.claims.email);
    if (!account) return { ok: false as const, status: 404, error: 'Portal account not found.' };
    if (account.mfaStatus === 'active') {
      return { ok: false as const, status: 409, error: 'MFA is already active. Reset it through account security support.' };
    }
    const secret = randomBase32(20);
    const encrypted = encryptSecret(secret);
    await this.db().query(
      `update public.pay_gateway_portal_users
       set totp_secret_encrypted = $2, totp_secret = null, mfa_status = 'pending',
           last_totp_counter = null, updated_at = now()
       where user_id = $1`,
      [account.userId, encrypted],
    );
    const pendingAccount = { ...account, totpSecret: secret, mfaStatus: 'pending' as const };
    await this.writeAuditEvent(req, {
      action: 'portal.auth.mfa_enrollment_started',
      target: account.email,
      metadata: { factor: 'totp' },
    });
    return {
      ok: true as const,
      data: {
        otpauthUri: this.totpSetupUri(pendingAccount),
        secret,
        status: 'pending',
      },
    };
  }

  async confirmMfaEnrollment(req: express.Request, input: Record<string, unknown>) {
    const session = this.requireSession(req, 'developer');
    if (!session.ok) return session;
    const account = await this.findAccount(session.claims.email);
    if (!account) return { ok: false as const, status: 404, error: 'Portal account not found.' };
    if (account.mfaStatus !== 'pending' || !account.totpSecretEncrypted) {
      return { ok: false as const, status: 409, error: 'Start authenticator setup before verifying a code.' };
    }
    const verified = this.matchTotp(account, input.code, false);
    if (!verified) {
      await this.writeAuditEvent(req, {
        action: 'portal.auth.mfa_enrollment_failed',
        target: account.email,
        metadata: { reason: 'invalid_code' },
      });
      return { ok: false as const, status: 400, error: 'The authenticator code is invalid or expired.' };
    }
    await this.db().query(
      `update public.pay_gateway_portal_users
       set mfa_status = 'active', mfa_required = true, last_totp_counter = $2, updated_at = now()
       where user_id = $1`,
      [account.userId, verified.counter],
    );
    const activeAccount = { ...account, mfaStatus: 'active' as const, mfaRequired: true, lastTotpCounter: verified.counter };
    const recoveryCodes = await this.replaceRecoveryCodes(account.userId!);
    await this.writeAuditEvent(req, {
      action: 'portal.auth.mfa_enrollment_completed',
      target: account.email,
      metadata: { factor: 'totp' },
    });
    return {
      ok: true as const,
      data: {
        ...(await this.issueSession(activeAccount, true, req)),
        user: publicAccount(activeAccount),
        status: 'active',
        recoveryCodes,
      },
    };
  }

  async stepUpMfa(req: express.Request, input: Record<string, unknown>) {
    const session = this.requireSession(req, 'developer');
    if (!session.ok) return session;
    const account = await this.findAccount(session.claims.email);
    if (!account || account.mfaStatus !== 'active') {
      return { ok: false as const, status: 409, error: 'Active MFA enrollment is required.' };
    }
    const verified = await this.verifyTotp(account, input.code);
    if (!verified) {
      await this.writeAuditEvent(req, {
        action: 'portal.auth.mfa_step_up_failed',
        target: account.email,
        metadata: { reason: 'invalid_or_replayed_otp' },
      });
      return { ok: false as const, status: 400, error: 'The authenticator code is invalid, expired, or already used.' };
    }
    this.activeSessions.delete(session.claims.sid);
    await this.db().query(
      `update public.pay_gateway_portal_sessions
       set revoked_at = now(), revoke_reason = 'mfa_step_up'
       where session_id = $1 and revoked_at is null`,
      [session.claims.sid],
    );
    const nextSession = await this.issueSession(account, true, req);
    await this.writeAuditEvent(undefined, {
      action: 'portal.auth.mfa_step_up_completed',
      target: account.email,
      metadata: { actorEmail: account.email, actorRole: account.role, replacedSessionId: session.claims.sid },
    });
    return { ok: true as const, data: { ...nextSession, user: publicAccount(account) } };
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
    const username = normalizeUsername(input.username) || this.generatedUsernameFromEmail(input.email);
    if (!isValidUsername(username)) {
      return {
        ok: false as const,
        status: 400,
        error: 'Username must be 3-32 characters and use letters, numbers, underscore, or hyphen.',
      };
    }
    const existingIdentity = await this.db().query(
      `select user_id, email, username
       from public.pay_gateway_portal_users
       where lower(email) = lower($1) or lower(username) = lower($2)
       limit 1`,
      [normalizeEmail(input.email), username],
    );
    if (existingIdentity.rows[0]) {
      return {
        ok: false as const,
        status: 409,
        error:
          normalizeEmail(existingIdentity.rows[0].email) === normalizeEmail(input.email)
            ? 'A portal account already exists for this email.'
            : 'That username is already taken.',
      };
    }
    const salt = crypto.randomBytes(16).toString('base64url');
    const iterations = 210000;
    const userId = `portal_user_${crypto.randomUUID()}`;
    const result = await this.db().query(
      `insert into public.pay_gateway_portal_users (
        user_id, username, email, name, role, permissions, live_access, service_codes,
        password_salt, password_hash, password_iterations, totp_secret, mfa_required, mfa_status, enabled
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,null,$12,'disabled',true)
      returning *`,
      [
        userId,
        username,
        normalizeEmail(input.email),
        String(input.name || input.email || '').trim(),
        role,
        uniqueStrings(input.permissions),
        Boolean(input.liveAccess),
        uniqueStrings(input.serviceCodes),
        salt,
        hashPassword(password, salt, iterations),
        iterations,
        Boolean(input.mfaRequired) || ROLE_ORDER[role] >= ROLE_ORDER.operator,
      ],
    );
    const account = this.accountFromRow(result.rows[0]);
    await this.writeAuditEvent(req, {
      action: 'portal.user.created',
      target: account.email,
      metadata: { role, username, liveAccess: Boolean(input.liveAccess), createdUserId: userId },
    });
    return {
      ok: true as const,
      data: {
        ...publicAccount(account),
        mfaEnrollmentRequired: account.mfaRequired,
      },
    };
  }

  async listTeamInvitations(req: express.Request) {
    const session = this.requirePermission(req, 'portal:manage_users', 'admin');
    if (!session.ok) return session;
    const result = await this.db().query(
      `select invitation_id, email, name, role, permissions, live_access, service_codes,
              invited_by, status, expires_at, accepted_at, revoked_at, delivery_status,
              created_at, updated_at
       from public.pay_gateway_portal_team_invitations
       order by created_at desc
       limit 200`,
    );
    return { ok: true as const, data: result.rows.map((row) => this.invitationFromRow(row)) };
  }

  async inviteTeamMember(req: express.Request, input: Record<string, unknown>) {
    const session = this.requirePermission(req, 'portal:manage_users', 'admin');
    if (!session.ok) return session;
    const sensitive = this.requireSensitiveWrite(req, 'portal.team.invite');
    if (!sensitive.ok) return sensitive;
    const email = normalizeEmail(input.email);
    const name = String(input.name || '').trim();
    const role = roleFrom(input.role);
    const serviceCodes = uniqueStrings(input.serviceCodes);
    const permissions = uniqueStrings(input.permissions);
    const liveAccess = Boolean(input.liveAccess);
    if (!isValidEmail(email)) return { ok: false as const, status: 400, error: 'Enter a valid staff email address.' };
    if (name.length < 2) return { ok: false as const, status: 400, error: 'Enter the staff member name.' };
    if (!serviceCodes.length && role === 'developer') {
      return { ok: false as const, status: 400, error: 'Developer staff must be linked to at least one integration code.' };
    }
    const existing = await this.db().query(
      'select user_id from public.pay_gateway_portal_users where lower(email) = lower($1) limit 1',
      [email],
    );
    if (existing.rows[0]) return { ok: false as const, status: 409, error: 'A portal account already exists for this email.' };

    const token = `orbi_invite_${crypto.randomBytes(32).toString('base64url')}`;
    const invitationId = `portal_invite_${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    const inviteUrl = String(input.inviteUrl || '').includes('{token}')
      ? String(input.inviteUrl).replace('{token}', encodeURIComponent(token))
      : String(input.inviteUrl || '');
    const eventId = `portal_team_invite_${crypto.randomUUID()}`;
    const delivery = await orbiTalkClient.sendIntent({
      eventId,
      correlationId: eventId,
      templateCode: 'developer.direct.email',
      recipientIdentityRef: email,
      channel: 'email',
      language: 'en',
      environment: String(req.headers['x-orbi-environment'] || '').toLowerCase().includes('production') ? 'live' : 'sandbox',
      safeMetadata: {
        emailSubject: 'You have been invited to ORBI Pay Developer Portal',
        emailBody: `You have been invited to join ${serviceCodes.join(', ') || 'an ORBI Pay integration'}. Open this secure link to create your own staff account: ${inviteUrl}. This invitation expires soon. If you did not expect this invitation, ignore this message.`,
        inviteUrl,
        serviceCodes: serviceCodes.join(', '),
        role,
      },
    });
    const result = await this.db().query(
      `insert into public.pay_gateway_portal_team_invitations (
        invitation_id, email, name, role, permissions, live_access, service_codes,
        invited_by, token_hash, status, expires_at, delivery_status
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11)
      returning invitation_id, email, name, role, permissions, live_access, service_codes,
                invited_by, status, expires_at, accepted_at, revoked_at, delivery_status,
                created_at, updated_at`,
      [
        invitationId,
        email,
        name,
        role,
        permissions,
        liveAccess,
        serviceCodes,
        session.claims.email,
        hashInviteToken(token),
        expiresAt,
        delivery.status,
      ],
    );
    await this.writeAuditEvent(req, {
      action: 'portal.team.invited',
      target: email,
      metadata: { role, serviceCodes, liveAccess, invitationId, deliveryStatus: delivery.status },
    });
    return {
      ok: true as const,
      data: {
        invitation: this.invitationFromRow(result.rows[0]),
        inviteToken: token,
        inviteUrl,
        deliveryStatus: delivery.status,
      },
    };
  }

  async revokeTeamInvitation(req: express.Request, invitationId: string, input: Record<string, unknown>) {
    const session = this.requirePermission(req, 'portal:manage_users', 'admin');
    if (!session.ok) return session;
    const sensitive = this.requireSensitiveWrite(req, 'portal.team.invite_revoke');
    if (!sensitive.ok) return sensitive;
    const reason = String(input.reason || '').trim();
    if (reason.length < 10) return { ok: false as const, status: 400, error: 'Add a clear revocation reason.' };
    const result = await this.db().query(
      `update public.pay_gateway_portal_team_invitations
       set status = 'revoked', revoked_at = now(), updated_at = now()
       where invitation_id = $1 and status = 'pending'
       returning invitation_id, email, name, role, permissions, live_access, service_codes,
                 invited_by, status, expires_at, accepted_at, revoked_at, delivery_status,
                 created_at, updated_at`,
      [invitationId],
    );
    if (!result.rows[0]) return { ok: false as const, status: 404, error: 'Pending invitation not found.' };
    await this.writeAuditEvent(req, {
      action: 'portal.team.invitation_revoked',
      target: result.rows[0].email,
      metadata: { invitationId, reason },
    });
    return { ok: true as const, data: this.invitationFromRow(result.rows[0]) };
  }

  async acceptTeamInvitation(req: express.Request, input: Record<string, unknown>) {
    const token = String(input.token || '').trim();
    const password = String(input.password || '').trim();
    const username = normalizeUsername(input.username);
    if (!token.startsWith('orbi_invite_')) return { ok: false as const, status: 400, error: 'Invitation link is invalid.' };
    if (!isValidUsername(username)) {
      return { ok: false as const, status: 400, error: 'Choose a username with 3-32 characters using letters, numbers, underscore, or hyphen.' };
    }
    if (password.length < 12) return { ok: false as const, status: 400, error: 'Password must contain at least 12 characters.' };
    const invitationResult = await this.db().query(
      `select *
       from public.pay_gateway_portal_team_invitations
       where token_hash = $1 and status = 'pending'
       limit 1`,
      [hashInviteToken(token)],
    );
    const invitation = invitationResult.rows[0];
    if (!invitation) return { ok: false as const, status: 400, error: 'Invitation link is invalid or already used.' };
    if (new Date(invitation.expires_at).getTime() <= Date.now()) {
      await this.db().query(
        `update public.pay_gateway_portal_team_invitations set status = 'expired', updated_at = now() where invitation_id = $1`,
        [invitation.invitation_id],
      );
      return { ok: false as const, status: 410, error: 'Invitation has expired. Ask your admin to send a new invite.' };
    }
    const existing = await this.db().query(
      `select user_id, email, username
       from public.pay_gateway_portal_users
       where lower(email) = lower($1) or lower(username) = lower($2)
       limit 1`,
      [invitation.email, username],
    );
    if (existing.rows[0]) {
      return {
        ok: false as const,
        status: 409,
        error:
          normalizeEmail(existing.rows[0].email) === normalizeEmail(invitation.email)
            ? 'A portal account already exists for this email.'
            : 'That username is already taken.',
      };
    }
    const salt = crypto.randomBytes(16).toString('base64url');
    const iterations = 210000;
    const userId = `portal_user_${crypto.randomUUID()}`;
    const accountResult = await this.withClient(async (client) => {
      await client.query('begin');
      try {
        const created = await client.query(
          `insert into public.pay_gateway_portal_users (
            user_id, username, email, name, role, permissions, live_access, service_codes,
            password_salt, password_hash, password_iterations, totp_secret, mfa_required, mfa_status, enabled,
            email_verified_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,null,$12,'disabled',true,now())
          returning *`,
          [
            userId,
            username,
            normalizeEmail(invitation.email),
            String(invitation.name || invitation.email),
            roleFrom(invitation.role),
            invitation.permissions || [],
            Boolean(invitation.live_access),
            invitation.service_codes || [],
            salt,
            hashPassword(password, salt, iterations),
            iterations,
            portalMfaRequiredFor({ role: roleFrom(invitation.role), mfaRequired: true }),
          ],
        );
        await client.query(
          `update public.pay_gateway_portal_team_invitations
           set status = 'accepted', accepted_at = now(), updated_at = now()
           where invitation_id = $1`,
          [invitation.invitation_id],
        );
        await client.query('commit');
        return created;
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    });
    const account = this.accountFromRow(accountResult.rows[0]);
    await this.writeAuditEvent(req, {
      action: 'portal.team.invitation_accepted',
      target: account.email,
      metadata: { invitationId: invitation.invitation_id, role: account.role, serviceCodes: account.serviceCodes },
    });
    return {
      ok: true as const,
      data: {
        user: publicAccount(account),
        mfaEnrollmentRequired: account.mfaRequired,
        nextStep: account.mfaRequired ? 'Set up authenticator before using protected actions.' : 'Sign in with your new staff account.',
      },
    };
  }

  async signupDeveloper(req: express.Request, input: Record<string, unknown>) {
    const email = normalizeEmail(input.email);
    const username = normalizeUsername(input.username);
    const name = String(input.name || '').trim();
    const password = String(input.password || '').trim();
    const companyName = String(input.companyName || '').trim();
    const countryCode = String(input.countryCode || '').trim().toUpperCase();
    const useCase = String(input.useCase || '').trim();

    if (!isValidEmail(email)) return { ok: false as const, status: 400, error: 'Enter a valid business email address.' };
    if (!isValidUsername(username)) {
      return {
        ok: false as const,
        status: 400,
        error: 'Choose a username with 3-32 characters using letters, numbers, underscore, or hyphen.',
      };
    }
    if (name.length < 2) return { ok: false as const, status: 400, error: 'Enter your full name.' };
    if (password.length < 12) return { ok: false as const, status: 400, error: 'Password must contain at least 12 characters.' };
    if (companyName.length < 2) return { ok: false as const, status: 400, error: 'Enter your business or project name.' };
    if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
      return { ok: false as const, status: 400, error: 'Country code must use two letters, for example TZ.' };
    }
    if (useCase.length < 12) return { ok: false as const, status: 400, error: 'Tell us briefly what you want to build with ORBI.' };
    if (input.termsAccepted !== true) return { ok: false as const, status: 400, error: 'Accept the developer terms to continue.' };

    const existing = await this.db().query(
      `select user_id, email, username
       from public.pay_gateway_portal_users
       where lower(email) = lower($1) or lower(username) = lower($2)
       limit 1`,
      [email, username],
    );
    if (existing.rows[0]) {
      return {
        ok: false as const,
        status: 409,
        error:
          normalizeEmail(existing.rows[0].email) === email
            ? 'A developer account already exists for this email.'
            : 'That username is already taken.',
      };
    }

    const salt = crypto.randomBytes(16).toString('base64url');
    const iterations = 210000;
    const userId = `portal_user_${crypto.randomUUID()}`;
    const result = await this.db().query(
      `insert into public.pay_gateway_portal_users (
        user_id, username, email, name, role, permissions, live_access, service_codes,
        password_salt, password_hash, password_iterations, totp_secret, mfa_required, enabled,
        email_verified_at
      ) values ($1,$2,$3,$4,'developer',$5,false,'{}',$6,$7,$8,null,false,true,null)
      returning *`,
      [
        userId,
        username,
        email,
        name,
        ROLE_PERMISSIONS.developer,
        salt,
        hashPassword(password, salt, iterations),
        iterations,
      ],
    );
    const account = this.accountFromRow(result.rows[0]);
    const delivery = await this.issueEmailVerification(account, req, false);
    await this.writeAuditEvent(req, {
      action: 'portal.developer.signup',
      target: account.email,
      metadata: {
        companyName,
        username,
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
        verificationRequired: true,
        verificationDelivery: delivery.status,
        nextStep: delivery.status === 'queued' || delivery.status === 'sent'
          ? 'Enter the verification code sent to your email.'
          : 'Your account was created, but the verification email could not be sent. Use Resend code to try again.',
      },
    };
  }

  async verifyDeveloperEmail(req: express.Request, input: Record<string, unknown>) {
    const email = normalizeEmail(input.email);
    const code = String(input.code || '').replace(/\D/g, '');
    if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
      return { ok: false as const, status: 400, error: 'Enter the email and 6-digit verification code.' };
    }
    const account = await this.findAccount(email);
    if (!account) return { ok: false as const, status: 400, error: 'The verification code is invalid or expired.' };
    if (account.emailVerifiedAt) {
      return { ok: true as const, data: { email, verified: true, alreadyVerified: true } };
    }
    const codeHash = this.emailVerificationHash(account.userId!, code);
    const result = await this.db().query(
      `update public.pay_gateway_portal_email_verifications
       set consumed_at = now(), attempts = attempts + 1
       where verification_id = (
         select verification_id
         from public.pay_gateway_portal_email_verifications
         where user_id = $1 and consumed_at is null and expires_at > now()
         order by created_at desc
         limit 1
       )
       and code_hash = $2 and attempts < 5
       returning verification_id`,
      [account.userId, codeHash],
    );
    if (!result.rows[0]) {
      await this.db().query(
        `update public.pay_gateway_portal_email_verifications
         set attempts = attempts + 1
         where verification_id = (
           select verification_id
           from public.pay_gateway_portal_email_verifications
           where user_id = $1 and consumed_at is null and expires_at > now()
           order by created_at desc limit 1
         )`,
        [account.userId],
      );
      await this.writeAuditEvent(req, {
        action: 'portal.developer.email_verification_failed',
        target: email,
        metadata: { reason: 'invalid_expired_or_attempt_limit' },
      });
      return { ok: false as const, status: 400, error: 'The verification code is invalid or expired.' };
    }
    await this.db().query(
      'update public.pay_gateway_portal_users set email_verified_at = now(), updated_at = now() where user_id = $1',
      [account.userId],
    );
    await this.writeAuditEvent(req, {
      action: 'portal.developer.email_verified',
      target: email,
      metadata: { userId: account.userId },
    });
    return { ok: true as const, data: { email, verified: true } };
  }

  async resendDeveloperEmailVerification(req: express.Request, input: Record<string, unknown>) {
    const email = normalizeEmail(input.email);
    if (!isValidEmail(email)) return { ok: false as const, status: 400, error: 'Enter a valid email address.' };
    const account = await this.findAccount(email);
    // Keep the response neutral so this endpoint cannot enumerate accounts.
    if (!account || account.emailVerifiedAt) {
      return { ok: true as const, data: { accepted: true, nextStep: 'If verification is required, a new code will be sent.' } };
    }
    const delivery = await this.issueEmailVerification(account, req, true);
    if (delivery.status === 'rate_limited') {
      return {
        ok: true as const,
        data: { accepted: true, nextStep: 'If verification is required, a new code will be sent.' },
      };
    }
    return {
      ok: true as const,
      data: {
        accepted: true,
        delivery: delivery.status,
        nextStep: 'If verification is required, a new code will be sent.',
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

  async resetUserMfa(req: express.Request, userId: string, input: Record<string, unknown>) {
    const session = this.requirePermission(req, 'portal:manage_users', 'admin');
    if (!session.ok) return session;
    const sensitive = this.requireSensitiveWrite(req, 'portal.user.mfa_reset');
    if (!sensitive.ok) return sensitive;
    const current = await this.db().query(
      'select * from public.pay_gateway_portal_users where user_id = $1 limit 1',
      [userId],
    );
    if (!current.rows[0]) return { ok: false as const, status: 404, error: 'Portal user not found.' };
    const target = this.accountFromRow(current.rows[0]);
    if (normalizeEmail(target.email) === normalizeEmail(session.claims.email)) {
      return { ok: false as const, status: 409, error: 'Administrators cannot reset their own MFA factor.' };
    }
    const reason = String(input.reason || '').trim();
    await this.withClient(async (client) => {
      await client.query('begin');
      try {
        await client.query(
          `update public.pay_gateway_portal_users
           set totp_secret = null, totp_secret_encrypted = null, mfa_status = 'disabled',
               last_totp_counter = null, mfa_failed_attempts = 0, mfa_locked_until = null,
               mfa_required = true, updated_at = now()
           where user_id = $1`,
          [userId],
        );
        await client.query('delete from public.pay_gateway_portal_recovery_codes where user_id = $1', [userId]);
        const sessions = await client.query(
          `update public.pay_gateway_portal_sessions
           set revoked_at = now(), revoke_reason = 'admin_mfa_reset'
           where user_id = $1 and revoked_at is null
           returning session_id`,
          [userId],
        );
        for (const row of sessions.rows) this.activeSessions.delete(String(row.session_id));
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    });
    await this.writeAuditEvent(req, {
      action: 'portal.user.mfa_reset',
      target: target.email,
      metadata: { targetUserId: userId, reason },
    });
    return {
      ok: true as const,
      data: { userId, email: target.email, mfaStatus: 'disabled', sessionsRevoked: true },
    };
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
      username: claims.username,
      name: claims.name,
      role: claims.role,
      liveAccess: Boolean(claims.liveAccess),
      serviceCodes: Array.isArray(claims.serviceCodes) ? claims.serviceCodes : [],
      permissions: Array.isArray(claims.permissions) ? claims.permissions : [],
      mfaRequired: Boolean(claims.mfaRequired),
      mfaVerified: Boolean(claims.mfaVerified),
      mfaStatus: claims.mfaStatus || 'disabled',
    };
  }

  private signSession(account: PortalAccount, mfaVerified: boolean, sessionId: string) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64UrlJson({ alg: 'HS256', typ: 'ORBI_PORTAL_SESSION' });
    const payload = base64UrlJson({
      sid: sessionId,
      sub: account.email,
      username: account.username,
      name: account.name || account.email,
      email: account.email,
      role: account.role || 'developer',
      liveAccess: Boolean(account.liveAccess),
      serviceCodes: Array.isArray(account.serviceCodes) ? account.serviceCodes : [],
      permissions: permissionsForAccount(account),
      mfaVerified,
      mfaRequired: portalMfaRequiredFor(account),
      mfaStatus: account.mfaStatus || 'disabled',
      mfaAt: mfaVerified ? now : undefined,
      iat: now,
      exp: now + config.portal.sessionTtlSeconds,
    });
    const unsigned = `${header}.${payload}`;
    return `${unsigned}.${this.hmac(unsigned)}`;
  }

  private async issueSession(account: PortalAccount, mfaVerified: boolean, req?: express.Request) {
    const sessionId = `portal_session_${crypto.randomUUID()}`;
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = new Date((now + config.portal.sessionTtlSeconds) * 1000);
    const token = this.signSession(account, mfaVerified, sessionId);
    await this.db().query(
      `insert into public.pay_gateway_portal_sessions (
        session_id, user_id, token_hash, mfa_verified_at, ip_hash, user_agent_hash, expires_at
      ) values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        sessionId,
        account.userId,
        crypto.createHash('sha256').update(token).digest('hex'),
        mfaVerified ? new Date(now * 1000) : null,
        req ? hashOptional(req.headers['x-forwarded-for'] || req.socket?.remoteAddress) || null : null,
        req ? hashOptional(req.headers['user-agent']) || null : null,
        expiresAt,
      ],
    );
    this.activeSessions.add(sessionId);
    return { token, expiresAt: expiresAt.toISOString() };
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

  private async verifyTotp(account: PortalAccount, code: unknown) {
    const match = this.matchTotp(account, code, true);
    if (!match) return false;
    await this.db().query(
      'update public.pay_gateway_portal_users set last_totp_counter = $2, updated_at = now() where user_id = $1',
      [account.userId, match.counter],
    );
    return true;
  }

  private recoveryCodeHash(userId: string, code: unknown) {
    return crypto
      .createHmac('sha256', config.portal.authSecret)
      .update(`${userId}:${normalizeRecoveryCode(code)}`)
      .digest('hex');
  }

  private async replaceRecoveryCodes(userId: string) {
    const codes = Array.from({ length: 10 }, () => newRecoveryCode());
    await this.withClient(async (client) => {
      await client.query('begin');
      try {
        await client.query('delete from public.pay_gateway_portal_recovery_codes where user_id = $1', [userId]);
        for (const code of codes) {
          await client.query(
            `insert into public.pay_gateway_portal_recovery_codes (code_id, user_id, code_hash)
             values ($1,$2,$3)`,
            [`portal_recovery_${crypto.randomUUID()}`, userId, this.recoveryCodeHash(userId, code)],
          );
        }
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    });
    return codes;
  }

  private async consumeRecoveryCode(account: PortalAccount, code: unknown) {
    const clean = normalizeRecoveryCode(code);
    if (!/^ORBI[A-F0-9]{16}$/.test(clean) || !account.userId) return false;
    const result = await this.db().query(
      `update public.pay_gateway_portal_recovery_codes
       set used_at = now()
       where user_id = $1 and code_hash = $2 and used_at is null
       returning code_id`,
      [account.userId, this.recoveryCodeHash(account.userId, clean)],
    );
    return Boolean(result.rows[0]);
  }

  private async recoveryCodeCount(userId: string) {
    const result = await this.db().query(
      `select count(*)::integer as count
       from public.pay_gateway_portal_recovery_codes
       where user_id = $1 and used_at is null`,
      [userId],
    );
    return Number(result.rows[0]?.count || 0);
  }

  private async recordMfaFailure(account: PortalAccount) {
    const maxAttempts = Math.max(3, config.portal.mfaMaxFailedAttempts);
    const lockoutSeconds = Math.max(60, config.portal.mfaLockoutSeconds);
    const result = await this.db().query(
      `update public.pay_gateway_portal_users
       set mfa_failed_attempts = mfa_failed_attempts + 1,
           mfa_locked_until = case
             when mfa_failed_attempts + 1 >= $2 then now() + ($3 * interval '1 second')
             else mfa_locked_until
           end,
           updated_at = now()
       where user_id = $1
       returning mfa_failed_attempts, mfa_locked_until`,
      [account.userId, maxAttempts, lockoutSeconds],
    );
    return {
      failedAttempts: Number(result.rows[0]?.mfa_failed_attempts || 0),
      lockedUntil: iso(result.rows[0]?.mfa_locked_until),
    };
  }

  private async clearMfaFailures(account: PortalAccount) {
    await this.db().query(
      `update public.pay_gateway_portal_users
       set mfa_failed_attempts = 0, mfa_locked_until = null, updated_at = now()
       where user_id = $1`,
      [account.userId],
    );
  }

  private matchTotp(account: PortalAccount, code: unknown, rejectReplay: boolean) {
    const secret = this.totpSecretFor(account);
    if (!secret) return false;
    const clean = String(code || '').trim();
    if (!/^\d{6}$/.test(clean)) return false;
    const current = currentTotpCounter();
    for (const offset of [-1, 0, 1]) {
      const counter = current + offset;
      if (totpAtCounter(secret, counter) !== clean) continue;
      if (rejectReplay && account.lastTotpCounter !== undefined && counter <= account.lastTotpCounter) return false;
      return { counter };
    }
    return false;
  }

  private totpSecretFor(account: PortalAccount) {
    if (account.totpSecretEncrypted) return decryptSecret(account.totpSecretEncrypted);
    return account.totpSecret;
  }

  private totpSetupUri(account: PortalAccount) {
    const secret = this.totpSecretFor(account);
    if (!secret) return undefined;
    const issuer = encodeURIComponent(config.portal.totpIssuer);
    const label = encodeURIComponent(`${config.portal.totpIssuer}:${account.email}`);
    return `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
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
        user_id, username, email, name, role, permissions, live_access, service_codes,
        password_salt, password_hash, password_iterations, totp_secret, mfa_required, enabled
      ) values ($1,$2,$3,$4,$5,$6,true,'{}',$7,$8,$9,$10,$11,true)
      on conflict (email) do nothing`,
      [
        `portal_user_${crypto.createHash('sha256').update(admin.email).digest('hex').slice(0, 24)}`,
        this.generatedUsernameFromEmail(admin.email),
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

  private async migrateLegacyTotpSecrets() {
    const result = await this.db().query(
      `select user_id, totp_secret
       from public.pay_gateway_portal_users
       where totp_secret is not null and trim(totp_secret) <> ''`,
    );
    for (const row of result.rows) {
      const encrypted = encryptSecret(String(row.totp_secret).trim());
      await this.db().query(
        `update public.pay_gateway_portal_users
         set totp_secret_encrypted = $2, totp_secret = null, mfa_status = 'active', updated_at = now()
         where user_id = $1`,
        [row.user_id, encrypted],
      );
    }
  }

  private async loadActiveSessions() {
    const result = await this.db().query(
      `select session_id
       from public.pay_gateway_portal_sessions
       where revoked_at is null and expires_at > now()`,
    );
    this.activeSessions = new Set(result.rows.map((row) => String(row.session_id)));
    await this.db().query(
      `delete from public.pay_gateway_portal_sessions
       where expires_at < now() - interval '30 days'`,
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

  private emailVerificationHash(userId: string, code: string) {
    return crypto
      .createHmac('sha256', config.portal.authSecret)
      .update(`portal-email-verification:${userId}:${code}`)
      .digest('hex');
  }

  private async issueEmailVerification(account: PortalAccount, req: express.Request, enforceCooldown: boolean) {
    const cooldown = Math.max(30, config.portal.emailVerificationResendSeconds);
    if (enforceCooldown) {
      const recent = await this.db().query(
        `select verification_id
         from public.pay_gateway_portal_email_verifications
         where user_id = $1 and created_at > now() - ($2 * interval '1 second')
         limit 1`,
        [account.userId, cooldown],
      );
      if (recent.rows[0]) return { status: 'rate_limited' as const };
    }
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const ttlSeconds = Math.max(300, config.portal.emailVerificationTtlSeconds);
    await this.withClient(async (client) => {
      await client.query('begin');
      try {
        await client.query(
          `update public.pay_gateway_portal_email_verifications
           set consumed_at = now()
           where user_id = $1 and consumed_at is null`,
          [account.userId],
        );
        await client.query(
          `insert into public.pay_gateway_portal_email_verifications (
             verification_id, user_id, code_hash, expires_at
           ) values ($1,$2,$3,now() + ($4 * interval '1 second'))`,
          [
            `portal_email_verification_${crypto.randomUUID()}`,
            account.userId,
            this.emailVerificationHash(account.userId!, code),
            ttlSeconds,
          ],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    });
    const eventId = `portal_email_${crypto.randomUUID()}`;
    const delivery = await orbiTalkClient.sendIntent({
      eventId,
      correlationId: eventId,
      templateCode: 'developer.direct.email',
      recipientIdentityRef: account.email,
      language: 'en',
      channel: 'email',
      environment: String(config.providerMode).toLowerCase() === 'live' ? 'live' : 'sandbox',
      safeMetadata: {
        emailSubject: 'Verify your ORBI developer account',
        emailBody: `Your ORBI developer verification code is ${code}. It expires in ${Math.ceil(ttlSeconds / 60)} minutes. If you did not create this account, you can ignore this message.`,
        verificationCode: code,
        expiresMinutes: Math.ceil(ttlSeconds / 60),
        developerName: account.name,
      },
    });
    await this.writeAuditEvent(req, {
      action: 'portal.developer.email_verification_dispatched',
      target: account.email,
      metadata: {
        deliveryStatus: delivery.status,
        providerMessageId: delivery.providerMessageId,
      },
    });
    return { status: delivery.status };
  }

  private async sendPortalSecurityEmail(account: PortalAccount, eventType: string, metadata: Record<string, unknown>, req?: express.Request) {
    const environment = String(req?.headers?.['x-orbi-environment'] || '').toLowerCase().includes('production')
      ? 'live'
      : String(config.providerMode).toLowerCase() === 'live'
        ? 'live'
        : 'sandbox';
    const eventId = `portal_security_${crypto.randomUUID()}`;
    const lockedUntil = metadata.lockedUntil ? ` Lockout ends at ${String(metadata.lockedUntil)}.` : '';
    const reason = metadata.reason ? ` Detail: ${String(metadata.reason)}` : '';
    await orbiTalkClient.sendIntent({
      eventId,
      correlationId: eventId,
      templateCode: 'developer.direct.email',
      recipientIdentityRef: account.email,
      language: 'en',
      channel: 'email',
      environment,
      safeMetadata: {
        emailSubject: 'ORBI portal security alert',
        emailBody: `ORBI detected a security lockout on your Developer Portal account.${reason}${lockedUntil} If this was not you, contact ORBI support immediately.`,
        eventType,
        accountEmail: account.email,
        ...metadata,
      },
    });
  }

  private accountFromRow(row: any): PortalAccount {
    return {
      userId: row.user_id,
      username: row.username,
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
      totpSecretEncrypted: row.totp_secret_encrypted || undefined,
      mfaStatus: row.mfa_status || (row.totp_secret || row.totp_secret_encrypted ? 'active' : 'disabled'),
      lastTotpCounter: row.last_totp_counter === null || row.last_totp_counter === undefined
        ? undefined
        : Number(row.last_totp_counter),
      mfaFailedAttempts: Number(row.mfa_failed_attempts || 0),
      mfaLockedUntil: iso(row.mfa_locked_until),
      emailVerifiedAt: iso(row.email_verified_at),
      mfaRequired: Boolean(row.mfa_required),
      enabled: Boolean(row.enabled),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  private invitationFromRow(row: any): PortalTeamInvitation {
    return {
      invitationId: row.invitation_id,
      email: row.email,
      name: row.name || undefined,
      role: roleFrom(row.role),
      permissions: row.permissions || [],
      liveAccess: Boolean(row.live_access),
      serviceCodes: row.service_codes || [],
      invitedBy: row.invited_by,
      status: row.status || 'pending',
      expiresAt: iso(row.expires_at) || new Date().toISOString(),
      acceptedAt: iso(row.accepted_at),
      revokedAt: iso(row.revoked_at),
      deliveryStatus: row.delivery_status || undefined,
      createdAt: iso(row.created_at) || new Date().toISOString(),
      updatedAt: iso(row.updated_at) || new Date().toISOString(),
    };
  }

  private async ensureSchema() {
    await this.withClient(async (client) => {
      await client.query(`
        create table if not exists public.pay_gateway_portal_users (
          user_id text primary key,
          username text,
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
          totp_secret_encrypted jsonb,
          mfa_required boolean not null default false,
          mfa_status text not null default 'disabled' check (mfa_status in ('disabled','pending','active')),
          last_totp_counter bigint,
          mfa_failed_attempts integer not null default 0,
          mfa_locked_until timestamptz,
          email_verified_at timestamptz default now(),
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
        create table if not exists public.pay_gateway_portal_sessions (
          session_id text primary key,
          user_id text not null references public.pay_gateway_portal_users(user_id) on delete cascade,
          token_hash text not null,
          mfa_verified_at timestamptz,
          ip_hash text,
          user_agent_hash text,
          expires_at timestamptz not null,
          revoked_at timestamptz,
          revoke_reason text,
          created_at timestamptz not null default now()
        );
        create table if not exists public.pay_gateway_portal_recovery_codes (
          code_id text primary key,
          user_id text not null references public.pay_gateway_portal_users(user_id) on delete cascade,
          code_hash text not null,
          used_at timestamptz,
          created_at timestamptz not null default now(),
          unique (user_id, code_hash)
        );
        create table if not exists public.pay_gateway_portal_email_verifications (
          verification_id text primary key,
          user_id text not null references public.pay_gateway_portal_users(user_id) on delete cascade,
          code_hash text not null,
          attempts integer not null default 0,
          expires_at timestamptz not null,
          consumed_at timestamptz,
          created_at timestamptz not null default now()
        );
        create table if not exists public.pay_gateway_portal_team_invitations (
          invitation_id text primary key,
          email text not null,
          name text,
          role text not null check (role in ('developer','operator','admin')),
          permissions text[] not null default '{}',
          live_access boolean not null default false,
          service_codes text[] not null default '{}',
          invited_by text not null,
          token_hash text not null unique,
          status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
          expires_at timestamptz not null,
          accepted_at timestamptz,
          revoked_at timestamptz,
          delivery_status text,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );
        create index if not exists pay_gateway_portal_email_verification_active_idx
          on public.pay_gateway_portal_email_verifications (user_id, created_at desc)
          where consumed_at is null;
        create index if not exists pay_gateway_portal_recovery_codes_unused_idx
          on public.pay_gateway_portal_recovery_codes (user_id)
          where used_at is null;
        create index if not exists pay_gateway_portal_sessions_active_idx
          on public.pay_gateway_portal_sessions (user_id, expires_at desc)
          where revoked_at is null;
        create index if not exists pay_gateway_portal_audit_created_idx
          on public.pay_gateway_portal_audit_events (created_at desc);
        create index if not exists pay_gateway_portal_team_invites_email_idx
          on public.pay_gateway_portal_team_invitations (lower(email), created_at desc);
        create index if not exists pay_gateway_portal_team_invites_status_idx
          on public.pay_gateway_portal_team_invitations (status, created_at desc);
      `);
      await client.query(`
        alter table public.pay_gateway_portal_users
          add column if not exists username text;
        alter table public.pay_gateway_portal_users
          add column if not exists totp_secret_encrypted jsonb,
          add column if not exists mfa_status text not null default 'disabled',
          add column if not exists last_totp_counter bigint,
          add column if not exists mfa_failed_attempts integer not null default 0,
          add column if not exists mfa_locked_until timestamptz,
          add column if not exists email_verified_at timestamptz default now();
        update public.pay_gateway_portal_users
          set mfa_status = 'active'
          where totp_secret is not null and mfa_status = 'disabled';
        update public.pay_gateway_portal_users
          set username = lower(regexp_replace(split_part(email, '@', 1), '[^a-zA-Z0-9_-]+', '_', 'g')) || '_' || substr(md5(email), 1, 8)
          where username is null or trim(username) = '';
        alter table public.pay_gateway_portal_users
          alter column username set not null;
        create unique index if not exists pay_gateway_portal_users_username_unique_idx
          on public.pay_gateway_portal_users (lower(username));
      `);
    });
  }

  private generatedUsernameFromEmail(email: unknown) {
    const normalized = normalizeEmail(email);
    const local = normalized.split('@')[0] || 'user';
    const clean = local.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[_-]+/, '').slice(0, 18) || 'user';
    return `${clean}_${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 8)}`;
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
