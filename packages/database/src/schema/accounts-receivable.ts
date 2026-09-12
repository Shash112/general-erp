import { pgTable, uuid, varchar, text, boolean, integer, timestamp, numeric, date, uniqueIndex, foreignKey, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies, customers, products } from './master.js';
import { chartOfAccounts, journalEntries } from './accounting.js';

export const arDocuments = pgTable('ar_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  customerId: uuid('customer_id').notNull(),
  documentType: varchar('document_type', { length: 32 }).notNull(), // INVOICE, CREDIT_NOTE, DEBIT_NOTE, OPENING_BALANCE
  documentNumber: varchar('document_number', { length: 64 }),
  documentDate: date('document_date', { mode: 'string' }).notNull(),
  accountingDate: date('accounting_date', { mode: 'string' }).notNull(),
  dueDate: date('due_date', { mode: 'string' }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('INR'),
  exchangeRate: numeric('exchange_rate', { precision: 12, scale: 6 }).notNull().default('1.000000'),
  placeOfSupplyStateCode: varchar('place_of_supply_state_code', { length: 2 }),
  supplyNature: varchar('supply_nature', { length: 32 }), // INTRA_STATE, INTER_STATE
  taxability: varchar('taxability', { length: 32 }), // TAXABLE, EXEMPT, NIL_RATED, NON_GST
  isRcm: boolean('is_rcm').notNull().default(false),
  isSez: boolean('is_sez').notNull().default(false),
  taxableAmount: numeric('taxable_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  taxAmount: numeric('tax_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  grossAmount: numeric('gross_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  outstandingAmount: numeric('outstanding_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  allocatedAmount: numeric('allocated_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  unappliedAmount: numeric('unapplied_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  status: varchar('status', { length: 32 }).notNull().default('DRAFT'), // DRAFT, POSTED, PARTIALLY_SETTLED, SETTLED, CANCELLED
  sourceModule: varchar('source_module', { length: 64 }).notNull().default('AR'),
  sourceDocumentId: varchar('source_document_id', { length: 255 }),
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, { onDelete: 'restrict' }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_ar_doc_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompNumIdx: uniqueIndex('idx_ar_doc_tenant_comp_num').on(table.tenantId, table.companyId, table.documentNumber),
  tenantCompCustomerFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.customerId],
    foreignColumns: [customers.tenantId, customers.companyId, customers.id]
  }).onDelete('restrict'),
  tenantCompCustomerIdx: index('idx_ar_doc_tenant_comp_customer').on(table.tenantId, table.companyId, table.customerId),
  tenantCompDocDateIdx: index('idx_ar_doc_tenant_comp_doc_date').on(table.tenantId, table.companyId, table.documentDate),
  tenantCompAccDateIdx: index('idx_ar_doc_tenant_comp_acc_date').on(table.tenantId, table.companyId, table.accountingDate),
  tenantCompDueDateIdx: index('idx_ar_doc_tenant_comp_due_date').on(table.tenantId, table.companyId, table.dueDate),
  tenantCompStatusIdx: index('idx_ar_doc_tenant_comp_status').on(table.tenantId, table.companyId, table.status),
  outstandingPosCheck: check('chk_ar_doc_outstanding_pos', sql`outstanding_amount >= 0`),
  unappliedPosCheck: check('chk_ar_doc_unapplied_pos', sql`unapplied_amount >= 0`)
}));

