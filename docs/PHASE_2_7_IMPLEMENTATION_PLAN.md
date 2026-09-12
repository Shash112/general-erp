# PHASE 2.7 — ACCOUNTS PAYABLE (AP) SUBLEDGER & MASTER IMPLEMENTATION PLAN

## 1. EXECUTIVE SUMMARY & ARCHITECTURAL OBJECTIVE

Phase 2.7 establishes the authoritative Accounts Payable (AP) subledger for General ERP. Accounts Payable manages supplier identities, supplier payable documents (purchase bills, credit notes, debit notes, opening balances), credit payable open items, supplier disbursements/payments, polymorphic allocations, adjustments/write-offs, settlement status, supplier aging, supplier statements, and AP accounting event translations.

### Core Architecture Boundary

```text
Procurement / Purchase Module (Future Phase) / Operational API Caller
                 │
                 ▼
         AP Subledger (AP Documents, Open Items, Payments, Allocations)
                 │
                 ▼
       TaxEngineService (Phase 2.5 Tax Resolution & Input Tax Credit)
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

### Core Product & Engineering Principles
1. **Simple by default. Powerful when needed.**
2. **Subledger Authority**: AP is the single source of truth for supplier payable balances and open items. It does NOT duplicate the General Ledger; it reconciles to the `AP_CONTROL` account in GL.
3. **Immutability & Auditability**: Posted AP documents, payments, allocations, and adjustments are strictly immutable. Corrections occur via append-only reversal events.
4. **Exact Decimal Precision**: All monetary values are processed using `ExactDecimal` with scale = 2 (`numeric(20,2)`). Floating-point math is strictly forbidden.
5. **No Customer/Supplier Forks**: Single unified tenant/company-scoped architecture for Indian SMEs and mid-market enterprises.

---

## 2. REPOSITORY ASSESSMENT & ENGINE REUSE MAP

| Capability / Module | Repository Status | Phase 2.7 Integration Strategy |
| :--- | :--- | :--- |
| **Supplier Master (`suppliers`)** | **EXISTS** (`packages/database/src/schema/master.ts`) | Reused directly for supplier identity, tax GSTIN, state code, and payment terms. |
| **Chart of Accounts (`COA`)** | **EXISTS** (`chart-of-accounts.service.ts`) | Integrates with `AP_CONTROL` (Liability control), `CASH_BANK`, `EXPENSE`, `PURCHASE_DISCOUNT`, `INPUT_CGST`, `INPUT_SGST`, `INPUT_IGST`. |
| **GL Engine (`GLEngine`)** | **EXISTS** (`gl-engine.ts`) | Authoritative posting engine for AP journal entries, draft lifecycles, and fiscal period validations. |
| **Accounting Core (`AccountingCoreService`)** | **EXISTS** (`accounting-core.service.ts`) | Maps AP event types (`AP_BILL`, `AP_PAYMENT`, `AP_ADJUSTMENT`) to GL line roles using `AccountingConfigurationService`. |
| **Tax Engine (`TaxEngineService`)** | **EXISTS** (`tax-engine.service.ts`) | Used for Input Tax Credit (ITC) resolution, Place of Supply, RCM, SEZ, and tax breakdown snapshots. |
| **Numbering Engine (`NumberingEngine`)** | **EXISTS** (`numbering-engine.service.ts`) | Sequences AP document numbers, supplier payment numbers, and adjustment numbers with fiscal year resetting. |
| **Fiscal Period Service (`FiscalPeriodService`)** | **EXISTS** (`fiscal-period.service.ts`) | Validates accounting dates against OPEN fiscal periods and years prior to AP postings. |
| **Authorization & Policy (`AuthorizationService`)** | **EXISTS** (`authorization.service.ts`) | Enforces RBAC (`ap:document:*`, `ap:payment:*`, `ap:allocation:*`, `ap:adjustment:*`, `ap:aging:*`, `ap:statement:*`, `ap:settlement:*`) and ABAC data scoping. |
| **Audit Engine (`AuditService`)** | **EXISTS** (`audit.service.ts`) | Append-only SHA-256 hash chaining for all AP mutations and reversals. |
| **Idempotency Engine (`IdempotencyService`)** | **EXISTS** (`idempotency.service.ts`) | Dual-layer idempotency (API `Idempotency-Key` and business source key `(tenantId, companyId, sourceModule, sourceDocumentId)`). |
| **AP Subledger Schema & DTOs** | **IMPLEMENTED IN 2.7.0** | Schemas (`accounts-payable.ts`), DTO models, validators, and base test suite ready. |

---

## 3. TENANT & COMPANY ISOLATION & COMPOSITE OWNERSHIP RULES

To prevent cross-tenant and cross-company data leakage, AP database entities follow strict ownership scoping rules:

### 3.1 Global vs Scoped Identifiers
- **Global Identifiers**: Primary key identifiers generated as UUID (`id`).
- **Tenant-Scoped Identifiers**: `tenant_id` VARCHAR(64).
- **Company-Scoped Identifiers**: `company_id` UUID referencing `companies(id)`.
- **Tenant + Company Scoped Foreign Keys**: All entity relationships referencing tenant/company-owned master data (such as `suppliers`, `customers`, `products`, `chart_of_accounts`, `ap_documents`, `ap_open_items`, `ap_payments`) MUST enforce composite foreign key constraints:
  ```sql
  CONSTRAINT fk_ap_doc_supplier FOREIGN KEY (tenant_id, company_id, supplier_id)
    REFERENCES suppliers (tenant_id, company_id, id) ON DELETE RESTRICT
  ```

### 3.2 Ownership Scoping Matrix Across AP Tables

| AP Table Name | Primary Scoping Columns | Composite Foreign Keys Enforced | Unique Indexes |
| :--- | :--- | :--- | :--- |
| `ap_documents` | `tenant_id`, `company_id` | `(tenant_id, company_id, supplier_id) REFERENCES suppliers(tenant_id, company_id, id)` | `(tenant_id, company_id, id)`, `(tenant_id, company_id, document_number)` |
| `ap_document_lines` | `tenant_id`, `company_id` | `(tenant_id, company_id, ap_document_id) REFERENCES ap_documents(tenant_id, company_id, id)` | `(tenant_id, company_id, id)` |
| `ap_open_items` | `tenant_id`, `company_id` | `(tenant_id, company_id, supplier_id) REFERENCES suppliers(tenant_id, company_id, id)`<br>`(tenant_id, company_id, ap_document_id) REFERENCES ap_documents(tenant_id, company_id, id)` | `(tenant_id, company_id, id)` |
| `ap_payments` | `tenant_id`, `company_id` | `(tenant_id, company_id, supplier_id) REFERENCES suppliers(tenant_id, company_id, id)`<br>`(tenant_id, company_id, bank_account_id) REFERENCES chart_of_accounts(tenant_id, company_id, id)` | `(tenant_id, company_id, id)`, `(tenant_id, company_id, payment_number)` |
| `ap_allocations` | `tenant_id`, `company_id` | `(tenant_id, company_id, payment_id) REFERENCES ap_payments(tenant_id, company_id, id)`<br>`(tenant_id, company_id, credit_note_id) REFERENCES ap_documents(tenant_id, company_id, id)`<br>`(tenant_id, company_id, open_item_id) REFERENCES ap_open_items(tenant_id, company_id, id)` | `(tenant_id, company_id, id)` |
| `ap_adjustments` | `tenant_id`, `company_id` | `(tenant_id, company_id, supplier_id) REFERENCES suppliers(tenant_id, company_id, id)`<br>`(tenant_id, company_id, open_item_id) REFERENCES ap_open_items(tenant_id, company_id, id)` | `(tenant_id, company_id, id)` |

---

## 4. FINANCIAL IMMUTABILITY & DELETION POLICY

In alignment with General ERP's financial integrity architecture, posted AP records are strictly immutable.

### 4.1 Table Deletion Policy Rules

| Table Name | DRAFT Deletion Policy | POSTED / ACTIVE Deletion Policy | Foreign Key Deletion Rule |
| :--- | :--- | :--- | :--- |
| `ap_documents` | Allowed if status is `DRAFT`. | **STRICTLY PROHIBITED**. Reversal required. | `ON DELETE RESTRICT` on all financial relationships. |
| `ap_document_lines` | Deleted when parent DRAFT is deleted. | **STRICTLY PROHIBITED**. Immutable snapshot. | `ON DELETE RESTRICT` (Replaced `CASCADE` to prevent accidental parent drop). |
| `ap_open_items` | N/A (Created on POSTED bill). | **STRICTLY PROHIBITED**. | `ON DELETE RESTRICT`. |
| `ap_payments` | Allowed if status is `DRAFT`. | **STRICTLY PROHIBITED**. Reversal required. | `ON DELETE RESTRICT`. |
| `ap_allocations` | N/A (Always created ACTIVE). | **STRICTLY PROHIBITED**. Reversal required. | `ON DELETE RESTRICT`. |
| `ap_adjustments` | Allowed if status is `DRAFT`. | **STRICTLY PROHIBITED**. Reversal required. | `ON DELETE RESTRICT`. |

### 4.2 Reversal & Correction Architecture
Corrections MUST occur via append-only reversal records:
- **Posted Document Reversal**: Updates `ap_documents.status = 'REVERSED'` and creates append-only GL reversal entry (`AP_REVERSAL`).
- **Payment Reversal**: Updates `ap_payments.status = 'REVERSED'` and creates append-only GL reversal entry (`AP_REVERSAL`).
- **Allocation Reversal**: Updates `ap_allocations.status = 'REVERSED'`, recording `reversed_at` and `reversed_by`, restoring open item outstanding balance and source unapplied balance.
- **Adjustment Reversal**: Updates `ap_adjustments.status = 'REVERSED'` and posts GL reversal entry.

---

## 5. AUTHORITATIVE SOURCE OF TRUTH & DOCUMENT LIFECYCLE

To prevent data duplication and architectural drift, domain responsibilities are assigned strictly:

1. **Supplier Master (`suppliers` table)**: Owns supplier identity, legal name, GSTIN, primary state code, credit terms, and bank details.
2. **AP Documents (`ap_documents` & `ap_document_lines`)**: Owns supplier payable document headers and lines, document numbers, original supplier bill reference numbers, posting dates, and line-level historical tax snapshots.
3. **AP Open Items (`ap_open_items`)**: Owns **CREDIT payable exposure items ONLY** (`SUPPLIER_BILL`, `DEBIT_NOTE`, `OPENING_BALANCE`). Maintains `original_amount` and `outstanding_amount`.
4. **Supplier Payments (`ap_payments`)**: Owns actual supplier disbursements (`total_amount`, `allocated_amount`, `unapplied_amount`, `bank_account_id`, `payment_mode`).
5. **AP Allocations (`ap_allocations`)**: Owns polymorphic application links between DEBIT sources (Supplier Payments or Supplier Credit Notes) and CREDIT open items (Supplier Bills or Debit Notes).
6. **AP Adjustments (`ap_adjustments`)**: Owns write-offs, debit adjustments, credit adjustments, and discount adjustments.
7. **AP Settlement State (`ApSettlementService`)**: Derived, calculated status (`OPEN`, `PARTIALLY_SETTLED`, `SETTLED`) computed from active allocations and adjustments against open items.
8. **AP Aging & Supplier Statements**: Derived, read-only analytical presentations constructed from authoritative posted AP records.

### 5.1 Document Financial Lifecycle

The financial posting status lifecycle is strictly defined as:

```text
[DRAFT] ──(postDocument)──► [POSTED] ──(reverseDocument)──► [REVERSED]
   │                           
   └──(cancelDraft)──► [CANCELLED]
