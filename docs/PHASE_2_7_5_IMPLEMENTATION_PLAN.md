# PHASE 2.7.5 — AP SETTLEMENT & SUBLEDGER RECONCILIATION ENGINE
## MASTER IMPLEMENTATION PLAN

---

## 1. EXECUTIVE SUMMARY

Phase 2.7.5 establishes the **Accounts Payable (AP) Settlement & Subledger Reconciliation Engine**. This subphase introduces a derived, read-only analytics and reconciliation layer built directly upon the authoritative AP transaction entities established in Phases 2.7.0–2.7.4:
- `ap_documents` & `ap_document_lines` (Supplier Bills, Credit Notes, Debit Notes, Opening Balances)
- `ap_open_items` (Payable Open Items)
- `ap_payments` (Supplier Payments & Cash Disbursements)
- `ap_allocations` (Polymorphic Payment & Credit Note Allocations)
- `journal_entries` & `journal_lines` (Authoritative GL Postings)

### Primary Architectural Principle
**Phase 2.7.5 is strictly read-only and derived.** It introduces zero duplicate source-of-truth tables, zero mutable settlement state columns, and zero standalone financial transactions. Settlement status (`OPEN`, `PARTIALLY_SETTLED`, `SETTLED`), source utilization (`FULLY_UNAPPLIED`, `PARTIALLY_APPLIED`, `FULLY_APPLIED`), supplier-level net payables (signed exact decimal), and GL reconciliation differences are calculated dynamically on demand using exact decimal arithmetic.

---

## 2. EXISTING ARCHITECTURE REUSE

Phase 2.7.5 reuses established core and finance platform capabilities:

| Platform / Core Component | Reuse Mechanism |
| :--- | :--- |
| **AR Settlement Architecture (Phase 2.6.5)** | Reuses equivalent read-only projection design, DTO structure, signed balance reconciliation diagnostics, and randomized property testing patterns. |
| **ExactDecimal (`@general-erp/core`)** | Enforces exact 2-decimal signed arithmetic across all subledger subtotals, GL comparisons, and reconciliation variance calculations. |
| **GLEngine & AccountingCoreService** | Source of authoritative GL account balances for `AP_CONTROL` signed comparison via `getAccountBalance` / `getHistoricalAccountBalance`. |
| **AuthorizationService & RequestContext** | Contextual multi-tenant enforcement (`tenantId`, `companyId`) and RBAC authorization guards (`ap:settlement:read`, `ap:reconcile:read`). |
| **AP Authoritative Domain Services** | Consumes `apDocumentService`, `apPaymentService`, and `apAllocationService` for state retrieval. |

---

## 3. SOURCE OF TRUTH (AUTHORITATIVE VS DERIVED)

### 3.1 Authoritative Entities (System of Record)
The following tables are the exclusive source of financial truth:
1. `ap_documents`: Posted supplier bills, credit notes, debit notes, and opening balances.
2. `ap_open_items`: Outstanding credit open items (`original_amount`, `outstanding_amount`, `status`).
3. `ap_payments`: Posted supplier payments (`total_amount`, `allocated_amount`, `unapplied_amount`, `status`).
4. `ap_allocations`: Active polymorphic application links (`allocated_amount`, `discount_amount`, `status`).
5. `journal_entries` / `journal_lines`: Posted General Ledger journals.

### 3.2 Derived Projections (Read-Only Outputs)
The following metrics are dynamically calculated and never persisted as redundant database state:
- Open Item Settlement Status (`OPEN`, `PARTIALLY_SETTLED`, `SETTLED`).
- Source Utilization Status (`FULLY_UNAPPLIED`, `PARTIALLY_APPLIED`, `FULLY_APPLIED`).
- Supplier Net Payable Exposure & Subledger Summaries (Signed Exact Decimal).
- AP Subledger Signed Control Balance vs GL `AP_CONTROL` Signed Balance.
- Reconciliation Status (`PASS`, `FAIL`) and Diagnostic Mismatch Vectors.
- Historical As-Of Settlement Snapshots.

---

## 4. HISTORICAL FINANCIAL EFFECTIVE DATE MODEL

To eliminate ambiguity across reports, Phase 2.7.5 establishes an explicit distinction between financial accounting dates and database audit timestamps:

### 4.1 Field Definitions & Financial Roles

