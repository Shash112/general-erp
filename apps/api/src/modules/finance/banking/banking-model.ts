export type BankAccountType = 'CHECKING' | 'SAVINGS' | 'OVERDRAFT' | 'CURRENT';
export type AccountStatus = 'ACTIVE' | 'INACTIVE';

export type BankingVoucherType = 'PAYMENT' | 'RECEIPT' | 'TRANSFER';
export type BankingVoucherStatus = 'DRAFT' | 'POSTED' | 'REVERSED' | 'CANCELLED';
export type BankingSourceType = 'AP' | 'AR' | 'MANUAL' | 'TRANSFER';

export interface BankAccountDTO {
  id: string;
  tenantId: string;
  companyId: string;
  branchId: string | null;
  accountName: string;
  bankName: string;
  accountNumberMasked: string;
  accountType: BankAccountType;
  currency: string;
  glAccountId: string;
  status: AccountStatus;
  openingBalance: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CashAccountDTO {
  id: string;
  tenantId: string;
  companyId: string;
  branchId: string | null;
  accountName: string;
  currency: string;
  glAccountId: string;
  status: AccountStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BankingVoucherLineDTO {
  id: string;
  tenantId: string;
  companyId: string;
  voucherId: string;
  accountId: string;
  lineSequence: number;
  debitAmount: string;
  creditAmount: string;
  description: string | null;
}

export interface BankingVoucherDTO {
  id: string;
  tenantId: string;
  companyId: string;
  branchId: string | null;
  voucherNumber: string | null;
  voucherType: BankingVoucherType;
  transactionDate: string;
  accountingDate: string;
  currency: string;
  amount: string;
  sourceType: BankingSourceType;
  sourceId: string | null;
  bankAccountId: string | null;
  cashAccountId: string | null;
  counterAccountId: string | null;
  beneficiaryName: string | null;
  narration: string | null;
  status: BankingVoucherStatus;
  journalEntryId: string | null;
  reversalAccountingDate: string | null;
  reversedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  lines: BankingVoucherLineDTO[];
}

export interface CreateBankAccountInput {
  companyId: string;
  branchId?: string | undefined;
  accountName: string;
  bankName: string;
  accountNumber: string; // raw number provided on input, will be masked before persistence
  accountType: BankAccountType;
  currency?: string | undefined;
  glAccountId: string;
  openingBalance?: string | undefined;
}

export interface UpdateBankAccountInput {
  accountName?: string | undefined;
  bankName?: string | undefined;
  accountNumber?: string | undefined;
  accountType?: BankAccountType | undefined;
  glAccountId?: string | undefined;
  branchId?: string | undefined;
}

export interface CreateCashAccountInput {
  companyId: string;
  branchId?: string | undefined;
  accountName: string;
  currency?: string | undefined;
  glAccountId: string;
}

export interface UpdateCashAccountInput {
  accountName?: string | undefined;
  glAccountId?: string | undefined;
  branchId?: string | undefined;
}

export interface CreatePaymentVoucherInput {
  companyId: string;
  branchId?: string | undefined;
  transactionDate: string;
  accountingDate?: string | undefined;
  currency?: string | undefined;
  amount: string;
  bankAccountId?: string | undefined;
  cashAccountId?: string | undefined;
  counterAccountId?: string | undefined;
  beneficiaryName?: string | undefined;
  narration?: string | undefined;
  sourceType?: BankingSourceType | undefined;
  sourceId?: string | undefined;
  lines?: Array<{
    accountId: string;
    debitAmount: string;
    creditAmount?: string | undefined;
    description?: string | undefined;
  }> | undefined;
}

export interface CreateReceiptVoucherInput {
  companyId: string;
  branchId?: string | undefined;
  transactionDate: string;
  accountingDate?: string | undefined;
  currency?: string | undefined;
  amount: string;
  bankAccountId?: string | undefined;
  cashAccountId?: string | undefined;
  counterAccountId?: string | undefined;
  beneficiaryName?: string | undefined;
  narration?: string | undefined;
  sourceType?: BankingSourceType | undefined;
  sourceId?: string | undefined;
  lines?: Array<{
    accountId: string;
    debitAmount?: string | undefined;
    creditAmount: string;
    description?: string | undefined;
  }> | undefined;
}

export interface CreateTransferVoucherInput {
  companyId: string;
  branchId?: string | undefined;
  transactionDate: string;
  accountingDate?: string | undefined;
  currency?: string | undefined;
  amount: string;
  sourceBankAccountId?: string | undefined;
  sourceCashAccountId?: string | undefined;
  destinationBankAccountId?: string | undefined;
  destinationCashAccountId?: string | undefined;
  narration?: string | undefined;
}

export interface PostVoucherInput {
  idempotencyKey?: string | undefined;
  simulateFailure?: boolean | undefined;
}

export interface ReverseVoucherInput {
  reason: string;
  reversalAccountingDate?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface BankAccountFilterInput {
  status?: AccountStatus | undefined;
  accountType?: BankAccountType | undefined;
  currency?: string | undefined;
}

export interface CashAccountFilterInput {
  status?: AccountStatus | undefined;
  currency?: string | undefined;
}

export interface BankingVoucherFilterInput {
  status?: BankingVoucherStatus | undefined;
  voucherType?: BankingVoucherType | undefined;
  sourceType?: BankingSourceType | undefined;
  bankAccountId?: string | undefined;
  cashAccountId?: string | undefined;
  fromDate?: string | undefined;
  toDate?: string | undefined;
}

export interface AccountBalanceDTO {
  accountId: string;
  glAccountId: string;
  currency: string;
  balance: string;
  asOfDate: string;
}

export interface TransactionHistoryItemDTO {
  journalEntryId: string;
  voucherNumber: string | null;
  accountingDate: string;
  sourceModule: string;
  sourceDocumentType: string | null;
  sourceDocumentId: string | null;
  debitAmount: string;
  creditAmount: string;
  netAmount: string;
  narration: string | null;
}
