#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { OrbiPayGatewayClient } from './client.js';
import { assertOrbiSuccess } from './errors.js';
import { verifyOrbiWebhookSignature } from './webhooks.js';

type CliOptions = Record<string, string | boolean>;

const commands = new Set([
  'create-intent',
  'get-intent',
  'replay-webhook',
  'verify-webhook',
  'submit-service',
  'list-applications',
  'approve-service',
  'list-services',
  'get-service',
  'request-scopes',
  'update-allowlists',
  'issue-api-key',
  'issue-webhook-secret',
  'catalog',
  'help',
  '--help',
  '-h',
]);

const main = async () => {
  const [command = 'help', ...rest] = process.argv.slice(2);
  if (!commands.has(command)) return fail(`Unknown command: ${command}`, 2);
  if (command === 'help' || command === '--help' || command === '-h') return help();

  const options = parseArgs(rest);
  if (command === 'create-intent') return createIntent(options);
  if (command === 'get-intent') return getIntent(options);
  if (command === 'replay-webhook') return replayWebhook(options);
  if (command === 'verify-webhook') return verifyWebhook(options);
  if (command === 'submit-service') return submitService(options);
  if (command === 'list-applications') return listApplications(options);
  if (command === 'approve-service') return approveService(options);
  if (command === 'list-services') return listServices(options);
  if (command === 'get-service') return getService(options);
  if (command === 'request-scopes') return requestScopes(options);
  if (command === 'update-allowlists') return updateAllowlists(options);
  if (command === 'issue-api-key') return issueApiKey(options);
  if (command === 'issue-webhook-secret') return issueWebhookSecret(options);
  if (command === 'catalog') return catalog(options);
};

const createIntent = async (options: CliOptions) => {
  const client = runtimeClient(options);
  const payload = jsonOption(options, 'payload') || {
    reference: requireString(options, 'reference'),
    amount: Number(requireString(options, 'amount')),
    currency: stringOption(options, 'currency') || 'TZS',
    confirm: !boolOption(options, 'no-confirm'),
    paymentCategory: stringOption(options, 'payment-category') || 'orbi',
    paymentRail: stringOption(options, 'payment-rail') || 'orbi_wallet',
    customer: {
      ...(stringOption(options, 'customer-phone') ? { phone: stringOption(options, 'customer-phone') } : {}),
      ...(stringOption(options, 'customer-email') ? { email: stringOption(options, 'customer-email') } : {}),
      ...(stringOption(options, 'customer-id') ? { userId: stringOption(options, 'customer-id') } : {}),
    },
    ...(stringOption(options, 'return-url') ? { returnUrl: stringOption(options, 'return-url') } : {}),
  };

  const response = await client.createCheckoutPaymentIntent(payload as any, requestOptions(options));
  const data = assertOrbiSuccess(response);
  output({
    intent: data,
    nextAction: client.getPaymentIntentNextAction(data),
  });
};

const getIntent = async (options: CliOptions) => {
  const client = runtimeClient(options);
  const response = await client.getPaymentIntent(requireString(options, 'intent-id'));
  const data = assertOrbiSuccess(response);
  output({
    intent: data,
    nextAction: client.getPaymentIntentNextAction(data),
  });
};

const replayWebhook = async (options: CliOptions) => {
  const client = operatorClient(options);
  const response = await client.replayWebhookDelivery(requireString(options, 'delivery-id'), requestOptions(options));
  output(assertOrbiSuccess(response));
};

const verifyWebhook = (options: CliOptions) => {
  const secret = stringOption(options, 'secret') || process.env.ORBI_PAY_WEBHOOK_SECRET || '';
  const rawBody = stringOption(options, 'body') || fileOption(options, 'body-file');
  const signatureHeader = requireString(options, 'signature');
  const timestampHeader = requireString(options, 'timestamp');
  if (!secret) return fail('Missing webhook secret. Use --secret or ORBI_PAY_WEBHOOK_SECRET.', 2);
  if (!rawBody) return fail('Missing webhook body. Use --body or --body-file.', 2);

  const result = verifyOrbiWebhookSignature({
    rawBody,
    signatureHeader,
    timestampHeader,
    secret,
  });
  output(result);
  if (!result.ok) process.exitCode = 1;
};

