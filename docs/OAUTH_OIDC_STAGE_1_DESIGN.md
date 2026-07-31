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

Status: complete

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

Implementation evidence:

- strict RS256 OIDC verification through remote issuer JWKS;
- RFC 8693 token-exchange grant on `/oauth/token`;
- distinct `orbi_ft_` financial token namespace;
- subject, authorized party, audience, environment, scope, key, identity
  issuer, session, and consent binding;
- active consent and subject revalidation on every runtime request;
- positive, mismatch, invalid audience, invalid signature, and tampering tests.

### 1D. Authorization code and PKCE

Browser/mobile integrations use the Keycloak authorization-code flow with
PKCE `S256`. ORBI hosted consent receives the verified identity result and
creates a one-time financial authorization code. Redirect URIs must match the
approved URI byte-for-byte.

Implemented controls:

- `GET /oauth/authorize` accepts only `response_type=code` and PKCE `S256`;
- the client must be active in the current trust zone and every requested
  scope must already be granted;
- redirect URIs use exact string matching against the approved service record;
- ORBI Identity performs authentication; merchant-provided identity headers
  and query values are never trusted;
- upstream state, nonce, and PKCE verifier are server-generated, short-lived,
  and stored encrypted at rest;
- the hosted ORBI consent screen creates durable consent evidence before a
  financial authorization code is issued;
- authorization codes are random, stored only as SHA-256 hashes, expire after
  two minutes, and are consumed atomically once;
- `POST /oauth/token` with `grant_type=authorization_code` verifies the exact
  redirect URI and the original PKCE verifier before issuing a short-lived,
  consent-bound `orbi_ft_` token.

### 1E. Refresh token rotation

Implemented controls:

- only SHA-256 refresh-token hashes are stored; plaintext tokens are returned
  once and never logged or persisted;
- every successful refresh atomically consumes the presented token and issues
  a different token in the same family;
- replay of a consumed token revokes the complete family and every unexpired
  financial access token issued from that family;
- client, environment, subject, consent, scopes, and identity issuer remain
  bound for the complete family lifetime;
- active consent, service status, active client key, and scopes are revalidated
  before every refreshed access token is issued;
- consent withdrawal and service suspension/archive revoke related families;
- RFC 7009 `/oauth/revoke` accepts a refresh token from its authenticated
  owning client and revokes the family;
- rotating tokens expire after 30 days and a family has a non-extendable
  90-day maximum lifetime by default.

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
