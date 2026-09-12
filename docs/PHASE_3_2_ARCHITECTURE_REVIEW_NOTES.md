# PHASE 3.2 — SALES ORDERS ARCHITECTURE REVIEW NOTES

## 1. EXECUTIVE SUMMARY & REVIEW OBJECTIVE

This document records the architectural review and consistency audit for **Phase 3.2 — Sales Orders**.

The primary architectural mandate of Phase 3.2 is to establish a robust, production-grade Sales Order domain that consumes the immutable `QuotationConversionContract` issued in Phase 3.1, enforces strict customer credit-limit exposure controls under high concurrency, and executes the quotation lifecycle transition `ACCEPTED → CONVERTED` atomically without modifying any prior financial or commercial contracts.

---

## 2. CROSS-PHASE BOUNDARY & CONTRACT AUDIT

### 1. Quotation → Sales Order Contract Consumption (`Phase 3.1 → Phase 3.2`)
- **Verified**: Phase 3.1 owns `QuotationConversionContract` issuance. Phase 3.2 consumes the contract payload as an immutable input.
- **Zero Commercial Recalculation**: Phase 3.2 does NOT invoke `pricingService` or re-evaluate GST tax matrices. All unit prices, discounts, allocated header discount amounts, line gross amounts (`line.grossAmount`), line taxable amounts, GST component amounts, and address/contact snapshots are copied verbatim from the conversion contract. `gross_amount` is NEVER calculated or derived in Phase 3.2.
- **Atomic Transition**: Phase 3.2 exclusively executes `sales_quotations.status = 'CONVERTED'` inside the same atomic PostgreSQL transaction that creates the `sales_orders` and `sales_order_lines` rows.

### 2. Sales Order → Sales Delivery Boundary (`Phase 3.2 → Phase 3.3`)
- **Handoff Counters**: `sales_order_lines` maintains `delivered_quantity` (default `0.0000`) and `cancelled_quantity` (default `0.0000`).
- **Fulfillment State**: Phase 3.2 marks confirmed orders as `CONFIRMED` (fulfillment-ready). Phase 3.3 executes dispatches and increments `delivered_quantity`.
- **Zero Delivery Creation**: Phase 3.2 creates ZERO delivery records (`sales_deliveries` does not exist in Phase 3.2).

### 3. Sales Order → Sales Invoicing & Accounting Boundary (`Phase 3.2 → Phase 3.4`)
- **Handoff Counters**: `sales_order_lines` maintains `invoiced_quantity` (default `0.0000`).
- **Single Authoritative Completion Owner**: Phase 3.4 (`SalesInvoiceService`) owns the execution of the `CONFIRMED → COMPLETED` transition upon posting the final invoice.
- **Dual Completion Predicates**: Transition to `COMPLETED` requires both:
  1. `delivered_quantity == ordered_quantity` across all lines (Phase 3.3 contribution)
  2. `invoiced_quantity == ordered_quantity` across all lines (Phase 3.4 contribution)
- **Zero Financial Postings**: Phase 3.2 produces ZERO accounts receivable open items and ZERO general ledger journal entries. All financial posting logic remains strictly isolated to Phase 3.4.

---

## 3. FINAL SCHEMA & RELATIONAL CONTRACT CORRECTIONS

### 1. Application Contract Classification (`conversion_contract_id`)
- **Classification**: `sales_orders.conversion_contract_id` is defined as a `UUID NOT NULL` unique application contract identifier.
- **No Foreign Key**: It is **NOT** a database foreign key. `QuotationConversionContract` is an application-level immutable contract envelope issued by Phase 3.1, NOT a persistent database table. No `quotation_conversion_contracts` DB table exists or will be created.
- **Idempotency Guard**: Database uniqueness is enforced via `UNIQUE(tenant_id, company_id, conversion_contract_id)` on `sales_orders`. This guarantees that one application conversion contract creates at most one Sales Order.

### 2. Relational Line Traceability (`quotation_line_id`)
- **Relational Foreign Key**: `sales_order_lines.quotation_line_id` is defined as an explicit database foreign key referencing `sales_quotation_lines(id)`.
- **Historical Integrity (`ON DELETE RESTRICT`)**: Enforces `ON DELETE RESTRICT` to preserve historical traceability back to the exact quotation revision line consumed by the Sales Order and prevent accidental deletion of referenced quotation lines.

### 3. Verbatim Gross Amount Copy Rule
- **Zero Calculation**: `sales_order_lines.gross_amount` MUST be copied verbatim from `contract.lines[i].grossAmount`.
- **No Derivation**: Phase 3.2 MUST NOT derive or compute `gross_amount` (`ordered_quantity * unit_price`).

---

## 4. CREDIT-LIMIT EXPOSURE & CONCURRENCY ANALYSIS

### Credit Exposure Formula Integrity
The total customer credit exposure is evaluated as:

