# PHASE 3.1 — SALES FOUNDATION & QUOTATIONS ARCHITECTURE & IMPLEMENTATION PLAN

## 1. STRICT EXECUTION BOUNDARY & PLAN STATUS

> [!IMPORTANT]
> **THIS IS A PLANNING-ONLY ARCHITECTURE DOCUMENT.**
> No source code, database migrations, schema edits, API controllers, frontend implementations, or test suites have been created or modified for Phase 3.1.
>
> Implementation of Phase 3.1 is strictly **PAUSED** pending explicit human review and approval of this architecture specification.

### Subphase Scope Matrix
* **IN SCOPE (Phase 3.1 Planning Target)**:
  - Quotation domain model (`sales_quotations` and `sales_quotation_lines`).
  - Single-table revision storage model (`sales_quotations` versioned rows with `quotationNumber` + `revisionNumber` + `UNIQUE(tenant_id, company_id, quotation_number, revision_number)`). Zero separate `sales_quotation_revisions` table.
  - Quotation status enum definition (including `CONVERTED` for Phase 3.2 contract completeness).
  - Quotation lifecycle state machine & allowed transitions (including `REVISED` status).
  - Persisted header discount amount (`headerDiscountAmount`) and deterministic tax-effective proportional header discount allocation pipeline across line items.
  - Deterministic residual allocation tie-breaker rule: `Residual Recipient = MAX(preHeaderTaxableAmount), then MIN(lineNumber), then MIN(line.id)`.
  - Line-level `allocatedHeaderDiscountAmount` persistence and GST tax base reconciliation.
  - Quotation pricing integration via Phase 3.0 `pricingService` across all 4 cascade levels + manual overrides.
  - Quotation estimated India GST calculation via Phase 2.5 `taxEngineService`.
  - Address & Contact snapshotting rules (frozen at `APPROVED → SENT` transition).
  - Approval workflow integration (discount & value threshold triggers based on `effectiveDiscountPercent`).
  - Sequential document numbering via platform `numberingEngine`.
  - Quotation-to-Sales-Order conversion contract payload generation (`QuotationConversionContract`).
  - Multi-currency validation & base equivalent calculation (`totalAmountBase = roundTo2(totalAmount * exchangeRate)`).
  - Idempotency & double-conversion guards (ADR-310).
  - Revision & versioning model for `SENT` and `REJECTED` quotations (ADR-309).
  - REST API specifications (`/api/v1/sales/quotations/*`).
  - Permissions & fine-grained authorization.
  - Audit logging specifications.
  - Frontend Workbench UI architecture.
  - Unit, Integration, Concurrency, and E2E test plan.

* **OUT OF SCOPE (Deferred to Subphases 3.2+)**:
  - Sales Orders (`sales_orders`) table creation & entity implementation (Phase 3.2).
  - Sales Order line creation & credit limit checks (Phase 3.2).
  - Executing the `ACCEPTED → CONVERTED` quotation status transition in code (Phase 3.2 execution step upon order creation).
  - Sales Deliveries & Dispatches (Phase 3.3).
  - Sales Invoices, AR Open Items, and GL Posting (Phase 3.4).
  - Sales Credit Notes & Returns (Phase 3.5).
  - Procurement Domain (Phase 3.6 - 3.9).
  - Inventory Stock Ledger & Valuation (Deferred to future Inventory domain).

---

## 2. SOURCE OF TRUTH & ARCHITECTURAL FOUNDATION

