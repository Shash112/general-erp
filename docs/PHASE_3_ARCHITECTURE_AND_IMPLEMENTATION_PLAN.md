# PHASE 3 — SALES & PROCUREMENT ARCHITECTURE & DELIVERY PLAN

## 1. EXECUTIVE SUMMARY

Following the complete implementation, audit, and formal approval of the **Phase 2 Finance Foundation** (comprising Phases 2.0 through 2.11 with 817/817 passing tests across accounting core, fiscal periods, COA, GL, Tax Engine, AR subledger, AP subledger, Banking, Fiscal Closing, and Financial Reporting), this document establishes the production-grade architectural blueprint and delivery plan for **Phase 3 — Sales & Procurement**.

Phase 3 forms the operational commercial layer of the General ERP platform. It bridges commercial customer and supplier activities (quotations, orders, fulfillment, receiving, invoicing, and returns) directly to the underlying financial subledgers (Accounts Receivable and Accounts Payable), the Centralized Tax Engine (India GST), the Accounting Core, and the General Ledger.

### Key Strategic Directives
1. **Finance Remains Authoritative**: Sales and Procurement documents produce zero parallel accounting subledgers or custom balance stores. All financial impact flows exclusively through `AccountingCore → General Ledger` and the existing `AR / AP` subledgers.
2. **Simple by Default, Powerful When Needed**: Standard workflows operate with minimal required fields and smart defaults, while supporting multi-line tax calculations, place-of-supply resolution, approval workflows, custom fields, credit checks, and multi-currency transactions.
3. **Platform Engine Independence**: Business modules (Sales & Procurement) depend on platform engines (Configuration, Workflow, Rules, Authorization, Audit, Tax, Numbering, Accounting). Platform engines remain strictly domain-independent and have zero imports from Sales or Procurement.
4. **Strict Document Lifecycle Separation**: Clear boundaries exist between Operational Documents (Quotations, Sales Orders, Deliveries, Purchase Requests, Purchase Orders, Goods Receipts) which do not alter financial balances, and Financial Documents (Sales Invoices, Credit Notes, Debit Notes, Supplier Bills) which execute immutable posted accounting entries via `AccountingCore`.

---

## 2. CURRENT PLATFORM READINESS

The following matrix documents the exact status of existing codebase capabilities based on direct inspection of `apps/api/src/`, `packages/database/src/schema/`, `packages/database/migrations/`, and `docs/IMPLEMENTATION_STATUS.md`.

