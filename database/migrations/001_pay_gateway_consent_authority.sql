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
