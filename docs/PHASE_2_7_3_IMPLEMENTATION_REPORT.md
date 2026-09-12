# PHASE 2.7.3 IMPLEMENTATION REPORT: SUPPLIER PAYMENTS & UNAPPLIED CASH

## 1. SCOPE IMPLEMENTED

Phase 2.7.3 establishes the **Supplier Payment & Unapplied Cash** capability for the Accounts Payable (AP) subledger.

Implemented capabilities:
- **Supplier Payment Domain Model & DTOs**: `ApPaymentDTO`, `CreateApPaymentInput`, `UpdateApPaymentInput`, `PostApPaymentInput`, `ApPaymentFilterInput`.
- **Payment Modes Supported**: `CASH`, `BANK_TRANSFER`, `CHEQUE`, `UPI`, `OTHER`.
- **Payment Validation**: Strict multi-tenant/company isolation, active supplier verification, postable cash/bank account verification, SQL DATE validation, and `ExactDecimal` scale 2 monetary validation.
- **Payment Service (`ApPaymentService`)**: Complete lifecycle for draft creation, draft modification, posting, and reversal orchestration.
- **Accounting Engine & GL Posting**: Automatic GL posting via `AccountingCoreService` producing balanced journal entries (**DR AP_CONTROL**, **CR CASH/BANK**).
- **Unapplied Cash Invariant**: Posted payments are maintained with `allocated_amount = 0.00` and `unapplied_amount = total_amount`. Absolutely no invoice allocation or open item balance modifications occur during payment posting.
- **Numbering & Fiscal Validation**: Integration with `NumberingEngine` (sequence name `'PAYMENT'`) and `FiscalPeriodService` (assertion of open fiscal period).
- **Idempotency & Concurrency**: Layer 1/2 request idempotency, duplicate post protection, and database transaction protection with `SET LOCAL` authorization flags.
- **Audit & Security**: Comprehensive audit logging (`ApPayment::CREATE`, `ApPayment::UPDATE`, `ApPayment::POST`, `ApPayment::CANCEL`) with immutable SHA-256 hash chaining.

---

## 2. FILES CREATED & MODIFIED

| Action | File Path | Description |
| :--- | :--- | :--- |
| **CREATED** | `apps/api/src/modules/finance/ap/ap-payment-validator.ts` | Validation module for AP payment inputs, supplier context, bank/cash account eligibility, and decimal scale. |
| **CREATED** | `apps/api/src/modules/finance/ap/ap-payment.service.ts` | Core domain service managing supplier payment lifecycle, AccountingCore posting, unapplied cash tracking, and database transaction synchronization. |
| **CREATED** | `apps/api/test/phase2_7_3_payments.test.ts` | Test suite covering payment lifecycle, input validation, accounting invariants, rollback safety, idempotency, concurrency, security, and 200 randomized payment scenarios. |
| **CREATED** | `docs/PHASE_2_7_3_IMPLEMENTATION_REPORT.md` | Implementation and Verification Report for Phase 2.7.3. |
| **MODIFIED** | `apps/api/src/modules/finance/ap/ap-payment-model.ts` | Defined input DTOs, filter interfaces, and type aliases for AP payment operations. |
| **MODIFIED** | `apps/api/src/modules/finance/ap/index.ts` | Exported `ap-payment-validator.ts` and `ap-payment.service.ts` from AP module index. |
| **MODIFIED** | `docs/IMPLEMENTATION_STATUS.md` | Updated roadmap status for Phase 2.7.3 to `COMPLETE / APPROVED`. |

---

## 3. PAYMENT LIFECYCLE & IMMUTABILITY

1. **DRAFT Creation**:
   - `createDraft(ctx, input)` validates supplier and paying bank/cash account eligibility.
   - Initial state: `status = 'DRAFT'`, `allocated_amount = '0.00'`, `unapplied_amount = total_amount`.
2. **DRAFT Update**:
   - `updateDraft(ctx, id, input)` permits updating amounts, dates, remarks, or paying account while in `DRAFT` status.
   - Rejects updates if the payment is in `POSTED` or `REVERSED` status with `BusinessRuleViolationError`.
