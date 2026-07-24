import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

type OpenApiDocument = {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components: {
    securitySchemes: Record<string, unknown>;
    schemas: Record<string, unknown>;
  };
};

const specPath = join(process.cwd(), 'docs', 'openapi', 'orbi-pay-gateway.openapi.json');
const spec = JSON.parse(readFileSync(specPath, 'utf8')) as OpenApiDocument;

test('openapi spec declares stable gateway contract metadata', () => {
  assert.match(spec.openapi, /^3\.1\./);
  assert.equal(Boolean(spec.paths), true);
  assert.equal(Boolean(spec.components.securitySchemes.ServiceKey), true);
  assert.equal(Boolean(spec.components.securitySchemes.OperatorKey), true);
});

test('openapi spec covers runtime SDK endpoints', () => {
  const requiredRuntimePaths = [
    '/v1/payment-intents',
    '/v1/payment-intents/{intentId}',
    '/v1/payment-intents/{intentId}/confirm',
    '/challenges/{intentId}',
    '/v1/challenges/{intentId}/respond',
    '/v1/paysafe/escrows',
    '/v1/paysafe/escrows/{escrowId}/release',
    '/v1/paysafe/escrows/{escrowId}/refund',
    '/v1/paysafe/escrows/{escrowId}/dispute',
    '/v1/identity/resolve',
    '/v1/business/registrations',
    '/v1/payment-profiles',
    '/v1/consents',
    '/v1/consents/{consentId}',
    '/v1/consents/{consentId}/revoke',
  ];

  for (const path of requiredRuntimePaths) {
    assert.equal(Boolean(spec.paths[path]), true, `${path} missing`);
  }
});

test('openapi spec covers developer control plane endpoints', () => {
  const requiredDeveloperPaths = [
    '/v1/developer/consent-receipts',
    '/v1/developer/consent-receipts/{consentId}',
    '/v1/developer/consent-receipts/{consentId}/revoke',
    '/v1/developer/webhook-deliveries',
    '/v1/developer/webhook-deliveries/{deliveryId}/replay',
    '/v1/developer/integration-health',
    '/v1/developer/docs-catalog',
    '/v1/developer/environment-profiles',
    '/v1/developer/environment-profiles/{environment}',
    '/v1/developer/sandbox-simulator',
    '/v1/developer/sandbox-simulator/state',
    '/v1/developer/sandbox-simulator/reset',
    '/v1/developer/sandbox-simulator/accounts',
    '/v1/developer/sandbox-simulator/transfers',
    '/v1/developer/sandbox-simulator/transfers/{transferId}/webhook-event',
    '/v1/developer/graphql/schema',
    '/v1/developer/graphql/migration-plan',
    '/v1/developer/sdk-catalog',
    '/v1/developer/consent-scopes',
    '/v1/developer/consent-status',
  ];

  for (const path of requiredDeveloperPaths) {
    assert.equal(Boolean(spec.paths[path]), true, `${path} missing`);
  }
});

test('openapi spec exposes SDK-facing response schemas', () => {
  const requiredSchemas = [
    'PaymentIntent',
    'PaymentProfile',
    'ConnectedConsent',
    'ConsentReceipt',
    'ConsentScopeCatalogEntry',
    'ConsentStatusResult',
    'WebhookDeliveryRecord',
    'ApiError',
  ];

  for (const schema of requiredSchemas) {
    assert.equal(Boolean(spec.components.schemas[schema]), true, `${schema} missing`);
  }
});
