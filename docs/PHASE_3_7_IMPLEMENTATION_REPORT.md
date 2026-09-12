# Phase 3.7 — Sourcing, RFQs, Supplier Quotations & Purchase Orders Implementation Report

## Executive Summary
Phase 3.7 implements the procurement commercial sourcing chain for General ERP as a production-grade vertical slice:
```text
APPROVED PURCHASE REQUEST -> RFQ -> SUPPLIER QUOTATION -> QUOTATION COMPARISON -> AWARD -> PURCHASE ORDER
```

All 133 implementation guidelines and strict non-negotiable boundaries from the Phase 3.7 specification have been satisfied and verified:
- **0 GL Postings, 0 AP Open Items, 0 Stock Movements** across all RFQ, Quotation, Comparison, Award, and Purchase Order workflows.
- Full exact decimal monetary and quantity calculation via `ExactDecimal` (scale 2 for money, scale 4 for quantities).
- Upstream purchase request consumption tracking ($\sum \text{orderedQuantity} \le \text{requestedQuantity}$) with optimistic concurrency protection.
- Deep integration with platform engines: Numbering Engine (`RFQ`, `SUPPLIER_QUOTATION`, `PURCHASE_ORDER`), Audit Engine (`procurement::ProcurementRfq`, `ProcurementSupplierQuotation`, `ProcurementQuotationComparison`, `PurchaseOrder`), Authorization Engine (`authorizationService`), and Workflow/Rules Engine abstractions.
- Sourcing and Purchase Order Web UI Workbench with table views, detail panels, comparison matrix, creation modals, and lifecycle transition controls.

---

## Architecture & Domain Model

### 1. RFQ Domain (`procurement_rfqs`, `procurement_rfq_lines`, `procurement_rfq_suppliers`)
- **Header**: RFQ number, title, purpose, instructions, terms, currency, response due date, state (`DRAFT` -> `PUBLISHED` -> `RESPONSE_OPEN` -> `RESPONSE_CLOSED` -> `EVALUATED` -> `AWARDED` / `CANCELLED`), optional `purchaseRequestId`.
- **Lines**: Item description, specification, requested quantity, UOM, requested target date, optional `purchaseRequestLineId`.
- **Suppliers**: Multi-supplier invitation mapping (`supplierId`, status `INVITED` | `ACKNOWLEDGED` | `DECLINED` | `RESPONDED` | `OVERDUE`).

### 2. Supplier Quotation Domain (`procurement_supplier_quotations`, `procurement_supplier_quotation_lines`)
- **Header**: Internal quote number, supplier quote reference, RFQ link (`rfqId`), supplier link (`supplierId`), validity date, commercial terms (payment, delivery, warranty, shipping terms), exact decimal subtotal, discount, tax, total.
- **Lines**: `rfqLineId`, `productId`, description, quoted quantity, unit price, discount, tax, taxable amount, line total, lead time (days), delivery date, technical specs.
- State machine: `DRAFT` -> `SUBMITTED` -> `UNDER_REVIEW` -> `ACCEPTED` -> `AWARDED` / `REJECTED` / `WITHDRAWN` / `EXPIRED` / `CANCELLED`.

### 3. Comparison & Award Domain (`procurement_quotation_comparisons`, `procurement_quotation_comparison_lines`)
- Decision-support record aggregating supplier quotes for an RFQ line-by-line.
- Supports commercial comparison (unit price, total landed amount, lead time, delivery terms, payment terms, technical compliance).
- Supports single-supplier and split-supplier line-level awards without forcing a single global supplier win.

### 4. Purchase Order Domain (`purchase_orders`, `purchase_order_lines`)
- **Header**: PO number, supplier link (`supplierId`), source references (`rfqId`, `supplierQuotationId`, `purchaseRequestId`), PO date, expected delivery date, currency & exchange rate, billing/shipping location, commercial terms, exact decimal subtotal, discount, taxable amount, tax, rounding, grand total.
- **Lines**: `line_number`, `purchaseRequestLineId`, `rfqLineId`, `supplierQuotationLineId`, `productId`, `productCodeSnapshot`, `productNameSnapshot`, description, ordered quantity, unit price, discount, taxable amount, tax, line total, expected delivery date.
- State machine: `DRAFT` -> `SUBMITTED` -> `APPROVED` -> `ISSUED` -> `ACKNOWLEDGED` / `CANCELLED`.

---

## Database Migration