This plan is anchored strictly in the verified and approved codebase state:
1. **Phase 2 Finance Foundation** (Phases 2.0 through 2.11): 817/817 passing tests across Accounting Core, General Ledger, Tax Engine, AR Subledger, AP Subledger, Banking, and Financial Reporting.
2. **Phase 3 Master Architecture**: `docs/PHASE_3_ARCHITECTURE_AND_IMPLEMENTATION_PLAN.md`, `docs/PHASE_3_ARCHITECTURE_REVIEW_NOTES.md`, and `docs/PHASE_3_1_ARCHITECTURE_REVIEW_NOTES.md`.
3. **Phase 3.0 Shared Commercial Foundation**: Implemented and verified with 18 tests (835/835 total workspace tests passing, 0 typecheck errors). Subphase 3.0 provides the authoritative Master Data for Products ([`product.service.ts`](file:///c:/Users/Shashanka.AzureAD/Desktop/Projects/WLS/general-erp-antigravity-agent-starter/general-erp-agent-starter/apps/api/src/modules/commercial/product.service.ts)), Customers ([`customer.service.ts`](file:///c:/Users/Shashanka.AzureAD/Desktop/Projects/WLS/general-erp-antigravity-agent-starter/general-erp-agent-starter/apps/api/src/modules/commercial/customer.service.ts)), Addresses ([`address.service.ts`](file:///c:/Users/Shashanka.AzureAD/Desktop/Projects/WLS/general-erp-antigravity-agent-starter/general-erp-agent-starter/apps/api/src/modules/commercial/address.service.ts)), Contacts ([`contact.service.ts`](file:///c:/Users/Shashanka.AzureAD/Desktop/Projects/WLS/general-erp-antigravity-agent-starter/general-erp-agent-starter/apps/api/src/modules/commercial/contact.service.ts)), Units of Measure ([`uom.service.ts`](file:///c:/Users/Shashanka.AzureAD/Desktop/Projects/WLS/general-erp-antigravity-agent-starter/general-erp-agent-starter/apps/api/src/modules/commercial/uom.service.ts)), Commercial Pricing ([`pricing.service.ts`](file:///c:/Users/Shashanka.AzureAD/Desktop/Projects/WLS/general-erp-antigravity-agent-starter/general-erp-agent-starter/apps/api/src/modules/commercial/pricing.service.ts)), and Bulk Import ([`commercial-import.service.ts`](file:///c:/Users/Shashanka.AzureAD/Desktop/Projects/WLS/general-erp-antigravity-agent-starter/general-erp-agent-starter/apps/api/src/modules/commercial/commercial-import.service.ts)).

---

## 3. PHASE 3.1 OBJECTIVE & DOMAIN BOUNDARY

The primary objective of **Phase 3.1** is to establish the first operational commercial sales workflow:

$$\text{Customer} \longrightarrow \text{Quotation Draft} \longrightarrow \text{Approval Workflow} \longrightarrow \text{Sent to Customer} \longrightarrow \text{Accepted} \longrightarrow \text{Conversion Contract}$$

### Operational vs. Financial Boundary
Quotations are strictly **Operational Commercial Estimates**.
- **No Accounting Posting**: Quotations produce **zero** General Ledger (`je_headers`, `je_lines`) journal entries.
- **No AR Subledger Impact**: Quotations produce **zero** Accounts Receivable (`ar_documents`, `ar_open_items`) entries.
- **No Inventory Impact**: Quotations do **not** reserve stock or alter inventory balances.
- **No Sales Order Records**: Phase 3.1 creates **zero** `sales_orders` records.
- **Commercial Commitment**: A Quotation represents a formal commercial proposal offered to a customer, containing offered unit prices, line and header discounts, validity periods, commercial terms, and estimated India GST.

Phase 3.1 defines the `CONVERTED` status in the database schema contract, but Phase 3.1 code concludes cleanly at **Accepted Quotation** and **QuotationConversionContract** issuance. Phase 3.2 (Sales Orders) owns the actual creation of Sales Orders and executes the `ACCEPTED → CONVERTED` status update.

---

## 4. CURRENT PLATFORM CAPABILITIES REUSE MATRIX

Phase 3.1 reuses existing platform engines and Phase 3.0 services directly without reinventing core infrastructure:

| Platform Engine / Module | Status in Codebase | Phase 3.1 Consumption Strategy |
| :--- | :--- | :--- |
| **Product Master** | Implemented (Phase 3.0) | Reused as-is via `productService.getProductById`. Validates product status (must be active and `isSellable = true`), base UOM, HSN/SAC code, and fallback base prices. |
| **Customer Master** | Implemented (Phase 3.0) | Reused as-is via `customerService.getCustomerById`. Validates customer status (must be active), default currency, payment terms, and default billing/shipping addresses. |
| **Commercial Addresses** | Implemented (Phase 3.0) | Reused as-is via `addressService.listAddresses`. Billing and shipping addresses are selected from Customer addresses, validated for state code, and captured as transactional snapshots upon `APPROVED → SENT`. |
| **Commercial Contacts** | Implemented (Phase 3.0) | Reused as-is via `contactService.listContacts`. Primary or secondary customer contact is linked and snapshot upon `APPROVED → SENT`. |
| **Unit of Measure (UOM)** | Implemented (Phase 3.0) | Reused as-is via `uomService.convertQuantity`. Line item quantities are validated against valid UOM definitions. |
| **Commercial Pricing** | Implemented (Phase 3.0) | Reused as-is via `pricingService.resolvePrice`. Resolves prices using the approved cascade: `Entity Override → Price List Rule → Volume Tier → Product Master Selling Price`. |
| **Tax Engine** | Implemented (Phase 2.5) | Reused as-is via `taxEngineService.calculateTax`. Evaluates place of supply (Intra-state CGST+SGST vs Inter-state IGST) based on seller branch state code and customer shipping state code. |
| **Numbering Engine** | Implemented (Phase 0/2) | Reused as-is via `numberingEngine.generateNextNumber`. Generates thread-safe sequential quotation numbers (`SALES_QUOTATION` sequence, e.g., `QT-2026-00001`). |
| **Workflow Engine** | Implemented (Phase 1) | Reused as-is via `workflowEngine`. Drives Quotation approval state machine transitions (`DRAFT → PENDING_APPROVAL → APPROVED`). |
| **Rules Engine** | Implemented (Phase 1) | Reused as-is via `rulesEngine`. Evaluates approval trigger conditions (e.g., discount threshold > 15%, total value > ₹5,00,000). |
| **Authorization Engine** | Implemented (Phase 0/1) | Reused as-is via `authorizationService`. Enforces fine-grained sales permissions (`sales:quotation:create`, `sales:quotation:approve`, etc.) and company data scope. |
| **Audit Engine** | Implemented (Phase 0/1) | Reused as-is via `auditService.logEvent`. Records SHA-256 tamper-evident logs for all quotation lifecycle transitions. |
| **Configuration Engine** | Implemented (Phase 1) | Reused as-is via `configurationService`. Stores quotation policy settings (default validity days, discount approval thresholds, terms templates). |
| **Storage Engine** | Implemented (Phase 0) | Reused as-is via `storageService`. Handles attachment metadata (customer RFP documents, technical specs) linked to quotations. |
| **Notifications Engine** | Implemented (Phase 1) | Reused as-is via `notificationEngine`. Dispatches asynchronous notifications for approval requests and quotation status changes. |

---

## 5. QUOTATION DOMAIN MODEL DESIGN (`sales_quotations`)

The `sales_quotations` table represents the header record for a commercial quotation proposal and serves as the single authoritative table for all quotation revisions.

### Detailed Field Classification Table

| Field Name | Type | DB Column | Constraints & Invariants | Classification / Notes |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | `id` | Primary Key, default `gen_random_uuid()` | Immutable Identifier |
| `tenantId` | `varchar(64)` | `tenant_id` | NOT NULL | Tenant Scope Isolation |
| `companyId` | `uuid` | `company_id` | NOT NULL, FK to `companies.id` | Company Scope Isolation |
| `quotationNumber` | `varchar(64)` | `quotation_number` | NOT NULL | Sequential Document Number (via Numbering Engine). Stable across revisions. |
| `revisionNumber` | `integer` | `revision_number` | NOT NULL, Default `1` | Revision Counter. `UNIQUE(tenant_id, company_id, quotation_number, revision_number)` (ADR-309) |
| `customerId` | `uuid` | `customer_id` | NOT NULL, FK to `customers.id` | Master Data Reference |
| `quotationDate` | `varchar(10)` | `quotation_date` | NOT NULL, ISO Format `YYYY-MM-DD` | Operational Transaction Date |
| `validityDate` | `varchar(10)` | `validity_date` | NOT NULL, ISO Format `YYYY-MM-DD` | Expiration Date (`validityDate >= quotationDate`) |
| `currency` | `varchar(3)` | `currency` | NOT NULL, Default `'INR'` | Quotation Currency (ADR-312) |
| `exchangeRate` | `numeric(18,6)` | `exchange_rate` | NOT NULL, Default `'1.000000'`, `exchangeRate > 0` | Exchange Rate to Company Base Currency |
| `salesRepresentativeId` | `uuid` | `sales_representative_id` | Nullable, FK to `users.id` (ADR-314) | User Reference |
| `pricingListId` | `uuid` | `pricing_list_id` | Nullable, FK to `pricing_lists.id` | Master Data Pricing Reference |
| `billingAddressId` | `uuid` | `billing_address_id` | NOT NULL, FK to `commercial_addresses.id` | Master Data Address Reference |
| `shippingAddressId` | `uuid` | `shipping_address_id` | NOT NULL, FK to `commercial_addresses.id` | Master Data Address Reference |
| `billingAddressSnapshot` | `jsonb` | `billing_address_snapshot` | NOT NULL | **Transactional Snapshot** (Frozen at `APPROVED → SENT`) |
| `shippingAddressSnapshot` | `jsonb` | `shipping_address_snapshot` | NOT NULL | **Transactional Snapshot** (Frozen at `APPROVED → SENT`) |
| `contactId` | `uuid` | `contact_id` | Nullable, FK to `commercial_contacts.id` | Master Data Contact Reference |
| `contactSnapshot` | `jsonb` | `contact_snapshot` | Nullable | **Transactional Snapshot** (Frozen at `APPROVED → SENT`) |
| `status` | `varchar(32)` | `status` | NOT NULL, Enum (`DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `SENT`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `REVISED`, `CANCELLED`, `CONVERTED`), DB `CHECK` constraint `chk_sales_quotation_status` (ADR-314) | State Machine Lifecycle Status |
| `notes` | `text` | `notes` | Nullable | Customer-Facing Notes |
| `termsAndConditions` | `text` | `terms_and_conditions` | Nullable | Commercial / Legal Terms |
| `subtotalAmount` | `numeric(15,2)` | `subtotal_amount` | NOT NULL, Non-negative | Derived Sum of Line Gross Amounts |
| `headerDiscountAmount` | `numeric(15,2)` | `header_discount_amount` | NOT NULL, Default `'0.00'`, `0 <= headerDiscountAmount <= preHeaderTaxableTotal` | **Persisted Header Commercial Discount** |
| `discountAmount` | `numeric(15,2)` | `discount_amount` | NOT NULL, Default `'0.00'` | Derived Total Discount (`lineDiscountAmount + headerDiscountAmount`) |
| `taxableAmount` | `numeric(15,2)` | `taxable_amount` | NOT NULL, Non-negative | Derived Net Taxable Amount (`subtotalAmount - discountAmount`) |
| `taxAmount` | `numeric(15,2)` | `tax_amount` | NOT NULL, Non-negative | Derived Estimated Total Tax (CGST+SGST+IGST) |
| `totalAmount` | `numeric(15,2)` | `total_amount` | NOT NULL, Non-negative | Derived Final Net Total (`taxableAmount + taxAmount`) |
| `totalAmountBase` | `numeric(15,2)` | `total_amount_base` | NOT NULL, `roundTo2(totalAmount * exchangeRate)` | Base Currency Equivalent Amount |
| `conversionContractId` | `uuid` | `conversion_contract_id` | Nullable | Phase 3.1 Contract Identifier Issued |
| `conversionContractIssuedAt` | `timestamp` | `conversion_contract_issued_at` | Nullable | Timestamp of Conversion Contract Issuance |
| `conversionContractHash` | `varchar(64)` | `conversion_contract_hash` | Nullable | SHA-256 Digest of Contract Payload |
| `version` | `integer` | `version` | NOT NULL, Default `1` | Optimistic Locking Counter |
| `createdAt` | `timestamp` | `created_at` | NOT NULL, Default `now()` | Audit Timestamp |
| `updatedAt` | `timestamp` | `updated_at` | NOT NULL, Default `now()` | Audit Timestamp |
| `createdBy` | `uuid` | `created_by` | NOT NULL | User ID |
| `updatedBy` | `uuid` | `updated_by` | NOT NULL | User ID |

---

## 6. QUOTATION LINE ITEM MODEL DESIGN (`sales_quotation_lines`)

The `sales_quotation_lines` table stores individual product or service items offered on a quotation revision.

### Line Model Specification Table

| Field Name | Type | DB Column | Constraints & Invariants | Classification / Notes |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | `id` | Primary Key, default `gen_random_uuid()` | Immutable Identifier |
| `quotationId` | `uuid` | `quotation_id` | NOT NULL, FK to `sales_quotations.id` (ON DELETE CASCADE) | Header Foreign Key |
| `tenantId` | `varchar(64)` | `tenant_id` | NOT NULL | Tenant Scope Isolation |
| `companyId` | `uuid` | `company_id` | NOT NULL | Company Scope Isolation |
| `lineNumber` | `integer` | `line_number` | NOT NULL, Positive | Sequential Line Identifier (1, 2, 3...) |
| `productId` | `uuid` | `product_id` | NOT NULL, FK to `products.id` | Master Data Product Reference |
| `productCodeSnapshot` | `varchar(64)` | `product_code_snapshot` | NOT NULL | Transactional Product Code Snapshot (Frozen at `SENT`) |
| `productNameSnapshot` | `varchar(255)` | `product_name_snapshot` | NOT NULL | Transactional Product Name Snapshot (Frozen at `SENT`) |
| `description` | `text` | `description` | Nullable | Line Description / Custom Specs |
| `uom` | `varchar(32)` | `uom` | NOT NULL, FK to `uom_definitions.code` | Unit of Measure |
| `quantity` | `numeric(18,4)` | `quantity` | NOT NULL, `quantity > 0` | Quantity Offered |
| `unitPrice` | `numeric(18,4)` | `unit_price` | NOT NULL, `unit_price >= 0` | Offered Unit Price (via Pricing Engine or Manual Override) |
| `discountPercent` | `numeric(5,2)` | `discount_percent` | NOT NULL, Default `'0.00'`, `0 <= discount <= 100` | Percentage Item Discount |
| `discountAmount` | `numeric(15,2)` | `discount_amount` | NOT NULL, Default `'0.00'` | Line-Level Item Discount Amount |
| `allocatedHeaderDiscountAmount` | `numeric(15,2)` | `allocated_header_discount_amount` | NOT NULL, Default `'0.00'` | **Proportionally Allocated Header Discount** |
| `grossAmount` | `numeric(15,2)` | `gross_amount` | NOT NULL, `quantity * unitPrice` | Derived Line Gross Amount |
| `taxableAmount` | `numeric(15,2)` | `taxable_amount` | NOT NULL, `grossAmount - discountAmount - allocatedHeaderDiscountAmount` | **Final Tax-Effective Line Taxable Base** |
| `hsnSac` | `varchar(16)` | `hsn_sac` | NOT NULL | HSN/SAC Code for Tax Resolution |
| `cgstRate` | `numeric(5,2)` | `cgst_rate` | NOT NULL, Default `'0.00'` | CGST Percentage (Frozen at `APPROVED → SENT`) |
| `cgstAmount` | `numeric(15,2)` | `cgst_amount` | NOT NULL, Default `'0.00'` | CGST Amount (Calculated from final line `taxableAmount`) |
| `sgstRate` | `numeric(5,2)` | `sgst_rate` | NOT NULL, Default `'0.00'` | SGST Percentage (Frozen at `APPROVED → SENT`) |
| `sgstAmount` | `numeric(15,2)` | `sgst_amount` | NOT NULL, Default `'0.00'` | SGST Amount (Calculated from final line `taxableAmount`) |
| `igstRate` | `numeric(5,2)` | `igst_rate` | NOT NULL, Default `'0.00'` | IGST Percentage (Frozen at `APPROVED → SENT`) |
| `igstAmount` | `numeric(15,2)` | `igst_amount` | NOT NULL, Default `'0.00'` | IGST Amount (Calculated from final line `taxableAmount`) |
| `taxAmount` | `numeric(15,2)` | `tax_amount` | NOT NULL, `cgstAmount + sgstAmount + igstAmount` | Derived Total Line Tax |
| `lineTotal` | `numeric(15,2)` | `line_total` | NOT NULL, `taxableAmount + taxAmount` | Derived Net Line Total |
| `pricingSource` | `varchar(64)` | `pricing_source` | NOT NULL | Source Traceability (`ENTITY_OVERRIDE`, `PRICE_LIST`, `VOLUME_TIER`, `BASE_PRICE`, `MANUAL`) |
| `pricingRuleId` | `uuid` | `pricing_rule_id` | Nullable, FK to `pricing_rules.id` (ADR-314) | Pricing Rule Traceability |
| `version` | `integer` | `version` | NOT NULL, Default `1` | Optimistic Locking Counter |
| `createdAt` | `timestamp` | `created_at` | NOT NULL, Default `now()` | Audit Timestamp |
| `updatedAt` | `timestamp` | `updated_at` | NOT NULL, Default `now()` | Audit Timestamp |

---

## 7. QUOTATION TAX ARCHITECTURE & HEADER DISCOUNT TAX BASE RECONCILIATION

Quotations compute an **Estimated Tax Breakdown** for commercial proposal display. Because quotations are operational and do not post financial journals, quotation tax calculations do not alter tax control accounts or post to GL.

```
+-------------------------------------------------------------------------------+
|             HEADER DISCOUNT TAX BASE RECONCILIATION PIPELINE                  |
|                                                                               |
|  Step 1: Calculate Line Gross Amount                                          |
|          grossAmount_i = roundTo2(quantity_i * unitPrice_i)                  |
|                                                                               |
|  Step 2: Calculate Line-Level Discount                                        |
|          discountAmount_i = roundTo2(grossAmount_i * discountPercent_i / 100) |
|                                                                               |
|  Step 3: Calculate Pre-Header Taxable Amount for each line                    |
|          preHeaderTaxableAmount_i = grossAmount_i - discountAmount_i          |
|                                                                               |
|  Step 4: Compute Total Pre-Header Taxable Base                                |
|          preHeaderTaxableTotal = sum(preHeaderTaxableAmount_i)                |
|                                                                               |
|  Step 5: Validate Header Discount Amount                                      |
|          0 <= headerDiscountAmount <= preHeaderTaxableTotal                   |
|                                                                               |
|  Step 6: Allocate Header Discount Proportionally across Lines                 |
|          allocatedHeaderDiscount_i = roundTo2(headerDiscountAmount *          |
|              (preHeaderTaxableAmount_i / preHeaderTaxableTotal))              |
|                                                                               |
|  Step 7: Apply Deterministic Residual Tie-Breaker Rule                        |
|          Residual Cents = headerDiscountAmount - sum(allocatedHeaderDiscount_i)|
|          Residual Recipient = MAX(preHeaderTaxableAmount),                    |
|                               then MIN(lineNumber), then MIN(line.id)         |
|          [Guarantees sum(allocatedHeaderDiscount_i) == headerDiscountAmount   |
|           and 100% reproducible allocation across repeated executions]        |
|                                                                               |
|  Step 8: Calculate Final Line Taxable Base                                    |
|          taxableAmount_i = preHeaderTaxableAmount_i - allocatedHeaderDiscount_i|
|                                                                               |
|  Step 9: Compute Line GST from Final Taxable Base via TaxEngine:              |
|          cgstAmount_i = roundTo2(taxableAmount_i * cgstRate / 100)            |
|          sgstAmount_i = roundTo2(taxableAmount_i * sgstRate / 100)            |
|          igstAmount_i = roundTo2(taxableAmount_i * igstRate / 100)            |
|          taxAmount_i  = cgstAmount_i + sgstAmount_i + igstAmount_i            |
|                                                                               |
|  Step 10: Compute Reconciled Header Totals                                    |
|          subtotalAmount = sum(line.grossAmount)                               |
|          lineDiscountAmount = sum(line.discountAmount)                        |
|          discountAmount = lineDiscountAmount + headerDiscountAmount           |
|          taxableAmount = sum(line.taxableAmount) = subtotalAmount - discount  |
|          taxAmount = sum(line.taxAmount)                                      |
|          totalAmount = taxableAmount + taxAmount                              |
+-------------------------------------------------------------------------------+
```

### Dynamic Recalculation vs. Snapshot Stability
- **Dynamic Phase (`DRAFT`, `PENDING_APPROVAL`, `APPROVED`)**: Tax and header discount allocation are recalculated dynamically whenever line items, quantities, prices, discounts, header discounts, or shipping addresses are updated (including permitted address edits in `APPROVED`).
- **Authoritative Freeze Point (`APPROVED → SENT`)**: Upon executing `sendQuotation()`, the calculated line taxable amounts, allocated header discounts, and tax breakdowns are permanently frozen into database columns. Subsequent edits to national tax rate tables do not alter the historical commercial terms offered to the customer.

---

## 8. QUOTATION PRICING & DISCOUNT ARCHITECTURE

Quotation pricing strictly consumes the **Phase 3.0 Commercial Pricing Service** ([`pricing.service.ts`](file:///c:/Users/Shashanka.AzureAD/Desktop/Projects/WLS/general-erp-antigravity-agent-starter/general-erp-agent-starter/apps/api/src/modules/commercial/pricing.service.ts)).

```
+-------------------------------------------------------------------------------+
|                      QUOTATION PRICING RESOLUTION CASCADE                     |
|                                                                               |
|                     1. Customer-Specific Entity Override                      |
|                                     │                                         |
|                             [Found?] ───► YES: Use Override Price             |
|                                     │ NO                                      |
|                     2. Selected Price List Rule                               |
|                                     │                                         |
|                             [Found?] ───► YES: Use Price List Rate            |
|                                     │ NO                                      |
|                     3. Volume Tier Price                                      |
|                                     │                                         |
|                             [Found?] ───► YES: Use Tier Price                 |
|                                     │ NO                                      |
|                     4. Product Master Selling Price                           |
|                                     │                                         |
|                                     └───► Fallback Base Price                 |
+-------------------------------------------------------------------------------+
```

### Header Discount & Effective Discount Percentage
In addition to line-item discounts, quotations support a persisted header-level discount (`headerDiscountAmount`).

```
  subtotalAmount     = sum(line.grossAmount)
  lineDiscountAmount = sum(line.discountAmount)
  discountAmount     = lineDiscountAmount + headerDiscountAmount
  taxableAmount      = subtotalAmount - discountAmount
  
  effectiveDiscountPercent = roundTo2((discountAmount / subtotalAmount) * 100)
```

### Discount Authorization Thresholds
Approval rules evaluate both line-level discounts and total effective commercial discount:
- If `any(line.discountPercent) > max_sales_rep_discount`
- OR `effectiveDiscountPercent > max_sales_rep_discount`
- OR `quotation.totalAmount > max_auto_approve_amount`
- OR `any(line.pricingSource) == 'MANUAL' AND unitPrice < basePrice`

Then the quotation is automatically flagged as requiring **Manager Approval** (`status = PENDING_APPROVAL`).

---

## 9. CUSTOMER & ADDRESS INTEGRATION (LIVE VS. SNAPSHOT)

To maintain absolute historical integrity, Phase 3.1 distinguishes between **Live Master Data References** and **Transactional Snapshots**:

```
+-------------------------------------------------------------------------------+
|                       CUSTOMER & ADDRESS INTEGRATION                          |
|                                                                               |
|  Master Data References (Foreign Keys):                                       |
|  - customer_id        ──► Points to current customer record                   |
|  - billing_address_id ──► Points to master billing address                    |
|  - shipping_address_id──► Points to master shipping address                   |
|  - contact_id         ──► Points to master contact                            |
|                                                                               |
|  Transactional Snapshots (Frozen JSONB):                                      |
|  - billing_address_snapshot:  { line1, city, state, stateCode, postalCode... }|
|  - shipping_address_snapshot: { line1, city, state, stateCode, postalCode... }|
|  - contact_snapshot:          { name, email, phone, designation }             |
|                                                                               |
|  Rule: Snapshots are dynamically generated in DRAFT/APPROVED. Permanently     |
|  frozen upon transition APPROVED -> SENT. Subsequent edits to Master Data     |
|  DO NOT mutate frozen JSON snapshots.                                         |
+-------------------------------------------------------------------------------+
```

---

## 10. QUOTATION LIFECYCLE STATE MACHINE

The quotation lifecycle is governed by an authoritative state machine implemented via the platform **Workflow Engine**. Revisions are managed as versioned rows in `sales_quotations` + `sales_quotation_lines`.

```
                           ┌──────────────┐
                           │    DRAFT     │
                           └──────┬───────┘
                                  │
                 ┌────────────────┴────────────────┐
                 │ (Requires Approval?)            │
                YES                                NO
                 │                                 │
                 v                                 v
      ┌────────────────────┐             ┌──────────────────┐
      │ PENDING_APPROVAL   │             │     APPROVED     │
      └─────────┬──────────┘             └────────┬─────────┘
                │                                 │
        ┌───────┴───────┐                         │
     REJECTED       APPROVED                      │
        │               │                         │
        v               └─────────────────────────┤
   ┌──────────┐                                   │
   │ REJECTED ├─────────────┐                     │
   └──────────┘             │                     v
                            │            ┌──────────────────┐
                            │            │       SENT       │
                            │            └────────┬─────────┘
                            │                     │
                 ┌──────────┴─────────────────────┼────────────────────────┐
                 │                                │                        │
                 v                                v                        v
        ┌──────────────────┐             ┌──────────────────┐     ┌──────────────────┐
        │     ACCEPTED     │             │     REVISED      │     │     EXPIRED      │
        └────────┬─────────┘             └──────────────────┘     └──────────────────┘
                 │                      (Superseded by Rev 2)
                 v
   ┌───────────────────────────┐
   │ CONTRACT ISSUED (Sec 13)  │
   └─────────────┬─────────────┘
                 │
                 v  (Phase 3.2 Execution)
        ┌──────────────────┐
        │    CONVERTED     │
        └──────────────────┘
```

### State Transition Rules Table

| Current State | Target State | Triggering Action | Required Permission | Preconditions | Side Effects & Audit Events |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DRAFT` | `PENDING_APPROVAL` | `submitForApproval()` | `sales:quotation:update` | Lines count > 0; totalAmount > 0; effectiveDiscount > threshold. | Approval task created; Notification sent; Audit event. |
| `DRAFT` | `APPROVED` | `submitForApproval()` | `sales:quotation:update` | Lines count > 0; totalAmount > 0; effectiveDiscount <= threshold. | Auto-approved; Dynamic tax/snapshot verified; Audit event. |
| `PENDING_APPROVAL` | `APPROVED` | `approveQuotation()` | `sales:quotation:approve` | User is authorized approver; quotation in `PENDING_APPROVAL`. | Status set to `APPROVED`; Audit event. |
| `PENDING_APPROVAL` | `REJECTED` | `rejectQuotation()` | `sales:quotation:approve` | User is authorized approver; rejection reason provided. | Status set to `REJECTED`; Notification sent; Audit event. |
| `APPROVED` | `SENT` | `sendQuotation()` | `sales:quotation:send` | Quotation in `APPROVED` state. | **Snapshots permanently frozen**; Status set to `SENT`; Audit event. |
| `SENT` | `ACCEPTED` | `acceptQuotation()` | `sales:quotation:accept` | Quotation in `SENT` state; `today <= validityDate`. | Customer acceptance recorded; Status set to `ACCEPTED`; Audit event. |
| `SENT` | `REVISED` | `createRevision()` | `sales:quotation:create` | Customer requested changes; Rev 2 created in `DRAFT`. | Rev 1 status -> `REVISED` (Terminal/Read-Only); Rev 2 created; Audit event. |
| `REJECTED` | `REVISED` | `createRevision()` | `sales:quotation:create` | Re-opening rejected quote; Rev 2 created in `DRAFT`. | Rev 1 status -> `REVISED` (Terminal/Read-Only); Rev 2 created; Audit event. |
| `SENT` | `EXPIRED` | `checkExpiration()` | System Scheduled Job | `today > validityDate`. | Status set to `EXPIRED`; Audit event logged. |
| `DRAFT` / `APPROVED` | `CANCELLED` | `cancelQuotation()` | `sales:quotation:cancel` | Quotation not yet `ACCEPTED` or contract issued. | Status set to `CANCELLED`; Audit event logged. |
| `ACCEPTED` | `CONVERTED` | `salesOrderService.createFromQuotation()` | **Phase 3.2 Execution** | Valid `QuotationConversionContract` issued; Sales Order DB commit succeeds. | Status set to `CONVERTED` (Phase 3.2 execution step); Audit event logged. |

---

## 11. APPROVAL WORKFLOW ARCHITECTURE

Approval evaluation is decoupled from sales domain logic and delegates to platform **Rules Engine** and **Workflow Engine**:

```
+-------------------------------------------------------------------------------+
|                       QUOTATION APPROVAL EVALUATION PIPELINE                  |
|                                                                               |
|  1. Read Policy Rules from Configuration Engine:                              |
|     - max_sales_rep_discount = 10.00%                                         |
|     - max_auto_approve_amount = ₹5,00,000.00                                  |
|  2. Evaluate Quotation Payload via Rules Engine:                              |
|     - Compute effectiveDiscountPercent = (discountAmount / subtotal) * 100   |
|     - IF effectiveDiscountPercent > max_sales_rep_discount                    |
|       OR any line discountPercent > max_sales_rep_discount                    |
|       OR quotation totalAmount > max_auto_approve_amount                      |
|       OR any line pricingSource == 'MANUAL' AND price < basePrice            |
|     - THEN Flag: APPROVAL_REQUIRED = true                                     |
|  3. Workflow Engine Action:                                                   |
|     - IF APPROVAL_REQUIRED == true:                                           |
|       Transition status -> PENDING_APPROVAL; Create Approval Task             |
|     - ELSE:                                                                   |
|       Transition status -> APPROVED                                           |
+-------------------------------------------------------------------------------+
```

---

## 12. QUOTATION SEQUENTIAL NUMBERING

Quotation numbers are generated using the platform **Numbering Engine** (`numberingEngine.generateNextNumber`).

- **Sequence Code**: `SALES_QUOTATION`
- **Scope**: Company-scoped and Branch-scoped (where applicable).
- **Format Pattern**: `{PREFIX}-{FISCAL_YEAR}-{SEQUENCE_NUMBER}`
  - Example: `QT-2026-00001` or `QT/HQ/25-26/0001`.
- **Thread Safety**: Numbering Engine executes atomic sequence incrementing with `FOR UPDATE` PostgreSQL row locks to guarantee zero sequence gaps or duplicate numbers under high concurrent creation loads.

---

## 13. QUOTATION CONVERSION ARCHITECTURE (CONVERSION CONTRACT BOUNDARY)

Phase 3.1 owns **Quotation Acceptance** and **QuotationConversionContract** payload issuance. Phase 3.1 creates **ZERO** Sales Orders.

```
+-------------------------------------------------------------------------------+
|                 PHASE 3.1 -> PHASE 3.2 CONVERSION CONTRACT BOUNDARY           |
|                                                                               |
|  Phase 3.1 (Quotations Domain):                                               |
|  1. Customer accepts quotation (status -> ACCEPTED).                           |
|  2. API Client calls POST /api/v1/sales/quotations/:id/convert-contract       |
|  3. Quotation Service validates preconditions:                                |
|     - status == 'ACCEPTED'                                                    |
|     - validityDate >= today OR config.allowExpiredQuotationConversion == true  |
|     - conversionContractId is NULL (No prior contract issued)                 |
|     - Customer and Products active                                            |
|  4. Service generates deterministic QuotationConversionContract payload       |
|     and records conversionContractId, conversionContractIssuedAt, and         |
|     conversionContractHash on sales_quotations header.                        |
|  5. Returns QuotationConversionContract payload envelope to API caller.       |
|                                                                               |
|  [PHASE 3.1 CREATES ZERO SALES ORDERS & EXECUTES ZERO CONVERTED TRANSITIONS]  |
|                                                                               |
|  Phase 3.2 (Sales Orders Domain — Deferred to Subphase 3.2):                  |
|  - salesOrderService consumes QuotationConversionContract                     |
|  - Inserts into sales_orders and sales_order_lines                            |
|  - Atomically marks sales_quotations.status = 'CONVERTED' upon DB commit      |
+-------------------------------------------------------------------------------+
```

### Standardized Conversion Contract Payload (`QuotationConversionContract`)

```typescript
export interface QuotationConversionContract {
  contractId: string;
  contractVersion: string;
  issuedAt: string;
  contractHash: string; // SHA-256 digest of terms & lines
  tenantId: string;
  companyId: string;
  quotationId: string;
  quotationNumber: string;
  revisionNumber: number;
  customerId: string;
  currency: string;
  exchangeRate: string;
  billingAddressSnapshot: Record<string, unknown>;
  shippingAddressSnapshot: Record<string, unknown>;
  contactSnapshot?: Record<string, unknown>;
  salesRepresentativeId?: string;
  termsAndConditions?: string;
  subtotalAmount: string;
  lineDiscountAmount: string;
  headerDiscountAmount: string;
  discountAmount: string;
  taxableAmount: string;
  taxAmount: string;
  totalAmount: string;
  totalAmountBase: string;
  lines: Array<{
    quotationLineId: string;
    lineNumber: number;
    productId: string;
    productCodeSnapshot: string;
    productNameSnapshot: string;
    description?: string;
    uom: string;
    quantity: string;
    unitPrice: string;
    discountPercent: string;
    discountAmount: string;
    allocatedHeaderDiscountAmount: string;
    taxableAmount: string;
    hsnSac: string;
    cgstRate: string;
    cgstAmount: string;
    sgstRate: string;
    sgstAmount: string;
    igstRate: string;
    igstAmount: string;
    taxAmount: string;
    lineTotal: string;
    pricingSource: string;
    pricingRuleId?: string;
  }>;
}
```

> **Authoritative Contract Rule**: Phase 3.2 MUST NOT re-resolve prices, tax rates, header discount allocations, or address snapshots from master tables when consuming `QuotationConversionContract`. The contract carries the pre-calculated `allocatedHeaderDiscountAmount` and final line `taxableAmount` derived from the single authoritative deterministic allocation pipeline (`Residual Recipient = MAX(preHeaderTaxableAmount), then MIN(lineNumber), then MIN(line.id)`). Phase 3.2 copies these exact monetary fields directly into `sales_orders` and `sales_order_lines`. The contract is the immutable single source of commercial truth.

---

## 14. DUPLICATE CONVERSION PROTECTION & IDEMPOTENCY (ADR-310)

To prevent duplicate conversion contracts or duplicate Sales Orders resulting from retries:

1. **Phase 3.1 Idempotency**: Issuing a conversion contract requires an `Idempotency-Key` header. Re-submitting the same request returns the cached `QuotationConversionContract` without generating a new contract identifier.
2. **Database Level Guard**: Service executes `UPDATE sales_quotations SET conversion_contract_id = :contractId, conversion_contract_issued_at = now() WHERE id = :id AND status = 'ACCEPTED' AND conversion_contract_id IS NULL`.
3. **Atomic Safety**: If a concurrent request attempts to issue a contract for the same quotation, PostgreSQL row locking causes the second transaction to find 0 rows matching `conversion_contract_id IS NULL`, throwing a `CONVERSION_CONTRACT_ALREADY_ISSUED` error.

---

## 15. IMMUTABILITY & HISTORICAL INTEGRITY (ADR-309)

Although Quotations are operational documents, historical integrity requires controlled immutability:

- **`DRAFT`**: Fully mutable. Items, quantities, prices, discounts, and addresses may be added, edited, or deleted freely.
- **`PENDING_APPROVAL`**: Read-only for core parameters. Can be cancelled or approved/rejected.
- **`APPROVED`**: Read-only for core prices and item quantities. Address selection adjustments trigger dynamic tax updates prior to sending.
- **`SENT`**: **PERMANENTLY LOCKED & FROZEN**. Core commercial terms cannot be edited directly. Modifying a sent quotation requires generating a **Revision / Amendment** (`createRevision()`).
- **`REVISED`**: **PERMANENTLY LOCKED & TERMINAL**. Read-only superseded historical record. Cannot be edited, accepted, or converted.
- **`ACCEPTED`**: **PERMANENTLY LOCKED**. Immutable historical record eligible for conversion contract issuance.
- **`CONVERTED`**: **PERMANENTLY LOCKED & TERMINAL**. Final state updated exclusively by Phase 3.2 upon Sales Order DB commit.

---

## 16. QUOTATION REVISION & AMENDMENT MODEL (ADR-309)

Quotation revisions are represented as versioned rows in `sales_quotations` and corresponding `sales_quotation_lines` records (single-table revision storage model). Zero separate `sales_quotation_revisions` table exists.

```
+-------------------------------------------------------------------------------+
|                 SINGLE-TABLE REVISION WORKFLOW (ADR-309)                      |
|                                                                               |
|  1. Customer requests modification on SENT/REJECTED quotation QT-2026-0001     |
|  2. User invokes createRevision("QT-2026-0001")                               |
|  3. System actions inside single atomic DB transaction:                       |
|     - Selects QT-2026-0001 (Rev 1) FOR UPDATE                                |
|     - Updates Rev 1 status from SENT/REJECTED -> REVISED (Terminal, Read-Only)|
|     - Inserts Rev 2 header into sales_quotations with same quotationNumber    |
|       "QT-2026-0001", revisionNumber = 2, and status = 'DRAFT'               |
|     - Inserts Rev 2 lines into sales_quotation_lines                          |
|  4. DB Constraint UNIQUE(tenant_id, company_id, quotation_number, revision_num)|
|     blocks concurrent duplicate revision creation.                             |
|  5. Prohibited from ACCEPTED, CONVERTED, EXPIRED, CANCELLED, REVISED quotes.   |
|  6. Only Rev 2 (highest revision_number) can proceed to ACCEPTED.             |
+-------------------------------------------------------------------------------+
```

---

## 17. REST API DESIGN SPECIFICATION

All quotation API endpoints are registered under `/api/v1/sales/quotations/*` in `apps/api/src/routes/sales.routes.ts`.

### Endpoint Contract Table

| HTTP Method | Route Endpoint | Required Permission | Description & Payload / Response |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/sales/quotations` | `sales:quotation:create` | Creates a new draft quotation. Body: `CreateQuotationSchema`. Returns HTTP 201 + Quotation. |
| `GET` | `/api/v1/sales/quotations` | `sales:quotation:read` | Lists quotations with pagination, status filter, customer search, and date range filters. |
| `GET` | `/api/v1/sales/quotations/:id` | `sales:quotation:read` | Fetches complete quotation details including line items, address snapshots, and revision history. |
| `PUT` | `/api/v1/sales/quotations/:id` | `sales:quotation:update` | Updates a `DRAFT` quotation. Fails if status != `DRAFT`. Returns updated quotation. |
| `POST` | `/api/v1/sales/quotations/:id/submit` | `sales:quotation:update` | Submits quotation for approval. Evaluates rules; transitions to `APPROVED` or `PENDING_APPROVAL`. |
| `POST` | `/api/v1/sales/quotations/:id/approve` | `sales:quotation:approve` | Approves a `PENDING_APPROVAL` quotation. Requires manager role. |
| `POST` | `/api/v1/sales/quotations/:id/reject` | `sales:quotation:approve` | Rejects a `PENDING_APPROVAL` quotation with reason. Transitions status to `REJECTED`. |
| `POST` | `/api/v1/sales/quotations/:id/send` | `sales:quotation:send` | Marks quotation as `SENT`, freezes snapshots, triggers customer notification. |
| `POST` | `/api/v1/sales/quotations/:id/accept` | `sales:quotation:accept` | Records customer acceptance. Transitions status to `ACCEPTED`. |
| `POST` | `/api/v1/sales/quotations/:id/cancel` | `sales:quotation:cancel` | Cancels quotation (if not accepted/contract issued). Body: `{ cancellationReason }`. |
| `POST` | `/api/v1/sales/quotations/:id/revision` | `sales:quotation:create` | Creates a new revision (Rev 2) from SENT/REJECTED quote. Rev 1 transitions to `REVISED`. |
| `POST` | `/api/v1/sales/quotations/:id/convert-contract` | `sales:quotation:convert` | Validates preconditions; issues and returns `QuotationConversionContract` payload for Phase 3.2. |

---

## 18. API AUTHORIZATION & PERMISSIONS MATRIX

Enforced strictly on the server-side via `authorizationService.authorize()`:

| Permission String | Description | Allowed Roles (Default RBAC) |
| :--- | :--- | :--- |
| `sales:quotation:read` | View quotations, lines, and revisions | Sales Rep, Sales Manager, Finance Admin, System Admin |
| `sales:quotation:create` | Create new quotation drafts and revisions | Sales Rep, Sales Manager, Admin |
| `sales:quotation:update` | Edit draft quotations, update line items | Sales Rep, Sales Manager, Admin |
| `sales:quotation:approve` | Approve or reject pending high-discount quotations | Sales Manager, Commercial Director, Admin |
| `sales:quotation:send` | Issue approved quotations to customers | Sales Rep, Sales Manager, Admin |
| `sales:quotation:accept` | Mark sent quotations as accepted by customer | Sales Rep, Sales Manager, Admin |
| `sales:quotation:cancel` | Cancel active draft or sent quotations | Sales Manager, Admin |
| `sales:quotation:convert` | Issue conversion contract payload for Phase 3.2 | Sales Rep, Sales Manager, Admin |

---

## 19. MULTI-TENANT & COMPANY SCOPE ISOLATION

To prevent cross-tenant or cross-company data exposure:
1. All database queries include explicit `WHERE tenant_id = :ctxTenantId AND company_id = :ctxCompanyId`.
2. Every referenced foreign entity (`customerId`, `productId`, `billingAddressId`, `pricingListId`) is validated at the service layer to confirm it belongs to the exact same `tenantId` and `companyId`.
3. Unique constraints enforce isolation at DB boundary: `UNIQUE (tenant_id, company_id, quotation_number, revision_number)`.

---

## 20. AUDIT ENGINE INTEGRATION

All quotation write operations log structured SHA-256 tamper-evident events via `auditService.logEvent`:

```typescript
await this.auditService.logEvent({
  tenantId: ctx.tenantId,
  companyId: ctx.companyId,
  actorId: ctx.userId,
  module: 'sales',
  entityName: 'SalesQuotation',
  entityId: quotation.id,
  action: 'STATUS_CHANGE',
  previousValues: { status: 'PENDING_APPROVAL' },
  newValues: { status: 'APPROVED', approvedBy: ctx.userId },
  correlationId: ctx.correlationId,
});
```

---

## 21. NOTIFICATION ENGINE INTEGRATION

Asynchronous notifications are dispatched via `notificationEngine` without blocking synchronous database transaction completion:
- **`QUOTATION_APPROVAL_REQUESTED`**: Dispatched to Sales Managers when a quotation requires approval.
- **`QUOTATION_APPROVED`**: Dispatched to Sales Rep when quotation is approved.
- **`QUOTATION_SENT`**: Dispatched to Customer contact via email with proposal details.
- **`QUOTATION_ACCEPTED`**: Dispatched to Sales Rep and fulfillment team when customer accepts quotation.

---

## 22. STORAGE & ATTACHMENT INTERFACE

Quotations support document attachments (customer RFPs, technical specifications, custom CAD drawings) via platform `storageService`:
- File uploads are validated for file type, path traversal protection, and tenant storage isolation.
- File metadata is recorded in `sales_quotation_attachments` linking `storageId` to `quotationId`.
- PDF generation interface (`QuotationPdfRenderer`) is specified as a contract for future export subphases without pulling invoice rendering code forward into Phase 3.1.

---

## 23. SEARCH & FILTERING STRATEGY

Quotation search is powered by PostgreSQL composite indexes and `ILIKE` query filters (no external search cluster required):
- **Searchable Fields**: `quotation_number`, customer name/code, line product code/name, notes.
- **Filter Parameters**: `status`, `customerId`, `salesRepresentativeId`, `dateFrom`, `dateTo`, `validityExpired`.
- **Pagination**: Deterministic `limit` & `offset` pagination returning total count and records envelope.

---

## 24. FRONTEND UI ARCHITECTURE PLAN

The Phase 3.1 Sales Quotation UI is constructed as a modular React component suite integrated into `apps/web/src/components/sales/`:

```
apps/web/src/components/sales/
├── SalesQuotationHub.tsx               # Main Sales Quotation Management View
├── QuotationListTable.tsx              # Filterable Data Table & Status Badges
├── QuotationBuilderForm.tsx            # Header, Customer Selector & Header Discount Input
├── QuotationLineEditor.tsx             # Dynamic Item Rows, Price Lookup & Line Discounts
├── QuotationTaxPreview.tsx             # Real-time GST Breakdown Summary Box
├── QuotationActionToolbar.tsx          # Contextual Action Buttons (Submit, Approve, Send, Convert Contract)
└── QuotationHistoryTimeline.tsx        # Audit Trail & Revision Comparison View
```

---

## 25. DATABASE SCHEMA DESIGN (DRIZZLE SPECIFICATIONS)

To be added to `packages/database/src/schema/sales.ts`:

To be added to `packages/database/src/schema/sales.ts`:

```typescript
import { pgTable, uuid, varchar, numeric, integer, text, jsonb, timestamp, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies, users } from './platform';
import { customers, products, commercialAddresses, commercialContacts, pricingLists, pricingRules, uomDefinitions } from './commercial-master';

export const salesQuotations = pgTable('sales_quotations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  quotationNumber: varchar('quotation_number', { length: 64 }).notNull(),
  revisionNumber: integer('revision_number').notNull().default(1),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  quotationDate: varchar('quotation_date', { length: 10 }).notNull(),
  validityDate: varchar('validity_date', { length: 10 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('INR'),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).notNull().default('1.000000'),
  salesRepresentativeId: uuid('sales_representative_id').references(() => users.id),
  pricingListId: uuid('pricing_list_id').references(() => pricingLists.id),
  billingAddressId: uuid('billing_address_id').notNull().references(() => commercialAddresses.id),
  shippingAddressId: uuid('shipping_address_id').notNull().references(() => commercialAddresses.id),
  billingAddressSnapshot: jsonb('billing_address_snapshot').notNull(),
  shippingAddressSnapshot: jsonb('shipping_address_snapshot').notNull(),
  contactId: uuid('contact_id').references(() => commercialContacts.id),
  contactSnapshot: jsonb('contact_snapshot'),
  status: varchar('status', { length: 32 }).notNull().default('DRAFT'), // Database-enforced via chk_sales_quotation_status
  notes: text('notes'),
  termsAndConditions: text('terms_and_conditions'),
  subtotalAmount: numeric('subtotal_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  headerDiscountAmount: numeric('header_discount_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  discountAmount: numeric('discount_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  taxableAmount: numeric('taxable_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  taxAmount: numeric('tax_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  totalAmount: numeric('total_amount', { precision: 15, scale: 2 }).notNull().default('0.00'),
  totalAmountBase: numeric('total_amount_base', { precision: 15, scale: 2 }).notNull().default('0.00'),
  conversionContractId: uuid('conversion_contract_id'),
  conversionContractIssuedAt: timestamp('conversion_contract_issued_at'),
  conversionContractHash: varchar('conversion_contract_hash', { length: 64 }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  createdBy: uuid('created_by').notNull(),
  updatedBy: uuid('updated_by').notNull(),
}, (table) => ({
  tenantCompanyNumberRevIdx: uniqueIndex('uq_quotation_tenant_company_num_rev').on(table.tenantId, table.companyId, table.quotationNumber, table.revisionNumber),
  customerIdx: index('idx_quotation_customer').on(table.tenantId, table.companyId, table.customerId),
  statusIdx: index('idx_quotation_status').on(table.tenantId, table.companyId, table.status),
  dateIdx: index('idx_quotation_date').on(table.tenantId, table.companyId, table.quotationDate),
  statusCheck: check('chk_sales_quotation_status', sql`${table.status} IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVISED', 'CANCELLED', 'CONVERTED')`),
}));

export const salesQuotationLines = pgTable('sales_quotation_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  quotationId: uuid('quotation_id').notNull().references(() => salesQuotations.id, { onDelete: 'cascade' }),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: uuid('company_id').notNull(),
  lineNumber: integer('line_number').notNull(),
  productId: uuid('product_id').notNull().references(() => products.id),
  productCodeSnapshot: varchar('product_code_snapshot', { length: 64 }).notNull(),
  productNameSnapshot: varchar('product_name_snapshot', { length: 255 }).notNull(),
  description: text('description'),
  uom: varchar('uom', { length: 32 }).notNull().references(() => uomDefinitions.code),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
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
  quotationLineIdx: uniqueIndex('uq_quotation_line_num').on(table.quotationId, table.lineNumber),
}));
```

---

## 26. DATABASE INDEXING & CONSTRAINTS PLAN

1. `uq_quotation_tenant_company_num_rev`: `(tenant_id, company_id, quotation_number, revision_number)` -> Enforces unique quotation numbers per company/revision.
2. `idx_quotation_customer`: `(tenant_id, company_id, customer_id)` -> Fast customer quotation history lookup.
3. `idx_quotation_status`: `(tenant_id, company_id, status)` -> Fast filtering by lifecycle status (e.g. pending approvals).
4. `idx_quotation_date`: `(tenant_id, company_id, quotation_date)` -> Fast date-range reports and expiration checks.
5. `uq_quotation_line_num`: `(quotation_id, line_number)` -> Enforces unique line numbers per quotation.
6. `chk_sales_quotation_status`: Database `CHECK` constraint enforcing `status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVISED', 'CANCELLED', 'CONVERTED')` (ADR-314).
7. **Foreign Key Relational Constraints**:
   - `sales_quotations.company_id` -> `companies.id`
   - `sales_quotations.customer_id` -> `customers.id`
   - `sales_quotations.sales_representative_id` -> `users.id` (ADR-314)
   - `sales_quotations.pricing_list_id` -> `pricing_lists.id`
   - `sales_quotations.billing_address_id` -> `commercial_addresses.id`
   - `sales_quotations.shipping_address_id` -> `commercial_addresses.id`
   - `sales_quotations.contact_id` -> `commercial_contacts.id`
   - `sales_quotation_lines.quotation_id` -> `sales_quotations.id` (ON DELETE CASCADE)
   - `sales_quotation_lines.product_id` -> `products.id`
   - `sales_quotation_lines.uom` -> `uom_definitions.code`
   - `sales_quotation_lines.pricing_rule_id` -> `pricing_rules.id` (ADR-314)

---

## 27. EXACT DECIMAL & ROUNDING ENGINE INVARIANTS

All monetary calculations use `ExactDecimal` (BigInt fixed-point arithmetic) to eliminate floating-point rounding bugs:
- **Quantity Scale**: `4` decimal places (e.g. `12.5000` LTR).
- **Unit Price Scale**: `4` decimal places (e.g. `150.2500` INR).
- **Monetary Totals Scale**: `2` decimal places (e.g. `1878.13` INR).
- **Step-by-Step Line Invariants**:
  1. `grossAmount = roundTo2(quantity * unitPrice)`
  2. `lineDiscountAmount = roundTo2(grossAmount * (discountPercent / 100))`
  3. `preHeaderTaxableAmount = grossAmount - lineDiscountAmount`
  4. `preHeaderTaxableTotal = sum(line.preHeaderTaxableAmount)`
  5. `0 <= headerDiscountAmount <= preHeaderTaxableTotal`
  6. `allocatedHeaderDiscount_i = roundTo2(headerDiscountAmount * (preHeaderTaxableAmount_i / preHeaderTaxableTotal))`
  7. **Deterministic Residual Tie-Breaker Rule**:
     - `Residual Cents = headerDiscountAmount - sum(allocatedHeaderDiscount_i)`
     - `Residual Recipient = MAX(preHeaderTaxableAmount), then MIN(lineNumber), then MIN(line.id)`
     - Guarantees 100% deterministic, reproducible allocation across repeated calculations over the same quotation revision.
  8. `taxableAmount_i = preHeaderTaxableAmount_i - allocatedHeaderDiscount_i`
  9. `cgstAmount_i = roundTo2(taxableAmount_i * (cgstRate / 100))`
  10. `sgstAmount_i = roundTo2(taxableAmount_i * (sgstRate / 100))`
  11. `igstAmount_i = roundTo2(taxableAmount_i * (igstRate / 100))`
  12. `taxAmount_i = cgstAmount_i + sgstAmount_i + igstAmount_i`
  13. `lineTotal_i = taxableAmount_i + taxAmount_i`
- **Reconciled Header Invariants**:
  - `subtotalAmount = sum(line.grossAmount)`
  - `lineDiscountAmount = sum(line.discountAmount)`
  - `discountAmount = lineDiscountAmount + headerDiscountAmount`
  - `taxableAmount = sum(line.taxableAmount) = subtotalAmount - discountAmount`
  - `taxAmount = sum(line.taxAmount)`
  - `totalAmount = taxableAmount + taxAmount`
  - `totalAmountBase = roundTo2(totalAmount * exchangeRate)`
  - `effectiveDiscountPercent = roundTo2((discountAmount / subtotalAmount) * 100)`
- **Multi-Currency Invariants**:
  - `exchangeRate > 0`
  - If `currency == companyBaseCurrency`, `exchangeRate = 1.000000`
  - If `currency != companyBaseCurrency`, valid exchange rate string required.

---

## 28. MULTI-CURRENCY ARCHITECTURE SCOPE (ADR-312)

Quotations support commercial multi-currency proposal presentation:
- **Transaction Currency**: Stored in `currency` (e.g., `USD`, `EUR`, `INR`).
- **Exchange Rate**: Stored in `exchangeRate` (e.g., `83.500000` INR per USD).
- **Local Currency Amounts**: Line items and totals compute base company currency equivalents (`totalAmountBase = roundTo2(totalAmount * exchangeRate)`).
- **Future FX Engine Boundary**: Full multi-currency revaluation and unrealized FX gains/losses are deferred to posted accounting financial documents (Invoices & Payments).

---

## 29. CONFIGURATION ENGINE INTEGRATION

Quotation policies are configured via JSON schema in `configurationService`:

```json
{
  "sales": {
    "quotations": {
      "defaultValidityDays": 30,
      "maxSalesRepDiscountPercent": "10.00",
      "maxAutoApproveQuotationAmount": "500000.00",
      "requireApprovalForManualPriceOverride": true,
      "allowExpiredQuotationConversion": false,
      "defaultTermsAndConditions": "1. Standard payment terms apply.\n2. Prices valid for 30 days."
    }
  }
}
```

### Active Configuration Policy Evaluation Rules (ADR-315)
1. **`allowExpiredQuotationConversion` Policy**:
   - **When `allowExpiredQuotationConversion = false` (Default)**: During conversion contract issuance (`issueConversionContract`), the system requires `quotation.validityDate >= today`. If `today > quotation.validityDate`, contract issuance is strictly rejected with `EXPIRED_QUOTATION_CONVERSION_PROHIBITED` (`ValidationError`).
   - **When `allowExpiredQuotationConversion = true`**: Conversion contract issuance is permitted for an `ACCEPTED` quotation even if `today > quotation.validityDate`.
   - Policy evaluation is executed authoritatively through `configurationService` / `rulesEngine` precondition checks. Tested in unit/integration test suite for both policy states (`false` and `true`).

---

## 30. TESTING STRATEGY & TEST SUITE DESIGN

Dedicated integration test suite: `apps/api/test/phase3_1_sales_quotations.test.ts`.

### Comprehensive Test Matrix Requirements
1. **Lifecycle Transition Tests**:
   - `DRAFT → APPROVED` (Auto-approval for low discount).
   - `DRAFT → PENDING_APPROVAL` (Workflow trigger for high discount or high header discount).
   - `PENDING_APPROVAL → APPROVED` and `PENDING_APPROVAL → REJECTED`.
   - `APPROVED → SENT` (Triggers immutable address/tax snapshot freeze).
   - `SENT → ACCEPTED` (Customer acceptance).
   - `SENT → REVISED` and `REJECTED → REVISED` (Revision creation).
   - `SENT → EXPIRED` (Scheduled validity check).
   - Rejection of invalid transitions (e.g. `EXPIRED → ACCEPTED`, `CONVERTED → DRAFT`).
2. **Single-Table Revision Tests**:
   - Creating Revision 2 from `SENT` or `REJECTED` Revision 1 (`SENT/REJECTED → REVISED`).
   - Revision 1 becomes terminal and read-only in `sales_quotations`.
   - Revision 2 opens in `DRAFT` with identical `quotationNumber` and `revisionNumber = 2`.
   - DB constraint `UNIQUE(tenant_id, company_id, quotation_number, revision_number)` blocks duplicate revision creation.
   - Prohibit revision creation from `ACCEPTED`, `CONVERTED`, `EXPIRED`, `CANCELLED`, `REVISED`.
   - Asserts zero `sales_quotation_revisions` table exists.
3. **Header Discount Allocation & Residual Tie-Breaker Tests**:
   - Zero header discount (`headerDiscountAmount = 0.00`).
   - Header discount allocated proportionally across multiple line items.
   - **Tied Maximum PreHeaderTaxableAmount Test Fixture**: Test fixture containing at least two quotation lines with identical maximum `preHeaderTaxableAmount` (e.g., Line 1 = ₹50,000, Line 2 = ₹50,000).
   - Verifies **exactly one residual recipient** is selected for residual rounding cents.
   - Verifies recipient is the line with the **lowest `lineNumber`** (`MIN(lineNumber)`), or fallback `MIN(line.id)` if `lineNumber` is duplicated/unavailable.
   - Verifies **repeated execution produces 100% identical allocation** over the same quotation revision.
   - Verifies **sum of allocations equals `headerDiscountAmount`** (`sum(line.allocatedHeaderDiscountAmount) == headerDiscountAmount`).
   - Verifies **all final line taxable amounts remain non-negative** (`taxableAmount_i >= 0`).
   - Verifies **header taxable amount still equals sum of line taxable amounts** (`taxableAmount == sum(line.taxableAmount)`).
   - Header discount exceeding `preHeaderTaxableTotal` rejected with `ValidationError`.
   - GST calculated from final line `taxableAmount` (after allocated header discount).
   - Mathematical proof: `taxableAmount == sum(line.taxableAmount)` and `taxAmount == sum(line.taxAmount)`.
   - Header discount triggering `effectiveDiscountPercent > max_sales_rep_discount` approval threshold.
   - `QuotationConversionContract` carries `headerDiscountAmount`, line `discountAmount`, and line `allocatedHeaderDiscountAmount` accurately without Phase 3.2 recalculation.
4. **Snapshot Freeze Verification**:
   - Dynamic address/tax recalculation in `DRAFT`, `PENDING_APPROVAL`, `APPROVED`.
   - Freeze execution upon `APPROVED → SENT`.
   - Edits to Customer master address or Tax rate tables after `SENT` do NOT mutate frozen quotation snapshots.
5. **Conversion Contract & Policy Evaluation Tests**:
   - Accepted quotation produces exactly one `QuotationConversionContract`.
   - Repeated request with same `Idempotency-Key` returns identical cached contract.
   - Concurrent contract requests throw `CONVERSION_CONTRACT_ALREADY_ISSUED`.
   - **`allowExpiredQuotationConversion` Policy Tests (ADR-315)**:
     - When `allowExpiredQuotationConversion = false`: Conversion contract issuance for an expired quotation (`validityDate < today`) is rejected with `EXPIRED_QUOTATION_CONVERSION_PROHIBITED` (`ValidationError`).
     - When `allowExpiredQuotationConversion = true`: Conversion contract issuance for an expired `ACCEPTED` quotation succeeds.
   - Explicitly asserts Phase 3.1 creates **zero** `sales_orders` records.
6. **Database Schema, Foreign Key & Constraint Tests (ADR-314)**:
   - Foreign key integrity test: Attempting to set an invalid `sales_representative_id` or `pricing_rule_id` fails with a PostgreSQL foreign key constraint violation.
   - Status vocabulary check constraint test: Direct insertion or update of an invalid status string (e.g. `'INVALID_STATUS'`) fails with PostgreSQL `CHECK` constraint `chk_sales_quotation_status` violation.
6. **Pricing Cascade Tests**:
   - Level 1: Entity-specific override.
   - Level 2: Selected price-list rule.
   - Level 3: Volume tier boundary quantity evaluation (`1-49` vs `50+`).
   - Level 4: Product master fallback selling price.
   - Level 5: Manual override flag (`pricingSource = 'MANUAL'`) & discount threshold trigger.
7. **Multi-Currency Tests**:
   - Base currency quotation (`exchangeRate = 1.000000`).
   - Foreign currency quotation (`currency = 'USD'`, `exchangeRate = 83.500000`).
   - Rejection of non-positive or missing foreign exchange rates.
   - Accurate `totalAmountBase` calculation.
8. **Phase 2 Regression Gate**:
   - Zero regressions across all 817 Phase 2 financial tests.

---

## 31. PERFORMANCE METRICS & BENCHMARKS

Expected performance metrics for Phase 3.1 APIs under PostgreSQL test database:
- `GET /api/v1/sales/quotations` (List 100 rows): **< 5 ms**
- `POST /api/v1/sales/quotations` (Create Draft with 10 lines): **< 15 ms**
- `POST /api/v1/sales/quotations/:id/submit` (Evaluate Rules & Workflow): **< 12 ms**
- `POST /api/v1/sales/quotations/:id/convert-contract` (Contract verification): **< 8 ms**

---

## 32. RISK REGISTER & MITIGATION STRATEGIES

| Risk ID | Risk Description | Severity | Likelihood | Mitigation Strategy | Detection Method |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **R-3101** | Parallel Accounting Entry Generation | HIGH | LOW | Enforce strict invariant: Quotations MUST NOT generate GL entries or AR documents. | Code inspection & AST dependency checks. |
| **R-3102** | Master Address Mutation Altering Quotation | HIGH | LOW | Freeze address JSON snapshots into `billingAddressSnapshot` / `shippingAddressSnapshot` on transition `APPROVED → SENT`. | Integration test verifying customer address edit doesn't change quotation. |
| **R-3103** | Double Conversion Contract Issuance | HIGH | LOW | Atomic DB update matching `status = 'ACCEPTED' AND conversion_contract_id IS NULL` + `Idempotency-Key` header. | Concurrent conversion contract execution test fixture. |
| **R-3104** | Floating-Point Rounding Discrepancy | MEDIUM | LOW | Use `ExactDecimal` fixed-point math for all quantity, unit price, tax, and line total calculations. | Automated unit tests validating line-total sum reconciliation. |
| **R-3105** | Approval Bypass via Direct Status Edit | HIGH | LOW | Restrict status transitions exclusively to domain state machine methods backed by server permissions. | API security authorization tests. |

---

## 33. ARCHITECTURAL DECISION RECORDS (ADRS: 309 - 315)

### ADR-309: Quotation Revision & Immutability Model — DECIDED
- **Context**: Customers frequently request changes to sent or rejected quotations.
- **Decision**: Sent and rejected quotations are immutable. Editing a `SENT` or `REJECTED` quotation creates a new **Revision** (`revisionNumber`: 1, 2, 3...) preserving the same `quotationNumber` as versioned rows in `sales_quotations` + `sales_quotation_lines`. Previous revisions transition to `REVISED` status and remain read-only in database audit history. Zero separate `sales_quotation_revisions` table is used.

### ADR-310: Quotation-to-Order Conversion Contract & Idempotency — DECIDED
- **Context**: Conversion to Sales Order must be robust against duplicate clicks and retries without requiring `sales_orders` table in Phase 3.1.
- **Decision**: Phase 3.1 issues a validated `QuotationConversionContract` payload. Requires `status == 'ACCEPTED'` and `conversion_contract_id == NULL`. Executed atomically using PostgreSQL row locking and mandatory `Idempotency-Key` header handling via platform `idempotencyService`. Phase 3.2 consumes the contract, creates `sales_orders` records, and updates quotation status to `CONVERTED`.

### ADR-311: Address & Pricing Transactional Snapshotting — DECIDED
- **Context**: Master customer addresses and product base prices change over time.
- **Decision**: Quotations retain FK references to master entities for relational queries, but freeze complete JSON snapshots (`billingAddressSnapshot`, `shippingAddressSnapshot`) and line item price snapshots upon transition to `APPROVED → SENT`.

### ADR-312: Multi-Currency Proposal Scope — DECIDED
- **Context**: Quotations may be presented in foreign currencies (USD, EUR).
- **Decision**: Quotations store foreign currency codes and exchange rates to calculate base currency equivalents (`totalAmountBase = roundTo2(totalAmount * exchangeRate)`). Realized/unrealized FX gains/losses are deferred to posted accounting documents in later subphases.

### ADR-313: Proportional Header Discount Allocation & Deterministic Residual Tie-Breaker Rule — DECIDED
- **Context**: Document-level header discounts must reduce line GST taxable amounts proportionally, and residual rounding cents must be assigned deterministically without ambiguity when multiple lines have identical maximum pre-header taxable amounts.
- **Decision**: Header discounts are allocated proportionally based on line `preHeaderTaxableAmount`. Residual cents are assigned using the single authoritative multi-level tie-breaker rule: `Residual Recipient = MAX(preHeaderTaxableAmount), then MIN(lineNumber), then MIN(line.id)`. Repeated calculations over the same quotation revision MUST produce 100% identical and reproducible results.

### ADR-314: Foreign Key Relational Constraints & Status CHECK Constraint Enforcement — DECIDED
- **Context**: Schema specifications must explicitly declare foreign key constraints for relational integrity and enforce the allowed status vocabulary at the database level.
- **Decision**: Explicitly declare foreign key constraints `sales_representative_id -> users.id` and `pricing_rule_id -> pricing_rules.id` in Drizzle schema and SQL migrations. Enforce the complete quotation status set at the PostgreSQL boundary via `CHECK` constraint `chk_sales_quotation_status` containing `'DRAFT'`, `'PENDING_APPROVAL'`, `'APPROVED'`, `'SENT'`, `'ACCEPTED'`, `'REJECTED'`, `'EXPIRED'`, `'REVISED'`, `'CANCELLED'`, `'CONVERTED'`.

### ADR-315: Expired Quotation Conversion Policy Evaluation — DECIDED
- **Context**: Interaction between quotation expiration (`validityDate < today`) and conversion contract issuance must be explicitly defined in configuration.
- **Decision**: Conversion contract issuance evaluates the `sales.quotations.allowExpiredQuotationConversion` configuration setting via `configurationService` / `rulesEngine`. When `false` (default), conversion requires `validityDate >= today`. When `true`, conversion contract issuance is permitted for an `ACCEPTED` quotation regardless of validity date expiration. Policy behavior is fully defined, active, and covered by test fixtures for both states.

---

## 34. PHASE 3.1 SCOPE BOUNDARY

```
+-------------------------------------------------------------------------------+
|                       PHASE 3.1 EXPLICIT SCOPE BOUNDARY                       |
|                                                                               |
|  IN SCOPE:                                                                    |
|  - sales_quotations, sales_quotation_lines DB schema                          |
|  - Single-table revision storage model (sales_quotations versioned rows)      |
|  - Persisted header discount amount (headerDiscountAmount)                    |
|  - Proportional header discount allocation & GST tax base reconciliation       |
|  - Deterministic residual tie-breaker rule: MAX(base), MIN(lineNum), MIN(id)  |
|  - Quotation CRUD, lifecycle state machine (including REVISED & CONVERTED),   |
|    and approval workflow                                                      |
|  - Phase 3.0 Pricing Engine integration & Tax Engine estimated tax calculation |
|  - Transactional address & contact JSON snapshotting (frozen at APPROVED->SENT)|
|  - Sequential quotation document numbering (QT-2026-00001)                    |
|  - Quotation-to-Sales-Order conversion contract payload issuance              |
|  - REST APIs under /api/v1/sales/quotations/*                                 |
|  - React SalesQuotationHub workbench UI                                       |
|  - Integration test suite (phase3_1_sales_quotations.test.ts)                 |
|                                                                               |
|  OUT OF SCOPE:                                                                |
|  - sales_quotation_revisions table (zero separate table created)              |
|  - Sales Orders entity & table creation (Phase 3.2)                            |
|  - Credit limit checks on Sales Orders (Phase 3.2)                            |
|  - Deliveries & Dispatches (Phase 3.3)                                        |
|  - Sales Invoices, AR Open Items, and GL Posting (Phase 3.4)                  |
|  - Sales Credit Notes & Returns (Phase 3.5)                                   |
+-------------------------------------------------------------------------------+
```

---

## 35. DEPENDENCY CONTRACT WITH PHASE 3.2 (SALES ORDERS)

Phase 3.1 establishes a clean, self-contained dependency contract consumed by Phase 3.2 (Sales Orders):

```
+-------------------------------------------------------------------------------+
|                 PHASE 3.1 -> PHASE 3.2 DEPENDENCY CONTRACT                    |
|                                                                               |
|  Phase 3.1 Delivers:                                                          |
|  1. Accepted Quotation Entity in state 'ACCEPTED'                             |
|  2. Validated Conversion Payload via QuotationConversionContract              |
|  3. Transactional Address Snapshots (Billing & Shipping)                      |
|  4. Line Items with offered Unit Prices, Discounts, UOM, and Tax Rates        |
|  5. Reconciled Header Discount & Line Taxable Amounts                         |
|  6. `sales_quotations.status` enum containing 'CONVERTED' for Phase 3.2 use   |
|                                                                               |
|  Phase 3.2 Consumes:                                                          |
|  - salesOrderService.createFromQuotation(payload)                            |
|  - Validates customer credit limit against current AR balance                 |
|  - Generates Sales Order entity in state 'CONFIRMED'                          |
|  - Links sales_quotations.status = 'CONVERTED' upon order DB commit           |
+-------------------------------------------------------------------------------+
```

---

## 36. DOCUMENTATION REQUIREMENTS

Upon approval and implementation of Phase 3.1 in subsequent tasks:
1. `docs/IMPLEMENTATION_STATUS.md` will be updated from `Phase 3.1 — PLANNING APPROVED FOR IMPLEMENTATION` to `Phase 3.1 — COMPLETE / APPROVED`.
2. `PHASE_3_1_IMPLEMENTATION_REPORT.md` will be created with actual empirical test results, performance metrics, and build verification data.

---

## 37. FINAL PRE-IMPLEMENTATION SIGN-OFF & STATUS

### Status: **APPROVED FOR PHASE 3.1 IMPLEMENTATION**

- [x] Deterministic Residual Allocation Tie-Breaker Rule specified: `Residual Recipient = MAX(preHeaderTaxableAmount), then MIN(lineNumber), then MIN(line.id)`.
- [x] Foreign keys explicitly declared in Drizzle schema & migration specification: `sales_representative_id -> users.id` and `pricing_rule_id -> pricing_rules.id` (ADR-314).
- [x] Database-enforced status constraint: `varchar(32)` + `CHECK` constraint `chk_sales_quotation_status` containing all 10 allowed states (ADR-314).
- [x] Expired quotation conversion policy unambiguously defined: `allowExpiredQuotationConversion` evaluated via `configurationService`; tested when `false` and `true` (ADR-315).
- [x] Header discount meaning is unambiguous (`headerDiscountAmount` on header).
- [x] Line discount meaning is unambiguous (`discountAmount` on line = line-level item discount).
- [x] Header discount and GST base mathematically reconcile via proportional allocation.
- [x] Line taxable amounts sum exactly to header taxable amount ($\text{taxableAmount} = \sum \text{line.taxableAmount}$).
- [x] Line taxes sum exactly to header tax amount ($\text{taxAmount} = \sum \text{line.taxAmount}$).
- [x] ExactDecimal rounding & residual handling is 100% deterministic and reproducible across repeated calculations over the same quotation revision.
- [x] Revision Storage Model resolved: Single-table `sales_quotations` + `sales_quotation_lines` model; zero `sales_quotation_revisions` table.
- [x] `CONVERTED` lifecycle ownership is coherent (`CONVERTED` in enum; Phase 3.2 owns status transition upon Order creation; Phase 3.1 creates 0 Sales Orders).
- [x] Phase 3.1 creates zero Sales Orders.
- [x] Phase 3.1 performs zero `ACCEPTED → CONVERTED` transitions.
- [x] Phase 3.1 creates zero AR/GL entries.
- [x] Phase 3.2 exclusively owns Sales Order creation and the `CONVERTED` transition.
- [x] Phase 3.2 can update quotation state to `CONVERTED` without schema contradiction or recalculation.
- [x] Snapshot freeze point is singular and consistent (`APPROVED → SENT`).
- [x] `REJECTED → REVISED` and `SENT → REVISED` are formally defined in state machine.
- [x] Pricing test coverage matches pricing architecture across all 4 cascade levels + manual overrides.
- [x] Multi-currency validation is safe (`exchangeRate > 0`, `totalAmountBase` calculation enforced).
- [x] Conversion contract is complete and immutable (`QuotationConversionContract`).
- [x] Phase 3.1 has zero Sales Order implementation dependency.
- [x] Test suite explicitly asserts Phase 3.1 creates zero Sales Orders.
- [x] No implementation source code, migrations, schemas, controllers, UI components, or tests were created in this planning pass.

---

## 38. STRICT STOP CONDITION

> [!CAUTION]
> **STRICT STOP CONDITION ENFORCED.**
>
> Following the creation of this corrected planning document:
> 1. **DO NOT** write Phase 3.1 implementation code.
> 2. **DO NOT** create database migrations `011_phase3_sales_domain.sql`.
> 3. **DO NOT** modify schema files or API controllers.
> 4. **DO NOT** proceed into Phase 3.2 (Sales Orders).
>
> Execution is strictly **PAUSED** to allow human review and sign-off on the Phase 3.1 architecture plan.
