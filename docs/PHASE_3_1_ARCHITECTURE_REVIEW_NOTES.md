# PHASE 3.1 — ARCHITECTURE REVIEW & CORRECTION NOTES

## Executive Overview
This document records the architectural corrections applied during the final consistency pass of `PHASE_3_1_SALES_QUOTATION_ARCHITECTURE_PLAN.md` prior to formal implementation sign-off. Every contradiction across lifecycle states, snapshot freeze points, revision transitions, pricing test coverage, multi-currency invariants, conversion boundaries, revision storage models, header discount calculations, GST tax base reconciliation, and deterministic residual allocation tie-breaking has been resolved.

---

## Summary of Architectural Corrections

| # | Issue Identified | Why It Mattered | Architectural Correction Applied | Status |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **`CONVERTED` State Omission in Enum**: Plan referenced `CONVERTED` status in Phase 3.2 contract, but `CONVERTED` was missing from Phase 3.1 quotation status enum. | Created a cross-phase schema/contract contradiction when Phase 3.2 attempts to update quotation status. | Added `CONVERTED` to Phase 3.1 status enum (`sales_quotations.status`). Defined as terminal, read-only, non-editable state owned by Phase 3.2 upon Sales Order DB commit. Phase 3.1 defines the schema contract but creates 0 Sales Orders and executes 0 `CONVERTED` transitions. | **CORRECTED** |
| **2** | **Snapshot Freeze Ambiguity**: Documents stated snapshots froze at `APPROVED`, but also permitted shipping address edits in `APPROVED`. | An approved quotation whose address was edited before sending would contain invalid/stale frozen snapshots. | Unified freeze point to transition `APPROVED → SENT`. Dynamic recalculation occurs in `DRAFT`, `PENDING_APPROVAL`, and `APPROVED`. Permanent immutable freeze occurs upon transition to `SENT`. | **CORRECTED** |
| **3** | **`REJECTED → REVISED` Omission**: Text allowed revision creation from `REJECTED` quotations, but state machine table only listed `SENT → REVISED`. | Left revision lifecycle incomplete for rejected customer quotations. | Explicitly added `REJECTED → REVISED` to state machine and transition table. Revisions permitted from `SENT` and `REJECTED`; prohibited from `ACCEPTED`, `CONVERTED`, `EXPIRED`, `CANCELLED`, `REVISED`. | **CORRECTED** |
| **4** | **Pricing Test Scope Gap**: Test section listed 3 pricing levels, omitting Volume Tiers and Manual Overrides defined in the pricing architecture. | Risk of incomplete integration testing for volume-tiered pricing and rep discount overrides. | Updated test suite specification to explicitly verify all 4 pricing cascade levels (`Entity Override → Price List Rule → Volume Tier → Product Selling Price`) plus manual overrides & authorization thresholds. | **CORRECTED** |
| **5** | **Multi-Currency Invariants**: Plan allowed `exchangeRate DEFAULT 1.000000` without validating currency matching. | Foreign currency quotations could silently compute invalid base currency totals if exchange rate was omitted. | Enforced explicit invariants: `exchangeRate > 0`; `exchangeRate = 1.000000` if quotation currency == company base currency; valid exchange rate mandatory for foreign currencies. `totalAmountBase = roundTo2(totalAmount * exchangeRate)`. | **CORRECTED** |
| **6** | **Conversion Contract Completeness**: Contract specification lacked explicit non-re-resolution rules for Phase 3.2. | Phase 3.2 could attempt to re-query mutable product/tax master data instead of relying on the contract. | Documented that `QuotationConversionContract` is the single authoritative commercial snapshot. Phase 3.2 MUST NOT re-resolve prices, rates, or address snapshots from master tables. | **CORRECTED** |
| **7** | **Conversion Idempotency Isolation**: Idempotency contract needed clear phase boundaries. | Risk of mixing Phase 3.1 contract idempotency with Phase 3.2 order creation idempotency. | Phase 3.1 owns `QuotationConversionContract` idempotency (`conversionContractId` + `Idempotency-Key`). Re-submitting returns cached contract without duplicate issuance. Phase 3.1 creates zero Sales Orders. | **CORRECTED** |
| **8** | **Revision Storage Model Contradiction**: Terminology referenced a separate `sales_quotation_revisions` table not present in the database schema. | Risk of competing revision architectures between separate tables vs single-table versioned rows. | Adopted single-table revision model as sole authoritative architecture: Revisions are versioned rows in `sales_quotations` + `sales_quotation_lines` using `quotationNumber` + `revisionNumber` + `UNIQUE(tenant_id, company_id, quotation_number, revision_number)`. Removed all references to a `sales_quotation_revisions` table. | **CORRECTED** |
| **9** | **Header Discount & GST Tax Base Reconciliation**: Header discount was not reconciled with line taxable amounts, causing potential tax base mismatches between line GST sum and header taxable total. | Ambiguity in line vs header taxable base when `headerDiscountAmount > 0`. | Established proportional allocation pipeline: `headerDiscountAmount` is allocated deterministically across lines proportionally to line `preHeaderTaxableAmount`. Line `taxableAmount = preHeaderTaxableAmount - allocatedHeaderDiscountAmount`. Line GST is calculated from final line `taxableAmount`. Added `allocatedHeaderDiscountAmount` (`numeric(15,2)`) to `sales_quotation_lines` schema. Header taxable total equals sum of line taxable amounts (`taxableAmount = sum(line.taxableAmount)`). | **CORRECTED** |
| **10** | **Proportional Allocation Residual Tie-Breaker Rule**: The residual cents assignment rule ("largest preHeaderTaxableAmount") was incomplete when multiple lines tied for maximum base. | Potential non-deterministic rounding allocation across repeated executions if two lines have equal preHeaderTaxableAmount. | Formulated explicit multi-level tie-breaker rule: `Residual recipient = MAX(preHeaderTaxableAmount), then MIN(lineNumber), then MIN(line.id)`. Guarantees 100% deterministic, reproducible allocation across all calculations. | **CORRECTED** |
| **11** | **Reconcile Documented Foreign Keys With Drizzle Schema**: Documented text mentioned `salesRepresentativeId -> users.id` and `pricingRuleId -> pricing_rules.id`, but Drizzle schema snippet omitted `.references()`. | Schema contract discrepancy between documented entity relations and Drizzle TypeScript definitions. | Explicitly added `.references(() => users.id)` to `salesRepresentativeId` and `.references(() => pricingRules.id)` to `pricingRuleId` across field tables, Drizzle schema, migration specs, and acceptance criteria (ADR-314). | **CORRECTED** |
| **12** | **Reconcile Quotation Status Enum Database Enforcement**: Quotation status vocabulary was described as an enum, but Drizzle used unconstrained `varchar(32)`. | Risk of invalid status string insertion bypassing application validation at the DB boundary. | Adopted Option B: PostgreSQL `varchar(32)` + explicit database `CHECK` constraint `chk_sales_quotation_status` enforcing `status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVISED', 'CANCELLED', 'CONVERTED')` (ADR-314). | **CORRECTED** |
| **13** | **Reconcile `allowExpiredQuotationConversion` Preconditions**: Configuration included `allowExpiredQuotationConversion = false`, but conversion precondition strictly required `validityDate >= today`. | Undefined configuration behavior if configuration flag was toggled to `true`. | Adopted Option B: Defined active policy evaluation rules (ADR-315). When `false` (default), conversion requires `validityDate >= today`. When `true`, conversion contract issuance is permitted for `ACCEPTED` quotations regardless of expiration. Covered by test fixtures for both policy states. | **CORRECTED** |

