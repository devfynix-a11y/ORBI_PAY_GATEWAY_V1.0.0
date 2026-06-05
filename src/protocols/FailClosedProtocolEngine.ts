import type { PaymentProtocolEngine, ProtocolExecutionInput } from './PaymentProtocolEngine.js';
import type { PaymentProtocol } from '../types.js';

export class FailClosedProtocolEngine implements PaymentProtocolEngine {
  constructor(public readonly protocol: PaymentProtocol) {}

  get capabilities() {
    const batch = this.protocol === 'SFTP_SETTLEMENT_FILE';
    return {
      executionMode: 'fail-closed',
      certificationRequired: true,
      supportsOnlineAuthorization: !batch,
      supportsWebhookCallbacks: !batch,
      supportsBatchSettlement: batch,
      networkControls: this.networkControls(),
      settlementModel: batch ? 'batch-file' : 'provider-specific',
    } as const;
  }

  async execute(input: ProtocolExecutionInput): Promise<never> {
    throw new Error(
      `PAYMENT_PROTOCOL_ENGINE_NOT_ENABLED:${this.protocol}:${input.provider.code}:${input.operation}. ` +
      'This protocol requires a certified connector profile, secure network setup, and provider acceptance testing.',
    );
  }

  private networkControls() {
    if (this.protocol === 'ISO8583_TCP_TLS') return ['PRIVATE_CONNECTIVITY', 'TLS_OR_MTLS', 'ISO8583_PROFILE', 'BANK_CERTIFICATION'];
    if (this.protocol === 'ISO20022_MTLS') return ['PRIVATE_CONNECTIVITY', 'MTLS_PROFILE', 'ISO20022_PROFILE', 'PARTICIPANT_ID', 'SCHEME_CERTIFICATION'];
    if (this.protocol === 'SFTP_SETTLEMENT_FILE') return ['SFTP_KEYPAIR', 'PGP_FILE_ENCRYPTION', 'SETTLEMENT_FILE_CONTRACT'];
    if (this.protocol === 'SDK_PROVIDER') return ['PROVIDER_SDK_WRAPPER', 'TOKENIZED_CREDENTIAL_REFERENCE', 'SDK_CERTIFICATION'];
    if (this.protocol === 'VPN_PRIVATE_API') return ['VPN_OR_PRIVATE_LINK', 'MTLS_PROFILE', 'HMAC_OR_JWS_SIGNING'];
    return ['CERTIFIED_CONNECTOR_PROFILE'];
  }
}
