# General ERP — Master Remaining Architecture & Implementation Plan

## 1. Purpose

This document becomes the authoritative architecture and implementation roadmap for all work remaining after the current verified repository baseline.

The previous workflow required a fresh architecture plan and approval before every phase. That workflow is intentionally replaced by a **single master architecture + implementation-slice** model.

### New operating model

```text
MASTER ARCHITECTURE
        ↓
IMPLEMENTATION SLICE
        ↓
VERIFY
        ↓
STATUS / REPORT
        ↓
NEXT IMPLEMENTATION SLICE
```

Architecture is planned once. Future implementation slices use this document directly. A new architecture-review cycle is required only when implementation discovers a material contradiction, security/data-isolation issue, financial/legal correctness issue, migration conflict, or unavoidable scope change.

---

## 2. Current Verified Baseline

### Completed

- Phase 0 — Engineering Foundation
- Phase 0.5B — Production Hardening
- Phase 2.0–2.11 — Finance Foundation and Final Verification
- Phase 3.0 — Shared Commercial Foundation
- Phase 3.1 — Sales Quotations
- Phase 3.2 — Sales Orders

### Current Sales baseline

Phase 3.0 provides Product, Customer, Supplier, Address, Contact, UOM, Pricing, bulk import, REST API and UI foundations.

Phase 3.1 provides quotation lifecycle, revisions, tax/pricing calculation, snapshots, approvals and the immutable `QuotationConversionContract`.

Phase 3.2 provides Sales Orders, atomic quotation conversion, credit checking, customer-row locking, commercial snapshots and Sales Order APIs/UI.

`conversion_contract_id` is an immutable application contract identifier, not a database FK. `sales_order_lines.quotation_line_id` is a relational FK to `sales_quotation_lines.id` with `ON DELETE RESTRICT`.

### Finance baseline

Phase 2 is the authoritative financial foundation. AR/AP remain the authoritative customer/supplier balance systems; AccountingCore/GL remain authoritative for accounting.

---

## 3. Non-Negotiable Architecture

1. One shared codebase; no customer-specific forks.
2. Independent customer deployments with isolated databases, storage and configuration.
3. Modular monolith first; preserve domain boundaries for future extraction.
4. PostgreSQL is the system of record.
5. Business logic belongs in backend/domain services.
6. API-first for every major business capability.
7. Configuration over source-code customization.
8. Posted financial transactions are immutable; correction uses reversal/credit/debit mechanisms.
9. Financially relevant operations go through AccountingCore.
10. AR/AP remain the authoritative subledgers.
11. Tax calculation remains centralized in the Tax Engine.
12. Workflow and Rules remain platform capabilities, not embedded in domain controllers.
13. AI never executes arbitrary SQL or bypasses authorization, rules, workflow, accounting or audit.
14. Critical operations are idempotent and concurrency-safe.
15. Domain services are the single source of business calculations.
16. Platform engines remain domain-agnostic.

### Standard transaction pipeline

```text
User / API / Automation / AI
          ↓
Domain Service
          ↓
Rules
          ↓
Authorization / Policy
          ↓
Workflow (when required)
          ↓
Tax / Pricing
          ↓
Accounting / Inventory (when required)
          ↓
Integration
          ↓
Notification
          ↓
Audit
```

---

## 4. Authoritative Ownership

```text
Customer        → Commercial Customer domain
Supplier        → Commercial Supplier domain
Product         → Product domain
Quotation       → Sales
Sales Order     → Sales
Delivery        → Sales Delivery
Invoice         → Sales Invoicing
Credit Note     → Sales Returns
Purchase Req.   → Procurement
Purchase Order  → Procurement
GRN             → Procurement Receiving
Supplier Bill   → Procurement Billing
Stock           → Inventory
Journal         → AccountingCore / GL
AR Balance      → AR Subledger
AP Balance      → AP Subledger
Tax             → Tax Engine
Workflow        → Workflow Engine
Rules           → Rules Engine
Audit           → Audit Engine
Search          → Search Engine
Reports         → Reporting/Query Engine
```

No domain creates a competing source of truth.

---

# 5. Remaining Platform Completion

Several existing platform capabilities are currently partial or contract-level. These should be completed as shared infrastructure instead of being reimplemented in individual domains.