```

*Note: `SETTLED` and `PARTIALLY_SETTLED` are derived settlement projections on `ap_open_items.status` and `ap_documents.status`, NOT independent financial posting states.*

---

## 6. AP DOCUMENT & CREDIT/DEBIT MODEL

### 6.1 AP Document Types

| Document Type | Business Meaning | Accounting Effect | Open-Item Effect | Tax Effect | Reversal Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `SUPPLIER_BILL` | Invoice received from supplier for goods/services. | **DR** Expense / Inventory<br>**DR** Input GST<br>**CR** AP Control | Creates **CREDIT** Open Item (`original_amount > 0`, `outstanding_amount >= 0`). | Input Tax Credit (ITC) snapshot recorded on lines. | Full reversal reverses GL entry & closes open item if unallocated. |
| `CREDIT_NOTE` | Supplier-issued credit note reducing liability. | **DR** AP Control<br>**CR** Expense / Purchase Return<br>**CR** Input GST Reversal | Acts as **DEBIT CREDIT SOURCE** (`gross_amount > 0`, tracked via `unapplied_amount`). Does NOT create open item. | Reverses Input Tax Credit (ITC). | Reverses GL entry & restores credit note unapplied balance. |
| `DEBIT_NOTE` | Purchaser-issued debit note increasing payable liability or correcting bill undercharge. | **DR** Expense / Inventory<br>**DR** Input GST<br>**CR** AP Control | Creates **CREDIT** Open Item (`original_amount > 0`, `outstanding_amount >= 0`). | Adds Input Tax Credit (ITC). | Reverses GL entry & reduces open item balance. |
| `OPENING_BALANCE` | Migration / fiscal start opening supplier payable. | **DR** Retained Earnings / Opening Equity<br>**CR** AP Control | Creates **CREDIT** Open Item (`original_amount > 0`, `outstanding_amount >= 0`). | No tax effect (pre-tax historical liability). | Reverses GL opening entry & removes open item. |

### 6.2 Single-Source Credit/Debit Model

To avoid ambiguity:
- **CREDIT Open Items (`ap_open_items`)**: Represent **payable liabilities** (`SUPPLIER_BILL`, `DEBIT_NOTE`, `OPENING_BALANCE`).
  - Original Amount $> 0$.
  - Outstanding Amount $\ge 0$.
- **DEBIT Credit Sources**: Represent **liability reduction instruments**.
  - Supplier Payment (`ap_payments`, `total_amount > 0`, tracked via `unapplied_amount`).
  - Supplier Credit Note (`ap_documents` where `document_type = 'CREDIT_NOTE'`, `gross_amount > 0`, tracked via `unapplied_amount`).

This guarantees `ap_open_items.outstanding_amount` is always positive or zero (`CHECK (outstanding_amount >= 0)`), preventing negative balance glitches.

---

## 7. AUTHORITATIVE AP OPEN-ITEM & BALANCE FORMULAS

### 7.1 Credit Open Item Outstanding Amount Formula

For any open item $i$:

$$\text{Outstanding Amount}(i) = \text{Original Amount}(i) - \sum \text{Active Allocations}(i) - \sum \text{Active Write-Offs}(i) - \sum \text{Active Credit Adjustments}(i) - \sum \text{Active Discounts}(i) + \sum \text{Active Debit Adjustments}(i)$$

Where:
- $\text{Active Allocations}(i)$: Sum of `allocated_amount` on `ap_allocations` where `open_item_id = i` and `status = 'ACTIVE'`.
- $\text{Active Write-Offs}(i)$: Sum of `amount` on `ap_adjustments` where `open_item_id = i`, `adjustment_type = 'WRITE_OFF'`, and `status = 'POSTED'`.
- $\text{Active Credit Adjustments}(i)$: Sum of `amount` on `ap_adjustments` where `open_item_id = i`, `adjustment_type = 'CREDIT_ADJUSTMENT'`, and `status = 'POSTED'`.
- $\text{Active Discounts}(i)$: Sum of `discount_amount` on `ap_allocations` where `open_item_id = i` and `status = 'ACTIVE'`.
- $\text{Active Debit Adjustments}(i)$: Sum of `amount` on `ap_adjustments` where `open_item_id = i`, `adjustment_type = 'DEBIT_ADJUSTMENT'`, and `status = 'POSTED'`.

### 7.2 Debit Credit Source Unapplied Amount Formula

- **For Supplier Payments ($p$)**:
  $$\text{Unapplied Amount}(p) = \text{Total Amount}(p) - \sum \text{Active Allocations}(p)$$
- **For Supplier Credit Notes ($c$)**:
  $$\text{Unapplied Amount}(c) = \text{Gross Amount}(c) - \sum \text{Active Allocations}(c)$$

### 7.3 Derived Settlement Status Definitions

- `OPEN`: $\text{Outstanding Amount}(i) == \text{Original Amount}(i)$
- `PARTIALLY_SETTLED`: $0 < \text{Outstanding Amount}(i) < \text{Original Amount}(i)$
- `SETTLED`: $\text{Outstanding Amount}(i) == 0.00$

---

## 8. STRICT SEPARATION OF PAYMENT POSTING & ALLOCATION

Payment posting and allocation are strictly decoupled into two separate, explicit domain operations.

### 8.1 Operation 1: Payment Posting (`postPayment`)
Posting a payment MUST:
1. Validate supplier, bank account, payment date, and open fiscal period.
2. Generate unique `payment_number` via Numbering Engine.
3. Post accounting event (`AP_PAYMENT`) to GL via AccountingCore:
   - **DR** `AP_CONTROL` (Accounts Payable Control) — `total_amount`
   - **CR** `CASH_BANK` (Bank / Cash Account) — `total_amount`
4. Set `ap_payments.status = 'POSTED'`, `allocated_amount = '0.00'`, `unapplied_amount = total_amount`.
5. Payment remains **100% UNAPPLIED** upon completion of this operation.

### 8.2 Operation 2: Allocation (`allocate`)
Allocation MUST:
1. Consume available `unapplied_amount` from a POSTED payment or POSTED credit note.
2. Validate source eligibility and target open item outstanding balance.
3. Apply `allocated_amount` and prompt payment `discount_amount` to open item.
4. Insert active record in `ap_allocations`.
5. Update `unapplied_amount` on source and `outstanding_amount` on open item.
6. Recompute derived settlement status.

*Convenience Orchestrators*: Higher-level UI or integration handlers may invoke `postPayment` followed immediately by `allocate` within a single outer transaction block, but the domain services remain strictly separate.

---

## 9. AP ALLOCATION ENGINE & CREDIT NOTE ELIGIBILITY

The AP Allocation Engine applies DEBIT sources (Payments or Credit Notes) to CREDIT open items (Bills or Debit Notes).

### 9.1 Credit Note Source Eligibility Invariants
For a supplier document to act as a DEBIT credit source for allocation, it MUST satisfy ALL conditions:
1. `document_type === 'CREDIT_NOTE'`
2. `status === 'POSTED'`
3. Same `tenant_id` and `company_id` as target open item.
4. Same `supplier_id` as target open item (Cross-supplier allocation is strictly prohibited).
5. Document is NOT reversed or cancelled.
6. `unapplied_amount > 0.00`.

### 9.2 Allocation Source Exclusivity Check Constraint
Enforced at database schema level:
```sql
CONSTRAINT chk_ap_alloc_source_exclusivity CHECK (
  (allocation_source_type = 'PAYMENT' AND payment_id IS NOT NULL AND credit_note_id IS NULL) OR 
  (allocation_source_type = 'CREDIT_NOTE' AND credit_note_id IS NOT NULL AND payment_id IS NULL)
)
```

---

## 10. DATABASE-AUTHORITATIVE CONCURRENCY & LOCK ORDERING

Financial operations against AP open items must prevent race conditions, double allocations, negative balances, and phantom reads under concurrent requests across cluster instances.

### 10.1 PostgreSQL Row-Level Lock Ordering Strategy

To eliminate deadlocks and enforce serializable financial state mutations, PostgreSQL row locks (`SELECT ... FOR UPDATE`) MUST be acquired in a deterministic global order:

1. **Phase 1 — Lock Target Open Item(s)**:
   Acquire row locks on all target `ap_open_items` in ascending UUID order:
   ```sql
   SELECT id, outstanding_amount, status 
   FROM ap_open_items 
   WHERE tenant_id = $1 AND company_id = $2 AND id IN ($3, ...) 
   ORDER BY id ASC FOR UPDATE;
   ```
2. **Phase 2 — Lock Credit Source (Payment or Credit Note)**:
   Acquire row lock on credit source (`ap_payments` or `ap_documents`):
   ```sql
   SELECT id, unapplied_amount, status 
   FROM ap_payments 
   WHERE tenant_id = $1 AND company_id = $2 AND id = $3 
   FOR UPDATE;
   ```
3. **Phase 3 — Post-Lock Balance Validation**:
   Re-read and validate `unapplied_amount >= allocated_amount` and `outstanding_amount >= allocated_amount + discount_amount` inside the open transaction.
4. **Phase 4 — Write Allocation & Update Balances**:
   Insert `ap_allocations` row, update open item and credit source balances.
5. **Phase 5 — Commit Transaction**:
   Commit transaction atomically.

*Rule*: Process-local mutexes (e.g. Node.js in-memory locks) are strictly prohibited as authoritative concurrency controls. PostgreSQL row-level locks are the sole system of record.

---

## 11. AP ADJUSTMENTS & DISCOUNT MODELING

### 11.1 AP Adjustment Accounting Semantics

AP Adjustments write balanced journal entries via `AccountingCoreService`. Account mappings use `AccountingConfigurationService`.

| Adjustment Type | Business Meaning | Open-Item Balance Effect | Configurable GL Line Roles | Tax Implications |
| :--- | :--- | :--- | :--- | :--- |
| `WRITE_OFF` | Vendor balance waiver / uncollected balance | Decreases `outstanding_amount` | **DR** `AP_CONTROL`<br>**CR** `WRITE_OFF_GAIN` | Non-taxable adjustment unless ITC reversal is required by tax rule. |
| `CREDIT_ADJUSTMENT` | Rate dispute, quality penalty credit | Decreases `outstanding_amount` | **DR** `AP_CONTROL`<br>**CR** `PURCHASE_ADJUSTMENT_INCOME` | Non-taxable subledger correction. |
| `DEBIT_ADJUSTMENT` | Undercharge correction, penalty fee added | Increases `outstanding_amount` | **DR** `EXPENSE_ADJUSTMENT`<br>**CR** `AP_CONTROL` | Non-taxable subledger fee adjustment. |

### 11.2 Prompt Payment Discount Modeling
Early payment discounts granted by suppliers upon allocation are captured explicitly on `ap_allocations.discount_amount`:
- Reduces `open_item.outstanding_amount` by `allocated_amount + discount_amount`.
- Consumes `allocated_amount` from payment `unapplied_amount`.
- Accounting Event: Posted upon allocation:
  - **DR** `AP_CONTROL` — `allocated_amount + discount_amount`
  - **CR** `CASH_BANK` — `allocated_amount`
  - **CR** `PURCHASE_DISCOUNT_INCOME` — `discount_amount`

---

## 12. GST / TAX ENGINE INTEGRATION & HISTORICAL TAX SNAPSHOT

AP reuses the centralized Phase 2.5 `TaxEngineService`.

### 12.1 Input Tax Credit (ITC) & Tax Resolution
1. **Taxability**: Evaluates `TAXABLE`, `EXEMPT`, `NIL_RATED`, `NON_GST`.
2. **Place of Supply (PoS)**: Compares Supplier State Code vs Company/Branch State Code:
   - Intra-State: CGST + SGST (or UTGST)
   - Inter-State: IGST
3. **Reverse Charge Mechanism (RCM)**: When `is_rcm = TRUE`, tax liability is payable by the recipient:
   - **DR** `INPUT_GST_RCM_CREDIT`
   - **CR** `GST_RCM_LIABILITY`
4. **SEZ Supplies**: Zero-rated IGST or SEZ tax resolution.

### 12.2 Immutable Line & Header Snapshot

```sql
-- Header Snapshot fields on ap_documents
place_of_supply_state_code VARCHAR(2),
supply_nature VARCHAR(32), -- INTRA_STATE, INTER_STATE
taxability VARCHAR(32),
is_rcm BOOLEAN DEFAULT FALSE,
is_sez BOOLEAN DEFAULT FALSE,
taxable_amount NUMERIC(20,2),
tax_amount NUMERIC(20,2),
gross_amount NUMERIC(20,2)