3. **POSTED State**:
   - `postPayment(ctx, id, postInput)` transitions `DRAFT -> POSTED`.
   - Generates unique sequential payment number via `NumberingEngine`.
   - Posts balanced GL entry through `AccountingCoreService`.
   - Sets `journal_entry_id` and marks payment `POSTED`.
   - Posted financial fields are strictly immutable under Phase 2.7.2 database trigger protection.
4. **REVERSED State**:
   - `reversePayment(ctx, id, reason)` orchestrates append-only GL reversal via `AccountingCoreService` and sets status `REVERSED`. Re-posting a reversed payment is forbidden.

---

## 4. ACCOUNTING BEHAVIOR

Posting a supplier payment executes a debit operation against AP liability and credits the designated paying cash/bank account:

```text
Debit:  AP_CONTROL (Accounts Payable Liability)       [total_amount]
Credit: CASH_BANK  (Selected Bank / Petty Cash)       [total_amount]
```

- **Event Type**: `AP_PAYMENT`
- **Source Module**: `AP`
- **Source Document Type**: `PAYMENT`
- **Validation**: Enforces `Total Debit == Total Credit`. Uses `AccountingCoreService` to resolve account codes/mappings and assert postable status.

---

## 5. UNAPPLIED BALANCE MODEL

Every newly posted payment is initialized with:
$$\text{allocated\_amount} = 0.00$$
$$\text{unapplied\_amount} = \text{total\_amount}$$
$$\text{allocated\_amount} + \text{unapplied\_amount} = \text{total\_amount}$$

- No invoice open items are modified or matched during payment creation or posting.
- No allocation records (`ap_allocations`) are created.
- Unapplied cash balances are maintained until explicitly consumed by the AP Allocation Engine (Phase 2.7.4).

---

## 6. NUMBERING & FISCAL VALIDATION

- **Numbering Engine**: Payment numbers are generated atomically using sequence key `'PAYMENT'` bound to `(tenant_id, company_id, fiscal_year, branch)`.
- **Fiscal Period Service**: Validates accounting date against `FiscalPeriodService`. Ensures the target period exists and is in `OPEN` status before posting. Rejects postings into closed fiscal periods.

---

## 7. IDEMPOTENCY, CONCURRENCY & TRANSACTION ROLLBACK

- **Idempotency**: Repeated calls to `postPayment` for an already `POSTED` payment return the existing payment DTO without duplicate GL posting or number generation.
- **Concurrency**: Tested across 100 concurrent posting attempts for a single payment. Guaranteed single GL journal posting and single payment number assignment. Tested 100 concurrent independent payments with zero sequence collisions.
- **Transaction Rollback**: If GL posting, AccountingCore, or persistence fails (e.g. injected failure via `simulateFailure: true`), the payment state remains in `DRAFT` status without orphan journals or partial records.

---

## 8. AUTHORIZATION & AUDIT

- **Permissions Checked**:
  - `ap:payment:create`: Creating draft payments.
  - `ap:payment:update`: Updating draft payments.
  - `ap:payment:read`: Viewing payment details and lists.
  - `ap:payment:post`: Posting supplier payments.
  - `ap:payment:cancel`: Reversing posted supplier payments.
- **Audit Logging**: Logs structured audit events (`ApPayment::CREATE`, `ApPayment::UPDATE`, `ApPayment::POST`, `ApPayment::CANCEL`) with tenant/company context, actor ID, and cryptographic SHA-256 hash chaining.

---

## 9. TEST RESULTS

Executed full test suite across 38 test files:

```text
Test Files  38 passed (38)
     Tests  544 passed (544)
  Duration  9.50s
```