## 5.1 Configuration Engine 2.0

Implement:

- tenant/company/branch/department inheritance;
- deterministic override precedence;
- effective dates;
- versioning;
- schema registry;
- custom field builder;
- custom form builder;
- conditional visibility;
- required/read-only rules;
- layout configuration;
- configuration studio UI.

## 5.2 Workflow Engine 2.0

Implement:

- workflow versioning;
- approval instances;
- sequential and parallel approval;
- delegated approval;
- escalation timers;
- reminders;
- approval authority;
- branch/department/value routing;
- simulation/test mode;
- complete approval history.

## 5.3 Rules Engine 2.0

Implement:

- visual/declarative rule definitions;
- versioning;
- effective dates;
- priorities;
- blocking rules;
- validation rules;
- derived-field rules;
- approval triggers;
- recommendation rules;
- simulation/dry-run;
- execution history.

## 5.4 Document Lifecycle 2.0

Standardize:

- states;
- allowed transitions;
- transition guards;
- terminal states;
- approval hooks;
- audit hooks;
- amend/revise semantics;
- posting boundaries;
- reversal boundaries.

## 5.5 Jobs / Queue / Notifications

Complete durable background processing with:

- persistent jobs;
- retry/backoff;
- dead-letter handling;
- progress;
- cancellation;
- scheduled jobs;
- worker heartbeat;
- idempotent execution;
- Email/SMS/WhatsApp/Push providers;
- notification preferences;
- delivery status.

Notification failures must not roll back committed financial transactions.

## 5.6 Integration Engine

Make connectors first-class:

- credentials;
- configuration;
- health;
- version;
- timeout;
- retry;
- idempotency;
- error classification;
- sandbox/test mode;
- logs;
- audit.

Target connectors include GST, E-Invoice, E-Way Bill, banking, UPI, payment gateways, email, SMS, WhatsApp and identity providers.

## 5.7 File / Document Storage

Complete storage abstraction with local/S3-compatible drivers, metadata, versions, permissions, expiry, checksum, preview, OCR boundary and entity attachments.

## 5.8 Search Engine

Build permission-aware:

- exact search;
- fuzzy search;
- identifier search;
- global search;
- module search;
- recent searches;
- filters;
- command/action search.

## 5.9 Import / Export

Create a shared import/export framework:

```text
Upload → Detect → Map → Validate → Preview → Import → Result
```

Support CSV, Excel and JSON import, plus CSV/Excel/PDF/JSON export. Long-running operations use jobs.

## 5.10 Reporting / Query Engine

Provide reusable permission-aware datasets, filters, groupings, aggregations, drill-down, comparative periods, saved reports, export and scheduling. Financial statements continue to derive from the existing authoritative GL reporting services.

## 5.11 Localization

Complete locale-aware timezone, currency, date, number and language handling. India is the first localization; core abstractions must remain country-extensible.

## 5.12 Feature Flags / Editions

Implement deployment/customer feature flags, module availability, edition policies and dependency-aware enable/disable behavior without source forks.

---

# 6. Phase 3 Remaining — Sales & Procurement

## 6.1 Phase 3.3 — Sales Delivery & Dispatch

### Scope

- `sales_deliveries`, `sales_delivery_lines`;
- partial/full delivery;
- dispatch lifecycle;
- branch/warehouse reference;
- transporter/vehicle/LR data;
- shipping destination;
- order line fulfillment updates;
- cancellation guards;
- idempotency;
- audit and notifications;
- APIs and React workbench.

### Lifecycle

```text
DRAFT → PICKED → PACKED → DISPATCHED → DELIVERED
                         ↓
                     CANCELLED
```

### Boundary

Until Inventory is implemented, delivery does **not** create stock ledger entries, valuation, batch/serial balances or COGS.

### Core invariant

`delivered_quantity <= ordered_quantity - cancelled_quantity`

---

## 6.2 Phase 3.4 — Sales Invoicing + AR + Accounting

### Scope

- sales invoice header/lines;
- invoice generation from order/delivery;
- direct invoice where permitted;
- financial lifecycle;
- GST snapshot;
- AR document/open item creation;
- AccountingCore posting;
- revenue/tax account determination;
- idempotent posting;
- immutable posted state;
- PDF/document rendering;
- APIs/UI/audit/notifications.

