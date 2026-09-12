# Phase 2.3 Implementation Plan — General Ledger (GL) & Posting Engine

**Status:** Architecture Locked & Finalized / Pre-Implementation Final Corrections Complete  
**Date:** 2026-09-09  
**Execution State:** NOT STARTED (Waiting for explicit Phase 2.3 user authorization)

---

## 1. Executive Summary

This document presents the complete, final corrected implementation plan for **Phase 2.3 — General Ledger (GL) & Posting Engine**.

Building upon Phase 2.0 (Foundation Productionization), Phase 2.1 (Fiscal Years & Accounting Periods), and Phase 2.2 (Chart of Accounts - COA), Phase 2.3 establishes the **authoritative posted financial transaction layer** for General ERP.

### Primary Architectural Principles
1. **COA is the Master Account Source:** General Ledger references Chart of Accounts for master data but owns all financial movement records.
2. **Fiscal Periods are the Master Time Boundary:** Every posted transaction must fall within an OPEN fiscal period validated by the Fiscal Period Engine.
3. **General Ledger is the Authoritative Posting Layer:** Operational subledgers (Sales, Procurement, AR, AP, Banking, Payroll) MUST post through the General Ledger contract rather than directly mutating financial balances or maintaining isolated accounting state.
4. **Strict PostgreSQL-Enforced Immutability & Trust-Boundary Guard:**
   - Once a journal entry or line is POSTED, its persisted row data is immutable. PostgreSQL BEFORE UPDATE OR DELETE triggers strictly reject modifications on POSTED records (returning `OLD` for DELETE and `NEW` for UPDATE on draft records).
   - Direct SQL modification attempting to set `status = 'POSTED'` outside the authorized `GLEngine.postJournal()` pipeline is strictly rejected by a PostgreSQL transition guard (`app.posting_authorized`).
   - Security relies on the database trust-boundary: end users never receive PostgreSQL credentials and cannot directly connect to PostgreSQL. The application/API database role is the trusted execution role. `GLEngine.postJournal()` is the only application code path permitted to set `SET LOCAL app.posting_authorized = 'true'`. The setting is transaction-local and automatically disappears when the transaction ends.
   - *Trust Boundary Limitation:* PostgreSQL session-variable authorization is a database trust-boundary mechanism, not a cryptographic proof of which application function issued the setting. Its security depends on preventing untrusted actors from obtaining trusted application database credentials.
   - Corrections occur only by creating new POSTED reversal journals (`POSTED` -> creates NEW `POSTED` reversal journal with `originalJournalId` pointing to the source journal). Original posted records are NEVER mutated or status-updated after posting.
5. **Atomic Balanced Postings without Silent Rounding:** A journal posting succeeds ONLY if `SUM(debits) == SUM(credits)` within exact monetary precision (`numeric(20,2)`). Journal entry input amounts must have a scale `<= 2` decimal places; input amounts are NEVER silently rounded during posting. Posting is executed inside a single database transaction with row locks on fiscal period records.
6. **Single Reversal & One-Level Reversal Graph:** A posted journal may have at most ONE reversal journal (enforced by partial unique index `idx_je_tenant_comp_original_journal`). Reversals of reversal journals are strictly forbidden.
7. **Historical Reporting Completeness:** Trial Balance, Account Balance, and Ledger View queries include all qualifying POSTED GL movements regardless of whether an account is currently `ACTIVE` or `INACTIVE`.

---

## 2. Current Repository Assessment

An exhaustive inspection of the current workspace yields the following baseline:

### 2.1 Existing Platform & Domain Subsystems
- **Phase 2.0 Foundation:** `numbering_sequences` schema is fully persisted in PostgreSQL (`packages/database/src/schema/master.ts`), providing concurrency-safe atomic sequence generation via `NumberingEngine`.
- **Phase 2.1 Fiscal Periods:** `FiscalPeriodService` (`apps/api/src/modules/finance/fiscal-period.service.ts`) enforces company-scoped fiscal years, 12 monthly periods + optional adjustment period #13, period status (`OPEN`, `CLOSING`, `CLOSED`), and date resolution via `resolvePeriod()` and `assertPeriodOpen()`.
- **Phase 2.2 Chart of Accounts:** `ChartOfAccountsService` (`apps/api/src/modules/finance/chart-of-accounts.service.ts`) provides hierarchical account trees, postability guards, control account metadata (`AR`, `AP`, `TAX_INPUT`, `TAX_OUTPUT`, `CASH`, `BANK`, `PAYROLL`), normal balance calculation, and `assertAccountEligibilityForPosting()`.
- **Posted Transaction Lookup Boundary:** Phase 2.2 defined the `PostedTransactionLookup` interface (`hasPostedTransactions(ctx, accountId)`), currently backed by `NoOpPostedTransactionLookup` in Phase 2.2 production and `TestPostedTransactionLookupAdapter` in tests.

### 2.2 Database Schema Gap Analysis & Required Corrections
Inspection of `packages/database/src/schema/accounting.ts` reveals preliminary `journal_entries` and `journal_lines` tables created in early scaffolding. Phase 2.3 requires the following database upgrades:
1. **Monetary & Tax Precision Specs:**
   - Monetary amounts (`totalDebit`, `totalCredit`, `debitAmount`, `creditAmount`, `baseDebitAmount`, `baseCreditAmount`): `numeric(20,2)`.
   - Exchange rates (`exchangeRate`): `numeric(12,6)`.
   - Tax percentages/rates policy: `numeric(9,6)` (upgraded from `numeric(5,4)` to support common Indian GST rates such as 12%, 18%, and 28% without truncation in future Phase 2.4).
2. **Accounting Date Type Correction:** Change `accounting_date` from timestamp to SQL `DATE` (`date('accounting_date', { mode: 'string' })`). Keep `postedAt` as `TIMESTAMP WITH TIME ZONE`.
3. **Append-Only Reversal Model & Unique Constraint:** Add `original_journal_id` (FK to `journal_entries.id`) to reference the source journal. Enforce PostgreSQL unique constraint `idx_je_tenant_comp_original_journal` on `(tenant_id, company_id, original_journal_id) WHERE original_journal_id IS NOT NULL` to guarantee at most one reversal per original journal.
4. **PostgreSQL Immutability & Transition Triggers:** Implement BEFORE UPDATE OR DELETE triggers on `journal_entries` and `journal_lines` with correct PostgreSQL `RETURN OLD` (for DELETE) and `RETURN NEW` (for UPDATE) semantics, and a transition guard blocking direct SQL status changes from `DRAFT` to `POSTED` without `app.posting_authorized = 'true'`.
5. **Partial Unique Source-Document Index:** Enforce unique constraint `idx_je_tenant_comp_src_doc` on `(tenant_id, company_id, source_module, source_document_type, source_document_id) WHERE source_document_id IS NOT NULL`.
6. **Line Constraints:** Add PostgreSQL `CHECK` constraints for positive amounts (`debit_amount >= 0`, `credit_amount >= 0`) and debit/credit exclusivity (`(debit_amount > 0 AND credit_amount = 0) OR (debit_amount = 0 AND credit_amount > 0)`).

---

## 3. Phase Objective

Phase 2.3 delivers a production-grade General Ledger Posting Engine that satisfies all statutory and enterprise requirements:

