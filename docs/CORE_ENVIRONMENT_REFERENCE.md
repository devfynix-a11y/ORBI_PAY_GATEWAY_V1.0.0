# ORBI Environment Variables Reference

## Purpose

This document consolidates:

- variables found in the existing shared env file
- variables listed in `.env.example`
- variables introduced by the new smoke-test, load-test, and drill-report scripts

This reference is for maintainability only. It intentionally does not store secret values.

## Legend

- `Runtime`: used by the backend application itself
- `Frontend`: used by Vite or browser-facing build configuration
- `Script`: used only when manually running scripts or workflows
- `Secret`: should be stored securely and never committed in plaintext
- `Non-secret`: configuration or metadata that is usually safe to expose internally

## Important Notes

- `ORBI_MONITOR_API_KEY` is now a dedicated internal monitor token used only for protected monitor endpoints.
- monitor routes no longer reuse tenant-facing `x-api-key` authentication.
- `PAYMENT_GATEWAY_*` variables belong to ORBI Pay Gateway runtime, provider credentials, and Core callback signing.
- `ORBI_PAY_GATEWAY_BASE_URL` in ORBI Core means the ORBI Pay Gateway base URL only.
- `ORBI_TALK_GATEWAY_API_KEY` is for backend-to-ORBI-Talk-Gateway messaging calls such as SMS, email, push, and templates.
- Legacy ambiguous messaging names are no longer accepted. Use `ORBI_TALK_GATEWAY_*` only.
- `ORBI_BASE_URL` is also script-only. In practice it often points to the same value as `BACKEND_URL`.
- `NEW_SECRET` appears in the shared env file but is not present in `.env.example` and was not introduced by the new work. Its purpose should be reviewed and documented by the team.
- `KMS_MASTER_SALT` exists only in `.env.example` as a legacy compatibility name. The active env file uses `KMS_SALT`.

## Source Coverage

- Existing shared env file:
  - `C:\Users\danie\Downloads\ORBI_FINANCIAL_TECHNOLOGIES_CORE_V2026 (3).env`
- Backend example file:
  - `.env.example`
- Script sources:
  - `scripts/release-smoke.mjs`
  - `loadtests/k6/readiness-and-metrics.js`
  - `scripts/drill-report.mjs`

## Core Runtime Variables

| Variable | Type | Secret | In Shared Env | In `.env.example` | Purpose |
| --- | --- | --- | --- | --- | --- |
| `APP_ID` | Runtime | Non-secret | No | Yes | Legacy or general application identity key used in some deployments. |
| `BACKEND_URL` | Runtime | Non-secret | Yes | Yes | Canonical backend public base URL. |
| `CLUSTER_ID` | Runtime | Non-secret | Yes | Yes | Logical node or cluster identifier. |
| `NODE_ENV` | Runtime | Non-secret | Yes | Yes | Runtime mode such as `development` or `production`. |
| `PORT` | Runtime | Non-secret | Yes | Yes | Local server port. |
| `JWT_SECRET` | Runtime | Secret | Yes | Yes | JWT signing secret. |
| `SESSION_SECRET` | Runtime | Secret | Yes | Yes | Session signing or fallback session secret. |
| `WORKER_SECRET` | Runtime | Secret | Yes | Yes | Internal worker authentication secret. |
| `WORKER_SIGNING_SECRET` | Runtime | Secret | Yes | No | Internal signed worker request secret. |
| `KMS_MASTER_KEY` | Runtime | Secret | Yes | Yes | Master secret for KMS key unwrapping and encryption hierarchy. |
| `KMS_MASTER_SALT` | Runtime | Secret | No | Yes | Legacy KMS salt compatibility variable. |
| `KMS_SALT` | Runtime | Secret | Yes | Yes | Active KMS salt input. |

## AI And Intelligence

| Variable | Type | Secret | In Shared Env | In `.env.example` | Purpose |
| --- | --- | --- | --- | --- | --- |
| `GEMINI_API_KEY` | Runtime | Secret | Yes | Yes | AI provider API key used by intelligence features. |

## Database And Supabase

