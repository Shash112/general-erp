import { pgTable, uuid, varchar, text, boolean, integer, timestamp, numeric, date, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies, branches } from './master.js';

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 255 }).notNull(),
  code: varchar('code', { length: 64 }).notNull(),
  sku: varchar('sku', { length: 64 }).notNull(),
  productType: varchar('product_type', { length: 32 }).notNull().default('GOODS'), // GOODS, SERVICE
  category: varchar('category', { length: 128 }),
  hsnSac: varchar('hsn_sac', { length: 10 }),
  baseUom: varchar('base_uom', { length: 20 }).notNull().default('PCS'),
  purchasePrice: numeric('purchase_price', { precision: 15, scale: 2 }).notNull().default('0.00'),
  sellingPrice: numeric('selling_price', { precision: 15, scale: 2 }).notNull().default('0.00'),
  minOrderQty: numeric('min_order_qty', { precision: 15, scale: 4 }).notNull().default('1.0000'),
  isSellable: boolean('is_sellable').notNull().default(true),
  isPurchasable: boolean('is_purchasable').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  customFields: jsonb('custom_fields').notNull().default({}),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_products_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantProductCodeIdx: uniqueIndex('idx_products_tenant_company_code').on(table.tenantId, table.companyId, table.code),
  tenantProductSkuIdx: uniqueIndex('idx_products_tenant_company_sku').on(table.tenantId, table.companyId, table.sku)
}));

import { jsonb } from 'drizzle-orm/pg-core';

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 255 }).notNull(),
  legalName: varchar('legal_name', { length: 255 }),
  code: varchar('code', { length: 64 }).notNull(),
  gstin: varchar('gstin', { length: 15 }),
  gstType: varchar('gst_type', { length: 32 }).notNull().default('REGULAR'), // REGULAR, COMPOSITION, SEZ, UNREGISTERED
  pan: varchar('pan', { length: 10 }),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 32 }),
  currency: varchar('currency', { length: 3 }).notNull().default('INR'),
  paymentTermsId: varchar('payment_terms_id', { length: 64 }),
  creditLimit: numeric('credit_limit', { precision: 15, scale: 2 }).notNull().default('0.00'),
  creditDays: integer('credit_days').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  customFields: jsonb('custom_fields').notNull().default({}),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_customers_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCustomerCodeIdx: uniqueIndex('idx_customers_tenant_company_code').on(table.tenantId, table.companyId, table.code)
}));

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 255 }).notNull(),
  legalName: varchar('legal_name', { length: 255 }),
  code: varchar('code', { length: 64 }).notNull(),
  gstin: varchar('gstin', { length: 15 }),
  gstType: varchar('gst_type', { length: 32 }).notNull().default('REGULAR'),
  pan: varchar('pan', { length: 10 }),
  msmeType: varchar('msme_type', { length: 32 }).notNull().default('NONE'), // MICRO, SMALL, MEDIUM, NONE
  msmeRegNo: varchar('msme_reg_no', { length: 64 }),
  tdsSection: varchar('tds_section', { length: 32 }),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 32 }),
  currency: varchar('currency', { length: 3 }).notNull().default('INR'),
  paymentTermsId: varchar('payment_terms_id', { length: 64 }),
  isActive: boolean('is_active').notNull().default(true),
  customFields: jsonb('custom_fields').notNull().default({}),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_suppliers_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantSupplierCodeIdx: uniqueIndex('idx_suppliers_tenant_company_code').on(table.tenantId, table.companyId, table.code)
}));

export const commercialAddresses = pgTable('commercial_addresses', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'cascade' }),
  supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
  addressType: varchar('address_type', { length: 32 }).notNull().default('BILLING'), // BILLING, SHIPPING, OFFICE, REGISTERED, OTHER
  addressLine1: varchar('address_line1', { length: 255 }).notNull(),
  addressLine2: varchar('address_line2', { length: 255 }),
  city: varchar('city', { length: 128 }).notNull(),
  district: varchar('district', { length: 128 }),
  state: varchar('state', { length: 128 }).notNull(),
  stateCode: varchar('state_code', { length: 2 }).notNull(),
  postalCode: varchar('postal_code', { length: 10 }).notNull(),
  country: varchar('country', { length: 3 }).notNull().default('IND'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_comm_addr_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  customerIdx: index('idx_comm_addr_customer').on(table.tenantId, table.companyId, table.customerId),
  supplierIdx: index('idx_comm_addr_supplier').on(table.tenantId, table.companyId, table.supplierId),
  branchIdx: index('idx_comm_addr_branch').on(table.tenantId, table.companyId, table.branchId),
  oneParentCheck: check('chk_comm_addr_one_parent', sql`((customer_id IS NOT NULL)::int + (supplier_id IS NOT NULL)::int + (branch_id IS NOT NULL)::int) = 1`)
}));

