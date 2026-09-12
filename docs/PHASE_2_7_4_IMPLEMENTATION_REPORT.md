# PHASE 2.7.4 IMPLEMENTATION REPORT: AP POLYMORPHIC ALLOCATION ENGINE

## 1. SCOPE IMPLEMENTED

Phase 2.7.4 establishes the **Polymorphic Accounts Payable (AP) Allocation Engine**, allowing supplier payments and credit notes to be allocated against open supplier bills, debit notes, and opening balance open items.

Implemented capabilities:
- **Polymorphic Source Model**: Supports allocation from `PAYMENT` or `CREDIT_NOTE` sources.
- **Source Exclusivity**: Enforces strict database XOR validation (`payment_id IS NOT NULL AND credit_note_id IS NULL` OR `credit_note_id IS NOT NULL AND payment_id IS NULL`).
- **Target Model**: Allocates against `ap_open_items` with status `OPEN` or `PARTIALLY_SETTLED`.
- **Source Eligibility**: Requires source `ApPayment` or `ApDocument` (Credit Note) to be in `POSTED` or `PARTIALLY_SETTLED` status. Rejects draft, reversed, or cancelled sources.
- **Same-Supplier & Multi-Tenant Enforcement**: Strictly forbids cross-supplier allocations (`BusinessRuleViolationError`) and cross-tenant/company allocations (`ForbiddenError`).
- **Prompt Payment Discount & Accounting**: Supports optional prompt payment discount (`discountAmount`). Discount reduces target open-item balance without consuming payment unapplied balance, posting balanced GL entries via `AccountingCoreService` (**DR AP_CONTROL**, **CR PURCHASE_DISCOUNT_INCOME**).
- **Deterministic Lock Ordering**: Uses sorted lock keys `[sourceId, openItemId]` to prevent race conditions and deadlocks under concurrent load.
- **Database Authorization**: Operates within PostgreSQL transactions setting `SET LOCAL app.ap_allocation_authorized = 'true'` to mutate open item and payment balances safely through trigger guards.
- **Allocation Reversal**: Supports atomic allocation reversal (`reverseAllocation`), restoring source unapplied balances and target open-item outstanding balances without physical record deletion.
- **Idempotency & Concurrency**: Idempotency key tracking, duplicate request protection, and multi-threaded lock safety tested across 100 concurrent allocation attempts.

---

## 2. FILES CREATED & MODIFIED

| Action | File Path | Description |
| :--- | :--- | :--- |
| **CREATED** | `apps/api/src/modules/finance/ap/ap-allocation-validator.ts` | Validator for allocation inputs, source exclusivity, date format, and decimal scale. |
| **CREATED** | `apps/api/src/modules/finance/ap/ap-allocation.service.ts` | Domain service implementing allocation logic, deterministic locking, balance mutation, discount accounting, and reversal. |
| **CREATED** | `apps/api/test/phase2_7_4_ap_allocation.test.ts` | Test suite covering allocation lifecycle, source/target validation, same-supplier enforcement, multi-tenant isolation, prompt payment discount, high concurrency lock safety, and randomized scenarios. |
| **CREATED** | `docs/PHASE_2_7_4_IMPLEMENTATION_REPORT.md` | Implementation and Verification Report for Phase 2.7.4. |
| **MODIFIED** | `apps/api/src/modules/finance/ap/index.ts` | Exported `ap-allocation-validator.ts` and `ap-allocation.service.ts` from AP module index. |
| **MODIFIED** | `docs/IMPLEMENTATION_STATUS.md` | Updated roadmap status for Phase 2.7.4 to `COMPLETE / APPROVED`. |

---

## 3. BALANCE FORMULAS & INVARIANTS

### Payment Source
$$\text{new\_unapplied} = \text{old\_unapplied} - \text{allocated\_amount}$$
$$\text{new\_allocated} = \text{old\_allocated} + \text{allocated\_amount}$$
$$\text{allocated\_amount} + \text{unapplied\_amount} = \text{total\_amount}$$

