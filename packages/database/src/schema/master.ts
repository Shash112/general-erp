import { pgTable, uuid, varchar, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  legalName: varchar('legal_name', { length: 255 }).notNull(),
  gstin: varchar('gstin', { length: 15 }),
  pan: varchar('pan', { length: 10 }),
  currency: varchar('currency', { length: 3 }).notNull().default('INR'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantNameIdx: uniqueIndex('idx_companies_tenant_name').on(table.tenantId, table.name)
}));

export const branches = pgTable('branches', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  name: varchar('name', { length: 128 }).notNull(),
  code: varchar('code', { length: 32 }).notNull(),
  stateCode: varchar('state_code', { length: 2 }).notNull(),
  address: jsonb('address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantBranchCodeIdx: uniqueIndex('idx_branches_tenant_company_code').on(table.tenantId, table.companyId, table.code)
}));

export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  name: varchar('name', { length: 128 }).notNull(),
  code: varchar('code', { length: 32 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export { products, customers, suppliers } from './commercial-master.js';


