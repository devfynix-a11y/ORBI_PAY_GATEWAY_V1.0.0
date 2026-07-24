import http from 'http';
import https from 'https';
import { URL } from 'url';
import { config } from '../config.js';
import type {
  NormalizedProviderEvent,
  ServiceBusinessRegistrationRequest,
  ServiceMerchantOrderPaymentStatusRequest,
  ServiceMerchantSettlementsRequest,
  ServiceIdentityResolveRequest,
  ServicePaymentProfileRequest,
  ServicePaymentChallengeResponseRequest,
  ServicePaymentRequest,
  ServicePaySafeActionRequest,
  ServicePaySafeBalanceRequest,
} from '../types.js';
import { buildSignedInternalHeaders } from '../security/internalSigner.js';

const postJsonWithNodeHttp = async (url: URL, headers: Record<string, string>, body: unknown): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const bodyText = JSON.stringify(body);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const timeoutMs = Math.max(1000, config.core.callbackTimeoutMs);
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          ...headers,
          'content-length': Buffer.byteLength(bodyText).toString(),
          'user-agent': 'orbi-pay-gateway/1.0',
        },
        ...(isHttps && config.mtls.enabled
          ? {
              cert: config.mtls.cert,
              key: config.mtls.key,
              ca: config.mtls.ca,
              rejectUnauthorized: config.mtls.rejectUnauthorized,
            }
          : {}),
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed: any = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = { raw: data };
          }
          if ((res.statusCode || 500) >= 400) {
            reject(new Error(parsed?.error || `ORBI_CORE_CALLBACK_FAILED_${res.statusCode}`));
            return;
          }
          resolve(parsed);
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`ORBI_CORE_CALLBACK_TIMEOUT_${timeoutMs}MS`));
    });
    req.write(bodyText);
    req.end();
  });

export class OrbiCoreClient {
  async submitProviderEvent(event: NormalizedProviderEvent): Promise<unknown> {
    const endpoint = new URL(config.core.trustedGatewayEventPath, config.core.baseUrl);
    const headers = buildSignedInternalHeaders({
      method: 'POST',
      path: endpoint.pathname,
      body: event,
      workerId: config.worker.id,
      scopes: config.worker.scopes,
      signingSecret: config.worker.signingSecret,
      keyId: config.worker.keyId,
    });

    return postJsonWithNodeHttp(endpoint, headers, event);
  }

  async submitServicePaymentRequest(request: ServicePaymentRequest): Promise<unknown> {
    const endpoint = new URL(config.core.trustedServicePaymentRequestPath, config.core.baseUrl);
    const headers = buildSignedInternalHeaders({
      method: 'POST',
      path: endpoint.pathname,
      body: request,
      workerId: config.worker.id,
      scopes: [...new Set([...config.worker.scopes, 'gateway:service-payments:write'])],
      signingSecret: config.worker.signingSecret,
      keyId: config.worker.keyId,
    });

    return postJsonWithNodeHttp(endpoint, headers, request);
  }

  async respondToServicePaymentChallenge(request: ServicePaymentChallengeResponseRequest): Promise<unknown> {
    const endpoint = new URL(
      `${config.core.trustedServicePaymentChallengeRespondPath}/${encodeURIComponent(request.challengeId)}/respond`,
      config.core.baseUrl,
    );
    const headers = buildSignedInternalHeaders({
      method: 'POST',
      path: endpoint.pathname,
      body: request,
      workerId: config.worker.id,
      scopes: [...new Set([...config.worker.scopes, 'gateway:service-payments:write', 'gateway:service-payments:result'])],
      signingSecret: config.worker.signingSecret,
      keyId: config.worker.keyId,
    });

    return postJsonWithNodeHttp(endpoint, {
      ...headers,
      'idempotency-key': request.idempotencyKey,
      'x-idempotency-key': request.idempotencyKey,
    }, request);
  }

  async queryPaySafeBalances(request: ServicePaySafeBalanceRequest): Promise<unknown> {
    const endpoint = new URL(config.core.trustedPaySafeBalancePath, config.core.baseUrl);
    const headers = buildSignedInternalHeaders({
      method: 'POST',
      path: endpoint.pathname,
      body: request,
      workerId: config.worker.id,
      scopes: [...new Set([...config.worker.scopes, 'gateway:paysafe-balances:read'])],
      signingSecret: config.worker.signingSecret,
      keyId: config.worker.keyId,
    });

    return postJsonWithNodeHttp(endpoint, headers, request);
  }

