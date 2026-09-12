import { pgTable, uuid, varchar, numeric, integer, text, timestamp, uniqueIndex, index, check, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies, branches, departments } from './master.js';
import { products, suppliers } from './commercial-master.js';
import { purchaseRequests, purchaseRequestLines } from './purchase-request.js';

// ============================================================================
// 1. RFQs (Request for Quotations) & Lines
// ============================================================================
export const procurementRfqs = pgTable('procurement_rfqs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
  departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'restrict' }),
  purchaseRequestId: uuid('purchase_request_id').references(() => purchaseRequests.id, { onDelete: 'set null' }),

  rfqNumber: varchar('rfq_number', { length: 64 }).notNull(),
  rfqDate: varchar('rfq_date', { length: 10 }).notNull(), // YYYY-MM-DD
  responseDueDate: varchar('response_due_date', { length: 10 }).notNull(), // YYYY-MM-DD

  title: varchar('title', { length: 255 }).notNull(),
  purpose: text('purpose'),
  instructions: text('instructions'),
  terms: text('terms'),

  currency: varchar('currency', { length: 3 }).notNull().default('INR'),

  status: varchar('status', { length: 32 }).notNull().default('DRAFT'), // DRAFT, PUBLISHED, RESPONSE_OPEN, RESPONSE_CLOSED, EVALUATED, AWARDED, CANCELLED

  notes: text('notes'),

  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: varchar('created_by', { length: 64 }).notNull(),
  updatedBy: varchar('updated_by', { length: 64 }).notNull(),
}, (table) => ({
  tenantCompanyRfqNumIdx: uniqueIndex('uq_procurement_rfqs_tenant_company_num').on(table.tenantId, table.companyId, table.rfqNumber),
  tenantCompIdx: index('idx_procurement_rfqs_tenant_comp').on(table.tenantId, table.companyId),
  statusIdx: index('idx_procurement_rfqs_status').on(table.tenantId, table.companyId, table.status),
  prIdx: index('idx_procurement_rfqs_pr').on(table.purchaseRequestId),
  statusCheck: check('chk_rfqs_status', sql`${table.status} IN ('DRAFT', 'PUBLISHED', 'RESPONSE_OPEN', 'RESPONSE_CLOSED', 'EVALUATED', 'AWARDED', 'CANCELLED')`),
}));

export const procurementRfqLines = pgTable('procurement_rfq_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  rfqId: uuid('rfq_id').notNull().references(() => procurementRfqs.id, { onDelete: 'cascade' }),
  lineNumber: integer('line_number').notNull(),

  purchaseRequestLineId: uuid('purchase_request_line_id').references(() => purchaseRequestLines.id, { onDelete: 'set null' }),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'restrict' }),
  description: text('description').notNull(),
  specification: text('specification'),

  requestedQuantity: numeric('requested_quantity', { precision: 18, scale: 4 }).notNull(),
  uom: varchar('uom', { length: 32 }).notNull(),

  targetDate: varchar('target_date', { length: 10 }), // YYYY-MM-DD
  notes: text('notes'),

  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  rfqLineNumIdx: uniqueIndex('uq_procurement_rfq_lines_num').on(table.rfqId, table.lineNumber),
  productIdx: index('idx_rfq_lines_product').on(table.productId),
  qtyCheck: check('chk_rfq_lines_requested_qty_pos', sql`${table.requestedQuantity} > 0`),
}));

export const procurementRfqSuppliers = pgTable('procurement_rfq_suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  rfqId: uuid('rfq_id').notNull().references(() => procurementRfqs.id, { onDelete: 'cascade' }),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'restrict' }),

  status: varchar('status', { length: 32 }).notNull().default('INVITED'), // INVITED, ACKNOWLEDGED, DECLINED, RESPONDED, OVERDUE

  invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  notes: text('notes'),
}, (table) => ({
  rfqSupplierIdx: uniqueIndex('uq_procurement_rfq_suppliers_rfq_sup').on(table.rfqId, table.supplierId),
}));

