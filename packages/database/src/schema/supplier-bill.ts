import { pgTable, uuid, varchar, numeric, integer, text, timestamp, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies, branches } from './master.js';
import { products, suppliers } from './commercial-master.js';
import { purchaseOrders, purchaseOrderLines } from './sourcing-purchase-order.js';
import { goodsReceipts, goodsReceiptLines } from './goods-receipt.js';
import { apDocuments, apOpenItems } from './accounts-payable.js';
import { journalEntries } from './accounting.js';

export const supplierBills = pgTable('supplier_bills', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),

  billNumber: varchar('bill_number', { length: 64 }).notNull(),
  supplierInvoiceNumber: varchar('supplier_invoice_number', { length: 64 }).notNull(),
  supplierInvoiceDate: varchar('supplier_invoice_date', { length: 10 }).notNull(), // YYYY-MM-DD

  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'restrict' }),
  purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id, { onDelete: 'restrict' }),
  primaryGrnId: uuid('primary_grn_id').references(() => goodsReceipts.id, { onDelete: 'restrict' }),

  billDate: varchar('bill_date', { length: 10 }).notNull(), // YYYY-MM-DD
  dueDate: varchar('due_date', { length: 10 }).notNull(), // YYYY-MM-DD

  currency: varchar('currency', { length: 3 }).notNull().default('INR'),
  exchangeRate: numeric('exchange_rate', { precision: 12, scale: 6 }).notNull().default('1.000000'),

  paymentTermsDays: integer('payment_terms_days').default(30),

  supplierBillingAddress: text('supplier_billing_address'),
  receivingAddress: text('receiving_address'),

  subtotal: numeric('subtotal', { precision: 20, scale: 2 }).notNull().default('0.00'),
  discount: numeric('discount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  taxableAmount: numeric('taxable_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  taxAmount: numeric('tax_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  rounding: numeric('rounding', { precision: 20, scale: 2 }).notNull().default('0.00'),
  grandTotal: numeric('grand_total', { precision: 20, scale: 2 }).notNull().default('0.00'),

  matchStatus: varchar('match_status', { length: 32 }).notNull().default('UNMATCHED'), // UNMATCHED, MATCHING, MATCHED, EXCEPTION, RESOLVED
  matchOverrideReason: text('match_override_reason'),
  matchOverrideBy: varchar('match_override_by', { length: 255 }),
  matchOverrideAt: timestamp('match_override_at', { withTimezone: true }),

  status: varchar('status', { length: 32 }).notNull().default('DRAFT'), // DRAFT, SUBMITTED, MATCHED, MATCH_EXCEPTION, APPROVED, POSTED, CANCELLED

  apDocumentId: uuid('ap_document_id').references(() => apDocuments.id, { onDelete: 'restrict' }),
  apOpenItemId: uuid('ap_open_item_id').references(() => apOpenItems.id, { onDelete: 'restrict' }),
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, { onDelete: 'restrict' }),

  postedAt: timestamp('posted_at', { withTimezone: true }),
  postedBy: varchar('posted_by', { length: 255 }),

  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledBy: varchar('cancelled_by', { length: 255 }),
  cancellationReason: text('cancellation_reason'),

  remarks: text('remarks'),

  version: integer('version').notNull().default(1),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: varchar('created_by', { length: 255 }).notNull(),
  updatedBy: varchar('updated_by', { length: 255 }).notNull(),
}, (table) => ({
  tenantCompanyBillNumIdx: uniqueIndex('uq_supplier_bills_tenant_company_num').on(table.tenantId, table.companyId, table.billNumber),
  tenantCompDupInvoiceIdx: uniqueIndex('uq_supplier_bills_dup_invoice').on(table.tenantId, table.companyId, table.supplierId, table.supplierInvoiceNumber),
  tenantCompIdx: index('idx_supplier_bills_tenant_comp').on(table.tenantId, table.companyId),
  poIdx: index('idx_supplier_bills_po').on(table.purchaseOrderId),
  grnIdx: index('idx_supplier_bills_grn').on(table.primaryGrnId),
  supplierIdx: index('idx_supplier_bills_supplier').on(table.supplierId),
  statusIdx: index('idx_supplier_bills_status').on(table.tenantId, table.companyId, table.status),
  matchStatusIdx: index('idx_supplier_bills_match_status').on(table.tenantId, table.companyId, table.matchStatus),
  statusCheck: check('chk_sb_status', sql`${table.status} IN ('DRAFT', 'SUBMITTED', 'MATCHED', 'MATCH_EXCEPTION', 'APPROVED', 'POSTED', 'CANCELLED')`),
  matchStatusCheck: check('chk_sb_match_status', sql`${table.matchStatus} IN ('UNMATCHED', 'MATCHING', 'MATCHED', 'EXCEPTION', 'RESOLVED')`),
}));