| Field Name | Type | Purpose / Financial Scope |
| :--- | :--- | :--- |
| `accounting_date` | SQL DATE (`YYYY-MM-DD`) | **PRIMARY FINANCIAL EFFECTIVE DATE** for all financial transactions (Supplier Bills, Credit Notes, Debit Notes, Opening Balances, Supplier Payments, GL Journals). Dictates fiscal period inclusion and historical cutoff. Validated via `FiscalPeriodService`. |
| `allocation_date` | SQL DATE (`YYYY-MM-DD`) | **FINANCIAL EFFECTIVE DATE FOR ALLOCATIONS**. Dictates when a payment or credit note allocation becomes financially effective against an open item. |
| `reversal_accounting_date` | SQL DATE (`YYYY-MM-DD`) | **EXPLICIT FINANCIAL EFFECTIVE DATE FOR REVERSALS**. An explicit SQL DATE supplied during reversal operations, validated via `FiscalPeriodService` against an open fiscal period. Dictates when a reversal takes financial effect. Must **NOT** be derived from `reversed_at`. |
| `document_date` | SQL DATE (`YYYY-MM-DD`) | **BUSINESS DOCUMENT DATE** (Vendor invoice date). Used for vendor reference and payment due date calculation. Does **NOT** determine financial posting or cutoff. |
| `created_at` / `reversed_at` | TIMESTAMPTZ | **TECHNICAL & AUDIT TIMESTAMPS**. Audit timestamps recording physical database write times. Do **NOT** determine financial reporting inclusion or historical boundaries. |

### 4.2 Single Rule of Inclusion
An entity or event is included in a financial calculation for `asOfDate` if and only if its primary financial effective date is less than or equal to `asOfDate`:
- **Document / Payment**: `accounting_date <= asOfDate`
- **Allocation**: `allocation_date <= asOfDate`
- **Reversal Event**: `reversal_accounting_date <= asOfDate`

---

## 5. CURRENT VS HISTORICAL CALCULATION MODEL

Phase 2.7.5 explicitly decouples **Live Mode** from **Historical Mode**:

```text
                               ┌──────────────────────────────────────────────┐
                               │             AP SETTLEMENT ENGINE             │
                               └──────────────────────┬───────────────────────┘
                                                      │
                       ┌──────────────────────────────┴──────────────────────────────┐
                       ▼                                                             ▼
         ┌──────────────────────────┐                                  ┌──────────────────────────┐
         │        LIVE MODE         │                                  │     HISTORICAL MODE      │
         │   (Current Real-Time)    │                                  │   (Point-in-Time As-Of)  │
         └─────────────┬────────────┘                                  └─────────────┬────────────┘
                       │                                                             │
 ┌─────────────────────┴─────────────────────┐                 ┌─────────────────────┴─────────────────────┐
 │ • Reads current DB column values          │                 │ • Ignores current DB column values        │
 │ • Uses open_item.outstanding_amount       │                 │ • Reconstructs balances dynamically       │
 │ • Uses payment.unapplied_amount           │                 │ • Filter: accounting_date <= asOfDate     │
 │ • Filter: status = 'ACTIVE' / 'POSTED'    │                 │ • Filter: allocation_date <= asOfDate     │
 │ • Fast, single-row/summary lookup         │                 │ • Reverses status based on reversal_date  │
 └───────────────────────────────────────────┘                 └───────────────────────────────────────────┘
```

### 5.1 Live Mode (Real-Time State)
- Reads current authoritative table columns (`ap_open_items.outstanding_amount`, `ap_payments.unapplied_amount`, `ap_documents.unapplied_amount`).
- Filters `ap_allocations.status = 'ACTIVE'`, `ap_payments.status = 'POSTED'`, `ap_documents.status = 'POSTED'`.
- Used for daily operational views, quick lookups, and immediate cash application validation.

### 5.2 Historical Mode (Point-in-Time As-Of State)
- **Ignores current stored balances** (`outstanding_amount`, `unapplied_amount`, current `status`).
- Reconstructs balances dynamically from original transactions and effective-dated events:
  $$\text{Historical Outstanding}(i, t) = \text{Original}(i) - \sum_{a \in \text{Alloc}(i, t)} \text{allocated\_amount}(a) - \sum_{a \in \text{Alloc}(i, t)} \text{discount\_amount}(a)$$
  $$\text{Historical Payment Unapplied}(p, t) = \text{Total}(p) - \sum_{a \in \text{SourceAlloc}(p, t)} \text{allocated\_amount}(a)$$
- Where $t = \text{asOfDate}$. An allocation $a$ belongs to $\text{Alloc}(i, t)$ if:
  1. `allocation_date(a) <= t`
  2. `a` was NOT reversed on or before $t$ (`reversal_accounting_date(a) > t` OR `reversal_accounting_date(a) IS NULL`).

---

## 6. REVERSAL EFFECTIVE-DATE MODEL

Reversal events are append-only state changes with explicit financial accounting dates.

### 6.1 Reversal Date Fields Separation
For `ap_documents`, `ap_payments`, and `ap_allocations`:
- `reversalAccountingDate`: Explicit SQL Date string (`YYYY-MM-DD`) passed in reversal payload and validated via `FiscalPeriodService`. This is the **authoritative financial cutoff** for historical reporting.
- `reversedAt`: Technical audit timestamp (`TIMESTAMPTZ`) recording physical execution. Used for audit logging only.

