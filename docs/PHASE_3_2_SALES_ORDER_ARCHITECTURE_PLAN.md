# PHASE 3.2 — SALES ORDERS ARCHITECTURE & IMPLEMENTATION PLAN

## 1. STRICT EXECUTION BOUNDARY & PLAN STATUS

> [!IMPORTANT]
> **THIS IS A PLANNING-ONLY ARCHITECTURE SPECIFICATION.**
> No Phase 3.2 source code, database migrations, schema edits, API controllers, frontend implementations, or test suites have been created for Phase 3.2.
>
> Implementation of Phase 3.2 is strictly **PAUSED** pending explicit human review and approval of this corrected architecture plan.

### Subphase Scope Matrix

* **IN SCOPE (Phase 3.2 Planning Target)**:
  - `sales_orders` table schema & relational constraints.
  - `sales_order_lines` table schema & line item model.
  - Sales Order domain service (`SalesOrderService`).
  - Conversion contract consumption from Phase 3.1 `QuotationConversionContract` (using explicit contract fields `billingAddressId`, `shippingAddressId`, `contactId`).
  - Authoritative execution of quotation status transition `ACCEPTED → CONVERTED` upon contract consumption.
  - Customer credit-limit validation and total credit exposure calculation.
  - Pessimistic row locking on Customer records (`SELECT ... FOR UPDATE`) during order confirmation to prevent credit-check race conditions.
  - Sales Order lifecycle state machine (`DRAFT`, `CONFIRMED`, `CANCELLED`, `COMPLETED` contract boundary).
  - Commercial snapshot preservation (prices, discounts, allocated header discount, GST rates, tax amounts, address snapshots, contact snapshot, terms, currency, exchange rate).
  - Numbering Engine integration via platform `numberingEngine` (`SO-YYYY-XXXX`).
  - Dual-layer idempotency: Conversion idempotency via `sales_orders.conversion_contract_id` UNIQUE constraint and API request idempotency header handling.
  - Multi-currency validation and `totalAmountBase` calculation.
  - REST API specifications (`/api/v1/sales/orders/*`).
  - Fine-grained permission matrix (`sales:order:read`, `sales:order:create`, `sales:order:confirm`, `sales:order:cancel`, `sales:order:override_credit`).
  - Audit Engine & Notification Engine event integrations.
  - React Sales Order Workbench UI architecture (`apps/web/src/components/sales/*`).
  - Comprehensive unit, integration, concurrency, and E2E test plan.

* **STRICTLY OUT OF SCOPE (Deferred to Subphases 3.3+)**:
  - Executing `CONFIRMED → COMPLETED` transition or evaluating delivery completion — Phase 3.3 / Phase 3.4.
  - Sales Delivery & Dispatch execution (`sales_deliveries`, `sales_delivery_lines`) — Phase 3.3.
  - Warehouse stock reservation & inventory allocation — Phase 3.3.
  - Inventory stock ledger postings & inventory valuation — Inventory Domain.
  - Sales Invoices (`sales_invoices`), AR open item posting, & GL journal posting — Phase 3.4.
  - Sales Returns & Credit Notes — Phase 3.5.
  - Procurement Domain — Phase 3.6 to 3.9.

Phase 3.2 MUST create **zero Sales Deliveries**, **zero AR open items**, and **zero GL journal entries**.

---

## 2. SOURCE OF TRUTH & PLATFORM ENGINE REUSE

This architecture is strictly anchored in the General ERP Product Requirements Specification (`docs/PRODUCT_REQUIREMENTS_SPECIFICATION.md`), Phase 3 Master Architecture, Phase 3.1 Quotation Implementation, and existing platform engines.

```
User / API / UI
       │
       ▼
SalesOrderService ──► QuotationConversionContract (Phase 3.1 Immutable Commercial Envelope)
       │
       ├──► Customer Credit Evaluator ──► Phase 2.6 AR Subledger (`ar_open_items`)
       ├──► Rules & Policy Engine ─────► Maximum Credit / Approval Policy
       ├──► Authorization Service ────► Fine-Grained Order Permissions
       ├──► Numbering Engine ──────────► Sequential `SO-YYYY-XXXX` Order Numbering
       ├──► Audit Engine ──────────────► Cryptographic Hash-Chained Audit Trail
       └──► PostgreSQL System of Record (Atomic Transaction & Row Locking)
```

### Platform Engine Dependencies

1. **Master Data Engine**: Consumes Product Master (`products`), Customer Master (`customers`), Commercial Address (`commercial_addresses`), Commercial Contact (`commercial_contacts`), and UOM (`uom_definitions`).
2. **Phase 3.1 Quotation Contract Engine**: Consumes `QuotationConversionContract` verbatim. Zero commercial re-resolution.
3. **Phase 2.6 Accounts Receivable Engine**: Queries `ar_open_items` and `customer_receipts` for real-time customer credit exposure evaluation. Zero duplicate AR tracking tables.
4. **Numbering Engine**: Generates sequential `SO-YYYY-XXXX` document numbers.
5. **Authorization & Policy Engine**: Enforces RBAC/ABAC and credit override privileges.
6. **Audit Engine**: Logs tamper-evident SHA-256 hash-chained audit records for order creation, confirmation, cancellation, and credit overrides.
7. **Idempotency Engine**: Enforces double-conversion protection via `conversion_contract_id` UNIQUE constraint and request-level idempotency headers.

---

## 3. QUOTATION CONVERSION CONTRACT & CONSUMPTION ARCHITECTURE

The Phase 3.1 `QuotationConversionContract` is the **single authoritative commercial source** for Sales Order creation.

### Zero Recalculation Principle

