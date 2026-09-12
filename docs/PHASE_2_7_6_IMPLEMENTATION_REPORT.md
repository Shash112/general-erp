# Phase 2.7.6 Implementation Report — AP Adjustments & Write-Offs

## 1. Executive Summary & Scope
Phase 2.7.6 introduces posted financial adjustment events (`WRITE_OFF`, `CREDIT_ADJUSTMENT`, `DEBIT_ADJUSTMENT`) to the Accounts Payable subsystem. Unlike Phase 2.7.5 (which provided derived-only settlement and reconciliation logic over pre-existing financial documents), Phase 2.7.6 provides a complete financial mutation framework.

All adjustments follow strict append-only financial event semantics, flow through `AccountingCore` for GL journal generation, use ExactDecimal arithmetic, enforce PostgreSQL row locking (`SELECT ... FOR UPDATE`), support post-lock idempotency, integrate seamlessly into AP settlement and historical reconstruction services, and preserve subledger-to-GL reconciliation.

---

## 2. Adjustment Event Model
AP adjustments are represented by `ApAdjustmentDTO` in `apps/api/src/modules/finance/ap/ap-adjustment-model.ts`:

- `id`: Unique identifier (`apadj_...`)
- `tenantId`: Tenant context
- `companyId`: Company context
- `supplierId`: Supplier context
- `openItemId`: Target AP open item ID (must be a debit open item: `SUPPLIER_BILL`, `DEBIT_NOTE`, or `OPENING_BALANCE`)
- `adjustmentType`: `WRITE_OFF` | `CREDIT_ADJUSTMENT` | `DEBIT_ADJUSTMENT`
- `amount`: ExactDecimal string representation (`numeric(20,2)`)
- `adjustmentDate`: Business date (`YYYY-MM-DD`)
- `accountingDate`: Financial posting date (`YYYY-MM-DD`)
- `reason`: Required non-empty justification string
- `status`: Lifecycle status (`DRAFT` | `POSTED` | `REVERSED` | `CANCELLED`)
- `journalEntryId`: Associated GL journal entry ID (populated upon posting)
- `reversalAccountingDate`: Effective accounting date for reversal
- `reversedAt`: Audit timestamp when reversal was posted
- `reversedBy`: User/role triggering reversal
- `version`: Optimistic locking version
- `createdAt`, `updatedAt`: Timestamps

No mutable derived outstanding amount columns are added to the DB row; derived exposure is dynamically computed from authoritative events.

---

## 3. Financial Lifecycle & State Transitions
Supported transitions:
- `DRAFT` $\rightarrow$ `POSTED` (atomic GL posting, numbering generation, DB open item lock/validation)
- `POSTED` $\rightarrow$ `REVERSED` (compensating GL entry, reversal accounting date validation, open item lock/validation)
- `DRAFT` $\rightarrow$ `CANCELLED` (abandoning unposted draft)

Posted adjustments are strictly immutable. Corrections are performed exclusively through compensating reversals.

---

## 4. Adjustment Types & Financial Semantics

### 1. `WRITE_OFF`
- **Meaning**: Intentional reduction of supplier payable exposure.
- **Exposure Effect**: Outstanding payable decreases ($\text{Outstanding} \rightarrow \text{Outstanding} - \text{Amount}$).
- **Over-Adjustment Guard**: Requested write-off amount cannot exceed available open item outstanding amount.
- **Accounting**: Debit `AP_CONTROL`, Credit configured `WRITE_OFF_OFFSET`.

### 2. `CREDIT_ADJUSTMENT`
- **Meaning**: Distinct credit adjustment reducing payable exposure (not a supplier credit note document).
- **Exposure Effect**: Outstanding payable decreases ($\text{Outstanding} \rightarrow \text{Outstanding} - \text{Amount}$).
- **Over-Adjustment Guard**: Amount cannot exceed available open item outstanding amount.
- **Accounting**: Debit `AP_CONTROL`, Credit configured `CREDIT_ADJUSTMENT_OFFSET`.

### 3. `DEBIT_ADJUSTMENT`
- **Meaning**: Increase in AP payable exposure (e.g. late fees, dispute adjustments).
- **Exposure Effect**: Outstanding payable increases ($\text{Outstanding} \rightarrow \text{Outstanding} + \text{Amount}$).
- **Reversal Guard**: Reversing a debit adjustment decreases outstanding and rejects if outstanding would become negative.
- **Accounting**: Credit `AP_CONTROL`, Debit configured `DEBIT_ADJUSTMENT_OFFSET`.

---

## 5. Authoritative Outstanding Formula
With Phase 2.7.6, the open item outstanding formula is updated across all settlement services:

$$\text{Outstanding} = \text{Original} + \text{Active Debit Adjustments} - \text{Active Allocations} - \text{Active Prompt Payment Discounts} - \text{Active Write-Offs} - \text{Active Credit Adjustments}$$

All monetary calculations use `ExactDecimal` string arithmetic.

---

## 6. Accounting Core & Configuration Integration
All posted adjustments invoke `AccountingCore` for GL journal generation. Offset accounts are resolved dynamically from `AccountingConfigurationService`:

| Adjustment Event Type | Line 1 Role | Line 1 DR/CR | Line 2 Role | Line 2 DR/CR |
| :--- | :--- | :--- | :--- | :--- |
| `WRITE_OFF` | `AP_CONTROL` | Debit | `WRITE_OFF_OFFSET` | Credit |
| `CREDIT_ADJUSTMENT` | `AP_CONTROL` | Debit | `CREDIT_ADJUSTMENT_OFFSET` | Credit |
| `DEBIT_ADJUSTMENT` | `DEBIT_ADJUSTMENT_OFFSET` | Debit | `AP_CONTROL` | Credit |
| `AP_ADJUSTMENT_REVERSAL` | (Swapped roles) | (Swapped DR/CR) | (Swapped roles) | (Swapped DR/CR) |

Missing account configuration fails gracefully with an explicit `AccountingError`. No chart-of-account IDs are hard-coded.

---

## 7. Concurrency Protection & Idempotency
- **PostgreSQL Transactional Locking**: In database-backed environments, `SELECT ... FOR UPDATE` locks affected open item and adjustment rows atomically.
- **In-Memory Contention Locks**: In-memory execution acquires locks in deterministic sorted order (`tenantId:entityId`) to prevent race conditions and deadlocks.
- **Post-Lock Re-Validation**: Authoritative balance is re-verified after lock acquisition before updating state or processing accounting.
- **Idempotency**: All mutation calls accept `idempotencyKey`. Duplicate requests with identical keys return the existing DTO without duplicating financial records or GL journals. Post-lock re-checks guard concurrent duplicate submissions.

---

## 8. Settlement, Supplier Summary & Historical Integration

### Settlement Integration (`ap-settlement.service.ts`)
- `getOpenItemSettlement`: Includes active write-offs, credit adjustments, and debit adjustments in the outstanding calculation and settlement status determination (`OPEN`, `PARTIALLY_SETTLED`, `SETTLED`).

### Supplier Settlement Summary (`ap-settlement.service.ts`)
- `getSupplierSettlementSummary`: Incorporates adjustment-aware open item outstanding amounts into supplier net payable totals ($\text{Net Payable} = \text{Outstanding Open Items} - \text{Unapplied Payments} - \text{Unapplied Credit Notes}$).

### Subledger Reconciliation (`ap-reconciliation.service.ts`)
- `reconcileCompanyAP`: Reconciles adjustment-aware subledger net payable with GL `AP_CONTROL` signed balance. Since every posted adjustment creates matching GL entries, subledger and GL remain in perfect balance (`reconciliationDifference = 0.00`, `status = PASS`).

### Historical Reconstruction (`ap-historical-settlement.service.ts`)
- Adjustments are included if $\text{accountingDate} \le \text{asOfDate}$ and ($\text{reversalAccountingDate} \text{ is NULL}$ or $\text{reversalAccountingDate} > \text{asOfDate}$).
- Reversals take effect on $\text{reversalAccountingDate}$. Technical timestamps (`createdAt`, `reversedAt`) are strictly excluded from cutoff logic.

---

## 9. Security, Context Isolation & Audit
- **Context Isolation**: Tenant, company, and supplier isolation are enforced. Cross-tenant, cross-company, or cross-supplier adjustments are rejected (`ForbiddenError` / `BusinessRuleViolationError`).
- **Target Open Item**: Adjustments strictly target debit open items (`SUPPLIER_BILL`, `DEBIT_NOTE`, `OPENING_BALANCE`). Targeting `CREDIT_NOTE` open items is forbidden.
- **Fiscal Period Validation**: Accounting dates must fall within open fiscal periods (`assertPeriodOpen`).
- **Authorization**: Enforces permissions `ap:adjustment:create`, `ap:adjustment:post`, `ap:adjustment:reverse`, `ap:adjustment:cancel`, `ap:adjustment:read`. Ordinary read users cannot post or reverse adjustments.
- **Audit Logging**: Every lifecycle event (`CREATE`, `POST`, `REVERSE`, `CANCEL`) logs structured events via `AuditService`.

---

## 10. Verification Results

### Test Suite (`apps/api/test/phase2_7_6_ap_adjustments.test.ts`)
- **Dedicated Test Count**: 58 test cases (including model, lifecycle, write-off, credit/debit adjustments, settlement integration, Section 34 historical timeline, concurrency contention, idempotency, accounting, security, integrity, exact decimal precision, and 50 randomized property-based tests).
- **Test Result**: 58 / 58 PASS (100% success).

### Workspace Validation
- **Full Workspace Test Suite**: 47 test files / 713 tests PASS.
- **TypeScript Typecheck**: `npm run typecheck` PASS across `@general-erp/core`, `@general-erp/database`, `@general-erp/api`, and `@general-erp/web`.
- **Production Build**: `npm run build` PASS across all packages.

---

## 11. Deviations & Deferred Functionality
- **Tax Handling**: Adjustments are tax-neutral under Phase 2.7.6 (consistent with tax-neutral AR/AP balance adjustment semantics). Tax adjustment handling is deferred to future tax reconciliation phases.
- **Strict Execution Boundary**: Work stopped strictly after Phase 2.7.6. Phase 2.7.7 (Aging / Statements) and Phase 2.7.8 (REST API) are not implemented.
