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
