# NMB Sandbox Onboarding

This guide starts ORBI Pay Gateway with NMB Bank sandbox before production TIPS or sponsored-participant connectivity.

## Public Sandbox Targets

Use the NMB OBP sandbox for early technical validation:

```txt
Portal: https://obp-portal-sandbox.nmbbank.co.tz
API base: https://obp-api-sandbox.nmbbank.co.tz
```

The sandbox is useful for:

- client registration
- OAuth/OBP credential testing
- account lookup experiments
- payment/transfer request shape validation
- SCA/challenge flow learning
- operator runbook rehearsal

## ORBI Profile Code

Use this Pay Gateway provider code:

```txt
nmb-obp-sandbox
```

Core should route sandbox bank movements to the same profile code:

```txt
provider_metadata.pay_gateway_provider_code = nmb-obp-sandbox
provider_metadata.switch_profile_code = nmb-obp-sandbox
```

## Provider Manifest

NMB-specific endpoints must live in the runtime provider manifest, not in source code.

For sandbox, start from:

```txt
config/providers.nmb-sandbox.example.json
```

Create the real runtime manifest:

```powershell
Copy-Item `
  -LiteralPath "D:\FYNIX\ORBI\ORBI CORE\ORBI PAY GATEWAY\config\providers.nmb-sandbox.example.json" `
  -Destination "D:\FYNIX\ORBI\ORBI CORE\ORBI PAY GATEWAY\config\providers.json"
```

Then keep:

```env
PAYMENT_GATEWAY_PROVIDER_MANIFEST_PATH=config/providers.json
```

`config/providers.json` is ignored by Git and should be treated like deployment configuration.

## Environment Variables

```env
NMB_OBP_SANDBOX_BASE_URL=https://obp-api-sandbox.nmbbank.co.tz
NMB_OBP_SANDBOX_CREDENTIAL_TOKEN_REF=env://NMB_OBP_SANDBOX_CONSUMER_KEY
NMB_OBP_SANDBOX_CREDENTIAL_METADATA={"consumerIdEnv":"NMB_OBP_SANDBOX_CONSUMER_ID","consumerSecretEnv":"NMB_OBP_SANDBOX_CONSUMER_SECRET"}
NMB_OBP_SANDBOX_WEBHOOK_SECRET_TOKEN_REF=env://NMB_OBP_SANDBOX_WEBHOOK_SECRET
NMB_OBP_SANDBOX_CONSUMER_ID=<consumer_id>
NMB_OBP_SANDBOX_CONSUMER_KEY=<consumer_key>
NMB_OBP_SANDBOX_CONSUMER_SECRET=<consumer_secret>
NMB_OBP_SANDBOX_WEBHOOK_SECRET=<sandbox-webhook-secret-if-issued>
NMB_OBP_SANDBOX_DIRECT_LOGIN_TOKEN=<optional-issued-direct-login-token>
NMB_OBP_SANDBOX_USERNAME=<optional-obp-username-for-direct-login>
NMB_OBP_SANDBOX_PASSWORD=<optional-obp-password-for-direct-login>
PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY=<strong-random-operator-key>
```

In production, do not use `env://` token refs. Use a vault/HSM/KMS token reference.

## Discover NMB/OBP Payment Capabilities

NMB sandbox exposes many OBP endpoints. ORBI should not hardcode mobile networks or bank rails from assumptions. Use Pay Gateway discovery first, then approve selected options into ORBI Core.

```bash
curl -s "https://pay.orbifinancial.com/v1/discovery/obp/nmb-obp-sandbox/payment-capabilities?bankId=nmbb.01.tz.nmbb&countryCode=TZ&currency=TZS" \
  -H "x-orbi-pay-operator-key: $PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY"
```

The discovery service inspects:

- `GET /obp/v4.0.0/banks`
- `GET /obp/v2.1.0/banks/{BANK_ID}/transaction-request-types`
- `GET /obp/v6.0.0/management/system-dynamic-entities`
- `GET /obp/v6.0.0/management/banks/{BANK_ID}/dynamic-entities`
- account-level transaction request types if `accountId` and `viewId` are supplied

Discovery output is intentionally marked `REQUIRES_REVIEW`. Operators must review naming, limits, fees, required fields, and status in ORBI Admin Portal before the option appears in mobile apps.

Production flow:

1. Pay Gateway discovers NMB/OBP transaction request types and dynamic entity candidates.
2. ORBI Admin reviews and saves selected candidates into Core `payment_rail_capabilities`.
3. Mobile apps call Core `GET /v1/payment-methods`.
4. Core routes selected capability codes through the parent partner bank/switch profile and Pay Gateway.

## Create Or Inspect Test Accounts

OBP sandbox accounts are operator test data. They are not ORBI customer wallets and must not be shown directly in consumer mobile UI.

### Option A: Import Sandbox Data