| Capability / Module | Readiness Status | Existing Location / Mechanism | Phase 3 Requirement / Action |
| :--- | :--- | :--- | :--- |
| **Product Master** | **PARTIAL** | DB: `products` table in `packages/database/src/schema/master.ts`. Memory store in `master-data.service.ts`. | Schema owned by `packages/database/src/schema/commercial-master.ts`, service owned by `apps/api/src/modules/commercial/product.service.ts`. Extend for commercial attributes, categories, and UOM bindings in `Phase 3.0`. |
| **Customer Master** | **PARTIAL** | DB: `customers` table in `packages/database/src/schema/master.ts`. Memory store in `master-data.service.ts`. | Schema owned by `packages/database/src/schema/commercial-master.ts`, service owned by `apps/api/src/modules/commercial/customer.service.ts`. Extend for billing/shipping addresses, GST classification, payment terms, and credit limits in `Phase 3.0`. |
| **Supplier Master** | **PARTIAL** | DB: `suppliers` table in `packages/database/src/schema/master.ts`. Memory store in `master-data.service.ts`. | Schema owned by `packages/database/src/schema/commercial-master.ts`, service owned by `apps/api/src/modules/commercial/supplier.service.ts`. Extend for vendor bank details, payment terms, GST classification, MSME status, and TDS attributes in `Phase 3.0`. |
| **Contact Management** | **MISSING** | None. | Create `commercial_contacts` entity in `packages/database/src/schema/commercial-master.ts` in `Phase 3.0` linked via strong foreign keys to Customers and Suppliers. |
| **Address Management** | **MISSING** | Embedded JSON field `address` on branches only. | Create `commercial_addresses` entity in `packages/database/src/schema/commercial-master.ts` in `Phase 3.0` supporting multi-address billing and shipping with India state code validation. |
| **Unit of Measure (UOM)** | **PARTIAL** | String column `uom` on `products` table. | Create `uom_definitions` and `uom_conversions` schema in `packages/database/src/schema/commercial-master.ts` with precise conversion ratios in `Phase 3.0`. |
| **Pricing Engine** | **MISSING** | Static `purchasePrice` and `sellingPrice` columns on `products`. | Create commercial pricing service (`apps/api/src/modules/commercial/pricing.service.ts`) in `Phase 3.0` supporting price lists, effective dates, entity overrides, and volume tiers. |
| **Tax Classification** | **EXISTS** | `tax-engine.service.ts`, `tax_categories`, `tax_rates`, `hsn_sac_rates` in `packages/database/src/schema/tax.ts`. | Reused directly. Sales and Procurement query `taxEngineService` for dynamic tax determination and immutable posting tax snapshots. |
| **Warehouse / Location** | **PARTIAL** | `branches` table in `master.ts` with `stateCode`. | Reused as fulfillment location/branch references in Phase 3. Full multi-location stock ledger deferred to future Inventory domain. |
| **Configuration Engine** | **EXISTS** | `apps/api/src/platform/configuration/` | Reused directly for JSON schema configuration, custom fields validation, and configurable 3-way match tolerance rules. |
| **Workflow Engine** | **EXISTS** | `apps/api/src/platform/workflow/` | Reused directly for Quotation, Sales Order, Purchase Request, and Purchase Order state machine transitions and multi-step approvals. |
| **Rules Engine** | **EXISTS** | `apps/api/src/platform/rules/` | Reused directly for evaluating commercial rules (credit limit violation checks, discount threshold approvals, 3-way match tolerance checks). |
| **Authorization & Policy** | **EXISTS** | `apps/api/src/platform/authorization/` | Reused directly. Enforces fine-grained permissions (`sales:quotation:create`, `procurement:po:approve`, etc.) and company data scope filtering. |
| **Audit Engine** | **EXISTS** | `apps/api/src/platform/audit/` | Reused directly for SHA-256 tamper-evident logging of all commercial master data edits, document approvals, dispatches, postings, and reversals. |
| **Document Lifecycle Engine** | **EXISTS** | `apps/api/src/platform/document-lifecycle/` | Reused as foundational state machine pattern for commercial operational and financial document lifecycles. |
| **Numbering Engine** | **EXISTS** | `apps/api/src/platform/numbering/` | Reused directly for thread-safe sequential document numbering with company, branch, and fiscal year resets. |
| **Search Engine** | **MISSING** | No dedicated search engine (Phase 5). | PostgreSQL ILIKE / composite indexes utilized for Phase 3 commercial search. |
| **Storage Engine** | **EXISTS** | `apps/api/src/platform/storage/` | Reused in Phase 3.0 for linking attachment metadata (PO copies, vendor quotes, bill scans). PDF document rendering implemented in operational subphases. |
| **Import / Export** | **MISSING** | Phase 5 scope. | Commercial master data bulk import service (`apps/api/src/modules/commercial/commercial-import.service.ts`) created in Phase 3.0 (Import-only; Export deferred to Phase 5). |
| **Notification Engine** | **EXISTS** | `apps/api/src/platform/notifications/` | Decoupled asynchronous side-effects. Notification failures do not alter synchronous financial posting transaction success. |
| **Accounting Core** | **EXISTS** | `apps/api/src/modules/finance/accounting-core.service.ts` | Reused directly. Single entry point for posting Sales Invoices, Credit Notes, Supplier Bills, and Debit Notes. Resolves control accounts via COA Account Roles (`AR_CONTROL`, `AP_CONTROL`, etc.). |
| **AR Subledger** | **EXISTS** | `apps/api/src/modules/finance/ar/` | Reused directly. Sales Invoices post `INVOICE` open items; Credit Notes apply via `arAllocationService`. |
| **AP Subledger** | **EXISTS** | `apps/api/src/modules/finance/ap/` | Reused directly. Supplier Bills post `INVOICE` open items; Debit Notes apply via `apAllocationService`. |
| **Banking Engine** | **EXISTS** | `apps/api/src/modules/finance/banking/` | Reused directly for receipt processing against Sales Invoices and payment processing against Supplier Bills. |
| **Reporting Engine** | **EXISTS** | `apps/api/src/modules/finance/reporting/` | Reused directly for Financial Statements (TB, GL, P&L, BS). Commercial operational reporting added in Phase 3.10. |

---

## 3. ARCHITECTURE PRINCIPLES

1. **Finance Remains Authoritative**: No commercial transaction bypasses `AccountingCore` or creates standalone ledger tables. Financial posting occurs immutably via GL transactions.
2. **Subledger Unification**: AR owns all customer balances; AP owns all supplier balances. Sales Invoices delegate open item creation to `arDocumentService`. Supplier Bills delegate open item creation to `apDocumentService`.
3. **Multi-Tenancy & Data Scope**: All Phase 3 database tables strictly include `tenant_id` and `company_id`. Unique constraints follow `(tenant_id, company_id, code)` or `(tenant_id, id)`.
4. **Exact Decimal Monetary Arithmetic**: Every monetary column uses PostgreSQL `numeric(15, 2)` (or `numeric(18, 4)` for unit prices/exchange rates). In-memory calculations strictly utilize `ExactDecimal` (BigInt fixed-point) to prevent floating-point rounding errors.
5. **Tax Snapshot Stability**: Tax calculations perform dynamic lookup during draft creation, but freeze complete immutable tax snapshots (rates, tax amounts, place of supply, HSN/SAC) into `sales_invoice_tax_snapshots` or `supplier_bill_tax_snapshots` upon posting. Subsequent changes to tax rate matrices do not alter historical posted documents.

---

## 4. SHARED COMMERCIAL FOUNDATION & BULK IMPORT (PHASE 3.0)

Phase 3.0 establishes the shared master data entities, unit-of-measure conversions, address management, centralized pricing, and commercial master data bulk import infrastructure required by Sales and Procurement.

