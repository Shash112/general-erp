# Phase 3.4 — Sales Invoicing + AR + Accounting Implementation Report

## Summary
Phase 3.4 (Sales Invoicing + AR Subledger + Accounting Core Posting) has been successfully implemented and fully verified for the General ERP modular monolith.

This phase completes the financial posting loop for sales operations: converting confirmed Sales Orders or dispatched Sales Deliveries into immutable Sales Invoices with GST tax breakdown, automatically populating Accounts Receivable (AR) open items, posting balanced General Ledger (GL) journal entries via `arDocumentService` and `AccountingCore`, and updating Sales Order statuses to `COMPLETED` when all lines are fully delivered and fully invoiced.

---

## What Was Implemented

### 1. Database Schema & Migration
- **Schema definition**: `packages/database/src/schema/sales-invoice.ts`
  - Created `sales_invoices` (header) and `sales_invoice_lines` (lines) relational tables.
  - Exported schema from `packages/database/src/index.ts`.
  - Added unique constraint `uq_sales_invoice_tenant_company_num` on `(tenant_id, company_id, invoice_number)`.
  - Added check constraints `chk_sales_invoice_status` (DRAFT, POSTED, CANCELLED) and `chk_sales_invoice_line_qty_pos` (`invoiced_quantity > 0`).
  - Added foreign key constraints with `ON DELETE RESTRICT` for parent entities and `ON DELETE CASCADE` for line items.
- **Migration file**: `packages/database/migrations/014_phase3_sales_invoices.sql`
  - Raw PostgreSQL DDL script creating tables, indices, foreign keys, and check constraints.

### 2. Domain Service & Business Logic
- **`SalesInvoiceService`**: `apps/api/src/modules/sales/sales-invoice.service.ts`
  - **`createFromOrder`**: Validates order state (`CONFIRMED` or `COMPLETED`), validates line quantities, prevents over-invoicing (`invoicedQuantity <= orderedQuantity - cancelledQuantity`), locks rows using PostgreSQL `FOR UPDATE` in DB transactions, calculates GST taxes, generates invoice sequence numbers, and updates order line invoiced quantities.
  - **`postInvoice`**: Validates `DRAFT` status, formats monetary amounts, generates AR Document via `arDocumentService.createDraft`, posts AR Document via `arDocumentService.postDocument` (which triggers GL Journal Entry creation), matches AR Open Item ID, marks invoice as `POSTED`, records `arDocumentId`, `arOpenItemId`, `journalEntryId`, and updates parent Sales Order status to `COMPLETED` if all order lines are fully delivered and fully invoiced.
  - **`cancelInvoice`**: Allows cancelling `DRAFT` invoices, releasing invoiced quantities back to order lines. Enforces strict financial immutability for `POSTED` invoices.
  - **`getInvoiceById` & `listInvoices`**: Comprehensive query functions with filtering by `companyId`, `status`, `customerId`, `salesOrderId`, and search term.
  - **In-Memory Store Fallback**: Fully isolated memory store for atomic unit testing without requiring an active DB connection.

### 3. REST API Routes & Controllers
- **Routes plugin**: `apps/api/src/routes/sales-invoice.routes.ts`
- Registered in `apps/api/src/app.ts` under `/api/v1/sales/invoices`.
- Implemented HTTP Endpoints:
  - `POST /api/v1/sales/invoices/from-order` (Create invoice from order/delivery)
  - `GET /api/v1/sales/invoices` (List invoices with query filters)
  - `GET /api/v1/sales/invoices/:id` (Get invoice by ID)
  - `POST /api/v1/sales/invoices/:id/post` (Post invoice & generate AR/GL entries)
  - `POST /api/v1/sales/invoices/:id/cancel` (Cancel draft invoice)
  - `GET /api/v1/sales/orders/:orderId/invoices` (List invoices for an order)

### 4. React Sales Invoicing Workbench UI
- `apps/web/src/components/sales/SalesInvoiceHub.tsx` (Main hub container)
- `apps/web/src/components/sales/InvoiceListTable.tsx` (Data grid with status badges & filter controls)
- `apps/web/src/components/sales/InvoiceDetailsView.tsx` (Master-detail view with AR/GL linkage & audit status)
- `apps/web/src/components/sales/InvoiceLineTable.tsx` (Tax breakdown table with HSN/SAC, CGST, SGST, IGST, and line totals)

### 5. Automated Tests & Verification Suite
- `apps/api/test/phase3_4_sales_invoices.test.ts`
  - Validates draft invoice creation from confirmed order.
  - Enforces over-invoicing prevention safeguard.
  - Tests posting an invoice, verifying `arDocumentId`, `arOpenItemId`, and `journalEntryId` population.
  - Tests order completion state transition (`CONFIRMED -> COMPLETED`).
  - Tests strict financial immutability (prohibits editing/cancelling posted invoices).

---

## Architectural Verification & Invariants

1. **Financial Immutability**: Once an invoice is POSTED, its amounts, lines, and financial links cannot be modified or cancelled directly.
2. **AR & Accounting Integration**: Posting a Sales Invoice creates an AR Document, generates an open item in the AR Subledger, and posts a balanced journal entry in `AccountingCore`.
3. **Order Fulfillment & Lifecycle Alignment**: Sales Order status transitions to `COMPLETED` when all lines have `deliveredQuantity >= netRequired` AND `invoicedQuantity >= netRequired`.
4. **Dependency Boundary Compliance**: Platform engines (`src/platform/**`) remain strictly decoupled from business domain services (`src/modules/**`).