export const arDocumentLines = pgTable('ar_document_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  arDocumentId: uuid('ar_document_id').notNull(),
  lineSequence: integer('line_sequence').notNull(),
  productId: uuid('product_id'),
  description: text('description').notNull(),
  hsnSac: varchar('hsn_sac', { length: 10 }),
  quantity: numeric('quantity', { precision: 15, scale: 4 }).notNull().default('1.0000'),
  unitPrice: numeric('unit_price', { precision: 20, scale: 2 }).notNull().default('0.00'),
  taxableAmount: numeric('taxable_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  taxCategoryId: uuid('tax_category_id'),
  taxRatePercent: numeric('tax_rate_percent', { precision: 9, scale: 6 }).notNull().default('0.000000'),
  cgstAmount: numeric('cgst_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  sgstAmount: numeric('sgst_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  igstAmount: numeric('igst_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  utgstAmount: numeric('utgst_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  cessAmount: numeric('cess_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  taxAmount: numeric('tax_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  grossAmount: numeric('gross_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  isRcm: boolean('is_rcm').notNull().default(false),
  isSez: boolean('is_sez').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_ar_line_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompDocFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.arDocumentId],
    foreignColumns: [arDocuments.tenantId, arDocuments.companyId, arDocuments.id]
  }).onDelete('restrict'),
  tenantCompProductFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.productId],
    foreignColumns: [products.tenantId, products.companyId, products.id]
  }).onDelete('restrict'),
  tenantCompDocIdx: index('idx_ar_line_tenant_comp_doc').on(table.tenantId, table.companyId, table.arDocumentId)
}));

export const arOpenItems = pgTable('ar_open_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  customerId: uuid('customer_id').notNull(),
  arDocumentId: uuid('ar_document_id').notNull(),
  documentType: varchar('document_type', { length: 32 }).notNull().default('INVOICE'), // INVOICE, DEBIT_NOTE, OPENING_BALANCE
  documentNumber: varchar('document_number', { length: 64 }).notNull(),
  documentDate: date('document_date', { mode: 'string' }).notNull(),
  dueDate: date('due_date', { mode: 'string' }).notNull(),
  originalAmount: numeric('original_amount', { precision: 20, scale: 2 }).notNull(),
  outstandingAmount: numeric('outstanding_amount', { precision: 20, scale: 2 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('OPEN'), // OPEN, PARTIALLY_SETTLED, SETTLED, CANCELLED
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_ar_open_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompCustomerFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.customerId],
    foreignColumns: [customers.tenantId, customers.companyId, customers.id]
  }).onDelete('restrict'),
  tenantCompDocFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.arDocumentId],
    foreignColumns: [arDocuments.tenantId, arDocuments.companyId, arDocuments.id]
  }).onDelete('restrict'),
  tenantCompCustStatusIdx: index('idx_ar_open_tenant_comp_cust_status').on(table.tenantId, table.companyId, table.customerId, table.status),
  tenantCompDueDateIdx: index('idx_ar_open_tenant_comp_due_date').on(table.tenantId, table.companyId, table.dueDate),
  outstandingPosCheck: check('chk_ar_open_outstanding_pos', sql`outstanding_amount >= 0`)
}));

export const arReceipts = pgTable('ar_receipts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  customerId: uuid('customer_id').notNull(),
  receiptNumber: varchar('receipt_number', { length: 64 }),
  receiptDate: date('receipt_date', { mode: 'string' }).notNull(),
  accountingDate: date('accounting_date', { mode: 'string' }).notNull(),
  paymentMode: varchar('payment_mode', { length: 32 }).notNull(), // CASH, BANK_TRANSFER, CHEQUE, UPI
  bankAccountId: uuid('bank_account_id'),
  totalAmount: numeric('total_amount', { precision: 20, scale: 2 }).notNull(),
  allocatedAmount: numeric('allocated_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  unappliedAmount: numeric('unapplied_amount', { precision: 20, scale: 2 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('POSTED'), // POSTED, REVERSED
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_ar_receipt_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompNumIdx: uniqueIndex('idx_ar_receipt_tenant_comp_num').on(table.tenantId, table.companyId, table.receiptNumber),
  tenantCompCustomerFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.customerId],
    foreignColumns: [customers.tenantId, customers.companyId, customers.id]
  }).onDelete('restrict'),
  tenantCompBankAccFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.bankAccountId],
    foreignColumns: [chartOfAccounts.tenantId, chartOfAccounts.companyId, chartOfAccounts.id]
  }).onDelete('restrict'),
  tenantCompCustomerIdx: index('idx_ar_receipt_tenant_comp_customer').on(table.tenantId, table.companyId, table.customerId),
  tenantCompDateIdx: index('idx_ar_receipt_tenant_comp_date').on(table.tenantId, table.companyId, table.receiptDate),
  unappliedPosCheck: check('chk_ar_receipt_unapplied_pos', sql`unapplied_amount >= 0`)
}));