Migration `017_phase3_7_sourcing_purchase_orders.sql` adds 9 tables:
- `procurement_rfqs`
- `procurement_rfq_lines`
- `procurement_rfq_suppliers`
- `procurement_supplier_quotations`
- `procurement_supplier_quotation_lines`
- `procurement_quotation_comparisons`
- `procurement_quotation_comparison_lines`
- `purchase_orders`
- `purchase_order_lines`

All tables include tenant (`tenant_id`), company (`company_id`), optimistic locking (`version`), timestamping, foreign key constraints with `CASCADE` on detail lines, unique constraints (`rfq_number`, `quote_number`, `po_number`), indices for common query access patterns, and database check constraints (`chk_rfqs_status`, `chk_sq_status`, `chk_po_status`, `chk_po_qty_pos`).

---

## Lifecycle States & Semantics

### RFQ Lifecycle
- `DRAFT`: Internal creation and preparation.
- `PUBLISHED`: Issued to invited suppliers.
- `RESPONSE_OPEN`: Capturing supplier quotes.
- `RESPONSE_CLOSED`: Quoting deadline passed / closed for quotes.
- `EVALUATED`: Comparison generated and reviewed.
- `AWARDED`: Sourcing decision finalized.
- `CANCELLED`: Terminal cancellation.

### Supplier Quotation Lifecycle
- `DRAFT`: Draft entry.
- `SUBMITTED`: Formally submitted quote.
- `UNDER_REVIEW`: In comparison evaluation.
- `ACCEPTED` / `AWARDED`: Quote accepted for PO issuance.
- `REJECTED` / `WITHDRAWN` / `EXPIRED` / `CANCELLED`: Terminal non-awarded states.

### Purchase Order Lifecycle
- `DRAFT`: Initial order creation.
- `SUBMITTED`: Submitted for internal workflow approval.
- `APPROVED`: Approved by authority.
- `ISSUED`: Formally transmitted to supplier.
- `ACKNOWLEDGED`: Confirmed by supplier.
- `CANCELLED`: Cancelled prior to fulfillment (restores PR consumed quantity).

---

## Platform Engine Integration

1. **Numbering Engine**: Generates concurrency-safe document numbers (`RFQ-YYYY-MM-XXXX`, `SQ-YYYY-MM-XXXX`, `PO-YYYY-MM-XXXX`) using fiscal-year and company-scoped sequences.
2. **Audit Engine**: Records append-only SHA-256 hash-chained audit events for `procurement::ProcurementRfq`, `ProcurementSupplierQuotation`, `ProcurementQuotationComparison`, and `PurchaseOrder`.
3. **Authorization Engine**: Enforces RBAC permissions (`procurement:rfq:read`, `procurement:rfq:create`, `procurement:rfq:publish`, `procurement:rfq:cancel`, `procurement:quotation:read`, `procurement:quotation:create`, `procurement:quotation:submit`, `procurement:quotation:award`, `procurement:po:read`, `procurement:po:create`, `procurement:po:submit`, `procurement:po:approve`, `procurement:po:issue`, `procurement:po:acknowledge`, `procurement:po:cancel`).
4. **Workflow & Rules Engines**: Validates multi-level approval policy routing, single-source justification requirements, and minimum supplier quote policies.

---

## Exact Decimal Arithmetic & Money Handling

Calculations use `ExactDecimal` (BigInt-based exact representation with zero IEEE-754 floating point arithmetic):
- Money amounts: scale 2 (`ExactDecimal.parse(val, 2)`).
- Quantities: scale 4 (`ExactDecimal.parse(val, 4)`).
- Percentage Tax calculation:
  ```ts
  const lineTaxableBigInt = lineTaxable.rawBigInt; // scale 2
  const taxRateBigInt = taxRateDec.rawBigInt;     // scale 2
  const unroundedTax = lineTaxableBigInt * taxRateBigInt; // scale 4 (* 1/100 -> scale 6 source)
  const lineTax = ExactDecimal.halfEvenRound(unroundedTax, 6, 2);
  ```
- Subtotal, Taxable Amount, Tax, and Grand Total reconciliations strictly validate that `GrandTotal = Subtotal - Discount + Tax + Rounding`.

---

## Sourcing & Purchase Order REST APIs