- **Authoritative Posting Pipeline:** Validates, balances, numbers, posts, and audits journal entries.
- **Strict PostgreSQL Trigger Immutability & Direct SQL Transition Defense:** Prevents direct SQL modifications or deletions of posted financial transactions and blocks unauthorized direct SQL promotion of `DRAFT` journals to `POSTED`.
- **Append-Only Single-Reversal Engine:** Corrects accounting entries by posting new, balanced counter-journals linked via `originalJournalId` without mutating original posted records. Enforces at most one reversal per journal and prohibits reversal of reversals.
- **Production `GLPostedTransactionLookupAdapter`:** Implements `PostedTransactionLookup` to dynamically query PostgreSQL `journal_lines`, supplying authoritative posted transaction state to Phase 2.2 COA immutability and deletion guards.
- **Source Document Idempotency:** Enforces partial unique constraint `idx_je_tenant_comp_src_doc` on `(tenant_id, company_id, source_module, source_document_type, source_document_id)` across DRAFT, POSTED, and CANCELLED states.
- **Financial Query Foundation:** Exposes deterministic query primitives for Trial Balance, General Ledger statements, and account balances including inactive accounts with historical posted activity.

**Explicit Scope Exclusion:** Phase 2.3 DOES NOT implement GST tax filing, AR/AP subledgers, Banking/Cash management, Sales Invoices, Purchase Orders, Payroll, foreign-currency conversion/FX gain-loss, or AI automations.

---

## 4. Architecture & Database Trust Boundary

General Ledger occupies a fundamental tier in the unidirectional monorepo dependency hierarchy:

```text
+-----------------------------------------------------------------------+
|                       PLATFORM ENGINES LAYER                         |
| Authorization | Audit | Numbering | Workflow | Rules | Config | Jobs |
+-----------------------------------------------------------------------+
                                   │ (Consumes platform contracts)
                                   ▼
+-----------------------------------------------------------------------+
|                         FINANCE DOMAIN CORE                           |
|                                                                       |
|                       Configuration Engine                            |
|                                │                                      |
|                       Fiscal Period Engine                            |
|                                │                                      |
|                      Chart of Accounts (COA)                          |
|                                │                                      |
|                     GENERAL LEDGER (GL) ENGINE                        |
|                                │                                      |
|           (Future Subledgers: AR / AP / Tax / Banking)                 |
+-----------------------------------------------------------------------+
                                   │ (Exposes posting API contracts)
                                   ▼
+-----------------------------------------------------------------------+
|                      FUTURE OPERATIONAL MODULES                       |
|           Sales (P3) | Procurement (P3) | Payroll (P4)              |
+-----------------------------------------------------------------------+
```

### 4.1 PostgreSQL Posting Authorization Trust Boundary
To protect financial record integrity against unauthorized SQL mutation, the application and database establish a strict **trust boundary**:

```text
AUTHORIZED APPLICATION POSTING FLOW:
End User
   ↓
Authenticated API
   ↓
AuthorizationService (Enforces Permissions & SoD)
   ↓
GLEngine.postJournal() (Validates Balances, Periods, Accounts, Idempotency)
   ↓
Trusted Application DB Transaction
   ↓
SET LOCAL app.posting_authorized = 'true'
   ↓
Status Updated: DRAFT → POSTED
   ↓
Audit Engine (SHA-256 Event Emitted)
   ↓
Transaction Commits (app.posting_authorized automatically resets)
```

```text
UNTRUSTED DIRECT DATABASE ACCESS FLOW:
End User / External Client
   ↓
Direct PostgreSQL Access
   ↓
NOT PERMITTED (Credentials withheld; isolated within backend network)
```

### Trust Boundary Architectural Principles
1. **Credential Isolation:** End users never receive PostgreSQL credentials. Production database credentials must never be exposed to clients, tenants, users, or browser code.
2. **Direct Connection Prohibition:** End users cannot directly connect to the PostgreSQL database.
3. **Trusted Execution Role:** The application/API database role is the trusted execution role operating within the backend network boundary.
4. **Restricted Code Path:** `GLEngine.postJournal()` is the ONLY application code path permitted to set `SET LOCAL app.posting_authorized = 'true'`.
5. **Transaction Locality:** The setting is always transaction-local using `SET LOCAL app.posting_authorized = 'true'`.
6. **Automatic Cleanup:** The authorization variable automatically disappears when the transaction ends (upon `COMMIT` or `ROLLBACK`).
7. **Direct SQL Access Defense:** Direct SQL access using an untrusted/non-application database role cannot promote `DRAFT` → `POSTED`.
8. **Production Credential Protection:** Production database credentials reside exclusively in server environment secret management and are isolated from untrusted actors.

> PostgreSQL session-variable authorization is a database trust-boundary mechanism, not a cryptographic proof of which application function issued the setting. Its security depends on preventing untrusted actors from obtaining the trusted application database credentials.

This is an intentional architectural boundary rather than an unresolved weakness.

---

## 5. Ownership Boundaries

To eliminate duplicate business logic or split authority, entity ownership across Finance modules is strictly partitioned:

| Domain Entity | Authoritative Owner | Responsibilities & Ownership Boundary |
|---|---|---|
| **Account Master Data** | `COAService` (Phase 2.2) | Account identity, code, name, category, subtype, nature, normal balance, hierarchy, postability, control metadata, account status lifecycle (determines whether NEW postings are allowed). |
| **Time & Period Master Data** | `FiscalPeriodService` (Phase 2.1) | Fiscal years, accounting periods, period status (`OPEN`/`CLOSED`), period boundaries, period opening/closing routines. |
| **Posted Financial Transactions** | `GLEngine` (Phase 2.3) | Journal entries, journal lines, voucher numbering, posting pipeline, posted transaction state, explicit append-only reversals, source document idempotency, GL transaction history. |
| **Document Sequence Allocation** | `NumberingEngine` (Phase 2.0) | Sequence allocation, template formatting, atomic counters in `numbering_sequences`. |
| **Financial Reporting Aggregates** | Future Reporting (Phase 2.6+) | Trial balance computation, ledger statements, balance sheet, P&L generation derived dynamically from authoritative GL postings (includes inactive accounts with posted history). |

---

## 6. Journal Entry Model

The canonical `JournalEntry` domain model represents an append-only financial transaction header:

