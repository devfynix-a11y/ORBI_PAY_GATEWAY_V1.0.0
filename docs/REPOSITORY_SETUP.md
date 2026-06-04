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
- `SELCOM_API_KEY`
- `SELCOM_API_SECRET`
- `MPESA_TZ_API_KEY`
- `MPESA_TZ_API_SECRET`
- mTLS private key paths/certificates where applicable

## Release Rule

Every release should pass:

```bash
npm run check
```
