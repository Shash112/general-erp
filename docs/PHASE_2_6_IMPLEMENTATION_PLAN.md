# PHASE 2.6 — ACCOUNTS RECEIVABLE IMPLEMENTATION PLAN

## PHASE 2.6 PRE-IMPLEMENTATION ARCHITECTURE CORRECTIONS

This section documents the explicit resolution of model ambiguities, schema definitions, and database-boundary invariants identified during pre-implementation architecture review.

---

### 1. Historical Tax Snapshot Architecture
- **Line-Level Authoritative Detailed Snapshot (`ar_document_lines`)**:
  Detailed tax components and rates are stored explicitly at the line level:
  - `hsn_sac`: HSN/SAC classification code
  - `tax_category_id`: Historical tax category identifier
  - `tax_rate_percent`: Exact decimal tax rate string (`numeric(9,6)`)
  - `cgst_amount`: CGST exact decimal amount (`numeric(20,2)`)
  - `sgst_amount`: SGST exact decimal amount (`numeric(20,2)`)
  - `igst_amount`: IGST exact decimal amount (`numeric(20,2)`)
  - `utgst_amount`: UTGST exact decimal amount (`numeric(20,2)`)
  - `cess_amount`: CESS exact decimal amount (`numeric(20,2)`)
  - `is_rcm`: Line-level RCM flag
  - `is_sez`: Line-level SEZ flag
  - `taxable_amount`: Line-level taxable amount (`numeric(20,2)`)
  - `tax_amount`: Line-level total tax amount (`numeric(20,2)`)
  - `gross_amount`: Line-level total gross amount (`numeric(20,2)`)

- **Document-Level Immutable Aggregates & Metadata (`ar_documents`)**:
  Document headers store transaction-level metadata and aggregate tax totals:
  - `place_of_supply_state_code`: Place of Supply state code (e.g. `'27'`)
  - `supply_nature`: Supply classification (`INTRA_STATE`, `INTER_STATE`)
  - `taxability`: Taxability status (`TAXABLE`, `EXEMPT`, `NIL_RATED`, `NON_GST`)
  - `is_rcm`: Document-level RCM flag
  - `is_sez`: Document-level SEZ flag
  - `taxable_amount`: Aggregate document taxable total (`numeric(20,2)`)
  - `tax_amount`: Aggregate document tax total (`numeric(20,2)`)
  - `gross_amount`: Aggregate document gross total (`numeric(20,2)`)

- **Aggregate Reconciliation Invariant**:
  Document-level aggregate tax totals MUST reconcile exactly with line-level snapshot sums:
  - `ar_documents.taxable_amount = sum(ar_document_lines.taxable_amount)`
  - `ar_documents.tax_amount = sum(ar_document_lines.tax_amount)`
  - `ar_documents.gross_amount = sum(ar_document_lines.gross_amount)`

- **Three-Tier Tax & Accounting Distinction**:
  1. **TaxEngine Current Resolution**: Active configuration in `TaxEngineService` used strictly during new/draft transaction resolution.
  2. **AR Historical Tax Snapshot**: Immutable snapshot persisted on POSTED `ar_document_lines` (detailed line components/rates) and `ar_documents` (immutable aggregates/metadata). Used for all subsequent subledger reads, customer statements, aging, allocations, and reversals.
  3. **GL Historical Posted Journal**: Financial posting lines written to `journal_entries` and `journal_lines` by `GLEngine`.

- **Stability Guarantee**: Subsequence changes to tax rates, HSN/SAC codes, or tax rules in `TaxEngine` will **NEVER** modify posted AR tax snapshots.

---

### 2. Single-Source Credit Model & Open Item Elimination of Ambiguity
- **Authoritative Debit Open Item Model**: `ar_open_items` represents **DEBIT receivable items ONLY** (`INVOICE`, `DEBIT_NOTE`, `OPENING_BALANCE`).
  - Invoice $\rightarrow$ DEBIT open item (`ar_open_items`, `original_amount > 0`, `outstanding_amount >= 0`).
  - Debit Note $\rightarrow$ DEBIT open item (`ar_open_items`, `original_amount > 0`, `outstanding_amount >= 0`).
  - Opening Receivable $\rightarrow$ DEBIT open item (`ar_open_items`, `original_amount > 0`, `outstanding_amount >= 0`).
