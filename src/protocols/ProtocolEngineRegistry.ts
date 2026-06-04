import type { PaymentProtocol } from '../types.js';
import type { PaymentProtocolEngine } from './PaymentProtocolEngine.js';
import { FailClosedProtocolEngine } from './FailClosedProtocolEngine.js';
import { RestHmacEngine } from './RestHmacEngine.js';
import { RestJsonEngine } from './RestJsonEngine.js';

export class ProtocolEngineRegistry {
  private readonly engines = new Map<PaymentProtocol, PaymentProtocolEngine>();

  constructor() {
    [
      new RestJsonEngine(),
      new RestHmacEngine(),
      new FailClosedProtocolEngine('ISO8583_TCP_TLS'),
      new FailClosedProtocolEngine('SFTP_SETTLEMENT_FILE'),
      new FailClosedProtocolEngine('SDK_PROVIDER'),
      new FailClosedProtocolEngine('VPN_PRIVATE_API'),
    ].forEach((engine) => this.engines.set(engine.protocol, engine));
  }

  get(protocol: PaymentProtocol): PaymentProtocolEngine {
    const engine = this.engines.get(protocol);
    if (!engine) throw new Error(`PAYMENT_PROTOCOL_ENGINE_NOT_SUPPORTED:${protocol}`);
    return engine;
  }
}

export const protocolEngineRegistry = new ProtocolEngineRegistry();
