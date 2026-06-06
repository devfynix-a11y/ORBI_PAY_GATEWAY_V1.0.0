import { loadProviderManifest } from '../providers/providerManifest.js';
import { resolveObpConsumerCredential } from '../security/tokenResolver.js';
import type { DiscoveredPaymentCapability, PaymentDirection, PaymentRail, ProviderDefinition } from '../types.js';

type ObpDiscoveryOptions = {
  bankId?: string;
  accountId?: string;
  viewId?: string;
  countryCode?: string;
  currency?: string;
};

type ObpAccountDiscoveryOptions = {
  bankId: string;
  scope?: 'latest' | 'private' | 'public' | 'all';
  accountType?: string;
};

type ObpEntitlementRequestInput = {
  bankId?: string;
  roleName: string;
};

type ObpCreateAccountInput = {
  bankId: string;
  accountId: string;
  body: unknown;
};

type ObpFetchResult = {
  path: string;
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
};

const upperCode = (value: string): string =>
  value
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();

const titleFromCode = (value: string): string =>
  upperCode(value)
    .split('_')
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part : `${part.slice(0, 1)}${part.slice(1).toLowerCase()}`)
    .join(' ');

const asArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of [
      'transaction_request_types',
      'transactionRequestTypes',
      'dynamic_entities',
      'dynamicEntities',
      'accounts',
      'bank_accounts',
      'bankAccounts',
      'banks',
    ]) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return [];
};

const pickString = (value: unknown, keys: string[]): string | undefined => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const item = record[key];
    if (typeof item === 'string' && item.trim()) return item.trim();
    if (typeof item === 'number') return String(item);
  }
  return undefined;
};

const inferRail = (name: string, fallback: PaymentRail): PaymentRail => {
  const normalized = name.toLowerCase();
  if (/(m[-_ ]?pesa|airtel|tigo|halopesa|mobile|wallet|money)/.test(normalized)) return 'MOBILE_MONEY';
  if (/(card|visa|mastercard|amex|3ds)/.test(normalized)) return 'CARD_GATEWAY';
  if (/(crypto|btc|eth|usdt|custody)/.test(normalized)) return 'CRYPTO';
  if (/(bank|tips|rtgs|ach|eft|swift|iso20022|transfer)/.test(normalized)) return 'BANK';
  return fallback;
};

const inferOperations = (name: string): PaymentDirection[] => {
  const normalized = name.toLowerCase();
  if (/(refund|reverse|reversal)/.test(normalized)) return ['refund'];
  if (/(payout|withdraw|cashout|disburse)/.test(normalized)) return ['payout'];
  if (/(collect|deposit|cashin|request|pay|transfer|mobile|bank)/.test(normalized)) return ['collection', 'payout'];
  return ['collection'];
};

const toCoreOperationCodes = (operations: PaymentDirection[]): string[] => {
  const codes = new Set<string>();
  for (const operation of operations) {
    if (operation === 'collection') codes.add('COLLECTION_REQUEST');
    if (operation === 'payout') codes.add('DISBURSEMENT_REQUEST');
    if (operation === 'refund') codes.add('REVERSAL_REQUEST');
  }
  return [...codes];
};

const sanitizeRaw = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object') return {};
  const clone: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/(secret|token|password|credential|key|authorization)/i.test(key)) continue;
    clone[key] = item;
  }
  return clone;
};

const capabilityFromName = (
  provider: ProviderDefinition,
  source: DiscoveredPaymentCapability['source'],
  name: string,
  options: ObpDiscoveryOptions,
  raw: unknown,
  priority: number,
): DiscoveredPaymentCapability => {
  const rail = inferRail(name, provider.rail);
  const operations = inferOperations(name);
  const country = upperCode(options.countryCode || provider.countries[0] || 'TZ').slice(0, 2);
  const currency = upperCode(options.currency || provider.currencies[0] || 'TZS').slice(0, 8);

  return {
    sourceProviderCode: provider.code,
    source,
    capabilityCode: upperCode(`${name}_${country}`).slice(0, 80),
    displayName: titleFromCode(name),
    rail,
    countryCode: country,
    currency,
    operations,
    operationCodes: toCoreOperationCodes(operations),
    status: 'REQUIRES_REVIEW',
    priority,
    requires: rail === 'MOBILE_MONEY' ? { msisdn: true } : rail === 'BANK' ? { accountNumber: true } : {},
    sourceReference: pickString(raw, ['id', 'code', 'name', 'value', 'type']),
    raw: sanitizeRaw(raw),
  };
};

