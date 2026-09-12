import { pgTable, uuid, varchar, text, boolean, integer, timestamp, numeric, date, uniqueIndex, foreignKey, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies, suppliers, products } from './master.js';
import { chartOfAccounts, journalEntries } from './accounting.js';

export const apDocuments = pgTable('ap_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  supplierId: uuid('supplier_id').notNull(),
  documentType: varchar('document_type', { length: 32 }).notNull(), // SUPPLIER_BILL, CREDIT_NOTE, DEBIT_NOTE, OPENING_BALANCE
  documentNumber: varchar('document_number', { length: 64 }),
  supplierInvoiceNumber: varchar('supplier_invoice_number', { length: 64 }),
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
  status: varchar('status', { length: 32 }).notNull().default('DRAFT'), // DRAFT, POSTED, PARTIALLY_SETTLED, SETTLED, CANCELLED, REVERSED
  sourceModule: varchar('source_module', { length: 64 }).notNull().default('AP'),
  sourceDocumentId: varchar('source_document_id', { length: 255 }),
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, { onDelete: 'restrict' }),
  paymentTermsDays: integer('payment_terms_days').default(30),
  remarks: text('remarks'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_ap_doc_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompNumIdx: uniqueIndex('idx_ap_doc_tenant_comp_num').on(table.tenantId, table.companyId, table.documentNumber),
  tenantCompSupplierFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.supplierId],
    foreignColumns: [suppliers.tenantId, suppliers.companyId, suppliers.id]
  }).onDelete('restrict'),
  tenantCompSupplierIdx: index('idx_ap_doc_tenant_comp_supplier').on(table.tenantId, table.companyId, table.supplierId),
  tenantCompDocDateIdx: index('idx_ap_doc_tenant_comp_doc_date').on(table.tenantId, table.companyId, table.documentDate),
  tenantCompAccDateIdx: index('idx_ap_doc_tenant_comp_acc_date').on(table.tenantId, table.companyId, table.accountingDate),
  tenantCompDueDateIdx: index('idx_ap_doc_tenant_comp_due_date').on(table.tenantId, table.companyId, table.dueDate),
  tenantCompStatusIdx: index('idx_ap_doc_tenant_comp_status').on(table.tenantId, table.companyId, table.status),
  outstandingPosCheck: check('chk_ap_doc_outstanding_pos', sql`outstanding_amount >= 0`),
  unappliedPosCheck: check('chk_ap_doc_unapplied_pos', sql`unapplied_amount >= 0`)
}));

export const apDocumentLines = pgTable('ap_document_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  apDocumentId: uuid('ap_document_id').notNull(),
  lineSequence: integer('line_sequence').notNull(),
  productId: uuid('product_id'),
  description: text('description').notNull(),
  hsnSac: varchar('hsn_sac', { length: 16 }),
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
  expenseAccountId: uuid('expense_account_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_ap_line_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompDocFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.apDocumentId],
    foreignColumns: [apDocuments.tenantId, apDocuments.companyId, apDocuments.id]
  }).onDelete('restrict'),
  tenantCompProductFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.productId],
    foreignColumns: [products.tenantId, products.companyId, products.id]
  }).onDelete('restrict'),
  tenantCompDocIdx: index('idx_ap_line_tenant_comp_doc').on(table.tenantId, table.companyId, table.apDocumentId)
}));

export const apOpenItems = pgTable('ap_open_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  supplierId: uuid('supplier_id').notNull(),
  apDocumentId: uuid('ap_document_id').notNull(),
  documentType: varchar('document_type', { length: 32 }).notNull().default('SUPPLIER_BILL'), // SUPPLIER_BILL, DEBIT_NOTE, OPENING_BALANCE
  documentNumber: varchar('document_number', { length: 64 }).notNull(),
  documentDate: date('document_date', { mode: 'string' }).notNull(),
  dueDate: date('due_date', { mode: 'string' }).notNull(),
  originalAmount: numeric('original_amount', { precision: 20, scale: 2 }).notNull(),
  outstandingAmount: numeric('outstanding_amount', { precision: 20, scale: 2 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('OPEN'), // OPEN, PARTIALLY_SETTLED, SETTLED, CANCELLED
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_ap_open_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompSupplierFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.supplierId],
    foreignColumns: [suppliers.tenantId, suppliers.companyId, suppliers.id]
  }).onDelete('restrict'),
  tenantCompDocFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.apDocumentId],
    foreignColumns: [apDocuments.tenantId, apDocuments.companyId, apDocuments.id]
  }).onDelete('restrict'),
  tenantCompSupplierStatusIdx: index('idx_ap_open_tenant_comp_supp_status').on(table.tenantId, table.companyId, table.supplierId, table.status),
  tenantCompDueDateIdx: index('idx_ap_open_tenant_comp_due_date').on(table.tenantId, table.companyId, table.dueDate),
  outstandingPosCheck: check('chk_ap_open_outstanding_pos', sql`outstanding_amount >= 0`)
}));