### Phase 2.7.3 Specific Test Coverage (`apps/api/test/phase2_7_3_payments.test.ts`):
1. **Payment Creation & Input Validation** (5 tests): Valid creation, cross-tenant supplier rejection, cross-company bank account rejection, scale/negative/zero amount checks, payment mode validation.
2. **Payment Lifecycle & Immutability** (2 tests): Draft update, posted update rejection, clean reversal, reversed re-post rejection.
3. **AccountingCore Integration & Unapplied Cash Invariants** (2 tests): Balanced GL posting, zero allocation side effects, untouched open items.
4. **Transaction Rollback & Idempotency** (4 tests): Failure rollback, duplicate post idempotency, 100-concurrency single-GL lock, 100-concurrency sequence allocation.
5. **Security & Mass Assignment Protection** (2 tests): Prevention of client-crafted status injection, cross-tenant access rejection.
6. **200 Randomized Financial Payment Scenarios** (1 test): 200 randomized payments across all payment modes with exact decimal unapplied cash invariants.

---

## 10. KNOWN LIMITATIONS & DEFERRED ITEMS

The following capabilities are explicitly deferred to later subphases as defined in `docs/PHASE_2_7_IMPLEMENTATION_PLAN.md`:
- **Phase 2.7.4**: AP Polymorphic Allocation Engine (Allocating payments/credit notes to supplier bill open items).
- **Phase 2.7.5**: AP Settlement & Reconciliation Engine.
- **Phase 2.7.6**: AP Adjustments & Write-offs (Debit/credit adjustments and supplier write-offs).
- **Phase 2.7.7**: AP Aging & Supplier Statements.
- **Phase 2.7.8**: AP REST API & Controllers.
- **Phase 2.7.9**: AP Final Verification & Performance Hardening.

---

## 11. VERIFICATION COMMANDS

- `npm run typecheck` — Passed with 0 errors.
- `npm run build` — Passed with 0 errors.
- `npm test` — Passed with 38/38 test files, 544/544 total tests passing.

---

## 12. FINAL SCOPE & INTEGRITY REVIEW

### 12.1 Payment Reversal Scope Decision
- **Architectural Alignment**: Payment reversal (`reversePayment`) is confirmed as a **foundational payment lifecycle capability**, mirroring the established AR receipt lifecycle from Phase 2.6.3 (`ArReceiptService.reverseReceipt`).
- **Boundary Guarantee**: The reversal method orchestrates append-only GL journal reversal through `AccountingCoreService` and transitions payment status `POSTED -> REVERSED`. It does not perform open item allocation, settlement, or write-off logic (which remain strictly deferred to 2.7.4–2.7.6).

### 12.2 Database-Authoritative Posted Payment Immutability
- **PL/pgSQL Immutability Trigger**: Extended `packages/database/migrations/009_phase2_7_2_ap_immutability.sql` with trigger function `trg_prevent_posted_ap_payment_update_delete()` attached to `ap_payments`.
- **Immutable Financial Core Fields**: Direct SQL attempts to `DELETE` or `UPDATE` core fields (`supplier_id`, `payment_number`, `payment_date`, `accounting_date`, `payment_mode`, `bank_account_id`, `total_amount`, `journal_entry_id`, `tenant_id`, `company_id`) on `POSTED` or `REVERSED` payments fail unconditionally.
- **Forbidden Status Transitions**: Direct SQL transitions `POSTED -> DRAFT` and `DRAFT -> POSTED` without transaction-local authorization (`SET LOCAL app.ap_posting_authorized = 'true'`) are blocked.

### 12.3 Classification of Payment Fields & Authorization Boundaries
- **Strictly Immutable Fields**: `tenant_id`, `company_id`, `supplier_id`, `payment_number`, `payment_date`, `accounting_date`, `payment_mode`, `bank_account_id`, `total_amount`, `journal_entry_id`.
- **Domain-Controlled Mutable Balances**: `allocated_amount` and `unapplied_amount`. Mutations on these fields require explicit transaction-scoped session authorization (`app.ap_allocation_authorized = 'true'`, `app.ap_settlement_authorized = 'true'`, or `app.posting_authorized = 'true'`). Direct SQL mutations fail with PL/pgSQL exceptions.

### 12.4 Mass Assignment & Server Control
- **Server Control**: `status`, `allocatedAmount`, `unappliedAmount`, `journalEntryId`, and `paymentNumber` are strictly server-controlled in `ApPaymentService`. Input payloads cannot override draft initialization or force posted status.

