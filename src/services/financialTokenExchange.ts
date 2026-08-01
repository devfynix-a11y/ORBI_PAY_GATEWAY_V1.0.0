import { config } from '../config.js';
import { issueFinancialAccessToken } from '../security/financialAccessToken.js';
import type { VerifiedOidcIdentity } from '../security/oidcIdentityVerifier.js';
import type { ConsentReceiptStore } from './consentReceiptStore.js';

export const TOKEN_EXCHANGE_GRANT_TYPE =
  'urn:ietf:params:oauth:grant-type:token-exchange';
export const ACCESS_TOKEN_TYPE =
  'urn:ietf:params:oauth:token-type:access_token';

type IdentityVerifier = {
  verify(subjectToken: string): Promise<VerifiedOidcIdentity>;
};

export class FinancialTokenExchangeService {
  constructor(
    private readonly identityVerifier: IdentityVerifier,
    private readonly consentStore: Pick<ConsentReceiptStore, 'get'>,
  ) {}

  async exchange(input: {
    subjectToken: string;
    subjectTokenType: string;
    requestedTokenType?: string;
    audience: string;
    scopes: string[];
    consentId: string;
    serviceCode: string;
    keyId: string;
    fingerprint: string;
    environment: 'sandbox' | 'live';
    grantedScopes: string[];
    cnfJkt?: string;
  }) {
    if (input.subjectTokenType !== ACCESS_TOKEN_TYPE) {
      throw new Error('OAUTH_SUBJECT_TOKEN_TYPE_UNSUPPORTED');
    }
    if (input.requestedTokenType && input.requestedTokenType !== ACCESS_TOKEN_TYPE) {
      throw new Error('OAUTH_REQUESTED_TOKEN_TYPE_UNSUPPORTED');
    }
    if (input.audience !== config.security.financialTokenAudience) {
      throw new Error('OAUTH_AUDIENCE_INVALID');
    }
    const scopes = [...new Set(input.scopes.map((scope) => scope.trim()).filter(Boolean))];
    if (!scopes.length || scopes.some((scope) => !input.grantedScopes.includes(scope))) {
      throw new Error('PAY_SERVICE_SCOPE_NOT_GRANTED');
    }

    const identity = await this.identityVerifier.verify(input.subjectToken);
    const consent = await this.consentStore.get(input.consentId);
    if (consent.status !== 'active') throw new Error('CONSENT_REQUIRED');
    if (consent.serviceCode !== input.serviceCode) throw new Error('CONSENT_CLIENT_MISMATCH');
    if (consent.environment !== input.environment) throw new Error('CONSENT_ENVIRONMENT_MISMATCH');
    if (consent.subjectId !== identity.subject && consent.externalSubjectId !== identity.subject) {
      throw new Error('CONSENT_SUBJECT_MISMATCH');
    }
    if (scopes.some((scope) => !consent.scopes.includes(scope as never))) {
      throw new Error('CONSENT_SCOPE_MISMATCH');
    }

    return issueFinancialAccessToken({
      subject: identity.subject,
      serviceCode: input.serviceCode,
      keyId: input.keyId,
      fingerprint: input.fingerprint,
      environment: input.environment,
      scopes,
      consentId: consent.consentId,
      identityIssuer: identity.issuer,
      identitySessionId: identity.sessionId,
      audience: input.audience,
      cnfJkt: input.cnfJkt,
    });
  }
}