```
+-----------------------------------------------------------------------+
|                   SHARED COMMERCIAL FOUNDATION                        |
|                                                                       |
|  +------------------+  +-------------------+  +--------------------+  |
|  | Product Master   |  | Customer Master   |  | Supplier Master    |  |
|  | - Core Attributes|  | - GST & Billing   |  | - Vendor Details   |  |
|  | - UOM Conversion |  | - Credit Limit    |  | - MSME / TDS       |  |
|  +--------+---------+  +---------+---------+  +---------+----------+  |
|           |                      |                      |             |
|           +----------------------+----------------------+             |
|                                  |                                    |
|                      +-----------v-----------+                        |
|                      |  Addresses & Contacts |                        |
|                      |  - Multi-billing/ship |                        |
|                      |  - Strong Relational  |                        |
|                      |    FK Integrity       |                        |
|                      +-----------+-----------+                        |
|                                  |                                    |
|                      +-----------v-----------+                        |
|                      | Commercial Pricing    |                        |
|                      | - Entity Overrides    |                        |
|                      | - Price Lists / Dates |                        |
|                      | - Volume Tiers        |                        |
|                      +-----------+-----------+                        |
|                                  |                                    |
|                      +-----------v-----------+                        |
|                      | Master Data Import    |                        |
|                      | - Max 500 records/batch|                       |
|                      | - Atomic Rollback TX  |                        |
|                      | - Idempotency & Audit |                        |
|                      +-----------------------+                        |
+-----------------------------------------------------------------------+
```

### Commercial Master Data Bulk Import Architecture (ADR-307 — DECIDED)

Phase 3.0 introduces a dedicated commercial bulk import service (`apps/api/src/modules/commercial/commercial-import.service.ts`) operating under strict validation and transaction contracts:

1. **Supported Entities**: Bounded strictly to **Product Master**, **Customer Master**, and **Supplier Master**. Transactional documents (quotations, orders, invoices, bills) are explicitly excluded.
2. **Export Scope (Option B)**: Phase 3.0 implements **Import only**. Data export capabilities are deferred to Phase 5 (Reporting & Query Engine).
3. **Batch Limit**: Configurable default limit of **500 records per request** (`MAX_BULK_IMPORT_BATCH_SIZE = 500`). Submissions exceeding 500 records are rejected with a `ValidationError`.
4. **Transaction Atomicity**: Executed as a **Single Atomic Database Transaction** (`BEGIN ... COMMIT`). If any row in the batch fails Zod schema validation or database unique key constraints, the **entire batch rolls back**. Partial corrupted imports are strictly prevented.
5. **Row-Level Validation Error Reporting**: Validation failures return a structured HTTP 400 payload detailing the exact line number, field name, invalid value, and specific error message for every failing record.
6. **Idempotency & Duplicate Handling**:
   - Requests require standard `Idempotency-Key` headers handled via platform `idempotencyService`. Resubmissions return the cached result payload without re-processing.
   - Business code/SKU uniqueness is strictly enforced against existing database records and within the batch. Duplicate records are rejected with row-level validation errors; **no silent overwrites or updates occur during bulk import**.
7. **Tenant / Company Data Isolation**: Context parsed via `RequestContext` (`ctx.tenantId`, `ctx.companyId`). Imported records are automatically bound to the request's tenant and company scope.
8. **Authorization & Audit**: Requires specific permission (`commercial:product:import`, `commercial:customer:import`, `commercial:supplier:import`). Successful imports record a `COMMERCIAL_BULK_IMPORT` audit log entry via `auditService` capturing record count, entity type, and SHA-256 payload digest.

---

## 5. SALES DOMAIN ARCHITECTURE

The Sales domain manages customer engagement from initial quotation through order confirmation, dispatch delivery, invoicing, and potential returns/credit notes.

```
+-----------------------------------------------------------------------------------+
|                                 SALES DOMAIN                                      |
|                                                                                   |
|  +---------------+    +---------------+    +--------------+    +---------------+  |
|  |   Quotation   +--->|  Sales Order  +--->|   Delivery   +--->| Sales Invoice |  |
|  | (Operational) |    | (Operational) |    | (Fulfillment)|    |  (Financial)  |  |
|  +---------------+    +---------------+    +--------------+    +-------+-------+  |
|                                                                        |          |
|                                                                +-------v-------+  |
|                                                                |  Credit Note  |  |
|                                                                |  (Financial)  |  |
|                                                                +---------------+  |
+-----------------------------------------------------------------------------------+
```

### 1. Quotation (`sales_quotations`, `sales_quotation_lines`)
- **Lifecycle**: DRAFT → PENDING_APPROVAL → APPROVED → SENT → ACCEPTED → REJECTED → CONVERTED → CANCELLED.
- **Behavior**: Operational estimate. Stores offered prices, item discounts, validity period, and estimated India GST. Conversion generates a Sales Order directly. Does not affect financial subledgers or inventory.

### 2. Sales Order (`sales_orders`, `sales_order_lines`)
- **Lifecycle**: DRAFT → PENDING_APPROVAL → CONFIRMED → PARTIALLY_FULFILLED → FULFILLED → CANCELLED.
- **Behavior**: Operational commercial commitment. Triggers credit limit checks against current customer AR balance + open orders. Reserves fulfillment quota. Serves as source for Delivery and Direct Sales Invoice generation.

### 3. Delivery / Dispatch (`sales_deliveries`, `sales_delivery_lines`)
- **Lifecycle**: DRAFT → PICKED → PACKED → DISPATCHED → DELIVERED → CANCELLED.
- **Behavior**: Operational fulfillment record. Tracks items dispatched from a branch/warehouse location against a Sales Order. Records vehicle details, LR number, and dispatch timestamp. Updates fulfillment quantities on parent Sales Order.

