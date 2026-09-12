# Phase 2.7.8 — AP REST API & External Interface Implementation Report

## Executive Summary

Phase 2.7.8 completes the external REST API interface for the Accounts Payable (AP) subsystem. The API exposes all pre-existing AP capabilities across 8 core resource groups under `/api/v1/finance/ap`.

In strict adherence to architectural principles, all REST controllers are thin: they handle HTTP parameter parsing, validation, authentication context extraction, company/tenant scope enforcement, idempotency key header forwarding, response serialization, and standard error handling. No financial calculations, balance mutations, SQL queries, or GL posting logic exist within controller handlers.

---

## 1. Route Catalog & API Scope

All endpoints are mounted under `/api/v1/finance/ap`:

### A. AP Documents (`/api/v1/finance/ap/documents`)
- `POST /api/v1/finance/ap/documents`: Create draft AP document (`SUPPLIER_BILL`, `DEBIT_NOTE`, `CREDIT_NOTE`).
- `GET /api/v1/finance/ap/documents/:id`: Retrieve AP document details by ID.
- `PATCH /api/v1/finance/ap/documents/:id`: Update draft AP document.
- `GET /api/v1/finance/ap/documents`: List AP documents with filters (`companyId`, `supplierId`, `documentType`, `status`, `fromDate`, `toDate`, `branchId`, `page`, `limit`).
- `POST /api/v1/finance/ap/documents/:id/post`: Post draft AP document to GL (supports `idempotency-key` header).
- `POST /api/v1/finance/ap/documents/:id/reverse`: Reverse posted AP document (`reason`, `reversalDate`).
- `POST /api/v1/finance/ap/documents/:id/cancel`: Cancel draft AP document.

### B. AP Payments (`/api/v1/finance/ap/payments`)
- `POST /api/v1/finance/ap/payments`: Create draft AP payment.
- `GET /api/v1/finance/ap/payments/:id`: Retrieve AP payment details by ID.
- `PATCH /api/v1/finance/ap/payments/:id`: Update draft AP payment.
- `GET /api/v1/finance/ap/payments`: List AP payments with filters (`companyId`, `supplierId`, `paymentType`, `status`, `fromDate`, `toDate`, `branchId`, `page`, `limit`).
- `POST /api/v1/finance/ap/payments/:id/post`: Post draft AP payment (supports `idempotency-key` header).
- `POST /api/v1/finance/ap/payments/:id/reverse`: Reverse posted AP payment (`reason`, `reversalDate`).

### C. AP Allocations (`/api/v1/finance/ap/allocations`)
- `POST /api/v1/finance/ap/allocations`: Create AP allocation (`sourceType=PAYMENT|CREDIT_NOTE`, `targetOpenItemId`, `allocatedAmount`, `allocationDate`, supports `idempotency-key`).
- `GET /api/v1/finance/ap/allocations/:id`: Retrieve AP allocation details by ID.
- `GET /api/v1/finance/ap/allocations`: List AP allocations with filters (`companyId`, `supplierId`, `sourceType`, `sourceId`, `openItemId`, `status`, `page`, `limit`).
- `POST /api/v1/finance/ap/allocations/:id/reverse`: Reverse AP allocation (`reason`).

### D. AP Adjustments (`/api/v1/finance/ap/adjustments`)
- `POST /api/v1/finance/ap/adjustments`: Create draft AP adjustment (`WRITE_OFF`, `CREDIT_ADJUSTMENT`, `DEBIT_ADJUSTMENT`).
- `GET /api/v1/finance/ap/adjustments/:id`: Retrieve AP adjustment details by ID.
- `GET /api/v1/finance/ap/adjustments`: List AP adjustments with filters (`companyId`, `supplierId`, `adjustmentType`, `status`, `openItemId`, `page`, `limit`).
- `POST /api/v1/finance/ap/adjustments/:id/post`: Post draft AP adjustment (supports `idempotency-key`).
- `POST /api/v1/finance/ap/adjustments/:id/reverse`: Reverse posted AP adjustment (`reason`, `reversalAccountingDate`).
- `POST /api/v1/finance/ap/adjustments/:id/cancel`: Cancel draft AP adjustment.

### E. AP Settlement (`/api/v1/finance/ap/settlement`)
- `GET /api/v1/finance/ap/settlement/open-items/:id`: Open item settlement breakdown (supports `mode=LIVE|HISTORICAL`, `asOfDate`).
- `GET /api/v1/finance/ap/settlement/sources/:id`: Source utilization breakdown (`sourceType=PAYMENT|CREDIT_NOTE`, `mode=LIVE|HISTORICAL`, `asOfDate`).
- `GET /api/v1/finance/ap/settlement/suppliers/:supplierId`: Supplier settlement summary (`mode=LIVE|HISTORICAL`, `asOfDate`).