| Variable | Type | Secret | In Shared Env | In `.env.example` | Purpose |
| --- | --- | --- | --- | --- | --- |
| `SUPABASE_URL` | Runtime | Non-secret | Yes | Yes | Supabase project URL. |
| `SUPABASE_ANON_KEY` | Runtime | Secret | Yes | Yes | Supabase publishable key used by some integrations. |
| `SUPABASE_SERVICE_ROLE_KEY` | Runtime | Secret | Yes | Yes | High-privilege server-side Supabase key. |

## Storage And Object Buckets

| Variable | Type | Secret | In Shared Env | In `.env.example` | Purpose |
| --- | --- | --- | --- | --- | --- |
| `S3_ACCESS_KEY_ID` | Runtime | Secret | Yes | Yes | Object storage access key. |
| `S3_SECRET_ACCESS_KEY` | Runtime | Secret | Yes | Yes | Object storage secret key. |
| `S3_BUCKET` | Runtime | Non-secret | Yes | Yes | Default storage bucket name. |
| `S3_ENDPOINT` | Runtime | Non-secret | Yes | Yes | S3-compatible endpoint URL. |
| `S3_REGION` | Runtime | Non-secret | Yes | Yes | Storage region name. |
| `KYC_BUCKET` | Runtime | Non-secret | Yes | Yes | Bucket or storage namespace used for KYC artifacts. |

## ORBI Talk Gateway And Messaging

| Variable | Type | Secret | In Shared Env | In `.env.example` | Purpose |
| --- | --- | --- | --- | --- | --- |
| `ORBI_TALK_GATEWAY_URL` | Runtime | Non-secret | No | Yes | Base URL for the ORBI Talk Gateway used for SMS, email, push, and templates. |
| `ORBI_TALK_GATEWAY_BASE_URL` | Runtime | Non-secret | No | No | Optional alternate ORBI Talk Gateway base URL name. Prefer `ORBI_TALK_GATEWAY_URL` unless a deployment needs both names. |
| `ORBI_TALK_GATEWAY_API_KEY` | Runtime | Secret | No | Yes | API key used by backend-to-ORBI-Talk-Gateway requests. |
| `ORBI_TALK_GATEWAY_USER_ID` | Runtime | Non-secret | No | Yes | Optional ORBI Talk Gateway owner/user identifier. |
| `ORBI_TALK_GATEWAY_USER_EMAIL` | Runtime | Non-secret | No | Yes | Optional ORBI Talk Gateway owner/user email. |

## ORBI Payment Gateway / Payment Bridge

