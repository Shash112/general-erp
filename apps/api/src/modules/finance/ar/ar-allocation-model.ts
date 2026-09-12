export type ArAllocationSourceType = 'RECEIPT' | 'CREDIT_NOTE';
export type ArAllocationStatus = 'ACTIVE' | 'REVERSED';

export interface ArAllocationDTO {
  id: string;
  tenantId: string;
  companyId: string;
  allocationSourceType: ArAllocationSourceType;
  receiptId?: string | null;
  creditNoteId?: string | null;
  openItemId: string;
  allocatedAmount: string;
  discountAmount: string;
  allocationDate: string;
  status: ArAllocationStatus;
  reversedAt?: Date | null;
  reversedBy?: string | null;
  createdAt: Date;
}

export interface CreateArAllocationInput {
  allocationSourceType: ArAllocationSourceType;
  receiptId?: string;
  creditNoteId?: string;
  openItemId: string;
  allocatedAmount: string;
  discountAmount?: string;
  allocationDate?: string;
  idempotencyKey?: string;
}

export interface ReverseArAllocationInput {
  allocationId: string;
  reason?: string;
}

export interface ArAllocationFilterInput {
  receiptId?: string;
  creditNoteId?: string;
  openItemId?: string;
  allocationSourceType?: ArAllocationSourceType;
  status?: ArAllocationStatus;
}