export const arAllocations = pgTable('ar_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  allocationSourceType: varchar('allocation_source_type', { length: 32 }).notNull(), // RECEIPT, CREDIT_NOTE
  receiptId: uuid('receipt_id'),
  creditNoteId: uuid('credit_note_id'),
  openItemId: uuid('open_item_id').notNull(),
  allocatedAmount: numeric('allocated_amount', { precision: 20, scale: 2 }).notNull(),
  discountAmount: numeric('discount_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  allocationDate: date('allocation_date', { mode: 'string' }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('ACTIVE'), // ACTIVE, REVERSED
  reversedAt: timestamp('reversed_at', { withTimezone: true }),
  reversedBy: varchar('reversed_by', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_ar_alloc_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompReceiptFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.receiptId],
    foreignColumns: [arReceipts.tenantId, arReceipts.companyId, arReceipts.id]
  }).onDelete('restrict'),
  tenantCompCreditNoteFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.creditNoteId],
    foreignColumns: [arDocuments.tenantId, arDocuments.companyId, arDocuments.id]
  }).onDelete('restrict'),
  tenantCompOpenItemFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.openItemId],
    foreignColumns: [arOpenItems.tenantId, arOpenItems.companyId, arOpenItems.id]
  }).onDelete('restrict'),
  receiptIdx: index('idx_ar_alloc_receipt_id').on(table.tenantId, table.companyId, table.receiptId),
  creditNoteIdx: index('idx_ar_alloc_cn_id').on(table.tenantId, table.companyId, table.creditNoteId),
  openItemIdx: index('idx_ar_alloc_open_item_id').on(table.tenantId, table.companyId, table.openItemId),
  sourceExclusivityCheck: check(
    'chk_ar_alloc_source_exclusivity',
    sql`(allocation_source_type = 'RECEIPT' AND receipt_id IS NOT NULL AND credit_note_id IS NULL) OR (allocation_source_type = 'CREDIT_NOTE' AND credit_note_id IS NOT NULL AND receipt_id IS NULL)`
  ),
  amountPosCheck: check('chk_ar_alloc_amount_pos', sql`allocated_amount > 0`),
  discountPosCheck: check('chk_ar_alloc_discount_pos', sql`discount_amount >= 0`)
}));

export const arAdjustments = pgTable('ar_adjustments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  customerId: uuid('customer_id').notNull(),
  openItemId: uuid('open_item_id').notNull(),
  adjustmentType: varchar('adjustment_type', { length: 32 }).notNull(), // WRITE_OFF, CREDIT_ADJUSTMENT, DEBIT_ADJUSTMENT
  amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),
  reason: text('reason').notNull(),
  status: varchar('status', { length: 32 }).notNull().default('ACTIVE'), // ACTIVE, REVERSED
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_ar_adj_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompCustomerFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.customerId],
    foreignColumns: [customers.tenantId, customers.companyId, customers.id]
  }).onDelete('restrict'),
  tenantCompOpenItemFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.openItemId],
    foreignColumns: [arOpenItems.tenantId, arOpenItems.companyId, arOpenItems.id]
  }).onDelete('restrict'),
  tenantCompCustOpenIdx: index('idx_ar_adj_tenant_comp_cust_open').on(table.tenantId, table.companyId, table.customerId, table.openItemId)
}));

export type ArDocument = typeof arDocuments.$inferSelect;
export type NewArDocument = typeof arDocuments.$inferInsert;
export type ArDocumentLine = typeof arDocumentLines.$inferSelect;
export type NewArDocumentLine = typeof arDocumentLines.$inferInsert;
export type ArOpenItem = typeof arOpenItems.$inferSelect;
export type NewArOpenItem = typeof arOpenItems.$inferInsert;
export type ArReceipt = typeof arReceipts.$inferSelect;
export type NewArReceipt = typeof arReceipts.$inferInsert;
export type ArAllocation = typeof arAllocations.$inferSelect;
export type NewArAllocation = typeof arAllocations.$inferInsert;
export type ArAdjustment = typeof arAdjustments.$inferSelect;
export type NewArAdjustment = typeof arAdjustments.$inferInsert;
