# Phase 2 Implementation Plan — Finance Core & Foundation Productionization

**Status:** Architecture Locked & Finalized / Pre-Implementation Gate Complete  
**Date:** 2026-09-09  
**Execution State:** NOT STARTED (Waiting for explicit Phase 2.0 user approval)

---

## Executive Summary & Final Architecture Lock Overview

This document presents the finalized, locked implementation plan for **Phase 2 — Finance Core & Foundation Productionization**. 

In strict compliance with the **Final Pre-Implementation Architecture Lock**, Phase 2 establishes the authoritative financial subsystem for General ERP on top of the Phase 1 platform engines. Before building operational domain modules (Sales, Procurement, Inventory, HR, Payroll, Projects), the core accounting system must be production-ready, fully persisted in PostgreSQL, multi-tenant isolated, concurrency-safe, and compliant with Indian statutory requirements (GST & Companies Act accounting standards within the defined Phase 2 scope).

**ZERO source code, database migrations, seed scripts, or API routes have been created.** Implementation will commence ONLY after explicit user authorization for **Phase 2.0**.

---

## Phase 2 Architecture Lock Enhancements

Following the final architecture audit, the following key enhancements have been locked into the plan:

1. **Enterprise Monetary Precision (`numeric(20, 2)`):** Upgraded monetary column precision from `numeric(15,2)` to `numeric(20,2)` across all financial tables. This supports enterprise-scale amounts up to 18 integer digits (₹99,999,999,999,999,999.99) while maintaining exact 2-decimal scale. Exchange rates and tax percentages remain `numeric(12,6)` and `numeric(5,4)` respectively.
2. **Dual-Layer Financial Idempotency:**
   - *Layer 1 (API Request Idempotency):* `Idempotency-Key` header with 24-hour response caching in `idempotency_keys`.
   - *Layer 2 (Business Document Idempotency):* Unique database index `idx_je_tenant_comp_src_doc` on `(tenant_id, company_id, source_module, source_document_id)` for active journals, preventing duplicate GL postings for the same source document even if a different request or voucher number is generated.
3. **Complete 20 Financial Invariants Enforcement Matrix:** Created a complete matrix mapping all 20 non-negotiable financial invariants to their database constraint, service enforcement, authorization rule, automated test type, and failure behavior.
4. **Strict Sub-Phase Execution Gating Policy:** Established the process rule that implementation proceeds ONE SUB-PHASE AT A TIME. Upon completing each sub-phase (e.g. Phase 2.0), the agent must stop, run full tests/builds, produce a sub-phase report, and WAIT FOR EXPLICIT USER APPROVAL before starting the next sub-phase.
5. **Scoped Statutory Claim Language:** Formally scoped all statutory compliance statements to "Designed to support Indian accounting and GST requirements within the defined Phase 2 scope."

---

## 1. Phase 2 Goals

1. **Foundation Productionization:** Transition all in-memory platform dependencies required by Finance (e.g., Numbering sequence generator) into fully persisted PostgreSQL schemas with atomic row locks (`FOR UPDATE`).
2. **Authoritative Chart of Accounts (COA):** Establish a hierarchical, multi-tenant, company-scoped Chart of Accounts with control accounts for AR, AP, Tax, Cash, Bank, and Retained Earnings.
3. **General Ledger (GL) & Journal Engine:** Build a high-throughput, transactional GL posting engine enforcing the non-negotiable financial invariant `Total Debit == Total Credit`, immutable posted records, and period locking.
4. **India GST Tax Engine:** Implement a centralized Tax Engine capable of calculating CGST, SGST, IGST, and Cess based on Place of Supply state codes, effective-dated tax categories, and tax-inclusive/exclusive pricing.
5. **Authoritative AR & AP Subledgers:** Provide transactionally derived open-item subledgers for Customer Receivables (AR) and Supplier Payables (AP), including open-item matching, ageing reports, payments, receipts, and advance processing.
6. **Fiscal Year & Flexible Period Closing:** Enforce period locking, 13-period support (12 monthly + 1 adjustment period), year-end closing routines, opening balance carry-forward, and audited period reopening.
7. **Financial Reporting Primitives:** Provide deterministic query services for Trial Balance, General Ledger, Customer/Supplier Statements, AR/AP Ageing, Profit & Loss (P&L), and Balance Sheet.

---

## 2. Scope

- PostgreSQL database migrations for Chart of Accounts, Fiscal Years/Periods, Journal Entries, Journal Lines, Accounts Receivable, Accounts Payable, Payments/Receipts, Banking, Cash, Opening Balances, and Tax Rates.
- Persistent `numbering_sequences` schema to eliminate in-memory sequence allocation.
- Centralized `TaxEngineService` supporting Indian GST rules (Intra-state CGST+SGST, Inter-state IGST, Cess, Place of Supply, Effective-dated rates).
- `AccountingCoreService` supporting `createJournal`, `validateJournal`, `postJournal`, `reverseJournal`, `getLedger`, `getAccountBalance`, `getTrialBalance`.
- Accounts Receivable (`ARService`) and Accounts Payable (`APService`) subledger open-item settlement and matching engines.
- Banking & Cash payment/receipt voucher processing (`BankingService`).
- Fiscal Period closing & year-end roll-forward (`FiscalPeriodService`).
- Standard financial reports (`TrialBalance`, `GeneralLedger`, `BalanceSheet`, `ProfitAndLoss`, `ARAgeing`, `APAgeing`).
- 6 automated financial reconciliation routines and 20 non-negotiable invariant test suites.

---

## 3. Out of Scope