### 6.2 Point-in-Time Reversal Evaluation Rules
For a given `asOfDate` ($t$) and a reversed entity with explicit reversal accounting date $D_{\text{rev}}$:

$$\text{Financial Inclusion State}(t) = \begin{cases}
\text{EFFECTIVE / ACTIVE} & \text{if } t < D_{\text{rev}} \\
\text{REVERSED / EXCLUDED} & \text{if } t \ge D_{\text{rev}}
\end{cases}$$

#### Worked Examples:
1. **Payment Reversal**: Payment ₹10,000 posted on 2025-04-05 (`accounting_date = '2025-04-05'`). Reversed on 2025-05-01 (`reversalAccountingDate = '2025-05-01'`).
   - `asOfDate = 2025-04-15`: Payment is **POSTED** and participates in unapplied cash (₹10,000).
   - `asOfDate = 2025-05-02`: Payment is **REVERSED** and yields ₹0.00 cash contribution.
2. **Allocation Reversal**: Allocation ₹4,000 created on 2025-04-10 (`allocation_date = '2025-04-10'`). Reversed on 2025-05-01 (`reversalAccountingDate = '2025-05-01'`).
   - `asOfDate = 2025-04-15`: Allocation is **ACTIVE**. Bill outstanding = ₹6,000.
   - `asOfDate = 2025-05-02`: Allocation is **REVERSED**. Bill outstanding restored to ₹10,000.

---

## 7. DOCUMENT & PAYMENT HISTORICAL STATE

### 7.1 Document Historical State Rules (`SUPPLIER_BILL`, `DEBIT_NOTE`, `CREDIT_NOTE`, `OPENING_BALANCE`)
A document contributes to historical settlement for `asOfDate` ($t$) if:
1. `document.accounting_date <= t`
2. `document` was NOT reversed on or before $t$ (`reversalAccountingDate > t` OR `reversalAccountingDate IS NULL`).

*Crucial Boundary Rule*: A document dated `document_date = '2025-04-01'` but posted with `accounting_date = '2025-04-15'` MUST NOT participate in an `asOfDate = 2025-04-10` report. `accounting_date` is the sole financial boundary.

### 7.2 Payment Historical State Rules
A payment contributes to historical settlement for `asOfDate` ($t$) if:
1. `payment.accounting_date <= t`
2. `payment` was NOT reversed on or before $t$ (`reversalAccountingDate > t` OR `reversalAccountingDate IS NULL`).

### 7.3 Opening Balance Rules
Opening balance documents (`document_type = 'OPENING_BALANCE'`):
- Carry `accounting_date` equal to the fiscal year start date (e.g. `'2025-04-01'`).
- Post to GL `AP_CONTROL` on their `accounting_date`.
- Included in subledger reports for any `asOfDate >= opening_balance.accounting_date`.

---

## 8. SETTLEMENT MODEL

Settlement status is derived for each credit open item (`SUPPLIER_BILL`, `DEBIT_NOTE`, `OPENING_BALANCE`).

### 8.1 Master Settlement Formula
$$\text{Outstanding Amount}(i) = \text{Original Amount}(i) - \text{Active Allocations}(i) - \text{Active WriteOffs}(i) - \text{Active CreditAdjustments}(i) - \text{Active Discounts}(i) + \text{Active DebitAdjustments}(i)$$

### 8.2 Phase 2.7.5 Formula Scope
For Phase 2.7.5 (prior to Phase 2.7.6 adjustments), only active allocations and active prompt payment discounts participate:
$$\text{Outstanding Amount}(i) = \text{Original Amount}(i) - \sum_{a \in \text{Alloc}(i)} \text{allocated\_amount}(a) - \sum_{a \in \text{Alloc}(i)} \text{discount\_amount}(a)$$

### 8.3 Settlement Status Classification
$$\text{Settlement Status}(i) = \begin{cases}
\text{OPEN} & \text{if } \text{Outstanding}(i) = \text{Original}(i) \\
\text{SETTLED} & \text{if } \text{Outstanding}(i) = 0.00 \\
\text{PARTIALLY\_SETTLED} & \text{if } 0.00 < \text{Outstanding}(i) < \text{Original}(i)
\end{cases}$$

---

## 9. SOURCE UTILIZATION

Source utilization tracks how DEBIT allocation sources (Supplier Payments and Supplier Credit Notes) have been applied against payables.

### 9.1 Live vs Historical Utilization Calculation

#### Live Utilization Mode:
Derived from stored `allocated_amount` and `unapplied_amount` on `ap_payments` or `ap_documents`.

