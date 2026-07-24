import { OrbiPayGatewayClient } from '../src/index.js';

const orbi = new OrbiPayGatewayClient({
  baseUrl: process.env.ORBI_PAY_GATEWAY_BASE_URL || 'https://sandbox-pay.orbifinancial.com',
  serviceKey: process.env.ORBI_PAY_SERVICE_KEY || '',
  environment: process.env.ORBI_PAY_ENVIRONMENT || 'Demo',
});

const response = await orbi.createCheckoutPaymentIntent({
  reference: 'ORDER-10001',
  amount: 125000,
  currency: 'TZS',
  paymentCategory: 'orbi',
  paymentRail: 'orbi_wallet',
  customer: {
    phone: '+255700000000',
  },
  returnUrl: 'https://merchant.example.com/orbi/return',
}, {
  idempotencyKey: 'payment-intent:merchant:ORDER-10001',
});

if (!response.success) {
  throw new Error(`${response.error}: ${response.message}`);
}

const action = orbi.getPaymentIntentNextAction(response.data);

if (action.type === 'redirect_to_hosted_challenge') {
  console.log(`Redirect customer to ${action.url}`);
} else if (action.type === 'complete') {
  console.log('Payment completed. Fulfil only after webhook/order reconciliation.');
} else if (action.type === 'wait_for_webhook') {
  console.log('Payment is processing. Wait for signed webhook or poll intent status.');
} else {
  console.log(action);
}