export const apPayments = pgTable('ap_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  supplierId: uuid('supplier_id').notNull(),
  paymentNumber: varchar('payment_number', { length: 64 }),
  paymentDate: date('payment_date', { mode: 'string' }).notNull(),
  accountingDate: date('accounting_date', { mode: 'string' }).notNull(),
  paymentMode: varchar('payment_mode', { length: 32 }).notNull(), // CASH, BANK_TRANSFER, CHEQUE, UPI, OTHER
  bankAccountId: uuid('bank_account_id'),
  totalAmount: numeric('total_amount', { precision: 20, scale: 2 }).notNull(),
  allocatedAmount: numeric('allocated_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  unappliedAmount: numeric('unapplied_amount', { precision: 20, scale: 2 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('POSTED'), // DRAFT, POSTED, REVERSED
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, { onDelete: 'restrict' }),
  referenceNumber: varchar('reference_number', { length: 64 }),
  remarks: text('remarks'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_ap_payment_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompNumIdx: uniqueIndex('idx_ap_payment_tenant_comp_num').on(table.tenantId, table.companyId, table.paymentNumber),
  tenantCompSupplierFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.supplierId],
    foreignColumns: [suppliers.tenantId, suppliers.companyId, suppliers.id]
  }).onDelete('restrict'),
  tenantCompBankAccFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.bankAccountId],
    foreignColumns: [chartOfAccounts.tenantId, chartOfAccounts.companyId, chartOfAccounts.id]
  }).onDelete('restrict'),
  tenantCompSupplierIdx: index('idx_ap_payment_tenant_comp_supplier').on(table.tenantId, table.companyId, table.supplierId),
  tenantCompDateIdx: index('idx_ap_payment_tenant_comp_date').on(table.tenantId, table.companyId, table.paymentDate),
  unappliedPosCheck: check('chk_ap_payment_unapplied_pos', sql`unapplied_amount >= 0`)
}));

export const apAllocations = pgTable('ap_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  allocationSourceType: varchar('allocation_source_type', { length: 32 }).notNull(), // PAYMENT, CREDIT_NOTE
  paymentId: uuid('payment_id'),
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
  tenantCompIdIdx: uniqueIndex('idx_ap_alloc_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompPaymentFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.paymentId],
    foreignColumns: [apPayments.tenantId, apPayments.companyId, apPayments.id]
  }).onDelete('restrict'),
  tenantCompCreditNoteFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.creditNoteId],
    foreignColumns: [apDocuments.tenantId, apDocuments.companyId, apDocuments.id]
  }).onDelete('restrict'),
  tenantCompOpenItemFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.openItemId],
    foreignColumns: [apOpenItems.tenantId, apOpenItems.companyId, apOpenItems.id]
  }).onDelete('restrict'),
  paymentIdx: index('idx_ap_alloc_payment_id').on(table.tenantId, table.companyId, table.paymentId),
  creditNoteIdx: index('idx_ap_alloc_cn_id').on(table.tenantId, table.companyId, table.creditNoteId),
  openItemIdx: index('idx_ap_alloc_open_item_id').on(table.tenantId, table.companyId, table.openItemId),
  sourceExclusivityCheck: check(
    'chk_ap_alloc_source_exclusivity',
    sql`(allocation_source_type = 'PAYMENT' AND payment_id IS NOT NULL AND credit_note_id IS NULL) OR (allocation_source_type = 'CREDIT_NOTE' AND credit_note_id IS NOT NULL AND payment_id IS NULL)`
  ),
  amountPosCheck: check('chk_ap_alloc_amount_pos', sql`allocated_amount > 0`),
  discountPosCheck: check('chk_ap_alloc_discount_pos', sql`discount_amount >= 0`)
}));

export const apAdjustments = pgTable('ap_adjustments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  supplierId: uuid('supplier_id').notNull(),
  openItemId: uuid('open_item_id').notNull(),
  adjustmentType: varchar('adjustment_type', { length: 32 }).notNull(), // WRITE_OFF, CREDIT_ADJUSTMENT, DEBIT_ADJUSTMENT
  amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),
  reason: text('reason').notNull(),
  status: varchar('status', { length: 32 }).notNull().default('ACTIVE'), // ACTIVE, REVERSED
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_ap_adj_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompSupplierFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.supplierId],
    foreignColumns: [suppliers.tenantId, suppliers.companyId, suppliers.id]
  }).onDelete('restrict'),
  tenantCompOpenItemFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.openItemId],
    foreignColumns: [apOpenItems.tenantId, apOpenItems.companyId, apOpenItems.id]
  }).onDelete('restrict'),
  tenantCompSupplierOpenIdx: index('idx_ap_adj_tenant_comp_supp_open').on(table.tenantId, table.companyId, table.supplierId, table.openItemId)
}));

export type ApDocument = typeof apDocuments.$inferSelect;
export type NewApDocument = typeof apDocuments.$inferInsert;
export type ApDocumentLine = typeof apDocumentLines.$inferSelect;
export type NewApDocumentLine = typeof apDocumentLines.$inferInsert;
export type ApOpenItem = typeof apOpenItems.$inferSelect;
export type NewApOpenItem = typeof apOpenItems.$inferInsert;
export type ApPayment = typeof apPayments.$inferSelect;
export type NewApPayment = typeof apPayments.$inferInsert;
export type ApAllocation = typeof apAllocations.$inferSelect;
export type NewApAllocation = typeof apAllocations.$inferInsert;
export type ApAdjustment = typeof apAdjustments.$inferSelect;
export type NewApAdjustment = typeof apAdjustments.$inferInsert;
