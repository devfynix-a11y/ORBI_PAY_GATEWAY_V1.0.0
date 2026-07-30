# ORBI Pay Gateway Deployment Runbook

## Recommended Topology

Run ORBI Pay Gateway on a separate VM or container from ORBI Core.

```txt
pay.orbifinancial.com -> Nginx -> ORBI Pay Gateway :3100
sandbox-pay.orbifinancial.com -> Nginx -> ORBI Pay Gateway Sandbox :3101
api.orbifinancial.com     -> Nginx -> ORBI Core :3000
```

Core receives gateway callbacks through the secure Core external root and private internal route. The endpoint is externally reachable only as an authenticated service endpoint; it is not a public user API.

```txt
https://pay.orbifinancial.com
  -> ORBI Pay Gateway
  -> https://api.orbifinancial.com/api/internal/gateway/provider-events
  -> ORBI Core worker-auth middleware
```

Security layers:

- HTTPS on the external root.
- HMAC worker signature on every callback.
- timestamp freshness and nonce replay protection in Core.
- worker scope `gateway:events:write`.
- direct mTLS from Pay Gateway to Core for transport-level service identity.

HMAC remains mandatory even when mTLS is enabled. mTLS proves the calling service identity at the TLS layer; HMAC proves payload integrity, timestamp freshness, and replay safety at the application layer.

## Production Environment

```env
NODE_ENV=production
PAYMENT_GATEWAY_PORT=3100
PAYMENT_GATEWAY_PUBLIC_BASE_URL=https://pay.orbifinancial.com
PAYMENT_GATEWAY_PROVIDER_MODE=live
PAYMENT_GATEWAY_ALLOWED_BROWSER_ORIGINS=https://pay.orbifinancial.com,https://shop.orbifinancial.com,https://developers.orbifinancial.com
PAYMENT_GATEWAY_REQUIRE_SIGNED_INTERNAL_INGRESS=true
PAYMENT_GATEWAY_REQUEST_AUDIT_ENABLED=true
PAYMENT_GATEWAY_AUDIT_EVENT_SINK_URL=<optional-siem-http-json-endpoint>
# or PAYMENT_GATEWAY_AUDIT_EVENT_SINK_PATH=/app/audit/events.jsonl
PAYMENT_GATEWAY_OPERATOR_ALERT_SINK_URL=<optional-operator-alert-http-json-endpoint>
# or PAYMENT_GATEWAY_OPERATOR_ALERT_SINK_PATH=/app/alerts/reconciliation-alerts.jsonl
PAYMENT_GATEWAY_RECONCILIATION_EXPORT_PATH=<optional-mounted-report-directory>
PAYMENT_GATEWAY_RECONCILIATION_STUCK_INTENT_MINUTES=30
PAYMENT_GATEWAY_RECONCILIATION_WEBHOOK_PENDING_MINUTES=10
PAYMENT_GATEWAY_RECONCILIATION_SCHEDULE_ENABLED=true
PAYMENT_GATEWAY_RECONCILIATION_SCHEDULE_INTERVAL_MINUTES=1440
PAYMENT_GATEWAY_RECONCILIATION_SCHEDULE_WINDOW_HOURS=24
PAYMENT_GATEWAY_RECONCILIATION_SCHEDULE_RUN_ON_START=false

ORBI_CORE_INTERNAL_BASE_URL=http://core:3000
PAYMENT_GATEWAY_ALLOW_PRIVATE_HTTP_CORE=true
PAYMENT_GATEWAY_INTERNAL_CORE_TRANSPORT_MODE=private_http
ORBI_CORE_TRUSTED_GATEWAY_EVENT_PATH=/api/internal/gateway/provider-events
ORBI_CORE_CALLBACK_TIMEOUT_MS=7500

PAYMENT_GATEWAY_WORKER_ID=orbi-payment-gateway
PAYMENT_GATEWAY_WORKER_SCOPES=gateway:events:write
WORKER_SIGNING_SECRET=<same-secret-configured-in-core>
WORKER_KEY_ID=payment-gateway-v1

PAYMENT_GATEWAY_INTERNAL_MTLS_ENABLED=false
```