| Variable | Type | Secret | In Shared Env | In `.env.example` | Purpose |
| --- | --- | --- | --- | --- | --- |
| `ORBI_PAY_GATEWAY_BASE_URL` | Runtime | Non-secret | Yes | Yes | Base URL for ORBI Pay Gateway, not for SMS/email templates. |
| `ORBI_ENABLE_CORE_PROVIDER_GATEWAY_ROUTES` | Runtime | Non-secret | No | No | Temporary migration switch for legacy Core `/v1/gateway/*` provider-execution routes. Keep unset/false in production when using the separate Payment Gateway service. |
| `ORBI_ALLOW_STUB_PROVIDER_RECONCILIATION` | Runtime | Non-secret | No | No | Non-production-only settlement lab override. Never enable in production; live settlement requires trusted provider proof before ledger commit. |
| `PAYMENT_GATEWAY_PORT` | Runtime | Non-secret | No | Payment gateway only | Local port for the standalone ORBI Payment Gateway service. |
| `PAYMENT_GATEWAY_PUBLIC_BASE_URL` | Runtime | Non-secret | No | Payment gateway only | Public base URL for external payment provider traffic, commonly `https://pay.orbifinancial.com`. |
| `PAYMENT_GATEWAY_PROVIDER_MODE` | Runtime | Non-secret | No | Payment gateway only | Gateway provider mode. Use `live` for production provider adapters. |
| `PAYMENT_GATEWAY_ALLOWED_BROWSER_ORIGINS` | Runtime | Non-secret | No | Payment gateway only | Comma-separated ORBI-owned browser origins allowed globally. Merchant/developer domains belong in Developer Portal `browserOrigins`, not this global env. |
| `PAYMENT_GATEWAY_REQUIRE_SIGNED_INTERNAL_INGRESS` | Runtime | Non-secret | No | Payment gateway only | Requires worker-signed headers on Gateway internal ingress routes. Default `true` in production. |
| `PAYMENT_GATEWAY_REQUEST_AUDIT_ENABLED` | Runtime | Non-secret | No | Payment gateway only | Emits structured request completion logs with request, trace, and correlation IDs. Default `true`. |
| `PAYMENT_GATEWAY_AUDIT_EVENT_SINK_URL` | Runtime | Non-secret | No | Payment gateway only | Optional SIEM-compatible HTTP JSON event sink for request, OAuth, security, and reconciliation audit events. Delivery is non-blocking and fail-open. |
| `PAYMENT_GATEWAY_SIEM_SINK_URL` | Runtime | Non-secret | No | Payment gateway only | Backward-compatible alias for `PAYMENT_GATEWAY_AUDIT_EVENT_SINK_URL`. Prefer the explicit audit event name for new deployments. |
| `PAYMENT_GATEWAY_AUDIT_EVENT_SINK_PATH` | Runtime | Non-secret path | No | Payment gateway only | Optional JSONL audit event sink path for self-hosted collectors. Use log rotation or a mounted collector directory in production. |
| `PAYMENT_GATEWAY_AUDIT_EVENT_SINK_TIMEOUT_MS` | Runtime | Non-secret | No | Payment gateway only | HTTP audit sink timeout. Default `1500`. Audit delivery must never block financial settlement flow. |
| `PAYMENT_GATEWAY_RECONCILIATION_EXPORT_PATH` | Runtime | Non-secret path | No | Payment gateway only | Optional directory where signed Gateway reconciliation evidence reports are written by the internal export endpoint. |
| `PAYMENT_GATEWAY_RECONCILIATION_BUCKET` | Runtime | Non-secret | No | Payment gateway only | Reserved object-storage target name for future signed reconciliation evidence export. Configure only after storage adapter approval. |
| `PAYMENT_GATEWAY_RECONCILIATION_STUCK_INTENT_MINUTES` | Runtime | Non-secret | No | Payment gateway only | Age threshold for flagging non-final payment intents in reconciliation exception queues. Default `30`. |
| `PAYMENT_GATEWAY_RECONCILIATION_WEBHOOK_PENDING_MINUTES` | Runtime | Non-secret | No | Payment gateway only | Age threshold for flagging pending webhook deliveries in reconciliation exception queues. Default `10`. |
| `ORBI_CORE_INTERNAL_BASE_URL` | Runtime | Non-secret | No | Payment gateway only | Secure Core external root used by the payment gateway for signed callbacks, commonly `https://api.orbifinancial.com`. |
| `PAYMENT_GATEWAY_INTERNAL_CORE_TRANSPORT_MODE` | Runtime | Non-secret | No | Payment gateway only | Gateway -> Core transport mode. Use `private_http` only for Docker/private Core targets with HMAC signing, `mtls` for certificate-backed internal HTTPS, or `public_https` for HTTPS-only routed deployments. |
| `ORBI_CORE_TRUSTED_GATEWAY_EVENT_PATH` | Runtime | Non-secret | No | Payment gateway only | Core internal route for normalized trusted provider events. |
| `PAYMENT_GATEWAY_WORKER_ID` | Runtime | Non-secret | No | Payment gateway only | Internal worker identity sent to Core by the payment gateway. |
| `PAYMENT_GATEWAY_WORKER_SCOPES` | Runtime | Non-secret | No | Payment gateway only | Comma-separated worker scopes. Must include `gateway:events:write`. |
| `WORKER_KEY_ID` | Runtime | Non-secret | No | Payment gateway only | Optional key id label for signed internal worker callbacks. |
| `PAYMENT_GATEWAY_INTERNAL_MTLS_ENABLED` | Runtime | Non-secret | No | Payment gateway only | Enables direct client-certificate mTLS for gateway-to-Core HTTPS callbacks. |
| `PAYMENT_GATEWAY_INTERNAL_MTLS_CERT_PATH` | Runtime | Non-secret | No | Payment gateway only | Payment gateway client certificate path for direct mTLS. |
| `PAYMENT_GATEWAY_INTERNAL_MTLS_KEY_PATH` | Runtime | Secret path | No | Payment gateway only | Payment gateway client private key path for direct mTLS. |
| `PAYMENT_GATEWAY_INTERNAL_MTLS_CA_PATH` | Runtime | Non-secret | No | Payment gateway only | Internal CA path used to validate Core during direct mTLS. |
| `PAYMENT_GATEWAY_INTERNAL_MTLS_REJECT_UNAUTHORIZED` | Runtime | Non-secret | No | Payment gateway only | Keeps Core certificate validation strict for direct mTLS. |
| `PAYMENT_GATEWAY_PROVIDER_MANIFEST_PATH` | Runtime | Non-secret | No | Payment gateway only | Path to the provider manifest file, commonly `config/providers.json`. |
| `PAYMENT_GATEWAY_PROVIDER_MANIFEST_JSON` | Runtime | Secret/config | No | Payment gateway only | Inline provider manifest JSON for deployment platforms that do not mount files. |
| `PAYMENT_GATEWAY_CREDENTIAL_MODE` | Runtime | Non-secret | No | Payment gateway only | Use `tokenized` in production. Direct provider secrets are rejected in production tokenized mode. |
| `PAYMENT_GATEWAY_REQUIRE_STRONG_CUSTOMER_AUTH` | Runtime | Non-secret | No | Payment gateway only | Requires authenticated SCA/3DS evidence for card-style rails. |
| `PAYMENT_GATEWAY_FINANCIAL_SIGNATURE_TOLERANCE_SECONDS` | Runtime | Non-secret | No | Payment gateway only | Maximum allowed clock skew for SDK-signed financial requests. Default `300`. |
| `PAYMENT_GATEWAY_FINANCIAL_NONCE_TTL_SECONDS` | Runtime | Non-secret | No | Payment gateway only | How long a signed request nonce remains blocked against replay. Default `600`. |
| `PAYMENT_GATEWAY_FINANCIAL_NONCE_MAX_ENTRIES` | Runtime | Non-secret | No | Payment gateway only | Maximum in-memory nonce cache entries per gateway process. Default `100000`. |
| `PAYMENT_GATEWAY_FINANCIAL_RATE_LIMIT_WINDOW_SECONDS` | Runtime | Non-secret | No | Payment gateway only | Financial request rate limit window per service/key subject. Default `60`. |
| `PAYMENT_GATEWAY_FINANCIAL_RATE_LIMIT_MAX_REQUESTS` | Runtime | Non-secret | No | Payment gateway only | Maximum financial requests per service/key subject per window. Default `120`. |
| `PAYMENT_GATEWAY_FINANCIAL_RATE_LIMIT_MAX_SUBJECTS` | Runtime | Non-secret | No | Payment gateway only | Maximum in-memory rate-limit subjects retained per process. Default `50000`. |
| `PAYMENT_GATEWAY_SERVICE_ACCESS_TOKEN_SECRET` | Runtime | Secret | Yes in production | Payment gateway only | HMAC signing secret for short-lived service access tokens issued by `/oauth/token`. Keep separate from portal sessions and Core worker signing. |
| `PAYMENT_GATEWAY_SERVICE_ACCESS_TOKEN_TTL_SECONDS` | Runtime | Non-secret | No | Payment gateway only | Service access token lifetime in seconds. Default `900`, clamped between 60 and 3600. |
| `PAYMENT_GATEWAY_OAUTH_ISSUER_URL` | Runtime | Non-secret | No | Payment gateway only | Optional OAuth metadata issuer URL. Defaults to `PAYMENT_GATEWAY_PUBLIC_BASE_URL`. |
| `PAYMENT_GATEWAY_PORTAL_OPERATOR_MFA_REQUIRED` | Runtime | Non-secret | No | Payment gateway only | Requires MFA-verified portal sessions for operator/admin accounts and sensitive control-plane actions. Default `true`. |
| `<PROVIDER>_API_BASE_URL` | Runtime | Non-secret | No | Payment gateway only | Provider API base URL declared by the provider manifest. |
| `<PROVIDER>_CREDENTIAL_TOKEN_REF` | Runtime | Secret/config | No | Payment gateway only | Token reference to provider API credentials in vault/HSM/KMS-backed storage. |
| `<PROVIDER>_WEBHOOK_SECRET_TOKEN_REF` | Runtime | Secret/config | No | Payment gateway only | Token reference to provider webhook verification secret. |
| `<PROVIDER>_3DS_PROFILE_ID` | Runtime | Non-secret | No | Payment gateway only | Optional 3DS/SCA profile id for card-style rails. |

