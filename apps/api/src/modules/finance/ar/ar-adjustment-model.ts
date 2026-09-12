export type ArAdjustmentType = 'WRITE_OFF' | 'CREDIT_ADJUSTMENT' | 'DEBIT_ADJUSTMENT';
export type ArAdjustmentStatus = 'DRAFT' | 'POSTED' | 'REVERSED' | 'ACTIVE';

export interface ArAdjustmentDTO {
  id: string;
  tenantId: string;
  companyId: string;
  customerId: string;
  openItemId: string;
  adjustmentType: ArAdjustmentType;
  amount: string;
  reason: string;
  status: ArAdjustmentStatus;
  journalEntryId?: string | null;
  reversedAt?: Date | null;
  reversedBy?: string | null;
  createdAt: Date;
}

export interface CreateArAdjustmentInput {
  companyId?: string;
  customerId: string;
  openItemId: string;
  adjustmentType: ArAdjustmentType;
  amount: string;
  reason: string;
  idempotencyKey?: string;
}

export interface PostArAdjustmentInput {
  adjustmentId: string;
  idempotencyKey?: string;
}

export interface ReverseArAdjustmentInput {
  adjustmentId?: string;
  reason: string;
  reversalDate?: string;
  idempotencyKey?: string;
}

export interface ArAdjustmentFilterInput {
  customerId?: string;
  openItemId?: string;
  adjustmentType?: ArAdjustmentType;
  status?: ArAdjustmentStatus;
}
