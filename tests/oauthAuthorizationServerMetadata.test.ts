import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOAuthAuthorizationServerMetadata } from '../src/security/oauthAuthorizationServerMetadata.js';

test('OAuth authorization server metadata supports opaque token introspection mode', () => {
  const metadata = buildOAuthAuthorizationServerMetadata({
    issuer: 'https://pay.orbifinancial.com/',
    financialTokenAudience: 'orbi-pay-api',
  });

  assert.equal(metadata.issuer, 'https://pay.orbifinancial.com');
  assert.equal(metadata.introspection_endpoint, 'https://pay.orbifinancial.com/oauth/introspect');
  assert.equal(metadata.revocation_endpoint, 'https://pay.orbifinancial.com/oauth/revoke');
  assert.equal(Object.hasOwn(metadata, 'jwks_uri'), false);
});

test('OAuth authorization server metadata publishes jwks_uri only when configured', () => {
  const metadata = buildOAuthAuthorizationServerMetadata({
    issuer: 'https://pay.orbifinancial.com',
    jwksUri: 'https://pay.orbifinancial.com/.well-known/jwks.json',
    financialTokenAudience: 'orbi-pay-api',
  });

  assert.equal(metadata.jwks_uri, 'https://pay.orbifinancial.com/.well-known/jwks.json');
  assert.equal(metadata.token_endpoint_auth_methods_supported.includes('private_key_jwt'), true);
});