`private_http` is allowed only for Docker/private Core targets and only while
HMAC worker signatures remain configured. Public HTTP Core URLs are rejected.
Use the mTLS activation gate below for certificate-backed internal HTTPS.

## Sandbox Environment

Sandbox must run as a separate container or process. It must not reuse the live
database URL, worker signing secret, service API key, webhook secret, or public
base URL.

```env
NODE_ENV=production
PAYMENT_GATEWAY_PORT=3101
PAYMENT_GATEWAY_PUBLIC_BASE_URL=https://sandbox-pay.orbifinancial.com
PAYMENT_GATEWAY_PROVIDER_MODE=sandbox
PAYMENT_GATEWAY_ALLOWED_BROWSER_ORIGINS=https://sandbox-pay.orbifinancial.com,https://shop.orbifinancial.com,https://developers.orbifinancial.com
PAYMENT_GATEWAY_REQUIRE_SIGNED_INTERNAL_INGRESS=true
PAYMENT_GATEWAY_REQUEST_AUDIT_ENABLED=true
PAYMENT_GATEWAY_AUDIT_EVENT_SINK_URL=<optional-sandbox-siem-http-json-endpoint>
# or PAYMENT_GATEWAY_AUDIT_EVENT_SINK_PATH=/app/audit/sandbox-events.jsonl
PAYMENT_GATEWAY_OPERATOR_ALERT_SINK_URL=<optional-sandbox-operator-alert-http-json-endpoint>
# or PAYMENT_GATEWAY_OPERATOR_ALERT_SINK_PATH=/app/alerts/reconciliation-alerts.jsonl
PAYMENT_GATEWAY_RECONCILIATION_EXPORT_PATH=<optional-sandbox-mounted-report-directory>
PAYMENT_GATEWAY_RECONCILIATION_STUCK_INTENT_MINUTES=30
PAYMENT_GATEWAY_RECONCILIATION_WEBHOOK_PENDING_MINUTES=10
PAYMENT_GATEWAY_RECONCILIATION_SCHEDULE_ENABLED=true
PAYMENT_GATEWAY_RECONCILIATION_SCHEDULE_INTERVAL_MINUTES=1440
PAYMENT_GATEWAY_RECONCILIATION_SCHEDULE_WINDOW_HOURS=24
PAYMENT_GATEWAY_RECONCILIATION_SCHEDULE_RUN_ON_START=false

DATABASE_URL=<sandbox-pay-gateway-database-url>
ORBI_SECRET_ENCRYPTION_KEY=<sandbox-only-secret-encryption-key>

ORBI_CORE_INTERNAL_BASE_URL=<sandbox-core-internal-url>
PAYMENT_GATEWAY_ALLOW_PRIVATE_HTTP_CORE=true
PAYMENT_GATEWAY_INTERNAL_CORE_TRANSPORT_MODE=private_http

PAYMENT_GATEWAY_WORKER_ID=orbi-payment-gateway-sandbox
PAYMENT_GATEWAY_WORKER_SCOPES=gateway:events:write,gateway:service-payments:write,gateway:service-payments:result,gateway:identity:read,gateway:paysafe-balances:read,gateway:business-registration:write,gateway:payment-profiles:write,gateway:merchant-payments:read,gateway:merchant-settlements:read
WORKER_SIGNING_SECRET=<sandbox-worker-signing-secret>
WORKER_KEY_ID=payment-gateway-sandbox-v1

ORBI_SHOP_PAY_API_KEY=<sandbox-shop-service-key>
ORBI_SHOP_PAY_WEBHOOK_SECRET=<sandbox-shop-webhook-secret>
ORBI_SHOP_PAY_WEBHOOK_URL=https://shop.orbifinancial.com/api/orbi-pay/sandbox/webhooks
ORBI_SHOP_MERCHANT_ID=<sandbox-shop-merchant-id>
```