- Operational Sales Module (Quotations, Sales Orders, Delivery Notes, Sales Invoicing UI) — Phase 3.
- Procurement Module (Purchase Orders, Receiving/GRN, 3-Way Matching UI) — Phase 3.
- Inventory Valuation & Stock Movement Ledgers — Phase 2/3 boundary (Inventory stock valuation subledger handled in Phase 2.5/Phase 3).
- HR, Payroll, Attendance, Expense Claims — Phase 4.
- External E-Invoice / E-Way Bill GSP API integrations — Phase 5.
- Bank Feeds / Automated Reconciliation APIs — Phase 5.
- AI Gateway & Automated Journal Suggestions — Phase 6.

---

## 4. Foundation Gaps Analysis

Prior to building Finance domain logic, the following platform gaps identified in the Phase 1 Review must be productionized in **Phase 2.0**:

| Platform Capability | Current State | Required State for Finance | Phase 2 Work Required | Can Finance Proceed Before Gap Fix? | Risk |
|---|---|---|---|---|---|
| **Numbering Engine** | In-Memory `Map` counter | PostgreSQL-persisted sequence counter with `SELECT ... FOR UPDATE` atomic locks | Create `numbering_sequences` table in Drizzle schema & update `NumberingEngine` to query DB atomically | **NO** (Must be completed in Phase 2.0) | High (Duplicate document numbers under concurrent load) |
| **Tax Engine** | Contract-only primitives | Centralized India GST calculation engine (CGST/SGST/IGST/Cess) | Build `TaxEngineService` with Place of Supply rules, effective-dated rate matrix | **NO** (Finance invoicing depends on Tax) | Critical (Incorrect statutory tax calculations) |
| **Accounting Engine** | Contract boundary validator | Authoritative GL posting pipeline with COA, subledgers, & period locking | Expand boundary into `AccountingCoreService` with DB persistence | **NO** | Critical (Unbalanced or corrupt financial records) |
| **Configuration Engine** | Key-value validator | Pre-seeded financial defaults (AR/AP control accounts, tax accounts, default currency) | Seed tenant financial configuration keys during company initialization | **YES** (Can run in parallel with COA setup) | Low |
| **Workflow Engine** | Basic state machine | Financial document approval workflows (Manual Journals, Credit Notes, Write-offs) | Define DAG approval steps for financial threshold limits | **YES** (Can integrate during AR/AP phase) | Medium |

---

## 5. Architecture & Layering Rules

Finance is a business domain that consumes platform engines. Strict unidirectional layering is maintained:

```text
+-----------------------------------------------------------------------+
|                       PLATFORM ENGINES LAYER                         |
| Authorization | Audit | Numbering | Workflow | Rules | Config | Jobs |
+-----------------------------------------------------------------------+
                                   │ (Consumes platform contracts)
                                   ▼
+-----------------------------------------------------------------------+
|                         FINANCE DOMAIN CORE                           |
|  COA | Fiscal Periods | Tax Engine | GL Posting | AR/AP | Banking     |
+-----------------------------------------------------------------------+
                                   │ (Exposes stable Finance APIs)
                                   ▼
+-----------------------------------------------------------------------+
|                      FUTURE OPERATIONAL MODULES                       |
|           Sales (P3) | Procurement (P3) | Payroll (P4)              |
+-----------------------------------------------------------------------+
```

### Architectural Principles
1. **Zero Reverse Dependencies:** Platform engines must NEVER import from Finance (`apps/api/src/platform/**` -> `apps/api/src/modules/finance/**` strictly forbidden).
2. **Platform Engine Usage:** Finance MUST consume platform `AuthorizationService`, `AuditService`, `NumberingEngine`, `WorkflowService`, and `RulesEngine`. It must not invent duplicate security or sequence logic.
3. **API-First Financial Mutations:** Operational modules MUST interact with Finance solely via `AccountingCoreService`, `ARService`, `APService`, `BankingService`, and `TaxEngineService`. Direct SQL mutation of GL or subledger tables by external modules is strictly prohibited.

---

## 6. Authoritative Financial Ownership

Finance is the sole authoritative owner of all financial state across the ERP monorepo:

| Domain Entity | Authoritative Owner | Non-Finance Module Access Rule |
|---|---|---|
| Chart of Accounts (COA) | `Finance:COAService` | Read-only |
| General Ledger (GL) & Journal Entries | `Finance:AccountingCoreService` | Mutate via `postJournal()` API only |
| Accounts Receivable (AR) & Open Items | `Finance:ARService` | Mutate via `createARInvoice()` / `applyReceipt()` APIs only |
| Accounts Payable (AP) & Open Items | `Finance:APService` | Mutate via `createAPBill()` / `applyPayment()` APIs only |
| GST Tax Calculations | `Finance:TaxEngineService` | Calculate via `calculateTax()` API only |
| Fiscal Periods & Period Closing | `Finance:FiscalPeriodService` | Read status / Validate posting date |
| Bank & Cash Accounts | `Finance:BankingService` | Mutate via `recordPaymentReceipt()` API only |
| Opening Balances | `Finance:OpeningBalanceService` | Mutate via `setupOpeningBalances()` API only |

---

## 7. Monetary Arithmetic & Rounding Policy

Floating-point arithmetic (`number` in JS) is strictly forbidden for financial calculations due to binary representation inaccuracy (e.g. `0.1 + 0.2 = 0.30000000000000004`).

### 7.1 Authoritative Monetary Representation
- **Runtime Representation:** All monetary amounts are handled as arbitrary-precision fixed-point decimal objects using a dedicated decimal library (`decimal.js` or `bignumber.js`) or explicit integer-scaled representations.
- **Database Precision:**
  - Monetary amounts (Debit, Credit, Invoice Total, Tax Amount, Open Item Balance): `numeric(20, 2)` (supports up to ₹99,999,999,999,999,999.99).
  - Exchange Rates & Multi-currency conversion factors: `numeric(12, 6)`.
  - Tax Percentages & Discount Rates: `numeric(5, 4)` (e.g., `0.1800` for 18.00%).
- **API Serialization:** All monetary numbers in JSON requests and responses MUST be serialized as formatted string decimals (e.g., `"1250.50"`), NEVER as unrounded JSON floats.