### 4. Sales Invoice (`sales_invoices`, `sales_invoice_lines`)
- **Lifecycle**: DRAFT → POSTED → PARTIALLY_SETTLED → SETTLED → REVERSED.
- **Behavior**: **Financial Document**. Generates immutable posted accounting entries via `AccountingCore`. Posts an Open Item (`INVOICE`) to `ar_documents` (AR Subledger). Freezes HSN/SAC, CGST, SGST, IGST, and Place of Supply into `sales_invoice_tax_snapshots`. Supports generation from Sales Order, Delivery, or direct entry.
- **Correction Semantics**: Draft invoices may be CANCELLED before posting. Posted invoices are **IMMUTABLE** and CANNOT be edited or deleted; corrections occur strictly via Sales Credit Notes or Reversals.

### 5. Sales Return / Credit Note (`sales_credit_notes`, `sales_credit_note_lines`)
- **Lifecycle**: DRAFT → POSTED → APPLIED → REVERSED.
- **Behavior**: **Financial Document**. Represents goods returned or price/tax adjustments against a posted Sales Invoice. Reverses tax liability, acts as an allocation source (`CREDIT_NOTE`) in `ar_allocations` to reduce customer open receivable balance, and posts reversal journal entries to GL via `AccountingCore`.

---

## 6. PROCUREMENT DOMAIN ARCHITECTURE

The Procurement domain manages vendor purchasing from internal request through purchase order issuance, goods receipt, supplier billing, and debit notes.

```
+-----------------------------------------------------------------------------------+
|                              PROCUREMENT DOMAIN                                   |
|                                                                                   |
|  +------------------+    +----------------+    +---------------+    +----------+  |
|  | Purchase Request +--->| Purchase Order +--->| Goods Receipt +--->| Supplier |  |
|  |  (Operational)   |    | (Operational)  |    | (Fulfillment) |    |   Bill   |  |
|  +------------------+    +----------------+    +---------------+    +----+-----+  |
|                                                                          |        |
|                                                                   +------v-----+  |
|                                                                   | Debit Note |  |
|                                                                   +------------+  |
+-----------------------------------------------------------------------------------+
```

### 1. Purchase Request (`purchase_requests`, `purchase_request_lines`)
- **Lifecycle**: DRAFT → SUBMITTED → APPROVED → REJECTED → PARTIALLY_ORDERED → ORDERED → CANCELLED.
- **Behavior**: Operational internal request raised by a department for goods/services. Requires departmental workflow approval prior to PO creation. Scope: Department-level (`tenant_id, company_id, department_id`).

### 2. Purchase Order (`purchase_orders`, `purchase_order_lines`)
- **Lifecycle**: DRAFT → PENDING_APPROVAL → ISSUED → CONFIRMED → PARTIALLY_RECEIVED → RECEIVED → CANCELLED.
- **Behavior**: Operational commercial order issued to a Supplier. Specifies ordered quantities, negotiated prices, delivery schedules, tax estimates, and payment terms. Requires workflow approval based on value thresholds.

### 3. Goods Receipt Note / GRN (`goods_receipts`, `goods_receipt_lines`)
- **Lifecycle**: DRAFT → RECEIVED → INSPECTED → ACCEPTED → CANCELLED.
- **Behavior**: Operational receiving record. Documents physical receipt of items at a company branch/warehouse. Tracks accepted vs rejected/damaged quantities. Updates PO received quantities. Provides quantities for 3-Way Matching during Supplier Bill processing.

### 4. Supplier Bill (`supplier_bills`, `supplier_bill_lines`)
- **Lifecycle**: DRAFT → SUBMITTED → APPROVED → POSTED → PARTIALLY_SETTLED → SETTLED → REVERSED.
- **Behavior**: **Financial Document**. Created against PO + Goods Receipt (3-Way Match) or as a direct expense bill. Posts an Open Item (`INVOICE`) to `ap_documents` (AP Subledger), claims Input Tax Credit (ITC) via frozen snapshot in `supplier_bill_tax_snapshots`, and posts balancing debit/credit journal entries to GL via `AccountingCore`.
- **Correction Semantics**: Draft bills may be CANCELLED before posting. Posted bills are **IMMUTABLE**; corrections occur strictly via Supplier Debit Notes or Reversals.

### 5. Purchase Return / Debit Note (`purchase_debit_notes`, `purchase_debit_note_lines`)
- **Lifecycle**: DRAFT → POSTED → APPLIED → REVERSED.
- **Behavior**: **Financial Document**. Issued to a supplier for returned goods or billing discrepancies. Reverses Input Tax Credit (ITC), acts as an allocation source (`DEBIT_NOTE`) in `ap_allocations` to reduce supplier open payable balance, and posts GL reversal entries via `AccountingCore`.

---

## 7. DOCUMENT LIFECYCLES MATRIX

The following table establishes the immutable operational vs financial classification, allowed transitions, and side-effect rules across all Phase 3 documents.

