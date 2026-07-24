import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertOrbiSuccess,
  classifyOrbiErrorCode,
  errorInfoFromResponse,
  createOrbi,
  OrbiPayGatewayClient,
} from '../src/index.js';

test('client sends service key and idempotency headers', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new OrbiPayGatewayClient({
    baseUrl: 'https://pay.example',
    serviceKey: 'svc_test_key',
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({
        success: true,
        data: {
          id: 'pi_123',
          serviceCode: 'merchant',
          operation: 'collection',
          reference: 'ORDER-1',
          amount: 1000,
          currency: 'TZS',
          status: 'processing',
          checkoutUrl: 'https://pay.example/checkout/pi_123',
          createdAt: '2026-07-23T00:00:00.000Z',
          updatedAt: '2026-07-23T00:00:00.000Z',
        },
      }), { status: 201, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });

  const response = await client.createPaymentIntent({
    reference: 'ORDER-1',
    amount: 1000,
    currency: 'TZS',
  }, {
    idempotencyKey: 'idem-order-1',
    requestId: 'req-order-1',
  });

  assert.equal(response.success, true);
  assert.equal(calls[0].url, 'https://pay.example/v1/payment-intents');
  assert.equal((calls[0].init.headers as Record<string, string>)['x-orbi-pay-service-key'], 'svc_test_key');
  assert.equal((calls[0].init.headers as Record<string, string>)['idempotency-key'], 'idem-order-1');
  assert.equal((calls[0].init.headers as Record<string, string>)['x-request-id'], 'req-order-1');
  assert.match((calls[0].init.headers as Record<string, string>)['x-orbi-signature'], /^sha256=[a-f0-9]{64}$/);
  assert.match((calls[0].init.headers as Record<string, string>)['x-orbi-timestamp'], /^\d+$/);
  assert.match((calls[0].init.headers as Record<string, string>)['x-orbi-nonce'], /^[0-9a-f-]{36}$/);
});

test('facade supports orbi.transfers.send contract style', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const orbi = createOrbi({
    baseUrl: 'https://pay.example',
    serviceKey: 'svc_test_key',
    operatorKey: 'operator_test_key',
    environment: 'Demo',
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({
        success: true,
        data: {
          id: 'pi_transfer_001',
          serviceCode: 'merchant',
          operation: 'collection',
          paymentCategory: 'orbi',
          paymentRail: 'orbi_wallet',
          reference: 'TX-1',
          amount: 5000,
          currency: 'TZS',
          status: 'processing',
          checkoutUrl: 'https://pay.example/checkout/pi_transfer_001',
          createdAt: '2026-07-23T00:00:00.000Z',
          updatedAt: '2026-07-23T00:00:00.000Z',
        },
      }), { status: 201, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });

  await orbi.transfers.send({
    reference: 'TX-1',
    amount: 5000,
    currency: 'TZS',
    customer: { phone: '+255700000000' },
  }, { idempotencyKey: 'transfer-TX-1' });
  await orbi.Transfers.send({
    reference: 'TX-2',
    amount: 7000,
    currency: 'TZS',
    customer: { phone: '+255711111111' },
  }, { idempotencyKey: 'transfer-TX-2' });

  assert.equal(calls[0].url, 'https://pay.example/v1/payment-intents');
  assert.match(String(calls[0].init.body), /"paymentCategory":"orbi"/);
  assert.match(String(calls[0].init.body), /"paymentRail":"orbi_wallet"/);
  assert.equal((calls[0].init.headers as Record<string, string>)['idempotency-key'], 'transfer-TX-1');
  assert.equal((calls[0].init.headers as Record<string, string>)['x-orbi-environment'], 'demo');
  assert.equal(calls[1].url, 'https://pay.example/v1/payment-intents');
  assert.equal((calls[1].init.headers as Record<string, string>)['idempotency-key'], 'transfer-TX-2');
});