// ============================================================================
// 2. SUPPLIER QUOTATIONS & Lines
// ============================================================================
export const procurementSupplierQuotations = pgTable('procurement_supplier_quotations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),

  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'restrict' }),
  rfqId: uuid('rfq_id').references(() => procurementRfqs.id, { onDelete: 'set null' }),

  supplierQuoteNumber: varchar('supplier_quote_number', { length: 64 }).notNull(),
  internalQuoteNumber: varchar('internal_quote_number', { length: 64 }).notNull(),

  quotationDate: varchar('quotation_date', { length: 10 }).notNull(), // YYYY-MM-DD
  validUntil: varchar('valid_until', { length: 10 }).notNull(), // YYYY-MM-DD

  currency: varchar('currency', { length: 3 }).notNull().default('INR'),
  exchangeRate: numeric('exchange_rate', { precision: 12, scale: 6 }).notNull().default('1.000000'),

  paymentTerms: varchar('payment_terms', { length: 128 }),
  deliveryTerms: varchar('delivery_terms', { length: 128 }),
  warrantyTerms: varchar('warranty_terms', { length: 128 }),
  shippingTerms: varchar('shipping_terms', { length: 128 }),

  subtotal: numeric('subtotal', { precision: 15, scale: 2 }).notNull().default('0.00'),
  discount: numeric('discount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  tax: numeric('tax', { precision: 15, scale: 2 }).notNull().default('0.00'),
  total: numeric('total', { precision: 15, scale: 2 }).notNull().default('0.00'),

  status: varchar('status', { length: 32 }).notNull().default('DRAFT'), // DRAFT, SUBMITTED, UNDER_REVIEW, ACCEPTED, AWARDED, REJECTED, WITHDRAWN, EXPIRED, CANCELLED

  notes: text('notes'),

  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: varchar('created_by', { length: 64 }).notNull(),
  updatedBy: varchar('updated_by', { length: 64 }).notNull(),
}, (table) => ({
  tenantCompanyQuoteNumIdx: uniqueIndex('uq_procurement_sq_tenant_company_num').on(table.tenantId, table.companyId, table.internalQuoteNumber),
  tenantCompIdx: index('idx_procurement_sq_tenant_comp').on(table.tenantId, table.companyId),
  supplierIdx: index('idx_procurement_sq_supplier').on(table.tenantId, table.companyId, table.supplierId),
  rfqIdx: index('idx_procurement_sq_rfq').on(table.rfqId),
  statusCheck: check('chk_sq_status', sql`${table.status} IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'AWARDED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'CANCELLED')`),
}));

export const procurementSupplierQuotationLines = pgTable('procurement_supplier_quotation_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  supplierQuotationId: uuid('supplier_quotation_id').notNull().references(() => procurementSupplierQuotations.id, { onDelete: 'cascade' }),
  lineNumber: integer('line_number').notNull(),

  rfqLineId: uuid('rfq_line_id').references(() => procurementRfqLines.id, { onDelete: 'set null' }),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'restrict' }),
  description: text('description').notNull(),

  quotedQuantity: numeric('quoted_quantity', { precision: 18, scale: 4 }).notNull(),
  uom: varchar('uom', { length: 32 }).notNull(),

  unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull(),
  discount: numeric('discount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  taxableAmount: numeric('taxable_amount', { precision: 15, scale: 2 }).notNull(),
  tax: numeric('tax', { precision: 15, scale: 2 }).notNull().default('0.00'),
  lineTotal: numeric('line_total', { precision: 15, scale: 2 }).notNull(),

  deliveryDate: varchar('delivery_date', { length: 10 }), // YYYY-MM-DD
  leadTimeDays: integer('lead_time_days'),
  specification: text('specification'),
  notes: text('notes'),

  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sqLineNumIdx: uniqueIndex('uq_procurement_sq_lines_num').on(table.supplierQuotationId, table.lineNumber),
  productIdx: index('idx_sq_lines_product').on(table.productId),
  qtyCheck: check('chk_sq_lines_quoted_qty_pos', sql`${table.quotedQuantity} > 0`),
}));

// ============================================================================
// 3. QUOTATION COMPARISON & AWARD
// ============================================================================
export const procurementQuotationComparisons = pgTable('procurement_quotation_comparisons', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),

  rfqId: uuid('rfq_id').notNull().references(() => procurementRfqs.id, { onDelete: 'cascade' }),
  comparisonDate: varchar('comparison_date', { length: 10 }).notNull(), // YYYY-MM-DD

  status: varchar('status', { length: 32 }).notNull().default('DRAFT'), // DRAFT, EVALUATED, AWARDED
  evaluationNotes: text('evaluation_notes'),

  awardedSupplierId: uuid('awarded_supplier_id').references(() => suppliers.id, { onDelete: 'restrict' }),
  awardedAt: timestamp('awarded_at', { withTimezone: true }),
  awardedBy: varchar('awarded_by', { length: 64 }),

  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: varchar('created_by', { length: 64 }).notNull(),
  updatedBy: varchar('updated_by', { length: 64 }).notNull(),
}, (table) => ({
  tenantCompRfqIdx: uniqueIndex('uq_procurement_comparison_rfq').on(table.tenantId, table.companyId, table.rfqId),
  rfqIdx: index('idx_procurement_comp_rfq').on(table.rfqId),
}));

