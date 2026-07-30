import type { PayServiceOperation, PaymentIntent } from '../types.js';
import type { DeveloperScopeSchema } from '../contracts/developerPortalContract.js';
import type { z } from 'zod';

export type DeveloperScope = z.infer<typeof DeveloperScopeSchema>;
export type PaySafeAction = 'create_escrow' | 'release' | 'refund' | 'dispute';

const paySafeActionFromMetadata = (metadata?: Record<string, unknown>): PaySafeAction | null => {
  const action = String(metadata?.paySafeAction || '').trim();
  if (action === 'create_escrow' || action === 'release' || action === 'refund' || action === 'dispute') {
    return action;
  }
  return null;
};

export const scopeForPaySafeAction = (action: PaySafeAction): DeveloperScope => {
  switch (action) {
    case 'create_escrow':
      return 'escrow:create';
    case 'release':
      return 'escrow:release:request';
    case 'refund':
      return 'escrow:refund:request';
    case 'dispute':
      return 'escrow:dispute:create';
  }
};

export const scopeForPaymentOperation = (
  operation: PayServiceOperation,
  metadata?: Record<string, unknown>,
): DeveloperScope => {
  if (operation === 'paysafe') {
    return scopeForPaySafeAction(paySafeActionFromMetadata(metadata) || 'create_escrow');
  }
  if (operation === 'payout') return 'withdrawal:request';
  return 'payments:create';
};

export const scopeForPaymentIntent = (intent: Pick<PaymentIntent, 'operation' | 'metadata'>): DeveloperScope =>
  scopeForPaymentOperation(intent.operation, intent.metadata);