export const commercialContacts = pgTable('commercial_contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'cascade' }),
  supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  designation: varchar('designation', { length: 128 }),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 32 }),
  mobile: varchar('mobile', { length: 32 }),
  isPrimary: boolean('is_primary').notNull().default(false),
  customFields: jsonb('custom_fields').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_comm_cont_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  customerIdx: index('idx_comm_cont_customer').on(table.tenantId, table.companyId, table.customerId),
  supplierIdx: index('idx_comm_cont_supplier').on(table.tenantId, table.companyId, table.supplierId),
  branchIdx: index('idx_comm_cont_branch').on(table.tenantId, table.companyId, table.branchId),
  oneParentCheck: check('chk_comm_cont_one_parent', sql`((customer_id IS NOT NULL)::int + (supplier_id IS NOT NULL)::int + (branch_id IS NOT NULL)::int) = 1`)
}));

export const uomDefinitions = pgTable('uom_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  code: varchar('code', { length: 20 }).notNull(),
  name: varchar('name', { length: 128 }).notNull(),
  symbol: varchar('symbol', { length: 20 }).notNull(),
  category: varchar('category', { length: 64 }).notNull().default('UNIT'),
  precision: integer('precision').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_uom_def_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompCodeIdx: uniqueIndex('idx_uom_def_tenant_comp_code').on(table.tenantId, table.companyId, table.code)
}));

export const uomConversions = pgTable('uom_conversions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  fromUom: varchar('from_uom', { length: 20 }).notNull(),
  toUom: varchar('to_uom', { length: 20 }).notNull(),
  conversionFactor: numeric('conversion_factor', { precision: 18, scale: 6 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_uom_conv_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompPairIdx: uniqueIndex('idx_uom_conv_tenant_comp_pair').on(table.tenantId, table.companyId, table.fromUom, table.toUom)
}));

export const pricingLists = pgTable('pricing_lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  code: varchar('code', { length: 64 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  pricingType: varchar('pricing_type', { length: 32 }).notNull().default('SALES'), // SALES, PURCHASE
  currency: varchar('currency', { length: 3 }).notNull().default('INR'),
  effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
  effectiveTo: date('effective_to', { mode: 'string' }),
  isActive: boolean('is_active').notNull().default(true),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_pricing_list_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompCodeIdx: uniqueIndex('idx_pricing_list_tenant_comp_code').on(table.tenantId, table.companyId, table.code)
}));

export const pricingRules = pgTable('pricing_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  pricingListId: uuid('pricing_list_id').references(() => pricingLists.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'cascade' }),
  supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'cascade' }),
  unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('INR'),
  effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
  effectiveTo: date('effective_to', { mode: 'string' }),
  minQuantity: numeric('min_quantity', { precision: 15, scale: 4 }).notNull().default('1.0000'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_pricing_rule_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompProductIdx: index('idx_pricing_rule_product').on(table.tenantId, table.companyId, table.productId),
  tenantCompCustomerIdx: index('idx_pricing_rule_customer').on(table.tenantId, table.companyId, table.customerId),
  tenantCompSupplierIdx: index('idx_pricing_rule_supplier').on(table.tenantId, table.companyId, table.supplierId)
}));

export const pricingQuantityTiers = pgTable('pricing_quantity_tiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  pricingRuleId: uuid('pricing_rule_id').notNull().references(() => pricingRules.id, { onDelete: 'cascade' }),
  minQuantity: numeric('min_quantity', { precision: 15, scale: 4 }).notNull(),
  maxQuantity: numeric('max_quantity', { precision: 15, scale: 4 }),
  unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull(),
  discountPercent: numeric('discount_percent', { precision: 5, scale: 2 }).notNull().default('0.00'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_pricing_tier_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  ruleIdx: index('idx_pricing_tier_rule').on(table.tenantId, table.companyId, table.pricingRuleId)
}));

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;
export type CommercialAddress = typeof commercialAddresses.$inferSelect;
export type NewCommercialAddress = typeof commercialAddresses.$inferInsert;
export type CommercialContact = typeof commercialContacts.$inferSelect;
export type NewCommercialContact = typeof commercialContacts.$inferInsert;
export type UomDefinition = typeof uomDefinitions.$inferSelect;
export type NewUomDefinition = typeof uomDefinitions.$inferInsert;
export type UomConversion = typeof uomConversions.$inferSelect;
export type NewUomConversion = typeof uomConversions.$inferInsert;
export type PricingList = typeof pricingLists.$inferSelect;
export type NewPricingList = typeof pricingLists.$inferInsert;
export type PricingRule = typeof pricingRules.$inferSelect;
export type NewPricingRule = typeof pricingRules.$inferInsert;
export type PricingQuantityTier = typeof pricingQuantityTiers.$inferSelect;
export type NewPricingQuantityTier = typeof pricingQuantityTiers.$inferInsert;
