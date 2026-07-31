# OAuth 2.1 And OIDC Stage 1 Design

## Authority Boundary

```text
Keycloak / auth.orbifinancial.com
  authenticates the person
  issues RS256 OIDC identity assertion

ORBI Pay Gateway
  authenticates the developer client
  verifies the identity assertion through issuer JWKS
  verifies active financial consent
  issues short-lived consent-bound financial access token
```

Gateway must not collect or validate the customer's Keycloak password.
Keycloak tokens must not be accepted as financial permission by themselves.

## Delivery Sub-phases

### 1A. OIDC trust

- configure exact issuer and audience;
- fetch discovery and JWKS over HTTPS;
- accept only configured asymmetric algorithms;
- validate issuer, audience, signature, expiry, not-before, and subject;
- fail startup/readiness when live trust configuration is incomplete.

### 1B. Database consent authority

Status: complete

- [x] move consent receipts from local files to Postgres;
- [x] preserve immutable grant evidence and revocation history;
- [x] bind consent to subject, client/service, environment, scopes, purpose,
  and expiry;
- [x] make revocation authoritative across all Gateway replicas.

Evidence:

- `database/migrations/001_pay_gateway_consent_authority.sql`;
- `npm run consent:readiness`;
- automated consent, hosted challenge, and service consent guard tests.

### 1C. Financial token exchange

Proposed request:

```http
POST /oauth/token
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/x-www-form-urlencoded
```

```text
grant_type=urn:ietf:params:oauth:grant-type:token-exchange
subject_token=<Keycloak access token>
subject_token_type=urn:ietf:params:oauth:token-type:access_token
scope=balances:read payments:create
consent_id=consent_...
audience=orbi-pay-api
```

Gateway verifies the developer credential, OIDC subject token, requested
audience, approved service scopes, active consent, environment, and risk
policy. The resulting access token includes:

```json
{
  "sub": "customer-subject",
  "azp": "developer-service-code",
  "aud": "orbi-pay-api",
  "scope": "balances:read payments:create",
  "consent_id": "consent_...",
  "environment": "live"
}
```

### 1D. Authorization code and PKCE

Browser/mobile integrations use the Keycloak authorization-code flow with
PKCE `S256`. ORBI hosted consent receives the verified identity result and
creates a one-time financial authorization code. Redirect URIs must match the
approved URI byte-for-byte.

### 1E. Refresh token rotation

- store only refresh-token hashes;
- rotate on every successful refresh;
- track token families;
- revoke the full family on reuse;
- revoke on consent withdrawal, client suspension, logout, or risk action.

## Fail-Closed Rules

- no OIDC issuer fallback in live;
- no `none`, HS256, or caller-selected signing algorithm for identity tokens;
- no wildcard redirect URI;
- no financial token without active consent;
- no scope elevation during exchange or refresh;
- no sandbox identity, client, consent, or token accepted in live;
- no local JSON consent store for production token exchange.

## Stage 1 Acceptance Evidence

- OIDC discovery and JWKS readiness report;
- invalid signature/issuer/audience/expiry tests;
- PKCE verifier and one-time-code tests;
- redirect URI exact-match tests;
- consent-bound token tests;
- refresh rotation and reuse-detection tests;
- revocation propagation test across process restart;
- OpenAPI, SDK, runbook, and operator audit examples.
