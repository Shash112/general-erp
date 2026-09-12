import { pgTable, uuid, varchar, text, boolean, integer, timestamp, numeric, date, uniqueIndex, foreignKey, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './master.js';

export const chartOfAccounts = pgTable('chart_of_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  accountCode: varchar('account_code', { length: 32 }).notNull(),
  accountName: varchar('account_name', { length: 128 }).notNull(),
  nodeType: varchar('node_type', { length: 16 }).notNull().default('ACCOUNT'), // 'GROUP', 'ACCOUNT'
  accountType: varchar('account_type', { length: 32 }).notNull(), // 'ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'
  accountSubtype: varchar('account_subtype', { length: 64 }),    // 'CURRENT_ASSET', 'FIXED_ASSET', 'COGS', etc.
  accountNature: varchar('account_nature', { length: 16 }).notNull().default('NORMAL'), // 'NORMAL', 'CONTRA'
  normalBalance: varchar('normal_balance', { length: 8 }).notNull(), // 'DEBIT', 'CREDIT'
  parentId: uuid('parent_id'),
  isPostable: boolean('is_postable').notNull().default(true),
  isControlAccount: boolean('is_control_account').notNull().default(false),
  controlAccountType: varchar('control_account_type', { length: 32 }), // 'AR', 'AP', 'TAX_INPUT', 'TAX_OUTPUT', 'CASH', 'BANK', 'PAYROLL', 'INVENTORY', 'FIXED_ASSETS'
  currency: varchar('currency', { length: 3 }), // NULL = inherit company base currency
  status: varchar('status', { length: 16 }).notNull().default('ACTIVE'), // 'DRAFT', 'ACTIVE', 'INACTIVE'
  displayOrder: integer('display_order').notNull().default(0),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_coa_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompCodeIdx: uniqueIndex('idx_coa_tenant_comp_code').on(table.tenantId, table.companyId, table.accountCode),
  tenantCompParentFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.parentId],
    foreignColumns: [table.tenantId, table.companyId, table.id]
  }).onDelete('restrict'),
  tenantCompParentIdx: index('idx_coa_tenant_comp_parent').on(table.tenantId, table.companyId, table.parentId),
  tenantCompTypeIdx: index('idx_coa_tenant_comp_type').on(table.tenantId, table.companyId, table.accountType)
}));

export const fiscalYears = pgTable('fiscal_years', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 32 }).notNull(), // e.g. 'FY 2026-27'
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  endDate: timestamp('end_date', { withTimezone: true }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('DRAFT'), // DRAFT, OPEN, CLOSED
  isClosed: boolean('is_closed').notNull().default(false),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedBy: varchar('closed_by', { length: 255 }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompNameIdx: uniqueIndex('idx_fy_tenant_comp_name').on(table.tenantId, table.companyId, table.name)
}));

export const fiscalPeriods = pgTable('fiscal_periods', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  fiscalYearId: uuid('fiscal_year_id').notNull().references(() => fiscalYears.id, { onDelete: 'restrict' }),
  periodNumber: integer('period_number').notNull(), // 1 to 12 (Monthly) or 13 (Adjustment Period)
  periodType: varchar('period_type', { length: 32 }).notNull().default('STANDARD'), // 'STANDARD', 'ADJUSTMENT'
  name: varchar('name', { length: 32 }).notNull(), // e.g. 'APR-2026' or 'ADJ-2026'
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  endDate: timestamp('end_date', { withTimezone: true }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('OPEN'), // OPEN, CLOSING, CLOSED
  isClosed: boolean('is_closed').notNull().default(false),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedBy: varchar('closed_by', { length: 255 }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantFyPeriodNumIdx: uniqueIndex('idx_fp_tenant_fy_num').on(table.tenantId, table.fiscalYearId, table.periodNumber)
}));