### Lifecycle

```text
DRAFT → SUBMITTED → APPROVED → POSTED
                                   ↓
                         PARTIALLY_SETTLED / SETTLED
                                   ↓
                                REVERSED
```

### Financial posting

```text
Sales Invoice
     ↓
Tax Engine
     ↓
AccountingCore
     ↓
GL
     +
AR Document / Open Item
```

### Invariants

- Invoice total reconciles with taxable amount and tax.
- Accounting debits equal credits.
- Posted documents are immutable.
- Closed accounting periods reject normal posting.
- Duplicate posting is impossible under retry/concurrency.

---

## 6.3 Phase 3.5 — Sales Returns / Credit Notes

Implement:

- sales credit notes;
- invoice references;
- quantity/amount adjustments;
- tax reversal;
- AR allocation;
- AccountingCore/GL reversal;
- approval;
- posting;
- reversal.

Never mutate the original posted invoice.

Inventory return movement is deferred until Inventory exists.

---

## 6.4 Phase 3.6 — Procurement Foundation & Purchase Requests

Entities:

- purchase requests;
- request lines;
- requester;
- department;
- required date;
- justification;
- estimated cost.

Lifecycle:

```text
DRAFT → SUBMITTED → APPROVED → ORDERED
                         ↓
                      REJECTED

DRAFT → CANCELLED
```

Department-level ownership and approval remain authoritative.

---

## 6.5 Phase 3.7 — Purchase Orders + Goods Receipt

### Purchase Order

Support supplier, lines, negotiated pricing, taxes, payment terms, delivery terms, destination, approvals and lifecycle.

### Goods Receipt

Support received/rejected quantities, inspection, acceptance, supplier reference and PO updates.

### Boundary

Before Inventory, GRN updates procurement receipt quantities only; it does not create perpetual stock balances or valuation.

---

## 6.6 Phase 3.8 — Supplier Billing + AP + Three-Way Match

### Match

```text
Purchase Order
+
Goods Receipt
+
Supplier Bill
      ↓
Three-Way Match
      ↓
MATCH / EXCEPTION
```

Evaluate:

- quantity;
- price;
- tax;
- amount.

Tolerance is configuration/rules driven.

### Financial flow

```text
Supplier Bill
      ↓
Tax Engine
      ↓
AccountingCore
      ↓
GL
      +
AP Open Item
```

Posted supplier bills are immutable.

---

## 6.7 Phase 3.9 — Procurement Returns / Debit Notes

Implement purchase returns and supplier debit notes with:

- original bill reference;
- quantity/amount adjustment;
- input-tax reversal;
- AP allocation;
- GL reversal;
- approval;
- posting;
- reversal.

---

## 6.8 Phase 3.10 — Commercial Reporting & UX

### Sales reports

- quotation conversion;
- order book;
- sales by customer/product/branch;
- salesperson performance;
- delivery fulfillment;
- invoice status;
- customer outstanding.

### Procurement reports

- PR pipeline;
- PO pipeline;
- supplier spend;
- supplier performance;
- purchase price variance;
- GRN variance;
- invoice mismatch.

### UX

Unify Sales/Procurement workbenches, timelines, contextual actions and exception queues.

---

## 6.9 Phase 3.11 — Full Commercial Verification Gate

Build deterministic end-to-end fixtures for:

### Sales

`Quotation → Sales Order → Delivery → Invoice → AR → Payment → Settlement`

### Procurement

`Purchase Request → PO → GRN → Supplier Bill → AP → Payment → Settlement`

Verify:

- document totals;
- quantities;
- GST;
- AR/AP;
- GL;
- payments;
- partial settlement;
- fiscal-period rules;
- immutability;
- idempotency;
- concurrency;
- tenant/company isolation;
- audit chain.

---

# 7. CRM

Implement CRM without duplicating Customer ownership.

## Entities

- leads;
- prospects;
- opportunities;
- activities;
- tasks;
- follow-ups;
- campaign/source.

## Lead lifecycle

```text
NEW → QUALIFIED → OPPORTUNITY → QUOTATION → WON

NEW → DISQUALIFIED
OPPORTUNITY → LOST
```

