# PHASE 2.5 — CENTRALIZED TAX ENGINE (INDIA GST & EFFECTIVE-DATED RATES)
## AUTHORITATIVE ARCHITECTURE & IMPLEMENTATION PLAN

---

## 1. EXECUTIVE SUMMARY

Phase 2.5 introduces the **Centralized Tax Engine** for General ERP, establishing statutory Indian Goods and Services Tax (GST) calculation, effective-dated rate matrix resolution, Place of Supply determination, Reverse Charge Mechanism (RCM) handling, and seamless integration with the Phase 2.4 `AccountingCoreService` and `GLEngine`.

### Key Objectives
* **Statutory Compliance**: Enforce Indian GST rules (CGST, SGST, IGST, UTGST, Compensation Cess) across all commercial transactions.
* **Effective-Dated Rate Matrix**: Support temporal rate evolution and HSN/SAC code mappings without mutating historical tax determinations.
* **Place of Supply (PoS) Engine**: Automate intra-state vs. inter-state classification based on party state codes, SEZ statuses, and transaction types.
* **Deterministic Decimal Calculation**: Guarantee exact tax calculations using `ExactDecimal` with standard Indian statutory rounding rules (round-half-even to 2 decimal places).
* **Financial Ledger Integration**: Map tax liability and input credit directly into COA control accounts during transaction posting via `AccountingCoreService`.

---

## 2. AUTHORITATIVE SCOPE & ROADMAP REFERENCE

The authoritative scope for Phase 2.5 is derived directly from:
1. `docs/PHASE_2_IMPLEMENTATION_PLAN.md` — Section 10 & Line 713 ("Phase 2.5 — Tax Engine").
2. `docs/PRODUCT_REQUIREMENTS_SPECIFICATION.md` — Section 22 & 23 ("Tax Engine & Indian Statutory Rules").
3. `docs/IMPLEMENTATION_STATUS.md` — Line 71 ("Phase 2.5 — Centralized Tax Engine").

### Scope Boundary Summary
* **In Scope**: Centralized Tax Engine, HSN/SAC master lookup, effective-dated tax matrix (`tax_categories`, `tax_rates`, `tax_rules`), Place of Supply determination, inclusive/exclusive rate calculations, Reverse Charge Mechanism (RCM), tax rounding, COA account resolution, Fastify REST APIs, and accounting posting hooks.
* **Explicit Non-Goals (Future Phases)**:
  * GST Returns generation (GSTR-1, GSTR-3B, GSTR-9) — *Phase 5 (Reporting & Statutory Filing)*
  * Live e-Invoice & e-Way Bill IRP API integrations — *Phase 5 (Integrations)*
  * Accounts Receivable & Accounts Payable subledgers — *Phases 2.6 & 2.7*
  * Direct execution of arbitrary SQL or UI tax calculations — *Forbidden by ERP Constitution (`GEMINI.md`)*

---

## 3. CURRENT REPOSITORY STATE & GAP ANALYSIS

### Existing Stubs & Capabilities
* **`packages/core/src/tax/`**: Basic GSTIN validator utility (`isValidGSTIN`) and minimal format checker.
* **`apps/api/src/modules/finance/chart-of-accounts.service.ts`**: Contains statutory tax control accounts (`2200-OUTPUT-CGST`, `2200-OUTPUT-SGST`, `2200-OUTPUT-IGST`, `1300-INPUT-CGST`, `1300-INPUT-SGST`, `1300-INPUT-IGST`).
* **`apps/api/src/modules/finance/accounting-core.service.ts`**: Phase 2.4 posting pipeline ready to consume tax breakdown journal lines.
* **`packages/core/src/utils/exact-decimal.ts`**: High-precision decimal arithmetic module available across packages.

### Gaps to be Implemented in Phase 2.5
1. Database tables for `hsn_sac_codes`, `tax_categories`, `tax_rates`, `tax_rules`.
2. `TaxEngineService` to encapsulate all tax matrix resolution, Place of Supply determination, and rate computation logic.
3. Tax-inclusive calculation logic using exact decimal division.
4. RCM accounting line generator.
5. Fastify REST API endpoints (`/api/v1/finance/tax/*`) with RBAC authorization (`finance:tax:*`).

---

## 4. PHASE 2.5 SUBPHASE BREAKDOWN

Phase 2.5 is structured into 6 sequential, individually verifiable subphases:

### Subphase 2.5.0 — Schema & Database Foundation
* **Objective**: Create PostgreSQL tables, effective-dated indexes, foreign key constraints, and multi-tenant scoping.
* **Scope**: Tables `hsn_sac_codes`, `tax_categories`, `tax_rates`, `tax_rules`.
* **Precision Policy**: All tax percentages stored as `numeric(9,6)` to accommodate complex slab percentages without rounding loss.
* **Indexes**: Composite unique index on `(company_id, tax_category_id, valid_from)` to prevent overlapping effective dates.

### Subphase 2.5.1 — Tax Matrix & HSN/SAC Resolution Service
* **Objective**: Implement lookup and resolution services for effective tax rates based on transaction date, HSN/SAC code, and company.
* **Scope**: HSN/SAC validation, rate matrix traversal, default rate fallback handling, effective date window selection (`valid_from <= tx_date AND (valid_to IS NULL OR valid_to >= tx_date)`).

### Subphase 2.5.2 — Place of Supply & Taxability Evaluator
* **Objective**: Determine statutory tax type (CGST + SGST vs. IGST vs. UTGST) and taxability classification (Taxable, Exempt, Nil-Rated, Non-GST).
* **Scope**: Party GSTIN state code comparison vs Company GSTIN state code. Handling Special Economic Zone (SEZ) supplies (treated as inter-state IGST zero-rated) and Deemed Exports.

### Subphase 2.5.3 — Tax Calculation Pipeline & Inclusive/Exclusive Engine
* **Objective**: Compute net amount, tax components, cess, and total amount using `ExactDecimal`.
* **Scope**:
  * **Tax-Exclusive Formula**: $\text{Tax} = \text{Base} \times \text{Rate}$; $\text{Total} = \text{Base} + \text{Tax}$.
  * **Tax-Inclusive Formula**: $\text{Base} = \frac{\text{Total}}{1 + \text{Rate}}$; $\text{Tax} = \text{Total} - \text{Base}$.
  * **Rounding Rule**: Statutory Half-Even rounding (`ROUND_HALF_EVEN`) to 2 decimal places per component.

### Subphase 2.5.4 — Accounting Core Integration & Tax Posting Hooks
* **Objective**: Generate structured journal line breakdowns for output tax liabilities, input tax credits, and RCM reverse-charge entries.
* **Scope**: Verification of accounting invariant: $\text{Base Amount} + \sum \text{Tax Components} = \text{Total Line Amount}$. Integration with `AccountingCoreService.postTransaction()`.

### Subphase 2.5.5 — Fastify REST API Routes & Final Hardening
* **Objective**: Expose HTTP endpoints for tax calculation, matrix management, and HSN lookup with security and audit controls.
* **Scope**: Fastify routes, request validation schemas (Zod/JSON Schema), RBAC guards (`finance:tax:read`, `finance:tax:write`), Audit logging, integration tests, and 200-iteration randomized stress test.

---

## 5. DEPENDENCY GRAPH

```text
Phase 2.3 General Ledger Engine
      ↓
Phase 2.4 Accounting Core Posting & Reversals
      ↓
Phase 2.5.0 Schema & Database Foundation
      ↓
Phase 2.5.1 Tax Matrix & HSN/SAC Resolution Service
      ↓
Phase 2.5.2 Place of Supply & Taxability Evaluator
      ↓
Phase 2.5.3 Tax Calculation Pipeline & Inclusive/Exclusive Engine
      ↓
Phase 2.5.4 Accounting Core Integration & Tax Posting Hooks
      ↓
Phase 2.5.5 Fastify REST API Routes & Final Hardening
      ↓
Phase 2.6 Accounts Receivable / Phase 2.7 Accounts Payable
```

---

## 6. ARCHITECTURE BOUNDARIES & CONTROL FLOW

```text
User / API / Operational Domain (Sales/Purchase)
      ↓
[TaxEngineService]
  ├── Resolves Effective Tax Matrix (subphase 2.5.1)
  ├── Evaluates Place of Supply & Taxability (subphase 2.5.2)
  └── Calculates Base, CGST, SGST, IGST, Cess (subphase 2.5.3)
      ↓
Returns Structured Tax Breakdown Result
      ↓
[AccountingCoreService] (Phase 2.4)
  ├── Maps Tax Breakdown to Control Accounts (2200-OUTPUT-*, 1300-INPUT-*)
  └── Submits Balanced Journal Entry to [GLEngine] (Phase 2.3)
```

### Strict Boundary Rules
1. **Forbidden Reverse Dependency**: `GLEngine` and `AccountingCoreService` MUST NOT import or depend on `TaxEngineService`.
2. **Domain Scoping**: Operational domains (Sales, Purchasing) pass transaction metadata to `TaxEngineService`; they do not perform custom tax math.
3. **Statutory Immutability**: Historical tax postings reference immutable journal entries; altering tax matrix rates does not recalculate past posted transactions.