## Monitoring And Alerts

| Variable | Type | Secret | In Shared Env | In `.env.example` | Purpose |
| --- | --- | --- | --- | --- | --- |
| `ADMIN_ALERT_EMAIL` | Runtime | Non-secret | No | Yes | Target email for admin alerting if used. |
| `ADMIN_ALERT_PHONE` | Runtime | Non-secret | No | Yes | Target phone for admin alerting if used. |

## Frontend And Vite

| Variable | Type | Secret | In Shared Env | In `.env.example` | Purpose |
| --- | --- | --- | --- | --- | --- |
| `VITE_API_BASE_URL` | Frontend | Non-secret | Yes | Yes | Browser-facing API base URL. |
| `VITE_SUPABASE_URL` | Frontend | Non-secret | Yes | Yes | Frontend Supabase URL. |
| `VITE_SUPABASE_ANON_KEY` | Frontend | Secret | Yes | Yes | Frontend publishable Supabase key. |
| `VITE_STORAGE_PROVIDER` | Frontend | Non-secret | Yes | Yes | Browser storage backend selector. |
| `VITE_AVATAR_BUCKET` | Frontend | Non-secret | Yes | Yes | Frontend avatar bucket name. |

## Mobile And Client Identity

| Variable | Type | Secret | In Shared Env | In `.env.example` | Purpose |
| --- | --- | --- | --- | --- | --- |
| `ORBI_ANDROID_APP_HASH` | Runtime | Non-secret | Yes | Yes | Android application trust or asset-link hash. |
| `ORBI_ANDROID_PACKAGE_NAME` | Runtime | Non-secret | Yes | Yes | Trusted Android package name. |
| `ORBI_ANDROID_SMS_HASH` | Runtime | Non-secret | Yes | Yes | Android SMS verification helper hash. |
| `ORBI_MOBILE_ORIGIN` | Runtime | Non-secret | Yes | Yes | Trusted mobile-origin identifier. |
| `ORBI_MOBILE_APP_ID` | Runtime | Non-secret | Yes | Yes | Trusted mobile application identifier. |
| `ORBI_CORE_APP_ID` | Runtime | Non-secret | Yes | Yes | Core application identifier. |
| `ORBI_CORE_APP_ORIGIN` | Runtime | Non-secret | Yes | Yes | Core application origin identifier. |
| `ORBI_CORE_PORTAL_APP_ID` | Runtime | Non-secret | Yes | Yes | Institutional portal application identifier. |
| `ORBI_CORE_PORTAL_APP_ORIGIN` | Runtime | Non-secret | Yes | Yes | Institutional portal origin identifier. |
| `ORBI_IOS_BUNDLE_IDS` | Runtime | Non-secret | Yes | Yes | Comma-separated trusted iOS bundle identifiers. |
| `ORBI_IOS_TEAM_ID` | Runtime | Non-secret | Yes | Yes | Apple team identifier used in app-site association or trust flows. |
| `RP_ID` | Runtime | Non-secret | Yes | Yes | Relying-party identifier for auth flows such as passkeys. |
| `ORBI_WEB_ORIGIN` | Runtime | Non-secret | Yes | Yes | Trusted web origin. |
| `ORIGIN` | Runtime | Non-secret | Yes | Yes | General origin setting used by some routing or CORS logic. |
| `ORBI_ALLOWED_ORIGINS` | Runtime | Non-secret | Yes | Yes | Explicit allowlist of trusted origins. |