Phase 3.2 **MUST NOT** re-resolve or recalculate:
- Unit prices or price list rules
- Volume tier discounts
- Line discounts or discount percentages
- Line gross amounts (`sales_order_lines.gross_amount` copied verbatim from `contract.lines[i].grossAmount`)
- Header discount or allocated header discount amounts
- Line taxable amounts
- GST rates (CGST, SGST, IGST) or tax amounts
- Billing or shipping address snapshots
- Contact snapshot
- Commercial terms and conditions
- Transaction currency or exchange rate

### Explicit Field-by-Field Mapping Table

| Target `sales_orders` Field | Source `QuotationConversionContract` Field | Mapping Rule | Immutability Rule |
| :--- | :--- | :--- | :--- |
| `id` | Generated (`UUID`) | System generated PK | Immutable |
| `tenant_id` | `contract.tenantId` | Verbatim copy | Immutable |
| `company_id` | `contract.companyId` | Verbatim copy | Immutable |
| `order_number` | Numbering Engine | Generated (`SO-YYYY-XXXX`) | Immutable |
| `quotation_id` | `contract.quotationId` | Verbatim reference FK to `sales_quotations.id` | Immutable |
| `quotation_number` | `contract.quotationNumber` | Verbatim copy | Immutable |
| `revision_number` | `contract.revisionNumber` | Verbatim copy | Immutable |
| `conversion_contract_id` | `contract.contractId` | Unique application contract UUID (NOT a DB FK) | Immutable |
| `customer_id` | `contract.customerId` | Verbatim FK to `customers.id` | Immutable |
| `order_date` | Current Date (`YYYY-MM-DD`) | Order creation date | Immutable |
| `currency` | `contract.currency` | Verbatim copy | Immutable |
| `exchange_rate` | `contract.exchangeRate` | Verbatim copy | Immutable |
| `sales_representative_id` | `contract.salesRepresentativeId` | Verbatim copy | Immutable |
| `billing_address_id` | `contract.billingAddressId` | Explicit contract FK to `commercial_addresses.id` | Immutable |
| `shipping_address_id` | `contract.shippingAddressId` | Explicit contract FK to `commercial_addresses.id` | Immutable |
| `billing_address_snapshot` | `contract.billingAddressSnapshot` | Verbatim JSONB snapshot copy | Frozen at conversion |
| `shipping_address_snapshot` | `contract.shippingAddressSnapshot` | Verbatim JSONB snapshot copy | Frozen at conversion |
| `contact_id` | `contract.contactId` | Explicit contract FK to `commercial_contacts.id` (optional) | Immutable |
| `contact_snapshot` | `contract.contactSnapshot` | Verbatim JSONB snapshot copy | Frozen at conversion |
| `status` | Defaults to `'DRAFT'` | Initial state upon conversion | Mutable via state machine |
| `notes` | Request input / contract notes | Optional order notes | Mutable in DRAFT |
| `terms_and_conditions` | `contract.termsAndConditions` | Verbatim copy | Immutable |
| `subtotal_amount` | `contract.subtotalAmount` | Verbatim copy | Frozen |
| `header_discount_amount` | `contract.headerDiscountAmount` | Verbatim copy | Frozen |
| `discount_amount` | `contract.discountAmount` | Verbatim copy | Frozen |
| `taxable_amount` | `contract.taxableAmount` | Verbatim copy | Frozen |
| `tax_amount` | `contract.taxAmount` | Verbatim copy | Frozen |
| `total_amount` | `contract.totalAmount` | Verbatim copy | Frozen |
| `total_amount_base` | `contract.totalAmountBase` | Verbatim copy | Frozen |

### Line Item Mapping Table (`lines[] → sales_order_lines`)

| Target `sales_order_lines` Field | Source `contract.lines[]` Field | Mapping Rule | Immutability Rule |
| :--- | :--- | :--- | :--- |
| `id` | Generated (`UUID`) | System generated PK | Immutable |
| `order_id` | `sales_orders.id` | Header FK to `sales_orders.id` (`ON DELETE CASCADE`) | Immutable |
| `quotation_line_id` | `line.quotationLineId` | Explicit DB FK to `sales_quotation_lines.id` (`ON DELETE RESTRICT`) | Immutable |
| `tenant_id` | `contract.tenantId` | Verbatim copy | Immutable |
| `company_id` | `contract.companyId` | Verbatim copy | Immutable |
| `line_number` | `line.lineNumber` | Verbatim copy | Immutable |
| `product_id` | `line.productId` | Verbatim FK to `products.id` | Immutable |
| `product_code_snapshot` | `line.productCodeSnapshot` | Verbatim copy | Frozen |
| `product_name_snapshot` | `line.productNameSnapshot` | Verbatim copy | Frozen |
| `description` | `line.description` | Verbatim copy | Mutable in DRAFT |
| `uom` | `line.uom` | Verbatim FK to `uom_definitions.code` | Frozen |
| `ordered_quantity` | `line.quantity` | Verbatim copy | Frozen at confirmation |
| `delivered_quantity` | Defaults to `'0.0000'` | Phase 3.3 handoff counter | Updated by Phase 3.3 |
| `invoiced_quantity` | Defaults to `'0.0000'` | Phase 3.4 handoff counter | Updated by Phase 3.4 |
| `cancelled_quantity` | Defaults to `'0.0000'` | Order cancellation counter | Updated on cancel |
| `unit_price` | `line.unitPrice` | Verbatim copy | Frozen |
| `discount_percent` | `line.discountPercent` | Verbatim copy | Frozen |
| `discount_amount` | `line.discountAmount` | Verbatim copy | Frozen |
| `allocated_header_discount_amount` | `line.allocatedHeaderDiscountAmount` | Verbatim copy | Frozen |
| `gross_amount` | `line.grossAmount` | Verbatim copy from contract (Zero calculation) | Frozen |
| `taxable_amount` | `line.taxableAmount` | Verbatim copy | Frozen |
| `hsn_sac` | `line.hsnSac` | Verbatim copy | Frozen |
| `cgst_rate` / `cgst_amount` | `line.cgstRate` / `line.cgstAmount` | Verbatim copy | Frozen |
| `sgst_rate` / `sgst_amount` | `line.sgstRate` / `line.sgstAmount` | Verbatim copy | Frozen |
| `igst_rate` / `igst_amount` | `line.igstRate` / `line.igstAmount` | Verbatim copy | Frozen |
| `tax_amount` | `line.taxAmount` | Verbatim copy | Frozen |
| `line_total` | `line.lineTotal` | Verbatim copy | Frozen |
| `pricing_source` / `pricing_rule_id` | `line.pricingSource` / `line.pricingRuleId` | Verbatim copy | Frozen |

