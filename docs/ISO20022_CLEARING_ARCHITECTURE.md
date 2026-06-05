# ISO 20022 Clearing Network Architecture

ORBI Pay Gateway is moving from provider-by-provider onboarding to an ISO 20022-first clearing gateway model.

The goal is to connect ORBI through a regulated neighbor bank or scheme participant first, then expand into TIPS and other East African or global payment pipelines without rewriting ORBI Core.

## Strategic Model

```txt
ORBI Mobile / Merchant / Agent
  -> ORBI Core Banking Engine
  -> ORBI Pay Gateway
  -> Neighbor Bank / Scheme Participant
  -> TIPS / National Switch / Regional Switch
  -> Receiving Bank / Wallet / Merchant
```

ORBI Core remains the source of truth for users, wallets, balances, limits, risk, fees, and double-entry ledger posting.

ORBI Pay Gateway owns clearing-network connectivity, ISO 20022 message mapping, scheme transport, tokenized credentials, message signing, and callback normalization.

## Why ISO 20022 First

ISO 20022 gives ORBI a global financial messaging grammar instead of building every provider from scratch.

It allows ORBI to standardize:

- party information
- account identifiers
- debtor and creditor agents
- end-to-end references
- transaction identifiers
- settlement amounts
- remittance information
- payment status reports
- payment returns
- reconciliation statements

The first production target can be TIPS through a neighbor bank. Later targets can include EAPS, RTGS, ACH-like rails, card switch clearing, and bank-specific private APIs.

## Canonical ORBI To ISO 20022 Mapping

| ORBI Concept | ISO 20022 Concept |
| --- | --- |
| transaction reference | `EndToEndId`, `InstrId`, `TxId` |
| amount and currency | `IntrBkSttlmAmt` |
| sender wallet/account | debtor party/account |
| receiver wallet/account | creditor party/account |
| provider/rail profile | clearing system and local instrument |
| payment purpose/description | remittance information |
| provider result | `pacs.002` status or provider callback |
| refund/return | `pacs.004` payment return |

## Message Families

Initial ORBI support:

- `pacs.008`: FI-to-FI customer credit transfer for interbank or wallet-to-bank movement.
- `pacs.002`: payment status report from clearing participant or switch.
- `pacs.004`: payment return/refund.

Future support:

- `pain.001`: customer credit transfer initiation where required by a partner bank.
- `camt.053`: statement/reconciliation.
- `camt.054`: debit/credit notification.
- `admi.*`: administrative and scheme-level messages.

## Protocol Engines

ORBI Pay Gateway now supports protocol selection by manifest:

| Protocol | Role | Production Posture |
| --- | --- | --- |
| `ISO20022_REST_JSON` | ISO 20022 semantic payload over HTTPS JSON. | Generic-live for partners exposing JSON APIs. |
| `ISO20022_REST_XML` | ISO 20022 XML document over HTTPS. | Generic-live for partners exposing XML-over-HTTPS APIs. |
| `ISO20022_MTLS` | ISO 20022 over certified mTLS/private scheme network. | Fail-closed until certificates, participant profile, and scheme certification are complete. |
| `ISO8583_TCP_TLS` | Legacy switch/card/bank dialect. | Fail-closed until bank-specific profile is certified. |

## TIPS / Neighbor Bank Profile

TIPS should not be configured as a hardcoded adapter. It should be configured as a clearing-network profile:

```json
{
  "code": "tips-neighbor-bank",
  "displayName": "TIPS Neighbor Bank Clearing Profile",
  "rail": "BANK",
  "protocol": "ISO20022_REST_XML",
  "protocolProfile": "tips-iso20022-pacs-v1",
  "countries": ["TZ"],
  "currencies": ["TZS"],
  "operations": ["collection", "payout", "refund"]
}
```

Required production profile references:

- ORBI participant ID or sponsored participant ID.
- Neighbor bank participant ID.
- ISO 20022 implementation guide version.
- mTLS certificate profile.
- VPN/private-link profile where required.
- message signing profile.
- callback endpoint and signature policy.
- scheme cutoff windows and settlement calendar.

## Security Requirements

Every ISO 20022 rail must enforce:

- HTTPS/TLS at minimum.
- mTLS for private participant links where available.
- tokenized credentials via vault/HSM/KMS references.
- idempotency on every payment instruction.
- message-level reference uniqueness.
- webhook/callback raw body signing.
- timestamp freshness and replay protection.
- Core signed callback verification before ledger finalization.

The gateway never posts balances. It only submits verified clearing events to ORBI Core.

## Production Readiness Gates

A clearing network profile can go live only after:

- bank/scheme legal onboarding is complete.
- participant IDs are issued.
- test certificates are installed.
- ISO 20022 message samples pass certification.
- callback signatures are verified.
- reconciliation files or status reports are mapped.
- Core can reconcile provider status to ledger state.
- operational dashboards show live provider readiness.

Until then, certified/private protocols remain fail-closed by design.