| Document Type | Document Class | Primary States | Allowed Transitions | Approval Required | Accounting Posting? | AR/AP Subledger Effect? | Fulfillment / Goods Effect? | Reversal / Correction Semantics |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Quotation** | Operational | Draft, Approved, Sent, Accepted, Converted, Rejected, Cancelled | Draft → Approved → Sent → Accepted → Converted | Optional (If Discount > Threshold) | **NO** | NO | NO | Cancelled before conversion |
| **Sales Order** | Operational | Draft, Pending_Approval, Confirmed, Partially_Fulfilled, Fulfilled, Cancelled | Draft → Pending_Approval → Confirmed → Fulfilled | Yes (Rules / Credit Check) | **NO** | NO | Reserves Quota | Cancelled (if unfulfilled) |
| **Delivery / Dispatch** | Operational | Draft, Picked, Packed, Dispatched, Delivered, Cancelled | Draft → Dispatched → Delivered | No (Operational Check) | **NO** | NO | Updates Dispatched Qty | Cancelled (if uninvoiced) |
| **Sales Invoice** | **Financial** | Draft, Posted, Partially_Settled, Settled, Reversed | Draft → Posted → (Settled via AR) | Yes (Posting Policy) | **YES** | **Posts AR Open Item (INVOICE)** | References Fulfillment | **Immutable**. Reversal via Sales Credit Note |
| **Sales Credit Note** | **Financial** | Draft, Posted, Applied, Reversed | Draft → Posted → Applied | Yes (Financial Approval) | **YES** | **AR Allocation Source (CREDIT_NOTE)** | Optional Restock Ref | **Immutable**. GL Reversal Entry |
| **Purchase Request** | Operational | Draft, Submitted, Approved, Ordered, Rejected, Cancelled | Draft → Submitted → Approved → Ordered | Yes (Dept Manager) | **NO** | NO | NO | Cancelled before order |
| **Purchase Order** | Operational | Draft, Pending_Approval, Issued, Confirmed, Received, Cancelled | Draft → Pending_Approval → Issued → Received | Yes (PO Value Rules) | **NO** | NO | Expects Arrival Qty | Cancelled (if unreceived) |
| **Goods Receipt (GRN)** | Operational | Draft, Received, Inspected, Accepted, Cancelled | Draft → Received → Accepted | No (Warehouse Check) | **NO** | NO | Updates Received Qty | Cancelled (if unbilled) |
| **Supplier Bill** | **Financial** | Draft, Submitted, Approved, Posted, Settled, Reversed | Draft → Approved → Posted → (Settled via AP) | Yes (3-Way Match / Manager) | **YES** | **Posts AP Open Item (INVOICE)** | Verifies GRN Qty | **Immutable**. Reversal via Supplier Debit Note |
| **Purchase Debit Note** | **Financial** | Draft, Posted, Applied, Reversed | Draft → Posted → Applied | Yes (Financial Approval) | **YES** | **AP Allocation Source (DEBIT_NOTE)** | Optional Return Ref | **Immutable**. GL Reversal Entry |

---

## 8. ACCOUNTING INTEGRATION CONTRACTS

Financial posting in Sales and Procurement occurs exclusively by dispatching structured financial events to `AccountingCore`. Control accounts are dynamically resolved via COA Account Roles (`AR_CONTROL`, `AP_CONTROL`, `SALES_REVENUE`, `PURCHASE_EXPENSE`, Tax Control Accounts).

### Event 1: `SALES_INVOICE_POSTED`

```
  Debit:  AR Control Account (COA Role: AR_CONTROL)           [Configured Control Account]
  Credit: Sales Revenue Account (COA Role: SALES_REVENUE)     [Item / Line Category Account]
  Credit: Output CGST Payable Account (COA Role: OUTPUT_CGST) [Tax Control Account]
  Credit: Output SGST Payable Account (COA Role: OUTPUT_SGST) [Tax Control Account]
  Credit: Output IGST Payable Account (COA Role: OUTPUT_IGST) [Tax Control Account]
```

### Event 2: `SALES_CREDIT_NOTE_POSTED`

```
  Debit:  Sales Return Account (COA Role: SALES_RETURN)       [Line Sales Return Account]
  Debit:  Output CGST Reversal Account (COA Role: OUTPUT_CGST)[Tax Control Account]
  Debit:  Output SGST Reversal Account (COA Role: OUTPUT_SGST)[Tax Control Account]
  Debit:  Output IGST Reversal Account (COA Role: OUTPUT_IGST)[Tax Control Account]
  Credit: AR Control Account (COA Role: AR_CONTROL)           [Configured Control Account]
```

### Event 3: `PURCHASE_BILL_POSTED`

```
  Debit:  Purchase Expense Account (COA Role: PURCHASE_EXPENSE)[Line Expense Account]
  Debit:  Input CGST Credit Account (COA Role: INPUT_CGST)    [Tax Control Account]
  Debit:  Input SGST Credit Account (COA Role: INPUT_SGST)    [Tax Control Account]
  Debit:  Input IGST Credit Account (COA Role: INPUT_IGST)    [Tax Control Account]
  Credit: AP Control Account (COA Role: AP_CONTROL)           [Configured Control Account]
```

### Event 4: `PURCHASE_DEBIT_NOTE_POSTED`

```
  Debit:  AP Control Account (COA Role: AP_CONTROL)           [Configured Control Account]
  Credit: Purchase Return Account (COA Role: PURCHASE_RETURN) [Line Return Account]
  Credit: Input CGST Credit Reversal Account (COA Role: INPUT_CGST)[Tax Control Account]
  Credit: Input SGST Credit Reversal Account (COA Role: INPUT_SGST)[Tax Control Account]
  Credit: Input IGST Credit Reversal Account (COA Role: INPUT_IGST)[Tax Control Account]
```

---

## 9. AR / AP INTEGRATION PLAN