---

## 4. CONVERSION OWNERSHIP & TRANSACTION ATOMICITY (`ACCEPTED → CONVERTED`)

Phase 3.2 exclusively owns the execution of the quotation lifecycle transition:

`ACCEPTED → CONVERTED`

### Phase 3.1 vs Phase 3.2 Conversion Guards

- **Phase 3.1 Guard (Contract Issuance)**:
  - Validates `quotation.status == 'ACCEPTED'` and `quotation.conversion_contract_id IS NULL`.
  - Generates `QuotationConversionContract`, stores `conversionContractId` on quotation header, leaves `status = 'ACCEPTED'`.
- **Phase 3.2 Guard (Contract Consumption)**:
  - Phase 3.2 **MUST NOT** require `quotation.conversion_contract_id IS NULL` (because Phase 3.1 already populated it during issuance!).
  - Phase 3.2 **MUST** validate that `quotation.conversion_contract_id == contract.contractId`.
  - Phase 3.2 enforces contract consumption uniqueness via `UNIQUE(tenant_id, company_id, conversion_contract_id)` on `sales_orders`.

### Revised Atomic Database Transaction Sequence

```sql
BEGIN TRANSACTION;

-- 1. Validate Supplied QuotationConversionContract Payload:
--    - Verify SHA-256 digest/hash matches contract.contractHash.
--    - Validate tenant_id and company_id match context.

-- 2. Lock Quotation Row Pessimistically:
SELECT id, status, conversion_contract_id, revision_number, quotation_number 
FROM sales_quotations 
WHERE id = :contract.quotationId 
  AND tenant_id = :ctx.tenantId 
  AND company_id = :ctx.companyId 
FOR UPDATE;

-- 3. Validate Authoritative Stored Contract Details:
--    - Assert quotation.status == 'ACCEPTED'.
--    - Assert quotation.conversion_contract_id == contract.contractId.
--    - Assert quotation.revision_number == contract.revisionNumber.
--    - Assert quotation.quotation_number == contract.quotationNumber.

-- 4. Check for Prior Order Consumption:
SELECT id FROM sales_orders 
WHERE conversion_contract_id = :contract.contractId 
  AND tenant_id = :ctx.tenantId 
  AND company_id = :ctx.companyId;
-- (If row exists, reject with CONVERSION_CONTRACT_ALREADY_CONSUMED).

-- 5. Generate Order Number:
orderNumber = numberingEngine.generateNextNumber(ctx, 'SALES_ORDER');

-- 6. Insert Sales Order Header & Lines:
INSERT INTO sales_orders (...);
INSERT INTO sales_order_lines (...);

-- 7. Update Quotation Status from ACCEPTED to CONVERTED:
UPDATE sales_quotations 
SET status = 'CONVERTED', 
    updated_at = NOW() 
WHERE id = :contract.quotationId;

-- 8. Record Audit Log & Emit Event:
auditService.logEvent(ctx, { action: 'CONSUME_CONVERSION_CONTRACT', ... });

COMMIT TRANSACTION;
```

### Rollback & Invariant Guarantees
* If any step fails (e.g. hash mismatch, contract already consumed, DB lock timeout), the transaction rolls back cleanly.
* **Zero Partial Conversions**: A Sales Order cannot be created without the corresponding quotation transitioning to `CONVERTED`.

---

## 5. SALES ORDER LIFECYCLE & STATE MACHINE

### State Vocabulary
- `DRAFT`: Initial order state upon conversion from contract. Mutable line descriptions and notes.
- `CONFIRMED`: Order confirmed after passing credit-limit evaluation. Commercial commitment locked. Fulfillment-ready for Phase 3.3.
- `CANCELLED`: Order cancelled prior to delivery. Reverses open order credit exposure.
- `COMPLETED`: Order fully delivered and invoiced downstream. **Phase 3.2 defines the schema/enum contract only. Phase 3.4 (`SalesInvoiceService`) owns the execution of the `CONFIRMED → COMPLETED` transition.**

### Single Authoritative Completion Ownership Model (`CONFIRMED → COMPLETED`)

