-- ORBI PAY GATEWAY MASTER SCHEMA
-- Consolidated schema. Use this file as the single SQL source of truth.
-- Generated from retired database/migrations SQL files.


-- BEGIN CONSOLIDATED: 001_pay_gateway_consent_authority.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.pay_gateway_consent_receipts (
  consent_id text PRIMARY KEY,
  service_code text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'live')),
  subject_type text NOT NULL CHECK (subject_type IN ('user', 'business')),
  subject_id text NOT NULL,
  evidence_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_code, evidence_hash)
);

CREATE INDEX IF NOT EXISTS idx_pay_gateway_consent_subject
ON public.pay_gateway_consent_receipts
  (service_code, subject_id, environment, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_pay_gateway_consent_status
ON public.pay_gateway_consent_receipts (status, expires_at);

COMMENT ON TABLE public.pay_gateway_consent_receipts IS
  'Authoritative ORBI Open Banking consent receipts and revocation evidence.';
COMMENT ON COLUMN public.pay_gateway_consent_receipts.receipt IS
  'Validated versioned consent receipt. Indexed authority fields remain relational.';

COMMIT;
-- END CONSOLIDATED: 001_pay_gateway_consent_authority.sql

-- BEGIN CONSOLIDATED: 002_pay_gateway_oauth_authorization.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.pay_gateway_oauth_authorizations (
  request_id text PRIMARY KEY,
  upstream_state_hash text UNIQUE NOT NULL,
  service_code text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox','live')),
  redirect_uri text NOT NULL,
  requested_scopes text[] NOT NULL,
  client_state text NOT NULL,
  code_challenge text NOT NULL,
  nonce text NOT NULL,
  upstream_verifier jsonb NOT NULL,
  approval_token jsonb NOT NULL,
  approval_token_hash text NOT NULL,
  subject_id text,
  status text NOT NULL CHECK (status IN ('pending_identity','pending_consent','approved','denied')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pay_gateway_oauth_authorization_expiry
  ON public.pay_gateway_oauth_authorizations (expires_at, status);

CREATE TABLE IF NOT EXISTS public.pay_gateway_oauth_codes (
  code_hash text PRIMARY KEY,
  service_code text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox','live')),
  redirect_uri text NOT NULL,
  scopes text[] NOT NULL,
  subject_id text NOT NULL,
  consent_id text NOT NULL REFERENCES public.pay_gateway_consent_receipts(consent_id),
  code_challenge text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pay_gateway_oauth_code_expiry
  ON public.pay_gateway_oauth_codes (expires_at, consumed_at);

COMMIT;
-- END CONSOLIDATED: 002_pay_gateway_oauth_authorization.sql

-- BEGIN CONSOLIDATED: 003_pay_gateway_refresh_token_families.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.pay_gateway_refresh_token_families (
  family_id text PRIMARY KEY,
  service_code text NOT NULL,
  environment text NOT NULL CHECK(environment IN ('sandbox','live')),
  subject_id text NOT NULL,
  consent_id text NOT NULL REFERENCES public.pay_gateway_consent_receipts(consent_id),
  scopes text[] NOT NULL,
  identity_issuer text NOT NULL,
  access_token_claims jsonb NOT NULL DEFAULT '[]'::jsonb,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pay_gateway_refresh_family_consent
  ON public.pay_gateway_refresh_token_families(consent_id,revoked_at);

CREATE TABLE IF NOT EXISTS public.pay_gateway_refresh_tokens (
  token_hash text PRIMARY KEY,
  family_id text NOT NULL REFERENCES public.pay_gateway_refresh_token_families(family_id),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pay_gateway_refresh_token_family
  ON public.pay_gateway_refresh_tokens(family_id,created_at DESC);

COMMIT;
-- END CONSOLIDATED: 003_pay_gateway_refresh_token_families.sql

-- BEGIN CONSOLIDATED: 004_pay_gateway_oauth_par.sql
CREATE TABLE IF NOT EXISTS public.pay_gateway_oauth_pushed_authorization_requests (
  request_uri_hash text PRIMARY KEY,
  service_code text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox','live')),
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pay_gateway_oauth_par_expiry
  ON public.pay_gateway_oauth_pushed_authorization_requests (expires_at, consumed_at);

COMMENT ON TABLE public.pay_gateway_oauth_pushed_authorization_requests IS
  'Short-lived one-time OAuth PAR request_uri records. The browser carries only request_uri; sensitive authorization parameters remain server-side.';
-- END CONSOLIDATED: 004_pay_gateway_oauth_par.sql

-- BEGIN CONSOLIDATED: 005_pay_gateway_portal_runtime_schema.sql
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.pay_gateway_developer_services (
  service_code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  legal_name TEXT,
  business_type TEXT,
  country_code TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  environments TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  scopes_granted TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  scopes_pending TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  browser_origins TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  redirect_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  webhook_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  external_developer_id TEXT,
  owner_portal_user_id TEXT,
  owner_email TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pay_gateway_developer_services
  DROP CONSTRAINT IF EXISTS pay_gateway_developer_services_status_check;
ALTER TABLE public.pay_gateway_developer_services
  ADD CONSTRAINT pay_gateway_developer_services_status_check
  CHECK (status IN ('draft', 'active', 'suspended', 'revoked'));

ALTER TABLE public.pay_gateway_developer_services
  ADD COLUMN IF NOT EXISTS browser_origins TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS owner_portal_user_id TEXT,
  ADD COLUMN IF NOT EXISTS owner_email TEXT;

CREATE TABLE IF NOT EXISTS public.pay_gateway_developer_service_applications (
  application_id TEXT PRIMARY KEY,
  external_developer_id TEXT,
  legal_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  business_type TEXT NOT NULL,
  country_code TEXT NOT NULL,
  requested_environments TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  requested_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  browser_origins TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  redirect_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  webhook_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  use_cases TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  support_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review',
  service_code TEXT REFERENCES public.pay_gateway_developer_services(service_code) ON DELETE SET NULL,
  owner_portal_user_id TEXT,
  owner_email TEXT,
  decided_at TIMESTAMPTZ,
  decided_by TEXT,
  decision_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pay_gateway_developer_scope_requests (
  request_id TEXT PRIMARY KEY,
  service_code TEXT NOT NULL REFERENCES public.pay_gateway_developer_services(service_code) ON DELETE CASCADE,
  requested_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  reason TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'live')),
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected')),
  decided_at TIMESTAMPTZ,
  decided_by TEXT,
  decision_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pay_gateway_developer_api_keys (
  key_id TEXT PRIMARY KEY,
  service_code TEXT NOT NULL REFERENCES public.pay_gateway_developer_services(service_code) ON DELETE CASCADE,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'live')),
  fingerprint TEXT NOT NULL,
  encrypted_secret JSONB,
  status TEXT NOT NULL DEFAULT 'active',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  issued_by TEXT,
  revoked_by TEXT,
  rotation_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT pay_gateway_developer_api_keys_fingerprint_unique UNIQUE (fingerprint)
);

ALTER TABLE public.pay_gateway_developer_api_keys
  ADD COLUMN IF NOT EXISTS encrypted_secret JSONB,
  ADD COLUMN IF NOT EXISTS issued_by TEXT,
  ADD COLUMN IF NOT EXISTS revoked_by TEXT,
  ADD COLUMN IF NOT EXISTS rotation_reason TEXT;

ALTER TABLE public.pay_gateway_developer_api_keys
  DROP CONSTRAINT IF EXISTS pay_gateway_developer_api_keys_status_check;
ALTER TABLE public.pay_gateway_developer_api_keys
  ADD CONSTRAINT pay_gateway_developer_api_keys_status_check
  CHECK (status IN ('active', 'pending_cutover', 'revoked', 'expired'));

CREATE TABLE IF NOT EXISTS public.pay_gateway_developer_webhook_secrets (
  secret_id TEXT PRIMARY KEY,
  service_code TEXT NOT NULL REFERENCES public.pay_gateway_developer_services(service_code) ON DELETE CASCADE,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'live')),
  fingerprint TEXT NOT NULL,
  encrypted_secret JSONB,
  status TEXT NOT NULL DEFAULT 'active',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  issued_by TEXT,
  revoked_by TEXT,
  rotation_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT pay_gateway_developer_webhook_secrets_fingerprint_unique UNIQUE (fingerprint)
);

ALTER TABLE public.pay_gateway_developer_webhook_secrets
  ADD COLUMN IF NOT EXISTS encrypted_secret JSONB,
  ADD COLUMN IF NOT EXISTS issued_by TEXT,
  ADD COLUMN IF NOT EXISTS revoked_by TEXT,
  ADD COLUMN IF NOT EXISTS rotation_reason TEXT;

ALTER TABLE public.pay_gateway_developer_webhook_secrets
  DROP CONSTRAINT IF EXISTS pay_gateway_developer_webhook_secrets_status_check;
ALTER TABLE public.pay_gateway_developer_webhook_secrets
  ADD CONSTRAINT pay_gateway_developer_webhook_secrets_status_check
  CHECK (status IN ('active', 'pending_cutover', 'revoked', 'expired'));

CREATE TABLE IF NOT EXISTS public.pay_gateway_developer_secret_events (
  event_id TEXT PRIMARY KEY,
  service_code TEXT REFERENCES public.pay_gateway_developer_services(service_code) ON DELETE SET NULL,
  environment TEXT CHECK (environment IS NULL OR environment IN ('sandbox', 'live')),
  event_type TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  target_type TEXT,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pay_gateway_portal_users (
  user_id TEXT PRIMARY KEY,
  username TEXT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('developer', 'operator', 'admin')),
  permissions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  live_access BOOLEAN NOT NULL DEFAULT false,
  service_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 210000,
  totp_secret TEXT,
  totp_secret_encrypted JSONB,
  mfa_required BOOLEAN NOT NULL DEFAULT false,
  mfa_status TEXT NOT NULL DEFAULT 'disabled' CHECK (mfa_status IN ('disabled', 'pending', 'active')),
  last_totp_counter BIGINT,
  mfa_failed_attempts INTEGER NOT NULL DEFAULT 0,
  mfa_locked_until TIMESTAMPTZ,
  email_verified_at TIMESTAMPTZ DEFAULT now(),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pay_gateway_portal_users
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS totp_secret_encrypted JSONB,
  ADD COLUMN IF NOT EXISTS mfa_status TEXT NOT NULL DEFAULT 'disabled',
  ADD COLUMN IF NOT EXISTS last_totp_counter BIGINT,
  ADD COLUMN IF NOT EXISTS mfa_failed_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mfa_locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ DEFAULT now();

UPDATE public.pay_gateway_portal_users
SET username = lower(regexp_replace(split_part(email, '@', 1), '[^a-zA-Z0-9_-]+', '_', 'g')) || '_' || substr(md5(email), 1, 8)
WHERE username IS NULL OR trim(username) = '';

ALTER TABLE public.pay_gateway_portal_users
  ALTER COLUMN username SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.pay_gateway_portal_audit_events (
  event_id TEXT PRIMARY KEY,
  actor_email TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  target TEXT,
  environment TEXT,
  ip_hash TEXT,
  user_agent_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pay_gateway_portal_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.pay_gateway_portal_users(user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  mfa_verified_at TIMESTAMPTZ,
  ip_hash TEXT,
  user_agent_hash TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pay_gateway_portal_recovery_codes (
  code_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.pay_gateway_portal_users(user_id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)
);

CREATE TABLE IF NOT EXISTS public.pay_gateway_portal_email_verifications (
  verification_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.pay_gateway_portal_users(user_id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pay_gateway_portal_password_resets (
  reset_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.pay_gateway_portal_users(user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pay_gateway_portal_team_invitations (
  invitation_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL CHECK (role IN ('developer', 'operator', 'admin')),
  permissions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  live_access BOOLEAN NOT NULL DEFAULT false,
  service_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  invited_by TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  delivery_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pay_gateway_service_billing_plans (
  service_code TEXT PRIMARY KEY REFERENCES public.pay_gateway_developer_services(service_code) ON DELETE CASCADE,
  plan_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  daily_call_limit INTEGER NOT NULL,
  monthly_call_limit INTEGER NOT NULL,
  assigned_by TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
);

CREATE TABLE IF NOT EXISTS public.pay_gateway_usage_meter_events (
  request_id TEXT PRIMARY KEY,
  trace_id TEXT,
  correlation_id TEXT,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'live')),
  service_code TEXT,
  actor_ref TEXT,
  method TEXT NOT NULL,
  route TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  origin TEXT,
  user_agent_hash TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pay_gateway_service_access_token_revocations (
  jti TEXT PRIMARY KEY,
  service_code TEXT NOT NULL,
  key_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'live')),
  scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by TEXT,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS pay_gateway_developer_services_owner_idx
  ON public.pay_gateway_developer_services (owner_email, created_at DESC);
CREATE INDEX IF NOT EXISTS pay_gateway_developer_applications_status_idx
  ON public.pay_gateway_developer_service_applications (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS pay_gateway_developer_applications_owner_idx
  ON public.pay_gateway_developer_service_applications (owner_email, submitted_at DESC);
CREATE INDEX IF NOT EXISTS pay_gateway_developer_scope_requests_service_idx
  ON public.pay_gateway_developer_scope_requests (service_code, submitted_at DESC);
CREATE INDEX IF NOT EXISTS pay_gateway_developer_scope_requests_status_idx
  ON public.pay_gateway_developer_scope_requests (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS pay_gateway_developer_api_keys_lookup_idx
  ON public.pay_gateway_developer_api_keys (fingerprint, status, environment);
CREATE INDEX IF NOT EXISTS pay_gateway_developer_api_keys_service_idx
  ON public.pay_gateway_developer_api_keys (service_code, environment, status);
CREATE INDEX IF NOT EXISTS pay_gateway_developer_webhook_secrets_lookup_idx
  ON public.pay_gateway_developer_webhook_secrets (fingerprint, status, environment);
CREATE INDEX IF NOT EXISTS pay_gateway_developer_secret_events_service_idx
  ON public.pay_gateway_developer_secret_events (service_code, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS pay_gateway_portal_users_username_unique_idx
  ON public.pay_gateway_portal_users (lower(username));
CREATE INDEX IF NOT EXISTS pay_gateway_portal_email_verification_active_idx
  ON public.pay_gateway_portal_email_verifications (user_id, created_at DESC)
  WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS pay_gateway_portal_password_resets_active_idx
  ON public.pay_gateway_portal_password_resets (user_id, created_at DESC)
  WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS pay_gateway_portal_recovery_codes_unused_idx
  ON public.pay_gateway_portal_recovery_codes (user_id)
  WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS pay_gateway_portal_sessions_active_idx
  ON public.pay_gateway_portal_sessions (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS pay_gateway_portal_audit_created_idx
  ON public.pay_gateway_portal_audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS pay_gateway_portal_team_invites_email_idx
  ON public.pay_gateway_portal_team_invitations (lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS pay_gateway_portal_team_invites_status_idx
  ON public.pay_gateway_portal_team_invitations (status, created_at DESC);
CREATE INDEX IF NOT EXISTS pay_gateway_service_billing_plans_status_idx
  ON public.pay_gateway_service_billing_plans (status, plan_code);
CREATE INDEX IF NOT EXISTS idx_pay_gateway_operator_incidents_status
  ON public.pay_gateway_operator_incidents (status);
CREATE INDEX IF NOT EXISTS idx_pay_gateway_operator_incidents_severity
  ON public.pay_gateway_operator_incidents (severity);
CREATE INDEX IF NOT EXISTS idx_pay_gateway_operator_incidents_type
  ON public.pay_gateway_operator_incidents (incident_type);
CREATE INDEX IF NOT EXISTS pay_gateway_usage_meter_events_time_idx
  ON public.pay_gateway_usage_meter_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS pay_gateway_usage_meter_events_service_idx
  ON public.pay_gateway_usage_meter_events (service_code, occurred_at DESC);
CREATE INDEX IF NOT EXISTS pay_gateway_usage_meter_events_environment_idx
  ON public.pay_gateway_usage_meter_events (environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_pay_gateway_sat_revocations_active
  ON public.pay_gateway_service_access_token_revocations (expires_at);
CREATE INDEX IF NOT EXISTS idx_pay_gateway_sat_revocations_service
  ON public.pay_gateway_service_access_token_revocations (service_code, environment);

COMMENT ON TABLE public.pay_gateway_developer_services IS
  'Registered ORBI Pay developer integrations and approved service capabilities.';
COMMENT ON TABLE public.pay_gateway_portal_users IS
  'Developer Portal identities for developers, operators, and administrators.';
COMMENT ON TABLE public.pay_gateway_usage_meter_events IS
  'Request metering evidence used for limits, monitoring, and developer activity reports.';

COMMIT;
-- END CONSOLIDATED: 005_pay_gateway_portal_runtime_schema.sql
