import { z } from 'zod';
import { ApiSuccessResponseSchema } from './platformContract.js';
import { isProductionBrowserOrigin, isProductionPublicHttpsUrl } from '../security/runtimeControls.js';

export const DeveloperPortalEnvironmentSchema = z.enum(['sandbox', 'live']);

export const DeveloperBusinessTypeSchema = z.enum([
  'merchant',
  'marketplace',
  'organization',
  'saccos',
  'agent_network',
  'platform',
  'internal',
]);

export const DeveloperServiceStatusSchema = z.enum([
  'draft',
  'pending_review',
  'active',
  'suspended',
  'rejected',
  'archived',
]);

export const DeveloperScopeSchema = z.enum([
  'identity:resolve',
  'business_registration:create',
  'user:provision',
  'payment_profile:create',
  'payment_profile:read',
  'payments:create',
  'escrow:create',
  'escrow:read',
  'escrow:release:request',
  'escrow:refund:request',
  'escrow:dispute:create',
  'withdrawal:request',
  'balance:read',
  'webhooks:receive',
]);

export const UrlAllowlistSchema = z
  .array(z.string().url())
  .max(25)
  .default([]);

export const OriginAllowlistSchema = z
  .array(z.string().url())
  .max(25)
  .default([])
  .transform((items) =>
    items.map((item) => {
      const url = new URL(item);
      return `${url.protocol}//${url.host}`;
    }),
  );

export const DeveloperServiceApplicationSchema = z
  .object({
    externalDeveloperId: z.string().trim().min(1).max(160).optional(),
    legalName: z.string().trim().min(2).max(180),
    displayName: z.string().trim().min(2).max(120),
    contactEmail: z.string().trim().email(),
    contactPhone: z.string().trim().min(6).max(40).optional(),
    businessType: DeveloperBusinessTypeSchema,
    countryCode: z.string().trim().min(2).max(3),
    requestedEnvironments: z.array(DeveloperPortalEnvironmentSchema).min(1).max(2),
    requestedScopes: z.array(DeveloperScopeSchema).min(1).max(20),
    browserOrigins: OriginAllowlistSchema,
    redirectUrls: UrlAllowlistSchema,
    webhookUrls: UrlAllowlistSchema,
    useCases: z.array(z.string().trim().min(3).max(240)).min(1).max(12),
    supportEmail: z.string().trim().email().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    termsAccepted: z.literal(true),
  })
  .superRefine((value, ctx) => {
    if (!value.requestedEnvironments.includes('live')) return;
    value.browserOrigins.forEach((origin, index) => {
      if (isProductionBrowserOrigin(origin)) return;
      ctx.addIssue({
        code: 'custom',
        message: 'Live browser origins must use public HTTPS domains. Localhost, private IPs, and wildcards are sandbox-only.',
        path: ['browserOrigins', index],
      });
    });
    value.redirectUrls.forEach((url, index) => {
      if (isProductionPublicHttpsUrl(url)) return;
      ctx.addIssue({
        code: 'custom',
        message: 'Live redirect URLs must use public HTTPS domains. Localhost, private IPs, plain HTTP, and wildcards are sandbox-only.',
        path: ['redirectUrls', index],
      });
    });
    value.webhookUrls.forEach((url, index) => {
      if (isProductionPublicHttpsUrl(url)) return;
      ctx.addIssue({
        code: 'custom',
        message: 'Live webhook URLs must use public HTTPS domains. Localhost, private IPs, plain HTTP, and wildcards are sandbox-only.',
        path: ['webhookUrls', index],
      });
    });
  });

export const DeveloperServiceRecordSchema = z
  .object({
    serviceCode: z.string().trim().min(2).max(80),
    displayName: z.string().trim().min(2).max(120),
    status: DeveloperServiceStatusSchema,
    environments: z.array(DeveloperPortalEnvironmentSchema).min(1),
    scopesGranted: z.array(DeveloperScopeSchema),
    scopesPending: z.array(DeveloperScopeSchema).default([]),
    browserOrigins: OriginAllowlistSchema,
    redirectUrls: UrlAllowlistSchema,
    webhookUrls: UrlAllowlistSchema,
    keyStatus: z.enum(['not_issued', 'active', 'rotation_pending', 'revoked']),
    webhookSecretStatus: z.enum(['not_issued', 'active', 'rotation_pending', 'revoked']),
    keys: z
      .array(z.object({
        keyId: z.string().min(1),
        environment: DeveloperPortalEnvironmentSchema,
        status: z.enum(['active', 'pending_cutover', 'revoked']),
        fingerprint: z.string().min(8),
        issuedAt: z.string().min(1),
        expiresAt: z.string().min(1).optional(),
        revokedAt: z.string().min(1).optional(),
      }))
      .default([]),
    webhookSecrets: z
      .array(z.object({
        secretId: z.string().min(1),
        environment: DeveloperPortalEnvironmentSchema,
        status: z.enum(['active', 'pending_cutover', 'revoked']),
        fingerprint: z.string().min(8),
        issuedAt: z.string().min(1),
        expiresAt: z.string().min(1).optional(),
        revokedAt: z.string().min(1).optional(),
      }))
      .default([]),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    ownerPortalUserId: z.string().trim().min(1).optional(),
    ownerEmail: z.string().trim().email().optional(),
  })
  .passthrough();

