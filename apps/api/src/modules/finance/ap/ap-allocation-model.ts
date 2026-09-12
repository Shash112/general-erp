export type ApAllocationSourceType = 'PAYMENT' | 'CREDIT_NOTE';
export type ApAllocationStatus = 'ACTIVE' | 'REVERSED';

export interface ApAllocationDTO {
  id: string;
  tenantId: string;
  companyId: string;
  allocationNumber?: string | null | undefined;
  allocationSourceType: ApAllocationSourceType;
  paymentId?: string | null | undefined;
  creditNoteId?: string | null | undefined;
  openItemId: string;
  allocatedAmount: string; // numeric(20,2)
  discountAmount: string; // numeric(20,2)
  discountJournalEntryId?: string | null | undefined;
  allocationDate: string;
  status: ApAllocationStatus;
  reversalAccountingDate?: string | null | undefined;
  reversedAt?: Date | null | undefined;
  reversedBy?: string | null | undefined;
  createdAt: Date;
}

export interface CreateApAllocationInput {
  allocationSourceType: ApAllocationSourceType;
  paymentId?: string | undefined;
  creditNoteId?: string | undefined;
  openItemId: string;
  allocatedAmount: string;
  discountAmount?: string | undefined;
  allocationDate?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface ReverseApAllocationInput {
  allocationId: string;
  reversalAccountingDate?: string | undefined;
  reason?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface ApAllocationFilterInput {
  paymentId?: string | undefined;
  creditNoteId?: string | undefined;
  openItemId?: string | undefined;
  allocationSourceType?: ApAllocationSourceType | undefined;
  status?: ApAllocationStatus | undefined;
}