export const supplierBillLines = pgTable('supplier_bill_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  supplierBillId: uuid('supplier_bill_id').notNull().references(() => supplierBills.id, { onDelete: 'cascade' }),
  lineNumber: integer('line_number').notNull(),

  purchaseOrderLineId: uuid('purchase_order_line_id').references(() => purchaseOrderLines.id, { onDelete: 'restrict' }),
  goodsReceiptLineId: uuid('goods_receipt_line_id').references(() => goodsReceiptLines.id, { onDelete: 'restrict' }),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'restrict' }),

  descriptionSnapshot: text('description_snapshot').notNull(),
  productCodeSnapshot: varchar('product_code_snapshot', { length: 64 }),
  uom: varchar('uom', { length: 32 }).notNull(),

  billedQuantity: numeric('billed_quantity', { precision: 18, scale: 4 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 20, scale: 2 }).notNull(),

  discount: numeric('discount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  discountAmount: numeric('discount_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),

  taxableAmount: numeric('taxable_amount', { precision: 20, scale: 2 }).notNull(),
  taxCategoryId: uuid('tax_category_id'),
  taxRatePercent: numeric('tax_rate_percent', { precision: 9, scale: 6 }).notNull().default('0.000000'),
  cgstAmount: numeric('cgst_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  sgstAmount: numeric('sgst_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  igstAmount: numeric('igst_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  utgstAmount: numeric('utgst_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  cessAmount: numeric('cess_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  taxAmount: numeric('tax_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  lineTotal: numeric('line_total', { precision: 20, scale: 2 }).notNull(),

  expenseAccountId: uuid('expense_account_id'),

  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  billLineNumIdx: uniqueIndex('uq_supplier_bill_lines_num').on(table.supplierBillId, table.lineNumber),
  poLineIdx: index('idx_sb_lines_po_line').on(table.purchaseOrderLineId),
  grnLineIdx: index('idx_sb_lines_grn_line').on(table.goodsReceiptLineId),
  productIdx: index('idx_sb_lines_product').on(table.productId),
  billedQtyCheck: check('chk_sb_lines_billed_qty_pos', sql`${table.billedQuantity} > 0`),
}));

export const supplierBillMatchExceptions = pgTable('supplier_bill_match_exceptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),

  supplierBillId: uuid('supplier_bill_id').notNull().references(() => supplierBills.id, { onDelete: 'cascade' }),
  supplierBillLineId: uuid('supplier_bill_line_id').references(() => supplierBillLines.id, { onDelete: 'cascade' }),

  exceptionType: varchar('exception_type', { length: 64 }).notNull(), // QUANTITY_VARIANCE, PRICE_VARIANCE, AMOUNT_VARIANCE, TAX_VARIANCE, MISSING_GRN, MISSING_PO, SUPPLIER_MISMATCH
  severity: varchar('severity', { length: 32 }).notNull().default('MEDIUM'), // LOW, MEDIUM, HIGH, CRITICAL

  expectedValue: varchar('expected_value', { length: 128 }).notNull(),
  actualValue: varchar('actual_value', { length: 128 }).notNull(),
  variance: varchar('variance', { length: 128 }).notNull(),
  configuredTolerance: varchar('configured_tolerance', { length: 128 }).notNull(),

  reason: text('reason').notNull(),
  status: varchar('status', { length: 32 }).notNull().default('OPEN'), // OPEN, OVERRIDDEN, RESOLVED, REJECTED

  resolvedBy: varchar('resolved_by', { length: 255 }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolutionNotes: text('resolution_notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  billIdx: index('idx_sb_exceptions_bill').on(table.supplierBillId),
  statusIdx: index('idx_sb_exceptions_status').on(table.tenantId, table.companyId, table.status),
  statusCheck: check('chk_sb_exception_status', sql`${table.status} IN ('OPEN', 'OVERRIDDEN', 'RESOLVED', 'REJECTED')`),
}));

export type SupplierBill = typeof supplierBills.$inferSelect;
export type SupplierBillLine = typeof supplierBillLines.$inferSelect;
export type SupplierBillMatchException = typeof supplierBillMatchExceptions.$inferSelect;
