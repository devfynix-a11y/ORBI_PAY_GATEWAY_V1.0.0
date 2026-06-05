# ORBI Pay Gateway Deployment Runbook

## Recommended Topology

Run ORBI Pay Gateway on a separate VM or container from ORBI Core.

```txt
pay.orbifinancial.com -> Nginx -> ORBI Pay Gateway :3100
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

ORBI_CORE_INTERNAL_BASE_URL=https://api.orbifinancial.com
ORBI_CORE_TRUSTED_GATEWAY_EVENT_PATH=/api/internal/gateway/provider-events
ORBI_CORE_CALLBACK_TIMEOUT_MS=7500

PAYMENT_GATEWAY_WORKER_ID=orbi-payment-gateway
PAYMENT_GATEWAY_WORKER_SCOPES=gateway:events:write
WORKER_SIGNING_SECRET=<same-secret-configured-in-core>
WORKER_KEY_ID=payment-gateway-v1

PAYMENT_GATEWAY_INTERNAL_MTLS_ENABLED=true
PAYMENT_GATEWAY_INTERNAL_MTLS_CERT_PATH=/opt/orbi/mtls/pay-gateway-client.crt
PAYMENT_GATEWAY_INTERNAL_MTLS_KEY_PATH=/opt/orbi/mtls/pay-gateway-client.key
PAYMENT_GATEWAY_INTERNAL_MTLS_CA_PATH=/opt/orbi/mtls/orbi-internal-ca.crt
PAYMENT_GATEWAY_INTERNAL_MTLS_REJECT_UNAUTHORIZED=true
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
npm start
```

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
```

## Rollback

1. Stop new gateway container/process.
2. Restore previous gateway image or commit.
3. Confirm `/health` and `/ready`.
4. Confirm Core still rejects unsigned provider events.
5. Keep Core legacy provider routes disabled unless an emergency migration runbook explicitly enables them.