- **Role of Phase 3.2**: Defines the `COMPLETED` status vocabulary / DB schema contract only. Phase 3.2 **NEVER** evaluates completion predicates or executes `CONFIRMED → COMPLETED`.
- **Role of Phase 3.3 (Sales Deliveries)**: Executes physical dispatches and tracks line fulfillment progress by incrementing `sales_order_lines.delivered_quantity`.
- **Role of Phase 3.4 (Sales Invoicing)**: Generates and posts Sales Invoices, increments `sales_order_lines.invoiced_quantity`, and **owns the execution of the state transition `CONFIRMED → COMPLETED`** upon posting the final invoice.
- **Exact Dual Completion Predicates Required for `CONFIRMED → COMPLETED`**:
  For all lines $i \in \{1 \dots N\}$ belonging to the Sales Order:
  1. **Delivery Completion Predicate**: `delivered_quantity == ordered_quantity`
  2. **Invoicing Completion Predicate**: `invoiced_quantity == ordered_quantity`
- **Execution Mechanism**: Upon posting a Sales Invoice, `SalesInvoiceService` (Phase 3.4) re-evaluates both predicates across all lines of the parent Sales Order. When both predicates evaluate to `TRUE` for all lines, `SalesInvoiceService` atomically updates `sales_orders.status = 'COMPLETED'`.

### State Transition Matrix

```
       ┌──────────────┐
       │    DRAFT     │
       └──────┬───────┘
              │
     (Confirm Order & Pass Credit Check)
              │
              ▼
       ┌──────────────┐          (Cancel Order)          ┌──────────────┐
       │  CONFIRMED   │─────────────────────────────────►│  CANCELLED   │
       └──────┬───────┘                                  └──────────────┘
              │
     (Phase 3.4 SalesInvoiceService Completion Execution)
              │
              ▼
       ┌──────────────┐
       │  COMPLETED   │
       └──────────────┘
```

| Source State | Target State | Trigger / Action | Preconditions | Permission Required | Ownership Phase |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DRAFT` | `CONFIRMED` | `confirmOrder()` | Credit-limit check passes or credit override provided | `sales:order:confirm` | Phase 3.2 (`SalesOrderService`) |
| `DRAFT` | `CANCELLED` | `cancelOrder()` | Optional cancellation reason provided | `sales:order:cancel` | Phase 3.2 (`SalesOrderService`) |
| `CONFIRMED` | `CANCELLED` | `cancelOrder()` | `delivered_quantity == 0` (no dispatches executed in Phase 3.3) | `sales:order:cancel` | Phase 3.2 (`SalesOrderService`) |
| `CONFIRMED` | `COMPLETED` | `postInvoice()` | Both dual predicates pass for all order lines: `delivered_quantity == ordered_quantity` AND `invoiced_quantity == ordered_quantity` | `sales:invoice:post` | **Phase 3.4 (`SalesInvoiceService`)** |

## 6. CUSTOMER CREDIT-LIMIT ARCHITECTURE & CALCULATIONS

Phase 3.2 explicitly owns customer credit-limit validation during Sales Order confirmation (`DRAFT → CONFIRMED`).

### Authoritative Credit Exposure Formula

$$\text{Total Credit Exposure} = \text{AR Outstanding} - \text{Unapplied Cash Receipts} + \text{Open Confirmed Orders Base Value} + \text{Current Order Base Value}$$

Where:
1. **`AR Outstanding`**: Sum of `amount_due_base` across all posted, open receivables in Phase 2.6 `ar_open_items` (`WHERE tenant_id = :tenantId AND company_id = :companyId AND customer_id = :customerId AND status IN ('OPEN', 'PARTIALLY_PAID')`).
2. **`Unapplied Cash Receipts`**: Sum of unallocated customer receipt balances in Phase 2.6 `customer_receipts` (`WHERE tenant_id = :tenantId AND company_id = :companyId AND customer_id = :customerId`).
3. **`Open Confirmed Orders Base Value`**: Sum of `total_amount_base` for all existing Sales Orders for the customer in state `CONFIRMED` (`WHERE tenant_id = :tenantId AND company_id = :companyId AND customer_id = :customerId AND status = 'CONFIRMED'`).
4. **`Current Order Base Value`**: `totalAmountBase` of the Sales Order currently undergoing confirmation.

### Explicit Tenant & Company Data Isolation Rule
> [!IMPORTANT]
> **No exposure calculation may aggregate records outside the active tenant and company context.**
> Multi-tenant (`tenant_id = :tenantId`) and multi-company (`company_id = :companyId`) isolation filters MUST be enforced on every supporting subquery in the credit exposure pipeline. Cross-tenant or cross-company records MUST NOT alter a customer's credit exposure.

### Credit Check Decision Rule

$$\text{Credit Approved} = \begin{cases} \text{TRUE} & \text{if } \text{Total Credit Exposure} \le \text{Customer.creditLimit} \\ \text{TRUE} & \text{if } \text{Customer.creditLimit} == 0.00 \text{ (Credit Limit Disabled)} \\ \text{FALSE} & \text{otherwise (Requires Credit Override)} \end{cases}$$

### Authorization Override Mechanism
If credit check fails (`Credit Approved == FALSE`), order confirmation is blocked with error `CREDIT_LIMIT_EXCEEDED` unless the request user possesses privilege `sales:order:override_credit` AND supplies a mandatory `creditOverrideReason`.

---

## 7. CREDIT-CHECK CONCURRENCY & RACE-CONDITION PROTECTION

### Race Condition Problem
If two sales representatives confirm concurrent Sales Orders for the same customer simultaneously:
- Order A (₹50,000) checks credit (Available: ₹60,000) → Pass.
- Order B (₹40,000) checks credit simultaneously (Available: ₹60,000) → Pass.
- Both orders confirm, causing actual exposure (₹90,000) to exceed the credit limit (₹60,000).

### Pessimistic Row Locking Strategy

To guarantee strict concurrency safety:

```sql
BEGIN TRANSACTION;