export const procurementQuotationComparisonLines = pgTable('procurement_quotation_comparison_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  comparisonId: uuid('comparison_id').notNull().references(() => procurementQuotationComparisons.id, { onDelete: 'cascade' }),

  rfqLineId: uuid('rfq_line_id').notNull().references(() => procurementRfqLines.id, { onDelete: 'cascade' }),
  supplierQuotationId: uuid('supplier_quotation_id').notNull().references(() => procurementSupplierQuotations.id, { onDelete: 'cascade' }),
  supplierQuotationLineId: uuid('supplier_quotation_line_id').notNull().references(() => procurementSupplierQuotationLines.id, { onDelete: 'cascade' }),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'restrict' }),

  quotedUnitPrice: numeric('quoted_unit_price', { precision: 15, scale: 2 }).notNull(),
  quotedQuantity: numeric('quoted_quantity', { precision: 18, scale: 4 }).notNull(),
  quotedLineTotal: numeric('quoted_line_total', { precision: 15, scale: 2 }).notNull(),

  isAwarded: boolean('is_awarded').notNull().default(false),
  awardQuantity: numeric('award_quantity', { precision: 18, scale: 4 }).notNull().default('0.0000'),

  rejectionReason: text('rejection_reason'),
  evaluationNotes: text('evaluation_notes'),
}, (table) => ({
  compRfqSqLineIdx: uniqueIndex('uq_procurement_comp_lines_unique').on(table.comparisonId, table.rfqLineId, table.supplierQuotationLineId),
}));

// ============================================================================
// 4. PURCHASE ORDERS & Lines
// ============================================================================
export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),

  poNumber: varchar('po_number', { length: 64 }).notNull(),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'restrict' }),

  purchaseRequestId: uuid('purchase_request_id').references(() => purchaseRequests.id, { onDelete: 'set null' }),
  rfqId: uuid('rfq_id').references(() => procurementRfqs.id, { onDelete: 'set null' }),
  supplierQuotationId: uuid('supplier_quotation_id').references(() => procurementSupplierQuotations.id, { onDelete: 'set null' }),
  comparisonId: uuid('comparison_id').references(() => procurementQuotationComparisons.id, { onDelete: 'set null' }),

  poDate: varchar('po_date', { length: 10 }).notNull(), // YYYY-MM-DD
  expectedDeliveryDate: varchar('expected_delivery_date', { length: 10 }).notNull(), // YYYY-MM-DD

  currency: varchar('currency', { length: 3 }).notNull().default('INR'),
  exchangeRate: numeric('exchange_rate', { precision: 12, scale: 6 }).notNull().default('1.000000'),

  paymentTerms: varchar('payment_terms', { length: 128 }),
  deliveryTerms: varchar('delivery_terms', { length: 128 }),
  shippingTerms: varchar('shipping_terms', { length: 128 }),
  warrantyTerms: varchar('warranty_terms', { length: 128 }),

  billingAddress: text('billing_address'),
  shippingLocation: text('shipping_location'),

  status: varchar('status', { length: 32 }).notNull().default('DRAFT'), // DRAFT, SUBMITTED, APPROVED, ISSUED, ACKNOWLEDGED, PARTIALLY_RECEIVED, COMPLETED, CANCELLED

  subtotal: numeric('subtotal', { precision: 15, scale: 2 }).notNull().default('0.00'),
  discount: numeric('discount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  taxableAmount: numeric('taxable_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  tax: numeric('tax', { precision: 15, scale: 2 }).notNull().default('0.00'),
  rounding: numeric('rounding', { precision: 15, scale: 2 }).notNull().default('0.00'),
  grandTotal: numeric('grand_total', { precision: 15, scale: 2 }).notNull().default('0.00'),

  notes: text('notes'),
  termsAndConditions: text('terms_and_conditions'),

  version: integer('version').notNull().default(1),

  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  submittedBy: varchar('submitted_by', { length: 64 }),

  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: varchar('approved_by', { length: 64 }),

  issuedAt: timestamp('issued_at', { withTimezone: true }),
  issuedBy: varchar('issued_by', { length: 64 }),

  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  acknowledgedBy: varchar('acknowledged_by', { length: 64 }),

  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledBy: varchar('cancelled_by', { length: 64 }),
  cancellationReason: text('cancellation_reason'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: varchar('created_by', { length: 64 }).notNull(),
  updatedBy: varchar('updated_by', { length: 64 }).notNull(),
}, (table) => ({
  tenantCompanyPoNumIdx: uniqueIndex('uq_purchase_orders_tenant_company_num').on(table.tenantId, table.companyId, table.poNumber),
  tenantCompIdx: index('idx_purchase_orders_tenant_comp').on(table.tenantId, table.companyId),
  supplierIdx: index('idx_purchase_orders_supplier').on(table.tenantId, table.companyId, table.supplierId),
  statusIdx: index('idx_purchase_orders_status').on(table.tenantId, table.companyId, table.status),
  prIdx: index('idx_purchase_orders_pr').on(table.purchaseRequestId),
  rfqIdx: index('idx_purchase_orders_rfq').on(table.rfqId),
  sqIdx: index('idx_purchase_orders_sq').on(table.supplierQuotationId),
  statusCheck: check('chk_po_status', sql`${table.status} IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'ISSUED', 'ACKNOWLEDGED', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED')`),
}));