#### Historical Utilization Mode (`asOfDate` = $t$):
Calculates historical allocated and unapplied amounts strictly from effective allocations:
$$\text{Historical Allocated}(s, t) = \sum_{a \in \text{SourceAlloc}(s, t)} \text{allocated\_amount}(a)$$
$$\text{Historical Unapplied}(s, t) = \text{Total Amount}(s) - \text{Historical Allocated}(s, t)$$

### 9.2 Source Utilization Classification
$$\text{Source Utilization Status}(s, t) = \begin{cases}
\text{FULLY\_UNAPPLIED} & \text{if } \text{Historical Allocated}(s, t) = 0.00 \\
\text{FULLY\_APPLIED} & \text{if } \text{Historical Unapplied}(s, t) = 0.00 \\
\text{PARTIALLY\_APPLIED} & \text{if } 0.00 < \text{Historical Allocated}(s, t) < \text{Total Amount}(s)
\end{cases}$$

---

## 10. SUPPLIER AGGREGATION & SIGNED NET PAYABLE SEMANTICS

Supplier settlement aggregation calculates total vendor exposure for a given supplier within a company:

### 10.1 Metric Categorization & Double-Count Protection

To prevent ambiguity, metrics in `SupplierSettlementSummaryDTO` are categorized explicitly:

| Metric Name | Category | Calculation Method | Role in Net Payable |
| :--- | :--- | :--- | :--- |
| `totalPostedBillsAmount` | **Informational Transaction Total** | Sum of `original_amount` of all posted bills | **Excluded** (avoid double counting) |
| `totalPaymentsAmount` | **Informational Transaction Total** | Sum of `total_amount` of all posted payments | **Excluded** (avoid double counting) |
| `totalCreditNotesAmount` | **Informational Transaction Total** | Sum of `gross_amount` of all posted credit notes | **Excluded** (avoid double counting) |
| `totalOutstandingBillsAmount` | **Open-Item Balance** | Sum of open item `outstanding_amount` | **Included (+)** |
| `totalUnappliedPaymentsAmount` | **Source Balance** | Sum of payment `unapplied_amount` | **Included (-)** |
| `totalUnappliedCreditNotesAmount` | **Source Balance** | Sum of credit note `unapplied_amount` | **Included (-)** |
| `totalActiveAllocationsAmount` | **Allocation Detail** | Sum of `allocated_amount` on active allocations | **Informational Detail** |
| `totalPromptPaymentDiscountsAmount` | **Allocation Detail** | Sum of `discount_amount` on active allocations | **Informational Detail** |
| `netPayableAmount` | **Signed Authoritative Net Balance** | $\text{Outstanding Bills} - \text{Unapplied Payments} - \text{Unapplied Credit Notes}$ | **SIGNED AUTHORITATIVE TOTAL** |

### 10.2 Signed Net Payable Interpretation
`netPayableAmount` is an exact-decimal signed value:
- `netPayableAmount > 0.00`: Net liability (amount owed by company to supplier).
- `netPayableAmount = 0.00`: Balanced account (zero net exposure).
- `netPayableAmount < 0.00`: Net supplier-side credit or advance (unapplied cash payments or credit notes exceed open bills). The value is **NEVER** clamped to zero when negative.

---

## 11. RECONCILIATION MODEL & SIGNED BALANCE CONVENTIONS

Reconciliation asserts that the AP Subledger net payables balance exactly equals the General Ledger `AP_CONTROL` account signed balance as of the same financial cutoff.

### 11.1 Signed Balance & Polarity Conventions
In standard double-entry accounting:
- Supplier Liabilities (`AP_CONTROL`) carry a **CREDIT** normal balance.
- **`GL AP_CONTROL Signed Balance`** is calculated as:
  $$\text{GL AP\_CONTROL Signed Balance} = \text{Total Credits} - \text{Total Debits}$$
  - Positive value ($> 0.00$): Net Credit balance (liability owed to vendors).
  - Zero ($= 0.00$): Fully balanced.
  - Negative value ($< 0.00$): Net Debit balance (advance cash payments or unapplied credit notes exceed liabilities).

### 11.2 Historical GL Cutoff Semantics
$$\text{GL AP\_CONTROL Signed Balance}(asOfDate) = \sum_{j \le asOfDate} \text{Credits}(j) - \sum_{j \le asOfDate} \text{Debits}(j)$$
where $j$ represents journal entries with `accounting_date <= asOfDate` and `reversalAccountingDate > asOfDate` (or not reversed).

### 11.3 Signed Reconciliation Formula
$$\text{Subledger Net Payable}(t) = \sum \text{Historical Outstanding}(i, t) - \sum \text{Historical Payment Unapplied}(p, t) - \sum \text{Historical CN Unapplied}(cn, t)$$
$$\text{Reconciliation Difference}(t) = \text{Subledger Net Payable}(t) - \text{GL AP\_CONTROL Signed Balance}(t)$$

