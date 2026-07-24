# Repository Setup

This folder is intended to become a standalone repository for ORBI Pay Gateway.

Suggested repository name:

```txt
ORBI-Pay-Gateway-V1.0.0
```

## First Push

```bash
cd "D:\FYNIX\ORBI\ORBI CORE\ORBI PAY GATEWAY"
git init
git add .
git commit -m "Initial ORBI Pay Gateway service"
git branch -M main
git remote add origin https://github.com/<owner>/ORBI-Pay-Gateway-V1.0.0.git
git push -u origin main
```

## Required Secrets

Configure these in the deployment platform, not Git:

- `WORKER_SIGNING_SECRET`
- `DATABASE_URL`
- `ORBI_SECRET_ENCRYPTION_KEY`
- `PAYMENT_GATEWAY_PROVIDER_MANIFEST_PATH` or `PAYMENT_GATEWAY_PROVIDER_MANIFEST_JSON`
- provider token reference env vars declared by the manifest
- mTLS private key paths/certificates where applicable

## Secret Vault Bootstrap

Developer Portal services use PostgreSQL as the official control-plane store.
API keys are stored as fingerprints only. Webhook signing secrets are stored as
encrypted vault material using `ORBI_SECRET_ENCRYPTION_KEY` so outbound webhooks
can still be signed after restart or restore.

To import service-registry credentials from the server environment:

```bash
npm run secrets:migrate-service-registry
```

The command must run with `DATABASE_URL`, `ORBI_SECRET_ENCRYPTION_KEY`, and the
service registry env vars loaded. It must not print or persist raw API keys.

## Release Rule

Every release should pass:

```bash
npm run check
```

## Self-Hosted Production Deploy

The self-hosted container must be recreated with the Core `.env` file loaded.
Running compose without the env file can start the gateway with blank secrets,
blank `DATABASE_URL`, or blank merchant IDs. In production that will fail closed
or surface as merchant readiness errors.

Use:

```powershell
cd "D:\FYNIX\ORBI\ORBI CORE\ORBI-Insitutional-Core-V2.0.4-Preview Stable\ops\self-hosted\Pay_Gateway"
docker compose --env-file "..\..\..\.env" build --no-cache pay-gateway
docker compose --env-file "..\..\..\.env" up -d --force-recreate pay-gateway
```

Verify after deploy:

```powershell
docker ps --filter "name=orbi-pay-gateway"
docker logs --tail 80 orbi-pay-gateway
docker exec orbi-pay-gateway sh -lc "grep -n 'metadata.merchant\|allowedOperations' /app/dist/src/services/payServiceAuth.js"
```

Required live env values include:

```text
DATABASE_URL
WORKER_SIGNING_SECRET
ORBI_SECRET_ENCRYPTION_KEY
ORBI_SHOP_PAY_API_KEY or another service key env
ORBI_SHOP_MERCHANT_ID or another merchant id env
```

Merchant PaySafe failures such as `Merchant account is not ready for this
PaySafe/payment request` usually mean one of these is missing:

```text
Developer Portal service metadata.merchant
merchantIdEnv runtime env value
active Core merchant record
active merchant PaySafe escrow wallet
required service scopes such as payments:create and escrow:create
```