---

## 7. DATABASE PLAN

### Schema: `tax_categories`
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK | Primary Key |
| `company_id` | `uuid` | FK -> companies(id), NOT NULL | Multi-tenant isolation |
| `code` | `varchar(50)` | NOT NULL | Category identifier (e.g. `STANDARD`, `REDUCED`, `EXEMPT`) |
| `name` | `varchar(100)` | NOT NULL | Human-readable name |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT now() | Audit timestamp |

### Schema: `hsn_sac_codes`
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK | Primary Key |
| `company_id` | `uuid` | FK -> companies(id), NOT NULL | Multi-tenant isolation |
| `code` | `varchar(10)` | NOT NULL | HSN or SAC code (4, 6, or 8 digits) |
| `description` | `text` | NOT NULL | Goods/Services description |
| `type` | `varchar(10)` | CHECK (`type` IN ('HSN', 'SAC')) | Classification type |
| `default_tax_category_id` | `uuid` | FK -> tax_categories(id) | Default category |

### Schema: `tax_rates`
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK | Primary Key |
| `company_id` | `uuid` | FK -> companies(id), NOT NULL | Multi-tenant isolation |
| `tax_category_id` | `uuid` | FK -> tax_categories(id), NOT NULL | Foreign key |
| `rate_type` | `varchar(20)` | CHECK (`rate_type` IN ('CGST', 'SGST', 'IGST', 'CESS')) | Tax component type |
| `rate_percent` | `numeric(9,6)` | NOT NULL | Tax percentage rate |
| `valid_from` | `date` | NOT NULL | Effective start date |
| `valid_to` | `date` | NULLABLE | Effective end date |

---

## 8. FINANCIAL INTEGRITY & INVARIANTS

1. **Exact Decimal Guarantee**: Floating-point math (`number`) is strictly forbidden for tax calculations. All computations use `ExactDecimal`.
2. **Rounding Rule**: Half-even rounding to 2 decimal places ($0.005 \rightarrow 0.00$, $0.015 \rightarrow 0.02$).
3. **Tax Component Invariant**:
   $$\text{Line Net Amount} + \text{CGST Amount} + \text{SGST Amount} + \text{IGST Amount} + \text{Cess Amount} = \text{Line Total Amount}$$
4. **Reverse Charge Mechanism (RCM)**: When RCM applies, tax liability is posted directly to output control accounts with a matching debit to RCM clearing/credit accounts without increasing supplier payable balances.

---

## 9. TESTING STRATEGY

* **Unit Tests**:
  * HSN/SAC code validation.
  * Place of Supply matrix tests (28 Indian States + 8 Union Territories + SEZ).
  * Inclusive and exclusive tax calculations with rounding edge cases.
* **Integration Tests**:
  * End-to-end database tax matrix resolution with overlapping date boundaries.
  * `AccountingCoreService` posting with tax breakdown verification against `GLEngine`.
* **Concurrency & Stress Tests**:
  * Multi-threaded concurrent tax calculation requests.
  * 200-iteration randomized transaction stress test verifying balanced debit/credit invariants across tax entries.

---

## 10. RISKS & MITIGATIONS

| Risk | Impact | Likelihood | Mitigation |
| :--- | :--- | :--- | :--- |
| Floating point rounding discrepancies | High | High | Enforce `ExactDecimal` and standard `ROUND_HALF_EVEN` across all tax operations. |
| Temporal tax rate overlap | High | Medium | Enforce database-level unique constraint on `(company_id, tax_category_id, valid_from)`. |
| Incorrect Place of Supply logic | Critical | Medium | Comprehensive unit test suite covering all state-code pairs and SEZ scenarios. |

---

## 11. SUBPHASE APPROVAL GATES

Each subphase must strictly follow the gated workflow:
$$\text{Implement} \longrightarrow \text{Test} \longrightarrow \text{Verify} \longrightarrow \text{External Approval} \longrightarrow \text{Next Subphase}$$

---

## 12. DEFINITION OF DONE FOR PHASE 2.5

Phase 2.5 will be considered complete when:
1. All 6 subphases (2.5.0 to 2.5.5) pass unit, integration, and security tests.
2. 100% of existing tests (233+ unit/integration tests) remain green.
3. The 200-iteration randomized tax stress test executes without invariant violations.
4. `docs/PHASE_2_5_COMPLETION_REPORT.md` is generated and externally approved.
