import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ApiErrorResponseSchema,
  buildApiErrorBody,
  errorCodeFromException,
  HostedChallengeResponseSchema,
  httpStatusForGatewayError,
  PaymentIntentResponseSchema,
  PaymentProfileResponseSchema,
  PaySafeEscrowIntentResponseSchema,
  publicPaymentIntentStatus,
  WebhookEventPayloadSchema,
} from '../src/contracts/platformContract.js';

test('platform contract error body includes stable fields', () => {
  const body = buildApiErrorBody('PAYMENT_INTENT_INVALID', {
    message: 'Request validation failed.',
    details: [{ path: ['amount'], message: 'Required' }],
    requestId: 'req-test-1',
  });

  assert.equal(body.success, false);
  assert.equal(body.error, 'PAYMENT_INTENT_INVALID');
  assert.equal(body.message, 'Request validation failed.');
  assert.deepEqual(body.details, [{ path: ['amount'], message: 'Required' }]);
  assert.equal(body.requestId, 'req-test-1');
  assert.doesNotThrow(() => ApiErrorResponseSchema.parse(body));
});

test('gateway exception parsing keeps stable error codes', () => {
  assert.equal(
    errorCodeFromException(new Error('PAYSAFE_PAYMENT_ROUTE_REQUIRED: missing paymentRail'), 'FALLBACK'),
    'PAYSAFE_PAYMENT_ROUTE_REQUIRED',
  );
  assert.equal(errorCodeFromException(new Error('human text only'), 'FALLBACK'), 'FALLBACK');
});

test('gateway error codes map to contract http status families', () => {
  assert.equal(httpStatusForGatewayError('PAYMENT_INTENT_INVALID'), 400);
  assert.equal(httpStatusForGatewayError('PAY_SERVICE_AUTH_FAILED'), 403);
  assert.equal(httpStatusForGatewayError('PAYMENT_INTENT_NOT_FOUND'), 404);
  assert.equal(httpStatusForGatewayError('PAYMENT_INTENT_ALREADY_FINALIZED'), 409);
  assert.equal(httpStatusForGatewayError('CORE_SERVICE_PAYMENT_REQUEST_FAILED'), 502);
});

test('public payment intent status hides internal processing states', () => {
  assert.equal(publicPaymentIntentStatus('requires_confirmation'), 'created');
  assert.equal(publicPaymentIntentStatus('submitted_to_core'), 'processing');
  assert.equal(publicPaymentIntentStatus('pending'), 'processing');
  assert.equal(publicPaymentIntentStatus('requires_action'), 'requires_action');
  assert.equal(publicPaymentIntentStatus('completed'), 'completed');
});

test('payment intent public response keeps stable contract shape', () => {
  const response = {
    success: true,
    data: {
      id: 'pi_contract_001',
      serviceCode: 'orbi_shop',
      operation: 'collection',
      paymentCategory: 'orbi',
      paymentRail: 'orbi_wallet',
      reference: 'ORDER-10001',
      amount: 125000,
      currency: 'TZS',
      status: publicPaymentIntentStatus('submitted_to_core'),
      description: 'Protected checkout',
      customer: {
        type: 'user',
        phone: '+255700000000',
      },
      checkoutUrl: 'https://pay.orbifinancial.com/checkout/pi_contract_001',
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
    },
  };

  assert.doesNotThrow(() => PaymentIntentResponseSchema.parse(response));
  assert.equal(response.data.status, 'processing');
  assert.throws(() =>
    PaymentIntentResponseSchema.parse({
      ...response,
      data: {
        ...response.data,
        status: 'submitted_to_core',
      },
    }),
  );
});

test('hosted challenge response requires hosted mode and challenge url', () => {
  assert.doesNotThrow(() =>
    HostedChallengeResponseSchema.parse({
      success: true,
      data: {
        id: 'pi_contract_002',
        serviceCode: 'orbi_shop',
        operation: 'collection',
        paymentCategory: 'orbi',
        paymentRail: 'orbi_wallet',
        reference: 'ORDER-10002',
        amount: 55000,
        currency: 'TZS',
        status: 'requires_action',
        checkoutUrl: 'https://pay.orbifinancial.com/checkout/pi_contract_002',
        challengeMode: 'hosted',
        challengeUrl: 'https://pay.orbifinancial.com/challenges/pi_contract_002',
        createdAt: '2026-07-23T00:00:00.000Z',
        updatedAt: '2026-07-23T00:00:00.000Z',
      },
    }),
  );
});

test('payment profile response shape is stable for merchant linking', () => {
  assert.doesNotThrow(() =>
    PaymentProfileResponseSchema.parse({
      success: true,
      data: {
        paymentProfileId: 'pp_contract_001',
        serviceCode: 'orbi_shop',
        externalCustomerId: 'shop_seller_123',
        customerId: 'OB26-9885-6029',
        status: 'active',
        scopes: ['payment_profile:read', 'payments:create', 'escrow:create'],
        consentExpiresAt: '2027-07-23T00:00:00.000Z',
      },
    }),
  );
});

test('paysafe escrow intent response locks the ORBI wallet rail', () => {
  assert.doesNotThrow(() =>
    PaySafeEscrowIntentResponseSchema.parse({
      success: true,
      data: {
        id: 'pi_paysafe_contract_001',
        serviceCode: 'orbi_shop',
        operation: 'paysafe',
        paymentCategory: 'orbi',
        paymentRail: 'orbi_wallet',
        reference: 'ORDER-10003',
        amount: 73000,
        currency: 'TZS',
        status: 'processing',
        checkoutUrl: 'https://pay.orbifinancial.com/checkout/pi_paysafe_contract_001',
        createdAt: '2026-07-23T00:00:00.000Z',
        updatedAt: '2026-07-23T00:00:00.000Z',
      },
    }),
  );
});

test('webhook event payload includes versioned delivery identity', () => {
  assert.doesNotThrow(() =>
    WebhookEventPayloadSchema.parse({
      eventId: 'evt_contract_001',
      eventType: 'payment_intent.completed',
      contractVersion: 'orbi-pay-gateway-contract-v1',
      serviceCode: 'orbi_shop',
      resourceType: 'payment_intent',
      resourceId: 'pi_contract_001',
      status: 'completed',
      occurredAt: '2026-07-23T00:00:00.000Z',
      data: {
        reference: 'ORDER-10001',
        amount: 125000,
        currency: 'TZS',
      },
    }),
  );
});
