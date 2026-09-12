export type ArPaymentMode = 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'UPI' | 'OTHER';
export type ArReceiptStatus = 'DRAFT' | 'POSTED' | 'REVERSED';

export interface ArReceiptDTO {
  id: string;
  tenantId: string;
  companyId: string;
  customerId: string;
  receiptNumber?: string | null | undefined;
  referenceNumber?: string | null | undefined;
  remarks?: string | null | undefined;
  receiptDate: string; // YYYY-MM-DD
  accountingDate: string; // YYYY-MM-DD
  paymentMode: ArPaymentMode;
  bankAccountId?: string | null | undefined;
  totalAmount: string; // numeric(20,2)
  allocatedAmount: string; // numeric(20,2) default '0.00'
  unappliedAmount: string; // numeric(20,2)
  status: ArReceiptStatus;
  journalEntryId?: string | null | undefined;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateArReceiptInput {
  companyId: string;
  customerId: string;
  receiptNumber?: string | undefined;
  receiptDate: string;
  accountingDate: string;
  paymentMode: ArPaymentMode;
  bankAccountId: string;
  totalAmount: string;
}

export interface UpdateArReceiptInput {
  customerId?: string | undefined;
  receiptDate?: string | undefined;
  accountingDate?: string | undefined;
  paymentMode?: ArPaymentMode | undefined;
  bankAccountId?: string | undefined;
  totalAmount?: string | undefined;
  referenceNumber?: string | undefined;
  remarks?: string | undefined;
}

export interface PostArReceiptInput {
  idempotencyKey?: string | undefined;
  simulateFailure?: boolean | undefined;
}
