import type {
  GatewayPaymentRequest,
  GatewayPaymentResponse,
  PaymentDirection,
  ProviderDefinition,
  ProviderOperationDefinition,
} from '../types.js';
import type { ProviderCredentialBinding } from '../security/providerCredentialVault.js';

export type ProtocolExecutionInput = {
  provider: ProviderDefinition;
  operation: PaymentDirection;
  endpoint: ProviderOperationDefinition;
  request: GatewayPaymentRequest;
  credentialBinding: ProviderCredentialBinding;
};

export interface PaymentProtocolEngine {
  protocol: ProviderDefinition['protocol'];
  execute(input: ProtocolExecutionInput): Promise<GatewayPaymentResponse>;
}