CRM integrates with existing customer/quotation services.

---

# 8. Inventory & Warehouse

Inventory remains a separate domain. It must not be retrofitted as ad-hoc fields into Sales or Procurement.

## 8.1 Inventory Foundation

Entities:

- warehouse;
- zone/rack/shelf/bin;
- stock movement;
- stock balance/read model;
- reservation;
- batch;
- serial;
- inventory policy.

Movement types:

```text
OPENING
RECEIPT
ISSUE
TRANSFER
ADJUSTMENT
RETURN
CONSUMPTION
RESERVATION
RELEASE
```

### Stock authority

Stock is derived from authoritative movement records.

### Valuation

Support configured costing policies such as FIFO, weighted/moving average and standard cost where accounting policy permits.

### Accounting

Inventory valuation effects flow through AccountingCore.

## 8.2 Warehouse Operations

- receiving;
- put-away;
- picking;
- packing;
- dispatch;
- internal transfer;
- cycle counting;
- stock counting;
- barcode scanning;
- batch/serial scanning.

## 8.3 Sales/Procurement integration

Delivery creates inventory issue movements after Inventory exists.

GRN creates inventory receipt movements after Inventory exists.

---

# 9. People / HR

## 9.1 HR Foundation

Employee data includes organization, department, manager, joining date, employment type, bank, statutory fields and documents.

Lifecycle:

`APPLICANT → EMPLOYEE → ACTIVE → EXITING → EXITED → ARCHIVED`

Sensitive HR data requires stricter data scope than ordinary business data.

## 9.2 Attendance

- shifts;
- attendance;
- overtime;
- late/early rules;
- holidays;
- corrections;
- biometric integration abstraction.

## 9.3 Leave

- leave types;
- policies;
- accrual;
- carry-forward;
- balances;
- approval;
- holiday calendars.

## 9.4 Payroll

```text
Employee
 ↓
Salary Structure
 ↓
Attendance / Leave / Overtime
 ↓
Statutory Rules
 ↓
Payroll Run
 ↓
Payslip
 ↓
AccountingCore
```

India statutory calculations are versioned/effective-dated configuration/rules, not hard-coded percentages.

---

# 10. Projects

Implement:

- projects;
- phases;
- tasks;
- milestones;
- dependencies;
- resources;
- budgets;
- timesheets;
- project expenses;
- billing;
- profitability.

Timesheets feed project costing and optionally payroll/billing.

Project cost must derive from authoritative source transactions, not duplicated manual totals.

---

# 11. Expenses

Lifecycle:

`DRAFT → SUBMITTED → MANAGER_APPROVED → FINANCE_APPROVED → REIMBURSED`

Support employee, category, amount, tax, receipt, project and cost center.

Accounting and reimbursement flow through existing finance/banking foundations.

---

# 12. Fixed Assets

Lifecycle:

`ACQUIRED → CAPITALIZED → ACTIVE → TRANSFERRED → DISPOSED`

Support:

- asset register;
- categories;
- locations/custodians;
- capitalization;
- depreciation;
- impairment;
- transfer;
- disposal.

All accounting effects go through AccountingCore.

---

# 13. Reporting, Analytics & Dashboards

## Reporting

Reusable reports must support filters for:

- date;
- branch;
- department;
- customer;
- supplier;
- product;
- salesperson;
- warehouse;
- cost center;
- project.

## Dashboards

Role-specific dashboards for:

- CEO/management;
- accountant;
- sales manager;
- purchase manager;
- warehouse manager.

Every major KPI must support drill-down to authoritative records.

## Budgeting

Support:

- annual budgets;
- department/cost-center budgets;
- project budgets;
- revenue/expense budgets;
- actual vs budget vs forecast.

Budgets are not accounting journals.

---

# 14. India Integrations

## GST

Keep the Tax Engine authoritative for calculation. Integration adapters own external submission state.

## E-Invoice

```text
Posted Invoice
 ↓
Eligibility / Validation
 ↓
IRP Submission
 ↓
IRN / Signed Data / QR
```

Submission must be idempotent and retry-safe.

## E-Way Bill

Support generation, updates, cancellation, extensions where applicable, vehicle/transporter data and status.

