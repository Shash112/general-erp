# Phase 2.3.7 Completion Report — Append-Only Single-Reversal Engine

## 1. Executive Summary

Phase 2.3.7 implements the financial reversal and correction engine for the General Ledger. In accordance with accounting invariants, posted general ledger transactions are strictly immutable; corrections are executed exclusively via append-only reversal entries (`reverseJournal`) that create balanced counter-journals linked back to the original entry via `originalJournalId`.

---

## 2. Core Architecture & Rules Implemented

1. **Original Journal Immutability**: The original posted journal entry remains in `status = 'POSTED'` with its header, lines, and version completely unmodified.
2. **One-Level Reversal Graph**: Reversing a reversal journal is strictly prohibited (`targetJournal.originalJournalId == null`). Attempts throw `BusinessRuleViolationError("Reversal of a reversal journal is strictly prohibited.")`.
3. **Single Reversal Guarantee**: A posted journal entry may be reversed at most once. Enforced at the service boundary and backed by PostgreSQL unique index `idx_je_tenant_comp_original_journal` on `(tenant_id, company_id, original_journal_id) WHERE original_journal_id IS NOT NULL`.
4. **Target Status Assertion**: Reversal operations require the target entry to be in `POSTED` status. Reversing `DRAFT` or `CANCELLED` entries throws `BusinessRuleViolationError`.
5. **Debit/Credit Line Swapping**: Every line from the original journal entry is mirrored in the reversal entry with swapped debit and credit amounts (`debitAmount = line.creditAmount`, `creditAmount = line.debitAmount`).
6. **Period Resolution**: Reversal entries are posted to an `OPEN` fiscal period. If the original period remains open, the original accounting date is retained. If closed, the entry is posted to the active open period.
7. **Transactional Voucher Numbering**: Reversal journals receive a dedicated unique voucher sequence (e.g. `REV-2026-0001`).
8. **Tenant & Company Isolation**: Reversals are strictly scoped by `tenantId` and `companyId`. Cross-tenant or cross-company attempts throw `NotFoundError`.

---

## 3. Code Modifications

- **`apps/api/src/modules/finance/gl-engine.ts`**:
  - Exported `ReverseJournalInput` interface.
  - Added public `reverseJournal(ctx, input)` method.
  - Implemented `reverseJournalDb` for PostgreSQL transactions with session variable `SET LOCAL app.posting_authorized = 'true'` and database lock `FOR UPDATE`.
  - Implemented `reverseJournalInMemory` for unit testing with concurrency lock protection.
- **`apps/api/test/phase2_3_7_reversal.test.ts`**:
  - Added 9 unit and integration tests covering reversal creation, debit/credit line swapping, original immutability, reversal-of-reversal prohibition, duplicate reversal rejection, non-existent entry handling, request idempotency, tenant boundary isolation, and 100 concurrent reversal requests.

---

## 4. Verification & Test Results

```text
> npm run typecheck
@general-erp/core: tsc --noEmit (0 errors)
@general-erp/database: tsc --noEmit (0 errors)
@general-erp/api: tsc --noEmit (0 errors)
@general-erp/web: tsc --noEmit (0 errors)

> npm run build
@general-erp/core, @general-erp/database, @general-erp/ui, @general-erp/api, @general-erp/web (Built successfully)

> npm test
Test Files  15 passed (15)
     Tests  198 passed (198)
```

---

## 5. Implementation Status Update

```text
PHASE 2.3.7 IMPLEMENTATION: COMPLETE
PHASE 2.3.7 VERIFICATION: PASS

PHASE 2.3.0: APPROVED
PHASE 2.3.1: APPROVED
PHASE 2.3.2: APPROVED
PHASE 2.3.3: APPROVED
PHASE 2.3.4: APPROVED
PHASE 2.3.5: APPROVED
PHASE 2.3.6: APPROVED
PHASE 2.3.7: APPROVAL REQUIRED
PHASE 2.3.8: NOT STARTED

NEXT ACTION: EXTERNAL REVIEW / APPROVAL REQUIRED FOR PHASE 2.3.8
```
