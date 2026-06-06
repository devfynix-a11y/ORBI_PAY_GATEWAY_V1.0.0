import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { config, requireGatewayRuntimeSecrets } from './config.js';
import { logger } from './logger.js';
import { adapterRegistry } from './adapters/AdapterRegistry.js';
import { orbiCoreClient } from './core/orbiCoreClient.js';
import { obpDiscoveryService } from './discovery/ObpDiscoveryService.js';
import { rejectUnsafeDirectSecretsInProduction } from './security/providerCredentialVault.js';
import { assertStrongCustomerAuth, redactedScaForCore } from './security/strongCustomerAuth.js';
import type { GatewayPaymentResponse, NormalizedProviderEvent } from './types.js';

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

const PaymentRequestSchema = z.object({
  providerCode: z.string().min(1),
  reference: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().min(3).max(8),
  phone: z.string().optional(),
  accountNumber: z.string().optional(),
  walletId: z.string().optional(),
  description: z.string().max(500).optional(),
  rail: z.enum(['MOBILE_MONEY', 'BANK', 'CARD_GATEWAY', 'CRYPTO']).optional(),
  sca: z.object({
    status: z.enum(['not_required', 'required', 'challenged', 'authenticated', 'failed']),
    protocol: z.enum(['3DS2', '3DS1', 'OTP', 'BIOMETRIC', 'PASSKEY']).optional(),
    challengeId: z.string().optional(),
    authenticationValue: z.string().optional(),
    eci: z.string().optional(),
    dsTransactionId: z.string().optional(),
    liabilityShift: z.boolean().optional(),
    authenticatedAt: z.string().optional(),
  }).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const ObpSandboxEntitlementRequestSchema = z.object({
  bankId: z.string().trim().optional(),
  roleName: z.string().trim().min(1),
});

const ObpSandboxAccountCreateSchema = z.object({
  accountId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  label: z.string().trim().min(1).default('ORBI Sandbox Account'),
  productCode: z.string().trim().min(1).default('CURRENT'),
  branchId: z.string().trim().min(1).default('BRANCH1'),
  currency: z.string().trim().min(3).max(8).default('TZS'),
  amount: z.union([z.string(), z.number()]).default('0'),
  accountRoutings: z.array(z.object({
    scheme: z.string().trim().min(1),
    address: z.string().trim().min(1),
  })).optional(),
  rawBody: z.record(z.string(), z.unknown()).optional(),
});

const normalizeHeaders = (headers: Record<string, string | string[] | undefined>): Record<string, string | undefined> =>
  Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(',') : value === undefined ? undefined : String(value),
    ]),
  );

const shouldNotifyCore = (response: GatewayPaymentResponse): boolean =>
  ['processing', 'pending', 'completed', 'failed'].includes(response.status);

const eventFromProviderResponse = (response: GatewayPaymentResponse): NormalizedProviderEvent => ({
  providerId: response.providerCode,
  reference: response.reference,
  status: response.status,
  message: response.message,
  providerEventId: response.providerReference,
  rawStatus: response.status,
  payload: response.raw || {},
});

const app = express();
app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => {
    (req as express.Request).rawBody = Buffer.from(buf);
  },
}));

app.use((req, res, next) => {
  const requestId = req.get('x-request-id') || crypto.randomUUID();
  res.setHeader('x-request-id', requestId);
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ONLINE',
    service: 'orbi-payment-gateway',
    mode: config.providerMode,
    ts: Date.now(),
  });
});

app.get('/ready', async (_req, res) => {
  const providers = await adapterRegistry.readiness();
  res.json({
    success: true,
    data: {
      coreTarget: config.core.baseUrl,
      mtlsEnabled: config.mtls.enabled,
      providerMode: config.providerMode,
      providers,
    },
  });
});

app.get('/v1/providers', async (_req, res) => {
  const providers = await adapterRegistry.readiness();
  res.json({ success: true, data: providers });
});

app.get('/v1/providers/:providerCode/health', async (req, res) => {
  try {
    const result = await adapterRegistry.get(req.params.providerCode).health();
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.status(404).json({ success: false, error: e.message });
  }
});

