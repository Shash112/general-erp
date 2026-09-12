import { pgTable, uuid, varchar, numeric, integer, text, timestamp, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies, branches, departments } from './master.js';
import { products, suppliers } from './commercial-master.js';

export const purchaseRequests = pgTable('purchase_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
  departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'restrict' }),

  requestNumber: varchar('request_number', { length: 64 }).notNull(),
  requestDate: varchar('request_date', { length: 10 }).notNull(), // YYYY-MM-DD
  requiredDate: varchar('required_date', { length: 10 }).notNull(), // YYYY-MM-DD

  requesterUserId: varchar('requester_user_id', { length: 64 }).notNull(),
  requesterEmployeeId: varchar('requester_employee_id', { length: 64 }),

  purpose: text('purpose'),
  justification: text('justification'),
  priority: varchar('priority', { length: 32 }).notNull().default('NORMAL'), // LOW, NORMAL, HIGH, URGENT

  status: varchar('status', { length: 32 }).notNull().default('DRAFT'), // DRAFT, SUBMITTED, APPROVED, REJECTED, CANCELLED, ORDERED

  preferredSupplierId: uuid('preferred_supplier_id').references(() => suppliers.id, { onDelete: 'restrict' }),
  projectId: varchar('project_id', { length: 64 }),
  costCenterId: varchar('cost_center_id', { length: 64 }),

  currency: varchar('currency', { length: 3 }).notNull().default('INR'),
  estimatedTotal: numeric('estimated_total', { precision: 15, scale: 2 }).notNull().default('0.00'),

  notes: text('notes'),

  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  submittedBy: varchar('submitted_by', { length: 64 }),

  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: varchar('approved_by', { length: 64 }),

  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  rejectedBy: varchar('rejected_by', { length: 64 }),
  rejectionReason: text('rejection_reason'),

  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledBy: varchar('cancelled_by', { length: 64 }),
  cancellationReason: text('cancellation_reason'),

  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: varchar('created_by', { length: 64 }).notNull(),
  updatedBy: varchar('updated_by', { length: 64 }).notNull(),
}, (table) => ({
  tenantCompanyReqNumIdx: uniqueIndex('uq_purchase_requests_tenant_company_num').on(table.tenantId, table.companyId, table.requestNumber),
  tenantCompIdx: index('idx_purchase_requests_tenant_comp').on(table.tenantId, table.companyId),
  statusIdx: index('idx_purchase_requests_status').on(table.tenantId, table.companyId, table.status),
  departmentIdx: index('idx_purchase_requests_dept').on(table.tenantId, table.companyId, table.departmentId),
  requesterIdx: index('idx_purchase_requests_requester').on(table.tenantId, table.companyId, table.requesterUserId),
  requiredDateIdx: index('idx_purchase_requests_required_date').on(table.tenantId, table.companyId, table.requiredDate),
  priorityCheck: check('chk_purchase_requests_priority', sql`${table.priority} IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')`),
  statusCheck: check('chk_purchase_requests_status', sql`${table.status} IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'ORDERED')`),
}));

export const purchaseRequestLines = pgTable('purchase_request_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  purchaseRequestId: uuid('purchase_request_id').notNull().references(() => purchaseRequests.id, { onDelete: 'cascade' }),
  lineNumber: integer('line_number').notNull(),

  productId: uuid('product_id').references(() => products.id, { onDelete: 'restrict' }),
  description: text('description').notNull(),

  requestedQuantity: numeric('requested_quantity', { precision: 18, scale: 4 }).notNull(),
  orderedQuantity: numeric('ordered_quantity', { precision: 18, scale: 4 }).notNull().default('0.0000'),
  remainingQuantity: numeric('remaining_quantity', { precision: 18, scale: 4 }).notNull(),

  uom: varchar('uom', { length: 32 }).notNull(),

  estimatedUnitPrice: numeric('estimated_unit_price', { precision: 15, scale: 2 }).notNull().default('0.00'),
  estimatedDiscount: numeric('estimated_discount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  estimatedTax: numeric('estimated_tax', { precision: 15, scale: 2 }).notNull().default('0.00'),
  estimatedLineTotal: numeric('estimated_line_total', { precision: 15, scale: 2 }).notNull().default('0.00'),

  requiredDate: varchar('required_date', { length: 10 }), // YYYY-MM-DD
  preferredSupplierId: uuid('preferred_supplier_id').references(() => suppliers.id, { onDelete: 'restrict' }),
  specification: text('specification'),
  notes: text('notes'),

  projectId: varchar('project_id', { length: 64 }),
  costCenterId: varchar('cost_center_id', { length: 64 }),

  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  prLineNumIdx: uniqueIndex('uq_purchase_request_lines_num').on(table.purchaseRequestId, table.lineNumber),
  productIdx: index('idx_pr_lines_product').on(table.productId),
  qtyCheck: check('chk_pr_lines_requested_qty_pos', sql`${table.requestedQuantity} > 0`),
}));

export type PurchaseRequest = typeof purchaseRequests.$inferSelect;
export type NewPurchaseRequest = typeof purchaseRequests.$inferInsert;
export type PurchaseRequestLine = typeof purchaseRequestLines.$inferSelect;
export type NewPurchaseRequestLine = typeof purchaseRequestLines.$inferInsert;
