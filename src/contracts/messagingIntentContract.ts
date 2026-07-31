import { z } from 'zod';

export const MessagingChannelSchema = z.enum(['email', 'sms', 'push', 'whatsapp', 'in_app']);
export const MessagingLanguageSchema = z.enum(['en', 'sw']);
export const MessagingDeliveryStatusSchema = z.enum(['queued', 'sent', 'delivered', 'failed', 'skipped']);

export const MessagingIntentSchema = z.object({
  eventId: z.string().trim().min(8),
  correlationId: z.string().trim().min(8),
  templateCode: z.string().trim().min(3).max(120),
  recipientIdentityRef: z.string().trim().min(3).max(240),
  language: MessagingLanguageSchema.default('en'),
  channel: MessagingChannelSchema,
  serviceCode: z.string().trim().min(2).max(80).optional(),
  environment: z.enum(['sandbox', 'live']).optional(),
  safeMetadata: z.record(z.string(), z.unknown()).default({}),
});

export type MessagingIntent = z.infer<typeof MessagingIntentSchema>;
export type MessagingDeliveryStatus = z.infer<typeof MessagingDeliveryStatusSchema>;

