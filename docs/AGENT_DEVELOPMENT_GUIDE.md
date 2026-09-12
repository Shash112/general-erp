# AI Agent Development Guide — General ERP

## 1. How the agent should work

This repository is being built by an AI coding agent. The agent must behave like a senior product engineer and ERP domain engineer, not like a code generator.

The agent should optimize for correctness, maintainability, auditability, and incremental delivery.

### Required workflow

`Understand -> Inspect -> Read Master Plan -> Implement Slice -> Test -> Review -> Document -> Report`

Never skip inspection of existing code before adding a parallel implementation.

### Master Architecture Rule

The remaining architecture is planned once in:

`docs/MASTER_REMAINING_ARCHITECTURE_AND_IMPLEMENTATION_PLAN.md`

The agent must use that document as the roadmap and should **not require a new architecture plan for every phase or item**.

Implementation is intentionally separated from architecture planning:

```text
MASTER ARCHITECTURE
        ↓
IMPLEMENTATION SLICE
        ↓
VERIFY
        ↓
STATUS / REPORT
        ↓
NEXT SLICE
```

A concise implementation plan for the current slice is still required before coding, but it must be derived from the master plan rather than recreating architecture decisions.

### Architecture Change Gate

Reopen architecture only when implementation discovers a material conflict involving:

- financial correctness;
- legal/statutory correctness;
- security or tenant/company data isolation;
- data integrity;
- migration compatibility;
- a broken cross-domain contract;
- unavoidable scope change.

For such a conflict, document/update an ADR in `docs/DECISIONS.md`, amend the master plan, then continue. Minor implementation choices, refactors and UX refinements do not reopen architecture.

There is **no mandatory `PHASE X COMPLETE — WAITING FOR EXPLICIT APPROVAL` gate** between implementation slices. After verification, update status/reporting and stop for the next explicit implementation instruction.

## 2. Repository authority

### Product requirements
`docs/PRODUCT_REQUIREMENTS_SPECIFICATION.md`

This is the primary product contract.

### Agent constitution
`GEMINI.md`

This file contains non-negotiable engineering and architectural rules.

### Architecture decisions
`docs/DECISIONS.md`

Record important choices, especially material choices when the PRS or master plan leaves multiple valid implementations.

### Master remaining plan
`docs/MASTER_REMAINING_ARCHITECTURE_AND_IMPLEMENTATION_PLAN.md`

This is the authoritative architecture and implementation roadmap for remaining work.

### Progress
`docs/IMPLEMENTATION_STATUS.md`

Keep this aligned with actual code, not intended code.

## 3. Implementation roadmap

Do not use the old phase-by-phase planning gate. Follow the ordered roadmap in the master plan.

At the current baseline, the major sequence is:

1. Shared platform completion where required by the next slice.
2. Sales Delivery.
3. Sales Invoicing + AR + Accounting.
4. Sales Returns.
5. Purchase Requests.
6. Purchase Orders + GRN.
7. Supplier Billing + AP + three-way matching.
8. Procurement Returns.
9. Commercial Reporting / UX.
10. Full Commercial Verification.
11. Inventory / Warehouse.
12. CRM.
13. HR / Attendance / Leave / Payroll.
14. Projects / Timesheets / Costing.
15. Expenses.
16. Fixed Assets.
17. Search / Reporting / Import-Export completion.
18. Dashboards / Analytics / Budgeting.
19. GST / E-Invoice / E-Way / Banking integrations.
20. Webhooks / Privacy / Backup / Upgrade / Templates.
21. AI V1, then V2, then V3 / governed agents.

Do not invent a different sequence without identifying a concrete dependency.

## 4. Vertical slice rule

For every major business capability, prefer a complete vertical slice:

`DB -> Domain -> Application service -> API -> Authorization -> Workflow/Rules -> Accounting/Tax/Inventory effects -> Audit -> UI -> Tests`

A feature should not remain as a UI-only mock while backend foundations are missing unless explicitly marked as a prototype.

## 5. Domain boundaries

Suggested backend modules:

```text
platform/
  auth
  authorization
  organization
  configuration
  workflow
  rules
  audit
  documents
  notifications
  jobs
  numbering
  integrations
  search
  reporting

finance/
  accounting
  receivables
  payables
  banking
  tax
  assets
  expenses

sales/
  crm
  customers
  quotations
  sales-orders
  delivery
  invoicing

procurement/
  suppliers
  requisitions
  rfq
  supplier-quotations
  purchase-orders
  receiving
  billing

inventory/
  products
  warehouses
  stock

people/
  hr
  attendance
  leave
  payroll

projects/

ai/
```