- **Authoritative Credit Source Model**: Credit Notes do **NOT** create rows in `ar_open_items`.
  - Receipt $\rightarrow$ CREDIT SOURCE (`ar_receipts`, `total_amount > 0`, tracked via `receipt.unapplied_amount`).
  - Credit Note $\rightarrow$ CREDIT SOURCE (`ar_documents` with `document_type = 'CREDIT_NOTE'`, `gross_amount > 0`, tracked via `creditNote.unapplied_amount`).
- This completely eliminates dual competing credit representations and ensures `ar_open_items.outstanding_amount` is always positive or zero (`CHECK (outstanding_amount >= 0)`).

---

### 3. Credit Note Source Type Validation
- **Polymorphic Source Constraints**: `ar_allocations` supports `allocation_source_type = 'RECEIPT'` or `'CREDIT_NOTE'`.
- **Database Engine Check Constraint**:
  ```sql
  CONSTRAINT chk_ar_alloc_source_exclusivity CHECK (
    (allocation_source_type = 'RECEIPT' AND receipt_id IS NOT NULL AND credit_note_id IS NULL) OR 
    (allocation_source_type = 'CREDIT_NOTE' AND credit_note_id IS NOT NULL AND receipt_id IS NULL)
  )
  ```
- **Document Type Enforcement**: Foreign key `(tenant_id, company_id, credit_note_id) REFERENCES ar_documents(tenant_id, company_id, id)` guarantees entity existence. In addition, the AR transaction service explicitly validates `creditNote.document_type === 'CREDIT_NOTE'` and `creditNote.status === 'POSTED'` inside the same atomic PostgreSQL transaction prior to allocation.

---

### 4. Authoritative Outstanding & Unapplied Formulas
- **Debit Open Item Outstanding Amount**:
  $$\text{Outstanding Amount}(i) = \text{Original Amount}(i) - \sum \text{Active Allocations}(i) - \sum \text{Active Write-Offs}(i) - \sum \text{Active Credit Adjustments}(i) - \sum \text{Active Discounts}(i) + \sum \text{Active Debit Adjustments}(i)$$
- **Credit Source Unapplied Amount**:
  - For Receipts: $\text{Unapplied Amount}(r) = \text{Total Amount}(r) - \sum \text{Active Allocations}(r)$
  - For Credit Notes: $\text{Unapplied Amount}(c) = \text{Gross Amount}(c) - \sum \text{Active Allocations}(c)$
- **Settlement Discounts**: Early payment discounts are captured on `ar_allocations.discount_amount` during allocation, reducing open item outstanding balance without creating a separate `ar_adjustments` row (preventing double-counting).

---

### 5. Balance Projections vs Database Constraints

#### Database-Enforced Constraints
- `CHECK (outstanding_amount >= 0)` on `ar_open_items` and `ar_documents`
- `CHECK (unapplied_amount >= 0)` on `ar_receipts` and `ar_documents`
- `CHECK (allocated_amount > 0)` on `ar_allocations`
- `CHECK (discount_amount >= 0)` on `ar_allocations`
- Exact decimal column types `numeric(20,2)` and `numeric(12,6)`
- Composite foreign keys `(tenant_id, company_id, entity_id)`
- Allocation source exclusivity check constraint

#### Service-Enforced Invariants (Transactional Boundaries)
- `allocated_amount + unapplied_amount == total_amount` (for receipts and credit notes)
- `allocation.allocated_amount <= creditSource.unapplied_amount`
- `allocation.allocated_amount + allocation.discount_amount <= openItem.outstanding_amount`
- Transactionally maintained balance updates under `SELECT ... FOR UPDATE` locks
- Sequence numbering and open fiscal period validation

---