const submitService = async (options: CliOptions) => {
  const client = operatorClient(options);
  const payload = developerPayload(options) || {
    legalName: requireString(options, 'legal-name'),
    displayName: requireString(options, 'display-name'),
    contactEmail: requireString(options, 'contact-email'),
    ...(stringOption(options, 'contact-phone') ? { contactPhone: stringOption(options, 'contact-phone') } : {}),
    businessType: stringOption(options, 'business-type') || 'merchant',
    countryCode: stringOption(options, 'country-code') || 'TZ',
    requestedEnvironments: csvOption(options, 'environments', ['sandbox']),
    requestedScopes: csvOption(options, 'scopes', ['payments:create', 'webhooks:receive']),
    redirectUrls: csvOption(options, 'redirect-urls', []),
    webhookUrls: csvOption(options, 'webhook-urls', []),
    useCases: csvOption(options, 'use-cases', ['Sandbox checkout integration']),
    ...(stringOption(options, 'support-email') ? { supportEmail: stringOption(options, 'support-email') } : {}),
    termsAccepted: true,
  };
  output(assertOrbiSuccess(await client.submitDeveloperServiceApplication(payload as any, requestOptions(options))));
};

const listApplications = async (options: CliOptions) => {
  const client = operatorClient(options);
  output(assertOrbiSuccess(await client.listDeveloperServiceApplications({
    ...(stringOption(options, 'status') ? { status: stringOption(options, 'status') } : {}),
  })));
};

const approveService = async (options: CliOptions) => {
  const client = operatorClient(options);
  const payload = developerPayload(options) || {
    ...(stringOption(options, 'service-code') ? { serviceCode: stringOption(options, 'service-code') } : {}),
    ...(stringOption(options, 'initial-status') ? { initialStatus: stringOption(options, 'initial-status') } : {}),
  };
  output(assertOrbiSuccess(await client.approveDeveloperServiceApplication(
    requireString(options, 'application-id'),
    payload as any,
    requestOptions(options),
  )));
};

const listServices = async (options: CliOptions) => {
  output(assertOrbiSuccess(await operatorClient(options).listDeveloperServices()));
};

const getService = async (options: CliOptions) => {
  output(assertOrbiSuccess(await operatorClient(options).getDeveloperService(requireString(options, 'service-code'))));
};

const requestScopes = async (options: CliOptions) => {
  const client = operatorClient(options);
  const payload = developerPayload(options) || {
    requestedScopes: csvOption(options, 'scopes', []),
    reason: requireString(options, 'reason'),
    environment: stringOption(options, 'environment') || 'sandbox',
  };
  output(assertOrbiSuccess(await client.requestDeveloperScopes(
    requireString(options, 'service-code'),
    payload as any,
    requestOptions(options),
  )));
};

const updateAllowlists = async (options: CliOptions) => {
  const client = operatorClient(options);
  const payload = developerPayload(options) || {
    redirectUrls: csvOption(options, 'redirect-urls', []),
    webhookUrls: csvOption(options, 'webhook-urls', []),
    reason: requireString(options, 'reason'),
    environment: stringOption(options, 'environment') || 'sandbox',
  };
  output(assertOrbiSuccess(await client.updateDeveloperAllowlists(
    requireString(options, 'service-code'),
    payload as any,
    requestOptions(options),
  )));
};

const issueApiKey = async (options: CliOptions) => {
  const client = operatorClient(options);
  output(assertOrbiSuccess(await client.issueDeveloperApiKey(
    requireString(options, 'service-code'),
    secretIssuePayload(options),
    requestOptions(options),
  )));
};

const issueWebhookSecret = async (options: CliOptions) => {
  const client = operatorClient(options);
  output(assertOrbiSuccess(await client.issueDeveloperWebhookSecret(
    requireString(options, 'service-code'),
    secretIssuePayload(options),
    requestOptions(options),
  )));
};

const catalog = async (options: CliOptions) => {
  const client = operatorClient(options);
  const type = stringOption(options, 'type') || 'sandbox';
  if (type === 'docs') return output(assertOrbiSuccess(await client.getDeveloperDocsCatalog()));
  if (type === 'sdk') return output(assertOrbiSuccess(await client.getDeveloperSdkCatalog()));
  return output(assertOrbiSuccess(await client.getDeveloperSandboxTools()));
};

const runtimeClient = (options: CliOptions) =>
  new OrbiPayGatewayClient({
    baseUrl: baseUrl(options),
    serviceKey: stringOption(options, 'service-key') || process.env.ORBI_PAY_SERVICE_KEY || '',
  });