Names may adapt to the final repository, but boundaries must remain explicit.

## 6. Database rules

- Use PostgreSQL.
- Every table needs clear ownership.
- Use UUIDs or the project-approved ID strategy consistently.
- Include created/updated metadata where appropriate.
- Use soft deletion only where business semantics require it; do not use it to hide financial history.
- Add unique constraints and indexes from actual query/access patterns.
- Use foreign keys for important relationships.
- Financial posting must be transactional.
- Avoid generic JSON blobs for authoritative financial data. JSON/custom-field storage is for genuinely configurable attributes.
- Effective-dated configuration must support historical correctness.
- Never edit an already-applied migration; create a new migration.

## 7. API rules

Use versioned APIs such as `/api/v1`.

Every mutation should consider:
- authentication
- authorization and data scope
- validation
- idempotency
- concurrency
- lifecycle/state transition
- business rules
- audit
- transactional boundaries
- standardized errors

Use consistent pagination, filtering, sorting, field selection where appropriate, and request correlation IDs.

## 8. State machines

Do not implement lifecycle fields as arbitrary strings scattered across the codebase.

Define explicit state transitions and guard them through domain/application services.

Historical and master-plan examples include:
- Lead: NEW -> QUALIFIED -> OPPORTUNITY -> QUOTATION -> WON, with DISQUALIFIED/LOST paths.
- Sales quotation/order lifecycles as defined by their accepted architecture documents.
- Financial correction: POSTED -> CREDIT NOTE / ADJUSTMENT rather than destructive editing.

## 9. Accounting rules

Accounting is authoritative.

Operational modules must emit accounting effects through the Accounting Engine rather than constructing raw journal rows themselves.

Examples:
- Sales -> AR -> GL
- Purchase -> AP -> GL
- Inventory -> valuation -> GL
- Payroll -> payroll accounting -> GL

Enforce `Total Debit = Total Credit`.

Do not allow normal operational users to create arbitrary journals unless the relevant finance permission and workflow allow it.

## 10. India localization

Tax and statutory rules are configuration/rule-engine concerns and must be versioned/effective-dated.

Never scatter GST percentages or payroll statutory rates through application code.

Integration adapters for GST/e-invoice/e-way bill must be replaceable because external API specifications can change.

## 11. Customer customization

Support four levels:

1. Configuration
2. Custom fields/forms/reports/dashboards/templates/rules
3. Plugins/integrations/custom UI/APIs
4. Core product changes by the product team only

The agent must never solve a customer requirement by creating a source fork.

## 12. Testing strategy

At minimum, add:
- unit tests for domain rules and calculations
- integration tests for repositories and transactions
- API tests for authorization and lifecycle transitions
- accounting invariant tests
- tax calculation tests
- idempotency tests for externally triggered operations
- concurrency tests for critical posting/stock/payment flows
- end-to-end tests for high-value workflows

High-risk areas require tests before broad refactoring.

## 13. Security

- No secrets in source.
- Validate external input.
- Least privilege.
- Secure session/token handling.
- MFA-ready architecture.
- Rate-limit sensitive APIs.
- Audit privileged actions.
- Prevent tenant/customer data leakage between deployments/configurations.
- Do not expose internal stack traces to clients.

## 14. AI implementation rules

AI is a controlled interface to ERP capabilities.

Correct pattern:

`AI -> Tool Gateway -> Permission Check -> Business Rules -> Approval -> Domain Transaction -> Accounting/Tax/Inventory -> Audit`

Incorrect:

`AI -> SQL -> database`

AI must have explicit tool schemas, authorization context, input validation, execution limits, audit records, and clear confirmation/approval semantics.

## 15. Handling ambiguity

Use this decision hierarchy:

1. Follow explicit PRS requirement.
2. Follow accepted architectural decision.
3. Follow the master remaining architecture plan.
4. Follow existing implemented convention.
5. Prefer the simpler, reversible design.
6. Record the decision.
7. Ask the human if financial, legal, security, migration, or data-loss risk is material.

## 16. Agent response format

For implementation tasks, respond with:

### Plan
- 3–8 concise bullets describing the implementation slice only.

### Changes
- files/modules changed
- important implementation choices

### Validation
- commands run
- tests and results

### Risks / follow-ups
- known limitations
- material decisions requiring human input
- next implementation slice

Do not claim a test passed if it was not actually run.
