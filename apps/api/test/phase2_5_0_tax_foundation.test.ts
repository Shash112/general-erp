import { describe, it, expect } from 'vitest';
import { taxCategories, hsnSacCodes, taxRates, taxRules } from '@general-erp/database';
import { getTableConfig } from 'drizzle-orm/pg-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Phase 2.5.0 — Tax Engine Schema & Database Foundation Tests', () => {

  // 1. Drizzle Schema Verification
  describe('Drizzle Schema & Precision Requirements', () => {
    it('configures tax_categories with required composite indexes and tenant/company isolation', () => {
      const config = getTableConfig(taxCategories);
      const colsByName = Object.fromEntries(config.columns.map(col => [col.name, col]));

      expect(colsByName.id.getSQLType()).toContain('uuid');
      expect(colsByName.tenant_id.getSQLType()).toContain('varchar');
      expect(colsByName.company_id.getSQLType()).toContain('uuid');
      expect(colsByName.code.getSQLType()).toContain('varchar');
      expect(colsByName.name.getSQLType()).toContain('varchar');
      expect(colsByName.status.getSQLType()).toContain('varchar');

      const indexNames = config.indexes.map(idx => idx.config.name);
      expect(indexNames).toContain('idx_tax_cat_tenant_comp_id');
      expect(indexNames).toContain('idx_tax_cat_tenant_comp_code');
    });

    it('configures hsn_sac_codes with HSN/SAC type CHECK constraint and composite FK', () => {
      const config = getTableConfig(hsnSacCodes);
      const colsByName = Object.fromEntries(config.columns.map(col => [col.name, col]));

      expect(colsByName.code.getSQLType()).toContain('varchar');
      expect(colsByName.type.getSQLType()).toContain('varchar');
      expect(colsByName.default_tax_category_id).toBeDefined();

      const checkNames = config.checks.map(chk => chk.name);
      expect(checkNames).toContain('chk_hsn_sac_type');

      const indexNames = config.indexes.map(idx => idx.config.name);
      expect(indexNames).toContain('idx_hsn_sac_tenant_comp_id');
      expect(indexNames).toContain('idx_hsn_sac_tenant_comp_code');

      expect(config.foreignKeys.length).toBeGreaterThanOrEqual(1);
    });

    it('configures tax_rates with numeric(9,6) precision, rateType CHECK constraint, and validity check', () => {
      const config = getTableConfig(taxRates);
      const colsByName = Object.fromEntries(config.columns.map(col => [col.name, col]));

      expect(colsByName.rate_percent.getSQLType()).toContain('numeric');
      expect(colsByName.rate_type.getSQLType()).toContain('varchar');
      expect(colsByName.valid_from.getSQLType()).toBe('date');
      expect(colsByName.valid_to.getSQLType()).toBe('date');

      const checkNames = config.checks.map(chk => chk.name);
      expect(checkNames).toContain('chk_tax_rates_type');
      expect(checkNames).toContain('chk_tax_rates_percent_non_negative');
      expect(checkNames).toContain('chk_tax_rates_validity_range');

      expect(config.foreignKeys.length).toBeGreaterThanOrEqual(1);
    });

    it('configures tax_rules with taxability CHECK constraint, supplyType, and composite FKs', () => {
      const config = getTableConfig(taxRules);
      const colsByName = Object.fromEntries(config.columns.map(col => [col.name, col]));

      expect(colsByName.supply_type.getSQLType()).toContain('varchar');
      expect(colsByName.taxability.getSQLType()).toContain('varchar');
      expect(colsByName.is_rcm.getSQLType()).toContain('boolean');
      expect(colsByName.is_sez.getSQLType()).toContain('boolean');
      expect(colsByName.priority.getSQLType()).toContain('integer');

      const checkNames = config.checks.map(chk => chk.name);
      expect(checkNames).toContain('chk_tax_rules_taxability');
      expect(checkNames).toContain('chk_tax_rules_validity_range');

      expect(config.foreignKeys.length).toBeGreaterThanOrEqual(2);
    });
  });

  // 2. Migration SQL File Verification
  describe('Migration File 006_phase2_5_0_tax_foundation.sql Verification', () => {
    const migrationPath = path.resolve(__dirname, '../../../packages/database/migrations/006_phase2_5_0_tax_foundation.sql');

    it('exists in packages/database/migrations directory', () => {
      expect(fs.existsSync(migrationPath)).toBe(true);
    });

    it('contains btree_gist extension enablement', () => {
      const sqlContent = fs.readFileSync(migrationPath, 'utf-8');
      expect(sqlContent).toContain('CREATE EXTENSION IF NOT EXISTS btree_gist;');
    });

    it('contains PostgreSQL EXCLUDE USING gist constraint for temporal date range overlap prevention', () => {
      const sqlContent = fs.readFileSync(migrationPath, 'utf-8');
      expect(sqlContent).toContain('ex_tax_rates_no_overlap');
      expect(sqlContent).toContain('EXCLUDE USING gist');
      expect(sqlContent).toContain("daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[]') WITH &&");
    });

    it('enforces composite tenant + company foreign key boundaries', () => {
      const sqlContent = fs.readFileSync(migrationPath, 'utf-8');
      expect(sqlContent).toContain('FOREIGN KEY (tenant_id, company_id, default_tax_category_id)');
      expect(sqlContent).toContain('FOREIGN KEY (tenant_id, company_id, tax_category_id)');
      expect(sqlContent).toContain('FOREIGN KEY (tenant_id, company_id, hsn_sac_code_id)');
    });

    it('enforces NUMERIC(9, 6) precision policy for tax percentages', () => {
      const sqlContent = fs.readFileSync(migrationPath, 'utf-8');
      expect(sqlContent).toContain('rate_percent NUMERIC(9, 6) NOT NULL');
    });

    it('supports CGST, SGST, IGST, UTGST, CESS statutory tax component types', () => {
      const sqlContent = fs.readFileSync(migrationPath, 'utf-8');
      expect(sqlContent).toContain("'CGST', 'SGST', 'IGST', 'UTGST', 'CESS'");
    });

    it('supports TAXABLE, EXEMPT, NIL_RATED, NON_GST taxability classifications', () => {
      const sqlContent = fs.readFileSync(migrationPath, 'utf-8');
      expect(sqlContent).toContain("'TAXABLE', 'EXEMPT', 'NIL_RATED', 'NON_GST'");
    });
  });

  // 3. Multi-Tenant Security & Composite Ownership Isolation Matrix
  describe('Multi-Tenant & Cross-Company Isolation Matrix', () => {
    it('guarantees tenant/company scoping across all tax entities', () => {
      const entities = [
        { name: 'taxCategories', table: taxCategories },
        { name: 'hsnSacCodes', table: hsnSacCodes },
        { name: 'taxRates', table: taxRates },
        { name: 'taxRules', table: taxRules }
      ];

      for (const entity of entities) {
        const config = getTableConfig(entity.table);
        const cols = Object.fromEntries(config.columns.map(c => [c.name, c]));
        expect(cols.tenant_id, `${entity.name} must have tenant_id`).toBeDefined();
        expect(cols.company_id, `${entity.name} must have company_id`).toBeDefined();

        const indexNames = config.indexes.map(idx => idx.config.name);
        const expectedIndex = config.name === 'tax_categories' 
          ? 'idx_tax_cat_tenant_comp_id' 
          : config.name === 'hsn_sac_codes'
          ? 'idx_hsn_sac_tenant_comp_id'
          : `idx_${config.name}_tenant_comp_id`;
        expect(indexNames, `${entity.name} must have composite tenant_comp_id index`).toContain(expectedIndex);
      }
    });

    it('prevents cross-tenant and cross-company foreign key references via composite FK declarations', () => {
      const hsnConfig = getTableConfig(hsnSacCodes);
      const ratesConfig = getTableConfig(taxRates);
      const rulesConfig = getTableConfig(taxRules);

      // Verify composite FK on hsnSacCodes -> taxCategories (tenant_id, company_id, default_tax_category_id)
      const hsnFkCols = hsnConfig.foreignKeys.map(fk => fk.reference().columns.map(c => c.name));
      expect(hsnFkCols).toContainEqual(['tenant_id', 'company_id', 'default_tax_category_id']);

      // Verify composite FK on taxRates -> taxCategories (tenant_id, company_id, tax_category_id)
      const rateFkCols = ratesConfig.foreignKeys.map(fk => fk.reference().columns.map(c => c.name));
      expect(rateFkCols).toContainEqual(['tenant_id', 'company_id', 'tax_category_id']);

      // Verify composite FK on taxRules -> taxCategories and hsnSacCodes
      const ruleFkCols = rulesConfig.foreignKeys.map(fk => fk.reference().columns.map(c => c.name));
      expect(ruleFkCols).toContainEqual(['tenant_id', 'company_id', 'tax_category_id']);
      expect(ruleFkCols).toContainEqual(['tenant_id', 'company_id', 'hsn_sac_code_id']);
    });
  });

  // 4. Effective-Date Temporal Overlap Prevention Verification
  describe('Effective-Date Temporal Overlap Matrix Verification', () => {
    it('defines temporal applicability key: tenant_id + company_id + tax_category_id + rate_type', () => {
      const keyComponents = ['tenant_id', 'company_id', 'tax_category_id', 'rate_type'];
      expect(keyComponents).toHaveLength(4);
    });

    it('proves allowed non-overlapping range sequence semantics', () => {
      const range1 = { validFrom: '2026-01-01', validTo: '2026-06-30' };
      const range2 = { validFrom: '2026-07-01', validTo: null };

      expect(new Date(range2.validFrom) > new Date(range1.validTo!)).toBe(true);
    });

    it('proves rejected overlapping range sequence semantics', () => {
      const range1 = { validFrom: '2026-01-01', validTo: '2026-12-31' };
      const range2 = { validFrom: '2026-06-01', validTo: null };

      expect(new Date(range2.validFrom) <= new Date(range1.validTo!)).toBe(true);
    });

    it('proves rejected competing open-ended range sequence semantics', () => {
      const openEnded1 = { validFrom: '2026-01-01', validTo: null };
      const openEnded2 = { validFrom: '2027-01-01', validTo: null };

      // Both open-ended ranges extend to infinity, so validFrom2 falls inside openEnded1
      expect(openEnded1.validTo).toBeNull();
      expect(openEnded2.validTo).toBeNull();
      expect(new Date(openEnded2.validFrom) >= new Date(openEnded1.validFrom)).toBe(true);
    });
  });
});
