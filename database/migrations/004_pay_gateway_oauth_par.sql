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
