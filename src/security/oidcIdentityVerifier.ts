import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
} from 'jose';
import { config } from '../config.js';

export type VerifiedOidcIdentity = {
  subject: string;
  issuer: string;
  audience: string[];
  sessionId?: string;
  authenticatedAt?: number;
  claims: JWTPayload;
};

export type OidcIdentityVerifierOptions = {
  issuer?: string;
  audience?: string;
};

export class OidcIdentityVerifier {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly jwks;

  constructor(options: OidcIdentityVerifierOptions = {}) {
    this.issuer = String(options.issuer ?? config.security.oidcIdentityIssuer).replace(/\/+$/, '');
    this.audience = String(options.audience ?? config.security.oidcIdentityAudience).trim();
    if (!this.issuer || !this.audience) throw new Error('OIDC_IDENTITY_CONFIGURATION_REQUIRED');
    if (!this.issuer.startsWith('https://') && config.env === 'production') {
      throw new Error('OIDC_IDENTITY_ISSUER_HTTPS_REQUIRED');
    }
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/protocol/openid-connect/certs`), {
      cooldownDuration: 30_000,
      timeoutDuration: 5_000,
    });
  }

  async verify(subjectToken: string): Promise<VerifiedOidcIdentity> {
    try {
      const { payload, protectedHeader } = await jwtVerify(subjectToken, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['RS256'],
        clockTolerance: 5,
        maxTokenAge: '10m',
      });
      if (protectedHeader.typ && protectedHeader.typ !== 'JWT' && protectedHeader.typ !== 'at+jwt') {
        throw new Error('OIDC_SUBJECT_TOKEN_TYPE_INVALID');
      }
      if (!payload.sub) throw new Error('OIDC_SUBJECT_REQUIRED');
      const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
      return {
        subject: payload.sub,
        issuer: payload.iss || this.issuer,
        audience: audiences,
        sessionId: typeof payload.sid === 'string' ? payload.sid : undefined,
        authenticatedAt: typeof payload.auth_time === 'number' ? payload.auth_time : undefined,
        claims: payload,
      };
    } catch (error: any) {
      if (String(error?.message || '').startsWith('OIDC_')) throw error;
      throw new Error('OIDC_SUBJECT_TOKEN_INVALID');
    }
  }
}

let verifier: OidcIdentityVerifier | undefined;

export const oidcIdentityVerifier = () => {
  verifier ||= new OidcIdentityVerifier();
  return verifier;
};
