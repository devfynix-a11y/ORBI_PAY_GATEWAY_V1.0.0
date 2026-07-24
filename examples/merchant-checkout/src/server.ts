import express from 'express';
import {
  assertOrbiSuccess,
  OrbiPayGatewayClient,
  type PaymentIntent,
  type OrbiWebhookEvent,
  verifyOrbiWebhookSignature,
} from '@orbi/pay-gateway';

type Order = {
  orderId: string;
  amount: number;
  currency: string;
  customerPhone: string;
  status: 'pending' | 'requires_action' | 'processing' | 'paid' | 'failed' | 'cancelled';
  paymentIntentId?: string;
  challengeUrl?: string;
  lastEventId?: string;
  updatedAt: string;
};

const app = express();
const orders = new Map<string, Order>();
const seenWebhookEvents = new Set<string>();

const port = Number(process.env.PORT || 4090);
const merchantBaseUrl = process.env.MERCHANT_BASE_URL || `http://localhost:${port}`;
const orbi = new OrbiPayGatewayClient({
  baseUrl: process.env.ORBI_PAY_GATEWAY_BASE_URL || 'https://pay.orbifinancial.com',
  serviceKey: process.env.ORBI_PAY_SERVICE_KEY || '',
});

app.use('/webhooks/orbi', express.raw({ type: '*/*' }));
app.use(express.json());

app.post('/checkout', async (req, res) => {
  const orderId = String(req.body?.orderId || `ORDER-${Date.now()}`);
  const amount = Number(req.body?.amount || 125000);
  const currency = String(req.body?.currency || 'TZS');
  const customerPhone = String(req.body?.customerPhone || '');
  if (!customerPhone) {
    return res.status(400).json({ error: 'CUSTOMER_PHONE_REQUIRED' });
  }

  const order: Order = {
    orderId,
    amount,
    currency,
    customerPhone,
    status: 'pending',
    updatedAt: new Date().toISOString(),
  };
  orders.set(orderId, order);

  const response = await orbi.createCheckoutPaymentIntent({
    reference: orderId,
    amount,
    currency,
    paymentCategory: 'orbi',
    paymentRail: 'orbi_wallet',
    customer: {
      phone: customerPhone,
    },
    returnUrl: `${merchantBaseUrl}/orbi/return?orderId=${encodeURIComponent(orderId)}`,
    callbackUrl: `${merchantBaseUrl}/webhooks/orbi`,
    metadata: {
      consentScopes: ['payments:create'],
      consentPurpose: 'Allow this merchant checkout payment.',
      consentTextVersion: 'orbi-merchant-checkout-consent-v1',
      consentExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      locale: 'sw',
      timezone: 'Africa/Dar_es_Salaam',
    },
  }, {
    idempotencyKey: `payment-intent:${orderId}`,
    requestId: `merchant-checkout:${orderId}`,
  });

  const intent = assertOrbiSuccess(response);
  const action = orbi.getPaymentIntentNextAction(intent);
  order.paymentIntentId = intent.id;
  order.updatedAt = new Date().toISOString();

  if (action.type === 'redirect_to_hosted_challenge') {
    order.status = 'requires_action';
    order.challengeUrl = action.url;
    return res.status(201).json({
      order,
      nextAction: action.type,
      redirectTo: action.url,
    });
  }

  if (action.type === 'complete') {
    order.status = 'paid';
    return res.status(201).json({ order, nextAction: action.type });
  }

  if (action.type === 'failed') {
    order.status = action.intent.status;
    return res.status(409).json({ order, nextAction: action.type });
  }

  order.status = action.type === 'open_in_app_challenge' ? 'requires_action' : 'processing';
  return res.status(202).json({ order, nextAction: action.type });
});

app.get('/orbi/return', (req, res) => {
  const orderId = String(req.query.orderId || '');
  const order = orders.get(orderId);
  if (!order) return res.status(404).send('Order not found.');

  return res.type('html').send(`
    <main style="font-family: sans-serif; max-width: 680px; margin: 48px auto;">
      <h1>ORBI payment is processing</h1>
      <p>Order: <strong>${escapeHtml(order.orderId)}</strong></p>
      <p>Status: <strong>${escapeHtml(order.status)}</strong></p>
      <p>This return page is customer UX only. The signed webhook updates payment truth.</p>
    </main>
  `);
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
    const reference = String(event.paymentIntent.reference || '');
    const order = orders.get(reference);
    if (order) {
      order.paymentIntentId = event.paymentIntent.id;
      order.lastEventId = event.eventId;
      order.updatedAt = new Date().toISOString();
      if (event.paymentIntent.status === 'completed') order.status = 'paid';
      if (event.paymentIntent.status === 'failed') order.status = 'failed';
      if (event.paymentIntent.status === 'cancelled') order.status = 'cancelled';
      if (event.paymentIntent.status === 'processing') order.status = 'processing';
    }
  }

  return res.status(200).json({ success: true });
});

app.get('/orders/:orderId', (req, res) => {
  const order = orders.get(String(req.params.orderId || ''));
  if (!order) return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
  return res.json({ order });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, orders: orders.size });
});

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
    process.stdout.write(`Merchant checkout example running on ${merchantBaseUrl}\n`);
  });
}

export { app, orders, seenWebhookEvents };
