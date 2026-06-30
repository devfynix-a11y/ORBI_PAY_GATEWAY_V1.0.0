import fs from 'fs';
import { config } from '../config.js';
import type { PayServiceDefinition } from '../types.js';

type PayServiceManifest = {
  services?: PayServiceDefinition[];
};

const normalizeServiceCode = (value: string) => String(value || '').trim().toLowerCase();

export class PayServiceRegistry {
  private readonly services = new Map<string, PayServiceDefinition>();

  constructor() {
    this.load();
  }

  list() {
    return [...this.services.values()].map((service) => this.publicView(service));
  }

  activeServices() {
    return [...this.services.values()].filter((service) => service.status === 'ACTIVE');
  }

  get(serviceCode: string): PayServiceDefinition {
    const service = this.services.get(normalizeServiceCode(serviceCode));
    if (!service) throw new Error('PAY_SERVICE_NOT_REGISTERED');
    if (service.status !== 'ACTIVE') throw new Error('PAY_SERVICE_DISABLED');
    return service;
  }

  publicView(service: PayServiceDefinition) {
    return {
      code: service.code,
      displayName: service.displayName,
      status: service.status,
      allowedOperations: service.allowedOperations,
      allowedCurrencies: service.allowedCurrencies,
      allowedCountries: service.allowedCountries || [],
      callbackConfigured: Boolean(process.env[service.callbackUrlEnv]?.trim()),
      metadata: service.metadata || {},
    };
  }

  private load() {
    const path = config.serviceRegistryPath;
    if (!fs.existsSync(path)) return;
    const manifest = JSON.parse(fs.readFileSync(path, 'utf8')) as PayServiceManifest;
    for (const service of manifest.services || []) {
      this.services.set(normalizeServiceCode(service.code), {
        ...service,
        code: normalizeServiceCode(service.code),
      });
    }
  }
}

export const payServiceRegistry = new PayServiceRegistry();
