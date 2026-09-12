import { pgTable, uuid, varchar, numeric, integer, text, jsonb, timestamp, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './platform.js';
import { companies, customers, products } from './master.js';
import { salesInvoices, salesInvoiceLines } from './sales-invoice.js';
import { salesDeliveries, salesDeliveryLines } from './sales-delivery.js';
import { arDocuments, arAllocations } from './accounts-receivable.js';
import { journalEntries } from './accounting.js';

export const salesReturns = pgTable('sales_returns', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  returnNumber: varchar('return_number', { length: 64 }).notNull(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  originalSalesInvoiceId: uuid('original_sales_invoice_id').notNull().references(() => salesInvoices.id),
  originalSalesDeliveryId: uuid('original_sales_delivery_id').references(() => salesDeliveries.id),
  returnDate: varchar('return_date', { length: 10 }).notNull(),
  reason: text('reason').notNull(),
  status: varchar('status', { length: 32 }).notNull().default('DRAFT'),
  notes: text('notes'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  createdBy: uuid('created_by').notNull(),
  updatedBy: uuid('updated_by').notNull(),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  cancelledBy: uuid('cancelled_by').references(() => users.id),
  cancelledAt: timestamp('cancelled_at'),
  cancellationReason: text('cancellation_reason')
}, (table) => ({
  tenantCompanyReturnNumIdx: uniqueIndex('uq_sales_return_tenant_company_num').on(table.tenantId, table.companyId, table.returnNumber),
  customerIdx: index('idx_sales_return_customer').on(table.tenantId, table.companyId, table.customerId),
  invoiceIdx: index('idx_sales_return_invoice').on(table.tenantId, table.companyId, table.originalSalesInvoiceId),
  statusIdx: index('idx_sales_return_status').on(table.tenantId, table.companyId, table.status),
  dateIdx: index('idx_sales_return_date').on(table.tenantId, table.companyId, table.returnDate),
  statusCheck: check('chk_sales_return_status', sql`${table.status} IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'CREDIT_NOTE_CREATED', 'CANCELLED')`),
}));

export const salesReturnLines = pgTable('sales_return_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  returnId: uuid('return_id').notNull().references(() => salesReturns.id, { onDelete: 'cascade' }),
  originalInvoiceLineId: uuid('original_invoice_line_id').notNull().references(() => salesInvoiceLines.id),
  originalDeliveryLineId: uuid('original_delivery_line_id').references(() => salesDeliveryLines.id),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull(),
  lineNumber: integer('line_number').notNull(),
  productId: uuid('product_id').notNull().references(() => products.id),
  productCodeSnapshot: varchar('product_code_snapshot', { length: 64 }).notNull(),
  productNameSnapshot: varchar('product_name_snapshot', { length: 255 }).notNull(),
  description: text('description'),
  uom: varchar('uom', { length: 32 }).notNull(),
  originalInvoicedQuantity: numeric('original_invoiced_quantity', { precision: 18, scale: 4 }).notNull(),
  previouslyReturnedQuantity: numeric('previously_returned_quantity', { precision: 18, scale: 4 }).notNull().default('0.0000'),
  returnQuantity: numeric('return_quantity', { precision: 18, scale: 4 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 18, scale: 4 }).notNull(),
  discountPercent: numeric('discount_percent', { precision: 5, scale: 2 }).notNull().default('0.00'),
  discountAmount: numeric('discount_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  grossAmount: numeric('gross_amount', { precision: 15, scale: 2 }).notNull(),
  taxableAmount: numeric('taxable_amount', { precision: 15, scale: 2 }).notNull(),
  hsnSac: varchar('hsn_sac', { length: 16 }).notNull(),
  cgstRate: numeric('cgst_rate', { precision: 5, scale: 2 }).notNull().default('0.00'),
  cgstAmount: numeric('cgst_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  sgstRate: numeric('sgst_rate', { precision: 5, scale: 2 }).notNull().default('0.00'),
  sgstAmount: numeric('sgst_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  igstRate: numeric('igst_rate', { precision: 5, scale: 2 }).notNull().default('0.00'),
  igstAmount: numeric('igst_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  taxAmount: numeric('tax_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  lineTotal: numeric('line_total', { precision: 15, scale: 2 }).notNull(),
  reason: text('reason'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  returnLineNumIdx: uniqueIndex('uq_sales_return_line_num').on(table.returnId, table.lineNumber),
  qtyPosCheck: check('chk_sales_return_line_qty_pos', sql`${table.returnQuantity} > 0`),
}));

export const salesCreditNotes = pgTable('sales_credit_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  creditNoteNumber: varchar('credit_note_number', { length: 64 }).notNull(),
  salesReturnId: uuid('sales_return_id').references(() => salesReturns.id),
  originalSalesInvoiceId: uuid('original_sales_invoice_id').notNull().references(() => salesInvoices.id),
  originalInvoiceNumberSnapshot: varchar('original_invoice_number_snapshot', { length: 64 }).notNull(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  creditNoteDate: varchar('credit_note_date', { length: 10 }).notNull(),
  billingAddressSnapshot: jsonb('billing_address_snapshot').notNull(),
  shippingAddressSnapshot: jsonb('shipping_address_snapshot').notNull(),
  contactSnapshot: jsonb('contact_snapshot'),
  reason: text('reason').notNull(),
  status: varchar('status', { length: 32 }).notNull().default('DRAFT'),
  subtotalAmount: numeric('subtotal_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  discountAmount: numeric('discount_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  taxableAmount: numeric('taxable_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  cgstAmount: numeric('cgst_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  sgstAmount: numeric('sgst_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  igstAmount: numeric('igst_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  taxAmount: numeric('tax_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  totalAmount: numeric('total_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  arDocumentId: uuid('ar_document_id').references(() => arDocuments.id),
  arAllocationId: uuid('ar_allocation_id').references(() => arAllocations.id),
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
  postedAt: timestamp('posted_at'),
  postedBy: uuid('posted_by').references(() => users.id),
  notes: text('notes'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  createdBy: uuid('created_by').notNull(),
  updatedBy: uuid('updated_by').notNull(),
  cancelledBy: uuid('cancelled_by').references(() => users.id),
  cancelledAt: timestamp('cancelled_at'),
  cancellationReason: text('cancellation_reason')
}, (table) => ({
  tenantCompanyCreditNoteNumIdx: uniqueIndex('uq_sales_credit_note_tenant_company_num').on(table.tenantId, table.companyId, table.creditNoteNumber),
  customerIdx: index('idx_sales_credit_note_customer').on(table.tenantId, table.companyId, table.customerId),
  invoiceIdx: index('idx_sales_credit_note_invoice').on(table.tenantId, table.companyId, table.originalSalesInvoiceId),
  returnIdx: index('idx_sales_credit_note_return').on(table.tenantId, table.companyId, table.salesReturnId),
  statusIdx: index('idx_sales_credit_note_status').on(table.tenantId, table.companyId, table.status),
  statusCheck: check('chk_sales_credit_note_status', sql`${table.status} IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'CANCELLED')`),
}));

export const salesCreditNoteLines = pgTable('sales_credit_note_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  creditNoteId: uuid('credit_note_id').notNull().references(() => salesCreditNotes.id, { onDelete: 'cascade' }),
  salesReturnLineId: uuid('sales_return_line_id').references(() => salesReturnLines.id),
  originalInvoiceLineId: uuid('original_invoice_line_id').notNull().references(() => salesInvoiceLines.id),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull(),
  lineNumber: integer('line_number').notNull(),
  productId: uuid('product_id').notNull().references(() => products.id),
  productCodeSnapshot: varchar('product_code_snapshot', { length: 64 }).notNull(),
  productNameSnapshot: varchar('product_name_snapshot', { length: 255 }).notNull(),
  description: text('description'),
  uom: varchar('uom', { length: 32 }).notNull(),
  returnedQuantity: numeric('returned_quantity', { precision: 18, scale: 4 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 18, scale: 4 }).notNull(),
  discountPercent: numeric('discount_percent', { precision: 5, scale: 2 }).notNull().default('0.00'),
  discountAmount: numeric('discount_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  grossAmount: numeric('gross_amount', { precision: 15, scale: 2 }).notNull(),
  taxableAmount: numeric('taxable_amount', { precision: 15, scale: 2 }).notNull(),
  hsnSac: varchar('hsn_sac', { length: 16 }).notNull(),
  cgstRate: numeric('cgst_rate', { precision: 5, scale: 2 }).notNull().default('0.00'),
  cgstAmount: numeric('cgst_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  sgstRate: numeric('sgst_rate', { precision: 5, scale: 2 }).notNull().default('0.00'),
  sgstAmount: numeric('sgst_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  igstRate: numeric('igst_rate', { precision: 5, scale: 2 }).notNull().default('0.00'),
  igstAmount: numeric('igst_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  taxAmount: numeric('tax_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  lineTotal: numeric('line_total', { precision: 15, scale: 2 }).notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  creditNoteLineNumIdx: uniqueIndex('uq_sales_credit_note_line_num').on(table.creditNoteId, table.lineNumber),
  qtyPosCheck: check('chk_sales_credit_note_line_qty_pos', sql`${table.returnedQuantity} > 0`),
}));

export type SalesReturn = typeof salesReturns.$inferSelect;
export type NewSalesReturn = typeof salesReturns.$inferInsert;
export type SalesReturnLine = typeof salesReturnLines.$inferSelect;
export type NewSalesReturnLine = typeof salesReturnLines.$inferInsert;
export type SalesCreditNote = typeof salesCreditNotes.$inferSelect;
export type NewSalesCreditNote = typeof salesCreditNotes.$inferInsert;
export type SalesCreditNoteLine = typeof salesCreditNoteLines.$inferSelect;
export type NewSalesCreditNoteLine = typeof salesCreditNoteLines.$inferInsert;
