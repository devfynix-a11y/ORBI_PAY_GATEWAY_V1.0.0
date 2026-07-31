import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.js';
import {
  issueFinancialAccessToken,
  verifyFinancialAccessToken,
} from '../src/security/financialAccessToken.js';
import {
  ACCESS_TOKEN_TYPE,
  FinancialTokenExchangeService,
} from '../src/services/financialTokenExchange.js';
import { ConsentReceiptStore } from '../src/services/consentReceiptStore.js';
import { ServiceAccessTokenRevocationStore } from '../src/services/serviceAccessTokenRevocationStore.js';

const identity = {
  subject: 'user_oidc_001',
  issuer: 'https://auth.orbifinancial.com/realms/orbi',
  audience: ['orbi-core'],
  sessionId: 'session_001',
  claims: {},
};

const consentInput = {
  serviceCode: 'orbi-shop',
  environment: 'live' as const,
  subjectType: 'user' as const,
  subjectId: identity.subject,
  scopes: ['payments:create' as const, 'balance:read' as const],
  purpose: 'Allow ORBI Shop to create authorized customer payments.',
  expiresAt: '2027-07-31T00:00:00.000Z',
  context: {
    locale: 'en' as const,
    timezone: 'UTC',
    channel: 'hosted_challenge' as const,
  },
  evidence: {
    consentTextVersion: 'token-exchange-v1',
    challengeType: 'OIDC' as const,
    acceptedAt: '2026-07-31T00:00:00.000Z',
    evidenceHash: 'token_exchange_evidence_hash_001',
  },
};

test('financial token exchange binds identity, client, audience, scopes, environment, and consent', async () => {
  config.security.serviceAccessTokenSecret = 'financial-token-exchange-unit-secret';
  config.security.financialTokenAudience = 'orbi-pay-api';
  const store = ConsentReceiptStore.inMemory();
  const consent = await store.create(consentInput);
  const service = new FinancialTokenExchangeService(
    { verify: async () => identity },
    store,
  );
  const issued = await service.exchange({
    subjectToken: 'valid-oidc-token',
    subjectTokenType: ACCESS_TOKEN_TYPE,
    audience: 'orbi-pay-api',
    scopes: ['payments:create'],
    consentId: consent.consentId,
    serviceCode: 'orbi-shop',
    keyId: 'key_live_001',
    fingerprint: 'abcdef1234567890abcdef12',
    environment: 'live',
    grantedScopes: ['payments:create', 'balance:read'],
  });

  const claims = verifyFinancialAccessToken(issued.accessToken);
  assert.equal(claims.sub, identity.subject);
  assert.equal(claims.azp, 'orbi-shop');
  assert.equal(claims.aud, 'orbi-pay-api');
  assert.equal(claims.consentId, consent.consentId);
  assert.equal(claims.identitySessionId, 'session_001');
  assert.deepEqual(claims.scopes, ['payments:create']);
});

test('financial token exchange rejects subject, scope, environment, and audience mismatch', async () => {
  config.security.serviceAccessTokenSecret = 'financial-token-exchange-unit-secret';
  config.security.financialTokenAudience = 'orbi-pay-api';
  const store = ConsentReceiptStore.inMemory();
  const consent = await store.create(consentInput);
  const base = {
    subjectToken: 'valid-oidc-token',
    subjectTokenType: ACCESS_TOKEN_TYPE,
    audience: 'orbi-pay-api',
    scopes: ['payments:create'],
    consentId: consent.consentId,
    serviceCode: 'orbi-shop',
    keyId: 'key_live_001',
    fingerprint: 'abcdef1234567890abcdef12',
    environment: 'live' as const,
    grantedScopes: ['payments:create', 'balance:read'],
  };

  await assert.rejects(
    () => new FinancialTokenExchangeService(
      { verify: async () => ({ ...identity, subject: 'different-user' }) },
      store,
    ).exchange(base),
    /CONSENT_SUBJECT_MISMATCH/,
  );
  await assert.rejects(
    () => new FinancialTokenExchangeService({ verify: async () => identity }, store)
      .exchange({ ...base, scopes: ['escrow:create'], grantedScopes: ['escrow:create'] }),
    /CONSENT_SCOPE_MISMATCH/,
  );
  await assert.rejects(
    () => new FinancialTokenExchangeService({ verify: async () => identity }, store)
      .exchange({ ...base, environment: 'sandbox' }),
    /CONSENT_ENVIRONMENT_MISMATCH/,
  );
  await assert.rejects(
    () => new FinancialTokenExchangeService({ verify: async () => identity }, store)
      .exchange({ ...base, audience: 'wrong-api' }),
    /OAUTH_AUDIENCE_INVALID/,
  );
});

test('financial access token rejects tampering', () => {
  config.security.serviceAccessTokenSecret = 'financial-token-exchange-unit-secret';
  config.security.financialTokenAudience = 'orbi-pay-api';
  const issued = issueFinancialAccessToken({
    subject: identity.subject,
    serviceCode: 'orbi-shop',
    keyId: 'key_live_001',
    fingerprint: 'abcdef1234567890abcdef12',
    environment: 'live',
    scopes: ['payments:create'],
    consentId: 'consent_001',
    identityIssuer: identity.issuer,
  });
  assert.throws(
    () => verifyFinancialAccessToken(`${issued.accessToken}tampered`),
    /FINANCIAL_ACCESS_TOKEN_INVALID/,
  );
});

test('financial access token revocation is enforced immediately', async () => {
  config.security.serviceAccessTokenSecret = 'financial-token-revocation-unit-secret';
  config.security.financialTokenAudience = 'orbi-pay-api';
  const issued = issueFinancialAccessToken({
    subject: identity.subject,
    serviceCode: 'orbi-shop',
    keyId: 'key_live_revoke',
    fingerprint: 'abcdef1234567890abcdef12',
    environment: 'live',
    scopes: ['payments:create'],
    consentId: 'consent_revoke_001',
    identityIssuer: identity.issuer,
  });
  const store = ServiceAccessTokenRevocationStore.inMemory();
  await store.recordRevocation({
    claims: issued.claims,
    revokedBy: 'orbi-shop',
    reason: 'Verify immediate financial access token revocation.',
  });
  assert.throws(
    () => verifyFinancialAccessToken(issued.accessToken),
    /FINANCIAL_ACCESS_TOKEN_REVOKED/,
  );
});
