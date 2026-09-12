# Phase 2.3.6 Completion Report — Dual-Layer Idempotency & Source Contract

## 1. Executive Summary

Phase 2.3.6 establishes the financial duplicate-prevention boundary for General Ledger posting. In a production accounting system, duplicate posting is a critical financial integrity failure. This phase implements two distinct but complementary layers of idempotency:

1. **Layer 1 — Request/API Idempotency**: Protects against repeated execution of the same request key (e.g. network retries, client double-submits, integration retries).
2. **Layer 2 — Business Source Idempotency**: Protects against duplicate financial posting of the same source business document (e.g. Sales Invoice `INV-1001`, Purchase Invoice, Payroll Run) across different API request keys or manual journal drafts.

Both layers are strictly tenant- and company-isolated, fully transactional, and enforced at the database level by PostgreSQL unique constraints and atomic in-memory locking.

---

## 2. Architecture & Design Principles

### 2.1 Request Identity vs Business Source Identity
The system maintains a strict conceptual separation between:
* **Request Identity**: Identified by `Idempotency-Key` header / parameter. Answers *"Did I already process this exact API request?"*
* **Business Source Identity**: Identified by `(tenantId, companyId, sourceModule, sourceDocumentType, sourceDocumentId)`. Answers *"Did this source business document already produce a General Ledger posting?"*

### 2.2 Layer 1 — Request Idempotency Semantics
* **Identity Key Scope**: `tenantId:companyId:idempotencyKey`.
* **Payload Fingerprinting**: Canonical SHA-256 hash computed over sorted request parameters (`entryDate`, `postingDate`, `currency`, `lines`, `sourceModule`, `sourceDocumentId`, etc.).
* **First Request**: Executes posting inside the database transaction, persists the `JournalEntryDTO` result, and returns the result.
* **Identical Retry**: Same key + same fingerprint returns the stored `POSTED` result immediately without re-executing period validation, COA checks, voucher sequence allocation, or GL line insertion. Consumes 0 additional voucher numbers.
* **Payload Mismatch Conflict**: Same key + different fingerprint throws `IDEMPOTENCY_KEY_REUSE_CONFLICT` (`ConflictError`).
* **In-Flight Concurrency**: Concurrent requests with the same key attach to an in-flight promise. The first request completes posting, while subsequent requests await the single execution result.
* **Retention Policy**: Request idempotency records persist in `idempotency_keys` with a 24-hour TTL. Expiry of an API idempotency key **never** allows re-posting of the underlying business source document.

### 2.3 Layer 2 — Business Source Idempotency Semantics
* **Authoritative Boundary**: Postgres partial unique index `idx_je_tenant_comp_src_doc` on `journal_entries (tenant_id, company_id, source_module, source_document_id)` where `source_module IS NOT NULL AND source_document_id IS NOT NULL AND status != 'CANCELLED'`.
* **Cross-Key Duplicate Prevention**: If Request A (`Key-1`) posts Sales Invoice `INV-1001`, and Request B (`Key-2`) later attempts to post Sales Invoice `INV-1001`, Layer 1 allows Request B to proceed, but Layer 2 rejects Request B with `SOURCE_DOCUMENT_ALREADY_POSTED` (`BusinessRuleViolationError`).
* **Voucher Number Preservation**: Source uniqueness violations occur before or within the transaction; PostgreSQL constraint catches race conditions. The transaction rolls back cleanly, consuming 0 voucher sequence numbers.
* **Posted Immutability**: Once posted, `sourceModule`, `sourceDocumentType`, `sourceDocumentId`, `voucherNumber`, and `status` cannot be altered.

---

## 3. Implementation Details

### 3.1 Idempotency Service (`apps/api/src/platform/idempotency/idempotency.service.ts`)
* Implemented `IdempotencyService` with dual-storage architecture (SQL `idempotency_keys` table + in-memory store for test environment).
* Canonical payload hash algorithm (`computeFingerprint`): standardizes property ordering and serializes arrays deterministically.
* Concurrent request queueing via `inFlightClaims` deferred promise map.

### 3.2 GL Engine Integration (`apps/api/src/modules/finance/gl-engine.ts`)
* Updated `postJournalDb` and `postJournalInMemory` to execute Layer 1 request idempotency check/claim prior to posting.
* Added source document parameter validations and explicit duplicate check against posted entries.
* Wrapped database constraint violations (`23505` on `idx_je_tenant_comp_src_doc`) into domain-level `BusinessRuleViolationError("SOURCE_DOCUMENT_ALREADY_POSTED: ...")`.
* Ensured transaction rollback cleanly releases in-flight idempotency claims and sequence numbers.

---

## 4. Verification & Test Results

A comprehensive test suite was added in `apps/api/test/phase2_3_6_idempotency.test.ts`.

### 4.1 Test Matrix

| # | Test Description | Result |
|---|------------------|--------|
| 1 | First request with idempotency key posts successfully | **PASS** |
| 2 | Duplicate request with same key + same payload returns original result without re-posting | **PASS** |
| 3 | Duplicate request with same key + different payload throws `IDEMPOTENCY_KEY_REUSE_CONFLICT` | **PASS** |
| 4 | Same idempotency key across different tenants remains isolated | **PASS** |
| 5 | Same idempotency key across different companies remains isolated | **PASS** |
| 6 | 100 concurrent requests with same key produce exactly 1 GL posting and consume 1 voucher | **PASS** |
| 7 | Duplicate request attempts consume zero additional voucher numbers | **PASS** |
| 8 | Same source document cannot post twice even with different idempotency keys | **PASS** |
| 9 | Duplicate source document attempt throws `SOURCE_DOCUMENT_ALREADY_POSTED` | **PASS** |
| 10| Same source document across different tenants remains independent | **PASS** |
| 11| Same source document across different companies remains independent | **PASS** |
| 12| Different source documents post independently and allocate consecutive vouchers | **PASS** |
| 13| Transaction rollback releases idempotency claim and permits retry | **PASS** |
| 14| Transaction rollback does not permanently claim source document identity | **PASS** |
| 15| 100 concurrent requests with same source document produce exactly 1 GL posting | **PASS** |
| 16| Direct modification of posted journal source contract or voucher number throws error | **PASS** |

### 4.2 Repository Verification Status

```text
> npm run typecheck
@general-erp/core: tsc --noEmit (0 errors)
@general-erp/database: tsc --noEmit (0 errors)
@general-erp/api: tsc --noEmit (0 errors)
@general-erp/web: tsc --noEmit (0 errors)

> npm run build
@general-erp/core, @general-erp/database, @general-erp/ui, @general-erp/api, @general-erp/web (Built successfully)

> npm test
Test Files  14 passed (14)
     Tests  189 passed (189)
```

---

## 5. Implementation Status

```text
PHASE 2.3.6 IMPLEMENTATION: COMPLETE
PHASE 2.3.6 VERIFICATION: PASS

PHASE 2.3.0: APPROVED
PHASE 2.3.1: APPROVED
PHASE 2.3.2: APPROVED
PHASE 2.3.3: APPROVED
PHASE 2.3.4: APPROVED
PHASE 2.3.5: APPROVED
PHASE 2.3.6: APPROVAL REQUIRED
PHASE 2.3.7: NOT STARTED

NEXT ACTION: EXTERNAL REVIEW / APPROVAL REQUIRED
```
