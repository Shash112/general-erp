# PHASE 3 — ARCHITECTURE REVIEW & CORRECTION NOTES

## Executive Overview
This document records the architectural review and corrections applied to `PHASE_3_ARCHITECTURE_AND_IMPLEMENTATION_PLAN.md` prior to formal implementation sign-off. Each correction addresses potential ambiguities, misalignments with the verified Phase 2 Finance Foundation, or scope overreaches.

---

## Summary of Architectural Corrections

| # | Issue Identified | Why It Mattered | Architectural Correction Applied | Status |
| :--- | :--- | :--- | :--- | :--- |
| **1** | Inventory Boundary referred to "Phase 4 / Inventory". | Authoritative ERP roadmap does not assign Inventory to Phase 4. | Updated plan to explicitly state: *"Inventory is intentionally deferred to a separately designated future Inventory domain/phase."* Listed exact in-scope fulfillment quantities vs deferred stock ledger/valuation. | **CORRECTED** |
| **2** | Pricing Engine assumed a "Contract Price" cascade without a Contract domain. | Introduced an implicit, unapproved Contract module dependency. | Selected Option A: Removed Contract Price from cascade. Pricing cascade is now: `Entity-specific override → Price List → Volume Tier → Product Default`. Clarified Pricing as a commercial-domain service. | **CORRECTED** |
| **3** | Customer & Supplier schemas contained mandatory `receivableAccountId` and `payableAccountId` columns. | Inconsistent with Phase 2 COA Account Role control account resolution architecture. | Removed mandatory per-party GL account columns. Accounting posting resolves control accounts dynamically via COA Account Roles (`AR_CONTROL`, `AP_CONTROL`, `SALES_REVENUE`, `PURCHASE_EXPENSE`, Tax Accounts). | **CORRECTED** |
| **4** | Tax snapshot timing referred to ambiguous "submission/posting". | Risk of tax recalculation modifying posted historical financial records. | Explicitly separated Draft phase (dynamic recalculation) from Posting phase (exact frozen immutable snapshot). Current tax master changes cannot modify posted document snapshots. | **CORRECTED** |
| **5** | 3-Way Match 2% variance tolerance described as hard-coded ERP rule. | Violated "Configuration over customization" principle. | Explicitly clarified that 2% tolerance is a configurable example in the Configuration/Rules Engine (`Default configuration ≠ hard-coded business rule`). Configurable by company, vendor, item, doc type. | **CORRECTED** |
| **6** | Financial document lifecycles contained ambiguous `VOIDED` / `CANCELLED` states for posted documents. | Inconsistent with Phase 2 immutability principles where posted entries are immutable. | Defined strict lifecycle rules: Draft documents may be CANCELLED before posting. Posted documents are IMMUTABLE; corrections occur strictly via reversal, Credit Notes, or Debit Notes. | **CORRECTED** |
| **7** | Generic Credit/Debit note descriptions ("reduces AR/AP") lacked exact subledger binding. | Risk of creating parallel subledgers or misaligning with Phase 2 open-item architecture. | Aligned with Phase 2 AR/AP schemas: Sales Invoices post `INVOICE` open items; Sales Credit Notes apply as allocation sources or credit documents via `arAllocationService`. Supplier Bills post `INVOICE` open items; Supplier Debit Notes apply via `apAllocationService`. | **CORRECTED** |
| **8** | Simplified AR/AP reconciliation formulas (`Invoices - Notes = Open Receivables`) in Phase 3.11. | Failed to account for payments, allocations, write-offs, discounts, and unapplied receipts. | Replaced with generalized subledger reconciliation formulas incorporating full Phase 2 AR/AP settlement semantics (receipts, payments, allocations, discounts, write-offs, adjustments). | **CORRECTED** |
| **9** | Addresses & Contacts used generic polymorphic `entity_type + entity_id` strings. | Weakened relational integrity and composite multi-tenant/company foreign key checks. | Replaced generic strings with explicit nullable FK columns (`customer_id`, `supplier_id`, `branch_id`) enforced by a strict database CHECK constraint for 100% referential integrity and tenant isolation. | **CORRECTED** |
| **10** | Company vs Branch scope was inconsistent across entities. | Unnecessary branch-level constraints on company-wide master data. | Explicitly defined entity ownership: Company-level (Customer, Supplier, Product, Pricing Lists), Branch-level (Fulfillment/Dispatch locations), Department-level (Purchase Requests). | **CORRECTED** |
| **11** | Migration strategy used unverified migration numbers (`0010_`, `0011_`, `0012_`). | Risk of migration filename conflicts with existing Drizzle migration history. | Inspected `packages/database/migrations/` (migrations 001-009). Assigned exact non-conflicting sequence: `010_phase3_0_commercial_foundation.sql`, `011_phase3_sales_domain.sql`, `012_phase3_procurement_domain.sql`. | **CORRECTED** |
| **12** | Plan referred to a non-existent platform "Master Data Engine". | Claimed platform infrastructure that does not exist in code. | Corrected terminology: Schema owned by `packages/database/src/schema/commercial-master.ts`, services owned by `apps/api/src/modules/commercial/`. Removed "Master Data Engine" platform label. | **CORRECTED** |
| **13** | Scope ambiguity regarding Bulk Import/Export in Phase 3.0. | Risk of scope creep by attempting a full platform Import/Export engine. | Resolved via **ADR-307**: Import-only in Phase 3.0 for Products, Customers, and Suppliers with max batch limit of 500 records, atomic transaction rollback, idempotency header validation, and structured row-level errors. Export deferred to Phase 5. | **CORRECTED** |
| **14** | Plan implied PDF generation rendering belonged in Phase 3.0. | Risk of pulling document rendering into master data foundation. | Clarified that Phase 3.0 defines attachment storage metadata integration only. PDF document rendering occurs in specific operational document subphases (Sales Invoice in 3.4, PO in 3.7). | **CORRECTED** |
| **15** | Notification delivery was coupled to financial transaction success. | Risk of notification failure rolling back atomic GL/AR/AP posting transactions. | Explicitly decoupled notifications as secondary asynchronous side effects. Financial posting commits synchronously; notification failure does not affect accounting success. | **CORRECTED** |
| **16** | Frontend scope for Phase 3.0 was overly broad. | Risk of attempting full ERP UI during foundation phase. | Strictly limited Phase 3.0 frontend scope to Shared Commercial Foundation UI (Product, Customer, Supplier, Address, Contact, UOM, Pricing management views). | **CORRECTED** |
| **17** | Phase 3.0 boundary contained operational documents. | Boundary leak into Quotations, Orders, Invoices, and POs. | Strictly bounded Phase 3.0 to Master Data, UOM, Pricing, Commercial Master Data Bulk Import, and supporting APIs. Operational and financial documents belong strictly to subphases 3.1 through 3.10. | **CORRECTED** |
| **18** | Phase 3.11 gate design used superficial checks. | Inadequate to prove production readiness of complex commercial workflows. | Redesigned Phase 3.11 to execute deterministic end-to-end scenario fixtures (Sales & Procurement cycles) reconciling GL, AR, AP, Tax, Discounts, Partial Allocation, and Fiscal Period controls. | **CORRECTED** |
| **19** | Architectural decision statuses were unclassified or marked as DECIDED prematurely. | Ambiguity regarding which design choices require human approval. | Classified all ADRs explicitly: ADR-301 through ADR-305, ADR-307, and ADR-308 are **DECIDED**. ADR-306 is **PROPOSED** (future Phase 3.8 scope). Zero Phase 3.0 ADRs remain unapproved. | **CORRECTED** |
| **20** | Unsupported claims were present in architectural descriptions. | Inaccurate technical assumptions. | Replaced assumptions with repository-backed terminology. Marked items requiring verification as `NEEDS VALIDATION DURING IMPLEMENTATION`. | **CORRECTED** |

