export type ArDocumentType = 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'OPENING_BALANCE';
export type ArDocumentStatus = 'DRAFT' | 'POSTED' | 'PARTIALLY_SETTLED' | 'SETTLED' | 'CANCELLED';
export type ArSupplyNature = 'INTRA_STATE' | 'INTER_STATE';
export type ArTaxability = 'TAXABLE' | 'EXEMPT' | 'NIL_RATED' | 'NON_GST';
export type ArOpenItemStatus = 'OPEN' | 'PARTIALLY_SETTLED' | 'SETTLED' | 'CANCELLED';

export interface ArDocumentLineDTO {
  id: string;
  tenantId: string;
  companyId: string;
  arDocumentId: string;
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
  createdAt: Date;
}

export interface ArDocumentDTO {
  id: string;
  tenantId: string;
  companyId: string;
  customerId: string;
  documentType: ArDocumentType;
  documentNumber?: string | null | undefined;
  documentDate: string; // YYYY-MM-DD
  accountingDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  currency: string;
  exchangeRate: string;
  placeOfSupplyStateCode?: string | null | undefined;
  supplyNature?: ArSupplyNature | null | undefined;
  taxability?: ArTaxability | null | undefined;
  isRcm: boolean;
  isSez: boolean;
  taxableAmount: string;
  taxAmount: string;
  grossAmount: string;
  outstandingAmount: string;
  allocatedAmount: string;
  unappliedAmount: string;
  status: ArDocumentStatus;
  sourceModule: string;
  sourceDocumentId?: string | null | undefined;
  journalEntryId?: string | null | undefined;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  lines: ArDocumentLineDTO[];
}

export interface ArOpenItemDTO {
  id: string;
  tenantId: string;
  companyId: string;
  customerId: string;
  arDocumentId: string;
  documentType: ArDocumentType;
  documentNumber: string;
  documentDate: string;
  dueDate: string;
  originalAmount: string;
  outstandingAmount: string;
  status: ArOpenItemStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateArDocumentLineInput {
  productId?: string | undefined;
  description: string;
  hsnSac?: string | undefined;
  quantity: string;
  unitPrice: string;
  taxCategoryId?: string | undefined;
  taxRatePercent?: string | undefined;
  cgstAmount?: string | undefined;
  sgstAmount?: string | undefined;
  igstAmount?: string | undefined;
  utgstAmount?: string | undefined;
  cessAmount?: string | undefined;
  taxableAmount?: string | undefined;
  taxAmount?: string | undefined;
  grossAmount?: string | undefined;
  isRcm?: boolean | undefined;
  isSez?: boolean | undefined;
}

export interface CreateArDocumentInput {
  companyId: string;
  customerId: string;
  documentType: ArDocumentType;
  documentNumber?: string | undefined;
  documentDate: string;
  accountingDate: string;
  dueDate: string;
  currency?: string | undefined;
  exchangeRate?: string | undefined;
  placeOfSupplyStateCode?: string | undefined;
  supplyNature?: ArSupplyNature | undefined;
  taxability?: ArTaxability | undefined;
  isRcm?: boolean | undefined;
  isSez?: boolean | undefined;
  sourceModule?: string | undefined;
  sourceDocumentId?: string | undefined;
  lines: CreateArDocumentLineInput[];
}

export interface UpdateArDocumentInput {
  customerId?: string | undefined;
  documentDate?: string | undefined;
  accountingDate?: string | undefined;
  dueDate?: string | undefined;
  placeOfSupplyStateCode?: string | undefined;
  supplyNature?: ArSupplyNature | undefined;
  taxability?: ArTaxability | undefined;
  isRcm?: boolean | undefined;
  isSez?: boolean | undefined;
  lines?: CreateArDocumentLineInput[] | undefined;
}

export interface PostArDocumentInput {
  idempotencyKey?: string | undefined;
  simulateFailure?: boolean | undefined;
}
