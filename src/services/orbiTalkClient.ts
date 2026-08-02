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
  if (intent.templateCode === 'developer.portal.email_verification') {
    const code = String(metadata.verificationCode || '');
    const minutes = Number(metadata.expiresMinutes || 15);
    return {
      subject: 'Verify your ORBI developer account',
      body: `Your ORBI developer verification code is ${code}. It expires in ${minutes} minutes. If you did not create this account, you can ignore this message.`,
    };
  }
  if (intent.templateCode === 'developer.service.approved') {
    return {
      subject: 'Your ORBI integration was approved',
      body: 'Your ORBI integration request has been approved. Sign in to the Developer Portal to continue.',
    };
  }
  if (intent.templateCode === 'developer.portal.team_invitation') {
    return {
      subject: 'You have been invited to ORBI Pay Developer Portal',
      body: `You have been invited to join ${String(metadata.serviceCodes || 'an ORBI Pay integration')}. Open this secure link to create your own staff account: ${String(metadata.inviteUrl || '')}. This invitation expires soon. If you did not expect this invitation, ignore this message.`,
    };
  }
  if (intent.templateCode.includes('rotation')) {
    return {
      subject: 'ORBI credential security update',
      body: 'A credential rotation activity occurred on your ORBI integration. Sign in to review the audited change.',
    };
  }
  return {
    subject: 'ORBI developer account update',
    body: 'There is a new update on your ORBI developer account. Sign in to the Developer Portal for details.',
  };
};

export class OrbiTalkClient {
  constructor(private readonly options = config.talk) {}

  async sendIntent(intent: MessagingIntent): Promise<OrbiTalkSendResult> {
    const parsed = MessagingIntentSchema.parse(intent);
    if (!parsed.environment) return { status: 'failed', error: 'MESSAGE_ENVIRONMENT_REQUIRED' };
    if (!this.options.enabled) return { status: 'skipped', error: 'ORBI_TALK_DISABLED' };
    if (!this.options.apiKey) return { status: 'failed', error: 'ORBI_TALK_API_KEY_REQUIRED' };

    const url = new URL(this.options.intentPath, this.options.baseUrl);
    const email = renderEmailIntent(parsed);
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
