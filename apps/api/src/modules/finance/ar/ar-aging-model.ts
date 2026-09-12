export type ArAgingBucket = 'CURRENT' | '1_30' | '31_60' | '61_90' | '91_120' | '121_180' | 'OVER_180';

export interface ArOpenItemAgingDTO {
  openItemId: string;
  arDocumentId: string;
  customerId: string;
  documentType: string;
  documentNumber: string;
  documentDate: string;
  dueDate: string;
  asOfDate: string;
  daysOverdue: number;
  originalAmount: string;
  allocatedAmount: string;
  adjustmentAmount: string;
  outstandingAmount: string;
  bucket: ArAgingBucket;
}

export interface CustomerAgingSummaryDTO {
  tenantId: string;
  companyId: string;
  customerId: string;
  customerName?: string;
  asOfDate: string;
  current: string;
  bucket1_30: string;
  bucket31_60: string;
  bucket61_90: string;
  bucket91_120: string;
  bucket121_180: string;
  bucketOver180: string;
  totalOutstanding: string;
}

export interface CompanyAgingSummaryDTO {
  tenantId: string;
  companyId: string;
  asOfDate: string;
  current: string;
  bucket1_30: string;
  bucket31_60: string;
  bucket61_90: string;
  bucket91_120: string;
  bucket121_180: string;
  bucketOver180: string;
  totalOutstanding: string;
  customerSummaries: CustomerAgingSummaryDTO[];
}

export interface ArStatementTransactionDTO {
  id: string;
  transactionDate: string;
  documentType: string;
  documentNumber: string;
  narration: string;
  debitAmount: string;
  creditAmount: string;
  runningBalance: string;
}

export interface CustomerStatementDTO {
  tenantId: string;
  companyId: string;
  customerId: string;
  customerName?: string;
  fromDate: string;
  toDate: string;
  openingBalance: string;
  totalDebits: string;
  totalCredits: string;
  closingBalance: string;
  transactions: ArStatementTransactionDTO[];
}

export interface ArAgingQueryInput {
  asOfDate?: string;
  customerId?: string;
}

export interface CustomerStatementQueryInput {
  customerId: string;
  fromDate: string;
  toDate: string;
}