```typescript
export type JournalEntryStatus = 'DRAFT' | 'POSTED' | 'CANCELLED';

export interface JournalEntryDTO {
  id: string;
  tenantId: string;
  companyId: string;
  voucherNumber?: string; // Assigned ONLY during atomic posting execution
  fiscalYearId: string;
  fiscalPeriodId: string;
  accountingDate: string; // SQL DATE in "YYYY-MM-DD" format
  postingDate?: Date;    // Timestamp when posted
  sourceModule: string;  // e.g. 'MANUAL', 'SALES', 'PROCUREMENT', 'PAYROLL', 'AR', 'AP'
  sourceDocumentType?: string; // e.g. 'SALES_INVOICE', 'PURCHASE_BILL', 'JOURNAL_VOUCHER', 'REVERSAL'
  sourceDocumentId?: string;   // Identifier in source module (NULL for manual & reversal journals)
  originalJournalId?: string;  // Linked source journal ID if this is a reversal journal
  status: JournalEntryStatus;  // DRAFT, POSTED, CANCELLED
  totalDebit: string;    // Formatted decimal string e.g. "15000.00"
  totalCredit: string;   // Formatted decimal string e.g. "15000.00"
  currency: string;      // ISO-4217 code e.g. 'INR'
  exchangeRate: string;  // Formatted decimal e.g. "1.000000"
  narration?: string;
  createdBy: string;
  postedBy?: string;
  postedAt?: Date;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 7. Journal Line Model

The `JournalLine` domain model represents individual debit and credit entries:

```typescript
export interface JournalLineDTO {
  id: string;
  tenantId: string;
  companyId: string;
  journalEntryId: string;
  accountId: string;
  lineSequence: number; // 1-indexed line order
  debitAmount: string;  // "0.00" or positive decimal string
  creditAmount: string; // "0.00" or positive decimal string
  currency: string;     // Line currency (matches company base currency in Phase 2.3)
  exchangeRate: string; // "1.000000" in Phase 2.3
  baseDebitAmount: string;  // Equal to debitAmount in Phase 2.3
  baseCreditAmount: string; // Equal to creditAmount in Phase 2.3
  narration?: string;   // Line-level itemized description
  partyType?: 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE' | 'NONE';
  partyId?: string;
  branchId?: string;
  departmentId?: string;
  createdAt: Date;
}
```

---

## 8. Monetary Policy, Scale & Serialised Data Representation

General ERP strictly enforces fixed-point decimal arithmetic across all financial calculations and data representations:

1. **Floating-Point Prohibition:** JavaScript IEEE-754 numbers (`number`) MUST NOT be used for monetary arithmetic. All calculations use `decimal.js` or `bignumber.js`.
2. **Database Precision Specifications:**
   - Monetary amounts (`totalDebit`, `totalCredit`, `debitAmount`, `creditAmount`, `baseDebitAmount`, `baseCreditAmount`): `numeric(20, 2)`.
   - Exchange Rates (`exchangeRate`): `numeric(12, 6)`.
   - Tax Percentages / Rates Policy: `numeric(9, 6)` (upgraded for GST rate accuracy).
3. **No Silent Rounding on Journal Inputs:** Phase 2.3 GL posting does NOT silently round user-supplied input amounts. Every input amount must have a scale `<= 2` decimal places (e.g. `"12.34"` is valid; `"12.345"` is rejected with `ValidationError`).
4. **Rounding Boundary:** Half-Even Banker's Rounding remains the canonical rounding mode for future engines (Tax, Pricing, FX, allocations) that inherently compute fractional values.
5. **API Data Representation:** Monetary amounts in API payloads are ALWAYS serialized as **decimal strings** (e.g., `"1250.50"`), NEVER as "string floats" or IEEE floating-point numbers.
   - Database: `NUMERIC`
   - Application Domain: `Decimal`
   - API JSON Envelope: `decimal string`
6. **Phase 2.3 Single-Currency Boundary:**
   - All journals in Phase 2.3 MUST be created in company base currency (`currency === baseCurrency`).
   - `exchangeRate` MUST be `"1.000000"`.
   - `baseDebitAmount` MUST equal `debitAmount` and `baseCreditAmount` MUST equal `creditAmount`.
   - Any transaction attempting multi-currency foreign exchange conversion is strictly rejected throwing `ValidationError`.

---

## 9. Append-Only Journal Lifecycle & Transition Boundary

```text
                     ┌───────────────┐
                     │     DRAFT     │
                     └───────┬───────┘
                             │
            ┌────────────────┴────────────────┐
            │                                 │
            ▼                                 ▼
   ┌─────────────────┐               ┌─────────────────┐
   │    CANCELLED    │               │     POSTED      │
   └─────────────────┘               └────────┬────────┘
                                              │
                                              ▼ (Reversal Command)
                                     Creates NEW Journal Entry
                                     (status: POSTED, originalJournalId: J1)
```

### State Mutability & Transition Protection Rules
- **`DRAFT`:** Header narration, line amounts, account IDs, and accounting dates may be modified. Draft entries may be soft-deleted or cancelled (`status = 'CANCELLED'`). `DRAFT` entries have zero effect on general ledger account balances. Draft creation does NOT allocate a voucher number.
- **Controlled `DRAFT -> POSTED` Transition:** The transition from `DRAFT` to `POSTED` MUST occur solely through `GLEngine.postJournal()`. Inside the posting transaction block, the engine executes `SET LOCAL app.posting_authorized = 'true';`. Direct SQL `UPDATE journal_entries SET status = 'POSTED'` without this session variable set within the trusted database transaction fails at DB trigger level. This security mechanism operates within the application trust boundary where end users never receive PostgreSQL credentials, and `GLEngine.postJournal()` is the sole authorized backend path setting `SET LOCAL app.posting_authorized = 'true'`. The variable automatically disappears when the transaction ends (upon `COMMIT` or `ROLLBACK`).
- **`POSTED`:** Permanently immutable. PostgreSQL triggers reject any SQL `UPDATE` or `DELETE` on posted headers and lines. `POSTED` status NEVER changes.
- **`CANCELLED`:** Terminal draft state. Cannot be posted or modified.
- **Reversal Execution:** Executing a reversal creates a **completely new journal entry** with `status = 'POSTED'`, its own unique voucher number, reversed debits/credits, and `originalJournalId` set to the target journal ID. The original journal remains `POSTED` and immutable.

---

## 10. Atomic Posting Engine Pipeline & Locking Sequence

The posting operation (`postJournal`) executes inside an isolated database transaction (`db.transaction(...)`):

```text
+-----------------------------------------------------------------------------------+
|                        ATOMIC POSTING TRANSACTION SEQUENCE                        |
+-----------------------------------------------------------------------------------+
 1. BEGIN DB TRANSACTION.
 2. Set Local Posting Authorization: Execute SET LOCAL app.posting_authorized = 'true'.
 3. Lock Draft Journal Header: SELECT * FROM journal_entries WHERE id = :id FOR UPDATE.
 4. Verify Journal Status == 'DRAFT'.
 5. Validate Input Scale: Verify line debit/credit amounts have scale <= 2 decimal places.
 6. Resolve Accounting Date: Parse "YYYY-MM-DD" and call FiscalPeriodService.resolvePeriod().
 7. Lock & Re-verify Fiscal Period: Execute SELECT * FROM fiscal_periods WHERE id = :periodId 
    FOR UPDATE and evaluate assertPeriodOpen(). (Prevents period-close race conditions).
 8. Validate Account Eligibility: Invoke COAService.assertAccountEligibilityForPosting() 
    for each line (account must exist, belong to same tenant/company, be ACTIVE, 
    and have nodeType == 'ACCOUNT').
 9. Validate Line Invariants: Verify debit XOR credit exclusivity and non-negative values.
10. Validate Journal Balance: Verify Decimal(SUM(debits)).equals(Decimal(SUM(credits))).
11. Validate Currency Scope: Verify journal currency == company base currency and exchangeRate == 1.0.
12. Check Business Document Idempotency: For non-null sourceDocumentId, verify no journal exists.
13. Allocate Voucher Number: Call NumberingEngine for atomic sequence allocation.
14. Update Journal Header: Set status = 'POSTED', voucherNumber, postedBy, postedAt.
15. Write Audit Event: Emit hash-chained 'finance::Journal::POST' audit event.
16. COMMIT DB TRANSACTION (resets app.posting_authorized).
17. Return Posted DTO.
+-----------------------------------------------------------------------------------+
```

If ANY step fails, the entire transaction rolls back automatically. Sequence updates in `numbering_sequences` roll back as part of the transaction, ensuring zero orphan sequence increments on failed postings.

---

## 11. Fiscal Period Engine Integration & Race Protection

The GL Posting Engine integrates directly with Phase 2.1 `FiscalPeriodService`:

1. **Date Resolution:** When creating or posting a journal, `accountingDate` (e.g. `"2026-04-15"`) is passed to `fiscalPeriodService.resolvePeriod(ctx, companyId, date)` to retrieve the matching `fiscalYearId` and `fiscalPeriodId`.
2. **Posting Lock Guard:** Before updating status to `POSTED`, the Posting Engine locks the `fiscal_periods` row (`SELECT ... FOR UPDATE`) and calls `await fiscalPeriodService.assertPeriodOpen(ctx, fiscalPeriodId)`.
3. **Closed Period Rejection:** If `fiscalPeriod.status === 'CLOSED'` or `isClosed === true`, posting is aborted immediately throwing `BusinessRuleViolationError("Financial posting rejected: Accounting period 'MMM-YYYY' is CLOSED.")`.
4. **Period-Close Race Protection:** If a `closePeriod()` command runs concurrently with `postJournal()`, row locking forces one transaction to wait. If `closePeriod()` commits first, `postJournal()` reads `isClosed = true` and aborts safely.

---

## 12. Chart of Accounts (COA) Integration

Every journal line must pass COA validation enforced by Phase 2.2 `ChartOfAccountsService`:

1. **Eligibility Assertion:** The Posting Engine calls `await chartOfAccountsService.assertAccountEligibilityForPosting(ctx, accountId)` for every line.
2. **Validation Rules:**
   - Account must exist for the specified `(tenantId, companyId)`.
   - Account `status` must be `ACTIVE` at time of posting.
   - Account `nodeType` must be `ACCOUNT` (`isPostable === true`).
   - Group nodes (`nodeType === 'GROUP'`) MUST be rejected throwing `ValidationError`.
3. **Control Account Enforcement:** If an account has `isControlAccount === true`, manual journal postings to that account require elevated permission (`finance:control_account:override`) or must originate from the authoritative subledger module.

---

## 13. PostedTransactionLookup Production Adapter

Phase 2.2 established the `PostedTransactionLookup` interface to isolate COA master data from GL implementation details:

```typescript
export interface PostedTransactionLookup {
  hasPostedTransactions(ctx: RequestContext, accountId: string): Promise<boolean>;
}
```

### Phase 2.3 Implementation: `GLPostedTransactionLookupAdapter`
Phase 2.3 replaces `NoOpPostedTransactionLookup` with `GLPostedTransactionLookupAdapter`:

```typescript
export class GLPostedTransactionLookupAdapter implements PostedTransactionLookup {
  constructor(private db: DatabaseClient) {}