test('facade keeps sandbox simulator separate from live transfer contract', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const orbi = createOrbi({
    baseUrl: 'https://pay.example',
    operatorKey: 'operator_test_key',
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({
        success: true,
        data: String(url).endsWith('/accounts')
          ? []
          : String(url).endsWith('/webhook-event')
            ? { eventId: 'evt_sbx_1', eventType: 'payment_intent.updated', serviceCode: 'sandbox-simulator', paymentIntent: { id: 'sbx_tx_1' } }
            : {
                transferId: 'sbx_tx_1',
                fromAccountId: 'sbx_buyer_daniel',
                toAccountId: 'sbx_seller_catherine',
                amount: 1000,
                currency: 'TZS',
                reference: 'SBX-1',
                status: 'completed',
                balanceAfter: { from: 999000, to: 251000 },
                createdAt: '2026-07-23T00:00:00.000Z',
              },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });

  await orbi.developer.sandboxSimulator.accounts();
  await orbi.developer.sandboxSimulator.transfer({
    fromAccountId: 'sbx_buyer_daniel',
    toAccountId: 'sbx_seller_catherine',
    amount: 1000,
    currency: 'TZS',
    reference: 'SBX-1',
  });
  await orbi.developer.sandboxSimulator.webhookEvent('sbx_tx_1');

  assert.equal(calls[0].url, 'https://pay.example/v1/developer/sandbox-simulator/accounts');
  assert.equal(calls[1].url, 'https://pay.example/v1/developer/sandbox-simulator/transfers');
  assert.equal(calls[2].url, 'https://pay.example/v1/developer/sandbox-simulator/transfers/sbx_tx_1/webhook-event');
  assert.equal((calls[1].init.headers as Record<string, string>)['x-orbi-pay-operator-key'], 'operator_test_key');
  assert.equal((calls[1].init.headers as Record<string, string>)['x-orbi-pay-service-key'], undefined);
});

test('client supports production environment header override', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new OrbiPayGatewayClient({
    baseUrl: 'https://pay.example',
    serviceKey: 'svc_live_key',
    environment: 'demo',
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({
        success: true,
        data: {
          id: 'pi_prod_001',
          serviceCode: 'merchant',
          operation: 'collection',
          reference: 'PROD-1',
          amount: 1000,
          currency: 'TZS',
          status: 'processing',
          checkoutUrl: 'https://pay.example/checkout/pi_prod_001',
          createdAt: '2026-07-23T00:00:00.000Z',
          updatedAt: '2026-07-23T00:00:00.000Z',
        },
      }), { status: 201, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });

  await client.createPaymentIntent({
    reference: 'PROD-1',
    amount: 1000,
    currency: 'TZS',
  }, { environment: 'Production' });

  assert.equal((calls[0].init.headers as Record<string, string>)['x-orbi-environment'], 'production');
});

test('client creates checkout intent and resolves hosted challenge next action', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new OrbiPayGatewayClient({
    baseUrl: 'https://pay.example',
    serviceKey: 'svc_test_key',
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({
        success: true,
        data: {
          id: 'pi_hosted_123',
          serviceCode: 'merchant',
          operation: 'collection',
          reference: 'ORDER-2',
          amount: 2000,
          currency: 'TZS',
          status: 'requires_action',
          checkoutUrl: 'https://pay.example/checkout/pi_hosted_123',
          challengeMode: 'hosted',
          challengeUrl: 'https://pay.example/challenges/pi_hosted_123',
          createdAt: '2026-07-23T00:00:00.000Z',
          updatedAt: '2026-07-23T00:00:00.000Z',
        },
      }), { status: 201, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });

  const response = await client.createCheckoutPaymentIntent({
    reference: 'ORDER-2',
    amount: 2000,
    currency: 'TZS',
  }, {
    idempotencyKey: 'payment-intent:merchant:ORDER-2',
  });

  assert.equal(response.success, true);
  if (!response.success) return;
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.confirm, true);
  const action = client.getPaymentIntentNextAction(response.data);
  assert.equal(action.type, 'redirect_to_hosted_challenge');
  assert.equal(client.requireHostedChallengeUrl(response.data), 'https://pay.example/challenges/pi_hosted_123');
});