### 11.4 Reconciliation Status
$$\text{Status} = \begin{cases}
\text{PASS} & \text{if ExactDecimal.parse(Difference).isZero()} \\
\text{FAIL} & \text{if !ExactDecimal.parse(Difference).isZero()}
\end{cases}$$

### 11.5 Worked Signed Reconciliation Example (Supplier Credit Note)
- **Scenario**: Company receives Supplier Credit Note for ₹2,000 on 2025-04-10 (`accounting_date = '2025-04-10'`). No bills exist.
- **GL Posting**: **DR** `AP_CONTROL` ₹2,000, **CR** `PURCHASE_REVERSAL` ₹2,000.
  - $\text{GL AP\_CONTROL Signed Balance} = \text{Credits} - \text{Debits} = 0.00 - 2,000.00 = -2,000.00$.
- **Subledger State**:
  - Open Items Outstanding = ₹0.00
  - Unapplied Payments = ₹0.00
  - Unapplied Credit Notes = ₹2,000.00
  - $\text{Subledger Net Payable} = 0.00 - 0.00 - 2,000.00 = -2,000.00$.
- **Reconciliation Check**:
  $$\text{Difference} = (-2,000.00) - (-2,000.00) = 0.00$$
  $$\text{Reconciliation Status} = \text{PASS}$$

---

## 12. AP_CONTROL METHODOLOGY & DOUBLE-COUNT PREVENTION

### 12.1 Liability Movements in GL
- **Increases (+ Liability / CR AP_CONTROL)**: Posted Supplier Bills, Debit Notes, Opening Balances.
- **Decreases (- Liability / DR AP_CONTROL)**: Posted Supplier Credit Notes, Supplier Payments (Cash Disbursements), Prompt Payment Discounts (Allocations).

### 12.2 Mathematical Proof of Non-Duplication
When a Payment of ₹10,000 is posted, the GL immediately posts **DR** `AP_CONTROL` ₹10,000.
At this moment:
- Subledger Outstanding Bills = ₹10,000
- Subledger Unapplied Payments = ₹10,000
- $\text{Net Subledger Liability} = 10,000 - 10,000 = ₹0.00$. GL Signed Balance = ₹0.00. **Reconciliation = PASS**.

When the payment is allocated ₹10,000 against the bill:
- Subledger Outstanding Bills becomes ₹0.00.
- Subledger Unapplied Payments becomes ₹0.00.
- $\text{Net Subledger Liability} = 0.00 - 0.00 = ₹0.00$.

$$\Delta \text{Outstanding} = - \text{allocated\_amount}$$
$$\Delta \text{Unapplied} = - \text{allocated\_amount}$$
$$\Delta \text{Net Subledger} = \Delta \text{Outstanding} - \Delta \text{Unapplied} = (-\text{allocated\_amount}) - (-\text{allocated\_amount}) = 0.00$$

Allocation changes subledger classification (linking cash to a specific bill), but leaves net subledger liability invariant. Therefore, allocations MUST NOT be subtracted from subledger totals during GL reconciliation.

---

## 13. READ SNAPSHOT & TRANSACTION ISOLATION STRATEGY

To guarantee consistent settlement and reconciliation outputs across multi-query operations under concurrent system activity:

### 13.1 PostgreSQL Isolation Strategy
- **Transaction Isolation Level**: `REPEATABLE READ` for multi-query reconciliation operations.
- **Read-Only Transaction Flag**: `BEGIN READ ONLY;` / `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;`.
- **Non-Blocking Guarantee**: Settlement and reconciliation queries do **NOT** acquire `FOR UPDATE` row locks. Concurrent allocation or payment posting transactions are never blocked.
- **Single Snapshot Integrity**: All subledger queries (open items, payments, credit notes, allocations) and GL query execute within the same database transaction snapshot, eliminating phantom reads or inconsistent mixed-state totals between queries.

---

## 14. READ MODELS & SIGNED DTO INTERFACES

Phase 2.7.5 defines 5 immutable DTO interfaces in `apps/api/src/modules/finance/ap/ap-settlement-model.ts`:

### 14.1 `ApOpenItemSettlementDTO`
```typescript
export type ApOpenItemSettlementStatus = 'OPEN' | 'PARTIALLY_SETTLED' | 'SETTLED';

export interface ApOpenItemSettlementDTO {
  openItemId: string;
  tenantId: string;
  companyId: string;
  supplierId: string;
  apDocumentId: string;
  documentNumber: string;
  documentType: string;
  documentDate: string;
  accountingDate: string;
  dueDate: string;
  originalAmount: string;
  activeAllocationsTotal: string;
  activeDiscountsTotal: string;
  outstandingAmount: string;
  settlementStatus: ApOpenItemSettlementStatus;
  asOfDate?: string | null | undefined;
}
```

