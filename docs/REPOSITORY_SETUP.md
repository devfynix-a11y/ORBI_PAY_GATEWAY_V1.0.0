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
- `PAYMENT_GATEWAY_PROVIDER_MANIFEST_PATH` or `PAYMENT_GATEWAY_PROVIDER_MANIFEST_JSON`
- provider token reference env vars declared by the manifest
- mTLS private key paths/certificates where applicable

## Release Rule

Every release should pass:

```bash
npm run check
```
