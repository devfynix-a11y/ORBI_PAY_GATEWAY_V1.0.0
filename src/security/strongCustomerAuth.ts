import type { GatewayPaymentRequest, PaymentRail, StrongCustomerAuthContext } from '../types.js';
import { config } from '../config.js';

const isAuthenticated = (sca?: StrongCustomerAuthContext) =>
  sca?.status === 'authenticated' &&
  Boolean(sca.challengeId || sca.dsTransactionId || sca.authenticationValue);

export const railRequiresStrongCustomerAuth = (rail?: PaymentRail): boolean => {
  if (!config.security.requireStrongCustomerAuth) return false;
  return rail === 'CARD_GATEWAY';
};

export const assertStrongCustomerAuth = (request: GatewayPaymentRequest) => {
  if (!railRequiresStrongCustomerAuth(request.rail)) return;

  if (!isAuthenticated(request.sca)) {
    throw new Error('STRONG_CUSTOMER_AUTH_REQUIRED');
  }
};

export const redactedScaForCore = (sca?: StrongCustomerAuthContext) => {
  if (!sca) return undefined;
  return {
    status: sca.status,
    protocol: sca.protocol,
    challengeId: sca.challengeId,
    eci: sca.eci,
    dsTransactionId: sca.dsTransactionId,
    liabilityShift: sca.liabilityShift,
    authenticatedAt: sca.authenticatedAt,
    authenticationValuePresent: Boolean(sca.authenticationValue),
  };
};