### 14.2 `ApSourceUtilizationDTO`
```typescript
export type ApSourceUtilizationType = 'PAYMENT' | 'CREDIT_NOTE';
export type ApSourceUtilizationStatus = 'FULLY_UNAPPLIED' | 'PARTIALLY_APPLIED' | 'FULLY_APPLIED';

export interface ApSourceUtilizationDTO {
  sourceId: string;
  sourceType: ApSourceUtilizationType;
  tenantId: string;
  companyId: string;
  supplierId: string;
  sourceNumber: string;
  sourceDate: string;
  accountingDate: string;
  totalAmount: string;
  allocatedAmount: string;
  unappliedAmount: string;
  utilizationStatus: ApSourceUtilizationStatus;
  asOfDate?: string | null | undefined;
}
```

### 14.3 `SupplierSettlementSummaryDTO`
```typescript
export interface SupplierSettlementSummaryDTO {
  tenantId: string;
  companyId: string;
  supplierId: string;
  supplierName: string;
  totalPostedBillsAmount: string;
  totalOutstandingBillsAmount: string;
  openItemsCount: number;
  totalPaymentsAmount: string;
  totalUnappliedPaymentsAmount: string;
  totalCreditNotesAmount: string;
  totalUnappliedCreditNotesAmount: string;
  totalActiveAllocationsAmount: string;
  totalPromptPaymentDiscountsAmount: string;
  /** Signed ExactDecimal: > 0 = Net Payable, < 0 = Supplier Credit / Advance */
  netPayableAmount: string;
  asOfDate?: string | null | undefined;
}
```

### 14.4 `ApReconciliationResultDTO`
```typescript
export type ApReconciliationStatus = 'PASS' | 'FAIL';

export interface ApReconciliationResultDTO {
  companyId: string;
  tenantId: string;
  asOfDate: string;
  reconciliationStatus: ApReconciliationStatus;
  subledgerOutstandingOpenItemsTotal: string;
  subledgerUnappliedPaymentsTotal: string;
  subledgerUnappliedCreditNotesTotal: string;
  /** Signed ExactDecimal */
  netSubledgerPayableTotal: string;
  /** Signed ExactDecimal: Credits - Debits */
  glApControlBalance: string;
  /** Signed ExactDecimal: Subledger Net Payable - GL AP_CONTROL Balance */
  reconciliationDifference: string;
  diagnostics: ApReconciliationDiagnosticDTO[];
  reconciledAt: Date;
}
```

### 14.5 `ApReconciliationDiagnosticDTO`
```typescript
export interface ApReconciliationDiagnosticDTO {
  code: 'SOURCE_BALANCE_MISMATCH' | 'OPEN_ITEM_BALANCE_MISMATCH' | 'UNMAPPED_GL_CONTROL_ACCOUNT' | 'SUBLEDGER_GL_DISCREPANCY';
  severity: 'WARNING' | 'ERROR';
  message: string;
  details?: Record<string, any> | undefined;
}
```

---

## 15. SERVICE BOUNDARY

Phase 2.7.5 defines two domain application services in `apps/api/src/modules/finance/ap/`:
1. `ApSettlementService` (`ap-settlement.service.ts`):
   - `getOpenItemSettlement(ctx, openItemId, asOfDate?)`: Evaluates open item derived settlement state.
   - `getSourceUtilization(ctx, sourceType, sourceId, asOfDate?)`: Evaluates payment/credit-note source utilization state.
   - `getSupplierSettlementSummary(ctx, companyId, supplierId, asOfDate?)`: Computes vendor aggregate payables summary.
2. `ApReconciliationService` (`ap-reconciliation.service.ts`):
   - `reconcileCompanyAP(ctx, companyId, asOfDate?)`: Reconciles AP subledger vs GL `AP_CONTROL` account signed balance and outputs diagnostic vectors.

---

## 16. TENANT / COMPANY ISOLATION

Multi-tenant and company boundaries are non-negotiable:
- Every query filter, in-memory iteration, and database SQL clause MUST include `tenant_id = ctx.tenantId` and `company_id = companyId`.
- `ApSettlementValidator` validates `companyId` and `supplierId` input parameters.
- Cross-tenant or cross-company context mismatch immediately throws `ForbiddenError` or `ValidationError`.

---

## 17. INDEX REQUIREMENTS

