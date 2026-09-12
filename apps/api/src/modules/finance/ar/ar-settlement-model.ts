export type ArOpenItemSettlementStatus = 'OPEN' | 'PARTIALLY_SETTLED' | 'SETTLED';
export type ArSourceUtilizationStatus = 'FULLY_UNAPPLIED' | 'PARTIALLY_APPLIED' | 'FULLY_APPLIED';

export type ReconciliationStatus = 'PASS' | 'FAIL';
export type ReconciliationSeverity = 'WARNING' | 'ERROR' | 'CRITICAL';

export type ReconciliationExceptionCode =
  | 'SOURCE_BALANCE_MISMATCH'
  | 'OPEN_ITEM_BALANCE_MISMATCH'
  | 'ALLOCATION_SOURCE_INVALID'
  | 'ALLOCATION_TARGET_INVALID'
  | 'CUSTOMER_MISMATCH'
  | 'TENANT_SCOPE_MISMATCH'
  | 'COMPANY_SCOPE_MISMATCH'
  | 'NEGATIVE_BALANCE'
  | 'ORPHAN_ALLOCATION'
  | 'DUPLICATE_ACTIVE_ALLOCATION'
  | 'ADJUSTMENT_TENANT_MISMATCH'
  | 'ADJUSTMENT_COMPANY_MISMATCH'
  | 'ADJUSTMENT_TARGET_INVALID'
  | 'ADJUSTMENT_CUSTOMER_MISMATCH'
  | 'OVER_ADJUSTMENT'
  | 'INVALID_REVERSAL'
  | 'ADJUSTMENT_BALANCE_MISMATCH';

export interface ArOpenItemSettlementDTO {
  openItemId: string;
  arDocumentId?: string | null;
  customerId: string;
  documentType: string;
  documentNumber: string;
  originalAmount: string;
  activeAllocationsTotal: string;
  outstandingAmount: string;
  settlementStatus: ArOpenItemSettlementStatus;
}

export interface ArSourceUtilizationDTO {
  sourceId: string;
  sourceType: 'RECEIPT' | 'CREDIT_NOTE';
  customerId: string;
  totalOrGrossAmount: string;
  activeAllocationsTotal: string;
  unappliedAmount: string;
  utilizationStatus: ArSourceUtilizationStatus;
}

export interface CustomerSettlementSummaryDTO {
  tenantId: string;
  companyId: string;
  customerId: string;
  totalGrossReceivables: string;
  totalUnappliedCredits: string;
  netOutstandingReceivable: string;
  openItemsCount: number;
  settledItemsCount: number;
}

export interface ReconciliationException {
  code: ReconciliationExceptionCode;
  entityType: 'AR_DOCUMENT' | 'AR_OPEN_ITEM' | 'AR_RECEIPT' | 'AR_ALLOCATION' | 'AR_ADJUSTMENT' | 'CUSTOMER';
  entityId: string;
  tenantId: string;
  companyId: string;
  expectedAmount?: string;
  actualAmount?: string;
  message: string;
  severity: ReconciliationSeverity;
}

export interface ReconciliationResultDTO {
  status: ReconciliationStatus;
  tenantId: string;
  companyId: string;
  reconciledAt: Date;
  documentsChecked: number;
  openItemsChecked: number;
  receiptsChecked: number;
  allocationsChecked: number;
  exceptions: ReconciliationException[];
}
