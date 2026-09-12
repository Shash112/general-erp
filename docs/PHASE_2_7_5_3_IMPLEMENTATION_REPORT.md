# PHASE 2.7.5.3 IMPLEMENTATION REPORT
## AP Subledger & Company Reconciliation Engine

---

### Executive Summary

Phase 2.7.5.3 implements the derived, read-only **AP Subledger & Company Reconciliation Engine** for the General ERP product. Building on Phase 2.7.5.0 foundation, Phase 2.7.5.1 open-item/source services, and Phase 2.7.5.2 supplier settlement aggregation, this subphase adds `ApReconciliationService.reconcileCompanyAP` to reconcile company-level AP Subledger Net Payable exposure against the General Ledger `AP_CONTROL` signed balance.

All financial calculations are derived on-the-fly from PostgreSQL authoritative records (`ap_open_items`, `ap_documents`, `ap_payments`, `ap_allocations`, `gl_journals`, `gl_journal_lines`, `gl_accounts`). No secondary persistent reconciliation tables or mutable reconciliation columns were introduced. All operations execute within PostgreSQL `REPEATABLE READ READ ONLY` snapshot isolation without acquiring table/row locks (`FOR UPDATE`), ensuring non-blocking read performance and strict multi-tenant isolation.

---

### 1. Scope of Implementation

Implemented strictly within Phase 2.7.5.3 scope:
- **`ApReconciliationService.reconcileCompanyAP(...)`**: Reconciles AP Subledger Net Payable against GL `AP_CONTROL` Signed Balance for a tenant/company context.
- **Company AP Subledger Net Payable**: Evaluates company-wide signed net payable exposure as $\sum \text{Supplier Net Payable}$ across all eligible suppliers, or equivalent company-level set-based aggregation of outstanding open items minus unapplied payments minus unapplied credit notes.
- **GL `AP_CONTROL` Signed Balance**: Evaluates signed GL balance as $\text{Credits} - \text{Debits}$ across all posted journals targeting accounts with the `AP_CONTROL` role (`ControlAccountType == 'AP'`). Excludes draft, non-posted, and cancelled GL journals.
- **Reconciliation Difference**: Evaluates signed difference using `ApSettlementFoundation.calculateReconciliationDifference(subledger, gl)`. Result status is `PASS` iff difference is exactly `0.00`, otherwise `FAIL`.
- **Structured Reconciliation Diagnostics**: Surfaces actionable diagnostic categories (`SOURCE_BALANCE_MISMATCH`, `OPEN_ITEM_BALANCE_MISMATCH`, `UNMAPPED_GL_CONTROL_ACCOUNT`, `SUBLEDGER_GL_DISCREPANCY`) when discrepancies or setup errors occur.
- **Tenant & Company Context Validation**: Enforces context isolation via `ApSettlementValidator` and `masterDataService.getCompany`. Rejects invalid, missing, or cross-tenant/cross-company requests.
- **Database Snapshot Execution**: Executes all subledger and GL queries inside a single PostgreSQL `REPEATABLE READ READ ONLY` transaction snapshot via `ApSettlementFoundation.withReadOnlySnapshot`.
- **ExactDecimal Arithmetic**: Enforces strict `ExactDecimal` string manipulation throughout all financial aggregations and DTO outputs.

Explicitly **deferred to subsequent subphases**:
- `2.7.5.4`: Historical Settlement Reconstruction Service
- `2.7.5.5`: Final Verification, Performance & Concurrency Hardening
- Phase 2.7.6+ (AP Adjustments, Aging, Statements, REST API, UI).

---

### 2. Service API & Accounting Semantics

#### API Signature
```typescript
public async reconcileCompanyAP(
  ctx: RequestContext,
  companyId: string,
  asOfDate?: string | undefined,
  mode?: ApCalculationMode
): Promise<ApReconciliationResultDTO>
```

#### Core Reconciliation Formulas & Invariants