```sql
-- 1. Open items lookup by tenant, company, supplier, and status
CREATE INDEX idx_ap_open_items_tenant_comp_supp_status 
ON ap_open_items (tenant_id, company_id, supplier_id, status);

-- 2. Payments lookup by tenant, company, supplier, and status
CREATE INDEX idx_ap_payments_tenant_comp_supp_status 
ON ap_payments (tenant_id, company_id, supplier_id, status);

-- 3. Credit Notes lookup by tenant, company, supplier, document_type, and status
CREATE INDEX idx_ap_docs_tenant_comp_supp_type_status 
ON ap_documents (tenant_id, company_id, supplier_id, document_type, status);

-- 4. Allocations lookup by open_item_id and status
CREATE INDEX idx_ap_alloc_tenant_comp_open_status 
ON ap_allocations (tenant_id, company_id, open_item_id, status);

-- 5. Allocations lookup by payment_id / credit_note_id and status
CREATE INDEX idx_ap_alloc_tenant_comp_source_status 
ON ap_allocations (tenant_id, company_id, payment_id, credit_note_id, status);
```

---

## 18. PERFORMANCE

- **Subledger Summaries**: Target execution time $< 50\text{ ms}$ for standard single-supplier queries.
- **Full Company Reconciliation**: Streamed or SQL-aggregated queries avoiding full-table in-memory node loading. Target execution time $< 200\text{ ms}$ for 10,000 open items.
- **Read Snapshot Strategy**: Benchmarked under `REPEATABLE READ` snapshot isolation.

---

## 19. CONCURRENCY TEST DESIGN

Testing concurrency is separated into two categories:
1. **Financial Mutation Concurrency**: Tested in 2.7.3 & 2.7.4 (100 concurrent allocations against row locks).
2. **Read Snapshot Consistency Concurrency**:
   - Start a read transaction (`REPEATABLE READ`) for reconciliation reporting.
   - Concurrently execute 50 financial mutations (payments, allocations, reversals).
   - Assert that the reconciliation engine sees a 100% consistent point-in-time snapshot without mixed-state totals or partial reads, and without blocking mutating workers.

---

## 20. TEST STRATEGY & TEST MATRIX

Dedicated test suite `apps/api/test/phase2_7_5_settlement.test.ts`:

### 20.1 Test Categories & Matrix
1. **Historical As-Of Cutoff & Reversal Accounting Date Tests**:
   - Invoice posted before as-of vs after as-of.
   - Invoice reversal with explicit `reversalAccountingDate` after as-of date (assert active before reversal date, excluded after).
   - Payment posted before as-of vs after as-of.
   - Payment reversal with explicit `reversalAccountingDate` (assert unapplied cash available before reversal date, zero after).
   - Allocation before as-of vs after as-of.
   - Allocation reversal with explicit `reversalAccountingDate` (assert allocation active before reversal date, restored after).
   - Credit note posted before/after as-of date.
2. **Signed Balance & Polarity Tests**:
   - Supplier Credit Note reconciliation (assert signed GL balance = -2,000.00, subledger = -2,000.00, difference = 0.00, status = PASS).
   - Advance payment exceeding open bills (assert signed `netPayableAmount` is negative, not clamped to zero).
3. **Read Snapshot Consistency Tests**:
   - Concurrent mutations executing during settlement and reconciliation queries.
4. **GL Reconciliation Tests**:
   - Live subledger vs Live GL `AP_CONTROL` signed balance.
   - Historical subledger vs Historical GL `AP_CONTROL` signed balance at specific historical cutoff dates.
   - Intentional GL mismatch detection & diagnostic vector generation.
5. **Double-Count & Allocation Invariant Tests**:
   - Fully allocated payment.
   - Partially allocated payment.
   - Fully allocated credit note.
   - Payment + allocation + prompt payment discount.

---

## 21. PROPERTY-BASED / RANDOMIZED TESTING

- Includes a 200-scenario randomized property test block:
  - Generates random bills, credit notes, payments, discounts, allocations, and reversals across random accounting dates and explicit reversal accounting dates.
  - Asserts fundamental signed invariants across every scenario:
    - $\text{Outstanding Amount} \ge 0.00$
    - $\text{Unapplied Amount} \ge 0.00$
    - $\text{Allocated} + \text{Unapplied} = \text{Source Total}$
    - $\text{Subledger Net Payable}(t) - \text{GL AP\_CONTROL Signed Balance}(t) = \text{Reconciliation Difference}(t)$
    - 100% reconciliation pass rate when all transactions post to GL.

---

## 22. ERROR / DIAGNOSTIC MODEL

When reconciliation yields `FAIL`, `ApReconciliationService` generates structured diagnostic items:
- `SOURCE_BALANCE_MISMATCH`: Payment or credit note unapplied sum disagrees with source journal entries.
- `OPEN_ITEM_BALANCE_MISMATCH`: Sum of open item outstanding amounts disagrees with bill GL postings.
- `UNMAPPED_GL_CONTROL_ACCOUNT`: `AP_CONTROL` line role missing in configuration.
- `SUBLEDGER_GL_DISCREPANCY`: Net discrepancy detected between total subledger payables and GL `AP_CONTROL`.