Cloudflare Tunnel routing should be split:

```txt
pay.orbifinancial.com -> http://pay-gateway:3100
sandbox-pay.orbifinancial.com -> http://pay-gateway-sandbox:3101
```

## Core Production Safety

Core should keep legacy provider execution disabled:

```env
ORBI_ENABLE_CORE_PROVIDER_GATEWAY_ROUTES=false
ORBI_ALLOW_STUB_PROVIDER_RECONCILIATION=false
ORBI_PAY_GATEWAY_BASE_URL=https://pay.orbifinancial.com

ORBI_TLS_ENABLED=true
ORBI_TLS_CERT_PATH=/opt/orbi/mtls/core-server.crt
ORBI_TLS_KEY_PATH=/opt/orbi/mtls/core-server.key
ORBI_TLS_CA_PATH=/opt/orbi/mtls/orbi-internal-ca.crt
ORBI_TLS_REJECT_UNAUTHORIZED=true
ORBI_INTERNAL_MTLS_MODE=required
ORBI_INTERNAL_MTLS_SOURCE=direct
ORBI_INTERNAL_MTLS_CA_PATH=/opt/orbi/mtls/orbi-internal-ca.crt
```

## Direct mTLS Certificate Placement

The local secrets bundle should contain:

```txt
mtls/orbi-internal-ca.crt
mtls/core-server.crt
mtls/core-server.key
mtls/pay-gateway-client.crt
mtls/pay-gateway-client.key
```

Install only the files each VM needs:

```bash
sudo mkdir -p /opt/orbi/mtls
sudo chown root:root /opt/orbi/mtls
sudo chmod 750 /opt/orbi/mtls
```

Core VM:

```bash
sudo cp orbi-internal-ca.crt core-server.crt core-server.key /opt/orbi/mtls/
sudo chown root:root /opt/orbi/mtls/orbi-internal-ca.crt /opt/orbi/mtls/core-server.crt /opt/orbi/mtls/core-server.key
sudo chmod 644 /opt/orbi/mtls/orbi-internal-ca.crt /opt/orbi/mtls/core-server.crt
sudo chmod 600 /opt/orbi/mtls/core-server.key
```

Pay Gateway VM:

```bash
sudo cp orbi-internal-ca.crt pay-gateway-client.crt pay-gateway-client.key /opt/orbi/mtls/
sudo chown root:root /opt/orbi/mtls/orbi-internal-ca.crt /opt/orbi/mtls/pay-gateway-client.crt /opt/orbi/mtls/pay-gateway-client.key
sudo chmod 644 /opt/orbi/mtls/orbi-internal-ca.crt /opt/orbi/mtls/pay-gateway-client.crt
sudo chmod 600 /opt/orbi/mtls/pay-gateway-client.key
```

If Core is behind a public reverse proxy, use a private DNS name or private IP route for `ORBI_CORE_INTERNAL_BASE_URL` where possible. The Core certificate must include the hostname used by Pay Gateway in its SAN list.

## Build And Run

```bash
npm install
npm run check
npm run build
npm run mtls:readiness -- /path/to/pay-gateway.env
PAYMENT_GATEWAY_SMOKE_BASE_URL=https://pay.orbifinancial.com npm run smoke:runtime-controls
npm start
```

For sandbox, run the same smoke against `https://sandbox-pay.orbifinancial.com`.
The smoke check verifies health, readiness, allowed browser CORS, denied browser
CORS, and unsigned internal ingress rejection.

## Release Gate

Every Pay Gateway release candidate must pass the local sandbox release gate
before the live container is restarted. The gate builds the Node SDK, runs SDK
tests, builds the gateway service and Docker image, starts the isolated sandbox
Core and Pay Gateway containers, rotates sandbox fixture secrets, creates and
approves a sandbox PaySafe payment through the public SDK contract, verifies
webhook delivery and replay, and runs negative checks for auth, redirect, and
idempotency behavior.

