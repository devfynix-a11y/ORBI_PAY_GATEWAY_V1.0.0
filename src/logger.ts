export const logger = {
  info: (message: string, context: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ level: 'info', service: 'orbi-payment-gateway', message, ...context })),
  warn: (message: string, context: Record<string, unknown> = {}) =>
    console.warn(JSON.stringify({ level: 'warn', service: 'orbi-payment-gateway', message, ...context })),
  error: (message: string, context: Record<string, unknown> = {}) =>
    console.error(JSON.stringify({ level: 'error', service: 'orbi-payment-gateway', message, ...context })),
};