### Credit Note Source
$$\text{new\_unapplied} = \text{old\_unapplied} - \text{allocated\_amount}$$
$$\text{new\_allocated} = \text{old\_allocated} + \text{allocated\_amount}$$
$$\text{allocated\_amount} + \text{unapplied\_amount} = \text{gross\_amount}$$

### Target Open Item
$$\text{total\_deduction} = \text{allocated\_amount} + \text{discount\_amount}$$
$$\text{new\_outstanding} = \text{old\_outstanding} - \text{total\_deduction}$$
$$\text{status} = \begin{cases} \text{SETTLED} & \text{if } \text{new\_outstanding} = 0.00 \\ \text{PARTIALLY\_SETTLED} & \text{if } 0.00 < \text{new\_outstanding} < \text{original\_amount} \end{cases}$$

---

## 4. PROMPT PAYMENT DISCOUNT ACCOUNTING

When an allocation includes prompt payment discount (`discount_amount > 0`):

```text
Debit:  AP_CONTROL (Accounts Payable Liability)       [discount_amount]
Credit: PURCHASE_DISCOUNT_INCOME (Discount Income)    [discount_amount]
```

- Posted through `AccountingCoreService` with event type `AP_DISCOUNT`.
- Discount reduces open item outstanding balance without reducing the payment's unapplied balance.

---

## 5. LOCKING & CONCURRENCY STRATEGY

- **Deterministic Lock Keys**: Keys are formatted as `${tenantId}:${entityId}` and sorted alphabetically before acquisition (`acquireLocks`).
- **Deadlock Defense**: Deterministic sorting ensures all threads acquire entity locks in identical order, eliminating cyclic waiting deadlocks.
- **Concurrency Test Results**: 100 concurrent allocation attempts of 1,000.00 each against a 10,000.00 payment yielded exactly 10 successful allocations, leaving 0.00 unapplied balance and 0 negative balances.

---

## 6. AUTHORIZATION & AUDIT

- **Permissions Checked**:
  - `ap:allocation:create`: Creating active allocations.
  - `ap:allocation:reverse`: Reversing active allocations.
  - `ap:allocation:read`: Viewing allocation records and lists.
- **Audit Logging**: Logs structured audit events (`ApAllocation::CREATE`, `ApAllocation::REVERSE`) with tenant/company context, actor ID, and cryptographic SHA-256 hash chaining.

---

## 7. TEST RESULTS

Executed full workspace test suite across 39 test files:

```text
Test Files  39 passed (39)
     Tests  558 passed (558)
  Duration  9.16s
```

### Phase 2.7.4 Specific Test Coverage (`apps/api/test/phase2_7_4_ap_allocation.test.ts`):
1. **Source & Target Validation** (4 tests): Valid payment allocation, valid credit note allocation, draft/reversed source rejection, source exclusivity validation.
2. **Supplier & Tenant/Company Integrity Guards** (2 tests): Rejection of cross-supplier allocations, rejection of cross-tenant allocations.
3. **Exact Decimal & Over-Allocation Invariants** (2 tests): Rejection of allocations exceeding payment unapplied balance, rejection of deductions exceeding open item outstanding balance.
4. **Prompt Payment Discount & Accounting** (1 test): Prompt payment discount processing and GL discount income entry posting.
5. **Allocation Reversal & Idempotency** (3 tests): Reversing active allocations with balance restoration, prompt payment discount GL entry reversal, idempotent re-allocation via `idempotencyKey`.
6. **Database & High Concurrency Allocation Protection** (1 test): 100 concurrent allocations with exact lock safety and zero negative balances.
7. **100 Randomized Financial Allocation Scenarios** (1 test): 100 randomized allocations asserting exact decimal source and open item invariants.

---

## 8. TARGETED ARCHITECTURE & FINANCIAL INTEGRITY REVIEW

