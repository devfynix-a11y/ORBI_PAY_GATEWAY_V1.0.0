# ORBI System Separation

ORBI production infrastructure is separated into three services so financial authority, payment provider execution, and communications stay cleanly isolated.

## ORBI Core

Canonical roots:

```txt
https://api.orbifinancial.com
https://api.orbifinancial.com
```

ORBI Core is the banking and control engine.

- owns users, staff, roles, wallets, balances, and double-entry ledger posting
- owns transaction preview, settlement, reversal, escrow, refunds, and account/wallet locks
- owns risk decisions, audit trails, limits, compliance alerts, and admin control workflows
- calls ORBI Pay Gateway for external provider execution
- calls ORBI Talk Gateway for templates, SMS, email, push, and staff/customer messages

## ORBI Pay Gateway

Canonical root:

```txt
https://pay.orbifinancial.com
```

ORBI Pay Gateway is the external money-rail integration service.

- owns provider adapters, provider credentials, callbacks, and normalized provider events
- never posts ledger entries or mutates wallet balances directly
- sends signed provider events back to ORBI Core for final settlement decisions

## ORBI Talk Gateway

Canonical root:

```txt
https://talk.orbifinancial.com
```

ORBI Talk Gateway is the communication and template service.

- owns SMS, email, push, delivery queues, retries, templates, and template variables
- never handles payment execution or ledger mutation
- is used by ORBI Core for transactional, security, support, marketing, and operator messages

## Messaging Intent Rule

Core and Pay Gateway must not send direct ad-hoc email, SMS, WhatsApp, or push
messages. They emit signed messaging intents to ORBI Talk.

Messaging intents carry safe references only:

```txt
eventId
correlationId
templateCode
recipientIdentityRef
language
channel
serviceCode
environment
safe metadata such as key fingerprint, status, amount, or escrow reference
```

Messaging intents must never include raw OTP values, passwords, PINs, API keys,
webhook signing secrets, provider credentials, or full wallet authority data.

## Naming Rules

- `ORBI_PAY_GATEWAY_BASE_URL` in Core means ORBI Pay Gateway only.
- `PAYMENT_GATEWAY_*` belongs to Pay Gateway runtime, providers, and Core callback signing.
- `ORBI_TALK_GATEWAY_*` belongs to Talk Gateway messaging, templates, email, SMS, and push.
- Legacy ambiguous messaging variable names are not accepted in new Core configuration.