export const purchaseOrderLines = pgTable('purchase_order_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  purchaseOrderId: uuid('purchase_order_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  lineNumber: integer('line_number').notNull(),

  purchaseRequestLineId: uuid('purchase_request_line_id').references(() => purchaseRequestLines.id, { onDelete: 'set null' }),
  rfqLineId: uuid('rfq_line_id').references(() => procurementRfqLines.id, { onDelete: 'set null' }),
  supplierQuotationLineId: uuid('supplier_quotation_line_id').references(() => procurementSupplierQuotationLines.id, { onDelete: 'set null' }),

  productId: uuid('product_id').references(() => products.id, { onDelete: 'restrict' }),
  productCodeSnapshot: varchar('product_code_snapshot', { length: 64 }),
  productNameSnapshot: varchar('product_name_snapshot', { length: 255 }),
  description: text('description').notNull(),
  uom: varchar('uom', { length: 32 }).notNull(),

  orderedQuantity: numeric('ordered_quantity', { precision: 18, scale: 4 }).notNull(),
  receivedQuantity: numeric('received_quantity', { precision: 18, scale: 4 }).notNull().default('0.0000'),
  acceptedQuantity: numeric('accepted_quantity', { precision: 18, scale: 4 }).notNull().default('0.0000'),
  unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull(),

  discount: numeric('discount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  discountAmount: numeric('discount_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),

  taxableAmount: numeric('taxable_amount', { precision: 15, scale: 2 }).notNull(),
  taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull().default('0.00'),
  taxAmount: numeric('tax_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),

  lineTotal: numeric('line_total', { precision: 15, scale: 2 }).notNull(),

  expectedDeliveryDate: varchar('expected_delivery_date', { length: 10 }), // YYYY-MM-DD
  notes: text('notes'),

  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  poLineNumIdx: uniqueIndex('uq_purchase_order_lines_num').on(table.purchaseOrderId, table.lineNumber),
  productIdx: index('idx_po_lines_product').on(table.productId),
  qtyCheck: check('chk_po_lines_ordered_qty_pos', sql`${table.orderedQuantity} > 0`),
}));

export type ProcurementRfq = typeof procurementRfqs.$inferSelect;
export type ProcurementRfqLine = typeof procurementRfqLines.$inferSelect;
export type ProcurementRfqSupplier = typeof procurementRfqSuppliers.$inferSelect;
export type ProcurementSupplierQuotation = typeof procurementSupplierQuotations.$inferSelect;
export type ProcurementSupplierQuotationLine = typeof procurementSupplierQuotationLines.$inferSelect;
export type ProcurementQuotationComparison = typeof procurementQuotationComparisons.$inferSelect;
export type ProcurementQuotationComparisonLine = typeof procurementQuotationComparisonLines.$inferSelect;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type PurchaseOrderLine = typeof purchaseOrderLines.$inferSelect;