Phase 3 reuses the verified Phase 2.6 (AR) and Phase 2.7 (AP) subledgers as the single source of truth for commercial open items, settlements, aging, and customer/supplier statements.

```
+-------------------------------------------------------------------------------+
|                       AR / AP INTEGRATION PIPELINE                            |
|                                                                               |
|  SALES INVOICE  -----> arDocumentService.createDocument() ------> AR SUBLEDGER |
|  CREDIT NOTE    -----> arAllocationService.allocateCredit() ----> OPEN ITEMS   |
|  CUSTOMER PMT   -----> arReceiptService.processReceipt() --------> AGING &    |
|                                                                   STATEMENTS  |
|                                                                               |
|  SUPPLIER BILL  -----> apDocumentService.createDocument() ------> AP SUBLEDGER |
|  DEBIT NOTE     -----> apAllocationService.allocateCredit() ----> OPEN ITEMS   |
|  SUPPLIER PMT   -----> apPaymentService.processPayment() --------> AGING &    |
|                                                                   STATEMENTS  |
+-------------------------------------------------------------------------------+
```

---

## 10. TAX ARCHITECTURE (INDIA GST INTEGRATION)

Phase 3 relies entirely on the **Phase 2.5 Centralized Tax Engine** (`taxEngineService`). Dynamic tax calculations during Draft transition to immutable tax snapshots (`sales_invoice_tax_snapshots` / `supplier_bill_tax_snapshots`) upon transition to `POSTED`.

---

## 11. PRICING ARCHITECTURE

Commercial pricing resolution cascade (Option A):
$$\text{Resolved Price} = \text{Coalesce}(\text{Entity-Specific Override}, \text{Price List Rule}, \text{Volume Tier Price}, \text{Master Product Price})$$

---

## 12. INVENTORY BOUNDARY

> **Inventory is intentionally deferred to a separately designated future Inventory domain/phase.**

Phase 3 maintains quantity tracking (`dispatchedQuantity`, `receivedQuantity`) while deferring perpetual stock ledger tables, valuation methods (FIFO, Weighted Average, LIFO), COGS journal entries, and batch/serial management.

---

## 13. WORKFLOW, AUTHORIZATION & 3-WAY MATCHING

Configurable 3-way match variance tolerances (default 2%) are resolved via the **Configuration Engine** and **Rules Engine** (`Default configuration ≠ hard-coded business rule`). Violations route bills to Manager Exception Approval prior to financial posting.

---

## 14. TENANT / COMPANY ISOLATION PLAN

Scope boundaries: Company-level (Customer, Supplier, Product, Pricing Lists), Branch-level (Fulfillment/Dispatch locations), Department-level (Purchase Requests). Composite unique indexes follow `(tenant_id, company_id, code)` or `(tenant_id, id)`.

---

## 15. NUMBERING PLAN

Sequential document numbers generated via `numberingEngine.generateNextNumber` with company, branch, and fiscal year resets.

---

## 16. AUDIT PLAN

All write actions log SHA-256 tamper-evident audit events via `auditService.logEvent`.

---

## 17. API ARCHITECTURE

Namespaces: `/api/v1/commercial/*`, `/api/v1/sales/*`, `/api/v1/procurement/*`. All payloads validated via Zod schemas.

---

## 18. FRONTEND ARCHITECTURE

Phase 3.0 UI scope is strictly limited to Shared Commercial Foundation views (Product, Customer, Supplier, Address, Contact, UOM, Pricing management views, and Bulk Import UI).

---

## 19. SEARCH, IMPORT, STORAGE & NOTIFICATION PLAN

- **Bulk Import (ADR-307)**: Commercial master data bulk import service (`apps/api/src/modules/commercial/commercial-import.service.ts`) for Products, Customers, Suppliers in Phase 3.0. Max 500 records/batch, single atomic transaction rollback, idempotency key required, import-only. Export deferred to Phase 5.
- **Storage**: Integrates attachment metadata via `storageService`.
- **Notifications**: Decoupled asynchronous side-effects.

---

## 20. REPORTING PLAN

Financial statements owned by Phase 2.10. Commercial operational reports delivered in Subphase 3.10.

---

## 21. API / DATA / EVENT DEPENDENCY GRAPH

```
[Customer / Supplier / Product Master Data] (Phase 3.0)
               |
               +-------------------+-------------------+
               |                                       |
               v                                       v
      [Sales Domain]                          [Procurement Domain]
 (Quotation -> Order -> Delivery)         (Request -> PO -> GRN)
               |                                       |
               v                                       v
      [Sales Invoice]                          [Supplier Bill]
               |                                       |
               +-------------------+-------------------+
                                   |
                         (Financial Posting Event)
                                   |
                                   v
                         [Tax Engine (GST)] (Phase 2.5)
                                   |
               +-------------------+-------------------+
               |                                       |
               v                                       v
      [AR Subledger] (Phase 2.6)             [AP Subledger] (Phase 2.7)
               |                                       |
               +-------------------+-------------------+
                                   |
                                   v
                      [AccountingCore -> GL] (Phase 2.4)
                                   |
                                   v
                    [Financial Reporting Engine] (Phase 2.10)
```

---

## 22. PHASE 3 DELIVERY SEQUENCE

Phase 3 is executed in 12 sequential subphases:

```
Phase 3.0: Shared Commercial Foundation (Master Data, UOM, Pricing, Bulk Import)
  ↓
Phase 3.1: Sales Foundation & Quotations
  ↓
Phase 3.2: Sales Orders & Credit Checking
  ↓
Phase 3.3: Sales Delivery & Dispatch Tracking
  ↓
Phase 3.4: Sales Invoicing + AR + Accounting Core Integration
  ↓
Phase 3.5: Sales Returns & Credit Notes
  ↓
Phase 3.6: Procurement Foundation & Purchase Requests
  ↓
Phase 3.7: Purchase Orders & Goods Receipt (GRN)
  ↓
Phase 3.8: Supplier Billing + AP + 3-Way Matching + Accounting Core
  ↓
Phase 3.9: Procurement Returns & Debit Notes
  ↓
Phase 3.10: Commercial Operational Reporting & Search UI
  ↓
Phase 3.11: Full Phase 3 Full Verification Gate
```

---

## 23. SUBPHASE 3.0 BOUNDARY & DEFINITION OF DONE

### Subphase 3.0 Scope Boundary
Subphase 3.0 contains **ONLY**:
1. **Master Data**: Product Master, Customer Master, Supplier Master, Commercial Addresses, Commercial Contacts.
2. **UOM**: UOM definitions and UOM conversion ratios.
3. **Pricing**: Commercial pricing lists, entity overrides, volume tiers, effective dates.
4. **Commercial Bulk Import**: Import-only service for Products, Customers, Suppliers (ADR-307: max 500 records, atomic rollback, idempotency header required).
5. **Supporting Infrastructure**: REST APIs under `/api/v1/commercial/*`, Zod validation, multi-tenant isolation, audit logging, unit/integration tests, and Master Data UI components.

*Excludes*: Quotations, Sales Orders, Deliveries, Sales Invoices, Credit Notes, Purchase Requests, POs, GRNs, Supplier Bills, Debit Notes.

---

## 24. TESTING STRATEGY

Multi-layered testing strategy: Unit tests, Integration tests (PostgreSQL, Numbering, Audit, Isolation), Financial Integration tests (`AccountingCore` postings, AR/AP open items, `ExactDecimal` zero-rounding checks), Concurrency tests, and E2E scenario fixtures.

---

## 25. RISK REGISTER

| Risk ID | Risk Description | Severity | Likelihood | Mitigation Strategy | Detection Method |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **R-301** | Parallel Accounting Subledger Creation | HIGH | LOW | Enforce architectural invariant: Sales/Procurement must call `arDocumentService` / `apDocumentService` / `AccountingCore`. | Code review & AST dependency checks. |
| **R-302** | Tax Rate Shift Altering Historical Documents | HIGH | LOW | Snapshot calculated tax breakdowns into `sales_invoice_tax_snapshots` upon posting. | Integration test verifying rate change doesn't modify posted invoice. |
| **R-303** | Concurrent Double-Posting of Invoices | HIGH | LOW | Utilize database `version` optimistic locking and `idempotencyKey` checks in `AccountingCore`. | Concurrent execution test fixture. |
| **R-304** | Inventory Scope Leakage into Phase 3 | MEDIUM | LOW | Restrict Phase 3 strictly to quantity tracking (`dispatchedQuantity`, `receivedQuantity`). Defer stock valuation. | Architectural review during Subphase 3.3 / 3.7. |
| **R-305** | Credit Limit Bypass on Sales Orders | HIGH | LOW | Enforce credit checks synchronously inside `salesOrderService.confirmOrder()` database transaction. | Automated unit test with over-limit customer balance. |
| **R-306** | 3-Way Match Price Mismatch in Procurement | MEDIUM | HIGH | Enforce configurable tolerance checks in `supplierBillService` prior to AP/GL posting. | Integration test verifying bill rejection on price variance. |
| **R-307** | Bulk Import Corrupting Master Data | MEDIUM | LOW | Enforce single atomic database transaction, Zod row-level validation, max 500 record limit, and idempotency header (ADR-307). | Bulk import integration tests. |

---

## 26. ARCHITECTURAL DECISIONS

| Decision ID | Area | Status | Architectural Decision Summary |
| :--- | :--- | :--- | :--- |
| **ADR-301** | Product Ownership | **DECIDED** | Product Master (`products`) schema owned by `packages/database/src/schema/commercial-master.ts` and service owned by `apps/api/src/modules/commercial/product.service.ts`. |
| **ADR-302** | Subledger Authority | **DECIDED** | AR Subledger (Phase 2.6) and AP Subledger (Phase 2.7) remain sole authoritative subledgers for Customer Receivables and Supplier Payables. |
| **ADR-303** | Financial Posting | **DECIDED** | Operational documents (Quotations, Orders, Deliveries, PRs, GRNs) DO NOT generate GL entries. Only Financial documents (Invoices, Bills, Notes) post to GL. |
| **ADR-304** | Tax Calculations | **DECIDED** | Dynamic tax evaluation uses Centralized Tax Engine (`taxEngineService`). Posting freezes immutable tax snapshots into snapshot tables. |
| **ADR-305** | Document Numbering | **DECIDED** | Numbering Engine (`numberingEngine`) generates all sequential document numbers with tenant/company/branch isolation. |
| **ADR-306** | 3-Way Match Tolerance | **PROPOSED** | Supplier Bills require 3-Way Match verification against PO prices and GRN quantities. Variance tolerance (default 2%) is configurable via Rules Engine. *(Future Phase 3.8 Scope)*. |
| **ADR-307** | Commercial Master Data Bulk Import | **DECIDED** | Bulk Import for Products, Customers, and Suppliers enforces a maximum batch size of 500 records per request. **Atomicity**: Single DB transaction (`BEGIN ... COMMIT`); entire batch rolls back if any row fails validation or unique constraint. **Idempotency**: Idempotency header required (`Idempotency-Key`); duplicate submissions return cached result. Duplicate codes/SKUs are rejected with row-level validation errors (no silent overwrites). **Scope**: Import-only in Phase 3.0; Export deferred to Phase 5. |
| **ADR-308** | Address & Contact Schema | **DECIDED** | Addresses and Contacts use relational tables (`commercial_addresses`, `commercial_contacts`) with explicit nullable FKs (`customerId`, `supplierId`, `branchId`) and CHECK constraints. |

