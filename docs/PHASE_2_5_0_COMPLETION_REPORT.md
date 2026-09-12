# PHASE 2.5.0 — TAX ENGINE SCHEMA & DATABASE FOUNDATION COMPLETION REPORT

---

## 1. EXECUTIVE SUMMARY

Phase 2.5.0 — Schema & Database Foundation has been successfully implemented and verified. This phase establishes the production-grade PostgreSQL relational and Drizzle ORM foundation for the Centralized Indian GST Tax Engine, enforcing strict tenant/company composite ownership, temporal range exclusion integrity, high-precision rate storage (`numeric(9,6)`), and comprehensive check constraints.

```text
PHASE 2.5 ARCHITECTURE: APPROVED WITH CORRECTIONS

PHASE 2.5.0 IMPLEMENTATION: COMPLETE
PHASE 2.5.0 VERIFICATION: PASS
PHASE 2.5.0: APPROVAL REQUIRED

PHASE 2.5.1: NOT STARTED

NEXT ACTION: EXTERNAL REVIEW / APPROVAL REQUIRED
```

---

## 2. DATABASE SCHEMA SPECIFICATION

The foundation introduces 4 core entities in `packages/database/src/schema/tax.ts` and migration `packages/database/migrations/006_phase2_5_0_tax_foundation.sql`:

### 1. `tax_categories`
* **Purpose**: Master table defining tax category classifications (e.g. `STANDARD`, `REDUCED`, `EXEMPT`, `NIL_RATED`, `SUPER_REDUCED`, `SPECIAL`).
* **Columns**: `id` (UUID PK), `tenant_id` (VARCHAR 64), `company_id` (UUID FK -> companies), `code` (VARCHAR 50), `name` (VARCHAR 100), `description` (TEXT), `status` (VARCHAR 16 DEFAULT 'ACTIVE'), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ).
* **Indexes**:
  * `idx_tax_cat_tenant_comp_id` (UNIQUE on `tenant_id`, `company_id`, `id`) — Target for composite ownership FKs.
  * `idx_tax_cat_tenant_comp_code` (UNIQUE on `tenant_id`, `company_id`, `code`).

### 2. `hsn_sac_codes`
* **Purpose**: Master classification table for Indian Harmonized System of Nomenclature (HSN) and Service Accounting Codes (SAC).
* **Columns**: `id` (UUID PK), `tenant_id` (VARCHAR 64), `company_id` (UUID FK -> companies), `code` (VARCHAR 10), `description` (TEXT), `type` (VARCHAR 10), `default_tax_category_id` (UUID Nullable), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ).
* **Constraints**:
  * `chk_hsn_sac_type`: CHECK (`type` IN ('HSN', 'SAC')).
  * `fk_hsn_sac_tenant_comp_cat`: Composite FK on `(tenant_id, company_id, default_tax_category_id)` referencing `tax_categories(tenant_id, company_id, id)`.
* **Indexes**:
  * `idx_hsn_sac_tenant_comp_id` (UNIQUE on `tenant_id`, `company_id`, `id`).
  * `idx_hsn_sac_tenant_comp_code` (UNIQUE on `tenant_id`, `company_id`, `code`).

### 3. `tax_rates`
* **Purpose**: Effective-dated tax rate percentage matrix for statutory Indian GST components.
* **Columns**: `id` (UUID PK), `tenant_id` (VARCHAR 64), `company_id` (UUID FK -> companies), `tax_category_id` (UUID NOT NULL), `rate_type` (VARCHAR 20 NOT NULL), `rate_percent` (NUMERIC(9,6) NOT NULL), `valid_from` (DATE NOT NULL), `valid_to` (DATE Nullable), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ).
* **Precision Policy**: `NUMERIC(9,6)` to prevent float rounding errors.
* **Constraints**:
  * `chk_tax_rates_type`: CHECK (`rate_type` IN ('CGST', 'SGST', 'IGST', 'UTGST', 'CESS')).
  * `chk_tax_rates_percent_non_negative`: CHECK (`rate_percent` >= 0).
  * `chk_tax_rates_validity_range`: CHECK (`valid_to` IS NULL OR `valid_to` >= `valid_from`).
  * `fk_tax_rates_tenant_comp_cat`: Composite FK on `(tenant_id, company_id, tax_category_id)` referencing `tax_categories(tenant_id, company_id, id)`.
  * `ex_tax_rates_no_overlap`: PostgreSQL Exclusion Constraint (`EXCLUDE USING gist`) preventing temporal date range overlaps.