test('client waits for payment intent terminal status', async () => {
  const statuses = ['processing', 'completed'];
  const client = new OrbiPayGatewayClient({
    baseUrl: 'https://pay.example',
    serviceKey: 'svc_test_key',
    fetchImpl: (async () => {
      const status = statuses.shift() || 'completed';
      return new Response(JSON.stringify({
        success: true,
        data: {
          id: 'pi_wait_123',
          serviceCode: 'merchant',
          operation: 'collection',
          reference: 'ORDER-3',
          amount: 3000,
          currency: 'TZS',
          status,
          checkoutUrl: 'https://pay.example/checkout/pi_wait_123',
          createdAt: '2026-07-23T00:00:00.000Z',
          updatedAt: '2026-07-23T00:00:00.000Z',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });

  const response = await client.waitForPaymentIntent('pi_wait_123', {
    intervalMs: 250,
    timeoutMs: 1000,
  });

  assert.equal(response.success, true);
  if (!response.success) return;
  assert.equal(response.data.status, 'completed');
});

test('client links payment profile with stable default idempotency key', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new OrbiPayGatewayClient({
    baseUrl: 'https://pay.example',
    serviceKey: 'svc_test_key',
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({
        success: true,
        data: {
          paymentProfileId: 'pp_123',
          serviceCode: 'merchant',
          externalCustomerId: 'seller_001',
          customerId: 'OB26-9885-6029',
          status: 'active',
          scopes: ['payment_profile:read', 'payments:create'],
          consentExpiresAt: '2027-07-23T00:00:00.000Z',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });

  const response = await client.linkPaymentProfile({
    externalCustomerId: 'seller_001',
    customerId: 'OB26-9885-6029',
    scopes: ['payment_profile:read', 'payments:create'],
  });

  assert.equal(response.success, true);
  assert.equal(calls[0].url, 'https://pay.example/v1/payment-profiles');
  assert.equal((calls[0].init.headers as Record<string, string>)['idempotency-key'], 'payment-profile:seller_001');
});

test('error helpers classify failures into developer actions', () => {
  const consent = classifyOrbiErrorCode('CONSENT_REQUIRED');
  assert.equal(consent.category, 'consent');
  assert.equal(consent.action, 'request_scope_or_consent');
  assert.equal(consent.retryable, false);

  const timeout = classifyOrbiErrorCode('PAYMENT_PROFILE_FAILED');
  assert.equal(timeout.category, 'service_unavailable');
  assert.equal(timeout.action, 'retry_same_idempotency_key');
  assert.equal(timeout.retryable, true);

  const responseInfo = errorInfoFromResponse({
    success: false,
    error: 'PAYMENT_INTENT_IDEMPOTENCY_MISMATCH',
    message: 'Payload changed.',
    details: [],
  });
  assert.equal(responseInfo?.category, 'idempotency');

  assert.throws(() => assertOrbiSuccess({
    success: false,
    error: 'PAY_SERVICE_AUTH_FAILED',
    message: 'Invalid service key.',
    details: [],
  }), /PAY_SERVICE_AUTH_FAILED:stop/);
});

test('client supports operator consent and webhook replay APIs without service key', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new OrbiPayGatewayClient({
    baseUrl: 'https://pay.example',
    operatorKey: 'operator_test_key',
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({
        success: true,
        data: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });

  await client.listConsentReceipts({
    serviceCode: 'orbi-shop',
    subjectId: 'user_001',
    status: 'active',
  });
  await client.replayWebhookDelivery('whdel_001', { requestId: 'req-replay-001' });

  assert.equal(
    calls[0].url,
    'https://pay.example/v1/developer/consent-receipts?serviceCode=orbi-shop&subjectId=user_001&status=active',
  );
  assert.equal((calls[0].init.headers as Record<string, string>)['x-orbi-pay-operator-key'], 'operator_test_key');
  assert.equal((calls[0].init.headers as Record<string, string>)['x-orbi-pay-service-key'], undefined);
  assert.equal(calls[1].url, 'https://pay.example/v1/developer/webhook-deliveries/whdel_001/replay');
  assert.equal((calls[1].init.headers as Record<string, string>)['x-request-id'], 'req-replay-001');
});

test('client replays failed webhook deliveries as an operator batch', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new OrbiPayGatewayClient({
    baseUrl: 'https://pay.example',
    operatorKey: 'operator_test_key',
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init || {} });
      if (String(url).includes('/v1/developer/webhook-deliveries?')) {
        return new Response(JSON.stringify({
          success: true,
          data: [
            {
              deliveryId: 'whdel_001',
              eventId: 'evt_001',
              serviceCode: 'orbi-shop',
              eventType: 'payment_intent.updated',
              status: 'failed',
              attempt: 1,
              createdAt: '2026-07-23T00:00:00.000Z',
              updatedAt: '2026-07-23T00:00:00.000Z',
            },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        success: true,
        data: {
          deliveryId: 'whdel_replay_001',
          eventId: 'evt_001',
          serviceCode: 'orbi-shop',
          eventType: 'payment_intent.updated',
          status: 'delivered',
          attempt: 2,
          replayOf: 'whdel_001',
          createdAt: '2026-07-23T00:00:00.000Z',
          updatedAt: '2026-07-23T00:00:01.000Z',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });

  const response = await client.replayFailedWebhookDeliveries({ serviceCode: 'orbi-shop' }, { limit: 1 });

  assert.equal(response.success, true);
  assert.equal(calls[0].url, 'https://pay.example/v1/developer/webhook-deliveries?serviceCode=orbi-shop&status=failed');
  assert.equal(calls[1].url, 'https://pay.example/v1/developer/webhook-deliveries/whdel_001/replay');
  assert.equal((calls[1].init.headers as Record<string, string>)['x-request-id'], 'manual-replay-whdel_001');
  if (response.success) assert.equal(response.data[0].status, 'delivered');
});

test('client supports consent scope catalog operator API', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new OrbiPayGatewayClient({
    baseUrl: 'https://pay.example',
    operatorKey: 'operator_test_key',
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({
        success: true,
        data: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });

  await client.getConsentScopeCatalog();

  assert.equal(calls[0].url, 'https://pay.example/v1/developer/consent-scopes');
  assert.equal((calls[0].init.headers as Record<string, string>)['x-orbi-pay-operator-key'], 'operator_test_key');
  assert.equal((calls[0].init.headers as Record<string, string>)['x-orbi-pay-service-key'], undefined);
});

test('client supports developer environment and sandbox simulator APIs', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new OrbiPayGatewayClient({
    baseUrl: 'https://pay.example',
    operatorKey: 'operator_test_key',
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({
        success: true,
        data: String(url).endsWith('/v1/developer/environment-profiles')
          ? { profiles: [], separation: { summary: 'separate', rules: [] } }
          : String(url).endsWith('/v1/developer/sandbox-simulator')
            ? { environment: 'sandbox', title: 'Sandbox Simulator Flow', warning: 'test only', steps: [], livePromotionChecklist: [] }
            : {
                environment: 'live',
                title: 'Live',
                moneyMode: 'real',
                ledgerMode: 'core_ledger_commit_required',
                providerMode: 'certified_or_live_provider',
                allowedKeyPrefix: 'orbi_live_',
                allowedWebhookSecretPrefix: 'orbi_whsec_live_',
                hostedChallengeMode: 'real_customer_authorization',
                webhookMode: 'signed_live_events',
                idempotencyRequired: true,
                recommendedBaseUrl: 'https://pay.orbifinancial.com',
                safetyRules: [],
              },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });

  await client.getDeveloperEnvironmentProfiles();
  await client.getDeveloperEnvironmentProfile('live');
  await client.getSandboxSimulatorFlow();

  assert.equal(calls[0].url, 'https://pay.example/v1/developer/environment-profiles');
  assert.equal(calls[1].url, 'https://pay.example/v1/developer/environment-profiles/live');
  assert.equal(calls[2].url, 'https://pay.example/v1/developer/sandbox-simulator');
  assert.equal((calls[0].init.headers as Record<string, string>)['x-orbi-pay-operator-key'], 'operator_test_key');
});

test('client supports consent status operator API', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new OrbiPayGatewayClient({
    baseUrl: 'https://pay.example',
    operatorKey: 'operator_test_key',
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({
        success: true,
        data: {
          status: 'expiring_soon',
          allowed: true,
          renewalRequired: true,
          renewalReason: 'CONSENT_EXPIRING_SOON',
          scopes: ['payments:create'],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });

  await client.getConsentStatus({
    serviceCode: 'orbi-shop',
    subjectId: 'user_001',
    scopes: ['payments:create'],
    environment: 'live',
    renewalWindowDays: 30,
  });

  assert.equal(
    calls[0].url,
    'https://pay.example/v1/developer/consent-status?serviceCode=orbi-shop&subjectId=user_001&scopes=payments%3Acreate&environment=live&renewalWindowDays=30',
  );
  assert.equal((calls[0].init.headers as Record<string, string>)['x-orbi-pay-operator-key'], 'operator_test_key');
});

test('client supports connected consent subject APIs', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new OrbiPayGatewayClient({
    baseUrl: 'https://pay.example',
    serviceKey: 'svc_test_key',
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({
        success: true,
        data: init?.method === 'GET' && String(url).endsWith('/v1/consents?status=active&locale=sw')
          ? []
          : {
              consentId: 'consent_001',
              serviceCode: 'orbi-shop',
              environment: 'live',
              subjectType: 'user',
              subjectId: 'user_001',
              scopes: ['payments:create'],
              purpose: 'Checkout payments',
              expiresAt: '2027-07-23T00:00:00.000Z',
              context: { timezone: 'Africa/Dar_es_Salaam', channel: 'hosted_challenge' },
              evidence: {
                consentTextVersion: 'orbi-consent-v1',
                acceptedAt: '2026-07-23T00:00:00.000Z',
                evidenceHash: 'hash',
              },
              status: 'active',
              createdAt: '2026-07-23T00:00:00.000Z',
              updatedAt: '2026-07-23T00:00:00.000Z',
              scopeSummary: [],
            },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });

  await client.listConnectedConsents({ status: 'active', locale: 'sw' }, {
    subject: { id: 'user_001', type: 'user' },
  });
  await client.getConnectedConsent('consent_001', { locale: 'en' }, {
    subject: { id: 'user_001', type: 'user' },
  });
  await client.revokeConnectedConsent('consent_001', { reason: 'Customer disconnected the service.' }, {
    subject: { id: 'user_001', type: 'user' },
    requestId: 'req-revoke-consent-001',
  });

  assert.equal(calls[0].url, 'https://pay.example/v1/consents?status=active&locale=sw');
  assert.equal((calls[0].init.headers as Record<string, string>)['x-orbi-subject-id'], 'user_001');
  assert.equal((calls[0].init.headers as Record<string, string>)['x-orbi-subject-type'], 'user');
  assert.equal((calls[0].init.headers as Record<string, string>)['x-orbi-pay-service-key'], undefined);
  assert.equal((calls[1].url), 'https://pay.example/v1/consents/consent_001?locale=en');
  assert.equal(calls[2].url, 'https://pay.example/v1/consents/consent_001/revoke');
  assert.equal((calls[2].init.headers as Record<string, string>)['x-request-id'], 'req-revoke-consent-001');
});

test('client requires subject context for connected consent APIs', async () => {
  const client = new OrbiPayGatewayClient({
    baseUrl: 'https://pay.example',
    serviceKey: 'svc_test_key',
  });

  assert.throws(
    () => client.listConnectedConsents(),
    /ORBI_PAY_GATEWAY_SUBJECT_CONTEXT_REQUIRED/,
  );
});

test('client supports developer service setup operator APIs', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new OrbiPayGatewayClient({
    baseUrl: 'https://pay.example',
    operatorKey: 'operator_test_key',
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({
        success: true,
        data: {
          serviceCode: 'merchant',
          displayName: 'Merchant',
          status: 'active',
          environments: ['sandbox'],
          scopesGranted: ['payments:create'],
          scopesPending: [],
          redirectUrls: ['https://merchant.example/return'],
          webhookUrls: ['https://merchant.example/webhooks'],
          keyStatus: 'active',
          webhookSecretStatus: 'active',
          createdAt: '2026-07-23T00:00:00.000Z',
          updatedAt: '2026-07-23T00:00:00.000Z',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });

  await client.submitDeveloperServiceApplication({
    legalName: 'Merchant Ltd',
    displayName: 'Merchant',
    contactEmail: 'ops@merchant.example',
    businessType: 'merchant',
    countryCode: 'TZ',
    requestedEnvironments: ['sandbox'],
    requestedScopes: ['payments:create'],
    redirectUrls: ['https://merchant.example/return'],
    webhookUrls: ['https://merchant.example/webhooks'],
    useCases: ['Sandbox checkout integration'],
    termsAccepted: true,
  });
  await client.updateDeveloperAllowlists('merchant', {
    redirectUrls: ['https://merchant.example/return'],
    webhookUrls: ['https://merchant.example/webhooks'],
    reason: 'Add sandbox URLs for checkout testing.',
    environment: 'sandbox',
  });
  await client.issueDeveloperApiKey('merchant', {
    environment: 'sandbox',
    requestedBy: 'ops@merchant.example',
    reason: 'Issue sandbox key for integration testing.',
  });
  await client.issueDeveloperWebhookSecret('merchant', {
    environment: 'sandbox',
    requestedBy: 'ops@merchant.example',
    reason: 'Issue sandbox webhook secret for integration testing.',
  });
  await client.getDeveloperSandboxTools();

  assert.equal(calls[0].url, 'https://pay.example/v1/developer/service-applications');
  assert.equal(calls[1].url, 'https://pay.example/v1/developer/services/merchant/allowlists');
  assert.equal(calls[2].url, 'https://pay.example/v1/developer/services/merchant/api-keys/issue');
  assert.equal(calls[3].url, 'https://pay.example/v1/developer/services/merchant/webhook-secrets/issue');
  assert.equal(calls[4].url, 'https://pay.example/v1/developer/sandbox-tools');
  assert.equal((calls[0].init.headers as Record<string, string>)['x-orbi-pay-operator-key'], 'operator_test_key');
  assert.equal((calls[0].init.headers as Record<string, string>)['x-orbi-pay-service-key'], undefined);
});

test('client requires correct credential family for runtime and operator APIs', async () => {
  const operatorOnly = new OrbiPayGatewayClient({
    baseUrl: 'https://pay.example',
    operatorKey: 'operator_test_key',
  });
  assert.rejects(() => operatorOnly.createPaymentIntent({
    reference: 'ORDER-1',
    amount: 1000,
    currency: 'TZS',
  }), /ORBI_PAY_GATEWAY_SERVICE_KEY_REQUIRED/);

  const serviceOnly = new OrbiPayGatewayClient({
    baseUrl: 'https://pay.example',
    serviceKey: 'svc_test_key',
  });
  assert.rejects(() => serviceOnly.listWebhookDeliveries(), /ORBI_PAY_GATEWAY_OPERATOR_KEY_REQUIRED/);
});
