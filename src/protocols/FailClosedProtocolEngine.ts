import type { PaymentProtocolEngine, ProtocolExecutionInput } from './PaymentProtocolEngine.js';
import type { PaymentProtocol } from '../types.js';

export class FailClosedProtocolEngine implements PaymentProtocolEngine {
  constructor(public readonly protocol: PaymentProtocol) {}

  async execute(input: ProtocolExecutionInput): Promise<never> {
    throw new Error(
      `PAYMENT_PROTOCOL_ENGINE_NOT_ENABLED:${this.protocol}:${input.provider.code}:${input.operation}. ` +
      'This protocol requires a certified connector profile, secure network setup, and provider acceptance testing.',
    );
  }
}