export class ObpDiscoveryService {
  private provider(providerCode: string): ProviderDefinition {
    const provider = loadProviderManifest().find((item) => item.code === providerCode.trim().toLowerCase());
    if (!provider) throw new Error(`PAYMENT_PROVIDER_NOT_FOUND:${providerCode}`);
    if (provider.credentialScheme !== 'OBP_CONSUMER') {
      throw new Error(`PAYMENT_PROVIDER_NOT_OBP_CONSUMER:${providerCode}`);
    }
    return provider;
  }

  private baseUrl(provider: ProviderDefinition): string {
    const value = process.env[provider.baseUrlEnv]?.trim();
    if (!value) throw new Error(`PROVIDER_BASE_URL_ENV_MISSING:${provider.baseUrlEnv}`);
    if (!value.startsWith('https://')) throw new Error(`PROVIDER_BASE_URL_MUST_USE_HTTPS:${provider.baseUrlEnv}`);
    return value.replace(/\/+$/, '');
  }

  private async authHeader(provider: ProviderDefinition): Promise<string> {
    const directToken = process.env.NMB_OBP_SANDBOX_DIRECT_LOGIN_TOKEN || process.env.OBP_DIRECT_LOGIN_TOKEN;
    if (directToken?.trim()) return `DirectLogin token="${directToken.trim()}"`;

    const credential = resolveObpConsumerCredential(
      process.env[provider.credentialTokenRefEnv],
      provider.credentialMetadataEnv,
    );
    const username = process.env.NMB_OBP_SANDBOX_USERNAME || process.env.OBP_USERNAME;
    const password = process.env.NMB_OBP_SANDBOX_PASSWORD || process.env.OBP_PASSWORD;
    if (!username || !password) {
      throw new Error('OBP_DIRECT_LOGIN_USERNAME_PASSWORD_OR_TOKEN_REQUIRED');
    }

    const loginHeader = `DirectLogin username="${username}", password="${password}", consumer_key="${credential.consumerKey}"`;
    const response = await fetch(`${this.baseUrl(provider)}/my/logins/direct`, {
      method: 'POST',
      headers: { Authorization: loginHeader },
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    const token = typeof payload.token === 'string' ? payload.token : undefined;
    if (!response.ok || !token) throw new Error(`OBP_DIRECT_LOGIN_FAILED:${response.status}`);
    return `DirectLogin token="${token}"`;
  }

  private async get(provider: ProviderDefinition, path: string, authorization: string): Promise<ObpFetchResult> {
    try {
      const response = await fetch(`${this.baseUrl(provider)}${path}`, {
        method: 'GET',
        headers: {
          Authorization: authorization,
          Accept: 'application/json',
        },
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      return {
        path,
        ok: response.ok,
        status: response.status,
        data,
        error: response.ok ? undefined : pickString(data, ['message', 'error', 'status']) || response.statusText,
      };
    } catch (error: any) {
      return { path, ok: false, status: 0, error: error.message || 'OBP_FETCH_FAILED' };
    }
  }

  private async post(
    provider: ProviderDefinition,
    path: string,
    authorization: string,
    body: unknown,
  ): Promise<ObpFetchResult> {
    try {
      const response = await fetch(`${this.baseUrl(provider)}${path}`, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body ?? {}),
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      return {
        path,
        ok: response.ok,
        status: response.status,
        data,
        error: response.ok ? undefined : pickString(data, ['message', 'error', 'status']) || response.statusText,
      };
    } catch (error: any) {
      return { path, ok: false, status: 0, error: error.message || 'OBP_POST_FAILED' };
    }
  }

  private async put(
    provider: ProviderDefinition,
    path: string,
    authorization: string,
    body: unknown,
  ): Promise<ObpFetchResult> {
    try {
      const response = await fetch(`${this.baseUrl(provider)}${path}`, {
        method: 'PUT',
        headers: {
          Authorization: authorization,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body ?? {}),
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      return {
        path,
        ok: response.ok,
        status: response.status,
        data,
        error: response.ok ? undefined : pickString(data, ['message', 'error', 'status']) || response.statusText,
      };
    } catch (error: any) {
      return { path, ok: false, status: 0, error: error.message || 'OBP_PUT_FAILED' };
    }
  }

  async listBanks(providerCode: string) {
    const provider = this.provider(providerCode);
    const authorization = await this.authHeader(provider);
    const result = await this.get(provider, '/obp/v4.0.0/banks', authorization);

    return {
      provider: {
        code: provider.code,
        displayName: provider.displayName,
        baseUrlEnv: provider.baseUrlEnv,
      },
      path: result.path,
      ok: result.ok,
      status: result.status,
      error: result.error,
      banks: asArray(result.data).map(sanitizeRaw),
      note: 'Sandbox operator bank list. Use bank ids from this response for sandbox account tooling.',
    };
  }

  async requestSandboxEntitlement(providerCode: string, input: ObpEntitlementRequestInput) {
    const provider = this.provider(providerCode);
    const authorization = await this.authHeader(provider);
    const roleName = input.roleName.trim();
    if (!roleName) throw new Error('OBP_ROLE_NAME_REQUIRED');

    const result = await this.post(provider, '/obp/v3.0.0/users/current/entitlement-requests', authorization, {
      bank_id: input.bankId?.trim() || '',
      role_name: roleName,
    });

    return {
      provider: {
        code: provider.code,
        displayName: provider.displayName,
        baseUrlEnv: provider.baseUrlEnv,
      },
      path: result.path,
      ok: result.ok,
      status: result.status,
      error: result.error,
      data: sanitizeRaw(result.data),
      note: result.ok
        ? 'OBP entitlement request submitted. It may still require approval by the bank/sandbox administrator.'
        : 'OBP entitlement request failed. Your user may not be allowed to request this role.',
    };
  }

  async createSandboxAccount(providerCode: string, input: ObpCreateAccountInput) {
    const provider = this.provider(providerCode);
    const authorization = await this.authHeader(provider);
    const bankId = input.bankId.trim();
    const accountId = input.accountId.trim();
    if (!bankId) throw new Error('OBP_BANK_ID_REQUIRED');
    if (!accountId) throw new Error('OBP_ACCOUNT_ID_REQUIRED');

    const result = await this.put(
      provider,
      `/obp/v5.0.0/banks/${encodeURIComponent(bankId)}/accounts/${encodeURIComponent(accountId)}`,
      authorization,
      input.body,
    );

    return {
      provider: {
        code: provider.code,
        displayName: provider.displayName,
        baseUrlEnv: provider.baseUrlEnv,
      },
      path: result.path,
      ok: result.ok,
      status: result.status,
      error: result.error,
      data: sanitizeRaw(result.data),
      note: result.ok
        ? 'Sandbox account create request accepted by OBP.'
        : 'Sandbox account create failed. Confirm CanCreateAccount entitlement, user id, product code, branch id, and bank id.',
    };
  }

  async importSandboxData(providerCode: string, body: unknown) {
    const provider = this.provider(providerCode);
    const authorization = await this.authHeader(provider);
    const result = await this.post(provider, '/obp/v2.1.0/sandbox/data-import', authorization, body);

    return {
      provider: {
        code: provider.code,
        displayName: provider.displayName,
        baseUrlEnv: provider.baseUrlEnv,
      },
      path: result.path,
      ok: result.ok,
      status: result.status,
      error: result.error,
      data: sanitizeRaw(result.data),
      note: result.ok
        ? 'Sandbox data import accepted by OBP provider.'
        : 'Sandbox data import failed. Confirm CanCreateSandbox entitlement and payload shape.',
    };
  }

  async discoverAccounts(providerCode: string, options: ObpAccountDiscoveryOptions) {
    const provider = this.provider(providerCode);
    const authorization = await this.authHeader(provider);
    const bankId = options.bankId.trim();
    if (!bankId) throw new Error('OBP_BANK_ID_REQUIRED');

    const scope = options.scope || 'all';
    const accountTypeQuery = options.accountType?.trim()
      ? `?account_type=${encodeURIComponent(options.accountType.trim())}`
      : '';
    const paths = [
      ...(scope === 'latest' || scope === 'all'
        ? [`/obp/v6.0.0/banks/${encodeURIComponent(bankId)}/accounts${accountTypeQuery}`]
        : []),
      ...(scope === 'private' || scope === 'all'
        ? [`/obp/v3.0.0/banks/${encodeURIComponent(bankId)}/accounts/private${accountTypeQuery}`]
        : []),
      ...(scope === 'public' || scope === 'all'
        ? [`/obp/v2.0.0/banks/${encodeURIComponent(bankId)}/accounts/public`]
        : []),
    ];

    const results = await Promise.all(paths.map((path) => this.get(provider, path, authorization)));
    const accounts = new Map<string, Record<string, unknown>>();

    for (const result of results) {
      if (!result.ok) continue;
      for (const item of asArray(result.data)) {
        if (!item || typeof item !== 'object') continue;
        const record = sanitizeRaw(item);
        const accountId = pickString(record, ['id', 'account_id', 'accountId', 'number', 'label']);
        if (!accountId) continue;
        accounts.set(`${result.path}:${accountId}`, {
          ...record,
          sourcePath: result.path,
        });
      }
    }

    return {
      provider: {
        code: provider.code,
        displayName: provider.displayName,
        baseUrlEnv: provider.baseUrlEnv,
      },
      bankId,
      scope,
      accountType: options.accountType?.trim() || null,
      accounts: [...accounts.values()],
      inspected: results.map((result) => ({
        path: result.path,
        ok: result.ok,
        status: result.status,
        error: result.error,
        count: asArray(result.data).length,
      })),
      note: 'Operator-only sandbox/account discovery. Mobile apps must consume approved Core payment rails, not raw OBP accounts.',
    };
  }

  async discover(providerCode: string, options: ObpDiscoveryOptions = {}) {
    const provider = this.provider(providerCode);
    const authorization = await this.authHeader(provider);
    const bankId = options.bankId?.trim();
    const paths = [
      '/obp/v4.0.0/banks',
      '/obp/v6.0.0/management/system-dynamic-entities',
      ...(bankId ? [
        `/obp/v2.1.0/banks/${encodeURIComponent(bankId)}/transaction-request-types`,
        `/obp/v6.0.0/management/banks/${encodeURIComponent(bankId)}/dynamic-entities`,
      ] : []),
      ...(bankId && options.accountId && options.viewId ? [
        `/obp/v4.0.0/banks/${encodeURIComponent(bankId)}/accounts/${encodeURIComponent(options.accountId)}/${encodeURIComponent(options.viewId)}/transaction-request-types`,
      ] : []),
    ];

    const results = await Promise.all(paths.map((path) => this.get(provider, path, authorization)));
    const capabilities = new Map<string, DiscoveredPaymentCapability>();
    let priority = 20;

    for (const result of results) {
      if (!result.ok) continue;
      const items = asArray(result.data);
      for (const item of items) {
        const name = pickString(item, ['value', 'name', 'type', 'code', 'entityName', 'entity_name', 'id']);
        if (!name) continue;
        const lowered = name.toLowerCase();
        const isRelevant =
          result.path.includes('transaction-request-types') ||
          /(mobile|money|network|operator|payment|wallet|bank|transfer|tips|pesa|airtel|tigo|halo)/.test(lowered);
        if (!isRelevant) continue;

        const source: DiscoveredPaymentCapability['source'] = result.path.includes('transaction-request-types')
          ? 'OBP_TRANSACTION_REQUEST_TYPE'
          : result.path.includes('dynamic-entities')
            ? 'OBP_DYNAMIC_ENTITY'
            : 'OBP_BANK';
        const capability = capabilityFromName(provider, source, name, options, item, priority);
        priority += 10;
        capabilities.set(capability.capabilityCode, capability);
      }
    }

    return {
      provider: {
        code: provider.code,
        displayName: provider.displayName,
        baseUrlEnv: provider.baseUrlEnv,
      },
      bankId: bankId || null,
      capabilities: [...capabilities.values()],
      inspected: results.map((result) => ({
        path: result.path,
        ok: result.ok,
        status: result.status,
        error: result.error,
        count: asArray(result.data).length,
      })),
    };
  }
}

export const obpDiscoveryService = new ObpDiscoveryService();