  async submitPaySafeAction(request: ServicePaySafeActionRequest): Promise<unknown> {
    const endpoint = new URL(config.core.trustedPaySafeActionPath, config.core.baseUrl);
    const headers = buildSignedInternalHeaders({
      method: 'POST',
      path: endpoint.pathname,
      body: request,
      workerId: config.worker.id,
      scopes: [...new Set([...config.worker.scopes, 'gateway:service-payments:write', 'gateway:service-payments:result'])],
      signingSecret: config.worker.signingSecret,
      keyId: config.worker.keyId,
    });

    return postJsonWithNodeHttp(endpoint, {
      ...headers,
      'idempotency-key': request.idempotencyKey,
      'x-idempotency-key': request.idempotencyKey,
    }, request);
  }

  async resolveIdentity(request: ServiceIdentityResolveRequest): Promise<unknown> {
    const endpoint = new URL(config.core.trustedIdentityResolvePath, config.core.baseUrl);
    const headers = buildSignedInternalHeaders({
      method: 'POST',
      path: endpoint.pathname,
      body: request,
      workerId: config.worker.id,
      scopes: [...new Set([...config.worker.scopes, 'gateway:identity:read'])],
      signingSecret: config.worker.signingSecret,
      keyId: config.worker.keyId,
    });

    return postJsonWithNodeHttp(endpoint, headers, request);
  }

  async submitBusinessRegistration(request: ServiceBusinessRegistrationRequest): Promise<unknown> {
    const endpoint = new URL(config.core.trustedBusinessRegistrationPath, config.core.baseUrl);
    const headers = buildSignedInternalHeaders({
      method: 'POST',
      path: endpoint.pathname,
      body: request,
      workerId: config.worker.id,
      scopes: [...new Set([...config.worker.scopes, 'gateway:business-registration:write'])],
      signingSecret: config.worker.signingSecret,
      keyId: config.worker.keyId,
    });

    return postJsonWithNodeHttp(endpoint, headers, request);
  }

  async createPaymentProfile(request: ServicePaymentProfileRequest): Promise<unknown> {
    const endpoint = new URL(config.core.trustedPaymentProfilePath, config.core.baseUrl);
    const headers = buildSignedInternalHeaders({
      method: 'POST',
      path: endpoint.pathname,
      body: request,
      workerId: config.worker.id,
      scopes: [...new Set([...config.worker.scopes, 'gateway:payment-profiles:write'])],
      signingSecret: config.worker.signingSecret,
      keyId: config.worker.keyId,
    });

    return postJsonWithNodeHttp(endpoint, {
      ...headers,
      ...(request.idempotencyKey ? {
        'idempotency-key': request.idempotencyKey,
        'x-idempotency-key': request.idempotencyKey,
      } : {}),
    }, request);
  }

  async queryMerchantOrderPaymentStatus(request: ServiceMerchantOrderPaymentStatusRequest): Promise<unknown> {
    const endpoint = new URL(config.core.trustedMerchantOrderPaymentStatusPath, config.core.baseUrl);
    const headers = buildSignedInternalHeaders({
      method: 'POST',
      path: endpoint.pathname,
      body: request,
      workerId: config.worker.id,
      scopes: [...new Set([...config.worker.scopes, 'gateway:merchant-payments:read'])],
      signingSecret: config.worker.signingSecret,
      keyId: config.worker.keyId,
    });

    return postJsonWithNodeHttp(endpoint, headers, request);
  }

  async queryMerchantSettlements(request: ServiceMerchantSettlementsRequest): Promise<unknown> {
    const endpoint = new URL(config.core.trustedMerchantSettlementsPath, config.core.baseUrl);
    const headers = buildSignedInternalHeaders({
      method: 'POST',
      path: endpoint.pathname,
      body: request,
      workerId: config.worker.id,
      scopes: [...new Set([...config.worker.scopes, 'gateway:merchant-settlements:read'])],
      signingSecret: config.worker.signingSecret,
      keyId: config.worker.keyId,
    });

    return postJsonWithNodeHttp(endpoint, headers, request);
  }
}

export const orbiCoreClient = new OrbiCoreClient();
