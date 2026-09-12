export interface BaseReportFilterInput {
  companyId: string;
  branchId?: string | undefined;
  departmentId?: string | undefined;
}

export interface TrialBalanceFilterInput extends BaseReportFilterInput {
  asOfDate?: string | undefined; // "YYYY-MM-DD"
  fromDate?: string | undefined;
  toDate?: string | undefined;
  fiscalYearId?: string | undefined;
  fiscalPeriodId?: string | undefined;
  includeZeroBalances?: boolean | undefined;
}

export interface GeneralLedgerFilterInput extends BaseReportFilterInput {
  accountId?: string | undefined;
  accountGroupId?: string | undefined;
  fromDate?: string | undefined;
  toDate?: string | undefined;
  fiscalYearId?: string | undefined;
  fiscalPeriodId?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

export interface ProfitLossFilterInput extends BaseReportFilterInput {
  fromDate: string; // "YYYY-MM-DD"
  toDate: string; // "YYYY-MM-DD"
  comparativeFromDate?: string | undefined;
  comparativeToDate?: string | undefined;
}

export interface BalanceSheetFilterInput extends BaseReportFilterInput {
  asOfDate: string; // "YYYY-MM-DD"
  comparativeAsOfDate?: string | undefined;
}

export interface ReconciliationFilterInput extends BaseReportFilterInput {
  asOfDate?: string | undefined;
}

export interface TrialBalanceRowDTO {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  normalBalance: 'DEBIT' | 'CREDIT';
  debitTotal: string;
  creditTotal: string;
  debitBalance: string;
  creditBalance: string;
  netBalance: string;
}

export interface TrialBalanceReportDTO {
  tenantId: string;
  companyId: string;
  asOfDate: string;
  totalDebit: string;
  totalCredit: string;
  isBalanced: boolean;
  rows: TrialBalanceRowDTO[];
  generatedAt: Date;
}

export interface GeneralLedgerLineDTO {
  journalEntryId: string;
  voucherNumber: string | null;
  accountingDate: string;
  sourceModule: string;
  sourceDocumentType: string | null;
  sourceDocumentId: string | null;
  accountId: string;
  accountCode: string;
  accountName: string;
  narration: string | null;
  debitAmount: string;
  creditAmount: string;
  runningBalance: string;
  lineSequence: number;
}

export interface GeneralLedgerReportDTO {
  tenantId: string;
  companyId: string;
  accountId?: string | undefined;
  fromDate?: string | undefined;
  toDate?: string | undefined;
  openingBalance: string;
  closingBalance: string;
  totalDebit: string;
  totalCredit: string;
  lines: GeneralLedgerLineDTO[];
  meta: {
    totalCount: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  generatedAt: Date;
}

export interface FinancialReportRowDTO {
  accountId?: string | undefined;
  accountCode?: string | undefined;
  accountName: string;
  currentAmount: string;
  comparativeAmount?: string | undefined;
  isSubtotal?: boolean | undefined;
  isTotal?: boolean | undefined;
  level?: number | undefined;
}

export interface FinancialReportSectionDTO {
  title: string;
  sectionTotal: string;
  comparativeSectionTotal?: string | undefined;
  rows: FinancialReportRowDTO[];
}

export interface ProfitLossReportDTO {
  tenantId: string;
  companyId: string;
  fromDate: string;
  toDate: string;
  comparativeFromDate?: string | undefined;
  comparativeToDate?: string | undefined;
  revenue: FinancialReportSectionDTO;
  expenses: FinancialReportSectionDTO;
  totalRevenue: string;
  totalExpense: string;
  netProfit: string;
  comparativeTotalRevenue?: string | undefined;
  comparativeTotalExpense?: string | undefined;
  comparativeNetProfit?: string | undefined;
  generatedAt: Date;
}

export interface BalanceSheetReportDTO {
  tenantId: string;
  companyId: string;
  asOfDate: string;
  comparativeAsOfDate?: string | undefined;
  assets: FinancialReportSectionDTO;
  liabilities: FinancialReportSectionDTO;
  equity: FinancialReportSectionDTO;
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  totalLiabilitiesAndEquity: string;
  isBalanced: boolean;
  comparativeTotalAssets?: string | undefined;
  comparativeTotalLiabilitiesAndEquity?: string | undefined;
  generatedAt: Date;
}

export interface SubledgerReconciliationItemDTO {
  subledgerType: 'AP_CONTROL' | 'AR_CONTROL' | 'CASH_BANK';
  accountId: string;
  accountCode: string;
  accountName: string;
  glBalance: string;
  subledgerBalance: string;
  discrepancy: string;
  status: 'RECONCILED' | 'DISCREPANCY_DETECTED';
}

export interface ReconciliationReportDTO {
  tenantId: string;
  companyId: string;
  asOfDate: string;
  items: SubledgerReconciliationItemDTO[];
  hasDiscrepancies: boolean;
  generatedAt: Date;
}