  async hasPostedTransactions(ctx: RequestContext, accountId: string): Promise<boolean> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
      .where(
        and(
          eq(journalLines.tenantId, ctx.tenantId),
          eq(journalLines.companyId, ctx.companyId!),
          eq(journalLines.accountId, accountId),
          eq(journalEntries.status, 'POSTED')
        )
      );

    return Number(result[0]?.count || 0) > 0;
  }
}
```

### Impact on COA Rules
When `GLPostedTransactionLookupAdapter` reports `true` for an account:
1. `updateAccount()` rejects any attempt to mutate `accountCode`, `accountType`, `accountSubtype`, `accountNature`, `normalBalance`, `nodeType`, `parentId`, `isControlAccount`, `controlAccountType`, or `currency`.
2. `deleteAccount()` rejects physical deletion throwing `BusinessRuleViolationError`.

---

## 14. Document Numbering Engine & Sequence Rollback Semantics

Voucher numbers are generated using the persistent platform `NumberingEngine` (Phase 2.0):

1. **Transactional Allocation:** Voucher numbers are allocated ONLY during posting execution inside the active PostgreSQL transaction. Drafts do NOT consume voucher sequence numbers.
2. **Rollback Safety:** If a posting transaction aborts or rolls back due to validation failures, the `numbering_sequences` counter update rolls back atomically. Zero sequence gaps are created by draft creation or failed posting attempts.
3. **Template Format:** `{PREFIX}-{FY}-{BRANCH}-{SEQ}` (e.g. `JV-2025-26-HQ-00001`).
4. **Concurrency Safety:** Guaranteed unique voucher allocation per tenant and company via `SELECT FOR UPDATE` row locks on sequence rows.
5. **Posted Number Immutability:** Once a voucher number is assigned to a committed POSTED journal, it remains permanently gapless and immutable.

---

## 15. Source Document & Request Idempotency Semantics

General ERP enforces two distinct idempotency guarantees:

```text
+-----------------------------------------------------------------------------------+
|                        IDEMPOTENCY GUARANTEES DISTINCTION                         |
+-----------------------------------------------------------------------------------+
  1. API REQUEST IDEMPOTENCY (Header-based)
  - Intercepted by IdempotencyEngine middleware via 'Idempotency-Key' header.
  - Caches HTTP responses in idempotency_keys for 24 hours.
  - Repeated identical network requests receive cached HTTP response.

  2. BUSINESS DOCUMENT IDEMPOTENCY (Database Partial Unique Index)
  - Partial Unique DB Index: idx_je_tenant_comp_src_doc on 
    (tenant_id, company_id, source_module, source_document_type, source_document_id)
    WHERE source_document_id IS NOT NULL.
  - A business source document may have at most ONE associated GL journal regardless 
    of status (DRAFT, POSTED, CANCELLED).
  - Attempting to generate a second GL journal for the same source document is blocked.
  - Manual & reversal journals pass source_document_id = NULL, bypassing this index.