## Bootstrap And Administrative Controls

| Variable | Type | Secret | In Shared Env | In `.env.example` | Purpose |
| --- | --- | --- | --- | --- | --- |
| `ORBI_BOOTSTRAP_ADMIN_SECRET` | Runtime | Secret | Yes | Yes | Bootstrap secret for initial admin provisioning. |
| `ORBI_REQUIRE_BOOTSTRAP_ADMIN_SECRET` | Runtime | Non-secret | Yes | Yes | Forces bootstrap admin actions to require the secret. |

## Redis And Caching

| Variable | Type | Secret | In Shared Env | In `.env.example` | Purpose |
| --- | --- | --- | --- | --- | --- |
| `REDIS_URL` | Runtime | Secret | Yes | Yes | Redis connection URL. |
| `REDIS_TLS_ENABLED` | Runtime | Non-secret | Yes | Yes | Enables TLS for Redis connectivity. |
| `REDIS_ALLOW_INSECURE_TLS` | Runtime | Non-secret | No | Yes | Allows insecure Redis TLS only for troubleshooting. |
| `REDIS_CA_CERT_PATH` | Runtime | Non-secret | No | Yes | Optional CA path for Redis TLS validation. |

## TLS And Transport Security

| Variable | Type | Secret | In Shared Env | In `.env.example` | Purpose |
| --- | --- | --- | --- | --- | --- |
| `ORBI_ENFORCE_HTTPS` | Runtime | Non-secret | Yes | Yes | Forces HTTPS enforcement behavior. |
| `ORBI_TLS_ENABLED` | Runtime | Non-secret | Yes | Yes | Enables direct TLS termination in the Node service. |
| `ORBI_TLS_CERT_PATH` | Runtime | Non-secret | Yes | Yes | TLS certificate file path for direct termination. |
| `ORBI_TLS_KEY_PATH` | Runtime | Non-secret | Yes | Yes | TLS private key file path for direct termination. |
| `ORBI_TLS_CA_PATH` | Runtime | Non-secret | Yes | Yes | Optional CA path for direct TLS setup. |
| `ORBI_TLS_REJECT_UNAUTHORIZED` | Runtime | Non-secret | Yes | Yes | Controls TLS certificate validation behavior. |