## Banking

Extend Banking with statement imports, matching, reconciliation and future direct-bank adapters.

---

# 15. Webhooks

Implement signed, versioned, retry-safe outbound events such as:

- customer.created/updated;
- quotation.approved;
- sales_order.confirmed;
- delivery.dispatched;
- invoice.posted;
- payment.received;
- purchase_order.approved;
- goods_receipt.accepted;
- supplier_bill.posted;
- stock.updated;
- employee.created;
- expense.approved.

Support subscriptions, retries, dead-letter handling, replay and delivery logs.

---

# 16. Privacy, Backup and Upgrade Platform

## Privacy

Provide:

- sensitive-data authorization;
- retention policies;
- deletion/anonymization workflows where applicable;
- data export;
- privacy event/audit logs;
- breach workflow.

## Backup / Restore

```text
Backup → Verify → Restore Point → Restore → Integrity Check → Health Check
```

Support automated/manual backups, encryption, retention and restore verification.

## Upgrade

```text
Backup
 ↓
Preflight
 ↓
Migration
 ↓
Application Update
 ↓
Health Check
 ↓
Verification
```

Never edit already-applied migrations.

---

# 17. Print / Document Templates

Provide configurable templates for:

- quotation;
- sales order;
- delivery note;
- invoice;
- receipt;
- payment voucher;
- purchase order;
- GRN;
- supplier bill;
- credit/debit note;
- payslip.

Support branding, signatures, terms, conditional fields, locale and PDF output.

---

# 18. Exception Management

Create a centralized Exception Queue for:

- credit exceeded;
- approval overdue;
- tax mismatch;
- PO/GRN variance;
- GRN/bill variance;
- invoice mismatch;
- integration failure;
- webhook failure;
- bank reconciliation exceptions;
- stock discrepancies;
- payroll exceptions.

Each exception has owner, severity, state, reason, resolution and audit trail.

---

# 19. AI Roadmap

AI is implemented after search/reporting and the core transaction platform are stable.

## AI V1 — Read Only

- natural-language search;
- business Q&A;
- report explanation;
- dashboard summaries;
- document summarization.

AI accesses read services, never the production database directly.

## AI V2 — Insights

- anomaly detection;
- trends;
- collection risk;
- margin analysis;
- working-capital insights;
- procurement anomalies;
- inventory predictions.

## AI V3 — Governed Actions

AI may prepare:

- quotation drafts;
- purchase requisitions;
- draft expenses;
- payment batches;
- collection messages;
- sales follow-ups;
- reorder recommendations.

Execution uses the Tool & Action Gateway.

## AI Agents

Potential governed agents:

- Finance Agent;
- Sales Agent;
- Procurement Agent;
- Inventory Agent;
- Management Agent.

Every AI action must record user, agent/tool, context reference, data scope, approval, result and outcome.

---

# 20. UX Architecture

The product should feel like one application.

Core navigation:

```text
Home | Sales | CRM | Purchase | Inventory | Finance | People | Projects | Reports | Settings
```

Global capabilities:

- `+ New` quick actions;
- `Ctrl + K` command center;
- contextual actions;
- global search;
- smart defaults;
- inline creation;
- autosave/draft recovery;
- actionable validation;
- useful empty states;
- keyboard accessibility;
- responsive desktop/tablet layout.

Advanced controls use progressive disclosure.

---

# 21. Database and API Rules for All Future Work

## Database

- Use migrations only.
- Do not modify applied migrations.
- Use PostgreSQL constraints for critical invariants.
- Use FKs for important relationships.
- Scope all reads/writes by trusted tenant/company context.
- Use optimistic versioning for edits.
- Use row locks where concurrency requires serialization.

## API

All major resources use `/api/v1`.

Every mutation considers:

- authentication;
- authorization/data scope;
- validation;
- lifecycle transition;
- business rules;
- workflow;
- idempotency;
- concurrency;
- transaction boundaries;
- audit.

---

# 22. Testing Strategy

Every implementation slice must include applicable:

- unit tests;
- integration tests;
- API tests;
- tenant/company isolation tests;
- concurrency tests;
- idempotency tests;
- accounting invariant tests;
- tax tests;
- E2E tests;
- regression tests.