-- 1. Lock Customer Row Pessimistically (Tenant & Company Scoped)
SELECT id, credit_limit, credit_days, is_active 
FROM customers 
WHERE id = :customerId AND tenant_id = :tenantId AND company_id = :companyId 
FOR UPDATE;

-- 2. Calculate Real-Time Exposure synchronously under row lock (explicit tenant & company isolation)
SELECT COALESCE(SUM(amount_due_base), 0) FROM ar_open_items 
WHERE tenant_id = :tenantId AND company_id = :companyId AND customer_id = :customerId AND status IN ('OPEN', 'PARTIALLY_PAID');

SELECT COALESCE(SUM(unapplied_amount_base), 0) FROM customer_receipts 
WHERE tenant_id = :tenantId AND company_id = :companyId AND customer_id = :customerId;

SELECT COALESCE(SUM(total_amount_base), 0) FROM sales_orders 
WHERE tenant_id = :tenantId AND company_id = :companyId AND customer_id = :customerId AND status = 'CONFIRMED';

-- 3. Evaluate Exposure vs Credit Limit
IF totalExposure > customer.credit_limit AND NOT hasCreditOverridePermission THEN
  ROLLBACK;
  RAISE CREDIT_LIMIT_EXCEEDED;
END IF;

-- 4. Update Order Status to CONFIRMED
UPDATE sales_orders SET status = 'CONFIRMED', updated_at = NOW() WHERE id = :orderId AND tenant_id = :tenantId AND company_id = :companyId;

