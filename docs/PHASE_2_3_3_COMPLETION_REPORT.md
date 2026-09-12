# Phase 2.3.3 Completion Report — Atomic Posting Engine Core

## 1. Scope Implemented
Phase 2.3.3 delivers the production General Ledger posting service (`GLEngine`):
- **`GLEngine.postJournal()`**: Executes atomic posting of manual draft journals (`DRAFT -> POSTED`).
- **PostgreSQL Transaction-Local Authorization Guard**: Sets `SET LOCAL app.posting_authorized = 'true'` inside the active database transaction to satisfy the Phase 2.3.0 database trigger requirement (`trg_prevent_posted_journal_update_delete`).
- **Row-Level Journal Locking**: Acquires `SELECT ... FOR UPDATE` row locks to prevent concurrent posting race conditions.
- **Transactional Voucher Allocation**: Allocates sequential voucher numbers (`JV-YYYY-XXXX`) inside the active SQL transaction block via `NumberingEngine`. If posting fails or rolls back, sequence updates roll back atomically.
- **Strict Immutability Enforcement**: `POSTED` entries cannot be updated, deleted, or cancelled through application services or direct SQL.

## 2. Files Changed / Created
- `apps/api/src/modules/finance/gl-engine.ts` (NEW: Production `GLEngine` service implementing `postJournal` with row locking, `SET LOCAL` authorization guard, exact decimal revalidation, transactional voucher allocation, and status promotion).
- `apps/api/test/phase2_3_3_posting.test.ts` (NEW: Comprehensive test suite covering successful postings, status restriction guards, balance validation, scale validation, tenant/company context isolation, direct SQL bypass rejection, connection-pool safety, rollback atomicity, and 100-request concurrency safety).
- `docs/PHASE_2_3_3_COMPLETION_REPORT.md` (NEW: This completion report).
- `docs/IMPLEMENTATION_STATUS.md` (UPDATED: Phase 2.3.3 status set to `IMPLEMENTED / VERIFIED`).

## 3. GLEngine Architecture & Locking Sequence
```text
+-----------------------------------------------------------------------------------+
|                        ATOMIC POSTING TRANSACTION SEQUENCE                        |
+-----------------------------------------------------------------------------------+
 1. BEGIN DB TRANSACTION.
 2. Set Local Posting Authorization: Execute SET LOCAL app.posting_authorized = 'true'.
 3. Lock Draft Journal Header: SELECT * FROM journal_entries WHERE id = :id FOR UPDATE.
 4. Verify Journal Status == 'DRAFT'.
 5. Validate Input Scale: Verify line debit/credit amounts have scale <= 2 decimal places.
 6. Validate Line Invariants & Balance: Verify debit XOR credit, non-zero lines, non-negative
    amounts, and exact SUM(debits) === SUM(credits).
 7. Reconcile Totals: Match line-derived exact totals against header totals.
 8. Allocate Voucher Number: Call NumberingEngine.generateNextNumberAsync(...) inside transaction.
 9. Update Journal Header: Set status = 'POSTED', voucher_number, posted_by, posted_at, version + 1.
10. COMMIT DB TRANSACTION (resets app.posting_authorized automatically).
11. Return Posted DTO.
+-----------------------------------------------------------------------------------+
```

## 4. PostgreSQL `SET LOCAL` Trust Boundary & Connection Pool Safety
- The database trigger `trg_prevent_posted_journal_update_delete` mandates that `app.posting_authorized` evaluates to `'true'` for any `DRAFT -> POSTED` update.
- `GLEngine.postJournal()` executes `SET LOCAL app.posting_authorized = 'true'` inside the transaction block.
- Because `SET LOCAL` is transaction-scoped, PostgreSQL automatically clears the variable upon `COMMIT` or `ROLLBACK`.
- Connection pool safety tests confirm that subsequent queries on the same connection outside a transaction see `app.posting_authorized = NULL`, preventing authorization leakage across pooled connections.

## 5. Direct SQL Bypass Guard
- Direct SQL attempts to execute `UPDATE journal_entries SET status = 'POSTED' WHERE id = ...` without running through `GLEngine.postJournal()` fail with database exception: `Direct SQL transition from DRAFT to POSTED is forbidden. Postings must execute through GLEngine.postJournal().`

## 6. Exact Monetary & Balance Validation Reuse
- Reuses Phase 2.3.1 `ExactDecimal` and `JournalModel.validate()` contracts.
- Enforces max scale <= 2, zero-value rejection, non-negative check, debit XOR credit check, and exact balance (`SUM(debits) === SUM(credits)`).

## 7. Status Transition Protection
- **Allowed Transition**: `DRAFT -> POSTED`.
- **Forbidden Transitions Rejected**:
  - `POSTED -> POSTED` (`JOURNAL_NOT_DRAFT`)
  - `POSTED -> DRAFT` (`BusinessRuleViolationError`)
  - `POSTED -> CANCELLED` (`BusinessRuleViolationError`)
  - `CANCELLED -> POSTED` (`JOURNAL_NOT_DRAFT`)
  - `CANCELLED -> DRAFT` (`BusinessRuleViolationError`)

## 8. Rollback Behavior
- Injected failures (e.g. unbalanced lines, scale violations, or DB errors) trigger immediate SQL `ROLLBACK`.
- Verified that transaction rollback restores status to `DRAFT`, leaves `voucher_number = NULL`, and rolls back sequence increments in `numbering_sequences` with zero orphan gaps.

## 9. Concurrency Handling
- Tested with 100 concurrent posting requests for the same draft journal ID.
- Row-level lock (`SELECT ... FOR UPDATE`) guarantees exactly 1 request succeeds while 99 requests fail cleanly with status conflict errors.
- Exactly 1 voucher number is allocated and exactly 1 `POSTED` record is persisted in the database.

## 10. Security & Tenant Isolation
- Rejects requests where `ctx.tenantId` or `ctx.companyId` do not match the target journal entry (`TENANT_ACCESS_DENIED` / `COMPANY_ACCESS_DENIED`).
- Input contract prevents callers from supplying `voucherNumber`, `status = POSTED`, `postedBy`, or `postedAt`.

## 11. Typecheck, Build, and Test Results
- **`npm run typecheck`**: PASS (0 errors across all monorepo packages)
- **`npm run build`**: PASS
- **`npm test`**: PASS (143 passed out of 143 tests across 11 test files)

## 12. Deviations & Discovered Risks
- None.

## 13. Explicit Boundary Confirmations (Features NOT Implemented)
- **Phase 2.3.4 (Fiscal Period & COA Integration)**: NOT implemented (period closing guards and COA postable eligibility assertions remain in Phase 2.3.4).
- **Phase 2.3.5 (Numbering Engine Full Integration)**: NOT implemented (production sequence configuration rules remain in Phase 2.3.5).
- **Phase 2.3.6 (Dual-Layer Idempotency & Source Contract)**: NOT implemented.
- **Phase 2.3.7 (Append-Only Single-Reversal Engine)**: NOT implemented.
- **Phase 2.3.8 (GLPostedTransactionLookupAdapter)**: NOT implemented.
- **Phase 2.3.9 (Authorization, SoD & Audit)**: NOT implemented.
- **Phase 2.3.10 (REST API & Final Hardening)**: NOT implemented.
- **Subledgers (Sales, Procurement, AR, AP, Banking, GST)**: NOT implemented.
