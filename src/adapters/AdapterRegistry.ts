import type { PaymentProviderAdapter } from '../types.js';
import { MpesaTanzaniaAdapter } from './mpesa-tanzania/MpesaTanzaniaAdapter.js';
import { SelcomAdapter } from './selcom/SelcomAdapter.js';

export class AdapterRegistry {
  private readonly adapters = new Map<string, PaymentProviderAdapter>();

  constructor() {
    [new SelcomAdapter(), new MpesaTanzaniaAdapter()].forEach((adapter) => {
      this.adapters.set(adapter.code, adapter);
    });
  }

  list() {
    return [...this.adapters.values()].map((adapter) => ({
      code: adapter.code,
      displayName: adapter.displayName,
    }));
  }

  async readiness() {
    return Promise.all(
      [...this.adapters.values()].map(async (adapter) => ({
        code: adapter.code,
        displayName: adapter.displayName,
        health: await adapter.health(),
      })),
    );
  }

  get(providerCode: string): PaymentProviderAdapter {
    const adapter = this.adapters.get(String(providerCode || '').trim().toLowerCase());
    if (!adapter) {
      throw new Error('PAYMENT_PROVIDER_NOT_SUPPORTED');
    }
    return adapter;
  }
}

export const adapterRegistry = new AdapterRegistry();
