import express from 'express';
import {
  assertOrbiSuccess,
  OrbiPayGatewayClient,
  type PaymentProfile,
} from '@orbi/pay-gateway';

type Seller = {
  sellerId: string;
  displayName: string;
  status: 'local_only' | 'link_pending' | 'linked' | 'link_failed';
  paymentProfileId?: string;
  orbiCustomerId?: string;
  scopes?: string[];
  linkedAt?: string;
  updatedAt: string;
};

const app = express();
const sellers = new Map<string, Seller>();

const port = Number(process.env.PORT || 4091);
const sellerPortalBaseUrl = process.env.SELLER_PORTAL_BASE_URL || `http://localhost:${port}`;
const orbi = new OrbiPayGatewayClient({
  baseUrl: process.env.ORBI_PAY_GATEWAY_BASE_URL || 'https://pay.orbifinancial.com',
  serviceKey: process.env.ORBI_PAY_SERVICE_KEY || '',
});

app.use(express.json());

app.post('/sellers/:sellerId/link-orbi', async (req, res) => {
  const sellerId = String(req.params.sellerId || '').trim();
  const displayName = String(req.body?.displayName || `Seller ${sellerId}`).trim();
  const customerId = optionalString(req.body?.customerId);
  const email = optionalString(req.body?.email);
  const phone = optionalString(req.body?.phone);

  if (!sellerId) return res.status(400).json({ error: 'SELLER_ID_REQUIRED' });
  if (!customerId && !email && !phone) {
    return res.status(400).json({ error: 'ORBI_IDENTITY_REQUIRED' });
  }

  const seller: Seller = {
    sellerId,
    displayName,
    status: 'link_pending',
    updatedAt: new Date().toISOString(),
  };
  sellers.set(sellerId, seller);

  const profileResponse = await orbi.linkPaymentProfile({
    externalCustomerId: sellerId,
    customerId,
    email,
    phone,
    scopes: ['payment_profile:read', 'payments:create', 'escrow:create'],
    consent: {
      purpose: 'Link this seller to ORBI payments for collections, escrow, and settlement visibility.',
      channel: 'merchant_seller_portal',
      returnUrl: `${sellerPortalBaseUrl}/sellers/${encodeURIComponent(sellerId)}`,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      locale: req.body?.locale || 'sw',
      timezone: req.body?.timezone || 'Africa/Dar_es_Salaam',
    },
    metadata: {
      source: 'seller_linking_example',
      sellerDisplayName: displayName,
    },
  }, {
    idempotencyKey: `payment-profile:seller:${sellerId}`,
    requestId: `seller-linking:${sellerId}`,
  });

  const profile = assertOrbiSuccess(profileResponse);
  applyLinkedProfile(seller, profile);
  return res.status(201).json({ seller });
});

app.get('/sellers/:sellerId', (req, res) => {
  const seller = sellers.get(String(req.params.sellerId || ''));
  if (!seller) return res.status(404).json({ error: 'SELLER_NOT_FOUND' });
  return res.json({ seller });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, sellers: sellers.size });
});

const applyLinkedProfile = (seller: Seller, profile: PaymentProfile) => {
  seller.paymentProfileId = profile.paymentProfileId;
  seller.orbiCustomerId = profile.customerId;
  seller.scopes = profile.scopes || [];
  seller.status = profile.status === 'active' || profile.status === 'pending' ? 'linked' : 'link_failed';
  seller.linkedAt = new Date().toISOString();
  seller.updatedAt = seller.linkedAt;
};

const optionalString = (value: unknown) => {
  const text = String(value || '').trim();
  return text ? text : undefined;
};

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    process.stdout.write(`Seller linking example running on ${sellerPortalBaseUrl}\n`);
  });
}

export { app, sellers };
