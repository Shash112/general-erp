# Phase 2.3.2 Completion Report — Draft Journal Lifecycle

## 1. Scope Implemented
Phase 2.3.2 implements the application/domain service for managing draft manual journal entries:
- **`JournalDraftService` creation (`createDraft`)**
- **`JournalDraftService` update (`updateDraft`)**
- **`JournalDraftService` cancellation (`cancelDraft`)**
- **`JournalDraftService` retrieval (`getDraftById`)**

## 2. Files Changed / Created
- `apps/api/src/modules/finance/journal-draft.service.ts` (NEW: Implemented `JournalDraftService` handling atomic creation, updates, and cancellations of draft journals with optimistic concurrency and exact decimal validation).
- `apps/api/test/phase2_3_2_draft.test.ts` (NEW: Comprehensive test suite for Phase 2.3.2 covering happy paths, negative rejections, atomicity rollbacks, mass assignment protection, concurrency, tenant/company isolation, and sequence non-consumption).
- `apps/api/src/modules/finance/journal-model.ts` (UPDATED: Made DTO line fields permit `null | undefined` for strict TypeScript compatibility with `exactOptionalPropertyTypes`).
- `docs/PHASE_2_3_2_COMPLETION_REPORT.md` (NEW: This completion report).

## 3. Draft Lifecycle State Transitions
The service manages strictly the draft lifecycle state transitions:
```text
(New) ---> DRAFT
  DRAFT -> DRAFT (Update)
  DRAFT -> CANCELLED (Cancel)
```
Forbidden transitions strictly rejected:
- `POSTED -> DRAFT` / `POSTED -> CANCELLED` / `POSTED -> POSTED`
- `CANCELLED -> DRAFT` / `CANCELLED -> POSTED` / `CANCELLED -> CANCELLED`
- `DRAFT -> POSTED` (Reserved strictly for Phase 2.3.3 Atomic Posting Engine)

## 4. Create Behavior
- Validates tenant, company, entry metadata, and line entries using Phase 2.3.1 Journal Model validation rules (`validateJournalEntryDTO`).
- Enforces debit/credit XOR, non-zero line amounts, positive scale limits (exact 4 decimal places max), unique line sequence numbers, and total balance equality.
- Sets `status = 'DRAFT'`.
- Sets `voucherNumber = NULL` (never calls `NumberingEngine`).
- Persists journal header and lines transactionally in PostgreSQL within a single DB transaction.

## 5. Update Behavior
- Only journals with `status = 'DRAFT'` may be updated. Attempts to update `POSTED` or `CANCELLED` journals are rejected with domain errors (`JOURNAL_NOT_DRAFT` or `JOURNAL_ALREADY_CANCELLED`).
- Replaces journal header metadata and all journal lines atomically within a database transaction.
- Recalculates total debit and total credit from replacement lines using exact decimal arithmetic.
- Increments optimistic concurrency version (`version = version + 1`).

## 6. Cancellation Behavior
- Transitions `status` from `DRAFT` to `CANCELLED`.
- Retains persisted historical record and lines without deleting or creating reversal entries.
- Does NOT consume voucher numbers or post financial transactions.

## 7. Transaction Boundaries
- All mutations (`createDraft`, `updateDraft`, `cancelDraft`) execute inside real database transactions (`db.transaction`).
- Rollback tests confirm that any insertion failure causes complete rollback of header and lines with zero orphaned records left in DB tables.

## 8. Concurrency Handling
- Enforces optimistic concurrency locking via the `version` column.
- Concurrent updates specifying an outdated version fail with `CONCURRENT_MODIFICATION` error, preventing silent lost updates.

## 9. Exact Monetary Validation Reuse
- Reuses Phase 2.3.1 `ExactDecimal` and `validateJournalEntryDTO` without duplicating monetary logic or floating-point rounding.

## 10. Authorization & Tenant Isolation
- Enforces context-based tenant/company matching (`tenantId` and `companyId` from `RequestContext`).
- Attempts to operate across tenant or company boundaries fail with `TENANT_ACCESS_DENIED` / `COMPANY_ACCESS_DENIED`.
- Mass assignment protection strictly filters client input: `id`, `tenantId`, `companyId`, `createdBy`, `createdAt`, `postedBy`, `postedAt`, `voucherNumber`, `status`, and `version` cannot be modified via update DTOs.

## 11. Tests Executed
Dedicated Vitest test file: `apps/api/test/phase2_3_2_draft.test.ts`
- **Creation Tests**: Valid draft creation, line persistence, exact totals, null voucher number.
- **Negative Validation Tests**: Unbalanced entry, invalid scale, zero amounts, debit+credit both set, neither set, negative amounts, duplicate line sequence.
- **Update Tests**: Valid draft update, atomic line replacement, version increment, total recalculation.
- **Negative Update Tests**: Rejection of updating `POSTED` or `CANCELLED` journals, invalid scale, unbalanced updates.
- **Cancellation Tests**: Transition `DRAFT -> CANCELLED`, rejection of `POSTED -> CANCELLED`, `CANCELLED -> CANCELLED`, `CANCELLED -> DRAFT`.
- **Tenant & Company Isolation Tests**: Rejection of cross-tenant and cross-company updates/cancellations.
- **Mass Assignment Defense Tests**: Protection of system fields against client tampering.
- **Optimistic Concurrency Tests**: Verification of `CONCURRENT_MODIFICATION` failure on concurrent update.
- **Transaction Rollback Tests**: Header and line insertion rollback on failure.
- **NumberingEngine Regression Tests**: Verification that sequence numbers remain untouched across draft operations.

## 12. Typecheck, Build, and Test Results
- **`npm run typecheck`**: PASS (0 errors)
- **`npm run build`**: PASS
- **`npm test`**: PASS (129 passed out of 129 tests across 10 test files)

## 13. Deviations
- None.

## 14. Discovered Risks
- None.

## 15. Explicit Boundary Confirmations
- **GLEngine.postJournal()**: NOT implemented.
- **Atomic Posting Transaction**: NOT implemented.
- **Reversal Engine (`reverseJournal()`)**: NOT implemented.
- **NumberingEngine Integration**: NOT implemented (voucher numbers remain `NULL`).
- **FiscalPeriod / COA Integration**: NOT implemented.
- **REST API Routes**: NOT implemented (reserved for Phase 2.3.10).
- **PostgreSQL Posting Authorization Guard**: Untouched (`app.posting_authorized` was never set).