---

## Final Architectural Decisions (ADR Register)

| ADR ID | Area / Decision Subject | Status | Decision Summary & Contract |
| :--- | :--- | :--- | :--- |
| **ADR-301** | Product Ownership | **DECIDED** | Product Master (`products`) schema owned by `packages/database/src/schema/commercial-master.ts` and service owned by `apps/api/src/modules/commercial/product.service.ts`. |
| **ADR-302** | Subledger Authority | **DECIDED** | AR Subledger (Phase 2.6) and AP Subledger (Phase 2.7) remain sole authoritative subledgers for Customer Receivables and Supplier Payables. |
| **ADR-303** | Financial Posting | **DECIDED** | Operational documents (Quotations, Orders, Deliveries, PRs, GRNs) DO NOT generate GL entries. Only Financial documents (Invoices, Bills, Notes) post to GL. |
| **ADR-304** | Tax Calculations | **DECIDED** | Dynamic tax evaluation uses Centralized Tax Engine (`taxEngineService`). Posting freezes immutable tax snapshots into snapshot tables. |
| **ADR-305** | Document Numbering | **DECIDED** | Numbering Engine (`numberingEngine`) generates all sequential document numbers with tenant/company/branch isolation. |
| **ADR-306** | 3-Way Match Tolerance | **PROPOSED** | Supplier Bills require 3-Way Match verification against PO prices and GRN quantities. Variance tolerance (default 2%) is configurable via Rules Engine. *(Future Phase 3.8 Scope)*. |
| **ADR-307** | Commercial Master Data Bulk Import | **DECIDED** | Bulk Import for Products, Customers, and Suppliers enforces a configurable maximum batch size of 500 records per request. **Atomicity**: Single DB transaction (`BEGIN ... COMMIT`); entire batch rolls back if any row fails validation or unique constraint. **Idempotency**: Idempotency header required (`Idempotency-Key`); duplicate submissions return cached result. Duplicate codes/SKUs are rejected with row-level validation errors (no silent overwrites). **Scope**: Import-only in Phase 3.0; Export deferred to Phase 5. |
| **ADR-308** | Address & Contact Schema | **DECIDED** | Addresses and Contacts use relational tables (`commercial_addresses`, `commercial_contacts`) with explicit nullable FKs (`customerId`, `supplierId`, `branchId`) and CHECK constraints. |

---

## Final Approval Verdict

### **APPROVED FOR PHASE 3.0 IMPLEMENTATION**

- All Phase 3.0 architectural decisions are **DECIDED**.
- Zero Phase 3.0 blockers remain.
- Phase 3.0 is strictly bounded to Master Data, UOM, Pricing, and Commercial Bulk Import.
