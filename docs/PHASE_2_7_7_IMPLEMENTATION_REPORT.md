# Phase 2.7.7 — AP Aging & Supplier Statements Implementation Report

## Executive Summary

Phase 2.7.7 introduces read-only reporting capabilities for **AP Supplier Aging**, **Company Aging Summary**, and **Supplier Account Statements** (both live and historical as-of dates).

All calculations are derived dynamically from PostgreSQL authoritative financial event data (`ap_documents`, `ap_document_lines`, `ap_open_items`, `ap_payments`, `ap_allocations`, `ap_adjustments`, `ap_adjustment_lines`).

No persistent aging tables, statement balance tables, mutable aging columns, or duplicate financial states were created. Financial state consistency and decimal precision are enforced strictly using `ExactDecimal`. All multi-query reporting runs within `REPEATABLE READ READ ONLY` database snapshot transactions via `ApSettlementFoundation.withReadOnlySnapshot`.

---

## 1. Scope & Capabilities

1. **AP Supplier Aging Service** (`ApAgingService`):
   - Derives live and historical open-item aging for debit open items (`SUPPLIER_BILL`, `DEBIT_NOTE`, `OPENING_BALANCE`).
   - Categorizes overdue balances into approved buckets: `CURRENT`, `1_30`, `31_60`, `61_90`, `90_PLUS`.
   - Distinguishes debit aging exposure from signed net supplier payable (incorporating unapplied payments and credit notes).
   - Generates supplier-level and company-level aggregated aging summaries.

2. **AP Supplier Account Statement Service** (`ApStatementService`):
   - Reconstructs point-in-time opening balances as of `fromDate - 1 day` using historical financial settlement logic.
   - Summarizes period transaction lines (`SUPPLIER_BILL`, `DEBIT_NOTE`, `PAYMENT`, `CREDIT_NOTE`, `WRITE_OFF`, `DEBIT_ADJUSTMENT`, `CREDIT_ADJUSTMENT`, `PROMPT_PAYMENT_DISCOUNT`, and reversals).
   - Computes running balances line by line and verifies closing balance identity:
     $$\text{Opening Balance} + \text{Period Debits} - \text{Period Credits} = \text{Closing Balance}$$
   - Guarantees closing balance matches `ApHistoricalSettlementService.getHistoricalSupplierSettlementSummary(toDate).netPayableAmount`.

---

## 2. Aging Architecture & Semantics

### 2.1 Aging Basis & Bucket Boundaries
- **Overdue Days Calculation**:
  $$\text{daysOverdue} = \text{asOfDate} - \text{dueDate}$$
  Calculated using UTC calendar-date semantics (`YYYY-MM-DD`).
- **Approved Bucket Boundaries**:
  - `CURRENT`: `daysOverdue` $\le 0$
  - `1_30`: $1 \le \text{daysOverdue} \le 30$
  - `31_60`: $31 \le \text{daysOverdue} \le 60$
  - `61_90`: $61 \le \text{daysOverdue} \le 90$
  - `90_PLUS`: $\text{daysOverdue} \ge 91$

### 2.2 Open Item Eligibility & Net Payable Separation
- **Debit Open Items**: Only `SUPPLIER_BILL`, `DEBIT_NOTE`, and `OPENING_BALANCE` contribute to debit aging buckets.
- **Credit Items**: `CREDIT_NOTE` and unapplied payments are excluded from debit aging buckets to prevent misrepresenting open debt, but are included in `signedNetPayable`.
- **Outstanding Exposure Formula**:
  $$\text{Outstanding} = \text{Original} + \text{Active Debit Adjustments} - \text{Active Allocations} - \text{Active Discounts} - \text{Active Write-Offs} - \text{Active Credit Adjustments}$$
- Fully settled open items ($\text{Outstanding} = 0$) are excluded from aging output.
- Corrupted negative outstanding balances raise an error rather than being silently clamped.

---

## 3. Statement Architecture & Semantics

### 3.1 Point-in-Time Opening & Closing Balances
- **Opening Balance**: Calculated as of `fromDate - 1 day` using historical financial effective dates (`accountingDate`, `allocationDate`, `reversalAccountingDate`).
- **Closing Balance**: Reconstructed at `toDate`. Must reconcile perfectly with `ApHistoricalSettlementService`.