export const DeveloperServiceProfileResponseSchema = ApiSuccessResponseSchema(DeveloperServiceRecordSchema);

export const DeveloperScopeRequestSchema = z.object({
  requestedScopes: z.array(DeveloperScopeSchema).min(1).max(20),
  reason: z.string().trim().min(10).max(1000),
  environment: DeveloperPortalEnvironmentSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const DeveloperScopeDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(10).max(1000),
  decidedBy: z.string().trim().min(3).max(180),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const DeveloperServiceStatusUpdateSchema = z.object({
  status: z.enum(['draft', 'active', 'suspended', 'archived']),
  reason: z.string().trim().min(10).max(1000),
  decidedBy: z.string().trim().min(3).max(180),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const DeveloperAllowlistUpdateSchema = z
  .object({
    browserOrigins: OriginAllowlistSchema.optional(),
    redirectUrls: UrlAllowlistSchema.optional(),
    webhookUrls: UrlAllowlistSchema.optional(),
    reason: z.string().trim().min(10).max(1000),
    environment: DeveloperPortalEnvironmentSchema,
  })
  .refine((value) => Boolean(value.browserOrigins?.length || value.redirectUrls?.length || value.webhookUrls?.length), {
    message: 'Provide at least one browser origin, redirect URL, or webhook URL.',
    path: ['browserOrigins'],
  })
  .superRefine((value, ctx) => {
    if (value.environment !== 'live') return;
    value.browserOrigins?.forEach((origin, index) => {
      if (isProductionBrowserOrigin(origin)) return;
      ctx.addIssue({
        code: 'custom',
        message: 'Live browser origins must use public HTTPS domains. Localhost, private IPs, and wildcards are sandbox-only.',
        path: ['browserOrigins', index],
      });
    });
    value.redirectUrls?.forEach((url, index) => {
      if (isProductionPublicHttpsUrl(url)) return;
      ctx.addIssue({
        code: 'custom',
        message: 'Live redirect URLs must use public HTTPS domains. Localhost, private IPs, plain HTTP, and wildcards are sandbox-only.',
        path: ['redirectUrls', index],
      });
    });
    value.webhookUrls?.forEach((url, index) => {
      if (isProductionPublicHttpsUrl(url)) return;
      ctx.addIssue({
        code: 'custom',
        message: 'Live webhook URLs must use public HTTPS domains. Localhost, private IPs, plain HTTP, and wildcards are sandbox-only.',
        path: ['webhookUrls', index],
      });
    });
  });

export const DeveloperApiKeyRotationRequestSchema = z.object({
  environment: DeveloperPortalEnvironmentSchema,
  currentKeyId: z.string().trim().min(1).max(120).optional(),
  rotationReason: z.string().trim().min(10).max(1000),
  requestedBy: z.string().trim().min(3).max(180),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const DeveloperApiKeyRotationDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject', 'complete']),
  reason: z.string().trim().min(10).max(1000),
  decidedBy: z.string().trim().min(3).max(180),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const DeveloperSecretIssueRequestSchema = z.object({
  environment: DeveloperPortalEnvironmentSchema,
  expiresAt: z.string().datetime().optional(),
  requestedBy: z.string().trim().min(3).max(180),
  reason: z.string().trim().min(10).max(1000),
});

export const DeveloperSecretRevokeRequestSchema = z.object({
  revokedBy: z.string().trim().min(3).max(180),
  reason: z.string().trim().min(10).max(1000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const DeveloperWebhookSecretRotationRequestSchema = z.object({
  environment: DeveloperPortalEnvironmentSchema,
  currentSecretId: z.string().trim().min(1).max(120).optional(),
  rotationReason: z.string().trim().min(10).max(1000),
  requestedBy: z.string().trim().min(3).max(180),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const DeveloperWebhookReplayRequestSchema = z.object({
  reason: z.string().trim().min(10).max(1000).optional(),
  requestedBy: z.string().trim().min(3).max(180).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const DeveloperPortalEventSchema = z
  .object({
    eventId: z.string().trim().min(1),
    eventType: z.enum([
      'developer.service_application.submitted',
      'developer.service.approved',
      'developer.service.status_updated',
      'developer.service.suspended',
      'developer.scope_request.submitted',
      'developer.scope_request.approved',
      'developer.scope_request.rejected',
      'developer.allowlist.updated',
      'developer.api_key.rotation_requested',
      'developer.api_key.rotation_approved',
      'developer.api_key.rotation_rejected',
      'developer.api_key.rotated',
      'developer.api_key.issued',
      'developer.api_key.revoked',
      'developer.webhook_secret.rotation_requested',
      'developer.webhook_secret.rotation_approved',
      'developer.webhook_secret.rotation_rejected',
      'developer.webhook_secret.rotated',
      'developer.webhook_secret.issued',
      'developer.webhook_secret.revoked',
    ]),
    serviceCode: z.string().trim().min(2).max(80).optional(),
    environment: DeveloperPortalEnvironmentSchema.optional(),
    occurredAt: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
  })
  .passthrough();
