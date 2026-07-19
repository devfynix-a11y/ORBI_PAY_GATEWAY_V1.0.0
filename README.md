# ORBI Pay Gateway

ORBI Pay Gateway is the dedicated enterprise rail integration service for external money movement. It is now ISO 20022-first, so ORBI can connect through a regulated neighbor bank or scheme participant, then expand into TIPS and other East African or global clearing pipelines without rewriting ORBI Core.

It is intentionally separate from ORBI Core.

- ORBI Core is the banking engine, ledger authority, risk engine, wallet authority, and admin control plane.
- ORBI Pay Gateway is the ISO 20022 clearing and provider execution boundary for collections, payouts, refunds, and clearing callbacks.
- ORBI Pay Gateway never mutates wallet balances directly.
- ORBI Pay Gateway normalizes provider events and sends signed internal events to ORBI Core.
- External ORBI products such as ORBI Shop integrate through scoped service registry APIs, payment intents, and signed webhooks.

## Architecture

```txt
Mobile / Admin / Partner
  -> ORBI Core
  -> ORBI Pay Gateway
  -> Neighbor Bank / TIPS / External Clearing Network
  -> ORBI Pay Gateway Webhook
  -> signed internal event over Core secure root
  -> ORBI Core ledger settlement
```

Core remains the source of truth. The gateway is an execution and normalization boundary.

## Quick Start

```bash
cp .env.example .env
npm install
npm run dev
```

Health:

```txt
http://127.0.0.1:3100/health
```

Readiness:

```txt
http://127.0.0.1:3100/ready
```

Create a trusted service payment intent:

```txt
POST /v1/payment-intents
x-orbi-pay-service-key: <ORBI_SHOP_PAY_API_KEY>
```

The gateway identifies the service from the key, enforces allowed currencies/operations, signs the request to ORBI Core, and returns the Core submission result. ORBI Core remains the routing and ledger authority: it locates the customer, decides OTP/PIN/passkey challenges, and determines whether the movement is internal, external, PaySafe escrow, refund, or provider-bound.

PaySafe service actions use global product routes:

```txt
POST /v1/paysafe/escrows
POST /v1/paysafe/escrows/:escrowId/release
POST /v1/paysafe/escrows/:escrowId/dispute
POST /v1/paysafe/escrows/:escrowId/refund
```

Pay Gateway only adapts the request and signs it to Core. Core owns escrow policy, customer authorization, ledger posting, and final settlement.

Core sends service-facing results back to:

```txt
POST /v1/internal/core/service-payment-events
x-worker-scopes: gateway:service-payments:result
```

Pay Gateway then signs the result webhook back to the external service, for example ORBI Shop.

## Main Commands

```bash
npm run build
npm test
npm run check
npm start
```

## Documentation

- [Engineering Plan](./docs/ENGINEERING_PLAN.md)
- [API Reference](./docs/API_REFERENCE.md)
- [Deployment Runbook](./docs/DEPLOYMENT_RUNBOOK.md)
- [Provider Adapter Guide](./docs/PROVIDER_ADAPTER_GUIDE.md)
- [Security Model](./docs/SECURITY_MODEL.md)
- [System Separation](./docs/SYSTEM_SEPARATION.md)
- [Central Switch And Webhook Architecture](./docs/CENTRAL_SWITCH_AND_WEBHOOK_ARCHITECTURE.md)
- [ISO 20022 Clearing Architecture](./docs/ISO20022_CLEARING_ARCHITECTURE.md)
- [NMB Sandbox Onboarding](./docs/NMB_SANDBOX_ONBOARDING.md)
- [Core Environment Reference Snapshot](./docs/CORE_ENVIRONMENT_REFERENCE.md)

## Trusted Service Registry

Service integrations are loaded from:

```env
PAYMENT_GATEWAY_SERVICE_REGISTRY_PATH=config/services.json
```

Start from `config/services.example.json`. Do not expose service keys to browsers or mobile apps.

## Production Rule

Keep Core as the banking engine. Do not re-enable Core legacy gateway execution routes in production:

```env
ORBI_ENABLE_CORE_PROVIDER_GATEWAY_ROUTES=false
ORBI_ALLOW_STUB_PROVIDER_RECONCILIATION=false
```

Gateway-to-Core callbacks must keep HMAC signatures enabled. Keep Pay Gateway on the local self-hosted container network with Core.

Self-hosted callback target:

```env
ORBI_CORE_INTERNAL_BASE_URL=http://core:3000
ORBI_CORE_TRUSTED_GATEWAY_EVENT_PATH=/api/internal/gateway/provider-events
ORBI_CORE_CALLBACK_TIMEOUT_MS=7500
```
