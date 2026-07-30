import crypto from 'crypto';
import fs from 'fs';
import { Pool, type PoolClient } from 'pg';
import { config } from '../config.js';
import { encryptSecret } from '../security/secretVaultCrypto.js';
import { resolveTokenSecret } from '../security/tokenResolver.js';
import type { PayServiceDefinition, PayServiceOperation } from '../types.js';

type PayServiceManifest = {
  services?: PayServiceDefinition[];
};

const fingerprint = (secret: string): string =>
  crypto.createHash('sha256').update(secret).digest('hex').slice(0, 24);

const slug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const environmentFromKey = (secret: string): 'sandbox' | 'live' =>
  secret.startsWith('orbi_sandbox_') ? 'sandbox' : 'live';

const scopesForOperations = (operations: PayServiceOperation[]): string[] => {
  const scopes = new Set<string>();
  if (operations.some((operation) => ['collection', 'refund'].includes(operation))) {
    scopes.add('payments:create');
  }
  if (operations.includes('payout')) scopes.add('withdrawal:request');
  if (operations.includes('paysafe' as PayServiceOperation)) {
    scopes.add('escrow:create');
    scopes.add('escrow:read');
    scopes.add('escrow:release:request');
    scopes.add('escrow:refund:request');
    scopes.add('escrow:dispute:create');
  }
  scopes.add('webhooks:receive');
  return [...scopes];
};

const loadManifest = (): PayServiceManifest => {
  if (!fs.existsSync(config.serviceRegistryPath)) {
    throw new Error(`SERVICE_REGISTRY_NOT_FOUND:${config.serviceRegistryPath}`);
  }
  return JSON.parse(fs.readFileSync(config.serviceRegistryPath, 'utf8')) as PayServiceManifest;
};

const requiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`ENV_REQUIRED:${name}`);
  return value;
};

const migrate = async () => {
  if (!config.databaseUrl) throw new Error('DATABASE_URL_REQUIRED');
  if (!config.secretEncryptionKey) throw new Error('ORBI_SECRET_ENCRYPTION_KEY_REQUIRED');

  const manifest = loadManifest();
  const services = (manifest.services || []).filter((service) => service.status === 'ACTIVE');
  const pool = new Pool({ connectionString: config.databaseUrl });

  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    for (const service of services) {
      const serviceCode = slug(service.code);
      const apiKeyTokenRef = requiredEnv(service.apiKeyTokenRefEnv);
      const webhookSecretTokenRef = requiredEnv(service.webhookSecretTokenRefEnv);
      const apiKey = resolveTokenSecret(apiKeyTokenRef);
      const webhookSecret = resolveTokenSecret(webhookSecretTokenRef);
      const environment = environmentFromKey(apiKey);
      const callbackUrl = requiredEnv(service.callbackUrlEnv);
      const now = new Date().toISOString();

      await client.query('begin');
      await client.query(
        `insert into public.pay_gateway_developer_services (
          service_code, display_name, legal_name, business_type, country_code,
          contact_email, contact_phone, status, environments, scopes_granted,
          scopes_pending, browser_origins, redirect_urls, webhook_urls,
          external_developer_id, metadata, created_at, updated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        on conflict (service_code) do update set
          display_name = excluded.display_name,
          business_type = excluded.business_type,
          country_code = excluded.country_code,
          status = excluded.status,
          environments = excluded.environments,
          scopes_granted = excluded.scopes_granted,
          browser_origins = excluded.browser_origins,
          webhook_urls = excluded.webhook_urls,
          metadata = excluded.metadata,
          updated_at = excluded.updated_at`,
        [
          serviceCode,
          service.displayName,
          service.displayName,
          'merchant',
          service.allowedCountries?.[0] || 'TZ',
          null,
          null,
          'active',
          [environment],
          scopesForOperations(service.allowedOperations),
          [],
          [],
          [],
          [callbackUrl],
          `service-registry:${serviceCode}`,
          {
            source: 'service_registry_migration',
            migratedAt: now,
            registryMetadata: service.metadata || {},
            merchant: service.merchant || null,
            allowedOperations: service.allowedOperations,
            allowedCurrencies: service.allowedCurrencies,
            allowedCountries: service.allowedCountries || [],
          },
          now,
          now,
        ],
      );

      await client.query(
        `insert into public.pay_gateway_developer_api_keys (
          key_id, service_code, environment, fingerprint, status,
          issued_at, issued_by, metadata
        ) values ($1,$2,$3,$4,$5,$6,$7,$8)
        on conflict (fingerprint) do update set
          service_code = excluded.service_code,
          environment = excluded.environment,
          status = excluded.status,
          metadata = excluded.metadata`,
        [
          `key_${serviceCode}_${environment}_service_registry`,
          serviceCode,
          environment,
          fingerprint(apiKey),
          'active',
          now,
          'service-registry-migration',
          { source: 'service_registry_migration' },
        ],
      );

      await client.query(
        `insert into public.pay_gateway_developer_webhook_secrets (
          secret_id, service_code, environment, fingerprint, encrypted_secret,
          status, issued_at, issued_by, metadata
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        on conflict (fingerprint) do update set
          service_code = excluded.service_code,
          environment = excluded.environment,
          encrypted_secret = excluded.encrypted_secret,
          status = excluded.status,
          metadata = excluded.metadata`,
        [
          `whsec_${serviceCode}_${environment}_service_registry`,
          serviceCode,
          environment,
          fingerprint(webhookSecret),
          encryptSecret(webhookSecret),
          'active',
          now,
          'service-registry-migration',
          { source: 'service_registry_migration' },
        ],
      );

      await client.query(
        `insert into public.pay_gateway_developer_secret_events (
          event_id, service_code, environment, event_type, actor_name, metadata, occurred_at
        ) values ($1,$2,$3,$4,$5,$6,$7)
        on conflict (event_id) do nothing`,
        [
          `dev_evt_${crypto.randomUUID()}`,
          serviceCode,
          environment,
          'developer.service_registry_secrets.migrated',
          'ORBI Pay Gateway',
          { serviceCode, callbackUrl },
          now,
        ],
      );
      await client.query('commit');

      console.log(`Migrated ${serviceCode} secrets to database (${environment}).`);
    }
  } catch (error) {
    if (client) await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
};

migrate().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
