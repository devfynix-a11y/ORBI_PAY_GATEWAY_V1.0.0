import crypto from 'crypto';

export type SandboxAccount = {
  accountId: string;
  displayName: string;
  customerId: string;
  role: 'buyer' | 'seller' | 'member' | 'agent';
  currency: string;
  balance: number;
  status: 'active';
};

export type SandboxTransferInput = {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  currency: string;
  reference: string;
  description?: string;
};

export type SandboxTransfer = SandboxTransferInput & {
  transferId: string;
  status: 'completed';
  balanceAfter: {
    from: number;
    to: number;
  };
  createdAt: string;
};

const seedAccounts = (): SandboxAccount[] => [
  {
    accountId: 'sbx_buyer_daniel',
    displayName: 'Daniel Zakaria',
    customerId: 'OB-SBX-0001',
    role: 'buyer',
    currency: 'TZS',
    balance: 1000000,
    status: 'active',
  },
  {
    accountId: 'sbx_seller_catherine',
    displayName: 'Catherine Daniel',
    customerId: 'OB-SBX-0002',
    role: 'seller',
    currency: 'TZS',
    balance: 250000,
    status: 'active',
  },
  {
    accountId: 'sbx_saccos_member',
    displayName: 'SACCOS Member',
    customerId: 'OB-SBX-0003',
    role: 'member',
    currency: 'TZS',
    balance: 500000,
    status: 'active',
  },
  {
    accountId: 'sbx_agent_dar',
    displayName: 'ORBI Agent Dar',
    customerId: 'OB-SBX-AG01',
    role: 'agent',
    currency: 'TZS',
    balance: 750000,
    status: 'active',
  },
];

export class SandboxSimulatorStore {
  private accounts = seedAccounts();
  private transfers: SandboxTransfer[] = [];

  reset() {
    this.accounts = seedAccounts();
    this.transfers = [];
    return this.snapshot();
  }

  snapshot() {
    return {
      environment: 'sandbox' as const,
      moneyMode: 'simulated' as const,
      ledgerMode: 'no_core_ledger_commit' as const,
      accounts: this.accounts,
      transfers: this.transfers,
      totals: this.accounts.reduce<Record<string, number>>((totals, account) => {
        totals[account.currency] = (totals[account.currency] || 0) + account.balance;
        return totals;
      }, {}),
    };
  }

  listAccounts() {
    return this.accounts;
  }

  getAccount(accountId: string) {
    const account = this.accounts.find((item) => item.accountId === accountId);
    if (!account) throw new Error('SANDBOX_ACCOUNT_NOT_FOUND');
    return account;
  }

  createTransfer(input: SandboxTransferInput) {
    if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('SANDBOX_TRANSFER_AMOUNT_INVALID');
    const currency = input.currency.toUpperCase();
    const from = this.getAccount(input.fromAccountId);
    const to = this.getAccount(input.toAccountId);
    if (from.currency !== currency || to.currency !== currency) throw new Error('SANDBOX_TRANSFER_CURRENCY_MISMATCH');
    if (from.balance < input.amount) throw new Error('SANDBOX_INSUFFICIENT_FUNDS');

    from.balance = roundMoney(from.balance - input.amount);
    to.balance = roundMoney(to.balance + input.amount);
    const transfer: SandboxTransfer = {
      ...input,
      currency,
      transferId: `sbx_tx_${crypto.randomUUID().replace(/-/g, '')}`,
      status: 'completed',
      balanceAfter: {
        from: from.balance,
        to: to.balance,
      },
      createdAt: new Date().toISOString(),
    };
    this.transfers.unshift(transfer);
    return transfer;
  }

  buildWebhookEvent(transferId: string) {
    const transfer = this.transfers.find((item) => item.transferId === transferId);
    if (!transfer) throw new Error('SANDBOX_TRANSFER_NOT_FOUND');
    return {
      eventId: `evt_sbx_${crypto.randomUUID().replace(/-/g, '')}`,
      eventType: 'payment_intent.updated',
      serviceCode: 'sandbox-simulator',
      paymentIntent: {
        id: transfer.transferId,
        status: transfer.status,
        reference: transfer.reference,
        amount: transfer.amount,
        currency: transfer.currency,
      },
    };
  }
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export const sandboxSimulatorStore = new SandboxSimulatorStore();
