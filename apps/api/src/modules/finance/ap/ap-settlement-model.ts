export type ApOpenItemSettlementStatus = 'OPEN' | 'PARTIALLY_SETTLED' | 'SETTLED';
export type ApSourceUtilizationType = 'PAYMENT' | 'CREDIT_NOTE';
export type ApSourceUtilizationStatus = 'FULLY_UNAPPLIED' | 'PARTIALLY_APPLIED' | 'FULLY_APPLIED';

export type ApReconciliationStatus = 'PASS' | 'FAIL';
export type ApReconciliationSeverity = 'WARNING' | 'ERROR';
export type ApCalculationMode = 'LIVE' | 'HISTORICAL';

export type ApReconciliationDiagnosticCode =
  | 'SOURCE_BALANCE_MISMATCH'
  | 'OPEN_ITEM_BALANCE_MISMATCH'
  | 'UNMAPPED_GL_CONTROL_ACCOUNT'
  | 'SUBLEDGER_GL_DISCREPANCY';

export interface ApOpenItemSettlementDTO {
  openItemId: string;
  tenantId: string;
  companyId: string;
  supplierId: string;
  apDocumentId: string;
  documentNumber: string;
  documentType: string;
  documentDate: string;
  accountingDate: string;
  dueDate: string;
  originalAmount: string; // numeric(20,2)
  activeAllocationsTotal: string; // numeric(20,2)
  activeDiscountsTotal: string; // numeric(20,2)
  activeWriteOffsTotal?: string; // numeric(20,2)
  activeCreditAdjustmentsTotal?: string; // numeric(20,2)
  activeDebitAdjustmentsTotal?: string; // numeric(20,2)
  outstandingAmount: string; // numeric(20,2)
  settlementStatus: ApOpenItemSettlementStatus;
  asOfDate?: string | null | undefined;
}

export interface ApSourceUtilizationDTO {
  sourceId: string;
  sourceType: ApSourceUtilizationType;
  tenantId: string;
  companyId: string;
  supplierId: string;
  sourceNumber: string;
  sourceDate: string;
  accountingDate: string;
  totalAmount: string; // numeric(20,2)
  allocatedAmount: string; // numeric(20,2)
  unappliedAmount: string; // numeric(20,2)
  utilizationStatus: ApSourceUtilizationStatus;
  asOfDate?: string | null | undefined;
}

export interface SupplierSettlementSummaryDTO {
  tenantId: string;
  companyId: string;
  supplierId: string;
  supplierName: string;
  totalPostedBillsAmount: string; // numeric(20,2) - Informational
  totalOutstandingBillsAmount: string; // numeric(20,2) - Open item balance (+)
  openItemsCount: number;
  totalPaymentsAmount: string; // numeric(20,2) - Informational
  totalUnappliedPaymentsAmount: string; // numeric(20,2) - Source balance (-)
  totalCreditNotesAmount: string; // numeric(20,2) - Informational
  totalUnappliedCreditNotesAmount: string; // numeric(20,2) - Source balance (-)
  totalActiveAllocationsAmount: string; // numeric(20,2) - Detail
  totalPromptPaymentDiscountsAmount: string; // numeric(20,2) - Detail
  /** Signed ExactDecimal: > 0 = Amount Owed to Supplier, = 0 = Zero Net Exposure, < 0 = Supplier Credit / Advance */
  netPayableAmount: string;
  asOfDate?: string | null | undefined;
}

export interface ApReconciliationDiagnosticDTO {
  code: ApReconciliationDiagnosticCode;
  severity: ApReconciliationSeverity;
  message: string;
  details?: Record<string, any> | undefined;
}

export interface ApReconciliationResultDTO {
  tenantId: string;
  companyId: string;
  asOfDate: string;
  reconciliationStatus: ApReconciliationStatus;
  subledgerOutstandingOpenItemsTotal: string; // numeric(20,2)
  subledgerUnappliedPaymentsTotal: string; // numeric(20,2)
  subledgerUnappliedCreditNotesTotal: string; // numeric(20,2)
  /** Signed ExactDecimal: Outstanding - Unapplied Payments - Unapplied Credit Notes */
  netSubledgerPayableTotal: string;
  /** Signed ExactDecimal: GL Credits - GL Debits */
  glApControlBalance: string;
  /** Signed ExactDecimal: Subledger Net Payable - GL AP_CONTROL Balance */
  reconciliationDifference: string;
  diagnostics: ApReconciliationDiagnosticDTO[];
  reconciledAt: Date;
}
