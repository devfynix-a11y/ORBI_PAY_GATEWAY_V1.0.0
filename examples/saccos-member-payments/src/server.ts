import express from 'express';
import {
  assertOrbiSuccess,
  OrbiPayGatewayClient,
  type PaymentIntent,
  type OrbiWebhookEvent,
  type PaymentProfile,
  verifyOrbiWebhookSignature,
} from '@orbi/pay-gateway';

type Member = {
  memberId: string;
  fullName: string;
  status: 'local_only' | 'linked';
  paymentProfileId?: string;
  orbiCustomerId?: string;
  linkedAt?: string;
  updatedAt: string;
};

type MemberPayment = {
  paymentId: string;
  memberId: string;
  category: 'dues' | 'savings' | 'loan_repayment' | 'other';
  amount: number;
  currency: string;
  status: 'pending' | 'requires_action' | 'processing' | 'paid' | 'failed' | 'cancelled';
  reference: string;
  paymentIntentId?: string;
  challengeUrl?: string;
  lastEventId?: string;
  updatedAt: string;
};

const app = express();
const members = new Map<string, Member>();
const payments = new Map<string, MemberPayment>();
const seenWebhookEvents = new Set<string>();

const port = Number(process.env.PORT || 4092);
const saccosBaseUrl = process.env.SACCOS_BASE_URL || `http://localhost:${port}`;
const orbi = new OrbiPayGatewayClient({
  baseUrl: process.env.ORBI_PAY_GATEWAY_BASE_URL || 'https://pay.orbifinancial.com',
  serviceKey: process.env.ORBI_PAY_SERVICE_KEY || '',
});

app.use('/webhooks/orbi', express.raw({ type: '*/*' }));
app.use(express.json());

app.post('/members/:memberId/link-orbi', async (req, res) => {
  const memberId = String(req.params.memberId || '').trim();
  const fullName = String(req.body?.fullName || `Member ${memberId}`).trim();
  const customerId = optionalString(req.body?.customerId);
  const email = optionalString(req.body?.email);
  const phone = optionalString(req.body?.phone);

  if (!memberId) return res.status(400).json({ error: 'MEMBER_ID_REQUIRED' });
  if (!customerId && !email && !phone) {
    return res.status(400).json({ error: 'ORBI_IDENTITY_REQUIRED' });
  }

  const member: Member = {
    memberId,
    fullName,
    status: 'local_only',
    updatedAt: new Date().toISOString(),
  };
  members.set(memberId, member);

  const response = await orbi.linkPaymentProfile({
    externalCustomerId: memberId,
    customerId,
    email,
    phone,
    scopes: ['payment_profile:read', 'payments:create', 'webhooks:receive'],
    consent: {
      purpose: 'Link this SACCOS member to ORBI payment collections and receipts.',
      channel: 'saccos_member_portal',
      returnUrl: `${saccosBaseUrl}/members/${encodeURIComponent(memberId)}`,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      locale: req.body?.locale || 'sw',
      timezone: req.body?.timezone || 'Africa/Dar_es_Salaam',
    },
    metadata: {
      source: 'saccos_member_payments_example',
      memberName: fullName,
    },
  }, {
    idempotencyKey: `payment-profile:saccos-member:${memberId}`,
    requestId: `saccos-member-link:${memberId}`,
  });

  applyLinkedProfile(member, assertOrbiSuccess(response));
  return res.status(201).json({ member });
});

app.post('/members/:memberId/payments', async (req, res) => {
  const memberId = String(req.params.memberId || '').trim();
  const member = members.get(memberId);
  if (!member) return res.status(404).json({ error: 'MEMBER_NOT_FOUND' });

  const amount = Number(req.body?.amount || 10000);
  const currency = String(req.body?.currency || 'TZS');
  const category = normalizeCategory(req.body?.category);
  const paymentId = String(req.body?.paymentId || `SACCOS-PAY-${Date.now()}`);
  const reference = `SACCOS-${memberId}-${paymentId}`;

  const payment: MemberPayment = {
    paymentId,
    memberId,
    amount,
    currency,
    category,
    reference,
    status: 'pending',
    updatedAt: new Date().toISOString(),
  };
  payments.set(paymentId, payment);

  const response = await orbi.createCheckoutPaymentIntent({
    reference,
    amount,
    currency,
    paymentCategory: 'orbi',
    paymentRail: 'orbi_wallet',
    description: `SACCOS ${category.replace('_', ' ')} payment for ${member.fullName}`,
    customer: {
      type: 'external_customer',
      userId: member.orbiCustomerId,
    },
    returnUrl: `${saccosBaseUrl}/orbi/return?paymentId=${encodeURIComponent(paymentId)}`,
    callbackUrl: `${saccosBaseUrl}/webhooks/orbi`,
    metadata: {
      consentScopes: ['payments:create'],
      consentPurpose: 'Authorize this SACCOS payment through ORBI.',
      consentTextVersion: 'orbi-saccos-member-payment-consent-v1',
      consentExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      memberId,
      category,
      locale: req.body?.locale || 'sw',
      timezone: req.body?.timezone || 'Africa/Dar_es_Salaam',
    },
  }, {
    idempotencyKey: `saccos-payment:${paymentId}`,
    requestId: `saccos-payment:${paymentId}`,
  });

  const intent = assertOrbiSuccess(response);
  const action = orbi.getPaymentIntentNextAction(intent);
  payment.paymentIntentId = intent.id;
  payment.updatedAt = new Date().toISOString();

  if (action.type === 'redirect_to_hosted_challenge') {
    payment.status = 'requires_action';
    payment.challengeUrl = action.url;
    return res.status(201).json({ payment, nextAction: action.type, redirectTo: action.url });
  }

  if (action.type === 'complete') {
    payment.status = 'paid';
    return res.status(201).json({ payment, nextAction: action.type });
  }

  if (action.type === 'failed') {
    payment.status = action.intent.status;
    return res.status(409).json({ payment, nextAction: action.type });
  }

  payment.status = action.type === 'open_in_app_challenge' ? 'requires_action' : 'processing';
  return res.status(202).json({ payment, nextAction: action.type });
});

