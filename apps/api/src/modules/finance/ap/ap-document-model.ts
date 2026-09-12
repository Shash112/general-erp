export type ApDocumentType = 'SUPPLIER_BILL' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'OPENING_BALANCE';
export type ApDocumentStatus = 'DRAFT' | 'POSTED' | 'PARTIALLY_SETTLED' | 'SETTLED' | 'CANCELLED' | 'REVERSED';
export type ApSupplyNature = 'INTRA_STATE' | 'INTER_STATE';
export type ApTaxability = 'TAXABLE' | 'EXEMPT' | 'NIL_RATED' | 'NON_GST';

export interface ApDocumentLineInput {
  lineSequence?: number;
  productId?: string | undefined;
  description: string;
  hsnSac?: string | undefined;
  quantity: string; // numeric(15,4)
  unitPrice: string; // numeric(20,2)
  taxableAmount?: string | undefined; // numeric(20,2)
  taxCategoryId?: string | undefined;
  taxRatePercent?: string | undefined; // numeric(9,6)
  cgstAmount?: string | undefined;
  sgstAmount?: string | undefined;
  igstAmount?: string | undefined;
  utgstAmount?: string | undefined;
  cessAmount?: string | undefined;
  taxAmount?: string | undefined;
  grossAmount?: string | undefined;
  isRcm?: boolean | undefined;
  isSez?: boolean | undefined;
  expenseAccountId: string;
}

export interface ApDocumentLineDTO {
  id: string;
  tenantId: string;
  companyId: string;
  apDocumentId: string;
  lineSequence: number;
  productId?: string | null | undefined;
  description: string;
  hsnSac?: string | null | undefined;
  quantity: string;
  unitPrice: string;
  taxableAmount: string;
  taxCategoryId?: string | null | undefined;
  taxRatePercent: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  utgstAmount: string;
  cessAmount: string;
  taxAmount: string;
  grossAmount: string;
  isRcm: boolean;
  isSez: boolean;
  expenseAccountId: string;
  createdAt: Date;
}

export interface CreateApDocumentInput {
  companyId: string;
  supplierId: string;
  branchId?: string | undefined;
  documentType: ApDocumentType;
  documentNumber?: string | undefined;
  supplierInvoiceNumber?: string | undefined;
  documentDate: string; // YYYY-MM-DD
  accountingDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  currency?: string | undefined;
  exchangeRate?: string | undefined;
  placeOfSupplyStateCode?: string | undefined;
  supplyNature?: ApSupplyNature | undefined;
  taxability?: ApTaxability | undefined;
  isRcm?: boolean | undefined;
  isSez?: boolean | undefined;
  paymentTermsDays?: number | undefined;
  remarks?: string | undefined;
  lines: ApDocumentLineInput[];
}

export interface UpdateApDocumentInput {
  supplierId?: string | undefined;
  branchId?: string | undefined;
  supplierInvoiceNumber?: string | undefined;
  documentDate?: string | undefined;
  accountingDate?: string | undefined;
  dueDate?: string | undefined;
  placeOfSupplyStateCode?: string | undefined;
  supplyNature?: ApSupplyNature | undefined;
  taxability?: ApTaxability | undefined;
  isRcm?: boolean | undefined;
  isSez?: boolean | undefined;
  paymentTermsDays?: number | undefined;
  remarks?: string | undefined;
  lines?: ApDocumentLineInput[] | undefined;
}

export interface PostApDocumentInput {
  idempotencyKey?: string | undefined;
  simulateFailure?: boolean | undefined;
}

export interface ApDocumentDTO {
  id: string;
  tenantId: string;
  companyId: string;
  supplierId: string;
  branchId?: string | null | undefined;
  documentType: ApDocumentType;
  documentNumber?: string | null | undefined;
  supplierInvoiceNumber?: string | null | undefined;
  documentDate: string;
  accountingDate: string;
  dueDate: string;
  currency: string;
  exchangeRate: string;
  placeOfSupplyStateCode?: string | null | undefined;
  supplyNature?: ApSupplyNature | null | undefined;
  taxability?: ApTaxability | null | undefined;
  isRcm: boolean;
  isSez: boolean;
  taxableAmount: string;
  taxAmount: string;
  grossAmount: string;
  outstandingAmount: string;
  allocatedAmount: string;
  unappliedAmount: string;
  status: ApDocumentStatus;
  sourceModule: string;
  sourceDocumentId?: string | null | undefined;
  journalEntryId?: string | null | undefined;
  reversalAccountingDate?: string | null | undefined;
  paymentTermsDays: number;
  remarks?: string | null | undefined;
  lines: ApDocumentLineDTO[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApOpenItemDTO {
  id: string;
  tenantId: string;
  companyId: string;
  supplierId: string;
  apDocumentId: string;
  documentType: ApDocumentType;
  documentNumber: string;
  documentDate: string;
  dueDate: string;
  currency: string;
  originalAmount: string;
  outstandingAmount: string;
  status: 'OPEN' | 'PARTIALLY_SETTLED' | 'SETTLED' | 'CANCELLED';
  createdAt: Date;
  updatedAt: Date;
}

export interface ApDocumentFilterInput {
  companyId?: string;
  supplierId?: string;
  documentType?: ApDocumentType;
  status?: ApDocumentStatus;
  fromDate?: string;
  toDate?: string;
}