## Internal mTLS And Trusted Internal Traffic

| Variable | Type | Secret | In Shared Env | In `.env.example` | Purpose |
| --- | --- | --- | --- | --- | --- |
| `ORBI_INTERNAL_MTLS_SOURCE` | Runtime | Non-secret | Yes | Yes | Selects `proxy` or `direct` internal mTLS mode. |
| `ORBI_INTERNAL_MTLS_PROXY_HEADER` | Runtime | Non-secret | Yes | Yes | Trusted proxy header name for attested internal traffic. |
| `ORBI_INTERNAL_MTLS_PROXY_SHARED_SECRET` | Runtime | Secret | Yes | Yes | Shared secret for proxy-attested internal mTLS mode. |
| `ORBI_INTERNAL_MTLS_CA_PATH` | Runtime | Non-secret | Yes | Yes | CA path for direct internal mTLS validation. |
| `ORBI_INTERNAL_MTLS_MODE` | Runtime | Non-secret | Yes | No | Enforces internal worker mTLS mode, commonly `required`. |

## Feature Flags And Safety Controls

| Variable | Type | Secret | In Shared Env | In `.env.example` | Purpose |
| --- | --- | --- | --- | --- | --- |
| `ORBI_ENABLE_GATEWAY_BACKGROUND_JOBS` | Runtime | Non-secret | No | Yes | Enables root gateway background jobs. |
| `ORBI_ENABLE_INTERNAL_BACKGROUND_JOBS` | Runtime | Non-secret | No | Yes | Enables internal modular background jobs. |
| `ORBI_ALLOW_PROCESS_LOCAL_IDEMPOTENCY` | Runtime | Non-secret | No | Yes | Allows unsafe process-local idempotency for debugging only. |
| `ORBI_ENABLE_LEGACY_API_GATEWAY` | Runtime | Non-secret | No | Yes | Re-enables legacy `/api` gateway behavior. |
| `ORBI_ENABLE_LEGACY_BIOMETRIC_ROUTES` | Runtime | Non-secret | No | Yes | Re-enables legacy biometric route aliases. |
| `ORBI_ALLOW_LOCAL_SESSION_FALLBACK` | Runtime | Non-secret | No | Yes | Allows local session fallback for troubleshooting only. |
| `ORBI_ENABLE_SANDBOX_ROUTES` | Runtime | Non-secret | No | Yes | Enables sandbox routes. |
| `ORBI_ENABLE_MESSAGING_TEST_ROUTES` | Runtime | Non-secret | No | Yes | Enables messaging test endpoints. |
| `ORBI_REQUIRE_WEBHOOK_SIGNATURES` | Runtime | Non-secret | No | Yes | Rejects unsigned provider webhook callbacks. |
| `ORBI_PROVIDER_TIMEOUT_MS` | Runtime | Non-secret | No | Yes | Default outbound provider timeout. |
| `ORBI_ALLOW_INSECURE_PROVIDER_URLS` | Runtime | Non-secret | No | Yes | Debug-only flag to allow insecure provider URLs. |
| `ORBI_MAX_QUERY_LENGTH` | Runtime | Non-secret | No | Yes | Maximum allowed API query-string length before request rejection. |
| `ORBI_MAX_QUERY_PARAMS` | Runtime | Non-secret | No | Yes | Maximum allowed API query parameter count before request rejection. |
| `ORBI_REQUIRE_API_CONTENT_TYPE` | Runtime | Non-secret | No | Yes | Requires approved content types for API requests with mutation bodies. |
| `ORBI_REQUIRE_ADMIN_TRACE` | Runtime | Non-secret | No | Yes | Requires `x-orbi-trace` on admin mutations for audit correlation. Defaults on in production. |
| `ORBI_REQUIRE_ADMIN_DEVICE_ID` | Runtime | Non-secret | No | Yes | Requires `x-orbi-device-id` or `x-orbi-fingerprint` on admin mutations when enabled. |
| `ORBI_API_GATEWAY_ENABLED` | Runtime | Non-secret | No | Yes | Enables the in-process ORBI API Gateway security decision layer. |
| `ORBI_API_GATEWAY_FAIL_CLOSED` | Runtime | Non-secret | No | Yes | Blocks protected traffic if the API Gateway security check faults. |
| `ORBI_API_GATEWAY_REDIS_REQUIRED` | Runtime | Non-secret | No | Yes | Requires Redis-backed distributed gateway counters in production. |
| `ORBI_API_GATEWAY_AI_MODE` | Runtime | Non-secret | No | Yes | Selects gateway AI scoring mode. Use `adapter` now; `python` calls the external scorer URL. |
| `ORBI_AI_SECURITY_SCORER_URL` | Runtime | Non-secret | No | Yes | Optional future Python/FastAPI security scorer base URL. |
| `ORBI_AI_SECURITY_SCORER_TIMEOUT_MS` | Runtime | Non-secret | No | Yes | Timeout for the future AI security scorer call before deterministic fallback. |
| `ORBI_WEBHOOK_REPLAY_WINDOW_SECONDS` | Runtime | Non-secret | No | Yes | Webhook replay protection window. |
| `ORBI_ALLOW_PROCESS_LOCAL_WEBHOOK_REPLAY_STORE` | Runtime | Non-secret | No | Yes | Debug-only local replay store fallback. |