app.post('/webhooks/orbi', (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''));
  const signatureHeader = String(req.header('x-orbi-pay-signature') || req.header('x-orbi-signature') || '');
  const timestampHeader = String(req.header('x-orbi-pay-timestamp') || req.header('x-orbi-timestamp') || '');
  const secret = process.env.ORBI_PAY_WEBHOOK_SECRET || '';
  if (!secret) return res.status(500).json({ error: 'WEBHOOK_SECRET_NOT_CONFIGURED' });

  const verified = verifyOrbiWebhookSignature({
    rawBody,
    signatureHeader,
    timestampHeader,
    secret,
  });
  if (!verified.ok) return res.status(401).json({ error: 'WEBHOOK_SIGNATURE_INVALID', reason: verified.reason });

  const event = JSON.parse(rawBody.toString('utf8')) as OrbiWebhookEvent;
  if (seenWebhookEvents.has(event.eventId)) {
    return res.status(200).json({ success: true, duplicate: true });
  }
  seenWebhookEvents.add(event.eventId);

  if (isPaymentIntentUpdatedEvent(event)) {
    const payment = findPaymentByReference(String(event.paymentIntent.reference || ''));
    if (payment) {
      payment.paymentIntentId = event.paymentIntent.id;
      payment.lastEventId = event.eventId;
      payment.updatedAt = new Date().toISOString();
      if (event.paymentIntent.status === 'completed') payment.status = 'paid';
      if (event.paymentIntent.status === 'processing') payment.status = 'processing';
      if (event.paymentIntent.status === 'failed') payment.status = 'failed';
      if (event.paymentIntent.status === 'cancelled') payment.status = 'cancelled';
    }
  }

  return res.status(200).json({ success: true });
});

app.get('/orbi/return', (req, res) => {
  const paymentId = String(req.query.paymentId || '');
  const payment = payments.get(paymentId);
  if (!payment) return res.status(404).send('Payment not found.');

  return res.type('html').send(`
    <main style="font-family: sans-serif; max-width: 680px; margin: 48px auto;">
      <h1>ORBI SACCOS payment is processing</h1>
      <p>Payment: <strong>${escapeHtml(payment.paymentId)}</strong></p>
      <p>Status: <strong>${escapeHtml(payment.status)}</strong></p>
      <p>The signed webhook is the payment truth. This page is only customer UX.</p>
    </main>
  `);
});

app.get('/members/:memberId', (req, res) => {
  const member = members.get(String(req.params.memberId || ''));
  if (!member) return res.status(404).json({ error: 'MEMBER_NOT_FOUND' });
  return res.json({ member });
});

app.get('/payments/:paymentId', (req, res) => {
  const payment = payments.get(String(req.params.paymentId || ''));
  if (!payment) return res.status(404).json({ error: 'PAYMENT_NOT_FOUND' });
  return res.json({ payment });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, members: members.size, payments: payments.size });
});

const applyLinkedProfile = (member: Member, profile: PaymentProfile) => {
  member.paymentProfileId = profile.paymentProfileId;
  member.orbiCustomerId = profile.customerId;
  member.status = 'linked';
  member.linkedAt = new Date().toISOString();
  member.updatedAt = member.linkedAt;
};

const findPaymentByReference = (reference: string) => {
  for (const payment of payments.values()) {
    if (payment.reference === reference) return payment;
  }
  return undefined;
};

const normalizeCategory = (value: unknown): MemberPayment['category'] => {
  if (value === 'dues' || value === 'savings' || value === 'loan_repayment' || value === 'other') return value;
  return 'other';
};

const optionalString = (value: unknown) => {
  const text = String(value || '').trim();
  return text ? text : undefined;
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char] || char);

const isPaymentIntentUpdatedEvent = (
  event: OrbiWebhookEvent,
): event is OrbiWebhookEvent & {
  eventType: 'payment_intent.updated';
  paymentIntent: Partial<PaymentIntent> & { id: string };
} =>
  event.eventType === 'payment_intent.updated' &&
  typeof (event as any).paymentIntent === 'object' &&
  typeof (event as any).paymentIntent?.id === 'string';

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    process.stdout.write(`SACCOS member payments example running on ${saccosBaseUrl}\n`);
  });
}

export { app, members, payments, seenWebhookEvents };
