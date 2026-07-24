import { z } from 'zod';
import { ApiSuccessResponseSchema } from './platformContract.js';
import { DeveloperScopeSchema } from './developerPortalContract.js';

export const ConsentSubjectTypeSchema = z.enum(['user', 'business']);
export const ConsentChannelSchema = z.enum(['hosted_challenge', 'developer_portal', 'operator', 'mobile_app']);
export const ConsentStatusSchema = z.enum(['active', 'revoked', 'expired']);

export const ConsentContextSchema = z.object({
  locale: z.enum(['en', 'sw']).default('en'),
  timezone: z.string().trim().min(1).max(80),
  ipHash: z.string().trim().min(8).max(160).optional(),
  deviceHash: z.string().trim().min(8).max(160).optional(),
  userAgentHash: z.string().trim().min(8).max(160).optional(),
  countryCode: z.string().trim().min(2).max(3).optional(),
  channel: ConsentChannelSchema,
});

export const ConsentEvidenceSchema = z.object({
  consentTextVersion: z.string().trim().min(3).max(120),
  challengeId: z.string().trim().min(1).max(160).optional(),
  challengeType: z.enum(['OTP', 'PIN', 'PASSKEY', 'BIOMETRIC', 'OIDC', 'OPERATOR']).optional(),
  acceptedAt: z.string().datetime(),
  evidenceHash: z.string().trim().min(16).max(160),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ConsentReceiptCreateSchema = z.object({
  serviceCode: z.string().trim().min(2).max(80),
  environment: z.enum(['sandbox', 'live']),
  subjectType: ConsentSubjectTypeSchema,
  subjectId: z.string().trim().min(1).max(160),
  externalSubjectId: z.string().trim().min(1).max(160).optional(),
  scopes: z.array(DeveloperScopeSchema).min(1).max(20),
  purpose: z.string().trim().min(5).max(500),
  expiresAt: z.string().datetime(),
  context: ConsentContextSchema,
  evidence: ConsentEvidenceSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ConsentReceiptSchema = ConsentReceiptCreateSchema.extend({
  consentId: z.string().trim().min(1),
  status: ConsentStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revokedAt: z.string().datetime().optional(),
  revokedBy: z.string().trim().min(1).max(180).optional(),
  revocationReason: z.string().trim().min(3).max(1000).optional(),
});

export const ConsentRevocationSchema = z.object({
  revokedBy: z.string().trim().min(3).max(180),
  reason: z.string().trim().min(10).max(1000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ConsentReceiptResponseSchema = ApiSuccessResponseSchema(ConsentReceiptSchema);
export const ConsentReceiptListResponseSchema = ApiSuccessResponseSchema(z.array(ConsentReceiptSchema));
