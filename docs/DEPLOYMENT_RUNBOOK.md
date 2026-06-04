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
- future mTLS/private endpoint policy once certificate lifecycle is ready.

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
```

## Core Production Safety

Core should keep legacy provider execution disabled:

```env
ORBI_ENABLE_CORE_PROVIDER_GATEWAY_ROUTES=false
ORBI_ALLOW_STUB_PROVIDER_RECONCILIATION=false
ORBI_PAY_GATEWAY_BASE_URL=https://pay.orbifinancial.com
```

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