+-----------------------------------------------------------------------------------+
```

---

## 16. Source Document Contract

Future operational modules (Sales, Procurement, AR, AP, Payroll) post financial transactions to GL via a standardized, decoupled posting request contract:

```typescript
export interface GLPostingRequest {
  companyId: string;
  accountingDate: string;      // SQL DATE "YYYY-MM-DD"
  sourceModule: string;        // 'SALES', 'PROCUREMENT', 'AR', 'AP', 'PAYROLL'
  sourceDocumentType: string;  // 'SALES_INVOICE', 'PURCHASE_BILL', 'PAYROLL_RUN'
  sourceDocumentId: string;    // Business entity ID in source module
  narration: string;
  currency?: string;           // Base currency e.g. 'INR'
  lines: Array<{
    accountId: string;
    debitAmount: string;
    creditAmount: string;
    narration?: string;
    partyType?: 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE' | 'NONE';
    partyId?: string;
    branchId?: string;
    departmentId?: string;
  }>;
}
```

The GL Posting Engine validates and posts this payload atomically without needing to import or call external domain services.

---

## 17. Reversal Graph & Single-Reversal Model

Posted journal entries are strictly immutable. Financial corrections use an append-only reversal mechanism (`reverseJournal`):

1. **Original Journal Remains Untouched:** The original journal remains in `status = 'POSTED'` and its header/lines are NEVER updated.
2. **Reversal Graph Constraint:** The reversal graph is strictly one-level (`Original J1 -> Reversal J2`). Reversing a reversal journal (`J2 -> J3`) is strictly prohibited. If `targetJournal.originalJournalId IS NOT NULL`, the request is rejected throwing `BusinessRuleViolationError("Reversal of a reversal journal is strictly prohibited.")`.
3. **Database-Level Single Reversal Guarantee:** Enforced by PostgreSQL unique index `idx_je_tenant_comp_original_journal` on `(tenant_id, company_id, original_journal_id) WHERE original_journal_id IS NOT NULL`. A posted journal may have at most ONE reversal journal.
4. **Reversal Journal Creation:** A **new journal entry** is created with:
   - `status = 'POSTED'`
   - `sourceModule = 'MANUAL'`
   - `sourceDocumentType = 'REVERSAL'`
   - `originalJournalId = originalJournal.id`
   - `narration = "Reversal of voucher ${originalJournal.voucherNumber}: ${reason}"`
   - Swapped debit and credit amounts for every line (`debitAmount = line.creditAmount`, `creditAmount = line.debitAmount`).
5. **Voucher Number Allocation:** The reversal journal receives its own unique voucher number (e.g. `REV-2025-26-HQ-00001`).
6. **Period Assignment Rule:** Reversals MUST be posted to an `OPEN` fiscal period. If the original period is `CLOSED`, the reversal is posted to the current `OPEN` period with audit logging.

---

## 18. Accounting Date vs Posting Date Semantics

- **Accounting Date (`accountingDate`):** Represents the effective business date of the financial transaction. Stored as SQL `DATE` (`date('accounting_date', { mode: 'string' })` e.g. `"2026-04-15"`). Determines fiscal year and period resolution (`resolvePeriod`). Independent of server timezones.
- **Posting Date (`postedAt`):** System timestamp recording the exact UTC moment when the posting transaction committed to PostgreSQL. Stored as `TIMESTAMP WITH TIME ZONE`.
- **Backdated & Future-Dated Entry Rules:** Entries may specify an `accountingDate` in the past or future, provided the resolved accounting period is `OPEN`. Postings to `CLOSED` periods are strictly rejected regardless of system timestamp.

---

## 19. Database Design & Corrected PostgreSQL Immutability Triggers

Phase 2.3 expands `packages/database/src/schema/accounting.ts` with production-grade Drizzle ORM definitions:

```typescript
import { pgTable, uuid, varchar, text, integer, timestamp, numeric, date, uniqueIndex, foreignKey, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './master.js';
import { chartOfAccounts, fiscalYears, fiscalPeriods } from './accounting.js';

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
```

### PostgreSQL Immutability & Transition Triggers SQL Definition
Included in migration `005_phase2_3_gl.sql`:

```sql
-- Trigger Function for journal_entries Immutability & Direct SQL Promotion Defense
CREATE OR REPLACE FUNCTION trg_prevent_posted_journal_update_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- 1. Prevent UPDATE or DELETE on POSTED journal entries
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    IF OLD.status = 'POSTED' THEN
      RAISE EXCEPTION 'POSTED financial journal entries are strictly immutable and cannot be updated or deleted (Voucher: %). Use reversal journals for corrections.', OLD.voucher_number;
    END IF;
  END IF;

  -- 2. Guard DRAFT -> POSTED transition: Require GLEngine authorized session variable
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'DRAFT' AND NEW.status = 'POSTED' THEN
      IF current_setting('app.posting_authorized', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Direct SQL transition from DRAFT to POSTED is forbidden. Postings must execute through GLEngine.postJournal().';
      END IF;
    END IF;
  END IF;

  -- 3. Return correct PostgreSQL trigger values
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_entries_immutability
BEFORE UPDATE OR DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION trg_prevent_posted_journal_update_delete();

-- Trigger Function for journal_lines Immutability
CREATE OR REPLACE FUNCTION trg_prevent_posted_line_update_delete()
RETURNS TRIGGER AS $$
DECLARE
  parent_status VARCHAR(32);
BEGIN
  SELECT status INTO parent_status FROM journal_entries WHERE id = OLD.journal_entry_id;
  IF parent_status = 'POSTED' THEN
    RAISE EXCEPTION 'Journal lines associated with POSTED financial entries are strictly immutable.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_lines_immutability
BEFORE UPDATE OR DELETE ON journal_lines
FOR EACH ROW EXECUTE FUNCTION trg_prevent_posted_line_update_delete();
```

---

## 20. Database Constraints Strategy

1. **Foreign Key Restrict Rules:** All FKs use `ON DELETE RESTRICT` to prevent cascading deletion of referenced entities.
2. **PostgreSQL Immutability Triggers:** `trg_journal_entries_immutability` and `trg_journal_lines_immutability` enforce update/delete immutability on posted records (returning `OLD` for DELETE and `NEW` for UPDATE).
3. **Direct SQL Transition Guard:** `trg_prevent_posted_journal_update_delete` blocks direct SQL updates setting `status = 'POSTED'` unless `app.posting_authorized = 'true'` is set in the transaction using `SET LOCAL`. This guard operates within the platform trust boundary: end users never receive DB credentials, and `GLEngine.postJournal()` is the sole authorized backend path setting the session variable. Note that the trigger verifies the session variable within the trusted database execution role rather than cryptographically identifying the caller function.
4. **Single Reversal Unique Index:** `idx_je_tenant_comp_original_journal` guarantees at most one reversal journal per source journal at PostgreSQL level.
5. **Composite Foreign Keys:** `journal_lines` enforces composite foreign keys `(tenant_id, company_id, journal_entry_id)` referencing `journal_entries` and `(tenant_id, company_id, account_id)` referencing `chart_of_accounts`. This mathematically prevents cross-tenant and cross-company account referencing.
6. **CHECK Constraints:** `chk_jl_debit_positive`, `chk_jl_credit_positive`, and `chk_jl_debit_credit_xor` enforce line validity at the database engine level.

---

## 21. Tenant & Company Isolation

Every query and write operation includes explicit `tenantId` and `companyId` parameters from `RequestContext`:

- **Data Scoping:** `WHERE tenant_id = ctx.tenantId AND company_id = companyId` is applied to all SELECT, UPDATE, and DELETE operations.
- **Cross-Tenant Guard:** Attempting to fetch or reference a journal from another tenant throws `NotFoundError` (preventing information leakage).
- **Cross-Company Guard:** Referencing an account or period belonging to a different company throws `ValidationError`.

---

## 22. Authorization & Segregation of Duties (SoD)

### Permissions Matrix
- `finance:gl:create`: Create draft manual journal entries.
- `finance:gl:update`: Edit draft manual journal entries.
- `finance:gl:post`: Execute journal posting engine.
- `finance:gl:reverse`: Issue journal reversals.
- `finance:gl:cancel`: Cancel draft entries.
- `finance:gl:read`: Query journals and general ledger statements.

### Segregation of Duties (SoD) Rules
- **Rule SoD-GL-01 (Creator != Poster):** For manual journals (`sourceModule === 'MANUAL'`), the user attempting to post (`postedBy`) CANNOT be the user who created the draft (`createdBy`). Violations throw `ForbiddenError`.

---

## 23. Audit Integration

All GL state mutations emit cryptographic SHA-256 hash-chained audit logs via platform `AuditService`:

- **Events Logged:** `finance::Journal::CREATE`, `finance::Journal::UPDATE`, `finance::Journal::POST`, `finance::Journal::REVERSE`, `finance::Journal::CANCEL`.
- **Payload Details:** `tenantId`, `actorId`, `ip`, `userAgent`, `traceId`, `entityName: 'JournalEntry'`, `entityId`, `action`, `newValues` (including `voucherNumber`, `totalDebit`, `totalCredit`), `prevHash`, `hash`, `timestamp`.

---

## 24. REST API Specifications

All endpoints reside under `/api/v1/finance/gl`:

| Method | Endpoint | Request Body | Description | Permission |
|---|---|---|---|---|
| `POST` | `/api/v1/finance/gl/journals` | `CreateJournalRequest` | Create draft manual journal entry | `finance:gl:create` |
| `GET` | `/api/v1/finance/gl/journals` | Query params | List journals with pagination & filters | `finance:gl:read` |
| `GET` | `/api/v1/finance/gl/journals/:id` | None | Get journal entry details with lines | `finance:gl:read` |
| `PUT` | `/api/v1/finance/gl/journals/:id` | `UpdateJournalRequest` | Update draft manual journal | `finance:gl:update` |
| `POST` | `/api/v1/finance/gl/journals/:id/post` | None | Atomically post journal to GL | `finance:gl:post` |
| `POST` | `/api/v1/finance/gl/journals/:id/reverse` | `{ reason: string }` | Reverse posted journal entry | `finance:gl:reverse` |
| `POST` | `/api/v1/finance/gl/journals/:id/cancel` | None | Cancel draft journal entry | `finance:gl:update` |

---

## 25. Query & Reporting Semantics (Inactive Accounts & Reversal Queries)

Phase 2.3 provides deterministic query primitives for future financial reporting:

1. **Inclusion of Inactive Accounts with History:** Trial Balance, Account Balance, and Ledger View queries include all accounts that have qualifying `POSTED` GL lines within the requested company/date range, regardless of whether the account's current status is `ACTIVE` or `INACTIVE`. Deactivating an account stops NEW postings but MUST NOT remove historical transactions from reports.
2. **Reversal Inclusion Semantics:** Because original posted journals and reversal journals both have `status = 'POSTED'`, queries MUST include all posted lines. Reversal lines have debits and credits swapped, netting out the accounting impact to zero while preserving 100% auditability of financial history.
3. **`getAccountBalance(ctx, accountId, asOfDate)`:** Computes net balance (`SUM(debit) - SUM(credit)` for DEBIT accounts, `SUM(credit) - SUM(debit)` for CREDIT accounts) directly from posted `journal_lines` up to `asOfDate`.
4. **`getTrialBalance(ctx, companyId, asOfDate)`:** Aggregates debit and credit totals across all accounts (active or inactive) with posted GL movements for a company as of a specified date, verifying that `SUM(all_debits) == SUM(all_credits)`.
5. **`getLedgerView(ctx, accountId, startDate, endDate)`:** Returns chronological transaction statement with opening balance, itemized lines (including reversal entries), and running balance.

---

## 26. Performance & Concurrency Strategy

1. **Atomic Numbering Locks:** Voucher sequence generation locks sequence rows using `SELECT FOR UPDATE` to avoid duplicates during high concurrency.
2. **Row Locking on Posting & Period Verification:** Posting locks draft headers and fiscal period rows with `SELECT FOR UPDATE` to prevent concurrent dual-posting attempts and period-close races.
3. **Concurrent Reversal Safety:** 100 concurrent reversal requests against the same journal yield 1 success and 99 database unique constraint rejections (`idx_je_tenant_comp_original_journal`), resulting in exactly one reversal row.
4. **Optimistic Locking:** Draft updates increment `version` counter to detect concurrent edit collisions.
5. **Indexed Ledger Queries:** Composite indexes `idx_jl_tenant_comp_account` and `idx_je_tenant_comp_date` guarantee fast balance calculations without full table scans.

---

## 27. Financial Invariants Enforcement Matrix (29 Invariants)

| Invariant ID | Description | DB Mechanism | Service Enforcement | Test Type | Failure Behavior |
|---|---|---|---|---|---|
| **INV-GL-01** | Total Debit == Total Credit for posted journals | Service / Decimal | `GLEngine` | Invariant | Throws `AccountingError`, DB Rollback |
| **INV-GL-02** | POSTED journal headers & lines permanently immutable | PostgreSQL Triggers | `GLEngine` | Security | DB Trigger Exception on `UPDATE`/`DELETE` |
| **INV-GL-03** | Reversal creates new POSTED journal referencing source ID | Composite FK `tenantCompOriginalJournalFk` | `GLEngine` | Integration | New journal created; original left unchanged |
| **INV-GL-04** | Reversal journal itself balances | Service / Decimal | `GLEngine` | Invariant | Throws `AccountingError` |
| **INV-GL-05** | Closed periods reject new postings | FK `fiscal_period_id` | `FiscalPeriodService` | Integration | Throws `BusinessRuleViolationError` |
| **INV-GL-06** | Source document idempotency enforced | Partial Unique Index `src_doc` | `IdempotencyEngine` | Idempotency | DB Unique Constraint Violation / 409 Conflict |
| **INV-GL-07** | Tenant isolation strictly enforced | `tenant_id` column | All Services | Security | Throws `NotFoundError` / `ForbiddenError` |
| **INV-GL-08** | Company boundaries enforced | `company_id` column | All Services | Security | Throws `ForbiddenError` |
| **INV-GL-09** | Account belongs to same tenant & company | Composite FK `tenantCompAccountFk` | `COAService` | Integration | DB FK Violation / `ValidationError` |
| **INV-GL-10** | Lines reference active ACCOUNT nodes | FK `accountId` | `COAService` | Integration | Throws `ValidationError` |
| **INV-GL-11** | GROUP nodes reject posting | Service Assertion | `COAService` | Unit | Throws `ValidationError` |
| **INV-GL-12** | Debit & credit amounts non-negative | `CHECK debit >= 0, credit >= 0` | `GLEngine` | Unit | DB CHECK Violation / `ValidationError` |
| **INV-GL-13** | Line debit XOR credit exclusivity | `CHECK (d>0 AND c=0) OR (d=0 AND c>0)` | `GLEngine` | Unit | DB CHECK Violation / `ValidationError` |
| **INV-GL-14** | Tax rate policy `numeric(9,6)` / Amount `numeric(20,2)` | DB Schema | `Decimal` Utility | Unit | Precision enforced in DB |
| **INV-GL-15** | Voucher numbering concurrency-safe | Atomic DB Sequence | `NumberingEngine` | Concurrency | Unique sequence generation |
| **INV-GL-16** | Manual journal SoD (Creator != Poster) | Service Check | `AuthorizationService` | Security | Throws `ForbiddenError` |
| **INV-GL-17** | Audit log created for posting | Hash-chained Audit | `AuditService` | Audit | SHA-256 Audit Event Generated |
| **INV-GL-18** | Audit log created for reversal | Hash-chained Audit | `AuditService` | Audit | SHA-256 Audit Event Generated |
| **INV-GL-19** | PostedTransactionLookup reflects GL lines | DB Lookup Query | `GLPostedTransactionLookupAdapter` | Integration | Locks COA mutations after posting |
| **INV-GL-20** | Reversal of reversed journal rejected | Service Check | `GLEngine` | Unit | Throws `BusinessRuleViolationError` |
| **INV-GL-21** | Posting is atomic (all-or-nothing) | DB Transaction | `GLEngine` | Concurrency | Zero partial writes on failure |
| **INV-GL-22** | Accounting date falls within open period | FK `fiscalPeriodId` | `FiscalPeriodService` | Integration | Throws `BusinessRuleViolationError` |
| **INV-GL-23** | Multi-currency base conversion enforced (1.0 rate) | Service Check | `GLEngine` | Unit | Throws `ValidationError` on foreign FX |
| **INV-GL-24** | Cancelled draft cannot be posted | Service Check | `GLEngine` | Unit | Throws `BusinessRuleViolationError` |
| **INV-GL-25** | Monetary amounts serialized as decimal strings | Type Definitions | REST Layer | Contract | JSON returns decimal string (e.g. `"100.00"`) |
| **INV-GL-26** | At most one reversal per original journal | Unique Index `original_journal` | `GLEngine` | Concurrency | DB Unique Constraint Violation on dual reversal |
| **INV-GL-27** | Reversal graph is strictly one level | Service Check | `GLEngine` | Unit | Throws `BusinessRuleViolationError` on J2->J3 |
| **INV-GL-28** | Historical reporting includes inactive accounts | Query Logic | Reporting Engine | Integration | Inactive accounts with history returned |
| **INV-GL-29** | Input monetary scale <= 2 (no silent rounding) | Scale Validator | `GLEngine` | Unit | Throws `ValidationError` for scale > 2 |

---

## 28. Test Strategy

Phase 2.3 requires comprehensive automated test suites in `apps/api/test/phase2_3_gl.test.ts`:

1. **Domain Logic Tests:** Balanced posting, unbalanced rejection, debit/credit XOR, zero amount rejection, line sequence ordering.
2. **Monetary Precision & Scale Validation:** Input with 2 decimals accepted (`"12.34"`), input with >2 decimals rejected (`"12.345"`), no silent rounding.
3. **Historical Inactive Accounts:** Post entry to account -> deactivate account -> verify Trial Balance, Ledger View, and Account Balance still include posted transactions.
4. **Trigger Immutability & Direct SQL Promotion Rejection:**
   - DELETE draft journal -> allowed.
   - DELETE posted journal -> rejected by trigger.
   - UPDATE draft journal -> allowed.
   - UPDATE posted journal -> rejected by trigger.
   - Direct SQL `UPDATE journal_entries SET status = 'POSTED'` without `app.posting_authorized` -> rejected by DB trigger.
   - `GLEngine.postJournal()` -> successfully transitions `DRAFT -> POSTED`.
5. **Voucher Rollback Safety:** Verify that a failed posting transaction rolls back sequence updates in `numbering_sequences`.
6. **Append-Only Reversals & One-Level Graph:** Reversal journal created with `originalJournalId`, original journal left untouched in `POSTED` status, `J2->J3` reversal of reversal rejected.
7. **Concurrent Reversals:** 100 concurrent reversal requests against the same journal (1 succeeds, 99 rejected, exactly 1 reversal row created).
8. **Idempotency & Concurrency:** 100 concurrent posting requests with identical `sourceDocumentId` (1 success, 99 idempotency rejections), concurrent voucher allocation.
9. **Period Close Race:** Concurrent `postJournal()` and `closePeriod()` (zero postings succeed against a closed period).
10. **Property & Invariant Testing:** Randomized generation of 500 valid balanced journals verifying that trial balance sum of debits equals sum of credits.

---

## 29. Migration Safety Strategy

Phase 2.3 schema modifications will be packaged in migration file `packages/database/migrations/005_phase2_3_gl.sql`:

```text
+-----------------------------------------------------------------------------------+
|                            MIGRATION EXECUTION POLICY                             |
+-----------------------------------------------------------------------------------+
  1. PRECONDITION CHECK: Inspect existing journal_entries and journal_lines tables.
  2. PATH A (Empty Scaffolding): If tables contain 0 rows, DROP preliminary 
     tables and recreate with numeric(20,2), SQL DATE, and composite constraints.
  3. PATH B (Existing Financial Data): If tables contain user financial data, DROP IS 
     FORBIDDEN. Execute deterministic ALTER TABLE statements to alter precision, 
     add original_journal_id, add triggers, and preserve existing records.
  4. TRIGGER CREATION: Apply trg_journal_entries_immutability (with RETURN OLD/NEW 
     and app.posting_authorized check) and trg_journal_lines_immutability.
  5. INDEX CREATION: Create partial unique indexes idx_je_tenant_comp_src_doc 
     and idx_je_tenant_comp_original_journal.
  6. POST-MIGRATION VERIFICATION: Validate schema integrity, foreign keys, and indexes.
+-----------------------------------------------------------------------------------+
```

---

## 30. Observability

Structured logging via `Pino` includes correlation IDs on all GL operations:

```json
{
  "level": 30,
  "time": "2026-09-09T00:45:00.000Z",
  "tenantId": "tenant_acme",
  "companyId": "company_hq",
  "requestId": "req_12345",
  "voucherNumber": "JV-2025-26-HQ-00001",
  "journalEntryId": "je_98765",
  "totalAmount": "15000.00",
  "msg": "[GL] Journal entry posted successfully"
}
```

---

## 31. Security Review & Database Trust Boundary

- **IDOR Protection:** All endpoint parameters (`:id`) are scoped against `ctx.tenantId` and `companyId`.
- **SQL Injection Prevention:** All queries use Drizzle ORM parameterized statements.
- **Mass Assignment Defense:** Incoming request DTOs are validated using strict Zod schemas.
- **Database Trust Boundary & Session Variable Authorization:**
  - `trg_prevent_posted_journal_update_delete` enforces that `DRAFT -> POSTED` status changes require session variable authorization (`app.posting_authorized = 'true'`).
  - 1. End users never receive PostgreSQL credentials.
  - 2. End users cannot directly connect to the PostgreSQL database.
  - 3. The application/API database role is the trusted execution role.
  - 4. `GLEngine.postJournal()` is the only application code path permitted to set: `app.posting_authorized = 'true'`.
  - 5. The setting is always transaction-local using: `SET LOCAL`.
  - 6. The authorization variable automatically disappears when the transaction ends.
  - 7. Direct SQL access using an untrusted/non-application database role cannot promote DRAFT → POSTED.
  - 8. Production database credentials must never be exposed to clients, tenants, users, or browser code.
  - *Architectural Limitation Acknowledgment:* PostgreSQL session-variable authorization is a database trust-boundary mechanism, not a cryptographic proof of which application function issued the setting. Its security depends on preventing untrusted actors from obtaining the trusted application database credentials. This must be treated as an intentional architectural boundary rather than an unresolved weakness.
- **Audit Integrity:** Log modifications detected via SHA-256 hash chain verification.

---

## 32. Subphase Roadmap

Phase 2.3 is structured into 11 independently verifiable subphases:

- **2.3.0 — Architecture & Database Migration:** Migration safety precondition check, schema update, PostgreSQL immutability triggers & transition guard, migration `005_phase2_3_gl.sql`.
- **2.3.1 — Journal Model & Scale Validation:** Request/response DTOs, Zod schemas, input scale <= 2 validation, decimal string serialization.
- **2.3.2 — Draft Journal Lifecycle:** Creation, update, and cancellation of draft manual journals.
- **2.3.3 — Atomic Posting Engine Core:** Balanced transaction execution, line invariants, transactional voucher allocation, transition guard authorization (`SET LOCAL app.posting_authorized = 'true'`).
- **2.3.4 — Fiscal Period & COA Integration:** Integration with `FiscalPeriodService` (row locking) and `ChartOfAccountsService`.
- **2.3.5 — Numbering Engine Integration:** Atomic voucher number allocation via platform `NumberingEngine`.
- **2.3.6 — Dual-Layer Idempotency & Source Contract:** API header caching and DB partial unique source document constraint.
- **2.3.7 — Append-Only Single-Reversal Engine:** Reversal journal creation, `originalJournalId` linkage, single-reversal unique index, one-level graph enforcement.
- **2.3.8 — `GLPostedTransactionLookupAdapter`:** Production GL lookup adapter for COA master data protection.
- **2.3.9 — Authorization, SoD & Audit:** Segregation of duties enforcement and audit log emission.
- **2.3.10 — REST API & Final Hardening:** Fastify routes, comprehensive test suites (historical inactive accounts, scale validation, direct SQL bypass rejection, trigger DELETE/UPDATE, concurrent reversals), concurrency, and verification gate.

---

## 33. Non-Goals

The following features are explicitly excluded from Phase 2.3:
- GST Tax Engine & Returns (Phase 2.4).
- Customer Accounts Receivable (AR) & Open Item Matching (Phase 2.4).
- Supplier Accounts Payable (AP) & Open Item Settlement (Phase 2.4).
- Foreign-currency conversion, FX gain/loss, realized/unrealized FX (Phase 2.5/Phase 5).
- Bank Reconciliation & Payment Vouchers (Phase 2.5).
- Full Financial Reporting UI & PDF Generators (Phase 2.6).
- AI Automated Journal Entries (Phase 6).

---

## 34. Architectural Risks & Mitigations

| Risk Scenario | Severity | Mitigation Strategy |
|---|---|---|
| **Floating-point rounding errors in journal balance** | Critical | Use `decimal.js` arbitrary precision fixed-point math and `numeric(20,2)` DB columns. |
| **Direct SQL promotion of DRAFT to POSTED** | Critical | Implement DB trigger transition guard requiring `SET LOCAL app.posting_authorized = 'true'`. Security relies on database trust boundary (credential isolation; end users never receive DB credentials). |
| **Incorrect PostgreSQL trigger return values on DELETE** | High | PostgreSQL triggers explicitly return `OLD` on DELETE operations. |
| **Silent rounding of user input amounts** | High | Reject input amounts with scale > 2 using strict `ValidationError`. |
| **Race condition during concurrent posting & period close** | High | Wrap posting in DB transaction with `SELECT FOR UPDATE` locks on fiscal period row. |
| **Direct SQL modification of posted records** | High | Implement PostgreSQL BEFORE UPDATE OR DELETE triggers on `journal_entries` and `journal_lines`. |
| **Concurrent duplicate reversals** | High | Enforce database unique constraint `idx_je_tenant_comp_original_journal`. |
| **Cross-company account referencing** | High | Enforce composite foreign keys `(tenant_id, company_id, account_id)` at DB schema level. |
| **Duplicate source document postings** | High | Enforce partial unique DB index `idx_je_tenant_comp_src_doc`. |

---

## 35. Open Architectural Decisions

| Decision | Options | Recommended | Rationale | Impact |
|---|---|---|---|---|
| **Posting Lifecycle States** | 1. `DRAFT -> VALIDATED -> POSTED`<br>2. `DRAFT -> POSTED` | **Option 2 (`DRAFT -> POSTED`)** | Simple by default; validation occurs atomically inside posting transaction. | Eliminates unnecessary intermediate state. |
| **Date Precision** | 1. `TIMESTAMP WITH TIME ZONE`<br>2. `DATE` for accounting date | **Option 2 (`DATE` for accountingDate)** | Accounting date represents a business calendar day independent of server timezone. | Eliminates timezone boundary bugs. |
| **Reversal Model** | 1. Mutate original status to REVERSED<br>2. Append-only reversal journal | **Option 2 (Append-only reversal journal)** | Preserves immutability of original posted record. | DB triggers strictly prevent posted record mutation. |
| **Tax Precision Policy** | 1. `numeric(5,4)`<br>2. `numeric(9,6)` | **Option 2 (`numeric(9,6)`)** | Supports common Indian GST rates (12%, 18%, 28%) and precise statutory rates. | Eliminates truncation risk in Phase 2.4. |
| **Voucher Allocation Timing** | 1. Allocation on DRAFT creation<br>2. Allocation on POST execution | **Option 2 (Allocation on POST execution)** | Sequence counter updates roll back atomically if posting fails. | Prevents sequence consumption on aborted postings. |

---

## 36. Definition of Done (DoD)

Phase 2.3 is complete ONLY when all of the following criteria are satisfied:
1. `journal_entries` and `journal_lines` Drizzle schemas productionized with `numeric(20,2)` columns and SQL `DATE` `accountingDate`.
2. Tax rate precision policy updated to `numeric(9,6)` across platform specifications.
3. PostgreSQL immutability triggers (`trg_journal_entries_immutability`, `trg_journal_lines_immutability`) created with correct `RETURN OLD` (for DELETE) and `app.posting_authorized` transition guard semantics.
4. Direct SQL attempts to promote DRAFT to POSTED without `app.posting_authorized` are tested and rejected.
5. Database trust boundary explicitly defined (credentials isolated; end users never receive DB credentials; application pool is trusted role; `GLEngine.postJournal()` is sole authorized path setting `SET LOCAL app.posting_authorized = 'true'` scoped to transaction; limitation acknowledged that trigger does not cryptographically distinguish callers using identical credentials).
6. Migration safety precondition check executed; `005_phase2_3_gl.sql` applied without data destruction.
7. `AccountingCoreService` implements `createJournal`, `updateJournal`, `postJournal`, `reverseJournal`, `getJournalById`, `getLedgerView`, `getTrialBalance`.
8. Input monetary scale <= 2 enforced without silent rounding.
9. Monetary API payloads serialized as decimal strings (e.g. `"100.00"`).
10. Atomic posting engine verifies `Total Debit == Total Credit`.
11. Voucher numbers allocated inside the posting transaction block; sequence updates roll back safely on failed postings.
12. Post-posting immutability enforced via DB triggers and service guards.
13. Append-only reversal creates new POSTED journal linked via `originalJournalId` without mutating original record.
14. Database unique index `idx_je_tenant_comp_original_journal` guarantees at most one reversal per original journal.
15. One-level reversal graph (`J2->J3` rejected) enforced.
16. Period locking and period-close race protection enforced via `FiscalPeriodService.assertPeriodOpen()` and `SELECT FOR UPDATE` row locks.
17. Account eligibility validated via `ChartOfAccountsService.assertAccountEligibilityForPosting()`.
18. `GLPostedTransactionLookupAdapter` deployed and verified with Phase 2.2 COA guards.
19. Historical reporting includes inactive accounts with posted transaction history.
20. Single-currency scope (`currency == baseCurrency`, `exchangeRate == 1.0`) enforced.
21. Source document idempotency enforced via partial unique index `idx_je_tenant_comp_src_doc`.
22. Manual journal SoD (`createdBy != postedBy`) enforced.
23. SHA-256 hash-chained audit logs emitted for all postings and reversals.
24. REST API routes `/api/v1/finance/gl/*` operational with authorization guards.
25. Automated tests for monetary scale, decimal string serialization, direct SQL bypass rejection, trigger DELETE/UPDATE, inactive account reporting, concurrent reversals (100 concurrent requests), reversal graph, and period-close race pass with 100% success.
26. Monorepo typecheck (`npm run typecheck`), lint, and build (`npm run build`) pass with zero errors.

---

## 37. Final Architecture Contradiction Review

An exhaustive contradiction audit was performed against `GEMINI.md`, `PRS`, `DECISIONS.md`, Phase 2.1, and Phase 2.2:

- **Database Trust Boundary:** Confirmed session-variable authorization boundary (`app.posting_authorized`) is explicitly anchored to the application's trusted database connection pool and backend network isolation. Does not claim that the PostgreSQL trigger can independently distinguish `GLEngine` from another client using the exact same trusted database credentials; security relies on preventing untrusted actors from obtaining trusted application credentials.
- **Trigger Semantics:** Confirmed PostgreSQL trigger returns `OLD` on DELETE operations and `NEW` on UPDATE operations, eliminating SQL trigger failure modes.
- **Direct SQL Bypass Defense:** Confirmed `app.posting_authorized` transition guard prevents arbitrary SQL from promoting DRAFT to POSTED outside the GL posting engine.
- **Voucher Allocation Semantics:** Confirmed voucher allocation occurs inside the posting transaction block, ensuring sequence rollback safety.
- **Monetary Terminology:** Confirmed all API monetary fields are specified as "decimal strings", eliminating floating-point terminology.
- **Immutability Alignment:** Confirmed append-only reversal model eliminates the contradiction between posted immutability and status updates. Triggers enforce SQL-level immutability.
- **Tax Rate Precision:** Confirmed `numeric(9,6)` specification avoids truncation for Indian GST rates.
- **Reporting Semantics:** Confirmed historical GL reporting includes inactive accounts with posted activity.
- **Monetary Policy & Scale:** Confirmed `numeric(20,2)` alignment, input scale <= 2 validation, and explicit Phase 2.3 single-currency boundary across all documentation.
- **Date Semantics:** Confirmed SQL `DATE` for `accountingDate` and `TIMESTAMP WITH TIME ZONE` for `postedAt`.
- **Period Semantics:** Confirmed `FiscalPeriodService` integration alignment and `SELECT FOR UPDATE` race protection.
- **COA Authority:** Confirmed `ChartOfAccountsService` remains master authority for account definitions.
- **No Mock State:** Confirmed `GLPostedTransactionLookupAdapter` replaces test adapter cleanly without storing fake GL data.

Zero unresolved architectural contradictions exist.

---

## 38. Final Planning Verdict & Stop Declaration

```text
PHASE 2.3 PLANNING: CORRECTED AND COMPLETE

PHASE 2.3 IMPLEMENTATION: NOT STARTED

ARCHITECTURE AUTHORIZATION: PENDING EXTERNAL REVIEW
```
