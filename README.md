# ORBI Pay Gateway

ORBI Pay Gateway is the dedicated enterprise rail integration service for external money movement. It connects ORBI to providers such as mobile money, bank transfer rails, card processors, payout partners, and future crypto ramps.

It is intentionally separate from ORBI Core.

- ORBI Core is the banking engine, ledger authority, risk engine, wallet authority, and admin control plane.
- ORBI Pay Gateway is the provider adapter layer for collections, payouts, refunds, and provider callbacks.
- ORBI Pay Gateway never mutates wallet balances directly.
- ORBI Pay Gateway normalizes provider events and sends signed internal events to ORBI Core.

## Architecture

```txt
Mobile / Admin / Partner
  -> ORBI Core
  -> ORBI Pay Gateway
  -> External Provider
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
- [Core Environment Reference Snapshot](./docs/CORE_ENVIRONMENT_REFERENCE.md)

## Production Rule

Keep Core as the banking engine. Do not re-enable Core legacy gateway execution routes in production:

```env
ORBI_ENABLE_CORE_PROVIDER_GATEWAY_ROUTES=false
ORBI_ALLOW_STUB_PROVIDER_RECONCILIATION=false
```

Gateway-to-Core callbacks must keep HMAC signatures enabled. Add internal mTLS after the HMAC path is stable.

Separate-VM callback target:

```env
ORBI_CORE_INTERNAL_BASE_URL=https://api.orbifinancial.com
ORBI_CORE_TRUSTED_GATEWAY_EVENT_PATH=/api/internal/gateway/provider-events
ORBI_CORE_CALLBACK_TIMEOUT_MS=7500
```