## Firebase And Legacy Broker Inputs

| Variable | Type | Secret | In Shared Env | In `.env.example` | Purpose |
| --- | --- | --- | --- | --- | --- |
| `FIREBASE_API_KEY` | Runtime | Secret | No | Yes | Frontend or Firebase web API key in legacy setups. |
| `FIREBASE_AUTH_DOMAIN` | Runtime | Non-secret | No | Yes | Firebase auth domain. |
| `FIREBASE_PROJECT_ID` | Runtime | Non-secret | No | Yes | Firebase project id. |
| `FIREBASE_STORAGE_BUCKET` | Runtime | Non-secret | No | Yes | Firebase storage bucket. |
| `FIREBASE_MESSAGING_SENDER_ID` | Runtime | Non-secret | No | Yes | Firebase messaging sender id. |
| `FIREBASE_APP_ID` | Runtime | Non-secret | No | Yes | Firebase app id. |
| `FIREBASE_MEASUREMENT_ID` | Runtime | Non-secret | No | Yes | Firebase analytics measurement id. |
| `FIREBASE_FIRESTORE_DATABASE_ID` | Runtime | Non-secret | No | Yes | Firestore database identifier. |
| `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` | Runtime | Secret | Yes | Yes | Base64-encoded Firebase service account JSON. |