---

## 23. SUBPHASE EXECUTION PLAN

Implementation is strictly divided into 6 gated subphases:

```text
Phase 2.7.5.0 — Settlement & Reconciliation Foundation (Models & Validators)
      ↓
Phase 2.7.5.1 — Open Item Settlement & Source Utilization Service
      ↓
Phase 2.7.5.2 — Supplier Settlement Aggregation Service
      ↓
Phase 2.7.5.3 — AP Subledger Reconciliation Engine & Diagnostics
      ↓
Phase 2.7.5.4 — Historical As-Of Settlement & Reversal Semantics
      ↓
Phase 2.7.5.5 — Final Verification, Concurrency & Randomized Property Tests
```

---

## 24. DEFINITION OF DONE

Phase 2.7.5 is complete ONLY when:
1. Derived settlement status, source utilization, supplier summary, and GL reconciliation are fully implemented.
2. Zero duplicate source-of-truth tables or mutable settlement states are created.
3. All calculations use `ExactDecimal` with 2-decimal scale supporting signed negative balances.
4. Historical as-of reporting accurately reflects point-in-time subledger states using `accounting_date`, `allocation_date`, and explicit `reversalAccountingDate`.
5. Double-counting prevention is mathematically proven and verified by tests.
6. Multi-tenant and company isolation is 100% enforced.
7. Diagnostic reporting provides actionable mismatch vectors on reconciliation failure.
8. Dedicated test suite (`phase2_7_5_settlement.test.ts`) passes with 100% success.
9. Typecheck (`npm run typecheck`) and build (`npm run build`) pass with 0 errors.

---

## 25. MASTER PLAN APPROVAL CHECKLIST

| Architectural Concern | Plan Status | Design Specification Detail |
| :--- | :--- | :--- |
| **Derived-Only Architecture** | **PASS** | No mutable settlement columns or duplicate ledger tables created. All statuses derived. |
| **Explicit Reversal Accounting Date** | **FIXED** | `reversalAccountingDate` defined as an explicit SQL DATE supplied during reversal and validated via `FiscalPeriodService`. `reversedAt` is technical timestamp only. |
| **Reversal Timestamp vs Accounting Date Separation** | **FIXED** | Historical calculations use `reversalAccountingDate` for point-in-time inclusion ($t < D_{\text{rev}}$ vs $t \ge D_{\text{rev}}$). |
| **Signed AP_CONTROL Balance** | **FIXED** | $\text{GL Signed Balance} = \text{Credits} - \text{Debits}$. Supports positive liabilities, zero, and negative advance/credit balances. |
| **Negative Net Payable Support** | **FIXED** | `netPayableAmount` is an exact-decimal signed value. Negative when advances/credit notes exceed open bills. |
| **Credit-Note Reconciliation Example** | **FIXED** | Added worked example (₹2,000 credit note $\rightarrow$ Subledger = -2,000, GL = -2,000, Diff = 0.00, Status = PASS). |
| **Historical GL Cutoff Consistency** | **FIXED** | Subledger and GL evaluated at exact same `asOfDate` cutoff (`journal.accounting_date <= asOfDate`). |
| **Snapshot Consistency** | **FIXED** | Multi-query reconciliation executes under `REPEATABLE READ READ ONLY` snapshot isolation. |
| **Current vs Historical Calculation Separation** | **FIXED** | Live Mode uses current stored columns; Historical Mode reconstructs balances dynamically from effective-dated events. |
| **Double-Count Prevention** | **PASS** | Proved $\Delta \text{Net Subledger} = 0.00$ on allocation; allocations excluded from subledger GL reconciliation subtraction. |
| **Source Utilization Model** | **PASS** | Derived `FULLY_UNAPPLIED`, `PARTIALLY_APPLIED`, `FULLY_APPLIED` states for payments & credit notes. |
| **Multi-Tenant / Company Isolation** | **PASS** | Mandatory `tenant_id` and `company_id` filters on all queries and service calls. |
| **Exact Decimal Accuracy** | **PASS** | `ExactDecimal` used for all subtotals, comparisons, and signed differences. |
| **Diagnostics & Actionable Errors** | **PASS** | Structured diagnostic exception codes (`SUBLEDGER_GL_DISCREPANCY`, etc.) on reconciliation failure. |
| **Subphase Breakdown & Stop Gates** | **PASS** | Retained 6 strictly gated subphases (2.7.5.0 through 2.7.5.5). |

---

## 26. FINAL STATUS CONCLUSION

```text
PHASE 2.7.5 MASTER PLAN FINAL FINANCIAL CORRECTION: COMPLETE
IMPLEMENTATION: NOT STARTED
EXECUTION STOPPED
```