### 6. Allocation Reversal for Both Source Types
- **Append-Only Reversal**: Reversing an allocation marks `ar_allocations.status = 'REVERSED'` and records `reversed_at` and `reversed_by`.
- **Atomic State Restoration**:
  - `openItem.outstanding_amount = openItem.outstanding_amount + reversedAllocation.allocated_amount + reversedAllocation.discount_amount`
  - If `source_type == 'RECEIPT'`: `receipt.unapplied_amount = receipt.unapplied_amount + reversedAllocation.allocated_amount`
  - If `source_type == 'CREDIT_NOTE'`: `creditNote.unapplied_amount = creditNote.unapplied_amount + reversedAllocation.allocated_amount`
  - Updates customer net balance projection.
- Preserves 100% of historical allocation records for auditing.

---

### 7. Tenant & Company Ownership Rules
- **Explicit Ownership Principle**:
  > Every tenant/company-owned business entity reference must use composite tenant/company/entity ownership (`tenant_id, company_id, entity_id`). Globally authoritative platform references (such as `companies.id`) use their established global primary key identifier.
- Applied consistently across all AR tables (`ar_documents`, `ar_document_lines`, `ar_open_items`, `ar_receipts`, `ar_allocations`, `ar_adjustments`).

---

## 1. EXECUTIVE SUMMARY

Phase 2.6 establishes the authoritative Accounts Receivable (AR) subledger for the General ERP modular monolith. Accounts Receivable manages customer identities, receivable documents (invoices, credit notes, debit notes, opening balances), receivable open items, receipts, allocations, settlements, customer balances, aging, and AR accounting event translations.

### Core Architecture Boundary
```text
Operational Caller / Future Sales Module
                 │
                 ▼
         AR Subledger (AR Documents, Open Items, Receipts, Allocations)
                 │
                 ▼
       TaxEngineService (Phase 2.5 Tax Resolution & Calculation)
                 │
                 ▼
     AccountingCoreService (Account Mapping & Event Translation)
                 │
                 ▼
      GLEngine.postJournal() (Authoritative Financial Posting Engine)
                 │
                 ▼
           General Ledger
```

---

## 2. CURRENT REPOSITORY ASSESSMENT

| Capability / Module | Implementation Status | Notes |
| :--- | :--- | :--- |
| **Chart of Accounts (COA)** | **EXISTS** | Supports `isControlAccount` and `controlAccountType` (`AR`, `AP`, `CASH`, `BANK`, `TAX_INPUT`, `TAX_OUTPUT`). |
| **GL Engine (`GLEngine`)** | **EXISTS** | Authoritative atomic posting engine, draft lifecycle, fiscal period checks, reversal engine. |
| **Accounting Core (`AccountingCoreService`)** | **EXISTS** | Handles mapping resolution (`AccountingConfigurationService`), tax event translation, exact-decimal invariants. |
| **Tax Engine (`TaxEngineService` / `TaxCalculationService`)** | **EXISTS** | HSN/SAC, category, rate, rule, PoS, taxability, inclusive/exclusive tax calculations complete (Phase 2.5). |
| **Master Data Engine (`customers`)** | **EXISTS** | Table `customers` exists in `packages/database/src/schema/master.ts` (`id`, `tenantId`, `companyId`, `code`, `name`, `gstin`, `creditLimit`). |
| **Numbering Engine (`NumberingEngine`)** | **EXISTS** | Centralized sequence generation with fiscal year/prefix support. |
| **Fiscal Period Engine (`FiscalPeriodService`)** | **EXISTS** | Open/Closed fiscal year & period resolution with atomic period-close locks. |
| **Authorization & SoD (`AuthorizationService`)** | **EXISTS** | Tenant/company/role RBAC and Segregation of Duties checks. |
| **Audit Engine (`AuditService`)** | **EXISTS** | Append-only, hash-chained audit logging. |
| **Idempotency Engine (`IdempotencyService`)** | **EXISTS** | Dual-layer API and business identity uniqueness (`tenantId`, `companyId`, `sourceModule`, `sourceDocumentId`). |
| **AR Subledger Schema & Services** | **NOT IMPLEMENTED** | No tables or services for `ar_documents`, `ar_open_items`, `ar_receipts`, `ar_allocations`, `ar_adjustments`. |

