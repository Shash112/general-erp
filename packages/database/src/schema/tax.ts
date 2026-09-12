import { pgTable, uuid, varchar, text, boolean, integer, timestamp, numeric, date, uniqueIndex, foreignKey, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './master.js';

export const taxCategories = pgTable('tax_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  code: varchar('code', { length: 50 }).notNull(), // e.g. 'STANDARD', 'REDUCED', 'EXEMPT', 'NIL_RATED', 'SUPER_REDUCED', 'SPECIAL'
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 16 }).notNull().default('ACTIVE'), // 'ACTIVE', 'INACTIVE'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_tax_cat_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompCodeIdx: uniqueIndex('idx_tax_cat_tenant_comp_code').on(table.tenantId, table.companyId, table.code)
}));

export const hsnSacCodes = pgTable('hsn_sac_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  code: varchar('code', { length: 10 }).notNull(), // 4, 6, or 8 digits
  description: text('description').notNull(),
  type: varchar('type', { length: 10 }).notNull(), // 'HSN', 'SAC'
  defaultTaxCategoryId: uuid('default_tax_category_id').references(() => taxCategories.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_hsn_sac_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompCodeIdx: uniqueIndex('idx_hsn_sac_tenant_comp_code').on(table.tenantId, table.companyId, table.code),
  tenantCompCategoryFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.defaultTaxCategoryId],
    foreignColumns: [taxCategories.tenantId, taxCategories.companyId, taxCategories.id]
  }).onDelete('restrict'),
  typeCheck: check('chk_hsn_sac_type', sql`type IN ('HSN', 'SAC')`)
}));

export const taxRates = pgTable('tax_rates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  taxCategoryId: uuid('tax_category_id').notNull().references(() => taxCategories.id, { onDelete: 'restrict' }),
  rateType: varchar('rate_type', { length: 20 }).notNull(), // 'CGST', 'SGST', 'IGST', 'UTGST', 'CESS'
  ratePercent: numeric('rate_percent', { precision: 9, scale: 6 }).notNull(), // e.g. 18.000000, 9.000000, 2.500000
  validFrom: date('valid_from', { mode: 'string' }).notNull(),
  validTo: date('valid_to', { mode: 'string' }), // NULL = open-ended
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_tax_rates_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompCategoryFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.taxCategoryId],
    foreignColumns: [taxCategories.tenantId, taxCategories.companyId, taxCategories.id]
  }).onDelete('restrict'),
  tenantCompCategoryIdx: index('idx_tax_rates_tenant_comp_cat').on(table.tenantId, table.companyId, table.taxCategoryId),
  rateTypeCheck: check('chk_tax_rates_type', sql`rate_type IN ('CGST', 'SGST', 'IGST', 'UTGST', 'CESS')`),
  ratePercentCheck: check('chk_tax_rates_percent_non_negative', sql`rate_percent >= 0`),
  validityRangeCheck: check('chk_tax_rates_validity_range', sql`valid_to IS NULL OR valid_to >= valid_from`)
}));

export const taxRules = pgTable('tax_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  taxCategoryId: uuid('tax_category_id').references(() => taxCategories.id, { onDelete: 'restrict' }),
  hsnSacCodeId: uuid('hsn_sac_code_id').references(() => hsnSacCodes.id, { onDelete: 'restrict' }),
  supplyType: varchar('supply_type', { length: 32 }).notNull().default('ALL'), // 'ALL', 'INTRA_STATE', 'INTER_STATE', 'SEZ_DEVELOPER', 'SEZ_UNIT', 'DEEMED_EXPORT', 'EXPORT', 'IMPORT'
  taxability: varchar('taxability', { length: 20 }).notNull().default('TAXABLE'), // 'TAXABLE', 'EXEMPT', 'NIL_RATED', 'NON_GST'
  isRcm: boolean('is_rcm').notNull().default(false),
  isSez: boolean('is_sez').notNull().default(false),
  priority: integer('priority').notNull().default(10),
  status: varchar('status', { length: 16 }).notNull().default('ACTIVE'),
  validFrom: date('valid_from', { mode: 'string' }).notNull(),
  validTo: date('valid_to', { mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_tax_rules_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompCategoryFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.taxCategoryId],
    foreignColumns: [taxCategories.tenantId, taxCategories.companyId, taxCategories.id]
  }).onDelete('restrict'),
  tenantCompHsnSacFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.hsnSacCodeId],
    foreignColumns: [hsnSacCodes.tenantId, hsnSacCodes.companyId, hsnSacCodes.id]
  }).onDelete('restrict'),
  taxabilityCheck: check('chk_tax_rules_taxability', sql`taxability IN ('TAXABLE', 'EXEMPT', 'NIL_RATED', 'NON_GST')`),
  validityRangeCheck: check('chk_tax_rules_validity_range', sql`valid_to IS NULL OR valid_to >= valid_from`)
}));