### 3.2 Transaction Types & Double-Counting Prevention
- **Financial Lines**:
  - **Debits (+ Payables)**: `SUPPLIER_BILL`, `DEBIT_NOTE`, `DEBIT_ADJUSTMENT`, `CREDIT_NOTE_REVERSAL`, `PAYMENT_REVERSAL`, `WRITE_OFF_REVERSAL`, `CREDIT_ADJUSTMENT_REVERSAL`.
  - **Credits (- Payables)**: `PAYMENT`, `CREDIT_NOTE`, `WRITE_OFF`, `CREDIT_ADJUSTMENT`, `PROMPT_PAYMENT_DISCOUNT`, `BILL_REVERSAL`, `DEBIT_NOTE_REVERSAL`, `DEBIT_ADJUSTMENT_REVERSAL`.
- **Allocations**: Allocations do not generate separate cash/debt transaction lines on the statement because bills and payments already record the debt and payment flows. Prompt-payment discounts realized during allocation generate `PROMPT_PAYMENT_DISCOUNT` credit lines.
- **Deterministic Line Ordering**:
  1. `effectiveDate` (ascending)
  2. Defined event category priority (`SUPPLIER_BILL` $\to$ `DEBIT_NOTE` $\to$ `DEBIT_ADJUSTMENT` $\to$ `PAYMENT` $\to$ `CREDIT_NOTE` $\to$ `WRITE_OFF` $\to$ `CREDIT_ADJUSTMENT` $\to$ `PROMPT_PAYMENT_DISCOUNT` $\to$ reversals)
  3. Stable Entity ID (ascending)

---

## 4. Snapshot Isolation & Integrity

- **Snapshot Concurrency**: All multi-query operations execute inside `ApSettlementFoundation.withReadOnlySnapshot` using `REPEATABLE READ READ ONLY` database transactions without taking write locks (`FOR UPDATE`).
- **Data Integrity**: Invalid dates, unposted adjustments, cross-tenant/company/supplier leaks, or negative outstanding balances are caught and surfaced via formal domain exceptions.

---

## 5. Summary of Files Created & Modified

### Created Files
1. `apps/api/src/modules/finance/ap/ap-aging-model.ts`: DTOs, interfaces, aging bucket types, and query input validation types.
2. `apps/api/src/modules/finance/ap/ap-aging-validator.ts`: Validation helpers for tenant, company, supplier contexts, and date parameters.
3. `apps/api/src/modules/finance/ap/ap-aging.service.ts`: Core service implementing `getSupplierAging` and `getCompanyAging`.
4. `apps/api/src/modules/finance/ap/ap-statement.service.ts`: Core service implementing `getSupplierStatement`.
5. `apps/api/test/phase2_7_7_ap_aging_statements.test.ts`: Test suite containing 34 comprehensive test cases.
6. `docs/PHASE_2_7_7_IMPLEMENTATION_REPORT.md`: This documentation report.

### Modified Files
1. `apps/api/src/modules/finance/ap/index.ts`: Re-exported Phase 2.7.7 models, validators, and services.
2. `docs/IMPLEMENTATION_STATUS.md`: Marked Phase 2.7.7 as `COMPLETE / APPROVED`.

---

## 6. Verification & Test Results

### 6.1 Dedicated Test Suite
- **Command**: `npx vitest run apps/api/test/phase2_7_7_ap_aging_statements.test.ts`
- **Result**: PASS (34 tests passed out of 34).
- **Test Scenarios Covered**:
  - Aging bucket assignments (`CURRENT`, `1_30`, `31_60`, `61_90`, `90_PLUS`, exact boundaries, future due dates).
  - Open item eligibility, settled item exclusion, and write-off / adjustment effects.
  - Signed net payable separation (unapplied payments & credit notes).
  - Supplier statement opening, period debits/credits, running balance, and closing balance reconciliation.
  - Allocation discount handling without double counting.
  - Historical point-in-time aging and statements using financial effective dates.
  - Strict tenant/company/supplier context isolation and read-only snapshot transaction execution.

### 6.2 Full Workspace Suite & Build Checks
- **Typecheck**: `npm run typecheck` $\to$ PASSED across all workspace packages (`@general-erp/core`, `@general-erp/database`, `@general-erp/api`, `@general-erp/web`).
- **Build**: `npm run build` $\to$ PASSED.
- **Workspace Tests**: `npm test` $\to$ PASSED (48 test files, 747 tests passed).

---

## 7. Deviations & Deferred Work

- **No REST Controllers / UI**: Consistent with requirements, Phase 2.7.7 is strictly backend reporting services. REST API endpoints will be added in Phase 2.7.8.
- **Strict Execution Boundary**: Execution stopped strictly after Phase 2.7.7.