1. **AP Subledger Company Net Payable**:
   $$\text{Company Subledger Net Payable} = \sum_{s \in \text{Suppliers}} \text{SupplierSettlementSummary}(s).\text{netPayableAmount}$$
   $$\text{Equivalent Set Formula} = \sum \text{Outstanding Open Items} - \sum \text{Unapplied Payments} - \sum \text{Unapplied Credit Notes}$$

2. **GL `AP_CONTROL` Signed Balance**:
   $$\text{GL AP\_CONTROL Signed Balance} = \sum \text{Credits} - \sum \text{Debits}$$
   Evaluated strictly over `POSTED` journals matching company `AP_CONTROL` mapped accounts.

3. **Reconciliation Difference**:
   $$\text{Reconciliation Difference} = \text{Subledger Net Payable} - \text{GL AP\_CONTROL Signed Balance}$$
   $$\text{Status} = \begin{cases} \text{PASS} & \text{if Difference} == 0.00 \\ \text{FAIL} & \text{if Difference} \neq 0.00 \end{cases}$$

---

### 3. Structured Diagnostics & Priority

When reconciliation fails or setup is invalid, `reconcileCompanyAP` populates the `diagnostics` array on `ApReconciliationResultDTO`:

| Diagnostic Code | Condition & Trigger |
|---|---|
| **`UNMAPPED_GL_CONTROL_ACCOUNT`** | Emitted when no active GL account is mapped to the `AP_CONTROL` role (`controlAccountType == 'AP'`) for the company. |
| **`SOURCE_BALANCE_MISMATCH`** | Emitted when an AP payment or credit note source exhibits internal balance corruption ($\text{allocated} + \text{unapplied} \neq \text{total}$). |
| **`OPEN_ITEM_BALANCE_MISMATCH`** | Emitted when an open item's outstanding balance deviates from $\text{original} - \text{allocations} - \text{discounts}$. |
| **`SUBLEDGER_GL_DISCREPANCY`** | Emitted when subledger and GL sources are internally consistent, but subledger net payable $\neq$ GL `AP_CONTROL` signed balance. |

---

### 4. Database Snapshot & Concurrency Protection

- **Snapshot Isolation**: Subledger aggregations and GL `AP_CONTROL` balance queries run strictly within a single read-only transaction:
  ```sql
  BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
  ```
- **Zero Lock Contention**: No `FOR UPDATE` or write locks are acquired.
- **Tenant/Company Isolation**: Database queries enforce `tenantId` and `companyId` equality filters on all AP open items, documents, payments, allocations, and GL journals/journal-lines.

---

### 5. Automated Test Verification Results

#### Test Suite Metrics
- **Phase 2.7.5.3 Dedicated Tests**: 11 test blocks in `apps/api/test/phase2_7_5_3_ap_reconciliation.test.ts` covering:
  - Perfect balanced reconciliation (`PASS`, 0.00 difference)
  - Positive liability, zero exposure, and signed negative supplier credit positions
  - Open items (bills, debit notes, opening balances, partial/full settlements)
  - Payments, credit notes, and polymorphic allocation combinations
  - GL matching, debit/credit imbalance, unmapped control account, draft/unposted journal exclusion
  - Cross-tenant & cross-company isolation
  - Internal AP source & open item corruption diagnostics
  - ExactDecimal large precision and zero/negative boundary conditions
  - Supplier summary equivalence ($\text{Company Total} == \sum \text{Supplier Summaries}$)
  - 50 randomized balanced/imbalanced transaction property scenarios
- **Workspace Test Suite**: 43 passed out of 43 test files (100%).
- **Workspace Total Tests**: 635 passed out of 635 tests (100%).
- **TypeScript Typecheck (`npm run typecheck`)**: PASSED with 0 errors across all workspace packages and apps.
- **Workspace Production Build (`npm run build`)**: PASSED cleanly.

---

### 6. Subphase Execution Boundary Confirmation

Execution stopped strictly at **Phase 2.7.5.3**. Subsequent subphases (2.7.5.4 Historical Reconstruction, 2.7.5.5 Final Verification, 2.7.6 AP Adjustments, 2.7.8 REST API) have not been started.
