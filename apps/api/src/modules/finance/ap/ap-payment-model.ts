export type ApPaymentMode = 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'UPI' | 'OTHER';
export type ApPaymentStatus = 'DRAFT' | 'POSTED' | 'REVERSED';

export interface ApPaymentDTO {
  id: string;
  tenantId: string;
  companyId: string;
  supplierId: string;
  paymentNumber?: string | null | undefined;
  referenceNumber?: string | null | undefined;
  remarks?: string | null | undefined;
  paymentDate: string; // YYYY-MM-DD
  accountingDate: string; // YYYY-MM-DD
  paymentMode: ApPaymentMode;
  bankAccountId?: string | null | undefined;
  totalAmount: string; // numeric(20,2)
  allocatedAmount: string; // numeric(20,2) default '0.00'
  unappliedAmount: string; // numeric(20,2)
  status: ApPaymentStatus;
  journalEntryId?: string | null | undefined;
  reversalAccountingDate?: string | null | undefined;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateApPaymentInput {
  companyId: string;
  supplierId: string;
  paymentNumber?: string | undefined;
  paymentDate: string;
  accountingDate: string;
  paymentMode: ApPaymentMode;
  bankAccountId: string;
  totalAmount: string;
  referenceNumber?: string | undefined;
  remarks?: string | undefined;
}

export interface UpdateApPaymentInput {
  supplierId?: string | undefined;
  paymentDate?: string | undefined;
  accountingDate?: string | undefined;
  paymentMode?: ApPaymentMode | undefined;
  bankAccountId?: string | undefined;
  totalAmount?: string | undefined;
  referenceNumber?: string | undefined;
  remarks?: string | undefined;
}

export interface PostApPaymentInput {
  idempotencyKey?: string | undefined;
  simulateFailure?: boolean | undefined;
}

export interface ApPaymentFilterInput {
  companyId?: string;
  supplierId?: string;
  paymentMode?: ApPaymentMode;
  status?: ApPaymentStatus;
  fromDate?: string;
  toDate?: string;
}