If your NMB/OBP sandbox user has the `CanCreateSandbox` entitlement, you can import a full test dataset:

```powershell
$headers = @{
  "x-orbi-pay-operator-key" = $env:PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY
  "Content-Type" = "application/json"
}

$payload = Get-Content -Raw ".\sandbox-import.sample.json"

Invoke-RestMethod `
  -Uri "https://pay.orbifinancial.com/v1/discovery/obp/nmb-obp-sandbox/sandbox/data-import" `
  -Method POST `
  -Headers $headers `
  -Body $payload |
  ConvertTo-Json -Depth 30
```

This proxies to:

```txt
POST /obp/v2.1.0/sandbox/data-import
```

If OBP returns an entitlement error, request or assign `CanCreateSandbox` to the sandbox user first.

### Option B: List Existing Accounts

After import, or if NMB already provides accounts, inspect them through Pay Gateway:

```powershell
$headers = @{
  "x-orbi-pay-operator-key" = $env:PAYMENT_GATEWAY_OPERATOR_DISCOVERY_API_KEY
}

Invoke-RestMethod `
  -Uri "https://pay.orbifinancial.com/v1/discovery/obp/nmb-obp-sandbox/banks/nmbb.01.tz.nmbb/accounts?scope=all" `
  -Headers $headers |
  ConvertTo-Json -Depth 30
```

Supported scopes:

- `latest`: `/obp/v6.0.0/banks/{BANK_ID}/accounts`
- `private`: `/obp/v3.0.0/banks/{BANK_ID}/accounts/private`
- `public`: `/obp/v2.0.0/banks/{BANK_ID}/accounts/public`
- `all`: inspect all three and merge the sanitized result

Use account IDs/views from this output only for sandbox capability testing, for example account-level transaction request type discovery. Production routing must still go through approved Core `payment_rail_capabilities`.

## Local Secret Import Helper

If your NMB credentials are stored outside Git as key/value text, generate local `.env` lines like this:

```powershell
$source = "D:\FYNIX\ORBI\ORBI CORE\SECREATES\NMB_SANDBOX\NMB_SANDBOX_CREDENTIALS.txt"
$target = "D:\FYNIX\ORBI\ORBI CORE\ORBI PAY GATEWAY\.env.nmb.sandbox.local"
$pairs = @{}
foreach ($line in (Get-Content -LiteralPath $source)) {
  if ($line -match '^\s*([^:=\s]+)\s*[:=]\s*(.*)$') {
    $pairs[$matches[1]] = $matches[2]
  }
}
@(
  "NMB_OBP_SANDBOX_BASE_URL=https://obp-api-sandbox.nmbbank.co.tz"
  "NMB_OBP_SANDBOX_CREDENTIAL_TOKEN_REF=env://NMB_OBP_SANDBOX_CONSUMER_KEY"
  "NMB_OBP_SANDBOX_CREDENTIAL_METADATA={""consumerIdEnv"":""NMB_OBP_SANDBOX_CONSUMER_ID"",""consumerSecretEnv"":""NMB_OBP_SANDBOX_CONSUMER_SECRET""}"
  "NMB_OBP_SANDBOX_WEBHOOK_SECRET_TOKEN_REF=env://NMB_OBP_SANDBOX_WEBHOOK_SECRET"
  "NMB_OBP_SANDBOX_CONSUMER_ID=$($pairs.consumer_id)"
  "NMB_OBP_SANDBOX_CONSUMER_KEY=$($pairs.consumer_key)"
  "NMB_OBP_SANDBOX_CONSUMER_SECRET=$($pairs.consumer_secret)"
  "NMB_OBP_SANDBOX_WEBHOOK_SECRET="
) | Set-Content -LiteralPath $target
```

Never commit `.env.nmb.sandbox.local`.

## Sandbox Callback URL

If NMB sandbox supports callbacks/webhooks for the selected API flow, register:

```txt
https://pay.orbifinancial.com/v1/webhooks/nmb-obp-sandbox
```

If sandbox does not send callbacks, keep the callback route configured in ORBI but test status polling or manual callback replay separately.

## Sandbox Scope

NMB sandbox is not the same as live TIPS connectivity.

Sandbox mode validates:

- request signing/authentication pattern
- bank API object shapes
- ORBI Core -> Pay Gateway -> bank API flow
- callback normalization
- Core ledger finalization after trusted gateway event

Production mode still requires:

- legal/commercial onboarding
- sponsored participant or direct participant model
- TIPS/switch implementation guide
- ISO 20022 profile
- mTLS/VPN/private connectivity profile
- settlement calendar and reconciliation agreement
- certification evidence

## Production Direction

For production, use a separate profile such as:

```txt
nmb-sponsored-tips
```

That profile should use `ISO20022_MTLS` or the protocol specified by NMB/TIPS after certification. It must remain fail-closed until participant IDs, certificates, and scheme tests are complete.