### Sourcing Endpoints (`/api/v1/procurement/`)
- `POST /rfqs` - Create RFQ
- `GET /rfqs` - List RFQs
- `GET /rfqs/:id` - Get RFQ Details
- `POST /rfqs/:id/publish` - Publish RFQ
- `POST /rfqs/:id/close` - Close RFQ
- `POST /rfqs/:id/cancel` - Cancel RFQ
- `POST /supplier-quotations` - Submit Supplier Quotation
- `GET /supplier-quotations` - List Supplier Quotations
- `GET /supplier-quotations/:id` - Get Supplier Quotation Details
- `POST /rfqs/:rfqId/comparison` - Build Comparison Matrix
- `GET /rfqs/:rfqId/comparison` - Get Comparison Matrix
- `POST /rfqs/:rfqId/award` - Award Quotation / Lines

### Purchase Order Endpoints (`/api/v1/procurement/purchase-orders`)
- `POST /` - Create Purchase Order
- `GET /` - List Purchase Orders
- `GET /:id` - Get Purchase Order Details
- `POST /:id/submit` - Submit PO for Approval
- `POST /:id/approve` - Approve PO
- `POST /:id/issue` - Issue PO to Supplier
- `POST /:id/acknowledge` - Record Supplier Acknowledgement
- `POST /:id/cancel` - Cancel PO (restores PR quantities)

---

## Web UI Workbench

Located in `apps/web/src/components/procurement/`:
- `RFQHub.tsx` & `PurchaseOrderHub.tsx`: Main tabbed hubs with search, filters, statistics cards, and action buttons.
- `RFQListTable.tsx` & `PurchaseOrderListTable.tsx`: Styled datatables with status badges, supplier information, and contextual action menus.
- `RFQFormModal.tsx`, `SupplierQuotationFormModal.tsx`, `PurchaseOrderFormModal.tsx`: Multi-line entry dialogs pre-filling upstream supplier, product, UOM, and commercial pricing.
- `QuotationComparisonView.tsx`: Side-by-side matrix comparing prices, lead times, payment terms, and split-award selection controls.
- `PurchaseOrderDetailsView.tsx`: Comprehensive detail page with line items, tax breakdowns, approval status, source traceability links, and audit history.

---

## Traceability & Quantity Controls

- **Upstream Traceability**: Full document lineage preserved across `Purchase Order -> Award -> Supplier Quotation -> RFQ -> Purchase Request`.
- **Quantity Consumption Control**:
  - Validates `orderedQuantity <= requestedQuantity - alreadyOrderedQuantity`.
  - Atomically increments `orderedQuantity` on `procurement_request_lines`.
  - Automatically transitions `procurement_requests` status (`PARTIALLY_ORDERED` vs `FULLY_ORDERED`).
  - Restores PR ordered quantities on PO cancellation.

---

## Boundary Verification Assertions

1. **Zero Financial Impact Assertion**:
   - `GL Journal Entries created`: **0**
   - `AP Open Items created`: **0**
   - Verified across RFQ creation, RFQ publishing, Supplier Quotation submission, Comparison evaluation, Awarding, PO creation, PO approval, PO issuance, and PO acknowledgement.
2. **Zero Inventory Impact Assertion**:
   - `Stock Ledger / Warehouse movements`: **0**
   - `Goods Receipt Notes (GRN) created`: **0**

---

## Test Verification & Suite Results

### Integration Test Suite (`apps/api/test/phase3_7_sourcing_purchase_orders.test.ts`)
1. `Phase 3.7 — End-to-End Procurement Sourcing to Purchase Order Flow`: **PASS**
2. `Phase 3.7 — Financial & Inventory Zero-Boundary Assertion`: **PASS**
3. `Phase 3.7 — PR Over-Ordering Prevention & Quantity Consumption`: **PASS**
4. `Phase 3.7 — Immutability of Issued PO & Version Concurrency Check`: **PASS**
5. `Phase 3.7 — Multi-Tenant and Multi-Company Isolation Security`: **PASS**

**Result**: 5 / 5 tests passed (100%). Zero TypeScript type check errors across all packages (`@general-erp/core`, `@general-erp/database`, `@general-erp/api`, `@general-erp/web`).

---

## Known Limitations & Architectural Deviations

- **Known Limitations**:
  - GRN / Warehouse receiving (Phase 3.8 / 3.9 scope).
  - Supplier Invoicing, 3-Way Matching, and AP Liability Posting (Phase 3.8 scope).
  - Supplier Debit Notes & Procurement Returns (Phase 3.9 scope).
- **Architectural Deviations**: None. All domain logic strictly adheres to `GEMINI.md` and `MASTER_REMAINING_ARCHITECTURE_AND_IMPLEMENTATION_PLAN.md`.

---

## Next Implementation Slice
**Phase 3.8 — Supplier Billing, AP Integration & 3-Way Matching**.
