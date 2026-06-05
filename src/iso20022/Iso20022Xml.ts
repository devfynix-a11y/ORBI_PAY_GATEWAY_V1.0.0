import type { Iso20022CanonicalPayment } from './Iso20022Messages.js';

const escapeXml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const partyXml = (tag: string, party: Iso20022CanonicalPayment['debtor']) => `
        <${tag}>
          <Nm>${escapeXml(party.name)}</Nm>
        </${tag}>
        <${tag}Acct>
          <Id><Othr><Id>${escapeXml(party.accountId)}</Id></Othr></Id>
        </${tag}Acct>
        <${tag}Agt>
          <FinInstnId>
            ${party.agentBic ? `<BICFI>${escapeXml(party.agentBic)}</BICFI>` : ''}
            ${party.clearingSystemMemberId ? `<ClrSysMmbId><MmbId>${escapeXml(party.clearingSystemMemberId)}</MmbId></ClrSysMmbId>` : ''}
          </FinInstnId>
        </${tag}Agt>`;

export const iso20022PaymentToXml = (payment: Iso20022CanonicalPayment): string => {
  const namespace = `urn:iso:std:iso:20022:tech:xsd:${payment.messageType}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="${namespace}">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>${escapeXml(payment.messageId)}</MsgId>
      <CreDtTm>${escapeXml(payment.creationDateTime)}</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <SttlmInf>
        <SttlmMtd>${escapeXml(payment.settlementMethod)}</SttlmMtd>
        ${payment.clearingSystem ? `<ClrSys><Prtry>${escapeXml(payment.clearingSystem)}</Prtry></ClrSys>` : ''}
      </SttlmInf>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId>
        <InstrId>${escapeXml(payment.instructionId)}</InstrId>
        <EndToEndId>${escapeXml(payment.endToEndId)}</EndToEndId>
        <TxId>${escapeXml(payment.transactionId)}</TxId>
      </PmtId>
      <PmtTpInf>
        ${payment.serviceLevel ? `<SvcLvl><Prtry>${escapeXml(payment.serviceLevel)}</Prtry></SvcLvl>` : ''}
        ${payment.localInstrument ? `<LclInstrm><Prtry>${escapeXml(payment.localInstrument)}</Prtry></LclInstrm>` : ''}
      </PmtTpInf>
      <IntrBkSttlmAmt Ccy="${escapeXml(payment.currency)}">${escapeXml(payment.amount.toFixed(2))}</IntrBkSttlmAmt>
${partyXml('Dbtr', payment.debtor)}
${partyXml('Cdtr', payment.creditor)}
      ${payment.remittanceInformation ? `<RmtInf><Ustrd>${escapeXml(payment.remittanceInformation)}</Ustrd></RmtInf>` : ''}
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`;
};