### 1. Database-Authoritative Transactional Locking
- **PostgreSQL Row Locking**: When a PostgreSQL database connection pool (`dbPool`) is provided, `ApAllocationService` executes `SELECT ... FOR UPDATE` on both source (`ap_payments` or `ap_documents`) and target (`ap_open_items`) rows inside a single database transaction (`BEGIN ... COMMIT`).
- **Cross-Process Protection**: Prevents multi-process race conditions across independent app instances sharing the same PostgreSQL instance.

### 2. Global Lock Order Sequence
1. **Deterministic Order Selection**: Entity IDs `[sourceId, openItemId]` are sorted lexicographically before acquiring database row locks.
2. **Sequential Lock Acquisition**: The transaction acquires `SELECT ... FOR UPDATE` on entity 1, then entity 2.
3. **Balance Re-Reading**: Latest unapplied balance and outstanding balance are re-read directly from locked rows inside the active transaction.
4. **Invariant Validation**: Performs supplier match, company/tenant match, and over-allocation checks against authoritative locked balances.
5. **Mutation & Posting**: Discount GL event (`eventType: 'AP_DISCOUNT'`) is posted if applicable, source unapplied balance is updated, target open item outstanding balance is updated, and `ap_allocations` row is inserted.
6. **Commit**: Transaction commits, setting `SET LOCAL app.ap_allocation_authorized = 'true'` and `SET LOCAL app.posting_authorized = 'true'`.

### 3. Credit Note Source Eligibility
- **Lifecycle Status**: Credit Notes are credit sources (not open items). Their lifecycle status remains `POSTED` while their `unappliedAmount` is consumed.
- **Removed Synthetic Status**: Removed unnecessary `PARTIALLY_SETTLED` check for Credit Note allocation sources. Eligible Credit Note sources must have `documentType = 'CREDIT_NOTE'`, `status = 'POSTED'`, and `unappliedAmount > 0`.

### 4. Payment Source Eligibility
- Eligible payment sources must have `status = 'POSTED'` and `unappliedAmount > 0`. Rejects `DRAFT`, `REVERSED`, and `CANCELLED` payments.

### 5. Prompt Payment Discount Accounting Reconciliation
- **Original Payment Posting**: `DR AP_CONTROL`, `CR CASH_BANK` for payment cash amount.
- **Discount Allocation Posting**: `DR AP_CONTROL = discountAmount`, `CR PURCHASE_DISCOUNT_INCOME = discountAmount`.
- **Cash Reconciliation**: Cash is **NOT** double-credited. Payment cash consumption = `allocatedAmount`, supplier liability reduction = `allocatedAmount + discountAmount`, prompt payment discount income = `discountAmount`.

### 6. Allocation Reversal GL Accounting
- On allocation reversal (`reverseAllocation`), source unapplied balance and open item outstanding balance are restored.
- If a prompt payment discount entry was created (`discountJournalEntryId` present), an append-only GL reversal entry is posted via `AccountingCoreService.reverseAccountingEvent(...)` (`DR PURCHASE_DISCOUNT_INCOME`, `CR AP_CONTROL`).

---

## 9. KNOWN LIMITATIONS & DEFERRED ITEMS

The following capabilities are explicitly deferred to later subphases as defined in `docs/PHASE_2_7_IMPLEMENTATION_PLAN.md`:
- **Phase 2.7.5**: AP Settlement & Reconciliation Engine.
- **Phase 2.7.6**: AP Adjustments & Write-offs (Supplier write-offs and debit/credit adjustments).
- **Phase 2.7.7**: AP Aging & Supplier Statements.
- **Phase 2.7.8**: AP REST API & Controllers.
- **Phase 2.7.9**: AP Final Verification & Performance Hardening.

---

## 10. VERIFICATION COMMANDS

- `npm run typecheck` — Passed with 0 errors.
- `npm run build` — Passed with 0 errors.
- `npm test` — Passed with 39/39 test files, 558/558 total tests passing.