-- Line Snapshot fields on ap_document_lines
hsn_sac VARCHAR(16),
tax_category_id UUID,
tax_rate_percent NUMERIC(9,6),
cgst_amount NUMERIC(20,2),
sgst_amount NUMERIC(20,2),
igst_amount NUMERIC(20,2),
utgst_amount NUMERIC(20,2),
cess_amount NUMERIC(20,2),
is_rcm BOOLEAN DEFAULT FALSE,
is_sez BOOLEAN DEFAULT FALSE,
taxable_amount NUMERIC(20,2),
tax_amount NUMERIC(20,2),
gross_amount NUMERIC(20,2)
```

Subsequent modifications to Tax Engine rules or rate master tables will **NEVER** alter posted AP historical tax snapshots.

---

## 13. REVERSAL DEPENDENCY RULES & HISTORICAL AS-OF SEMANTICS

### 13.1 Reversal Dependency Handling Rules

| Reversal Target | Condition | Handling Strategy |
| :--- | :--- | :--- |
| **Allocation Reversal** | Active allocation on `ap_allocations`. | Sets `status = 'REVERSED'`, restores `unapplied_amount` to source, restores `outstanding_amount` to open item. |
| **Payment Reversal** | Has active allocations (`allocated_amount > 0`). | **CASCADE REVERSAL**: Automatically reverses all dependent active `ap_allocations` first, then reverses payment and posts GL reversal entry. |
| **Supplier Bill Reversal** | Has active allocations against open item. | **CASCADE REVERSAL**: Automatically reverses all dependent active `ap_allocations` and write-offs first, then marks bill `REVERSED` and posts GL reversal entry. |
| **Adjustment Reversal** | Posted adjustment on `ap_adjustments`. | Marks `status = 'REVERSED'`, restores open item balance, and posts GL reversal entry. |

### 13.2 Historical As-Of Report Semantics
A reversal occurring on date $D_{\text{reversal}}$ affects historical subledger reporting ONLY for $\text{asOfDate} \ge D_{\text{reversal}}$.
- Reports generated for $\text{asOfDate} < D_{\text{reversal}}$ represent the subledger state as of that date, ignoring subsequent reversals.

---

## 14. AP AGING BUCKETS & SUPPLIER STATEMENTS

### 14.1 Shared Configurable Aging Bucket Model

To maintain consistency across AR and AP financial reporting:
- `CURRENT`: $\text{days overdue} \le 0$ (Not overdue yet)
- `1_30`: $1 \le \text{days overdue} \le 30$
- `31_60`: $31 \le \text{days overdue} \le 60$
- `61_90`: $61 \le \text{days overdue} \le 90$
- `90_PLUS`: $\text{days overdue} > 90$

**Overdue Calculation**:
$$\text{Days Overdue} = \text{max}(0, \text{asOfDate} - \text{due\_date})$$

### 14.2 Supplier Account Statements
Renders chronological transaction activity:
- `openingBalance`: Net outstanding payable at `fromDate - 1`.
- `transactions`: Bills (+), Debit Notes (+), Credit Notes (-), Payments (-), Write-offs (-).
- `runningBalance`: Recomputed sequentially per line.
- `closingBalance`: Final net balance at `toDate`.

---

## 15. DATABASE SCHEMA DESIGN (DDL)

```sql
-- 1. AP Documents Header Table
CREATE TABLE ap_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  supplier_id UUID NOT NULL,
  branch_id UUID REFERENCES branches(id),
  document_type VARCHAR(32) NOT NULL, -- SUPPLIER_BILL, CREDIT_NOTE, DEBIT_NOTE, OPENING_BALANCE
  document_number VARCHAR(64),
  supplier_invoice_number VARCHAR(64),
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
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT', -- DRAFT, POSTED, PARTIALLY_SETTLED, SETTLED, CANCELLED, REVERSED
  source_module VARCHAR(64) NOT NULL DEFAULT 'AP',
  source_document_id VARCHAR(255),
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
  payment_terms_days INT DEFAULT 30,
  remarks TEXT,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_ap_doc_tenant_comp_id UNIQUE (tenant_id, company_id, id),
  CONSTRAINT uq_ap_doc_tenant_comp_num UNIQUE (tenant_id, company_id, document_number),
  CONSTRAINT fk_ap_doc_supplier FOREIGN KEY (tenant_id, company_id, supplier_id) REFERENCES suppliers(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_ap_doc_amounts CHECK (taxable_amount >= 0 AND tax_amount >= 0 AND gross_amount >= 0 AND unapplied_amount >= 0 AND outstanding_amount >= 0)
);