High-risk financial/inventory/payment operations require explicit concurrency and invariant coverage.

---

# 23. Implementation Slice Definition of Done

A slice is complete only when applicable requirements exist for:

- domain model;
- lifecycle;
- validation;
- permissions/data scope;
- approvals/workflow;
- business rules;
- accounting/tax/inventory effects;
- audit;
- search;
- reports;
- import/export;
- APIs;
- notifications;
- configuration/customization;
- idempotency;
- concurrency;
- errors/retries/recovery;
- accessibility/UX;
- tests;
- documentation.

Not every slice needs every item, but the agent must explicitly state which are applicable.

---

# 24. Master Implementation Order

```text
CURRENT: Phase 3.2 complete
        ↓
Shared platform completion where required
        ↓
3.3 Sales Delivery
        ↓
3.4 Sales Invoicing + AR + GL
        ↓
3.5 Sales Returns
        ↓
3.6 Purchase Requests
        ↓
3.7 Purchase Orders + GRN
        ↓
3.8 Supplier Billing + AP + Match + GL
        ↓
3.9 Procurement Returns
        ↓
3.10 Commercial Reporting / UX
        ↓
3.11 Full Commercial Verification
        ↓
Inventory / Warehouse
        ↓
CRM
        ↓
HR / Attendance / Leave / Payroll
        ↓
Projects / Timesheets / Costing
        ↓
Expenses
        ↓
Fixed Assets
        ↓
Search / Reporting / Import-Export completion
        ↓
Dashboards / Analytics / Budgeting
        ↓
GST / E-Invoice / E-Way / Banking integrations
        ↓
Webhooks / Privacy / Backup / Upgrade / Templates
        ↓
AI V1
        ↓
AI V2
        ↓
AI V3 / Agents
```

Ordering may be adjusted only where a documented dependency requires a supporting platform capability earlier. Such adjustment is an implementation sequencing decision, not a request for a new architecture plan.

---

# 25. Migration Naming

The currently observed history ends at `012_phase3_sales_orders.sql`.

Future migration numbers must be confirmed against the real migration directory before creation. The following is the intended logical sequence, not permission to assume a number without checking:

```text
013 sales delivery
014 sales invoicing
015 sales returns
016 purchase requests
017 purchase orders / receiving
018 supplier billing
019 procurement returns
020+ inventory and subsequent domains/platform additions
```

Migration numbering must never be guessed when the repository has changed.

---

# 26. Final Verification Model

At product maturity, run deterministic end-to-end scenarios spanning:

- CRM → Sales → Finance;
- Procurement → Inventory → Finance;
- People → Payroll → Finance;
- Projects → Costing → Billing;
- Expenses → Reimbursement → Finance;
- Assets → Depreciation → Finance;
- external integrations;
- reporting and dashboards;
- AI governed actions.

Verify conservation of money, tax, stock, AR/AP, permissions, audit history, data isolation, idempotency and concurrency.

---

# 27. Architecture Change Rule

Implementation must not silently change this architecture.

If an issue is material:

1. stop the affected slice;
2. document the exact conflict;
3. record/update an ADR in `docs/DECISIONS.md`;
4. amend this master plan;
5. resume implementation from the corrected plan.

Minor implementation choices, refactors and UI refinements do not reopen architecture.

---

# 28. Authority

For future work, use this source order:

1. `docs/PRODUCT_REQUIREMENTS_SPECIFICATION.md` — product requirements;
2. `GEMINI.md` — engineering constitution;
3. `docs/DECISIONS.md` — accepted architectural decisions;
4. current source code and tests — actual implemented behavior;
5. this document — master architecture and remaining implementation order.

Historical phase documents remain valuable evidence but do not require repeating architecture planning for each future implementation slice.

---

# 29. Master Plan Status

**ARCHITECTURE COVERAGE: COMPLETE**

**REMAINING IMPLEMENTATION ROADMAP: DEFINED**

**PER-PHASE ARCHITECTURE RE-PLANNING: DISCONTINUED**

Future agents should implement the next ordered slice from this document, verify it, update `docs/IMPLEMENTATION_STATUS.md`, write an implementation report, and stop for the next explicit implementation instruction.