$$\text{Credit Exposure} = \text{AR Open Items Base} - \text{Unapplied Cash Receipts Base} + \text{Confirmed Open Orders Base} + \text{Current Order Base}$$

- **AR Subledger Reuse**: `AR Open Items Base` queries Phase 2.6 `ar_open_items` directly (`WHERE tenant_id = :tenantId AND company_id = :companyId AND customer_id = :customerId AND status IN ('OPEN', 'PARTIALLY_PAID')`).
- **Unapplied Receipts Integration**: `Unapplied Cash Receipts Base` queries Phase 2.6 `customer_receipts` directly (`WHERE tenant_id = :tenantId AND company_id = :companyId AND customer_id = :customerId`).
- **Confirmed Open Orders**: `Confirmed Open Orders Base` queries existing Phase 3.2 `sales_orders` in state `CONFIRMED` (`WHERE tenant_id = :tenantId AND company_id = :companyId AND customer_id = :customerId AND status = 'CONFIRMED'`).
- **Mandatory Data Isolation**: Multi-tenant (`tenant_id`) and multi-company (`company_id`) filters are strictly mandated on every supporting exposure subquery. Cross-tenant or cross-company records can NEVER affect a customer's credit exposure.

### Race Condition Mitigation
To prevent race conditions where two sales representatives confirm concurrent orders for the same customer simultaneously:
- **Pessimistic Locking**: `SalesOrderService.confirmOrder()` acquires a pessimistic row lock on the Customer record (`SELECT id FROM customers WHERE id = :customerId AND tenant_id = :tenantId AND company_id = :companyId FOR UPDATE`) at the beginning of the confirmation transaction.
- **Result**: All concurrent confirmation attempts for the same customer execute serially, guaranteeing that credit exposure is evaluated against the true committed exposure.

---

## 5. IDEMPOTENCY & DOUBLE-CONVERSION PROTECTION ANALYSIS

Phase 3.2 enforces a dual-layer idempotency guard:

1. **Database Contract Uniqueness**: `sales_orders.conversion_contract_id` has a `UNIQUE(tenant_id, company_id, conversion_contract_id)` constraint. Any secondary attempt to create a Sales Order from an already-consumed contract is rejected by PostgreSQL at the DB boundary.
2. **API Request Idempotency**: REST endpoint `POST /api/v1/sales/orders/from-contract` requires the `Idempotency-Key` HTTP header. Repeated requests with the same key return the cached Sales Order payload without re-executing database writes.

---

## 6. REVENUE & FINANCIAL INVARIANTS CHECKLIST

| Invariant | Validation Mechanism | Status |
| :--- | :--- | :--- |
| **Order Total Reconciliation** | `totalAmount == taxableAmount + taxAmount` | Enforced verbatim from contract |
| **Line Gross Amount Copy** | `sales_order_lines.gross_amount == contract.lines[i].grossAmount` | Enforced verbatim from contract |
| **Line Total Reconciliation** | `lineTotal == taxableAmount + taxAmount` | Enforced verbatim from contract |
| **Base Currency Conversion** | `totalAmountBase == roundTo2(totalAmount * exchangeRate)` | Enforced verbatim from contract |
| **Quotation Conversion Singularity** | 1 Quotation Conversion Contract == Exactly 1 Sales Order | Enforced by `UNIQUE(tenant_id, company_id, conversion_contract_id)` |
| **Multi-Tenant Credit Isolation** | All exposure queries filtered by `tenant_id`, `company_id`, `customer_id` | Verified |
| **Completion Ownership** | Phase 3.4 (`SalesInvoiceService`) executes `CONFIRMED → COMPLETED` upon dual predicate pass | Verified |
| **Application Contract Classification** | `conversion_contract_id` = UUID (Not a DB FK; no contract DB table) | Verified |
| **Quotation Line Traceability** | `quotation_line_id` DB FK to `sales_quotation_lines.id` (`ON DELETE RESTRICT`) | Verified |
| **Status Vocabulary Integrity** | `status IN ('DRAFT', 'CONFIRMED', 'CANCELLED', 'COMPLETED')` | Enforced by DB `CHECK` constraint |

---

## 7. FINAL CONSISTENCY AUDIT RESULT

The Phase 3.2 Sales Order architecture plan:
- Complies 100% with the master ERP architecture and Product Requirements Specification.
- Preserves all Phase 2 Finance and Phase 3.0/3.1 Commercial invariants.
- Enforces verbatim copy of `gross_amount` with zero recalculation.
- Enforces strict multi-tenant and multi-company isolation across all credit exposure subqueries.
- Establishes a single authoritative completion ownership model assigned to Phase 3.4 `SalesInvoiceService`.
- Contains zero forbidden shortcuts, zero duplicate engines, and zero microservices.
- Is fully implementation-ready and set to **AWAITING HUMAN APPROVAL**.

**Reviewer Status**: `AWAITING HUMAN APPROVAL`
