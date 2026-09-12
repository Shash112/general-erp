export type ApAdjustmentType = 'WRITE_OFF' | 'CREDIT_ADJUSTMENT' | 'DEBIT_ADJUSTMENT';
export type ApAdjustmentStatus = 'DRAFT' | 'POSTED' | 'REVERSED' | 'CANCELLED';

export interface ApAdjustmentDTO {
  id: string;
  tenantId: string;
  companyId: string;
  adjustmentNumber?: string | null | undefined;
  supplierId: string;
  openItemId: string;
  adjustmentType: ApAdjustmentType;
  amount: string; // numeric(20,2)
  adjustmentDate: string;
  accountingDate: string;
  reason: string;
  status: ApAdjustmentStatus;
  journalEntryId?: string | null | undefined;
  reversalAccountingDate?: string | null | undefined;
  reversedAt?: Date | null | undefined;
  reversedBy?: string | null | undefined;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateApAdjustmentInput {
  companyId: string;
  supplierId: string;
  openItemId: string;
  adjustmentType: ApAdjustmentType;
  amount: string;
  adjustmentDate?: string | undefined;
  accountingDate?: string | undefined;
  reason: string;
  idempotencyKey?: string | undefined;
}

export interface PostApAdjustmentInput {
  adjustmentId?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface ReverseApAdjustmentInput {
  adjustmentId?: string | undefined;
  reason: string;
  reversalAccountingDate?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface ApAdjustmentFilterInput {
  supplierId?: string | undefined;
  openItemId?: string | undefined;
  adjustmentType?: ApAdjustmentType | undefined;
  status?: ApAdjustmentStatus | undefined;
}