---

## Detailed Architectural Decisions & State Matrices

### 1. Unified Quotation Status Lifecycle Set & Database CHECK Constraint
The authoritative `status` field for `sales_quotations` in Phase 3.1 is defined as `varchar(32)` backed by PostgreSQL database `CHECK` constraint `chk_sales_quotation_status` (ADR-314):

```sql
ALTER TABLE sales_quotations ADD CONSTRAINT chk_sales_quotation_status 
CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVISED', 'CANCELLED', 'CONVERTED'));
```

#### Lifecycle State Characteristics Matrix

| Lifecycle Status | Phase Owner | Mutable? | Customer Facing? | Can Create Revision? | Can Issue Contract? | Terminal State? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `DRAFT` | Phase 3.1 | **YES** | NO | NO | NO | NO |
| `PENDING_APPROVAL` | Phase 3.1 | NO (Locked) | NO | NO | NO | NO |
| `APPROVED` | Phase 3.1 | Partial (Address) | NO | NO | NO | NO |
| `SENT` | Phase 3.1 | **NO (Frozen)** | **YES** | **YES** | NO | NO |
| `ACCEPTED` | Phase 3.1 | **NO (Frozen)** | **YES** | NO | **YES** | NO |
| `REJECTED` | Phase 3.1 | **NO (Frozen)** | **YES** | **YES** | NO | **YES** |
| `EXPIRED` | Phase 3.1 | **NO (Frozen)** | **YES** | NO | Policy-Gated | **YES** |
| `REVISED` | Phase 3.1 | **NO (Frozen)** | Historical | NO | NO | **YES** |
| `CANCELLED` | Phase 3.1 | **NO (Frozen)** | Internal | NO | NO | **YES** |
| `CONVERTED` | **Phase 3.2** | **NO (Frozen)** | Historical | NO | NO | **YES** |