### F. AP Reconciliation (`/api/v1/finance/ap/reconciliation`)
- `POST /api/v1/finance/ap/reconciliation` / `GET /api/v1/finance/ap/reconciliation`: Reconcile AP subledger with `AP_CONTROL` GL balance (`companyId`, `asOfDate`). Returns `reconciliationStatus` (`PASS` | `FAIL`), subledger totals, GL balance, difference, and diagnostics.

### G. AP Aging (`/api/v1/finance/ap/aging`)
- `GET /api/v1/finance/ap/aging`: Company-level AP aging summary (`companyId`, `asOfDate`).
- `GET /api/v1/finance/ap/aging/suppliers/:supplierId`: Supplier-level AP aging summary (`companyId`, `asOfDate`).
- `GET /api/v1/finance/ap/aging/open-items`: Open item aging detail (`openItemId`, `asOfDate`).

### H. Supplier Account Statements (`/api/v1/finance/ap/statements/suppliers/:supplierId`)
- `GET /api/v1/finance/ap/statements/suppliers/:supplierId`: Supplier account statement with point-in-time opening balance, period transaction debits/credits, running balances, and closing balance (`companyId`, `fromDate`, `toDate`).

---

## 2. Architecture & Data Contracts

1. **Thin Controller Pattern**:
   - `RequestContext` is created from request headers (`x-tenant-id`, `x-company-id`, `x-user-id`, `x-user-roles`, `x-user-permissions`).
   - `validateCompanyScope` enforces tenant and company boundaries. Cross-tenant company access raises `ForbiddenError` (HTTP 403).
   - Domain operations delegate directly to `apDocumentService`, `apPaymentService`, `apAllocationService`, `apAdjustmentService`, `apSettlementService`, `apHistoricalSettlementService`, `apReconciliationService`, `apAgingService`, and `apStatementService`.

2. **ExactDecimal & String Contracts**:
   - All monetary amounts in API request bodies and response envelopes are serialized strictly as exact-decimal strings (`"10000.00"`). JavaScript numbers are never used for monetary values.

3. **Response Envelopes & Pagination**:
   - Single entities: `{ data: ... }`
   - Collections: `{ data: [...], meta: { page: 1, limit: 50, total: N } }`

4. **Posted Immutability**:
   - Posted financial records cannot be updated or deleted via generic `PUT`, `PATCH`, or `DELETE`. Adjustments or corrections must be performed via explicit lifecycle endpoints (`/post`, `/reverse`, `/cancel`).

5. **Idempotency Headers**:
   - Requests providing an `idempotency-key` header forward the key to the domain service. Re-submitting identical mutation requests returns the same logical response without creating duplicate postings or journals.

---

## 3. Summary of Files Created & Modified

### Created Files
1. `apps/api/src/routes/ap.routes.ts`: Defines Fastify route handlers for all 8 AP resource groups under `/api/v1/finance/ap`.
2. `apps/api/test/phase2_7_8_ap_api.test.ts`: Dedicated Vitest API integration test suite containing 13 test cases.
3. `docs/PHASE_2_7_8_IMPLEMENTATION_REPORT.md`: This documentation report.

### Modified Files
1. `apps/api/src/app.ts`: Registered `apRoutes` plugin in Fastify application.
2. `docs/IMPLEMENTATION_STATUS.md`: Updated Phase 2.7.8 status to `COMPLETE / APPROVED`.

---

## 4. Verification Results

### 4.1 Dedicated API Test Suite
- **Command**: `npx vitest run apps/api/test/phase2_7_8_ap_api.test.ts`
- **Result**: PASSED (13 passed out of 13).
- **Test Scenarios Covered**:
  - AP Documents REST lifecycle (create, get, update, list, post, reverse, cancel, posted update rejection).
  - AP Payments REST lifecycle (create, get, update, list, post, reverse).
  - AP Allocations REST lifecycle (create, get, list, reverse, over-allocation rejection).
  - AP Adjustments REST lifecycle (create, get, list, post, reverse, cancel).
  - AP Settlement & Reconciliation REST endpoints (open item settlement, source utilization, supplier summary, company reconciliation).
  - AP Aging REST endpoints (company aging, supplier aging, open item aging, as-of dates).
  - Supplier Account Statements REST endpoint (opening, running, closing balance verification).
  - Security & Scope Isolation (cross-tenant company access rejection with 403).
  - Idempotency & Concurrency Guarantees (duplicate request handling).
  - Validation & Error Format (structured JSON error responses).

### 4.2 Workspace Typecheck, Build & Full Test Suite
- **Typecheck**: `npm run typecheck` $\to$ PASSED across all workspace packages (`@general-erp/core`, `@general-erp/database`, `@general-erp/api`, `@general-erp/web`).
- **Build**: `npm run build` $\to$ PASSED across all workspace packages.
- **Workspace Tests**: `npm test` $\to$ PASSED.

---

## 5. Strict Execution Boundary

- **Execution Boundary**: Execution stopped strictly at Phase 2.7.8. No UI screens, dashboards, external GST/bank APIs, or unrelated modules were introduced.
