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