const operatorClient = (options: CliOptions) =>
  new OrbiPayGatewayClient({
    baseUrl: baseUrl(options),
    operatorKey: stringOption(options, 'operator-key') || process.env.ORBI_PAY_OPERATOR_KEY || '',
  });

const requestOptions = (options: CliOptions) => ({
  ...(stringOption(options, 'idempotency-key') ? { idempotencyKey: stringOption(options, 'idempotency-key') } : {}),
  ...(stringOption(options, 'request-id') ? { requestId: stringOption(options, 'request-id') } : {}),
});

const baseUrl = (options: CliOptions) =>
  stringOption(options, 'base-url') || process.env.ORBI_PAY_GATEWAY_BASE_URL || 'https://pay.orbifinancial.com';

const parseArgs = (args: string[]): CliOptions => {
  const options: CliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return options;
};

const jsonOption = (options: CliOptions, key: string): unknown => {
  const value = stringOption(options, key);
  if (!value) return undefined;
  return JSON.parse(value);
};

const developerPayload = (options: CliOptions): unknown =>
  jsonOption(options, 'payload') || jsonFileOption(options, 'payload-file');

const jsonFileOption = (options: CliOptions, key: string): unknown => {
  const value = fileOption(options, key);
  return value ? JSON.parse(value) : undefined;
};

const secretIssuePayload = (options: CliOptions) => developerPayload(options) as any || {
  environment: stringOption(options, 'environment') || 'sandbox',
  requestedBy: requireString(options, 'requested-by'),
  reason: requireString(options, 'reason'),
  ...(stringOption(options, 'expires-at') ? { expiresAt: stringOption(options, 'expires-at') } : {}),
};

const csvOption = (options: CliOptions, key: string, fallback: string[]): string[] => {
  const value = stringOption(options, key);
  if (!value) return fallback;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
};

const fileOption = (options: CliOptions, key: string): string => {
  const filePath = stringOption(options, key);
  return filePath ? readFileSync(filePath, 'utf8') : '';
};

const stringOption = (options: CliOptions, key: string): string =>
  typeof options[key] === 'string' ? String(options[key]) : '';

const boolOption = (options: CliOptions, key: string): boolean => options[key] === true;

const requireString = (options: CliOptions, key: string): string => {
  const value = stringOption(options, key);
  if (!value) throw new Error(`Missing required option --${key}`);
  return value;
};

const output = (value: unknown) => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const fail = (message: string, code = 1) => {
  process.stderr.write(`${message}\n`);
  process.exitCode = code;
};

const help = () => {
  process.stdout.write(`ORBI Pay Gateway CLI

Commands:
  create-intent      Create and optionally confirm a checkout payment intent.
  get-intent         Read intent status and next action.
  replay-webhook    Replay a developer webhook delivery.
  verify-webhook    Verify an ORBI webhook signature.
  submit-service    Submit a sandbox/live service application.
  list-applications List developer service applications.
  approve-service   Approve a service application.
  list-services     List developer services.
  get-service       Read one developer service.
  request-scopes    Request additional service scopes.
  update-allowlists Add redirect and webhook URLs.
  issue-api-key     Issue one-time service API key.
  issue-webhook-secret Issue one-time webhook signing secret.
  catalog           Read docs, sandbox, or SDK catalog.

Common env:
  ORBI_PAY_GATEWAY_BASE_URL
  ORBI_PAY_SERVICE_KEY
  ORBI_PAY_OPERATOR_KEY
  ORBI_PAY_WEBHOOK_SECRET

Examples:
  orbi-pay-gateway create-intent --reference ORDER-1 --amount 1000 --currency TZS --customer-phone +255700000000 --idempotency-key payment-intent:ORDER-1
  orbi-pay-gateway get-intent --intent-id pi_123
  orbi-pay-gateway replay-webhook --delivery-id whdel_123 --request-id manual-replay-whdel-123
  orbi-pay-gateway verify-webhook --body-file webhook.json --signature sha256=... --timestamp 1780000000
  orbi-pay-gateway submit-service --legal-name "Merchant Ltd" --display-name "Merchant" --contact-email ops@example.com --scopes payments:create,webhooks:receive --redirect-urls https://merchant.example/return --webhook-urls https://merchant.example/webhooks
  orbi-pay-gateway issue-api-key --service-code merchant --environment sandbox --requested-by ops@example.com --reason "Issue sandbox key for integration testing."
`);
};

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