### 4. `tax_rules`
* **Purpose**: Rule definitions for taxability classification, Place of Supply determination, and Reverse Charge (RCM) overrides.
* **Columns**: `id` (UUID PK), `tenant_id` (VARCHAR 64), `company_id` (UUID FK -> companies), `tax_category_id` (UUID Nullable), `hsn_sac_code_id` (UUID Nullable), `supply_type` (VARCHAR 32 DEFAULT 'ALL'), `taxability` (VARCHAR 20 DEFAULT 'TAXABLE'), `is_rcm` (BOOLEAN DEFAULT false), `is_sez` (BOOLEAN DEFAULT false), `priority` (INTEGER DEFAULT 10), `status` (VARCHAR 16 DEFAULT 'ACTIVE'), `valid_from` (DATE NOT NULL), `valid_to` (DATE Nullable), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ).
* **Constraints**:
  * `chk_tax_rules_taxability`: CHECK (`taxability` IN ('TAXABLE', 'EXEMPT', 'NIL_RATED', 'NON_GST')).
  * `chk_tax_rules_validity_range`: CHECK (`valid_to` IS NULL OR `valid_to` >= `valid_from`).
  * `fk_tax_rules_tenant_comp_cat`: Composite FK on `(tenant_id, company_id, tax_category_id)` referencing `tax_categories(tenant_id, company_id, id)`.
  * `fk_tax_rules_tenant_comp_hsn`: Composite FK on `(tenant_id, company_id, hsn_sac_code_id)` referencing `hsn_sac_codes(tenant_id, company_id, id)`.

---

## 3. COMPOSITE OWNERSHIP & TENANT ISOLATION

Every tax master entity explicitly mandates:
```sql
tenant_id VARCHAR(64) NOT NULL,
company_id UUID NOT NULL
```

All foreign keys between tax entities enforce composite keys:
```sql
FOREIGN KEY (tenant_id, company_id, tax_category_id) 
    REFERENCES tax_categories (tenant_id, company_id, id)
```
This guarantees that Tenant A / Company A can **never** establish references to Tenant B / Company B tax categories, HSN codes, or rates.

---

## 4. TEMPORAL RANGE OVERLAP PREVENTION MECHANISM

Rather than relying on application-level pre-checks or preliminary `UNIQUE(company_id, tax_category_id, valid_from)` constraints (which fail to prevent overlapping ranges such as `2026-01-01 -> 2026-12-31` and `2026-06-01 -> NULL`), PostgreSQL enforces database-level range exclusion:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE tax_rates ADD CONSTRAINT ex_tax_rates_no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    company_id WITH =,
    tax_category_id WITH =,
    rate_type WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[]') WITH &&
);
```

### Applicability Key Protected
$$\text{Applicability Key} = \text{tenant\_id} + \text{company\_id} + \text{tax\_category\_id} + \text{rate\_type}$$

* **Allowed**: Non-overlapping consecutive periods (`2026-01-01 -> 2026-06-30` and `2026-07-01 -> NULL`).
* **Rejected**: Overlapping periods (`2026-01-01 -> 2026-12-31` and `2026-06-01 -> NULL`).
* **Rejected**: Competing open-ended periods (`2026-01-01 -> NULL` and `2027-01-01 -> NULL`).
* **Independent**: Identical date ranges across different `rate_type` (e.g. CGST vs SGST vs IGST) or different `tax_category_id`.

---

## 5. MIGRATION SAFETY & CONVENTION COMPLIANCE

* **Migration Identifier**: `packages/database/migrations/006_phase2_5_0_tax_foundation.sql`.
* **Idempotency**: All DDL statements use `IF NOT EXISTS` / `DO $$` guard blocks.
* **Non-Destructive**: Zero alterations or drops to existing financial or platform tables.

---

## 6. VERIFICATION & TESTING RESULTS

### Suite Summary
* **Total Test Files**: 20 passed (20)
* **Total Tests**: 250 passed (250)
* **New Phase 2.5.0 Tests**: `apps/api/test/phase2_5_0_tax_foundation.test.ts` (17 tests covering schema, precision, composite FKs, CHECK constraints, migration DDL, and temporal range matrices).

### Quality Gate Checklist
* [x] Multi-tenant & cross-company composite FK isolation verified.
* [x] `NUMERIC(9,6)` precision policy verified for tax rates.
* [x] UTGST, CGST, SGST, IGST, CESS statutory components supported.
* [x] TAXABLE, EXEMPT, NIL_RATED, NON_GST classifications supported.
* [x] `EXCLUDE USING gist` temporal overlap prevention verified.
* [x] `npm run build` executed cleanly across all workspace packages.
* [x] 100% regression suite passed (233 previous tests remain green).
