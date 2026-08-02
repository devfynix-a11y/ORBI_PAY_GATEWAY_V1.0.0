import crypto from 'node:crypto';
import { config } from '../config.js';
import { MessagingIntentSchema, type MessagingIntent } from '../contracts/messagingIntentContract.js';
import { logger } from '../logger.js';

export type OrbiTalkSendResult = {
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  providerMessageId?: string;
  statusCode?: number;
  error?: string;
};

const renderEmailIntent = (intent: MessagingIntent) => {
  const metadata = intent.safeMetadata || {};
  const directSubject = String(metadata.emailSubject || '').trim();
  const directBody = String(metadata.emailBody || '').trim();
  if (directSubject && directBody) {
    return {
      subject: directSubject,
      body: directBody,
    };
  }
  throw new Error('DIRECT_EMAIL_CONTENT_REQUIRED');
};

export class OrbiTalkClient {
  constructor(private readonly options = config.talk) {}

  async sendIntent(intent: MessagingIntent): Promise<OrbiTalkSendResult> {
    const parsed = MessagingIntentSchema.parse(intent);
    if (!parsed.environment) return { status: 'failed', error: 'MESSAGE_ENVIRONMENT_REQUIRED' };
    if (!this.options.enabled) return { status: 'skipped', error: 'ORBI_TALK_DISABLED' };
    if (!this.options.apiKey) return { status: 'failed', error: 'ORBI_TALK_API_KEY_REQUIRED' };

    const url = new URL(this.options.intentPath, this.options.baseUrl);
    let email: { subject: string; body: string };
    try {
      email = renderEmailIntent(parsed);
    } catch (error: any) {
      return { status: 'failed', error: error?.message || 'DIRECT_EMAIL_CONTENT_REQUIRED' };
    }
    const body = JSON.stringify({
      recipient: parsed.recipientIdentityRef,
      channel: parsed.channel,
      subject: email.subject,
      body: email.body,
      ownerEmail: this.options.ownerEmail,
      messageType: parsed.templateCode.includes('verification') ? 'otp' : 'transactional',
      requestId: parsed.eventId,
      senderName: 'ORBI Pay',
      platformName: 'ORBI Pay',
      deliveryMode: 'direct',
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomUUID();
    const signature = crypto
      .createHmac('sha256', this.options.apiKey)
      .update(`${timestamp}.${nonce}.${body}`)
      .digest('hex');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-orbi-talk-key-id': 'orbi-pay-gateway',
          'x-orbi-talk-timestamp': timestamp,
          'x-orbi-talk-nonce': nonce,
          'x-orbi-talk-signature': `sha256=${signature}`,
          'x-api-key': this.options.apiKey,
          'x-orbi-environment': parsed.environment === 'live' ? 'production' : 'demo',
          'x-orbi-source-service': 'orbi-pay-gateway',
        },
        body,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as { data?: { messageId?: string }; messageId?: string } | null;
      return {
        status: response.ok ? 'queued' : 'failed',
        providerMessageId: payload?.data?.messageId || payload?.messageId,
        statusCode: response.status,
        error: response.ok ? undefined : `ORBI_TALK_HTTP_${response.status}`,
      };
    } catch (error: any) {
      logger.warn('orbi_talk.intent_delivery_failed', {
        eventId: parsed.eventId,
        templateCode: parsed.templateCode,
        error: error?.message || String(error),
      });
      return { status: 'failed', error: error?.message || String(error) };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const orbiTalkClient = new OrbiTalkClient();
