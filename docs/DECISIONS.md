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
Document sequence allocation is handled by the platform `NumberingEngine` using atomic counters, configurable templates, and padding rules. Naive `SELECT MAX(number) + 1` queries are prohibited.

### Consequences
Numbering allocation is concurrency-safe, scope-aware, and fiscal-year compliant across all business modules.

---

## ADR-009 — Master Architecture + Implementation Slices
**Status:** Accepted
**Date:** 2026-09-12
**Supersedes:** ADR-009 (2026-09-08) — Mandatory Phase Progression Rules & Verification Gates

### Context
The project previously required a fresh architecture plan and formal approval gate before each phase. This creates unnecessary repeated planning now that the remaining ERP architecture has been reviewed as a single roadmap.

### Decision
The remaining architecture is planned once in `docs/MASTER_REMAINING_ARCHITECTURE_AND_IMPLEMENTATION_PLAN.md`.

Future work follows:

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

A concise implementation plan is still produced before each coding slice, but it is derived from the master architecture rather than recreating architecture decisions.

Architecture may be reopened only for material conflicts involving financial/legal correctness, security or data isolation, data integrity, migration compatibility, broken cross-domain contracts, or unavoidable scope changes. Such a change must be recorded as an ADR and reflected in the master plan before implementation continues.

There is no mandatory `PHASE X COMPLETE — WAITING FOR EXPLICIT APPROVAL` gate between implementation slices.

### Consequences

- Architecture decisions are made once and reused across the remaining roadmap.
- Implementation can proceed incrementally without repeated architecture-review cycles.
- Verification remains mandatory for every implementation slice.
- Material architectural discoveries remain explicitly governed and auditable.
