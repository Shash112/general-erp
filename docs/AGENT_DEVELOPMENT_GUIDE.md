# AI Agent Development Guide — General ERP

## 1. How the agent should work

This repository is being built by an AI coding agent inside Antigravity. The agent must behave like a senior product engineer and ERP domain engineer, not like a code generator.

The agent should optimize for correctness, maintainability, auditability, and incremental delivery.

### Required loop

`Understand -> Inspect -> Plan -> Implement -> Test -> Review -> Document -> Report`

Never skip inspection of existing code before adding a parallel implementation.

### Phase Progression Rule

**Never automatically proceed from one phase to another.**

Every phase must end with:

```text
PHASE X COMPLETE — WAITING FOR EXPLICIT APPROVAL
```

The next phase may begin only after an explicit user instruction.


## 2. Repository authority

### Product requirements
`docs/PRODUCT_REQUIREMENTS_SPECIFICATION.md`

This is the primary product contract.

### Agent constitution
`GEMINI.md`

This file contains non-negotiable engineering and architectural rules.

### Architecture decisions
`docs/DECISIONS.md`

Record important choices, especially when the PRS leaves multiple valid implementations.

### Progress
`docs/IMPLEMENTATION_STATUS.md`

Keep this aligned with actual code, not intended code.

## 3. Recommended implementation order

Do not start by implementing screens randomly. Build vertical foundations first.

### Phase 0 — Engineering foundation
- repository/workspace
- TypeScript strictness
- lint/format/test
- environment/config system
- database connection
- migrations
- logging/observability
- API conventions
- error model
- authentication foundation
- authorization/policy foundation
- audit foundation
- health/readiness checks

### Phase 1 — Platform engines
- organization/master data
- numbering/sequences
- configuration/custom fields/forms
- rules
- workflow/approvals
- document lifecycle
- notifications
- file/document storage
- jobs/queues

### Phase 2 — Financial and operational core
- chart of accounts
- journal/accounting engine
- fiscal periods
- tax engine
- AR/AP
- products/UOM
- warehouses/inventory movements

### Phase 3 — Sales and procurement
- customers/suppliers
- CRM
- quotations
- sales orders
- delivery
- invoices
- purchase requisitions
- RFQs
- supplier quotations
- purchase orders
- GRN
- purchase invoices
- three-way matching

### Phase 4 — People, projects, assets, expenses
Implement only after shared platform and financial primitives are stable.

### Phase 5 — Reporting, analytics, integrations
- reporting/query engine
- dashboards
- imports/exports
- banking integrations
- GST/e-invoice/e-way integrations
- webhooks

### Phase 6 — AI
- read-only business Q&A
- insights
- governed tool gateway
- draft actions
- approval-gated execution
- agents

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
  purchase-orders
  receiving

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

Examples from the PRS:
- Lead: NEW -> QUALIFIED -> OPPORTUNITY -> QUOTATION -> WON, with DISQUALIFIED/LOST paths.
- Sales documents: DRAFT -> SUBMITTED -> APPROVAL -> APPROVED -> CONFIRMED -> PARTIALLY FULFILLED -> COMPLETED.
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
2. Follow locked architectural decision.
3. Follow existing implemented convention.
4. Prefer the simpler, reversible design.
5. Record the decision.
6. Ask the human if financial, legal, security, migration, or data-loss risk is material.

## 16. Agent response format

For implementation tasks, respond with:

### Plan
- 3–8 concise bullets.

### Changes
- files/modules changed
- important design choices

### Validation
- commands run
- tests and results

### Risks / follow-ups
- known limitations
- decisions requiring human input
- next recommended task

Do not claim a test passed if it was not actually run.
