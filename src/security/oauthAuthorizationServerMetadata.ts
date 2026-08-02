import { DeveloperScopeSchema } from '../contracts/developerPortalContract.js';

export type OAuthAuthorizationServerMetadataInput = {
  issuer: string;
  jwksUri?: string;
  financialTokenAudience: string;
};

export const buildOAuthAuthorizationServerMetadata = (input: OAuthAuthorizationServerMetadataInput) => {
  const issuer = input.issuer.replace(/\/+$/, '');
  const jwksUri = String(input.jwksUri || '').trim();

  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    pushed_authorization_request_endpoint: `${issuer}/oauth/par`,
    token_endpoint: `${issuer}/oauth/token`,
    introspection_endpoint: `${issuer}/oauth/introspect`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    ...(jwksUri ? { jwks_uri: jwksUri } : {}),
    service_documentation: `${issuer}/docs`,
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials', 'urn:ietf:params:oauth:grant-type:token-exchange'],
    subject_token_types_supported: ['urn:ietf:params:oauth:token-type:access_token'],
    requested_token_types_supported: ['urn:ietf:params:oauth:token-type:access_token'],
    audiences_supported: [input.financialTokenAudience],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'private_key_jwt'],
    revocation_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'private_key_jwt'],
    introspection_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'private_key_jwt'],
    scopes_supported: DeveloperScopeSchema.options,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    require_pushed_authorization_requests: false,
    token_endpoint_auth_signing_alg_values_supported: ['RS256', 'PS256', 'ES256'],
    dpop_signing_alg_values_supported: ['ES256', 'RS256', 'PS256'],
  };
};
