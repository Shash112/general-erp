# General ERP — AI Development Agent Constitution

## Mission
Build the General ERP product defined by `docs/PRODUCT_REQUIREMENTS_SPECIFICATION.md` as a production-grade, modular monolith for Indian SMEs and mid-market businesses.

Primary product principle: **Simple by default. Powerful when needed.**

## Source of truth
1. `docs/PRODUCT_REQUIREMENTS_SPECIFICATION.md` — product requirements.
2. `docs/AGENT_DEVELOPMENT_GUIDE.md` — engineering rules for the AI agent.
3. `docs/DECISIONS.md` — accepted architectural decisions.
4. Current source code and tests — source of truth for already-implemented behavior.
5. `docs/MASTER_REMAINING_ARCHITECTURE_AND_IMPLEMENTATION_PLAN.md` — master architecture and roadmap for remaining work.

If a requirement is ambiguous, do not silently invent business behavior. Record the ambiguity in `docs/DECISIONS.md`, choose the safest reversible implementation, and continue only when the choice does not affect financial/legal correctness. Ask the human when it does.

## Non-negotiable architecture
- One shared codebase; no customer-specific forks.
- Independent customer deployments and isolated databases.
- Modular monolith first. Do not introduce microservices/Kubernetes unless explicitly approved.
- PostgreSQL is the system of record.
- Domain logic belongs in backend/domain services, never in UI-only code.
- API-first: all important capabilities must be exposed through stable APIs.
- Configuration over customization: solve customer differences with configuration, custom fields/forms, workflows, rules, reports, templates, plugins, and integrations.
- Financially relevant operations must go through the Accounting Engine / AccountingCore.
- Posted financial records are immutable; corrections use proper reversal/credit/debit mechanisms.
- AI must use approved ERP tools and must never execute arbitrary SQL or bypass authorization, rules, approvals, accounting controls, or audit logging.

## Foundational engines
Treat these as platform capabilities with stable contracts:
- Configuration Engine
- Workflow Engine
- Rules Engine
- Authorization & Policy Engine
- Audit Engine
- Accounting Engine
- Document Lifecycle Engine
- Master Data Engine
- Tax Engine
- Integration Engine
- Job & Queue Engine
- Notification Engine
- Numbering & Sequence Engine

Supporting engines include Pricing, Search, File/Document Storage, Import/Export, Reporting/Query, Localization, Feature Flags/Edition, and AI Tool/Action Gateway.

Business modules consume platform engines. Platform engines must not depend on business modules.

## Transaction pipeline
For cross-domain operations, prefer:
`User/API/Automation/AI -> Domain Service -> Rules -> Policy -> Workflow -> Tax/Pricing -> Accounting -> Integration -> Notification -> Audit`

Do not bypass layers merely to make a feature faster to implement.

## Data integrity
Enforce domain invariants at the backend and database boundaries where appropriate:
- Journal debits equal credits.
- Invoice totals reconcile to lines, discounts, and taxes.
- Stock follows authoritative movement records.
- AR/AP balances derive from authoritative transactions.
- Closed accounting periods reject normal postings.
- Critical operations are idempotent.
- Concurrent edits are detected using optimistic locking/versioning and DB transactions/locks where needed.

## Coding standards
- TypeScript with strict mode.
- Prefer small, cohesive modules and explicit types.
- No `any` unless justified and documented.
- No duplicated business rules across frontend/backend.
- No magic tax rates, accounting mappings, workflow thresholds, or customer-specific constants in code.
- Use migrations for schema changes.
- Never modify an existing migration that may already have been applied; create a new migration.
- Secrets belong in environment/secret management, never source control.
- Use structured logging and correlation/request IDs.
- Validate all external input.
- Use parameterized queries/ORM safely; never interpolate untrusted SQL.
- Every async integration/job must define retry, idempotency, failure and observability behavior.

## UX rules
- Minimize clicks, screens, fields, duplicate entry, and training.
- Use smart defaults and progressive disclosure.
- Provide global search, quick actions, contextual actions, useful empty states, actionable errors, autosave/draft recovery where appropriate, and keyboard-friendly workflows.
- Advanced controls should not overwhelm first-time users.

## Definition of done
A feature is not complete when CRUD works. It is complete only when applicable requirements are implemented for:
- domain model and lifecycle
- validation and invariants
- permissions/data scope
- approvals/workflows
- accounting/tax/inventory effects
- audit trail
- search
- reports
- import/export
- API
- notifications
- configuration/customization
- errors/retries/idempotency/concurrency
- accessibility and UX
- tests
- documentation

## Master-plan implementation model
The architecture for remaining work is planned once in `docs/MASTER_REMAINING_ARCHITECTURE_AND_IMPLEMENTATION_PLAN.md`.

The normal workflow is:

`MASTER ARCHITECTURE -> IMPLEMENTATION SLICE -> VERIFY -> STATUS/REPORT -> NEXT SLICE`

Do **not** create a new architecture plan or formal architecture-review gate for every phase/item. Read the master plan, inspect the current repository, and implement the next ordered slice.

Architecture may be reopened only when implementation discovers a material conflict involving financial correctness, legal/statutory correctness, security/data isolation, data integrity, migration compatibility, a broken cross-domain contract, or unavoidable scope change. In that case, record/update an ADR and amend the master plan before proceeding.

## Agent behavior
Before coding:
1. Read the relevant PRS sections.
2. Read the relevant section of the master remaining architecture/implementation plan.
3. Inspect the existing repository and conventions.
4. Identify dependencies and authoritative ownership.
5. State a concise implementation-slice plan; do not re-plan the architecture.

While coding:
1. Make the smallest coherent change that advances the current milestone.
2. Reuse platform engines instead of creating local alternatives.
3. Keep backend business logic authoritative.
4. Add tests with the feature.
5. Update docs/decisions when architecture materially changes.

After coding:
1. Run formatter, typecheck, lint, unit/integration tests, and relevant build checks.
2. Review for security, data integrity, auditability, and customer customization.
3. Update `docs/IMPLEMENTATION_STATUS.md` and add/update the implementation report as appropriate.
4. Report changed files, tests run, known limitations, and next implementation slice.

## Forbidden shortcuts
- Do not generate the whole ERP in one pass.
- Do not build all screens with mocked data and call it complete.
- Do not create customer forks.
- Do not hard-code customer-specific rules.
- Do not put accounting logic in controllers/components.
- Do not let AI write arbitrary SQL or call internal DB APIs directly.
- Do not bypass permissions/approval/audit for convenience.
- Do not silently change the PRS or master architecture.
- Do not silently start a different implementation slice before the current slice is verified.