### 7.2 Rounding Mode & Test Vectors
- **Rounding Mode:** **Half-Even Rounding (Banker's Rounding)**. If the discarded fraction is exactly 0.5, the result is rounded to the nearest EVEN integer.
- **Test Vectors (Half-Even Rounding to 2 Decimals):**
  - `2.504` -> `2.50`
  - `2.505` -> `2.50` (rounds down to even digit `0`)
  - `2.515` -> `2.52` (rounds up to even digit `2`)
  - `2.525` -> `2.52` (rounds down to even digit `2`)
  - `2.535` -> `2.54` (rounds up to even digit `4`)
  - `-2.505` -> `-2.50`

---

## 8. Database Schemas & Deletion Security Policies

The following schemas will be created in `packages/database/src/schema/accounting.ts` and `master.ts` during implementation.

### Deletion & Cascading Foreign Key Security Policy
- **Rule 1 (Immutability of Posted Financial Records):** `journal_entries`, `journal_lines`, `ar_invoices`, `ap_bills`, `ar_open_items`, `ap_open_items`, `receipt_allocations`, and `payment_allocations` MUST NEVER use `ON DELETE CASCADE`. All foreign keys reference parent headers with `ON DELETE RESTRICT`.
- **Rule 2 (Draft Deletion):** Only unposted draft documents (`status = 'DRAFT'`) may be hard-deleted or soft-deleted. Once a document is posted (`POSTED`), database constraints reject `DELETE` operations.

### 8.1 `numbering_sequences` (Platform Productionization)
```typescript
export const numberingSequences = pgTable('numbering_sequences', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: varchar('company_id', { length: 64 }).notNull(),
  documentType: varchar('document_type', { length: 64 }).notNull(),
  fiscalYear: varchar('fiscal_year', { length: 32 }).notNull(),
  branchCode: varchar('branch_code', { length: 32 }).notNull().default('DEFAULT'),
  currentSequence: integer('current_sequence').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantSeqIdx: uniqueIndex('idx_num_seq_tenant_doc').on(
    table.tenantId, table.companyId, table.documentType, table.fiscalYear, table.branchCode
  )
}));
```

### 8.2 `account_groups` & `chart_of_accounts`
```typescript
export const accountGroups = pgTable('account_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  code: varchar('code', { length: 32 }).notNull(),
  name: varchar('name', { length: 128 }).notNull(),
  category: varchar('category', { length: 32 }).notNull(), // ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
  parentId: uuid('parent_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const chartOfAccounts = pgTable('chart_of_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  groupId: uuid('group_id').references(() => accountGroups.id, { onDelete: 'restrict' }),
  accountCode: varchar('account_code', { length: 32 }).notNull(),
  accountName: varchar('account_name', { length: 128 }).notNull(),
  accountType: varchar('account_type', { length: 32 }).notNull(), // ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
  accountSubType: varchar('account_sub_type', { length: 64 }),    // CURRENT_ASSET, FIXED_ASSET, DIRECT_EXPENSE, etc.
  parentId: uuid('parent_id'),
  isControlAccount: boolean('is_control_account').notNull().default(false),
  controlAccountType: varchar('control_account_type', { length: 32 }), // 'AR', 'AP', 'TAX', 'CASH', 'BANK'
  isActive: boolean('is_active').notNull().default(true),
  currency: varchar('currency', { length: 3 }).notNull().default('INR'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantCodeIdx: uniqueIndex('idx_coa_tenant_comp_code').on(table.tenantId, table.companyId, table.accountCode)
}));
```

### 8.3 Flexible `fiscal_years` & `fiscal_periods`
```typescript
export const fiscalYears = pgTable('fiscal_years', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 32 }).notNull(), // e.g. 'FY 2025-26'
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  endDate: timestamp('end_date', { withTimezone: true }).notNull(),
  isClosed: boolean('is_closed').notNull().default(false),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedBy: varchar('closed_by', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const fiscalPeriods = pgTable('fiscal_periods', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  fiscalYearId: uuid('fiscal_year_id').notNull().references(() => fiscalYears.id, { onDelete: 'restrict' }),
  periodNumber: integer('period_number').notNull(), // 1 to 12 (Monthly) or 13 (Adjustment Period)
  periodType: varchar('period_type', { length: 32 }).notNull().default('STANDARD'), // 'STANDARD', 'ADJUSTMENT'
  name: varchar('name', { length: 32 }).notNull(), // e.g. 'APR-2025' or 'ADJ-2025'
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  endDate: timestamp('end_date', { withTimezone: true }).notNull(),
  isClosed: boolean('is_closed').notNull().default(false),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedBy: varchar('closed_by', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
```

### 8.4 `journal_entries` & `journal_lines` (RESTRICTED Deletion & Dual Idempotency)
```typescript
export const journalEntries = pgTable('journal_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  voucherNumber: varchar('voucher_number', { length: 64 }).notNull(),
  entryDate: timestamp('entry_date', { withTimezone: true }).notNull(),
  postingDate: timestamp('posting_date', { withTimezone: true }).notNull(),
  fiscalPeriodId: uuid('fiscal_period_id').notNull().references(() => fiscalPeriods.id, { onDelete: 'restrict' }),
  sourceModule: varchar('source_module', { length: 64 }).notNull(), // 'sales', 'procurement', 'finance', 'payroll'
  sourceDocumentId: varchar('source_document_id', { length: 255 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('DRAFT'), // DRAFT, SUBMITTED, APPROVED, POSTED, REVERSED
  currency: varchar('currency', { length: 3 }).notNull().default('INR'),
  exchangeRate: numeric('exchange_rate', { precision: 12, scale: 6 }).notNull().default('1.000000'),
  totalDebit: numeric('total_debit', { precision: 20, scale: 2 }).notNull(),
  totalCredit: numeric('total_credit', { precision: 20, scale: 2 }).notNull(),
  narration: text('narration'),
  createdBy: varchar('created_by', { length: 255 }).notNull(),
  postedBy: varchar('posted_by', { length: 255 }),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  reversedBy: varchar('reversed_by', { length: 255 }),
  reversedAt: timestamp('reversed_at', { withTimezone: true }),
  reversalJournalId: uuid('reversal_journal_id'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantVoucherIdx: uniqueIndex('idx_je_tenant_comp_voucher').on(table.tenantId, table.companyId, table.voucherNumber),
  tenantSourceDocIdx: uniqueIndex('idx_je_tenant_comp_src_doc').on(table.tenantId, table.companyId, table.sourceModule, table.sourceDocumentId)
}));

export const journalLines = pgTable('journal_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  journalEntryId: uuid('journal_entry_id').notNull().references(() => journalEntries.id, { onDelete: 'restrict' }),
  accountId: uuid('account_id').notNull().references(() => chartOfAccounts.id, { onDelete: 'restrict' }),
  partyType: varchar('party_type', { length: 32 }), // 'CUSTOMER', 'SUPPLIER', 'NONE'
  partyId: uuid('party_id'),
  debitAmount: numeric('debit_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  creditAmount: numeric('credit_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  narration: text('narration'),
  branchId: uuid('branch_id'),
  departmentId: uuid('department_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
```

### 8.5 Authoritative AR Open Items & Allocations Schema (`numeric(20,2)`)
```typescript
export const arInvoices = pgTable('ar_invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
  invoiceNumber: varchar('invoice_number', { length: 64 }).notNull(),
  invoiceDate: timestamp('invoice_date', { withTimezone: true }).notNull(),
  dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, { onDelete: 'restrict' }),
  subtotal: numeric('subtotal', { precision: 20, scale: 2 }).notNull(),
  taxTotal: numeric('tax_total', { precision: 20, scale: 2 }).notNull(),
  grandTotal: numeric('grand_total', { precision: 20, scale: 2 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('UNPAID'), // UNPAID, PARTIAL, PAID, CANCELLED
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const arOpenItems = pgTable('ar_open_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
  arInvoiceId: uuid('ar_invoice_id').notNull().references(() => arInvoices.id, { onDelete: 'restrict' }),
  originalAmount: numeric('original_amount', { precision: 20, scale: 2 }).notNull(),
  allocatedAmount: numeric('allocated_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  openBalance: numeric('open_balance', { precision: 20, scale: 2 }).notNull(),
  isSettled: boolean('is_settled').notNull().default(false),
  dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const receipts = pgTable('receipts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
  receiptNumber: varchar('receipt_number', { length: 64 }).notNull(),
  receiptDate: timestamp('receipt_date', { withTimezone: true }).notNull(),
  paymentMethod: varchar('payment_method', { length: 32 }).notNull(), // BANK_TRANSFER, CHEQUE, CASH, UPI
  bankAccountId: uuid('bank_account_id'),
  totalAmount: numeric('total_amount', { precision: 20, scale: 2 }).notNull(),
  unallocatedAmount: numeric('unallocated_amount', { precision: 20, scale: 2 }).notNull(),
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, { onDelete: 'restrict' }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const arReceiptAllocations = pgTable('ar_receipt_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  receiptId: uuid('receipt_id').notNull().references(() => receipts.id, { onDelete: 'restrict' }),
  arOpenItemId: uuid('ar_open_item_id').notNull().references(() => arOpenItems.id, { onDelete: 'restrict' }),
  allocatedAmount: numeric('allocated_amount', { precision: 20, scale: 2 }).notNull(),
  allocatedAt: timestamp('allocated_at', { withTimezone: true }).notNull().defaultNow()
});
```

### 8.6 Authoritative AP Open Items & Allocations Schema (`numeric(20,2)`)
```typescript
export const apBills = pgTable('ap_bills', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'restrict' }),
  billNumber: varchar('bill_number', { length: 64 }).notNull(),
  billDate: timestamp('bill_date', { withTimezone: true }).notNull(),
  dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, { onDelete: 'restrict' }),
  subtotal: numeric('subtotal', { precision: 20, scale: 2 }).notNull(),
  taxTotal: numeric('tax_total', { precision: 20, scale: 2 }).notNull(),
  grandTotal: numeric('grand_total', { precision: 20, scale: 2 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('UNPAID'), // UNPAID, PARTIAL, PAID, CANCELLED
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const apOpenItems = pgTable('ap_open_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'restrict' }),
  apBillId: uuid('ap_bill_id').notNull().references(() => apBills.id, { onDelete: 'restrict' }),
  originalAmount: numeric('original_amount', { precision: 20, scale: 2 }).notNull(),
  allocatedAmount: numeric('allocated_amount', { precision: 20, scale: 2 }).notNull().default('0.00'),
  openBalance: numeric('open_balance', { precision: 20, scale: 2 }).notNull(),
  isSettled: boolean('is_settled').notNull().default(false),
  dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'restrict' }),
  paymentNumber: varchar('payment_number', { length: 64 }).notNull(),
  paymentDate: timestamp('payment_date', { withTimezone: true }).notNull(),
  paymentMethod: varchar('payment_method', { length: 32 }).notNull(), // BANK_TRANSFER, CHEQUE, CASH, UPI
  bankAccountId: uuid('bank_account_id'),
  totalAmount: numeric('total_amount', { precision: 20, scale: 2 }).notNull(),
  unallocatedAmount: numeric('unallocated_amount', { precision: 20, scale: 2 }).notNull(),
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, { onDelete: 'restrict' }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const apPaymentAllocations = pgTable('ap_payment_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  paymentId: uuid('payment_id').notNull().references(() => payments.id, { onDelete: 'restrict' }),
  apOpenItemId: uuid('ap_open_item_id').notNull().references(() => apOpenItems.id, { onDelete: 'restrict' }),
  allocatedAmount: numeric('allocated_amount', { precision: 20, scale: 2 }).notNull(),
  allocatedAt: timestamp('allocated_at', { withTimezone: true }).notNull().defaultNow()
});
```

### 8.7 Banking & Cash Accounts Schema
```typescript
export const bankAccounts = pgTable('bank_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  accountName: varchar('account_name', { length: 128 }).notNull(),
  bankName: varchar('bank_name', { length: 128 }).notNull(),
  accountNumber: varchar('account_number', { length: 64 }).notNull(),
  ifscCode: varchar('ifsc_code', { length: 11 }).notNull(),
  branchName: varchar('branch_name', { length: 128 }),
  glAccountId: uuid('gl_account_id').notNull().references(() => chartOfAccounts.id, { onDelete: 'restrict' }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const cashAccounts = pgTable('cash_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  accountName: varchar('account_name', { length: 128 }).notNull(),
  glAccountId: uuid('gl_account_id').notNull().references(() => chartOfAccounts.id, { onDelete: 'restrict' }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
```

### 8.8 Effective-Dated Tax Configuration Schema
```typescript
export const taxCategories = pgTable('tax_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  code: varchar('code', { length: 32 }).notNull(), // 'STANDARD_18', 'REDUCED_12', 'LOW_5', 'ZERO_0', 'EXEMPT'
  name: varchar('name', { length: 128 }).notNull(),
  hsnSacCode: varchar('hsn_sac_code', { length: 10 }),
  isExempt: boolean('is_exempt').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const taxRates = pgTable('tax_rates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  taxCategoryId: uuid('tax_category_id').notNull().references(() => taxCategories.id, { onDelete: 'restrict' }),
  cgstRate: numeric('cgst_rate', { precision: 5, scale: 4 }).notNull().default('0.0000'), // e.g. 0.0900 (9%)
  sgstRate: numeric('sgst_rate', { precision: 5, scale: 4 }).notNull().default('0.0000'), // e.g. 0.0900 (9%)
  igstRate: numeric('igst_rate', { precision: 5, scale: 4 }).notNull().default('0.0000'), // e.g. 0.1800 (18%)
  cessRate: numeric('cess_rate', { precision: 5, scale: 4 }).notNull().default('0.0000'),
  validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
  validTo: timestamp('valid_to', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
```

### 8.9 Opening Balances Schema
```typescript
export const openingBalanceEntries = pgTable('opening_balance_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  fiscalYearId: uuid('fiscal_year_id').notNull().references(() => fiscalYears.id, { onDelete: 'restrict' }),
  status: varchar('status', { length: 32 }).notNull().default('DRAFT'), // DRAFT, POSTED
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, { onDelete: 'restrict' }),
  totalDebit: numeric('total_debit', { precision: 20, scale: 2 }).notNull(),
  totalCredit: numeric('total_credit', { precision: 20, scale: 2 }).notNull(),
  postedBy: varchar('posted_by', { length: 255 }),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
```

---

## 9. Accounting Model & GL Rules

### 9.1 Core Accounting Invariants
1. **Debit Equals Credit:** Every journal posting MUST satisfy `Decimal(totalDebit).equals(Decimal(totalCredit))`. Discrepancies throw `AccountingError`.
2. **Immutability of Posted Journals:** Posted journal entries (`status = 'POSTED'`) CANNOT be updated or deleted via SQL `UPDATE` or `DELETE`. Adjustments or cancellations MUST issue a reversal journal (`POSTED` -> `REVERSED`) referencing `reversalJournalId`.
3. **Closed Fiscal Period Rejection:** Posting attempts into a closed period (`fiscal_period.is_closed = true`) are rejected with `BusinessRuleViolationError`.
4. **Half-Even Rounding:** All monetary amounts are computed using Half-Even Banker's rounding to 2 decimal places.

### 9.2 Public Accounting Service API Interface
```typescript
export interface IAccountingCoreService {
  createJournal(ctx: RequestContext, req: CreateJournalRequest): Promise<JournalEntryDTO>;
  validateJournal(ctx: RequestContext, req: CreateJournalRequest): Promise<ValidationResult>;
  postJournal(ctx: RequestContext, journalId: string): Promise<PostJournalResult>;
  reverseJournal(ctx: RequestContext, journalId: string, reason: string): Promise<JournalEntryDTO>;
  getLedger(ctx: RequestContext, filter: LedgerFilter): Promise<LedgerView>;
  getAccountBalance(ctx: RequestContext, accountId: string, asOfDate?: Date): Promise<AccountBalanceDTO>;
  getTrialBalance(ctx: RequestContext, companyId: string, asOfDate: Date): Promise<TrialBalanceDTO>;
}
```

---

## 10. Effective-Dated Tax Engine Model (India GST)

The `TaxEngineService` provides centralized tax calculation logic:

```text
+------------------------------------------------------------------+
|                     TAX CALCULATION PIPELINE                     |
+------------------------------------------------------------------+
  1. Lookup Effective Tax Rate (match HSN/SAC & invoiceDate between validFrom and validTo)
  2. Determine Place of Supply (Company State Code vs Party State Code)
  3. Evaluate Taxability (Exempt / Nil-Rated / Taxable)
  4. Determine Tax Type:
     - Intra-state (Same State Code)  => CGST (Rate/2) + SGST (Rate/2)
     - Inter-state (Different State) => IGST (Rate)
  5. Calculate Cess (if applicable)
  6. Compute Tax-Inclusive or Tax-Exclusive Line Amounts
  7. Return Itemized Tax Breakout Payload
```

---

## 11. Authoritative AR/AP Open-Item Settlement Engine

### 11.1 Derived Balance Lifecycle
```text
Invoice Posted -> Open Item Created (openBalance = originalAmount)
   │
Receipt / Payment Voucher Recorded (unallocatedAmount = totalAmount)
   │
Allocation Created -> Open Item (openBalance = openBalance - allocatedAmount)
   │
If openBalance == 0.00 => Mark Open Item isSettled = TRUE
```

### 11.2 Control Account Reconciliation Rules
- **Rule AR Reconciliation:** `SUM(ar_open_items.open_balance)` MUST equal the General Ledger balance of `1100-AR-CONTROL`.
- **Rule AP Reconciliation:** `SUM(ap_open_items.open_balance)` MUST equal the General Ledger balance of `2100-AP-CONTROL`.
- **Reconciliation Service:** `reconcileSubledgerWithControlAccount()` executes automated daily checks. Discrepancies generate an alert for audit review.
- **Repair / Rebuild Task:** `rebuildSubledgerBalances()` recomputes `allocated_amount` and `open_balance` directly from `ar_receipt_allocations` / `ap_payment_allocations` history if corruption occurs.

---

## 12. Flexible Fiscal Period Architecture

```text
Monthly Periods (1-12) ──> Optional Adjustment Period (#13) ──> Year-End Closing & Opening Balance Carry-Forward
```

- **Flexible Configuration:** Supports 12 standard monthly periods plus an optional **Adjustment Period #13** (`periodType = 'ADJUSTMENT'`).
- **Adjustment Period #13 Use Cases:** Year-end audit entries, depreciation adjustments, inventory valuation write-downs, and statutory tax adjustments without altering regular monthly operational totals.
- **Reopening Authorization:** Reopening a closed period requires explicit manager authorization (`finance:period:reopen`), producing a tamper-evident audit record.

---

## 13. Numbering Engine Semantics & Gap Acceptance Policy

- **Atomic Sequence Allocation:** `NumberingEngine` queries `numbering_sequences` using `UPDATE numbering_sequences SET current_sequence = current_sequence + 1 WHERE ... RETURNING current_sequence` inside an isolated DB transaction block.
- **Sequence Gap Policy:** The platform guarantees uniqueness, tenant isolation, and concurrency safety, but DOES NOT guarantee universal gaplessness. Sequence gaps resulting from database transaction rollbacks or abandoned draft allocations are accepted as standard ERP behavior unless a statutory document rule requires explicit audit logging of skipped numbers.

---

## 14. API Design & Versioning

All Phase 2 endpoints reside under `/api/v1/finance/`:

| Method | Endpoint | Description | Permission |
|---|---|---|---|
| `GET` | `/api/v1/finance/chart-of-accounts` | List Chart of Accounts hierarchy | `finance:account:view` |
| `POST` | `/api/v1/finance/chart-of-accounts` | Create new COA account | `finance:account:create` |
| `GET` | `/api/v1/finance/fiscal-periods` | List fiscal years & period status | `finance:period:view` |
| `POST` | `/api/v1/finance/fiscal-periods/:id/close` | Close a fiscal period | `finance:period:close` |
| `POST` | `/api/v1/finance/fiscal-periods/:id/reopen` | Reopen closed fiscal period | `finance:period:reopen` |
| `POST` | `/api/v1/finance/journals` | Create draft journal entry | `finance:journal:create` |
| `POST` | `/api/v1/finance/journals/:id/post` | Post journal entry to GL | `finance:journal:post` |
| `POST` | `/api/v1/finance/journals/:id/reverse` | Reverse a posted journal entry | `finance:journal:reverse` |
| `POST` | `/api/v1/finance/tax/calculate` | Calculate GST tax breakdown | `finance:tax:calculate` |
| `GET` | `/api/v1/finance/ar/invoices` | List AR invoices & open balances | `finance:ar:view` |
| `POST` | `/api/v1/finance/ar/receipts` | Record customer payment receipt | `finance:ar:receipt` |
| `GET` | `/api/v1/finance/ap/invoices` | List AP bills & payables | `finance:ap:view` |
| `POST` | `/api/v1/finance/ap/payments` | Record supplier payment voucher | `finance:ap:payment` |
| `GET` | `/api/v1/finance/reports/trial-balance` | Fetch Trial Balance report | `finance:report:view` |
| `GET` | `/api/v1/finance/reports/general-ledger` | Fetch GL account statement | `finance:report:view` |
| `GET` | `/api/v1/finance/reports/pnl` | Fetch Profit & Loss statement | `finance:report:view` |
| `GET` | `/api/v1/finance/reports/balance-sheet` | Fetch Balance Sheet statement | `finance:report:view` |

---

## 15. Authorization & Segregation of Duties (SoD)

- **Segregation of Duties Rules:**
  - `Rule SoD-01:` Creator of manual journal (`createdBy`) CANNOT approve or post that entry (`postedBy != createdBy`).
  - `Rule SoD-02:` Creator of payment/receipt CANNOT approve write-offs exceeding ₹10,000 without manager approval.
- **Data Scopes:** Branch-restricted users can only access journals and invoices tagged with their assigned `branchId`.

---

## 16. Audit Model

Every financial transaction emits a cryptographic SHA-256 hash-chained audit event via `AuditService`:
- Actions: `finance::COA::CREATE`, `finance::Journal::POST`, `finance::Journal::REVERSE`, `finance::FiscalPeriod::CLOSE`, `finance::ARReceipt::POST`, `finance::APPayment::POST`.
- Immutability: Audit log incorporates `prevHash` and `hash`, ensuring tampering is immediately detectable.

---

## 17. Concurrency & Locking Strategy

1. **Atomic Sequences:** `numbering_sequences` updated atomically with `FOR UPDATE` locks.
2. **Optimistic Locking:** Financial documents enforce optimistic concurrency control via `version` column increments.
3. **Open Item Allocation Locks:** Open item balance updates execute inside atomic SQL transactions (`UPDATE ar_open_items SET open_balance = open_balance - :amount`).

---

## 18. Idempotency Model

- **Layer 1 (Request-Level):** Mutating HTTP POST endpoints check `Idempotency-Key` header cached in `idempotency_keys` for 24 hours.
- **Layer 2 (Business Document-Level):** Unique DB constraint `idx_je_tenant_comp_src_doc` on `(tenant_id, company_id, source_module, source_document_id)` blocks duplicate journal postings for the same source document even if a different request or voucher number is sent.

---

## 19. Failure Handling & Rollback Matrix

| Failure Scenario | Engine Responsible | Expected System Outcome |
|---|---|---|
| Unbalanced Journal (`Debit != Credit`) | `AccountingCoreService` | Transaction rejected immediately; DB rollback; HTTP 400 `AccountingError`. |
| Closed Fiscal Period Posting Attempt | `FiscalPeriodService` | Posting rejected; DB rollback; HTTP 422 `BusinessRuleViolationError`. |
| Database Connection Drop Mid-Posting | PostgreSQL Transaction | Transaction aborted; zero partial writes. |
| Duplicate Payment Post Attempt | `IdempotencyEngine` | Intercepted by idempotency key check; original response returned; no double charge. |
| SoD Violation (Creator posting own entry) | `AuthorizationService` | Access blocked; HTTP 403 `ForbiddenError`; audit log generated. |

---

## 20. Non-Negotiable Financial Invariants Enforcement Matrix (20 Invariants)

| Invariant ID | Invariant Description | DB Enforcement | Service Enforcement | Auth Rule | Test Type | Failure Behavior |
|---|---|---|---|---|---|---|
| **INV-01** | Total Debit == Total Credit for posted journals | `CHECK` / Service | `AccountingCoreService` | N/A | Invariant | Throws `AccountingError`, DB Rollback |
| **INV-02** | Posted journals & lines are immutable | FK `ON DELETE RESTRICT` | `AccountingCoreService` | `finance:journal:post` | Security | DB Rejects `DELETE` / `UPDATE` |
| **INV-03** | Reversal references original journal ID | FK `reversal_journal_id` | `AccountingCoreService` | `finance:journal:reverse` | Integration | Throws `ValidationError` |
| **INV-04** | Reversal journal itself balances | `CHECK` / Service | `AccountingCoreService` | `finance:journal:reverse` | Invariant | Throws `AccountingError` |
| **INV-05** | Closed periods reject new postings | FK `fiscal_period_id` | `FiscalPeriodService` | N/A | Integration | Throws `BusinessRuleViolationError` |
| **INV-06** | Idempotency prevents duplicate postings | Unique Index `src_doc` | `IdempotencyEngine` | N/A | Idempotency | Returns cached response / DB duplicate key error |
| **INV-07** | Tenant isolation strictly enforced | `tenant_id` column | All Services | `RequestContext` | Security | Throws `ForbiddenError` |
| **INV-08** | Company boundaries enforced | `company_id` column | All Services | `AuthorizationService` | Security | Throws `ForbiddenError` |
| **INV-09** | Account belongs to correct company | FK `company_id` | `COAService` | N/A | Integration | Throws `ValidationError` |
| **INV-10** | AR Subledger reconciles to AR Control Account | Control Account Type | `ARService` / Reconciler | N/A | Integration | Generates discrepancy alert |
| **INV-11** | AP Subledger reconciles to AP Control Account | Control Account Type | `APService` / Reconciler | N/A | Integration | Generates discrepancy alert |
| **INV-12** | Payment allocation <= unallocated amount | `numeric(20,2)` check | `BankingService` | `finance:ap:payment` | Unit / Invariant | Throws `ValidationError` |
| **INV-13** | Receipt allocation <= open item balance | `numeric(20,2)` check | `ARService` | `finance:ar:receipt` | Unit / Invariant | Throws `ValidationError` |
| **INV-14** | No unapproved negative open balances | `numeric(20,2)` check | `ARService` / `APService` | N/A | Invariant | Throws `ValidationError` |
| **INV-15** | Deterministic Tax Calculation | Rates schema | `TaxEngineService` | N/A | Unit | Throws `TaxCalculationError` |
| **INV-16** | Banker's Half-Even Rounding (2 decimals) | `numeric(20,2)` | Decimal Utility | N/A | Unit | Precise half-even rounding |
| **INV-17** | Posting date within open period date range | FK `fiscal_period_id` | `FiscalPeriodService` | N/A | Integration | Throws `BusinessRuleViolationError` |
| **INV-18** | Lines reference active COA account | `is_active = true` | `AccountingCoreService` | N/A | Integration | Throws `ValidationError` |
| **INV-19** | Intercompany entries require explicit setup | `company_id` check | `AccountingCoreService` | N/A | Integration | Throws `ForbiddenError` |
| **INV-20** | Financial corrections require reversal entries | Immutable DB FK | `AccountingCoreService` | `finance:journal:reverse` | Integration | DB Rejects Direct Edits |

---

## 21. Financial Reporting Foundation

Phase 2 establishes high-performance SQL query aggregations for standard financial reports:
1. **Trial Balance:** Aggregates debits and credits grouped by account.
2. **General Ledger Statement:** Chronological account lines with running balances.
3. **AR / AP Ageing Reports:** Open items grouped by party and age buckets (`0-30`, `31-60`, `61-90`, `90+`).
4. **Profit & Loss (P&L):** Revenue accounts minus Expense accounts.
5. **Balance Sheet:** Assets, Liabilities, and Equity (including Retained Earnings).

---

## 22. Migration Strategy

Schema changes delivered as new versioned Drizzle migrations in `packages/database/src/migrations/`:
- `0001_numbering_sequences.sql`: Add `numbering_sequences` table.
- `0002_finance_core_tables.sql`: Add `account_groups`, `chart_of_accounts`, `fiscal_years`, `fiscal_periods`, `journal_entries`, `journal_lines`.
- `0003_subledger_tables.sql`: Add `ar_invoices`, `ar_open_items`, `receipts`, `ar_receipt_allocations`, `ap_bills`, `ap_open_items`, `payments`, `ap_payment_allocations`.
- `0004_banking_and_tax_tables.sql`: Add `bank_accounts`, `cash_accounts`, `tax_categories`, `tax_rates`, `opening_balance_entries`.

---

## 23. Testing Strategy

1. **Unit Tests:** GST math, Half-Even Banker's rounding test vectors, period date validation.
2. **Integration Tests:** End-to-end posting against real PostgreSQL database.
3. **Invariant Tests:** Test all 20 financial invariants across 1,000+ random journal posting attempts.
4. **Concurrency & Load Tests:** 100 parallel document allocations and receipt applications.
5. **Architectural Dependency Guard:** Assert zero reverse imports from `platform/` to `modules/finance/`.

---

## 24. Implementation Sequence (12 Sub-Phases)

```text
Phase 2.0 (Foundation Productionization & DB Migrations)
   │
Phase 2.1 (Fiscal Years & Flexible Period Management)
   │
Phase 2.2 (Chart of Accounts Service & Group Seeding)
   │
Phase 2.3 (General Ledger Schema & Posting Pipeline)
   │
Phase 2.4 (Accounting Core Posting, Reversals, & Invariants)
   │
Phase 2.5 (Centralized Tax Engine — India GST Effective-Dated Rates)
   │
Phase 2.6 (Accounts Receivable — AR Subledger & Open Items)
   │
Phase 2.7 (Accounts Payable — AP Subledger & Open Items)
   │
Phase 2.8 (Banking & Cash Payment/Receipt Vouchers)
   │
Phase 2.9 (Fiscal Period Closing & Year-End Roll-Forward)
   │
Phase 2.10 (Financial Reporting Engine — TB, GL, P&L, Balance Sheet)
   │
Phase 2.11 (Phase 2 Full Verification Gate)
```

---

## 25. Operational Integration Contracts

Conceptual service interfaces for future operational modules:

```text
FUTURE OPERATIONAL MODULE INTEGRATION FLOWS:

[Phase 3 — Sales Invoice] 
  ──> Calls TaxEngineService.calculateTax()
  ──> Calls AccountingCoreService.postJournal()
      (Debits 1100-AR-CONTROL, Credits 4000-SALES-REVENUE, Credits 2200-OUTPUT-GST)
  ──> Calls ARService.createInvoice() -> Creates ar_open_items

[Phase 3 — Purchase Order / GRN / Supplier Bill]
  ──> Calls TaxEngineService.calculateTax()
  ──> Calls AccountingCoreService.postJournal()
      (Debits 5000-PURCHASES, Debits 1300-INPUT-GST, Credits 2100-AP-CONTROL)
  ──> Calls APService.createBill() -> Creates ap_open_items

[Phase 4 — Payroll Run]
  ──> Calls AccountingCoreService.postJournal()
      (Debits 5100-SALARY-EXPENSE, Credits 2300-TDS-PAYABLE, Credits 1010-BANK-ACCOUNT)
```

---

## 26. Risks & Mitigation Plan

1. **Risk:** High concurrent document creation causes sequence bottlenecks in `numbering_sequences`.  
   *Mitigation:* Use atomic PostgreSQL `UPDATE ... RETURNING` queries with short transaction lifespans.
2. **Risk:** Tax rate rounding discrepancies between line items and total tax.  
   *Mitigation:* Compute item-level tax rounding first, ensuring total invoice calculation matches statutory e-invoice rules.
3. **Risk:** Foreign key cascade deletion of posted financial lines.  
   *Mitigation:* Enforce `ON DELETE RESTRICT` on all posted journal line foreign keys at the DB level.

---

## 27. Definition of Done for Phase 2

Phase 2 will be declared COMPLETE only when:
- [ ] All 12 sub-phases (2.0 to 2.11) are fully implemented and verified.
- [ ] Database migrations execute cleanly on PostgreSQL.
- [ ] All 20 financial invariants are strictly enforced and tested.
- [ ] Centralized India GST Tax Engine accurately calculates CGST, SGST, IGST, and Cess.
- [ ] Standard Financial Reports (Trial Balance, GL, Ageing, P&L, Balance Sheet) execute with 100% accuracy.
- [ ] Test suite achieves 100% pass rate across unit, integration, invariant, security, and concurrency tests.
- [ ] Zero architectural boundary violations exist between platform engines and finance domain.
- [ ] Phase 2 Verification Gate report (`docs/PHASE_2_ARCHITECTURE_REVIEW.md`) is approved.

---

## 28. Sub-Phase Execution Gating Policy

**MANDATORY PROCESS RULE:**

The agent MUST NOT automatically progress through all Phase 2 sub-phases.

Implementation proceeds ONE SUB-PHASE AT A TIME. Upon completing each sub-phase (e.g. Phase 2.0):
1. Stop implementation.
2. Run full test suite, linter, typechecker, and monorepo build checks.
3. Review schema migrations and architectural dependency boundaries.
4. Update `docs/IMPLEMENTATION_STATUS.md`.
5. Produce a sub-phase completion report.
6. **WAIT FOR EXPLICIT USER APPROVAL** before starting the subsequent sub-phase.

---

## 29. Phase 2 Verification Gate

Upon completion of all Phase 2 sub-phases, the AI agent will perform a formal **Phase 2 Verification Gate**:
1. Halt implementation.
2. Run full automated test suite, linter, typechecker, and build checks.
3. Produce `docs/PHASE_2_ARCHITECTURE_REVIEW.md`.
4. Output mandatory process status string: `PHASE 2 REVIEW COMPLETE — WAITING FOR EXPLICIT APPROVAL`.

---

### EXECUTION GATE NOTICE

**DO NOT START IMPLEMENTATION YET.**

The next approval authorizes **PHASE 2.0 ONLY**. Implementation of Phase 2.0 will commence only when explicit user authorization is provided.
