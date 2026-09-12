import { pgTable, uuid, varchar, numeric, integer, text, timestamp, uniqueIndex, index, check, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies, branches } from './master.js';
import { products, suppliers } from './commercial-master.js';
import { purchaseOrders, purchaseOrderLines } from './sourcing-purchase-order.js';

export const goodsReceipts = pgTable('goods_receipts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),

  grnNumber: varchar('grn_number', { length: 64 }).notNull(),
  purchaseOrderId: uuid('purchase_order_id').notNull().references(() => purchaseOrders.id, { onDelete: 'restrict' }),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'restrict' }),

  receiptDate: varchar('receipt_date', { length: 10 }).notNull(), // YYYY-MM-DD
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),

  warehouseId: varchar('warehouse_id', { length: 128 }),
  receivingLocationId: varchar('receiving_location_id', { length: 128 }),

  supplierDeliveryNoteNumber: varchar('supplier_delivery_note_number', { length: 64 }),
  supplierDeliveryNoteDate: varchar('supplier_delivery_note_date', { length: 10 }), // YYYY-MM-DD

  transporter: varchar('transporter', { length: 128 }),
  vehicleNumber: varchar('vehicle_number', { length: 64 }),
  lrNumber: varchar('lr_number', { length: 64 }),

  status: varchar('status', { length: 32 }).notNull().default('DRAFT'), // DRAFT, RECEIVED, INSPECTION_PENDING, ACCEPTED, PARTIALLY_ACCEPTED, REJECTED, CANCELLED
  inspectionStatus: varchar('inspection_status', { length: 32 }).notNull().default('NOT_REQUIRED'), // NOT_REQUIRED, PENDING, PASSED, PARTIALLY_PASSED, FAILED

  receivedBy: varchar('received_by', { length: 64 }).notNull(),
  notes: text('notes'),

  version: integer('version').notNull().default(1),

  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  submittedBy: varchar('submitted_by', { length: 64 }),

  inspectedAt: timestamp('inspected_at', { withTimezone: true }),
  inspectedBy: varchar('inspected_by', { length: 64 }),

  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  acceptedBy: varchar('accepted_by', { length: 64 }),

  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledBy: varchar('cancelled_by', { length: 64 }),
  cancellationReason: text('cancellation_reason'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: varchar('created_by', { length: 64 }).notNull(),
  updatedBy: varchar('updated_by', { length: 64 }).notNull(),
}, (table) => ({
  tenantCompanyGrnNumIdx: uniqueIndex('uq_goods_receipts_tenant_company_num').on(table.tenantId, table.companyId, table.grnNumber),
  tenantCompIdx: index('idx_goods_receipts_tenant_comp').on(table.tenantId, table.companyId),
  poIdx: index('idx_goods_receipts_po').on(table.purchaseOrderId),
  supplierIdx: index('idx_goods_receipts_supplier').on(table.supplierId),
  statusIdx: index('idx_goods_receipts_status').on(table.tenantId, table.companyId, table.status),
  statusCheck: check('chk_grn_status', sql`${table.status} IN ('DRAFT', 'RECEIVED', 'INSPECTION_PENDING', 'ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED', 'CANCELLED')`),
  inspectionStatusCheck: check('chk_grn_inspection_status', sql`${table.inspectionStatus} IN ('NOT_REQUIRED', 'PENDING', 'PASSED', 'PARTIALLY_PASSED', 'FAILED')`),
}));

export const goodsReceiptLines = pgTable('goods_receipt_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  goodsReceiptId: uuid('goods_receipt_id').notNull().references(() => goodsReceipts.id, { onDelete: 'cascade' }),
  lineNumber: integer('line_number').notNull(),

  purchaseOrderLineId: uuid('purchase_order_line_id').notNull().references(() => purchaseOrderLines.id, { onDelete: 'restrict' }),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'restrict' }),
  descriptionSnapshot: text('description_snapshot').notNull(),
  productCodeSnapshot: varchar('product_code_snapshot', { length: 64 }),
  uom: varchar('uom', { length: 32 }).notNull(),

  orderedQuantity: numeric('ordered_quantity', { precision: 18, scale: 4 }).notNull(),
  previouslyReceivedQuantity: numeric('previously_received_quantity', { precision: 18, scale: 4 }).notNull().default('0.0000'),
  receivedQuantity: numeric('received_quantity', { precision: 18, scale: 4 }).notNull(),
  acceptedQuantity: numeric('accepted_quantity', { precision: 18, scale: 4 }).notNull().default('0.0000'),
  rejectedQuantity: numeric('rejected_quantity', { precision: 18, scale: 4 }).notNull().default('0.0000'),
  remainingQuantity: numeric('remaining_quantity', { precision: 18, scale: 4 }).notNull().default('0.0000'),

  inspectionRequired: boolean('inspection_required').notNull().default(false),
  rejectionReason: text('rejection_reason'),

  batchReference: varchar('batch_reference', { length: 128 }),
  serialReference: varchar('serial_reference', { length: 128 }),

  notes: text('notes'),

  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  grnLineNumIdx: uniqueIndex('uq_goods_receipt_lines_num').on(table.goodsReceiptId, table.lineNumber),
  poLineIdx: index('idx_grn_lines_po_line').on(table.purchaseOrderLineId),
  productIdx: index('idx_grn_lines_product').on(table.productId),
  qtyCheck: check('chk_grn_lines_received_qty_pos', sql`${table.receivedQuantity} >= 0`),
}));

export type GoodsReceipt = typeof goodsReceipts.$inferSelect;
export type GoodsReceiptLine = typeof goodsReceiptLines.$inferSelect;