COMMIT TRANSACTION;
```

This guarantees 100% linear, race-condition-free credit evaluations under high concurrency with bulletproof multi-tenant and multi-company isolation.

---

## 8. DATABASE DATA MODEL SCHEMA

Create Drizzle schema file: `packages/database/src/schema/sales-order.ts` (or append to sales domain schema) and migration `012_phase3_sales_orders.sql`.

### 1. `sales_orders` Table Specification (Drizzle Schema)

```ts
export const salesOrders = pgTable('sales_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  orderNumber: varchar('order_number', { length: 64 }).notNull(),
  quotationId: uuid('quotation_id').notNull().references(() => salesQuotations.id),
  quotationNumber: varchar('quotation_number', { length: 64 }).notNull(),
  revisionNumber: integer('revision_number').notNull(),
  // Unique immutable application contract identifier (NOT a database FK - no contract DB table)
  conversionContractId: uuid('conversion_contract_id').notNull(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  orderDate: varchar('order_date', { length: 10 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('INR'),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).notNull().default('1.000000'),
  salesRepresentativeId: uuid('sales_representative_id').references(() => users.id),
  billingAddressId: uuid('billing_address_id').notNull().references(() => commercialAddresses.id),
  shippingAddressId: uuid('shipping_address_id').notNull().references(() => commercialAddresses.id),
  billingAddressSnapshot: jsonb('billing_address_snapshot').notNull(),
  shippingAddressSnapshot: jsonb('shipping_address_snapshot').notNull(),
  contactId: uuid('contact_id').references(() => commercialContacts.id),
  contactSnapshot: jsonb('contact_snapshot'),
  status: varchar('status', { length: 32 }).notNull().default('DRAFT'),
  notes: text('notes'),
  termsAndConditions: text('terms_and_conditions'),
  subtotalAmount: numeric('subtotal_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  headerDiscountAmount: numeric('header_discount_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  discountAmount: numeric('discount_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  taxableAmount: numeric('taxable_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  taxAmount: numeric('tax_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  totalAmount: numeric('total_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  totalAmountBase: numeric('total_amount_base', { precision: 15, scale: 2 }).notNull().default('0.00'),
  creditOverrideBy: uuid('credit_override_by').references(() => users.id),
  creditOverrideReason: text('credit_override_reason'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  createdBy: uuid('created_by').notNull(),
  updatedBy: uuid('updated_by').notNull(),
}, (table) => ({
  tenantCompanyOrderNumIdx: uniqueIndex('uq_sales_order_tenant_company_num').on(table.tenantId, table.companyId, table.orderNumber),
  contractIdIdx: uniqueIndex('uq_sales_order_contract_id').on(table.tenantId, table.companyId, table.conversionContractId),
  customerIdx: index('idx_sales_order_customer').on(table.tenantId, table.companyId, table.customerId),
  statusIdx: index('idx_sales_order_status').on(table.tenantId, table.companyId, table.status),
  dateIdx: index('idx_sales_order_date').on(table.tenantId, table.companyId, table.orderDate),
  statusCheck: check('chk_sales_order_status', sql`${table.status} IN ('DRAFT', 'CONFIRMED', 'CANCELLED', 'COMPLETED')`),
}));
```

### 2. `sales_order_lines` Table Specification (Drizzle Schema)

```ts
export const salesOrderLines = pgTable('sales_order_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => salesOrders.id, { onDelete: 'cascade' }),
  // Explicit DB FK to sales_quotation_lines.id to preserve historical traceability and prevent line deletion
  quotationLineId: uuid('quotation_line_id').notNull().references(() => salesQuotationLines.id, { onDelete: 'restrict' }),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull(),
  lineNumber: integer('line_number').notNull(),
  productId: uuid('product_id').notNull().references(() => products.id),
  productCodeSnapshot: varchar('product_code_snapshot', { length: 64 }).notNull(),
  productNameSnapshot: varchar('product_name_snapshot', { length: 255 }).notNull(),
  description: text('description'),
  uom: varchar('uom', { length: 32 }).notNull().references(() => uomDefinitions.code),
  orderedQuantity: numeric('ordered_quantity', { precision: 18, scale: 4 }).notNull(),
  deliveredQuantity: numeric('delivered_quantity', { precision: 18, scale: 4 }).notNull().default('0.0000'),
  invoicedQuantity: numeric('invoiced_quantity', { precision: 18, scale: 4 }).notNull().default('0.0000'),
  cancelledQuantity: numeric('cancelled_quantity', { precision: 18, scale: 4 }).notNull().default('0.0000'),
  unitPrice: numeric('unit_price', { precision: 18, scale: 4 }).notNull(),
  discountPercent: numeric('discount_percent', { precision: 5, scale: 2 }).notNull().default('0.00'),
  discountAmount: numeric('discount_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  allocatedHeaderDiscountAmount: numeric('allocated_header_discount_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  grossAmount: numeric('gross_amount', { precision: 15, scale: 2 }).notNull(),
  taxableAmount: numeric('taxable_amount', { precision: 15, scale: 2 }).notNull(),
  hsnSac: varchar('hsn_sac', { length: 16 }).notNull(),
  cgstRate: numeric('cgst_rate', { precision: 5, scale: 2 }).notNull().default('0.00'),
  cgstAmount: numeric('cgst_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  sgstRate: numeric('sgst_rate', { precision: 5, scale: 2 }).notNull().default('0.00'),
  sgstAmount: numeric('sgst_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  igstRate: numeric('igst_rate', { precision: 5, scale: 2 }).notNull().default('0.00'),
  igstAmount: numeric('igst_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  taxAmount: numeric('tax_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  lineTotal: numeric('line_total', { precision: 15, scale: 2 }).notNull(),
  pricingSource: varchar('pricing_source', { length: 64 }).notNull(),
  pricingRuleId: uuid('pricing_rule_id').references(() => pricingRules.id),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  orderLineNumIdx: uniqueIndex('uq_sales_order_line_num').on(table.orderId, table.lineNumber),
}));
```

### 3. SQL Migration DDL Specification (`012_phase3_sales_orders.sql`)

```sql
-- Migration: 012_phase3_sales_orders.sql

CREATE TABLE sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id),
  order_number VARCHAR(64) NOT NULL,
  quotation_id UUID NOT NULL REFERENCES sales_quotations(id),
  quotation_number VARCHAR(64) NOT NULL,
  revision_number INTEGER NOT NULL,
  conversion_contract_id UUID NOT NULL, -- Application contract UUID (NOT a DB FK - no contract DB table exists)
  customer_id UUID NOT NULL REFERENCES customers(id),
  order_date VARCHAR(10) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  exchange_rate NUMERIC(18,6) NOT NULL DEFAULT 1.000000,
  sales_representative_id UUID REFERENCES users(id),
  billing_address_id UUID NOT NULL REFERENCES commercial_addresses(id),
  shipping_address_id UUID NOT NULL REFERENCES commercial_addresses(id),
  billing_address_snapshot JSONB NOT NULL,
  shipping_address_snapshot JSONB NOT NULL,
  contact_id UUID REFERENCES commercial_contacts(id),
  contact_snapshot JSONB,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  notes TEXT,
  terms_and_conditions TEXT,
  subtotal_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  header_discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  taxable_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  total_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  total_amount_base NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  credit_override_by UUID REFERENCES users(id),
  credit_override_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  CONSTRAINT chk_sales_order_status CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELLED', 'COMPLETED'))
);

CREATE UNIQUE INDEX uq_sales_order_tenant_company_num ON sales_orders(tenant_id, company_id, order_number);
-- Idempotency constraint: 1 application conversion contract -> at most 1 Sales Order
CREATE UNIQUE INDEX uq_sales_order_contract_id ON sales_orders(tenant_id, company_id, conversion_contract_id);
CREATE INDEX idx_sales_order_customer ON sales_orders(tenant_id, company_id, customer_id);
CREATE INDEX idx_sales_order_status ON sales_orders(tenant_id, company_id, status);
CREATE INDEX idx_sales_order_date ON sales_orders(tenant_id, company_id, order_date);

CREATE TABLE sales_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  -- Relational traceability: explicit DB FK to sales_quotation_lines(id) with ON DELETE RESTRICT
  quotation_line_id UUID NOT NULL REFERENCES sales_quotation_lines(id) ON DELETE RESTRICT,
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL,
  line_number INTEGER NOT NULL,
  product_id UUID NOT NULL REFERENCES products(id),
  product_code_snapshot VARCHAR(64) NOT NULL,
  product_name_snapshot VARCHAR(255) NOT NULL,
  description TEXT,
  uom VARCHAR(32) NOT NULL REFERENCES uom_definitions(code),
  ordered_quantity NUMERIC(18,4) NOT NULL,
  delivered_quantity NUMERIC(18,4) NOT NULL DEFAULT 0.0000,
  invoiced_quantity NUMERIC(18,4) NOT NULL DEFAULT 0.0000,
  cancelled_quantity NUMERIC(18,4) NOT NULL DEFAULT 0.0000,
  unit_price NUMERIC(18,4) NOT NULL,
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  allocated_header_discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  gross_amount NUMERIC(15,2) NOT NULL,
  taxable_amount NUMERIC(15,2) NOT NULL,
  hsn_sac VARCHAR(16) NOT NULL,
  cgst_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  cgst_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  sgst_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  sgst_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  igst_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  igst_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  line_total NUMERIC(15,2) NOT NULL,
  pricing_source VARCHAR(64) NOT NULL,
  pricing_rule_id UUID REFERENCES pricing_rules(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_sales_order_line_num ON sales_order_lines(order_id, line_number);
CREATE INDEX idx_sales_order_line_quotation_line ON sales_order_lines(quotation_line_id);
```

---

## 9. REST API SPECIFICATIONS

Register routes in `apps/api/src/routes/sales-order.routes.ts`:

1. `POST /api/v1/sales/orders/from-contract`
   - Description: Converts an accepted `QuotationConversionContract` into a new Sales Order in `DRAFT` status.
   - Header: `Idempotency-Key` (mandatory).
   - Permission: `sales:order:create`.

2. `GET /api/v1/sales/orders`
   - Description: Search and list Sales Orders with tenant/company scope filtering.
   - Query: `companyId`, `status`, `customerId`, `search`, `page`, `limit`.
   - Permission: `sales:order:read`.

3. `GET /api/v1/sales/orders/:id`
   - Description: Retrieve Sales Order details including line items, snapshot context, and credit status.
   - Permission: `sales:order:read`.

4. `POST /api/v1/sales/orders/:id/confirm`
   - Description: Evaluates customer credit exposure and transitions order from `DRAFT` to `CONFIRMED`.
   - Body: `{ creditOverrideReason?: string }`.
   - Permission: `sales:order:confirm` (and `sales:order:override_credit` if exposure exceeds limit).

5. `POST /api/v1/sales/orders/:id/cancel`
   - Description: Cancels a `DRAFT` or `CONFIRMED` Sales Order and releases open order credit exposure.
   - Body: `{ cancellationReason: string }`.
   - Permission: `sales:order:cancel`.

---

## 10. REACT SALES ORDER WORKBENCH UI ARCHITECTURE

Components located in `apps/web/src/components/sales/`:

```
SalesOrderHub.tsx (Container Page)
├── OrderListTable.tsx (Data Table with Status Pills & Filters)
├── OrderDetailsView.tsx (Master-Detail Inspector)
│   ├── OrderLineTable.tsx (Line Items & Tax Breakdown)
│   ├── CreditExposureCard.tsx (Real-time Exposure vs Limit Visualizer)
│   ├── OrderFulfillmentProgress.tsx (Fulfillment Progress Tracker)
│   └── OrderActionToolbar.tsx (Contextual Action Buttons)
```

---

## 11. RISK REGISTER

| Risk | Severity | Likelihood | Mitigation Strategy | Detection Mechanism |
| :--- | :--- | :--- | :--- | :--- |
| **Credit-Check Race Condition** | High | Medium | Pessimistic DB locking (`SELECT FOR UPDATE`) on Customer row during order confirmation. | Automated concurrency test suite with parallel confirmation requests. |
| **Duplicate Sales Order Creation** | High | Low | `UNIQUE` index on `conversion_contract_id` + API `Idempotency-Key` header. | `ConflictError` handled cleanly at API route layer. |
| **Commercial Value Drift / Repricing** | High | Low | Zero recalculation policy. Copy contract values verbatim into immutable order snapshots. | Contract vs Order snapshot field inequality assertion tests. |
| **Partial Conversion Failure** | Critical | Low | Enclose quotation update and order insertion inside single atomic DB transaction. | DB transaction rollback verification tests. |
| **Cross-Company Access** | Critical | Low | Enforce strict `tenantId` and `companyId` filtering at DB query and controller layers. | Multi-tenant context isolation test suite. |

---

## 12. ARCHITECTURAL DECISION RECORDS (ADRs 320 to 329)

- **ADR-320**: Sales Order Consumes Immutable Quotation Conversion Contract Verbatim. All commercial values including line `gross_amount` (`line.grossAmount`) are copied verbatim without recalculation.
- **ADR-321**: Phase 3.2 Owns `ACCEPTED → CONVERTED` Quotation Status Transition Execution.
- **ADR-322**: Customer Credit Exposure Formula Incorporates AR Subledger Open Items + Confirmed Open Orders. Explicitly scoped by `tenant_id`, `company_id`, and `customer_id` across all subqueries.
- **ADR-323**: Pessimistic Row Locking Strategy (`SELECT FOR UPDATE`) Enforced for Credit-Check Concurrency Protection.
- **ADR-324**: Single-Table Sales Order Schema with Immutable Frozen Snapshots.
- **ADR-325**: Dual-Layer Idempotency Guard via Contract Constraint (`conversion_contract_id` UNIQUE) and HTTP Header Store. Clarifies `conversion_contract_id` as a unique application contract UUID (NOT a database FK - no contract DB table).
- **ADR-326**: Sequential Document Numbering via Platform `NumberingEngine` (`SO-YYYY-XXXX`).
- **ADR-327**: Immutability of Commercial Prices, GST Rates, and Address Snapshots After Conversion.
- **ADR-328**: Relational Traceability & Line-Level Integrity (`quotation_line_id` DB FK to `sales_quotation_lines.id` with `ON DELETE RESTRICT`).
- **ADR-329**: Single Authoritative Completion Ownership Model. Phase 3.2 defines `COMPLETED` schema vocabulary only; Phase 3.4 (`SalesInvoiceService`) owns `CONFIRMED → COMPLETED` transition execution upon dual predicate pass (`delivered_quantity == ordered_quantity` AND `invoiced_quantity == ordered_quantity`).

---

## 13. COMPREHENSIVE ARCHITECTURE-LEVEL TEST SPECIFICATIONS

1. **Contract Consumption & Idempotency Tests**:
   - One conversion contract creates at most one Sales Order.
   - Duplicate `conversion_contract_id` is rejected by DB uniqueness constraint (`UNIQUE(tenant_id, company_id, conversion_contract_id)`).
   - Contract identifier (`conversion_contract_id`) is validated as an application contract UUID payload and NOT treated as a database FK (verifies no `quotation_conversion_contracts` table exists or is required).
   - Valid Phase 3.1-issued contract with non-null quotation `conversion_contract_id` succeeds.
   - Quotation `conversion_contract_id == NULL` does **NOT** cause valid-contract consumption to be incorrectly rejected (distinguishes contract issuance vs consumption guards).
   - Contract ID mismatch rejected (`ConflictError`).
   - Quotation ID mismatch rejected (`ValidationError`).
   - Revision number mismatch rejected (`ValidationError`).
   - Quotation number mismatch rejected (`ValidationError`).
   - SHA-256 digest hash mismatch rejected (`ValidationError`).
   - Already-consumed contract cannot create another Sales Order (`UNIQUE(conversion_contract_id)` constraint check).
   - Concurrent consumption requests create exactly one Sales Order.
   - Successful conversion changes quotation status `ACCEPTED → CONVERTED` atomically.

2. **Quotation Line Relational Traceability & FK Tests**:
   - Valid `quotation_line_id` matching an existing row in `sales_quotation_lines.id` succeeds.
   - Invalid `quotation_line_id` fails with database FK violation.
   - `ON DELETE RESTRICT` constraint prevents deletion of referenced historical quotation lines.
   - Every Sales Order line traces back to the exact `sales_quotation_lines.id` revision line consumed.

3. **Address & Contact Contract Tests**:
   - Explicit `contract.billingAddressId` matches `sales_orders.billing_address_id` and `contract.billingAddressSnapshot`.
   - Explicit `contract.shippingAddressId` matches `sales_orders.shipping_address_id` and `contract.shippingAddressSnapshot`.
   - Explicit `contract.contactId` matches `sales_orders.contact_id` and `contract.contactSnapshot`.
   - Master address mutation after contract issuance does NOT alter the Sales Order snapshot.

4. **Historical Commercial Integrity & Verbatim Copy Tests**:
   - `sales_order_lines.gross_amount` equals `contract.lines[i].grossAmount` exactly (asserts zero recalculation or derivation).
   - The Sales Order's copied commercial values (unit price, discount, taxable amount, GST rates, line totals) remain independent/frozen.
   - Subsequent quotation master changes or customer profile edits do NOT mutate the Sales Order.
   - Quotation revision history remains intact and protected from deletion by `ON DELETE RESTRICT`.

5. **Lifecycle Boundary & Completion Ownership Tests**:
   - Phase 3.2 does NOT execute `CONFIRMED → COMPLETED`.
   - Phase 3.4 `SalesInvoiceService` owns `CONFIRMED → COMPLETED` transition execution upon dual predicate pass (`delivered_quantity == ordered_quantity` AND `invoiced_quantity == ordered_quantity`).
   - Phase 3.2 creates ZERO delivery records (`sales_deliveries` does not exist).
   - Phase 3.2 creates ZERO invoices (`sales_invoices` does not exist).
   - Phase 3.2 creates ZERO AR open items (`ar_open_items` untouched).
   - Phase 3.2 creates ZERO GL journal entries (`gl_journals` untouched).

6. **Credit Exposure, Multi-Tenant Isolation & Concurrency Tests**:
   - Verify credit exposure formula across `ar_open_items`, `customer_receipts`, and `sales_orders`.
   - Regression test proving cross-tenant (`tenant_id`) and cross-company (`company_id`) open items, receipts, and confirmed orders are strictly excluded from customer credit exposure evaluation.
   - Verify pessimistic row locking (`SELECT FOR UPDATE`) prevents over-allocation when two concurrent requests confirm orders for the same customer.

7. **Full Phase 2 & 3 Regression Verification**:
   - Execute full test suite ensuring zero regressions across Accounting Core, AR, AP, Tax Engine, and Quotation services.

---

## 14. FINAL SIGN-OFF CHECKLIST

Status: **AWAITING HUMAN APPROVAL**

- [x] Scope complete & boundaries explicitly specified
- [x] Conversion contract consumption mapped field-by-field
- [x] `sales_order_lines.gross_amount` copied verbatim from contract (zero calculation)
- [x] Credit exposure subqueries explicitly scoped by `tenant_id`, `company_id`, and `customer_id`
- [x] Single authoritative completion ownership model defined (Phase 3.4 `SalesInvoiceService` owns `CONFIRMED → COMPLETED` upon dual predicate satisfaction)
- [x] `conversion_contract_id` defined as unique immutable application contract UUID (NOT a DB FK, no contract DB table)
- [x] `quotation_line_id` defined as explicit DB FK to `sales_quotation_lines.id` with `ON DELETE RESTRICT`
- [x] Explicit address IDs (`billingAddressId`, `shippingAddressId`, `contactId`) mapped to order FKs
- [x] Sales Order schema & SQL migration specifications complete (`012_phase3_sales_orders.sql`)
- [x] Customer credit-limit evaluation formula specified
- [x] Credit-check concurrency locking strategy (`SELECT ... FOR UPDATE`) detailed
- [x] Dual-layer idempotency strategy defined (distinct issuance vs consumption guards)
- [x] Tenant and company scope isolation enforced
- [x] REST API specifications complete
- [x] React Workbench UI architecture detailed
- [x] Audit trail and notification event integration specified
- [x] Risk register and mitigations complete
- [x] Architectural Decision Records (ADRs 320–329) defined
- [x] Architecture-level test specifications added (including gross_amount verbatim, multi-tenant credit isolation, and completion ownership tests)
- [x] Phase 3.3 boundary preserved (zero deliveries created, no `COMPLETED` execution)
- [x] Phase 3.4 boundary preserved (zero invoices, AR items, or GL entries created in Phase 3.2)
- [x] Zero implementation artifacts created during planning pass