CREATE INDEX idx_ap_docs_lookup ON ap_documents(tenant_id, company_id, supplier_id, status);
CREATE INDEX idx_ap_docs_dates ON ap_documents(tenant_id, company_id, document_date, accounting_date);

-- 2. AP Document Lines Table
CREATE TABLE ap_document_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  ap_document_id UUID NOT NULL,
  line_sequence INT NOT NULL,
  product_id UUID,
  description TEXT NOT NULL,
  hsn_sac VARCHAR(16),
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
  expense_account_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_ap_line_tenant_comp_id UNIQUE (tenant_id, company_id, id),
  CONSTRAINT fk_ap_line_doc FOREIGN KEY (tenant_id, company_id, ap_document_id) REFERENCES ap_documents(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ap_line_product FOREIGN KEY (tenant_id, company_id, product_id) REFERENCES products(tenant_id, company_id, id) ON DELETE RESTRICT
);

-- 3. AP Open Items Table
CREATE TABLE ap_open_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  supplier_id UUID NOT NULL,
  ap_document_id UUID NOT NULL,
  document_type VARCHAR(32) NOT NULL DEFAULT 'SUPPLIER_BILL', -- SUPPLIER_BILL, DEBIT_NOTE, OPENING_BALANCE
  document_number VARCHAR(64) NOT NULL,
  document_date DATE NOT NULL,
  due_date DATE NOT NULL,
  original_amount NUMERIC(20, 2) NOT NULL,
  outstanding_amount NUMERIC(20, 2) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN', -- OPEN, PARTIALLY_SETTLED, SETTLED, CANCELLED
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_ap_open_tenant_comp_id UNIQUE (tenant_id, company_id, id),
  CONSTRAINT fk_ap_open_supplier FOREIGN KEY (tenant_id, company_id, supplier_id) REFERENCES suppliers(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ap_open_doc FOREIGN KEY (tenant_id, company_id, ap_document_id) REFERENCES ap_documents(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_ap_open_outstanding_pos CHECK (outstanding_amount >= 0 AND original_amount > 0)
);

CREATE INDEX idx_ap_open_items_supplier ON ap_open_items(tenant_id, company_id, supplier_id, status);

-- 4. Supplier Payments Table
CREATE TABLE ap_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  supplier_id UUID NOT NULL,
  payment_number VARCHAR(64),
  payment_date DATE NOT NULL,
  accounting_date DATE NOT NULL,
  payment_mode VARCHAR(32) NOT NULL, -- CASH, BANK_TRANSFER, CHEQUE, UPI, OTHER
  bank_account_id UUID NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  total_amount NUMERIC(20, 2) NOT NULL,
  allocated_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  unapplied_amount NUMERIC(20, 2) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'POSTED', -- DRAFT, POSTED, REVERSED
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
  reference_number VARCHAR(64),
  remarks TEXT,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_ap_payment_tenant_comp_id UNIQUE (tenant_id, company_id, id),
  CONSTRAINT uq_ap_payment_tenant_comp_num UNIQUE (tenant_id, company_id, payment_number),
  CONSTRAINT fk_ap_payment_supplier FOREIGN KEY (tenant_id, company_id, supplier_id) REFERENCES suppliers(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ap_payment_bank_acc FOREIGN KEY (tenant_id, company_id, bank_account_id) REFERENCES chart_of_accounts(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_ap_payment_amounts CHECK (total_amount > 0 AND unapplied_amount >= 0 AND allocated_amount >= 0)
);

-- 5. AP Allocations Table
CREATE TABLE ap_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  allocation_number VARCHAR(64),
  allocation_source_type VARCHAR(32) NOT NULL, -- PAYMENT, CREDIT_NOTE
  payment_id UUID,
  credit_note_id UUID,
  open_item_id UUID NOT NULL,
  allocated_amount NUMERIC(20, 2) NOT NULL,
  discount_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  allocation_date DATE NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, REVERSED
  reversed_at TIMESTAMPTZ,
  reversed_by VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_ap_alloc_tenant_comp_id UNIQUE (tenant_id, company_id, id),
  CONSTRAINT fk_ap_alloc_payment FOREIGN KEY (tenant_id, company_id, payment_id) REFERENCES ap_payments(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ap_alloc_credit_note FOREIGN KEY (tenant_id, company_id, credit_note_id) REFERENCES ap_documents(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ap_alloc_open_item FOREIGN KEY (tenant_id, company_id, open_item_id) REFERENCES ap_open_items(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_ap_alloc_source_exclusivity CHECK (
    (allocation_source_type = 'PAYMENT' AND payment_id IS NOT NULL AND credit_note_id IS NULL) OR
    (allocation_source_type = 'CREDIT_NOTE' AND credit_note_id IS NOT NULL AND payment_id IS NULL)
  ),
  CONSTRAINT chk_ap_alloc_amounts CHECK (allocated_amount > 0 AND discount_amount >= 0)
);

-- 6. AP Adjustments Table
CREATE TABLE ap_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  adjustment_number VARCHAR(64),
  supplier_id UUID NOT NULL,
  open_item_id UUID NOT NULL,
  adjustment_type VARCHAR(32) NOT NULL, -- WRITE_OFF, CREDIT_ADJUSTMENT, DEBIT_ADJUSTMENT
  amount NUMERIC(20, 2) NOT NULL,
  adjustment_date DATE NOT NULL,
  accounting_date DATE NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'POSTED', -- DRAFT, POSTED, REVERSED
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
  reversed_at TIMESTAMPTZ,
  reversed_by VARCHAR(64),
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_ap_adj_tenant_comp_id UNIQUE (tenant_id, company_id, id),
  CONSTRAINT fk_ap_adj_supplier FOREIGN KEY (tenant_id, company_id, supplier_id) REFERENCES suppliers(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ap_adj_open_item FOREIGN KEY (tenant_id, company_id, open_item_id) REFERENCES ap_open_items(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_ap_adj_amount CHECK (amount > 0)
);
```

---

## 16. AP SUBLEDGER TO GL RECONCILIATION FORMULA

Subledger reconciliation asserts that AP open item liabilities and unapplied credits match GL control account balances:

$$\text{Net Subledger Payable} = \sum \text{ap\_open\_items.outstanding\_amount} - \sum \text{ap\_payments.unapplied\_amount} - \sum \text{credit\_notes.unapplied\_amount}$$

$$\text{GL AP Control Balance} = \text{Balance of Account mapped to 'AP\_CONTROL' in COA}$$

$$\text{Reconciliation Difference} = |\text{Net Subledger Payable} - \text{GL AP Control Balance}|$$

- **Status PASS**: $\text{Reconciliation Difference} == 0.00$.
- **Status FAIL**: $\text{Reconciliation Difference} > 0.00$ (Generates explicit audit exception details).

---

## 17. STRICT SUBPHASE BREAKDOWN & GATES

Phase 2.7 is divided into 10 strictly gated subphases:

```text
Phase 2.7.0 — AP Database Foundation & Schema Migration (COMPLETED)
      ↓
Phase 2.7.1 — AP Document & Supplier Payable Lifecycle
      ↓
Phase 2.7.2 — AP Posted Immutability & Financial Integrity
      ↓
Phase 2.7.3 — Supplier Payments & Unapplied Cash
      ↓
Phase 2.7.4 — AP Polymorphic Allocation Engine
      ↓
Phase 2.7.5 — AP Settlement & Subledger Reconciliation Engine
      ↓
Phase 2.7.6 — AP Adjustments & Write-offs
      ↓
Phase 2.7.7 — AP Aging & Supplier Statements
      ↓
Phase 2.7.8 — AP REST API & External Interface
      ↓
Phase 2.7.9 — AP Final Verification & Performance Hardening
```

---

## 18. MASTER PLAN APPROVAL CHECKLIST

| Architectural Concern | Initial Review Status | Final Master Plan Status | Correction Detail |
| :--- | :--- | :--- | :--- |
| **Tenant + Company Ownership** | Draft Ambiguity | **FIXED** | Enforced composite foreign keys `(tenant_id, company_id, entity_id)` across all 6 AP tables. |
| **Financial Immutability & DELETE Rules** | `ON DELETE CASCADE` present | **FIXED** | Replaced with `ON DELETE RESTRICT` for all financial relationships; defined table-by-table deletion policy. |
| **Separation of Payment Posting & Allocation** | Contradictory wording | **FIXED** | Decoupled into 2 explicit domain operations (`postPayment` leaves unapplied; `allocate` consumes unapplied). |
| **Database-Authoritative Concurrency** | Inconsistent locking order | **FIXED** | Single PostgreSQL lock ordering strategy (`FOR UPDATE` on open items in ascending UUID order first, then credit source). |
| **Adjustment Accounting Semantics** | Hard-coded roles | **FIXED** | Explicitly defined line roles (`WRITE_OFF_GAIN`, `PURCHASE_ADJUSTMENT`, `AP_CONTROL`) posted via `AccountingCore`. |
| **Credit Note Eligibility Invariants** | Unclear constraints | **FIXED** | Enforced 6 eligibility checks including `document_type === 'CREDIT_NOTE'` and same supplier/tenant/company. |
| **Reversal Dependency Handling** | Undefined active allocation handling | **FIXED** | Defined cascade allocation reversal rules for bill/payment reversals; defined historical as-of reversal rules. |
| **Discount Modeling** | Ambiguous formula | **FIXED** | Fully modeled prompt payment purchase discount on `ap_allocations.discount_amount` with `PURCHASE_DISCOUNT_INCOME` GL line. |
| **Aging Buckets & Polarity** | Inconsistent bucket names | **FIXED** | Aligned with shared ERP aging buckets (`CURRENT`, `1_30`, `31_60`, `61_90`, `90_PLUS`). |
| **Subphase Breakdown & Stop Gates** | Intact | **PASS** | Retained 10 strictly gated subphases (2.7.0 through 2.7.9). |

---

## 19. FINAL STATUS CONCLUSION

```text
PHASE 2.7 ARCHITECTURE PLANNING: COMPLETE
PHASE 2.7 MASTER PLAN STATUS: FINAL & IMPLEMENTATION READY
PHASE 2.7 APPROVAL: REQUIRED
PHASE 2.7.1 IMPLEMENTATION: NOT STARTED
EXECUTION STOPPED
```
