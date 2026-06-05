import type { GatewayPaymentRequest, PaymentDirection, ProviderDefinition } from '../types.js';

export type Iso20022MessageType = 'pacs.008.001.08' | 'pacs.004.001.09';

export type Iso20022Party = {
  name: string;
  accountId: string;
  agentBic?: string;
  clearingSystemMemberId?: string;
};

export type Iso20022CanonicalPayment = {
  messageType: Iso20022MessageType;
  messageId: string;
  creationDateTime: string;
  instructionId: string;
  endToEndId: string;
  transactionId: string;
  amount: number;
  currency: string;
  debtor: Iso20022Party;
  creditor: Iso20022Party;
  remittanceInformation?: string;
  settlementMethod: 'CLRG' | 'INDA' | 'INGA';
  clearingSystem?: string;
  localInstrument?: string;
  serviceLevel?: string;
};

const metadataRecord = (request: GatewayPaymentRequest) =>
  (request.metadata && typeof request.metadata === 'object' ? request.metadata : {}) as Record<string, unknown>;

const partyFromMetadata = (
  source: unknown,
  fallbackName: string,
  fallbackAccountId: string,
): Iso20022Party => {
  const record = (source && typeof source === 'object' ? source : {}) as Record<string, unknown>;
  return {
    name: String(record.name || fallbackName),
    accountId: String(record.accountId || record.iban || record.walletId || fallbackAccountId),
    agentBic: record.agentBic ? String(record.agentBic) : undefined,
    clearingSystemMemberId: record.clearingSystemMemberId ? String(record.clearingSystemMemberId) : undefined,
  };
};

export const iso20022MessageTypeForOperation = (operation: PaymentDirection): Iso20022MessageType =>
  operation === 'refund' ? 'pacs.004.001.09' : 'pacs.008.001.08';

export const buildIso20022CanonicalPayment = (
  provider: ProviderDefinition,
  operation: PaymentDirection,
  request: GatewayPaymentRequest,
): Iso20022CanonicalPayment => {
  const metadata = metadataRecord(request);
  const debtor = partyFromMetadata(
    metadata.debtor,
    operation === 'collection' ? 'External Debtor' : 'ORBI Settlement Account',
    request.accountNumber || request.walletId || request.phone || request.reference,
  );
  const creditor = partyFromMetadata(
    metadata.creditor,
    operation === 'collection' ? 'ORBI Settlement Account' : 'External Creditor',
    request.accountNumber || request.walletId || request.phone || request.reference,
  );

  return {
    messageType: iso20022MessageTypeForOperation(operation),
    messageId: `${provider.code}-${request.reference}`,
    creationDateTime: new Date().toISOString(),
    instructionId: request.reference,
    endToEndId: String(metadata.endToEndId || request.reference),
    transactionId: String(metadata.transactionId || request.reference),
    amount: request.amount,
    currency: request.currency,
    debtor,
    creditor,
    remittanceInformation: request.description,
    settlementMethod: String(metadata.settlementMethod || 'CLRG') as Iso20022CanonicalPayment['settlementMethod'],
    clearingSystem: String(metadata.clearingSystem || provider.protocolProfile || 'ISO20022'),
    localInstrument: metadata.localInstrument ? String(metadata.localInstrument) : undefined,
    serviceLevel: metadata.serviceLevel ? String(metadata.serviceLevel) : undefined,
  };
};

export const iso20022PaymentToJson = (payment: Iso20022CanonicalPayment) => ({
  document: {
    messageType: payment.messageType,
    groupHeader: {
      messageId: payment.messageId,
      creationDateTime: payment.creationDateTime,
      numberOfTransactions: 1,
      settlementInformation: {
        settlementMethod: payment.settlementMethod,
        clearingSystem: payment.clearingSystem,
      },
    },
    creditTransferTransactionInformation: {
      paymentIdentification: {
        instructionId: payment.instructionId,
        endToEndId: payment.endToEndId,
        transactionId: payment.transactionId,
      },
      paymentTypeInformation: {
        serviceLevel: payment.serviceLevel,
        localInstrument: payment.localInstrument,
      },
      interbankSettlementAmount: {
        currency: payment.currency,
        amount: payment.amount,
      },
      debtor: payment.debtor,
      creditor: payment.creditor,
      remittanceInformation: payment.remittanceInformation,
    },
  },
});
