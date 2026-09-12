# Architecture & Engineering Decisions

This file records decisions that materially affect implementation. New decisions should include date, status, context, decision, and consequences.

## ADR-001 — One codebase, independent deployments
**Status:** Accepted

The ERP is one product/codebase deployed independently for each customer with isolated database/storage/configuration. Customer-specific source forks are prohibited.

## ADR-002 — Modular monolith first
**Status:** Accepted

Start as a modular monolith. Keep domain boundaries and contracts explicit so selected modules can be extracted later if scale or organizational needs justify it.

## ADR-003 — Foundational platform engines
**Status:** Accepted

Configuration, Workflow, Rules, Authorization/Policy, Audit, Accounting, Document Lifecycle, Master Data, Tax, Integration, Job/Queue, Notification, and Numbering/Sequence are platform capabilities consumed by business domains.

## ADR-004 — Accounting authority
**Status:** Accepted

Financially relevant operations must flow through the Accounting Engine. Operational modules must not directly manipulate the authoritative general ledger.

## ADR-005 — AI safety boundary
**Status:** Accepted

AI may recommend and execute permitted actions only through governed ERP tools. AI must not execute arbitrary SQL or bypass permissions, rules, approvals, accounting controls, or audit.

## ADR-006 — Configuration over customer forks
**Status:** Accepted

Customer-specific behavior should be implemented through configuration, custom fields/forms, workflows, rules, reports, templates, plugins, and integrations before considering core product changes.

---

## ADR-007 — Cryptographic Audit Hash Chaining
**Status:** Accepted
**Date:** 2026-09-08

### Context
Financial and regulatory compliance requires that audit logs are tamper-evident and cannot be altered, deleted, or reordered without detection.

### Decision
Every audit log entry computes a cryptographic SHA-256 hash incorporating the previous log's hash (`hash = SHA256(prev_hash + tenant_id + module + entity + action + timestamp)`). The `AuditService` includes a `verifyAuditChain()` method to verify chain integrity.

### Consequences
Audit trails are cryptographically linked and tamper-evident. Any modification to a past log invalidates subsequent hash values.

---

## ADR-008 — Concurrency-Safe Document Numbering Engine
**Status:** Accepted
**Date:** 2026-09-08

### Context
Operational documents require sequence allocation (e.g., `INV-2025-26-BLR-0001`) with fiscal year resets and branch scoping.

### Decision
Document sequence allocation is handled by the platform `NumberingEngine` (Platform Engine #13) using atomic counters, configurable templates, and padding rules. Naive `SELECT MAX(number) + 1` queries are prohibited.

### Consequences
Numbering allocation is concurrency-safe, scope-aware, and fiscal-year compliant across all business modules.

---

## ADR-009 — Mandatory Phase Progression Rules & Verification Gates
**Status:** Accepted
**Date:** 2026-09-08

### Context
To maintain architecture discipline and avoid premature implementation of business domain features before platform engines are production-ready, phase transitions must be explicitly gated.

### Decision
The AI agent must never automatically proceed from one phase to another. Every phase completion must end with `PHASE X COMPLETE — WAITING FOR EXPLICIT APPROVAL`. The next phase begins only after explicit user instruction following a formal architecture review.

### Consequences
All domain modules in Phase 2 through Phase 6 will build upon audited, production-grade platform engine contracts without platform rewrites or architectural churn.