---

## 3. AUTHORITATIVE OWNERSHIP MATRIX

- **AR Subledger owns**: Customer AR identity, AR document lifecycle (`DRAFT`, `POSTED`, `SETTLED`, `CANCELLED`), AR open items (`ar_open_items`), customer receipt records (`ar_receipts`), allocations (`ar_allocations`), settlement calculation, customer aging, and historical AR tax snapshot.
- **AccountingCore owns**: Account mapping resolution (`AR_CONTROL`, `SALES_REVENUE`, `CASH`, `BANK`, `OUTPUT_CGST`, etc.), exact-decimal invariant checks, translation of AR domain events into balanced accounting lines.
- **GL Engine owns**: Journal entry table (`journal_entries`), journal line table (`journal_lines`), fiscal period validation, sequence numbering, append-only GL reversal, and trial balance / GL account balances.
- **Tax Engine owns**: Tax category/rate/rule resolution, Place of Supply evaluation, taxability determination, inclusive/exclusive calculation results.

---

## 4. DATABASE SCHEMA DESIGN (CORRECTED DDL)

### 1. `ar_documents`
```sql
CREATE TABLE ar_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL,
  document_type VARCHAR(32) NOT NULL, -- INVOICE, CREDIT_NOTE, DEBIT_NOTE, OPENING_BALANCE
  document_number VARCHAR(64),
  document_date DATE NOT NULL,
  accounting_date DATE NOT NULL,
  due_date DATE NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  exchange_rate NUMERIC(12, 6) NOT NULL DEFAULT '1.000000',
  place_of_supply_state_code VARCHAR(2),
  supply_nature VARCHAR(32), -- INTRA_STATE, INTER_STATE
  taxability VARCHAR(32), -- TAXABLE, EXEMPT, NIL_RATED, NON_GST
  is_rcm BOOLEAN NOT NULL DEFAULT FALSE,
  is_sez BOOLEAN NOT NULL DEFAULT FALSE,
  taxable_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  tax_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  gross_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  outstanding_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  allocated_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  unapplied_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT', -- DRAFT, POSTED, PARTIALLY_SETTLED, SETTLED, CANCELLED
  source_module VARCHAR(64) NOT NULL DEFAULT 'AR',
  source_document_id VARCHAR(255),
  journal_entry_id UUID REFERENCES journal_entries(id),
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT idx_ar_doc_tenant_comp_id UNIQUE (tenant_id, company_id, id),
  CONSTRAINT idx_ar_doc_tenant_comp_num UNIQUE (tenant_id, company_id, document_number),
  CONSTRAINT fk_ar_doc_customer FOREIGN KEY (tenant_id, company_id, customer_id) 
    REFERENCES customers(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_ar_doc_outstanding_pos CHECK (outstanding_amount >= 0),
  CONSTRAINT chk_ar_doc_unapplied_pos CHECK (unapplied_amount >= 0)
);
```

### 2. `ar_document_lines`
```sql
CREATE TABLE ar_document_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  ar_document_id UUID NOT NULL,
  line_sequence INT NOT NULL,
  product_id UUID,
  description TEXT NOT NULL,
  hsn_sac VARCHAR(10),
  quantity NUMERIC(15, 4) NOT NULL DEFAULT '1.0000',
  unit_price NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  taxable_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  tax_category_id UUID,
  tax_rate_percent NUMERIC(9, 6) NOT NULL DEFAULT '0.000000',
  cgst_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  sgst_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  igst_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  utgst_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  cess_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  tax_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  gross_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  is_rcm BOOLEAN NOT NULL DEFAULT FALSE,
  is_sez BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_ar_line_doc FOREIGN KEY (tenant_id, company_id, ar_document_id) 
    REFERENCES ar_documents(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ar_line_product FOREIGN KEY (tenant_id, company_id, product_id) 
    REFERENCES products(tenant_id, company_id, id) ON DELETE RESTRICT
);
```