const requireOperatorDiscoveryAccess = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!config.operatorDiscoveryApiKey && config.env !== 'production') return next();

  const provided = req.get('x-orbi-pay-operator-key') || req.get('x-api-key') || '';
  if (!config.operatorDiscoveryApiKey || provided !== config.operatorDiscoveryApiKey) {
    return res.status(403).json({ success: false, error: 'PAY_GATEWAY_DISCOVERY_ACCESS_DENIED' });
  }

  return next();
};

const requireObpSandboxToolsEnabled = (_req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!config.sandboxTools.enabled) {
    return res.status(404).json({
      success: false,
      error: 'OBP_SANDBOX_TOOLS_DISABLED',
      message: 'OBP sandbox operator tools are disabled. Set PAYMENT_GATEWAY_OBP_SANDBOX_TOOLS_ENABLED=true only in sandbox/dev operations.',
    });
  }
  return next();
};

app.get('/v1/discovery/obp/:providerCode/payment-capabilities', requireOperatorDiscoveryAccess, async (req, res) => {
  try {
    const providerCode = String(req.params.providerCode || '');
    const data = await obpDiscoveryService.discover(providerCode, {
      bankId: String(req.query.bankId || '').trim() || undefined,
      accountId: String(req.query.accountId || '').trim() || undefined,
      viewId: String(req.query.viewId || '').trim() || undefined,
      countryCode: String(req.query.countryCode || '').trim() || undefined,
      currency: String(req.query.currency || '').trim() || undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    logger.error('obp_payment_capability_discovery_failed', {
      providerCode: req.params.providerCode,
      error: e.message,
    });
    return res.status(502).json({ success: false, error: e.message || 'OBP_PAYMENT_CAPABILITY_DISCOVERY_FAILED' });
  }
});

app.get('/v1/discovery/obp/:providerCode/banks/:bankId/accounts', requireOperatorDiscoveryAccess, async (req, res) => {
  try {
    const scopeInput = String(req.query.scope || 'all').trim().toLowerCase();
    const scope = ['latest', 'private', 'public', 'all'].includes(scopeInput)
      ? (scopeInput as 'latest' | 'private' | 'public' | 'all')
      : 'all';
    const data = await obpDiscoveryService.discoverAccounts(String(req.params.providerCode || ''), {
      bankId: String(req.params.bankId || ''),
      scope,
      accountType: String(req.query.accountType || '').trim() || undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    logger.error('obp_account_discovery_failed', {
      providerCode: req.params.providerCode,
      bankId: req.params.bankId,
      error: e.message,
    });
    return res.status(502).json({ success: false, error: e.message || 'OBP_ACCOUNT_DISCOVERY_FAILED' });
  }
});

app.post('/v1/discovery/obp/:providerCode/sandbox/data-import', requireOperatorDiscoveryAccess, async (req, res) => {
  try {
    const data = await obpDiscoveryService.importSandboxData(String(req.params.providerCode || ''), req.body);
    const status = data.ok ? 200 : 502;
    return res.status(status).json({ success: data.ok, data, error: data.error });
  } catch (e: any) {
    logger.error('obp_sandbox_data_import_failed', {
      providerCode: req.params.providerCode,
      error: e.message,
    });
    return res.status(502).json({ success: false, error: e.message || 'OBP_SANDBOX_DATA_IMPORT_FAILED' });
  }
});

const obpSandboxRouter = express.Router({ mergeParams: true });
obpSandboxRouter.use(requireOperatorDiscoveryAccess, requireObpSandboxToolsEnabled);

obpSandboxRouter.get('/banks', async (req, res) => {
  try {
    const providerCode = String((req.params as any).providerCode || '');
    const data = await obpDiscoveryService.listBanks(providerCode);
    const status = data.ok ? 200 : 502;
    return res.status(status).json({ success: data.ok, data, error: data.error });
  } catch (e: any) {
    logger.error('obp_sandbox_banks_failed', {
      providerCode: (req.params as any).providerCode,
      error: e.message,
    });
    return res.status(502).json({ success: false, error: e.message || 'OBP_SANDBOX_BANKS_FAILED' });
  }
});

obpSandboxRouter.post('/entitlement-requests', async (req, res) => {
  try {
    const providerCode = String((req.params as any).providerCode || '');
    const payload = ObpSandboxEntitlementRequestSchema.parse(req.body || {});
    const data = await obpDiscoveryService.requestSandboxEntitlement(providerCode, {
      bankId: payload.bankId,
      roleName: payload.roleName,
    });
    const status = data.ok ? 200 : 502;
    return res.status(status).json({ success: data.ok, data, error: data.error });
  } catch (e: any) {
    logger.error('obp_sandbox_entitlement_request_failed', {
      providerCode: (req.params as any).providerCode,
      error: e.message,
    });
    return res.status(502).json({ success: false, error: e.message || 'OBP_SANDBOX_ENTITLEMENT_REQUEST_FAILED' });
  }
});

obpSandboxRouter.put('/banks/:bankId/accounts/:accountId', async (req, res) => {
  try {
    const providerCode = String((req.params as any).providerCode || '');
    const payload = ObpSandboxAccountCreateSchema.parse({
      ...(req.body || {}),
      accountId: req.params.accountId,
    });
    const body = payload.rawBody || {
      user_id: payload.userId,
      label: payload.label,
      product_code: payload.productCode,
      branch_id: payload.branchId,
      balance: {
        currency: payload.currency.toUpperCase(),
        amount: String(payload.amount),
      },
      account_routings: payload.accountRoutings || [
        {
          scheme: 'OBP',
          address: payload.accountId,
        },
      ],
    };

    const data = await obpDiscoveryService.createSandboxAccount(providerCode, {
      bankId: String(req.params.bankId || ''),
      accountId: payload.accountId,
      body,
    });
    const status = data.ok ? 200 : 502;
    return res.status(status).json({ success: data.ok, data, error: data.error });
  } catch (e: any) {
    logger.error('obp_sandbox_account_create_failed', {
      providerCode: (req.params as any).providerCode,
      bankId: req.params.bankId,
      accountId: req.params.accountId,
      error: e.message,
    });
    return res.status(502).json({ success: false, error: e.message || 'OBP_SANDBOX_ACCOUNT_CREATE_FAILED' });
  }
});

app.use('/v1/sandbox/obp/:providerCode', obpSandboxRouter);

const operationHandler = (operation: 'collect' | 'payout' | 'refund') => async (req: express.Request, res: express.Response) => {
  const parsed = PaymentRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'PAYMENT_REQUEST_INVALID',
      issues: parsed.error.issues,
    });
  }

  try {
    const adapter = adapterRegistry.get(parsed.data.providerCode);
    assertStrongCustomerAuth(parsed.data);
    const response = await adapter[operation]({
      ...parsed.data,
      metadata: {
        ...(parsed.data.metadata || {}),
        direction: operation,
        sca: redactedScaForCore(parsed.data.sca),
      },
    });

    let coreResult: unknown = null;
    if (shouldNotifyCore(response)) {
      coreResult = await orbiCoreClient.submitProviderEvent(eventFromProviderResponse(response));
    }

    return res.json({
      success: true,
      data: response,
      core: coreResult,
    });
  } catch (e: any) {
    logger.error('payment_operation_failed', { operation, error: e.message });
    return res.status(502).json({ success: false, error: e.message || 'PAYMENT_OPERATION_FAILED' });
  }
};

app.post('/v1/collections', operationHandler('collect'));
app.post('/v1/payouts', operationHandler('payout'));
app.post('/v1/refunds', operationHandler('refund'));

app.post('/v1/webhooks/:providerCode', async (req, res) => {
  try {
    const adapter = adapterRegistry.get(req.params.providerCode);
    const event = await adapter.parseWebhook(req.body, normalizeHeaders(req.headers), req.rawBody);
    const coreResult = await orbiCoreClient.submitProviderEvent(event);
    logger.info('provider_webhook_forwarded_to_core', {
      providerCode: req.params.providerCode,
      reference: event.reference,
      status: event.status,
    });
    return res.json({ success: true, data: event, core: coreResult });
  } catch (e: any) {
    logger.error('provider_webhook_failed', { providerCode: req.params.providerCode, error: e.message });
    return res.status(502).json({ success: false, error: e.message || 'PROVIDER_WEBHOOK_FAILED' });
  }
});

requireGatewayRuntimeSecrets();
rejectUnsafeDirectSecretsInProduction();

app.listen(config.port, () => {
  logger.info('payment_gateway_started', {
    port: config.port,
    publicBaseUrl: config.publicBaseUrl,
    coreTarget: config.core.baseUrl,
    mtlsEnabled: config.mtls.enabled,
  });
});
