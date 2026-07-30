const baseUrl = (process.env.PAYMENT_GATEWAY_SMOKE_BASE_URL || process.env.PAYMENT_GATEWAY_PUBLIC_BASE_URL || 'http://127.0.0.1:3100').replace(/\/+$/, '');
const allowedOrigin = process.env.PAYMENT_GATEWAY_SMOKE_ALLOWED_ORIGIN || 'https://shop.orbifinancial.com';
const deniedOrigin = process.env.PAYMENT_GATEWAY_SMOKE_DENIED_ORIGIN || 'https://evil.example.com';

const request = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  return { response, text };
};

const assertStatus = async (name, path, expected, options = {}) => {
  const { response, text } = await request(path, options);
  if (response.status !== expected) {
    throw new Error(`${name} expected HTTP ${expected}, received ${response.status}: ${text.slice(0, 240)}`);
  }
  console.log(`${name}: ${response.status}`);
  return { response, text };
};

await assertStatus('health', '/health', 200);
await assertStatus('ready', '/ready', 200);

const allowed = await assertStatus('cors_allowed', '/ready', 204, {
  method: 'OPTIONS',
  headers: {
    Origin: allowedOrigin,
    'Access-Control-Request-Method': 'GET',
  },
});

const allowedHeader = allowed.response.headers.get('access-control-allow-origin');
if (allowedHeader !== allowedOrigin) {
  throw new Error(`cors_allowed expected access-control-allow-origin=${allowedOrigin}, received ${allowedHeader}`);
}

await assertStatus('cors_denied', '/ready', 403, {
  method: 'OPTIONS',
  headers: {
    Origin: deniedOrigin,
    'Access-Control-Request-Method': 'GET',
  },
});

await assertStatus('internal_unsigned_denied', '/v1/internal/core/service-payment-events', 403, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ eventType: 'smoke.unsigned' }),
});

console.log(`runtime controls smoke passed for ${baseUrl}`);
