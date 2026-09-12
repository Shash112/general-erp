# PHASE 2.7.5.4 IMPLEMENTATION REPORT
## AP Historical Settlement Reconstruction Engine

---

### Executive Summary

Phase 2.7.5.4 implements the derived, read-only **AP Historical Settlement Reconstruction Engine** for the General ERP product. Building on Phase 2.7.5.0 foundation, Phase 2.7.5.1 open-item/source services, Phase 2.7.5.2 supplier settlement aggregation, and Phase 2.7.5.3 company reconciliation, this subphase adds `ApHistoricalSettlementService` to reconstruct historical AP settlement & reconciliation state as of an explicit accounting cutoff date (`asOfDate`).

Historical balances are calculated dynamically from authoritative financial records (`ap_open_items`, `ap_documents`, `ap_payments`, `ap_allocations`, `gl_journals`, `gl_journal_lines`). No persistent historical balance tables or mutable historical state columns were introduced. All historical operations execute within PostgreSQL `REPEATABLE READ READ ONLY` snapshot isolation via `ApSettlementFoundation.withReadOnlySnapshot` without acquiring table or row write locks (`FOR UPDATE`), ensuring non-blocking performance and strict multi-tenant isolation.

---

### 1. Scope of Implementation

Implemented strictly within Phase 2.7.5.4 scope:
- **`ApHistoricalSettlementService`**: Implemented `getHistoricalOpenItemSettlement`, `getHistoricalSourceUtilization`, `getHistoricalSupplierSettlementSummary`, and `reconcileHistoricalCompanyAP`.
- **Financial Effective Date Rules**:
  - Documents & Payments: `accountingDate <= asOfDate` AND (`reversalAccountingDate IS NULL` OR `reversalAccountingDate > asOfDate`).
  - Allocations: `allocationDate <= asOfDate` AND (`reversalAccountingDate IS NULL` OR `reversalAccountingDate > asOfDate`).
  - Technical timestamps (`createdAt`, `updatedAt`, `reversedAt`) are never used as financial effective date cutoffs.
- **Historical Reversal Semantics**: A reversal does not retroactively erase transactions prior to its `reversalAccountingDate`. The engine preserves active financial state for `asOfDate < reversalAccountingDate` and applies the reversal only for `asOfDate >= reversalAccountingDate`.
- **Historical Open Item Reconstruction**: Reconstructs $\text{Historical Outstanding} = \text{Original Amount} - \text{Active Historical Allocations} - \text{Active Historical Discounts}$.
- **Historical Source Utilization Reconstruction**: Reconstructs $\text{Historical Unapplied} = \text{Historical Total Amount} - \text{Active Historical Allocations}$.
- **Historical Supplier & Company Positions**: Evaluates historical net payable exposure ($\text{Outstanding Open Items} - \text{Unapplied Payments} - \text{Unapplied Credit Notes}$) at supplier and company levels. Enforces that company net payable equals the sum of supplier net payables.
- **Historical GL `AP_CONTROL` Reconciliation**: Evaluates posted GL journal lines with `accountingDate <= asOfDate`, computing signed GL balance ($\text{Credits} - \text{Debits}$) and signed difference ($\text{Subledger} - \text{GL}$).
- **Database Snapshot Execution**: Wraps historical queries inside PostgreSQL `REPEATABLE READ READ ONLY` transaction snapshot.
- **ExactDecimal Arithmetic**: Enforces strict `ExactDecimal` string manipulation throughout all historical financial aggregations and DTO outputs.

Explicitly **deferred to subsequent subphases**:
- `2.7.5.5`: Final Verification, Performance & Concurrency Hardening
- Phase 2.7.6+ (AP Adjustments, Aging, Statements, REST API, UI).

---

### 2. Service API & Reconstructive Logic

#### Service Class
`ApHistoricalSettlementService` in `apps/api/src/modules/finance/ap/ap-historical-settlement.service.ts`

#### Key Methods
```typescript
public async getHistoricalOpenItemSettlement(
  ctx: RequestContext,
  openItemId: string,
  asOfDate: string
): Promise<ApOpenItemSettlementDTO>

public async getHistoricalSourceUtilization(
  ctx: RequestContext,
  sourceType: ApSourceUtilizationType,
  sourceId: string,
  asOfDate: string
): Promise<ApSourceUtilizationDTO>

public async getHistoricalSupplierSettlementSummary(
  ctx: RequestContext,
  supplierId: string,
  asOfDate: string
): Promise<SupplierSettlementSummaryDTO>

public async reconcileHistoricalCompanyAP(
  ctx: RequestContext,
  companyId: string,
  asOfDate: string
): Promise<ApReconciliationResultDTO>
```

---

### 3. Reversal & Time Monotonicity Matrix

| Date Boundary | Condition | Result |
|---|---|---|
| `asOfDate < accountingDate` | Document/Payment/Credit Note not effective yet | Entity excluded / Query rejects with `BusinessRuleViolationError` |
| `accountingDate <= asOfDate < reversalAccountingDate` | Transaction active, reversal not effective yet | Entity INCLUDED, historical allocation active |
| `asOfDate >= reversalAccountingDate` | Reversal active on/after reversal accounting date | Entity EXCLUDED / Allocation excluded from outstanding reduction |

---

### 4. Automated Test Verification Results

#### Test Suite Metrics
- **Phase 2.7.5.4 Dedicated Tests**: 10 test blocks in `apps/api/test/phase2_7_5_4_ap_historical_settlement.test.ts` covering:
  - Inclusion & exclusion around `accountingDate`, `allocationDate`, and `reversalAccountingDate`
  - Monotonic time boundary progression (`Jan 09 -> 10k`, `Jan 15 -> 6k`, `Apr 09 -> 6k`, `Apr 15 -> 10k`)
  - Document & Payment reversals on explicit `reversalAccountingDate`
  - Mandatory Current vs. Historical Difference verification (proving true event-based historical reconstruction)
  - Supplier & Company historical summary equivalence
  - Signed negative historical net payable positions
  - 50 deterministic randomized historical transaction scenarios (balance conservation & reconciliation formulas)
- **Workspace Test Suite**: 44 passed out of 44 test files (100%).
- **Workspace Total Tests**: 644 passed out of 644 tests (100%).
- **TypeScript Typecheck (`npm run typecheck`)**: PASSED with 0 errors across all workspace packages and apps.
- **Workspace Production Build (`npm run build`)**: PASSED cleanly.

---

### 5. Subphase Execution Boundary Confirmation

Execution stopped strictly at **Phase 2.7.5.4**. Subsequent subphases (2.7.5.5 Final Verification, 2.7.6 AP Adjustments, 2.7.8 REST API) have not been started.
