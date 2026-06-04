import http from 'http';
import https from 'https';
import { URL } from 'url';
import { config } from '../config.js';
import type { NormalizedProviderEvent } from '../types.js';
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
}

export const orbiCoreClient = new OrbiCoreClient();
