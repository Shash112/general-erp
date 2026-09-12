export type ApAgingBucket = 'CURRENT' | '1_30' | '31_60' | '61_90' | '90_PLUS';

export interface OpenItemApAgingDTO {
  openItemId: string;
  apDocumentId: string;
  supplierId: string;
  documentType: string;
  documentNumber: string;
  documentDate: string;
  dueDate: string;
  asOfDate?: string | undefined;
  originalAmount: string;
  outstandingAmount: string;
  daysOverdue: number;
  bucket: ApAgingBucket;
}

export interface SupplierApAgingDTO {
  tenantId?: string | undefined;
  companyId?: string | undefined;
  supplierId: string;
  supplierCode?: string | undefined;
  supplierName?: string | undefined;
  asOfDate?: string | undefined;
  totalOutstanding: string;
  currentAmount: string;
  bucket1To30: string;
  bucket31To60: string;
  bucket61To90: string;
  bucket90Plus: string;
  openItems: OpenItemApAgingDTO[];
  signedNetPayable?: string | undefined;
}

export interface CompanyApAgingSummaryDTO {
  tenantId: string;
  companyId: string;
  asOfDate: string;
  totalOutstanding: string;
  currentAmount: string;
  bucket1To30: string;
  bucket31To60: string;
  bucket61To90: string;
  bucket90Plus: string;
  supplierCount: number;
  suppliers: SupplierApAgingDTO[];
}

export interface SupplierStatementLineDTO {
  id: string;
  date: string;
  documentType: string;
  documentNumber: string;
  referenceNumber?: string | null | undefined;
  narration?: string | null | undefined;
  debitAmount: string;
  creditAmount: string;
  runningBalance: string;
}

export interface SupplierStatementDTO {
  tenantId: string;
  companyId: string;
  supplierId: string;
  supplierCode?: string | undefined;
  supplierName?: string | undefined;
  fromDate: string;
  toDate: string;
  openingBalance: string;
  totalDebits: string;
  totalCredits: string;
  closingBalance: string;
  lines: SupplierStatementLineDTO[];
}

export interface SupplierStatementQueryInput {
  supplierId: string;
  fromDate: string;
  toDate: string;
}

export interface ApAgingQueryInput {
  companyId: string;
  supplierId?: string | undefined;
  asOfDate?: string | undefined;
}