### 3. `ar_open_items`
```sql
CREATE TABLE ar_open_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL,
  ar_document_id UUID NOT NULL,
  document_type VARCHAR(32) NOT NULL DEFAULT 'INVOICE', -- INVOICE, DEBIT_NOTE, OPENING_BALANCE
  document_number VARCHAR(64) NOT NULL,
  document_date DATE NOT NULL,
  due_date DATE NOT NULL,
  original_amount NUMERIC(20, 2) NOT NULL,
  outstanding_amount NUMERIC(20, 2) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN', -- OPEN, PARTIALLY_SETTLED, SETTLED, CANCELLED
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT idx_ar_open_tenant_comp_id UNIQUE (tenant_id, company_id, id),
  CONSTRAINT fk_ar_open_customer FOREIGN KEY (tenant_id, company_id, customer_id) 
    REFERENCES customers(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ar_open_doc FOREIGN KEY (tenant_id, company_id, ar_document_id) 
    REFERENCES ar_documents(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_ar_open_outstanding_pos CHECK (outstanding_amount >= 0)
);
```

### 4. `ar_receipts`
```sql
CREATE TABLE ar_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL,
  receipt_number VARCHAR(64),
  receipt_date DATE NOT NULL,
  accounting_date DATE NOT NULL,
  payment_mode VARCHAR(32) NOT NULL, -- CASH, BANK_TRANSFER, CHEQUE, UPI
  bank_account_id UUID,
  total_amount NUMERIC(20, 2) NOT NULL,
  allocated_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  unapplied_amount NUMERIC(20, 2) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'POSTED', -- POSTED, REVERSED
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT idx_ar_receipt_tenant_comp_id UNIQUE (tenant_id, company_id, id),
  CONSTRAINT fk_ar_receipt_customer FOREIGN KEY (tenant_id, company_id, customer_id) 
    REFERENCES customers(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ar_receipt_bank_acc FOREIGN KEY (tenant_id, company_id, bank_account_id) 
    REFERENCES chart_of_accounts(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_ar_receipt_unapplied_pos CHECK (unapplied_amount >= 0)
);
```

### 5. `ar_allocations`
```sql
CREATE TABLE ar_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  allocation_source_type VARCHAR(32) NOT NULL, -- RECEIPT, CREDIT_NOTE
  receipt_id UUID,
  credit_note_id UUID,
  open_item_id UUID NOT NULL,
  allocated_amount NUMERIC(20, 2) NOT NULL,
  discount_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  allocation_date DATE NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, REVERSED
  reversed_at TIMESTAMPTZ,
  reversed_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT idx_ar_alloc_tenant_comp_id UNIQUE (tenant_id, company_id, id),
  CONSTRAINT fk_ar_alloc_receipt FOREIGN KEY (tenant_id, company_id, receipt_id) 
    REFERENCES ar_receipts(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ar_alloc_cn FOREIGN KEY (tenant_id, company_id, credit_note_id) 
    REFERENCES ar_documents(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ar_alloc_open_item FOREIGN KEY (tenant_id, company_id, open_item_id) 
    REFERENCES ar_open_items(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_ar_alloc_source_exclusivity CHECK (
    (allocation_source_type = 'RECEIPT' AND receipt_id IS NOT NULL AND credit_note_id IS NULL) OR 
    (allocation_source_type = 'CREDIT_NOTE' AND credit_note_id IS NOT NULL AND receipt_id IS NULL)
  ),
  CONSTRAINT chk_ar_alloc_amount_pos CHECK (allocated_amount > 0),
  CONSTRAINT chk_ar_alloc_discount_pos CHECK (discount_amount >= 0)
);
```

### 6. `ar_adjustments`
```sql
CREATE TABLE ar_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL,
  open_item_id UUID NOT NULL,
  adjustment_type VARCHAR(32) NOT NULL, -- WRITE_OFF, CREDIT_ADJUSTMENT, DEBIT_ADJUSTMENT
  amount NUMERIC(20, 2) NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, REVERSED
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT idx_ar_adj_tenant_comp_id UNIQUE (tenant_id, company_id, id),
  CONSTRAINT fk_ar_adj_customer FOREIGN KEY (tenant_id, company_id, customer_id) 
    REFERENCES customers(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ar_adj_open_item FOREIGN KEY (tenant_id, company_id, open_item_id) 
    REFERENCES ar_open_items(tenant_id, company_id, id) ON DELETE RESTRICT
);
```

