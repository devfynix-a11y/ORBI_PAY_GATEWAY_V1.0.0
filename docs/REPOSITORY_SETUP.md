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