### 2. Single-Table Revision Storage Architecture
- Revisions are represented strictly as versioned rows in `sales_quotations` and corresponding `sales_quotation_lines` records.
- **Identity**: `quotationNumber` remains stable across all revisions of a commercial document. `revisionNumber` (1, 2, 3...) distinguishes individual revisions.
- **Constraint**: Database unique index `UNIQUE (tenant_id, company_id, quotation_number, revision_number)`.
- No separate `sales_quotation_revisions` table exists.

### 3. Persisted Header Discount & Taxable Base Allocation Pipeline
To reconcile GST calculations with document-level header discounts:
1. `grossAmount = roundTo2(quantity * unitPrice)`
2. `lineDiscountAmount = roundTo2(grossAmount * discountPercent / 100)`
3. `preHeaderTaxableAmount = grossAmount - lineDiscountAmount`
4. `preHeaderTaxableTotal = sum(line.preHeaderTaxableAmount)`
5. `0 <= headerDiscountAmount <= preHeaderTaxableTotal`
6. `allocatedHeaderDiscount_i = roundTo2(headerDiscountAmount * (preHeaderTaxableAmount_i / preHeaderTaxableTotal))`
7. **Deterministic Residual Tie-Breaker**: Residual cents `residual = headerDiscountAmount - sum(allocatedHeaderDiscount_i)` are assigned using the rule:
   $$\text{Residual Recipient} = \text{MAX}(preHeaderTaxableAmount), \text{ then } \text{MIN}(lineNumber), \text{ then } \text{MIN}(line.id)$$
8. `taxableAmount_i = preHeaderTaxableAmount_i - allocatedHeaderDiscount_i`
9. `cgstAmount_i = roundTo2(taxableAmount_i * cgstRate / 100)`, `sgstAmount_i = roundTo2(taxableAmount_i * sgstRate / 100)`, `igstAmount_i = roundTo2(taxableAmount_i * igstRate / 100)`.
10. Header totals:
    - `subtotalAmount = sum(line.grossAmount)`
    - `lineDiscountAmount = sum(line.discountAmount)`
    - `discountAmount = lineDiscountAmount + headerDiscountAmount`
    - `taxableAmount = sum(line.taxableAmount)`
    - `taxAmount = sum(line.taxAmount)`
    - `totalAmount = taxableAmount + taxAmount`
    - `totalAmountBase = roundTo2(totalAmount * exchangeRate)`

- Effective Discount Percentage for Approval Threshold:
  - `effectiveDiscountPercent = roundTo2((discountAmount / subtotalAmount) * 100)`
  - If `effectiveDiscountPercent > max_sales_rep_discount`, triggers `PENDING_APPROVAL`.

### 4. Expired Quotation Conversion Policy (ADR-315)
- Evaluated via `configurationService` / `rulesEngine` during `issueConversionContract()` preconditions validation:
  - When `allowExpiredQuotationConversion = false` (default): Precondition requires `validityDate >= today`. If expired, rejects with `EXPIRED_QUOTATION_CONVERSION_PROHIBITED`.
  - When `allowExpiredQuotationConversion = true`: Precondition permits contract issuance for `ACCEPTED` quotation regardless of validity date expiration.

---

## Final Verification
All 13 corrections have been verified for internal consistency and incorporated into `docs/PHASE_3_1_SALES_QUOTATION_ARCHITECTURE_PLAN.md`.
The plan contains **zero** implementation dependencies on Phase 3.2 while maintaining 100% schema and contract alignment.