---

## 5. FINANCIAL INVARIANTS (28 INVARIANTS)

1. `tenantId` and `companyId` must match between request context, customer, AR document, open item, receipt, allocation, and GL entry.
2. Posted AR documents and posted journals are immutable.
3. Monetary amounts must be exact decimal strings with scale <= 2 (`numeric(20,2)`).
4. `receipt.allocatedAmount + receipt.unappliedAmount == receipt.totalAmount`.
5. `creditNote.allocatedAmount + creditNote.unappliedAmount == creditNote.grossAmount`.
6. `allocation.allocatedAmount + allocation.discountAmount <= openItem.outstandingAmount`.
7. `allocation.allocatedAmount <= creditSource.unappliedAmount`.
8. `openItem.outstandingAmount` cannot become negative (`CHECK (outstanding_amount >= 0)`).
9. Credit item `unappliedAmount` cannot become negative (`CHECK (unapplied_amount >= 0)`).
10. Settled open items must have `outstandingAmount == '0.00'`.
11. Duplicate `(tenantId, companyId, sourceModule, sourceDocumentId)` must be rejected.
12. Posted AR accounting event must correspond to exactly one balanced GL journal posting (`totalDebit == totalCredit`).
13. Closed fiscal periods reject AR financial postings.
14. Tax calculation in AR must consume `TaxCalculationResult` from `TaxCalculationService`.
15. Customer identity must exist and belong to the same tenant/company.
16. Draft AR documents cannot consume voucher sequence numbers.
17. AR reversals create append-only compensating entries and never delete original records.
18. AR reversal must be idempotent.
19. Customer Gross Receivable equals sum of debit open item outstanding amounts.
20. Customer Total Credit equals sum of unapplied receipt amounts plus unapplied credit note amounts.
21. Customer Net Balance equals Customer Gross Receivable minus Customer Total Credit.
22. Aging reports must be deterministic for any given `asOfDate`.
23. Reversal of an allocation restores receipt/credit-note unapplied balance and open item outstanding balance exact decimal for decimal while preserving historical allocation log.
24. AR write-off requires explicit `ar:write_off` permission and audit logging.
25. Credit notes reduce total AR receivable balance.
26. Debit notes increase total AR receivable balance.
27. Concurrency locks on `ar_open_items` must order item IDs in ascending order to prevent deadlocks.
28. Posted AR documents preserve an immutable historical tax snapshot on `ar_document_lines` (detailed component amounts, rates, HSN/SAC, `is_rcm`, `is_sez`) and `ar_documents` (aggregate totals and transaction metadata). Document tax totals must reconcile with line item sums.

---

## 6. PROPOSED SUBPHASE BREAKDOWN

```text
Phase 2.6 Breakdown:
├── 2.6.0 Architecture & Database Foundation (Drizzle Schema & Composite FK Migrations)
├── 2.6.1 Customer AR Integration & Master Data Verification
├── 2.6.2 AR Document Lifecycle & Historical Tax Snapshot Engine
├── 2.6.3 AR Accounting Integration & GL Posting (AccountingCore Bridge)
├── 2.6.4 Receipt Processing & Polymorphic Allocation Engine
├── 2.6.5 Settlement & Customer Balance Projection Engine
├── 2.6.6 Credit Memos, Debit Memos & Write-Off Adjustments
├── 2.6.7 Aging Engine & Customer Statement Services
├── 2.6.8 AR REST API Layer
└── 2.6.9 Final Hardening, Concurrency & Security Verification
```

---

## 7. FINAL STATUS VERDICT

```text
PHASE 2.6 FINAL ARCHITECTURE CORRECTIONS: COMPLETE

PHASE 2.6 IMPLEMENTATION: NOT STARTED

PHASE 2.6 APPROVAL: REQUIRED

EXECUTION STOPPED
```
