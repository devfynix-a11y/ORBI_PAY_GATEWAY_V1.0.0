import { OrbiPayGatewayClient } from '../src/index.js';

const orbi = new OrbiPayGatewayClient({
  baseUrl: process.env.ORBI_PAY_GATEWAY_BASE_URL || 'https://pay.orbifinancial.com',
  operatorKey: process.env.ORBI_PAY_OPERATOR_KEY || '',
});

const receipts = await orbi.listConsentReceipts({
  serviceCode: 'orbi-shop',
  status: 'active',
});

console.log(receipts);

const replay = await orbi.replayWebhookDelivery('whdel_example', {
  requestId: 'manual-replay-whdel-example',
});

console.log(replay);
