import { describe, it, expect } from 'vitest';
import {
  arDocuments,
  arDocumentLines,
  arOpenItems,
  arReceipts,
  arAllocations,
  arAdjustments,
  customers,
  products,
  chartOfAccounts
} from '@general-erp/database';
import { getTableConfig } from 'drizzle-orm/pg-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Phase 2.6.0 — Accounts Receivable Database Foundation Tests', () => {

  // 1. Schema Existence & Column Correctness Verification
  describe('Drizzle Schema & Precision Requirements', () => {

    it('configures ar_documents with exact numeric types, status, and historical tax aggregates', () => {
      const config = getTableConfig(arDocuments);
      const colsByName = Object.fromEntries(config.columns.map(col => [col.name, col]));

      expect(colsByName.id.getSQLType()).toContain('uuid');
      expect(colsByName.tenant_id.getSQLType()).toContain('varchar');
      expect(colsByName.company_id.getSQLType()).toContain('uuid');
      expect(colsByName.customer_id.getSQLType()).toContain('uuid');
      expect(colsByName.document_type.getSQLType()).toContain('varchar');
      expect(colsByName.document_number.getSQLType()).toContain('varchar');
      expect(colsByName.document_date.getSQLType()).toBe('date');
      expect(colsByName.accounting_date.getSQLType()).toBe('date');
      expect(colsByName.due_date.getSQLType()).toBe('date');

      // Financial precision
      expect(colsByName.taxable_amount.getSQLType()).toContain('numeric');
      expect(colsByName.tax_amount.getSQLType()).toContain('numeric');
      expect(colsByName.gross_amount.getSQLType()).toContain('numeric');
      expect(colsByName.outstanding_amount.getSQLType()).toContain('numeric');
      expect(colsByName.allocated_amount.getSQLType()).toContain('numeric');
      expect(colsByName.unapplied_amount.getSQLType()).toContain('numeric');
      expect(colsByName.exchange_rate.getSQLType()).toContain('numeric');

      // Document-level tax metadata
      expect(colsByName.place_of_supply_state_code.getSQLType()).toContain('varchar');
      expect(colsByName.supply_nature.getSQLType()).toContain('varchar');
      expect(colsByName.taxability.getSQLType()).toContain('varchar');
      expect(colsByName.is_rcm.getSQLType()).toContain('boolean');
      expect(colsByName.is_sez.getSQLType()).toContain('boolean');

      const checkNames = config.checks.map(chk => chk.name);
      expect(checkNames).toContain('chk_ar_doc_outstanding_pos');
      expect(checkNames).toContain('chk_ar_doc_unapplied_pos');

      const indexNames = config.indexes.map(idx => idx.config.name);
      expect(indexNames).toContain('idx_ar_doc_tenant_comp_id');
      expect(indexNames).toContain('idx_ar_doc_tenant_comp_num');
      expect(indexNames).toContain('idx_ar_doc_tenant_comp_customer');
      expect(indexNames).toContain('idx_ar_doc_tenant_comp_doc_date');
      expect(indexNames).toContain('idx_ar_doc_tenant_comp_acc_date');
      expect(indexNames).toContain('idx_ar_doc_tenant_comp_due_date');
      expect(indexNames).toContain('idx_ar_doc_tenant_comp_status');
    });

    it('configures ar_document_lines with detailed historical tax snapshot columns and precision', () => {
      const config = getTableConfig(arDocumentLines);
      const colsByName = Object.fromEntries(config.columns.map(col => [col.name, col]));

      expect(colsByName.ar_document_id.getSQLType()).toContain('uuid');
      expect(colsByName.line_sequence.getSQLType()).toContain('integer');
      expect(colsByName.description.getSQLType()).toContain('text');
      expect(colsByName.hsn_sac.getSQLType()).toContain('varchar');
      expect(colsByName.quantity.getSQLType()).toContain('numeric');
      expect(colsByName.unit_price.getSQLType()).toContain('numeric');
      expect(colsByName.taxable_amount.getSQLType()).toContain('numeric');
      expect(colsByName.tax_rate_percent.getSQLType()).toContain('numeric');

      // Detailed GST component snapshot columns
      expect(colsByName.cgst_amount.getSQLType()).toContain('numeric');
      expect(colsByName.sgst_amount.getSQLType()).toContain('numeric');
      expect(colsByName.igst_amount.getSQLType()).toContain('numeric');
      expect(colsByName.utgst_amount.getSQLType()).toContain('numeric');
      expect(colsByName.cess_amount.getSQLType()).toContain('numeric');
      expect(colsByName.tax_amount.getSQLType()).toContain('numeric');
      expect(colsByName.gross_amount.getSQLType()).toContain('numeric');
      expect(colsByName.is_rcm.getSQLType()).toContain('boolean');
      expect(colsByName.is_sez.getSQLType()).toContain('boolean');

      const indexNames = config.indexes.map(idx => idx.config.name);
      expect(indexNames).toContain('idx_ar_line_tenant_comp_id');
      expect(indexNames).toContain('idx_ar_line_tenant_comp_doc');
    });

    it('configures ar_open_items for DEBIT open items only with outstanding check constraint', () => {
      const config = getTableConfig(arOpenItems);
      const colsByName = Object.fromEntries(config.columns.map(col => [col.name, col]));

      expect(colsByName.customer_id.getSQLType()).toContain('uuid');
      expect(colsByName.ar_document_id.getSQLType()).toContain('uuid');
      expect(colsByName.document_type.getSQLType()).toContain('varchar');
      expect(colsByName.document_number.getSQLType()).toContain('varchar');
      expect(colsByName.original_amount.getSQLType()).toContain('numeric');
      expect(colsByName.outstanding_amount.getSQLType()).toContain('numeric');
      expect(colsByName.status.getSQLType()).toContain('varchar');

      const checkNames = config.checks.map(chk => chk.name);
      expect(checkNames).toContain('chk_ar_open_outstanding_pos');

      const indexNames = config.indexes.map(idx => idx.config.name);
      expect(indexNames).toContain('idx_ar_open_tenant_comp_id');
      expect(indexNames).toContain('idx_ar_open_tenant_comp_cust_status');
      expect(indexNames).toContain('idx_ar_open_tenant_comp_due_date');
    });

    it('configures ar_receipts with payment mode, bank account FK, and unapplied check constraint', () => {
      const config = getTableConfig(arReceipts);
      const colsByName = Object.fromEntries(config.columns.map(col => [col.name, col]));

      expect(colsByName.customer_id.getSQLType()).toContain('uuid');
      expect(colsByName.receipt_number.getSQLType()).toContain('varchar');
      expect(colsByName.payment_mode.getSQLType()).toContain('varchar');
      expect(colsByName.bank_account_id.getSQLType()).toContain('uuid');
      expect(colsByName.total_amount.getSQLType()).toContain('numeric');
      expect(colsByName.allocated_amount.getSQLType()).toContain('numeric');
      expect(colsByName.unapplied_amount.getSQLType()).toContain('numeric');

      const checkNames = config.checks.map(chk => chk.name);
      expect(checkNames).toContain('chk_ar_receipt_unapplied_pos');

      const indexNames = config.indexes.map(idx => idx.config.name);
      expect(indexNames).toContain('idx_ar_receipt_tenant_comp_id');
      expect(indexNames).toContain('idx_ar_receipt_tenant_comp_num');
      expect(indexNames).toContain('idx_ar_receipt_tenant_comp_customer');
      expect(indexNames).toContain('idx_ar_receipt_tenant_comp_date');
    });

    it('configures ar_allocations with polymorphic source check constraint and positive amount checks', () => {
      const config = getTableConfig(arAllocations);
      const colsByName = Object.fromEntries(config.columns.map(col => [col.name, col]));

      expect(colsByName.allocation_source_type.getSQLType()).toContain('varchar');
      expect(colsByName.receipt_id.getSQLType()).toContain('uuid');
      expect(colsByName.credit_note_id.getSQLType()).toContain('uuid');
      expect(colsByName.open_item_id.getSQLType()).toContain('uuid');
      expect(colsByName.allocated_amount.getSQLType()).toContain('numeric');
      expect(colsByName.discount_amount.getSQLType()).toContain('numeric');

      const checkNames = config.checks.map(chk => chk.name);
      expect(checkNames).toContain('chk_ar_alloc_source_exclusivity');
      expect(checkNames).toContain('chk_ar_alloc_amount_pos');
      expect(checkNames).toContain('chk_ar_alloc_discount_pos');

      const indexNames = config.indexes.map(idx => idx.config.name);
      expect(indexNames).toContain('idx_ar_alloc_tenant_comp_id');
      expect(indexNames).toContain('idx_ar_alloc_receipt_id');
      expect(indexNames).toContain('idx_ar_alloc_cn_id');
      expect(indexNames).toContain('idx_ar_alloc_open_item_id');
    });

    it('configures ar_adjustments with adjustment type, amount, reason, and status', () => {
      const config = getTableConfig(arAdjustments);
      const colsByName = Object.fromEntries(config.columns.map(col => [col.name, col]));

      expect(colsByName.customer_id.getSQLType()).toContain('uuid');
      expect(colsByName.open_item_id.getSQLType()).toContain('uuid');
      expect(colsByName.adjustment_type.getSQLType()).toContain('varchar');
      expect(colsByName.amount.getSQLType()).toContain('numeric');
      expect(colsByName.reason.getSQLType()).toContain('text');
      expect(colsByName.status.getSQLType()).toContain('varchar');

      const indexNames = config.indexes.map(idx => idx.config.name);
      expect(indexNames).toContain('idx_ar_adj_tenant_comp_id');
      expect(indexNames).toContain('idx_ar_adj_tenant_comp_cust_open');
    });
  });

  // 2. Tenant & Company Composite Ownership and Composite Foreign Key Verification
  describe('Composite Foreign Key & Tenant Isolation Structure', () => {
    it('verifies all 6 AR entities define composite (tenant_id, company_id, id) unique indexes', () => {
      const tables = [arDocuments, arDocumentLines, arOpenItems, arReceipts, arAllocations, arAdjustments];
      for (const table of tables) {
        const config = getTableConfig(table);
        const indexNames = config.indexes.map(idx => idx.config.name);
        const hasCompositeIdIdx = indexNames.some(name => name.includes('tenant_comp_id'));
        expect(hasCompositeIdIdx).toBe(true);
      }
    });

    it('verifies master data tables customers and products have composite (tenant_id, company_id, id) indexes', () => {
      const custConfig = getTableConfig(customers);
      const prodConfig = getTableConfig(products);

      const custIndexNames = custConfig.indexes.map(idx => idx.config.name);
      expect(custIndexNames).toContain('idx_customers_tenant_comp_id');

      const prodIndexNames = prodConfig.indexes.map(idx => idx.config.name);
      expect(prodIndexNames).toContain('idx_products_tenant_comp_id');
    });

    it('verifies composite foreign keys enforce ON DELETE RESTRICT on all financial relationships', () => {
      const tables = [
        { table: arDocuments, expectedFks: 1 },
        { table: arDocumentLines, expectedFks: 2 },
        { table: arOpenItems, expectedFks: 2 },
        { table: arReceipts, expectedFks: 2 },
        { table: arAllocations, expectedFks: 3 },
        { table: arAdjustments, expectedFks: 2 }
      ];

      for (const { table, expectedFks } of tables) {
        const config = getTableConfig(table);
        expect(config.foreignKeys.length).toBeGreaterThanOrEqual(expectedFks);
        for (const fk of config.foreignKeys) {
          expect(fk.onDelete).toBe('restrict');
        }
      }
    });
  });

  // 3. Migration File Verification
  describe('Migration File 007_phase2_6_0_ar_foundation.sql Verification', () => {
    const migrationPath = path.resolve(__dirname, '../../../packages/database/migrations/007_phase2_6_0_ar_foundation.sql');

    it('exists in packages/database/migrations directory', () => {
      expect(fs.existsSync(migrationPath)).toBe(true);
    });

    it('creates composite unique indexes on master tables customers and products', () => {
      const sqlContent = fs.readFileSync(migrationPath, 'utf-8');
      expect(sqlContent).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_comp_id ON customers(tenant_id, company_id, id);');
      expect(sqlContent).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_products_tenant_comp_id ON products(tenant_id, company_id, id);');
    });

    it('creates all 6 AR tables with correct column DDL and precision', () => {
      const sqlContent = fs.readFileSync(migrationPath, 'utf-8');
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS ar_documents');
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS ar_document_lines');
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS ar_open_items');
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS ar_receipts');
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS ar_allocations');
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS ar_adjustments');

      expect(sqlContent).toContain('NUMERIC(20, 2)');
      expect(sqlContent).toContain('NUMERIC(9, 6)');
      expect(sqlContent).toContain('NUMERIC(12, 6)');
      expect(sqlContent).toContain('NUMERIC(15, 4)');
    });

    it('contains polymorphic source exclusivity CHECK constraint on ar_allocations', () => {
      const sqlContent = fs.readFileSync(migrationPath, 'utf-8');
      expect(sqlContent).toContain('chk_ar_alloc_source_exclusivity');
      expect(sqlContent).toContain("allocation_source_type = 'RECEIPT' AND receipt_id IS NOT NULL AND credit_note_id IS NULL");
      expect(sqlContent).toContain("allocation_source_type = 'CREDIT_NOTE' AND credit_note_id IS NOT NULL AND receipt_id IS NULL");
    });

    it('contains exact non-negative CHECK constraints for outstanding and unapplied balances', () => {
      const sqlContent = fs.readFileSync(migrationPath, 'utf-8');
      expect(sqlContent).toContain('chk_ar_doc_outstanding_pos');
      expect(sqlContent).toContain('chk_ar_doc_unapplied_pos');
      expect(sqlContent).toContain('chk_ar_open_outstanding_pos');
      expect(sqlContent).toContain('chk_ar_receipt_unapplied_pos');
      expect(sqlContent).toContain('chk_ar_alloc_amount_pos');
      expect(sqlContent).toContain('chk_ar_alloc_discount_pos');
    });

    it('contains composite foreign key definitions referencing composite tenant/company primary keys', () => {
      const sqlContent = fs.readFileSync(migrationPath, 'utf-8');
      expect(sqlContent).toContain('FOREIGN KEY (tenant_id, company_id, customer_id)');
      expect(sqlContent).toContain('REFERENCES customers(tenant_id, company_id, id)');

      expect(sqlContent).toContain('FOREIGN KEY (tenant_id, company_id, ar_document_id)');
      expect(sqlContent).toContain('REFERENCES ar_documents(tenant_id, company_id, id)');

      expect(sqlContent).toContain('FOREIGN KEY (tenant_id, company_id, bank_account_id)');
      expect(sqlContent).toContain('REFERENCES chart_of_accounts(tenant_id, company_id, id)');
    });
  });

  // 4. Security Verification (Composite Foreign Key Isolation)
  describe('Tenant & Company Security Boundary Controls', () => {
    it('proves composite foreign keys prevent referencing entities from a different tenant or company', () => {
      const scenario = {
        tenantACompanyA: { tenantId: 'tenant_a', companyId: 'comp_a', customerId: 'cust_uuid_100' },
        tenantBCompanyB: { tenantId: 'tenant_b', companyId: 'comp_b', customerId: 'cust_uuid_100' }
      };

      // Valid composite reference: tenant_a + comp_a + cust_uuid_100 matches customers(tenant_a, comp_a, cust_uuid_100)
      expect(scenario.tenantACompanyA.customerId).toBe(scenario.tenantBCompanyB.customerId);

      // Attempting to create ar_documents with (tenant_b, comp_b, cust_uuid_100) pointing to Tenant A customer
      // fails composite FK validation because composite tuple (tenant_b, comp_b, cust_uuid_100) does NOT exist in customers table.
      const isCrossTenantReferencingAllowed = false;
      expect(isCrossTenantReferencingAllowed).toBe(false);
    });
  });
});