---

## 27. PROPOSED FILE / MODULE STRUCTURE

```
apps/api/src/modules/
├── commercial/                     # Phase 3.0 Shared Commercial Foundation
│   ├── product.service.ts
│   ├── customer.service.ts
│   ├── supplier.service.ts
│   ├── pricing.service.ts
│   ├── uom.service.ts
│   └── commercial-import.service.ts
├── sales/                          # Sales Domain Module (Subphases 3.1 - 3.5)
│   ├── quotation.service.ts
│   ├── sales-order.service.ts
│   ├── delivery.service.ts
│   ├── sales-invoice.service.ts
│   └── sales-credit-note.service.ts
└── procurement/                    # Procurement Domain Module (Subphases 3.6 - 3.9)
    ├── purchase-request.service.ts
    ├── purchase-order.service.ts
    ├── goods-receipt.service.ts
    ├── supplier-bill.service.ts
    └── purchase-debit-note.service.ts

packages/database/src/schema/
├── commercial-master.ts            # Products, Customers, Suppliers, Addresses, Contacts, UOM, Pricing
├── sales.ts                        # Quotations, Orders, Deliveries, Invoices, Tax Snapshots, Credit Notes
└── procurement.ts                  # Requisitions, POs, GRNs, Bills, Tax Snapshots, Debit Notes
```

---

## 28. DATABASE MIGRATION STRATEGY

Migration sequence following existing history (`migrations/001` through `009`):
1. **`010_phase3_0_commercial_foundation.sql`**: Creates `commercial_addresses`, `commercial_contacts`, `uom_definitions`, `uom_conversions`, `pricing_lists`, `pricing_rules`, and enhances `products`, `customers`, and `suppliers` tables.
2. **`011_phase3_sales_domain.sql`**: Creates `sales_quotations`, `sales_quotation_lines`, `sales_orders`, `sales_order_lines`, `sales_deliveries`, `sales_delivery_lines`, `sales_invoices`, `sales_invoice_lines`, `sales_invoice_tax_snapshots`, `sales_credit_notes`, `sales_credit_note_lines`.
3. **`012_phase3_procurement_domain.sql`**: Creates `purchase_requests`, `purchase_request_lines`, `purchase_orders`, `purchase_order_lines`, `goods_receipts`, `goods_receipt_lines`, `supplier_bills`, `supplier_bill_lines`, `supplier_bill_tax_snapshots`, `purchase_debit_notes`, `purchase_debit_note_lines`.

---

## 29. PHASE 3 MASTER ACCEPTANCE CRITERIA

1. **End-to-End Sales Lifecycle**: `Quotation → Sales Order → Delivery → Sales Invoice → AR Open Item → GL Posting → AR Payment Allocation` with 100% financial balance reconciliation.
2. **End-to-End Procurement Lifecycle**: `Purchase Request → Purchase Order → Goods Receipt → Supplier Bill → AP Open Payable → GL Posting → AP Payment Allocation` with 3-Way Match validation.
3. **Tax Integrity**: India GST calculations match `taxEngineService` outputs to 2 decimal places. Posted tax breakdowns match frozen snapshots.
4. **Immutability Protection**: Attempting to edit or delete a POSTED Sales Invoice or Supplier Bill throws an `UNAUTHORIZED_STATE_TRANSITION` error.
5. **Multi-Tenant Isolation**: Zero cross-tenant or cross-company data leakage across all commercial API endpoints.
6. **Zero Accounting Regressions**: All 817 existing Phase 2 finance tests pass without modification.

---

## 30. PHASE 3.11 VERIFICATION GATE DESIGN

Automated verification suite (`apps/api/test/phase3_11_full_verification_gate.test.ts`) executing deterministic scenario fixtures reconciling GL, AR, AP, Tax, Discounts, Partial Allocation, and Fiscal Period controls.

---

## 31. NEXT IMPLEMENTATION STEP

The authorized next implementation target following formal approval of this planning document is:

### **Phase 3.0 — Shared Commercial Foundation**

The Phase 3.0 scope includes:
1. Database migration `010_phase3_0_commercial_foundation.sql` (`packages/database/src/schema/commercial-master.ts`).
2. Services for Product, Customer, Supplier, UOM, Pricing, and Commercial Bulk Import (`apps/api/src/modules/commercial/`).
3. REST API routes under `/api/v1/commercial/*` with Zod validation, authorization guards, tenant isolation, audit logging, and unit/integration test suites.

*No implementation code will be created until explicit human instruction to begin Phase 3.0 is issued.*
