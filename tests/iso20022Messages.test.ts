import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIso20022CanonicalPayment, iso20022PaymentToJson } from '../src/iso20022/Iso20022Messages.js';
import { iso20022PaymentToXml } from '../src/iso20022/Iso20022Xml.js';
import type { ProviderDefinition } from '../src/types.js';

const provider: ProviderDefinition = {
  code: 'tips-neighbor-bank',
  displayName: 'TIPS Neighbor Bank',
  rail: 'BANK',
  protocol: 'ISO20022_REST_XML',
  protocolProfile: 'tips-iso20022-pacs-v1',
  countries: ['TZ'],
  currencies: ['TZS'],
  operations: ['payout'],
  baseUrlEnv: 'TIPS_BASE_URL',
  credentialTokenRefEnv: 'TIPS_CREDENTIAL_TOKEN_REF',
  webhookSecretTokenRefEnv: 'TIPS_WEBHOOK_SECRET_TOKEN_REF',
};

test('ORBI payment request maps to ISO 20022 canonical pacs.008 identifiers', () => {
  const payment = buildIso20022CanonicalPayment(provider, 'payout', {
    providerCode: provider.code,
    reference: 'ORBI-TX-1001',
    amount: 50000,
    currency: 'TZS',
    accountNumber: '255700000001',
    description: 'Supplier payout',
    metadata: {
      debtor: { name: 'ORBI Settlement Account', accountId: 'ORBI-OPS-001' },
      creditor: { name: 'Amina Customer', accountId: '255700000001' },
    },
  });

  assert.equal(payment.messageType, 'pacs.008.001.08');
  assert.equal(payment.instructionId, 'ORBI-TX-1001');
  assert.equal(payment.endToEndId, 'ORBI-TX-1001');
  assert.equal(payment.amount, 50000);
  assert.equal(payment.debtor.name, 'ORBI Settlement Account');
  assert.equal(payment.creditor.name, 'Amina Customer');
});

test('ISO 20022 JSON and XML payloads preserve reference and amount', () => {
  const payment = buildIso20022CanonicalPayment(provider, 'payout', {
    providerCode: provider.code,
    reference: 'ORBI-TX-2002',
    amount: 12500,
    currency: 'TZS',
    accountNumber: '255700000002',
  });
  const json = iso20022PaymentToJson(payment);
  const xml = iso20022PaymentToXml(payment);

  assert.equal(json.document.creditTransferTransactionInformation.paymentIdentification.endToEndId, 'ORBI-TX-2002');
  assert.match(xml, /pacs\.008\.001\.08/);
  assert.match(xml, /ORBI-TX-2002/);
  assert.match(xml, /12500\.00/);
});