export const journalEntries = pgTable('journal_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  voucherNumber: varchar('voucher_number', { length: 64 }), // NULL for DRAFT, populated on POSTED
  fiscalYearId: uuid('fiscal_year_id').notNull().references(() => fiscalYears.id, { onDelete: 'restrict' }),
  fiscalPeriodId: uuid('fiscal_period_id').notNull().references(() => fiscalPeriods.id, { onDelete: 'restrict' }),
  accountingDate: date('accounting_date', { mode: 'string' }).notNull(), // SQL DATE
  postingDate: timestamp('posting_date', { withTimezone: true }),
  sourceModule: varchar('source_module', { length: 64 }).notNull().default('MANUAL'),
  sourceDocumentType: varchar('source_document_type', { length: 64 }),
  sourceDocumentId: varchar('source_document_id', { length: 255 }),
  originalJournalId: uuid('original_journal_id'), // Self-reference for reversal journals
  status: varchar('status', { length: 32 }).notNull().default('DRAFT'), // DRAFT, POSTED, CANCELLED
  totalDebit: numeric('total_debit', { precision: 20, scale: 2 }).notNull().default('0.00'),
  totalCredit: numeric('total_credit', { precision: 20, scale: 2 }).notNull().default('0.00'),
  currency: varchar('currency', { length: 3 }).notNull().default('INR'),
  exchangeRate: numeric('exchange_rate', { precision: 12, scale: 6 }).notNull().default('1.000000'),
  narration: text('narration'),
  createdBy: varchar('created_by', { length: 255 }).notNull(),
  postedBy: varchar('posted_by', { length: 255 }),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompIdIdx: uniqueIndex('idx_je_tenant_comp_id').on(table.tenantId, table.companyId, table.id),
  tenantCompVoucherIdx: uniqueIndex('idx_je_tenant_comp_voucher').on(table.tenantId, table.companyId, table.voucherNumber),
  tenantCompSrcDocIdx: uniqueIndex('idx_je_tenant_comp_src_doc')
    .on(table.tenantId, table.companyId, table.sourceModule, table.sourceDocumentType, table.sourceDocumentId)
    .where(sql`source_document_id IS NOT NULL`),
  tenantCompOriginalJournalIdx: uniqueIndex('idx_je_tenant_comp_original_journal')
    .on(table.tenantId, table.companyId, table.originalJournalId)
    .where(sql`original_journal_id IS NOT NULL`),
  tenantCompOriginalJournalFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.originalJournalId],
    foreignColumns: [table.tenantId, table.companyId, table.id]
  }).onDelete('restrict'),
  tenantCompPeriodIdx: index('idx_je_tenant_comp_period').on(table.tenantId, table.companyId, table.fiscalPeriodId),
  tenantCompDateIdx: index('idx_je_tenant_comp_date').on(table.tenantId, table.companyId, table.accountingDate)
}));

export const journalLines = pgTable('journal_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  journalEntryId: uuid('journal_entry_id').notNull().references(() => journalEntries.id, { onDelete: 'restrict' }),
  accountId: uuid('account_id').notNull().references(() => chartOfAccounts.id, { onDelete: 'restrict' }),
  lineSequence: integer('line_sequence').notNull(),
  debitAmount: numeric('debit_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  creditAmount: numeric('credit_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  currency: varchar('currency', { length: 3 }).notNull().default('INR'),
  exchangeRate: numeric('exchange_rate', { precision: 12, scale: 6 }).notNull().default('1.000000'),
  baseDebitAmount: numeric('base_debit_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  baseCreditAmount: numeric('base_credit_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  narration: text('narration'),
  partyType: varchar('party_type', { length: 32 }),
  partyId: uuid('party_id'),
  branchId: uuid('branch_id'),
  departmentId: uuid('department_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCompJournalFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.journalEntryId],
    foreignColumns: [journalEntries.tenantId, journalEntries.companyId, journalEntries.id]
  }).onDelete('restrict'),
  tenantCompAccountFk: foreignKey({
    columns: [table.tenantId, table.companyId, table.accountId],
    foreignColumns: [chartOfAccounts.tenantId, chartOfAccounts.companyId, chartOfAccounts.id]
  }).onDelete('restrict'),
  tenantCompAccountIdx: index('idx_jl_tenant_comp_account').on(table.tenantId, table.companyId, table.accountId),
  debitPositiveCheck: check('chk_jl_debit_positive', sql`debit_amount >= 0`),
  creditPositiveCheck: check('chk_jl_credit_positive', sql`credit_amount >= 0`),
  exclusivityCheck: check('chk_jl_debit_credit_xor', sql`(debit_amount > 0 AND credit_amount = 0) OR (debit_amount = 0 AND credit_amount > 0)`)
}));

