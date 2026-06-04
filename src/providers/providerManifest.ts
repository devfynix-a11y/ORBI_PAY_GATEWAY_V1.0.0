import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { config } from '../config.js';
import type { ProviderDefinition } from '../types.js';

const OperationDefinitionSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH']),
  path: z.string().min(1),
  requiresStrongCustomerAuth: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
  idempotencyHeader: z.string().min(1).optional(),
  responseReferenceFields: z.array(z.string().min(1)).optional(),
  responseStatusField: z.string().min(1).optional(),
  responseMessageField: z.string().min(1).optional(),
});

const ProviderDefinitionSchema = z.object({
  code: z.string().min(1).transform((value) => value.trim().toLowerCase()),
  displayName: z.string().min(1),
  rail: z.enum(['MOBILE_MONEY', 'BANK', 'CARD_GATEWAY', 'CRYPTO']),
  protocol: z.enum(['REST_JSON', 'REST_HMAC', 'ISO8583_TCP_TLS', 'SFTP_SETTLEMENT_FILE', 'SDK_PROVIDER', 'VPN_PRIVATE_API']).default('REST_JSON'),
  protocolProfile: z.string().optional(),
  countries: z.array(z.string().min(2)).default([]),
  currencies: z.array(z.string().min(3)).default([]),
  operations: z.array(z.enum(['collection', 'payout', 'refund'])).default([]),
  baseUrlEnv: z.string().min(1),
  credentialTokenRefEnv: z.string().min(1),
  webhookSecretTokenRefEnv: z.string().min(1),
  threeDsProfileIdEnv: z.string().optional(),
  directApiKeyEnv: z.string().optional(),
  directApiSecretEnv: z.string().optional(),
  connection: z.object({
    hostEnv: z.string().optional(),
    portEnv: z.string().optional(),
    mtlsProfileEnv: z.string().optional(),
    vpnProfileEnv: z.string().optional(),
    iso8583ProfileEnv: z.string().optional(),
    sdkProfileEnv: z.string().optional(),
    settlementFileProfileEnv: z.string().optional(),
  }).optional(),
  operationEndpoints: z.object({
    collection: OperationDefinitionSchema.optional(),
    payout: OperationDefinitionSchema.optional(),
    refund: OperationDefinitionSchema.optional(),
  }).optional(),
  webhookStatusField: z.string().optional(),
  webhookReferenceFields: z.array(z.string()).optional(),
  webhookEventIdFields: z.array(z.string()).optional(),
  webhookSignature: z.object({
    algorithm: z.enum(['sha256', 'sha512']),
    signatureHeader: z.string().min(1),
    timestampHeader: z.string().min(1).optional(),
    toleranceSeconds: z.number().int().positive().optional(),
    signedPayloadFormat: z.enum(['raw', 'timestamp.raw']).optional(),
  }).optional(),
}).superRefine((provider, ctx) => {
  for (const operation of provider.operations) {
    if (!provider.operationEndpoints?.[operation]) {
      ctx.addIssue({
        code: 'custom',
        path: ['operationEndpoints', operation],
        message: `Provider ${provider.code} declares ${operation} but does not map its endpoint.`,
      });
    }
  }

  if (provider.protocol === 'ISO8583_TCP_TLS') {
    const missing = [
      ['connection.hostEnv', provider.connection?.hostEnv],
      ['connection.portEnv', provider.connection?.portEnv],
      ['connection.mtlsProfileEnv', provider.connection?.mtlsProfileEnv],
      ['connection.iso8583ProfileEnv', provider.connection?.iso8583ProfileEnv],
    ].filter(([, value]) => !value);

    for (const [pathName] of missing as Array<[string, unknown]>) {
      ctx.addIssue({
        code: 'custom',
        path: pathName.split('.'),
        message: `ISO8583 provider ${provider.code} requires ${pathName}.`,
      });
    }
  }

  if (provider.protocol === 'SFTP_SETTLEMENT_FILE' && !provider.connection?.settlementFileProfileEnv) {
    ctx.addIssue({
      code: 'custom',
      path: ['connection', 'settlementFileProfileEnv'],
      message: `SFTP provider ${provider.code} requires a settlement file profile env reference.`,
    });
  }

  if (provider.protocol === 'VPN_PRIVATE_API') {
    const hasPrivateNetwork = provider.connection?.vpnProfileEnv || provider.connection?.mtlsProfileEnv;
    if (!hasPrivateNetwork) {
      ctx.addIssue({
        code: 'custom',
        path: ['connection'],
        message: `VPN/private API provider ${provider.code} requires vpnProfileEnv or mtlsProfileEnv.`,
      });
    }
  }
});

const ProviderManifestSchema = z.object({
  providers: z.array(ProviderDefinitionSchema),
});

const readManifestPayload = () => {
  const inline = process.env.PAYMENT_GATEWAY_PROVIDER_MANIFEST_JSON?.trim();
  if (inline) return inline;

  const manifestPath = path.resolve(process.cwd(), config.providerManifestPath);
  if (!fs.existsSync(manifestPath)) return JSON.stringify({ providers: [] });
  return fs.readFileSync(manifestPath, 'utf8');
};

export const loadProviderManifest = (): ProviderDefinition[] => {
  const parsedJson = JSON.parse(readManifestPayload());
  const parsed = ProviderManifestSchema.parse(parsedJson);
  const seen = new Set<string>();

  for (const provider of parsed.providers) {
    if (seen.has(provider.code)) {
      throw new Error(`DUPLICATE_PAYMENT_PROVIDER_CODE:${provider.code}`);
    }
    seen.add(provider.code);
  }

  return parsed.providers as ProviderDefinition[];
};
