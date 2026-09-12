# PHASE 2.7.5.1 IMPLEMENTATION REPORT
## AP Open Item Settlement & Source Utilization Engine

---

### Executive Summary

Phase 2.7.5.1 establishes the derived, read-only **AP Open Item Settlement & Source Utilization Engine** for the General ERP modular monolith. Following the Phase 2.7.5 master plan and Phase 2.7.5.0 foundation primitives, this subphase implements the core derived calculation services `getOpenItemSettlement` and `getSourceUtilization` in `ApSettlementService`.

All calculations are strictly derived on-the-fly from PostgreSQL authoritative tables (`ap_open_items`, `ap_documents`, `ap_payments`, and `ap_allocations`). No secondary settlement tables or mutable status columns were added. Every calculation executes within PostgreSQL `REPEATABLE READ READ ONLY` snapshot isolation without acquiring locks (`FOR UPDATE`), protecting the transactional database against lock contention.

---

### 1. Scope of Implementation

Implemented strictly within Phase 2.7.5.1 scope:
- **`ApSettlementService.getOpenItemSettlement(...)`**: Evaluates single open item settlement state (Original, Active Allocations, Active Discounts, Outstanding Amount, Settlement Status) in both `LIVE` and `HISTORICAL` calculation modes.
- **`ApSettlementService.getSourceUtilization(...)`**: Evaluates payment or credit note source utilization state (Total Gross Amount, Active Allocations, Unapplied Amount, Utilization Status) in both `LIVE` and `HISTORICAL` calculation modes.
- **Tenant, Company, and Supplier Isolation**: Context validation using `ApSettlementValidator` and `AuthorizationService`.
- **Database Snapshot Execution**: Read-only snapshot execution helper `ApSettlementFoundation.withReadOnlySnapshot`.
- **Integrity Assertion**: Explicit error generation (`BusinessRuleViolationError`) on corrupted balances (over-allocation, negative outstanding).

Explicitly **deferred to subsequent subphases**:
- `2.7.5.2`: Supplier Settlement Summary (`getSupplierSettlementSummary`)
- `2.7.5.3`: AP Company Reconciliation (`reconcileCompanyAP`)
- `2.7.5.4`: Historical Settlement Reconstruction Service
- `2.7.5.5`: Concurrency / Database Benchmark & Final Verification
- REST Controllers, aging, statements, adjustments, write-offs, or UI reports.

---

### 2. Files Created and Modified

| File Path | Action | Description |
|---|---|---|
| `apps/api/src/modules/finance/ap/ap-settlement.service.ts` | **CREATED** | Core read-only derived service implementing `getOpenItemSettlement` and `getSourceUtilization` |
| `apps/api/src/modules/finance/ap/index.ts` | **MODIFIED** | Exported `apSettlementService` and `ApSettlementService` |
| `apps/api/test/phase2_7_5_1_settlement.test.ts` | **CREATED** | Suite of 19 comprehensive unit, boundary, snapshot, integrity, and randomized property test scenarios |
| `docs/PHASE_2_7_5_1_IMPLEMENTATION_REPORT.md` | **CREATED** | Comprehensive architectural and verification report |
| `docs/IMPLEMENTATION_STATUS.md` | **MODIFIED** | Updated Phase 2.7.5.1 status to Complete & Approved |

---

### 3. Key Financial Semantics & Derived Formulas

#### A. Open Item Settlement (`getOpenItemSettlement`)

Open items supported: `SUPPLIER_BILL`, `DEBIT_NOTE`, `OPENING_BALANCE`.

$$\text{Active Allocations} = \sum \text{Effective Active Allocated Amounts against Open Item}$$

$$\text{Active Discounts} = \sum \text{Effective Active Allocation Discount Amounts}$$

$$\text{Outstanding Amount} = \text{Original Amount} - \text{Active Allocations} - \text{Active Discounts}$$

**Settlement Status Rules** (via `ApSettlementFoundation.calculateSettlementStatus`):
- `OPEN`: $\text{Outstanding} = \text{Original}$ ($\text{Active Allocations} + \text{Active Discounts} = 0$)
- `PARTIALLY_SETTLED`: $0 < \text{Outstanding} < \text{Original}$
- `SETTLED`: $\text{Outstanding} = 0$

#### B. Credit Source Utilization (`getSourceUtilization`)

Sources supported: `PAYMENT`, `CREDIT_NOTE`.

$$\text{Total Amount} = \text{Gross Payment Total or Credit Note Gross Amount}$$

$$\text{Allocated Amount} = \sum \text{Effective Active Allocations from Source}$$

$$\text{Unapplied Amount} = \text{Total Amount} - \text{Allocated Amount}$$

**Utilization Status Rules** (via `ApSettlementFoundation.calculateSourceUtilization`):
- `FULLY_UNAPPLIED`: $\text{Allocated} = 0$
- `PARTIALLY_APPLIED`: $0 < \text{Allocated} < \text{Total}$
- `FULLY_APPLIED`: $\text{Unapplied} = 0$

---

### 4. LIVE vs HISTORICAL Calculation Semantics

| Calculation Mode | Financial Effective-Date Rules |
|---|---|
| **`LIVE`** | Includes all currently `ACTIVE` allocations and current document/payment balances. |
| **`HISTORICAL`** | Evaluated relative to an explicit `asOfDate` cutoff ($YYYY-MM-DD$). <br> 1. Document posted if $\text{accountingDate} \le \text{asOfDate}$. <br> 2. Allocation effective if $\text{allocationDate} \le \text{asOfDate}$. <br> 3. Reversal effective if $\text{reversalAccountingDate} \le \text{asOfDate}$. |

**Critical Control**: Technical timestamps (`createdAt`, `updatedAt`, `reversedAt`) are never used as financial effective dates. Reversals entered after the `asOfDate` do not alter the historical state prior to their `reversalAccountingDate`.

---

### 5. ExactDecimal & Invariant Integrity Protection

- All calculations use `@general-erp/core`'s `ExactDecimal` (2 decimal places precision for INR/currency). No JS floating point math is permitted.
- **Corrupted Data Protection**: If legacy/corrupted data results in $\text{Allocations} > \text{Original}$ or $\text{Outstanding} < 0$, the service surfaces an explicit `BusinessRuleViolationError` rather than silently zeroing or fixing balances.

---

### 6. Database Snapshot Isolation

All queries run within a PostgreSQL read-only transaction:
```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
```
No `FOR UPDATE` or table locks are acquired, ensuring concurrent read access to AP reports while write transactions continue unaffected.

---

### 7. Automated Test Verification Results

#### Test Suite Metrics
- **Phase 2.7.5.1 Specific Tests**: 19 tests in `apps/api/test/phase2_7_5_1_settlement.test.ts` (covering Live mode, Historical boundary cutoffs, source utilization, database snapshot execution, integrity corruption detection, and 50 randomized allocation property scenarios).
- **Workspace Total Test Suites**: 41 passed out of 41 files (100%).
- **Workspace Total Tests**: 608 passed out of 608 tests (100%).
- **TypeScript Typecheck (`npm run typecheck`)**: PASSED with 0 compilation errors across all packages/apps.
- **Production Build (`npm run build`)**: PASSED cleanly.

---

### 8. Subphase Execution Boundary Confirmation

Execution stopped strictly at **Phase 2.7.5.1**. Subsequent subphases (2.7.5.2 to 2.7.5.5) have not been started.