## Shared Env Only Variables Requiring Review

| Variable | Type | Secret | In Shared Env | In `.env.example` | Purpose |
| --- | --- | --- | --- | --- | --- |
| `NEW_SECRET` | Runtime | Secret | Yes | No | Undocumented shared env variable. Team should confirm owner and purpose. |

## Script-Only Variables Introduced By New Operational Tooling

### Release Smoke Script

| Variable | Type | Secret | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `ORBI_BASE_URL` | Script | Non-secret | Base URL for smoke testing deployed environments. | Usually points to the same host as `BACKEND_URL`. |
| `ORBI_MONITOR_API_KEY` | Runtime, Script | Secret | Dedicated internal monitor token for protected monitor endpoints. | Used by runtime auth middleware and by smoke or load scripts. |
| `ORBI_EXPECT_BROKER_HEALTH` | Script | Non-secret | Forces broker-health validation during smoke tests. | Optional boolean flag. |

### Load Test Script

| Variable | Type | Secret | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `ORBI_BASE_URL` | Script | Non-secret | Base URL for k6 tests. | Reused from smoke test tooling. |
| `ORBI_MONITOR_API_KEY` | Runtime, Script | Secret | Allows k6 to test protected internal monitor endpoints. | Reused from smoke test tooling. |
| `ORBI_VUS` | Script | Non-secret | Number of virtual users for k6. | Optional tuning input. |
| `ORBI_TEST_DURATION` | Script | Non-secret | Test duration for k6. | Optional tuning input. |

### Disaster Recovery Drill Report Script

| Variable | Type | Secret | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `ORBI_DRILL_TYPE` | Script | Non-secret | Drill classification such as `backup_restore`. | Required by report generator. |
| `ORBI_DRILL_ENV` | Script | Non-secret | Environment name for the drill. | Required by report generator. |
| `ORBI_DRILL_OWNER` | Script | Non-secret | Person responsible for the drill. | Required by report generator. |
| `ORBI_DRILL_REVIEWER` | Script | Non-secret | Reviewer or approver for the drill. | Required by report generator. |
| `ORBI_DRILL_STATUS` | Script | Non-secret | Final outcome such as `passed` or `failed`. | Required by report generator. |
| `ORBI_DRILL_SUMMARY` | Script | Non-secret | Short human-readable drill summary. | Required by report generator. |
| `ORBI_DRILL_BACKUP_ID` | Script | Non-secret | Backup identifier used during restore drill. | Optional but strongly recommended. |
| `ORBI_DRILL_BACKUP_TIMESTAMP` | Script | Non-secret | Timestamp of the backup used. | Optional but strongly recommended. |
| `ORBI_DRILL_RESTORE_STARTED_AT` | Script | Non-secret | Timestamp when restore started. | Optional but strongly recommended. |
| `ORBI_DRILL_RESTORE_COMPLETED_AT` | Script | Non-secret | Timestamp when restore completed. | Optional but strongly recommended. |
| `ORBI_DRILL_RECOVERY_TARGET_AT` | Script | Non-secret | PITR target timestamp if applicable. | Optional. |
| `ORBI_DRILL_NOTES` | Script | Non-secret | `||`-separated notes captured in the report. | Optional. |
| `ORBI_DRILL_ACTION_ITEMS` | Script | Non-secret | `||`-separated follow-up tasks. | Optional. |

## Maintenance Recommendations

1. Keep backend runtime variables in `.env.example`.
2. Keep script-only variables documented here rather than adding them all to `.env.example`.
3. Do not store real secret values in docs, examples, or committed env files.
4. Review undocumented variables such as `NEW_SECRET` and either document them properly or remove them.
5. Consider rotating any real secrets that were previously shared in plaintext outside secure secret storage.