```powershell
.\scripts\release-gate.ps1
```

The gate depends on the Core repository because the sandbox Core and fixture
scripts live there. If the Core repository is in a different location, pass it
explicitly:

```powershell
.\scripts\release-gate.ps1 -CoreRepoPath "D:\FYNIX\ORBI\ORBI CORE\ORBI-Insitutional-Core-V2.0.4-Preview Stable"
```

The gate writes local release evidence under `.release-gate/` with the tested
Gateway commit SHA. Keep that evidence on the release host for operator audit;
do not commit it or copy sandbox secrets into Git.

Use `-SkipSandboxGate` only for an explicitly documented incident diagnostic.
It is not a valid production release path.

## Browser Origin Policy

`PAYMENT_GATEWAY_ALLOWED_BROWSER_ORIGINS` is only for ORBI-owned frontend
origins that are globally trusted, such as the hosted challenge UI, developer
portal, and first-party products. Merchant and developer domains must be stored
on their service profile as `browserOrigins`.

Sandbox service profiles may use local development origins such as
`http://localhost:5173`. Live service profiles must use public HTTPS domains,
for example `https://www.tag.co.tz`. Live origins must not use `localhost`,
private IP addresses, plain HTTP, or wildcard domains.

## mTLS Activation Gate

Gateway-to-Core mTLS must be enabled only after both sides are ready:

```env
PAYMENT_GATEWAY_INTERNAL_MTLS_ENABLED=true
PAYMENT_GATEWAY_INTERNAL_CORE_TRANSPORT_MODE=mtls
PAYMENT_GATEWAY_INTERNAL_MTLS_CERT_PATH=/opt/orbi/mtls/pay-gateway-client.crt
PAYMENT_GATEWAY_INTERNAL_MTLS_KEY_PATH=/opt/orbi/mtls/pay-gateway-client.key
PAYMENT_GATEWAY_INTERNAL_MTLS_CA_PATH=/opt/orbi/mtls/orbi-internal-ca.crt
PAYMENT_GATEWAY_INTERNAL_MTLS_REJECT_UNAUTHORIZED=true
ORBI_CORE_INTERNAL_BASE_URL=https://core.internal.orbifinancial.com
```

Production mTLS is fail-closed. If mTLS is enabled, Gateway refuses to start
unless the client certificate, private key, CA certificate, strict certificate
verification, and HTTPS Core target are all present.

Run readiness before deployment:

```bash
npm run mtls:readiness -- /path/to/pay-gateway.env
```

The self-hosted Gateway compose mounts:

```text
/opt/orbi/mtls
```

from the host certificate directory. Keep private keys outside Git and mount
the directory read-only.

## Docker

```bash
docker build -t orbi-pay-gateway:latest .
docker run -d --name orbi-pay-gateway --restart unless-stopped \
  --env-file .env \
  -p 3100:3100 \
  orbi-pay-gateway:latest
```

## Nginx Example

```nginx
server {
  listen 443 ssl;
  server_name pay.orbifinancial.com;

  location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

## Smoke Tests

```bash
curl -i https://pay.orbifinancial.com/health
curl -i https://pay.orbifinancial.com/ready
curl -i https://pay.orbifinancial.com/v1/providers
curl -i https://sandbox-pay.orbifinancial.com/health
curl -i https://sandbox-pay.orbifinancial.com/ready
curl -i https://sandbox-pay.orbifinancial.com/v1/providers
```

## Rollback

1. Stop new gateway container/process.
2. Restore previous gateway image or commit.
3. Confirm `/health` and `/ready`.
4. Confirm Core still rejects unsigned provider events.
5. Keep Core legacy provider routes disabled unless an emergency migration runbook explicitly enables them.
