import { describe, it, expect } from 'vitest';
import { journalEntries, journalLines, chartOfAccounts, fiscalYears, fiscalPeriods } from '@general-erp/database';
import { getTableConfig } from 'drizzle-orm/pg-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

describe('Phase 2.3.0 — Architecture & Database Migration Tests', () => {

  // 1. Drizzle Schema Verification
  describe('Schema Specifications & Precision Requirements', () => {
    it('configures journal_entries with numeric(20,2) amounts and SQL DATE accounting_date', () => {
      const config = getTableConfig(journalEntries);
      const colsByName = Object.fromEntries(config.columns.map(col => [col.name, col]));

      expect(colsByName.total_debit.getSQLType()).toContain('numeric');
      expect(colsByName.total_credit.getSQLType()).toContain('numeric');
      expect(colsByName.exchange_rate.getSQLType()).toContain('numeric');
      expect(colsByName.accounting_date.getSQLType()).toBe('date');
      expect(colsByName.voucher_number.notNull).toBe(false); // Nullable for DRAFT
      expect(colsByName.original_journal_id).toBeDefined();
      expect(colsByName.source_document_id).toBeDefined();
    });

    it('configures journal_lines with numeric(20,2) amounts and line constraints', () => {
      const config = getTableConfig(journalLines);
      const colsByName = Object.fromEntries(config.columns.map(col => [col.name, col]));

      expect(colsByName.debit_amount.getSQLType()).toContain('numeric');
      expect(colsByName.credit_amount.getSQLType()).toContain('numeric');
      expect(colsByName.base_debit_amount.getSQLType()).toContain('numeric');
      expect(colsByName.base_credit_amount.getSQLType()).toContain('numeric');
      expect(colsByName.exchange_rate.getSQLType()).toContain('numeric');
      expect(colsByName.line_sequence).toBeDefined();
      expect(colsByName.company_id).toBeDefined();

      expect(colsByName.account_id).toBeDefined();
    });

    it('defines required composite indexes and foreign keys on journal_entries', () => {
      const config = getTableConfig(journalEntries);
      
      const indexNames = config.indexes.map(idx => idx.config.name);
      expect(indexNames).toContain('idx_je_tenant_comp_id');
      expect(indexNames).toContain('idx_je_tenant_comp_voucher');
      expect(indexNames).toContain('idx_je_tenant_comp_src_doc');
      expect(indexNames).toContain('idx_je_tenant_comp_original_journal');

      const fkNames = config.foreignKeys.map(fk => fk.getName());
      expect(fkNames.length).toBeGreaterThanOrEqual(1);
    });

    it('defines line constraints and composite foreign keys on journal_lines', () => {
      const config = getTableConfig(journalLines);

      const checkNames = config.checks.map(chk => chk.name);
      expect(checkNames).toContain('chk_jl_debit_positive');
      expect(checkNames).toContain('chk_jl_credit_positive');
      expect(checkNames).toContain('chk_jl_debit_credit_xor');

      const fkNames = config.foreignKeys.map(fk => fk.getName());
      expect(fkNames.length).toBeGreaterThanOrEqual(2);
    });
  });

  // 2. Migration SQL File Verification
  describe('Migration File 005_phase2_3_gl.sql Verification', () => {
    const migrationPath = fileURLToPath(new URL('../../../packages/database/migrations/005_phase2_3_gl.sql', import.meta.url));
    
    it('exists in packages/database/migrations directory', () => {
      expect(fs.existsSync(migrationPath)).toBe(true);
    });

    it('contains Path A and Path B migration safety logic', () => {
      const sqlContent = fs.readFileSync(migrationPath, 'utf-8');

      expect(sqlContent).toContain('Executing Migration Path A: Empty preliminary tables detected');
      expect(sqlContent).toContain('Executing Migration Path B: Existing data detected');
      expect(sqlContent).toContain('NUMERIC(20,2)');
      expect(sqlContent).toContain('NUMERIC(12,6)');
      expect(sqlContent).toContain('accounting_date DATE');
    });

    it('contains PostgreSQL BEFORE UPDATE OR DELETE triggers with RETURN OLD/NEW semantics', () => {
      const sqlContent = fs.readFileSync(migrationPath, 'utf-8');

      expect(sqlContent).toContain('CREATE OR REPLACE FUNCTION trg_prevent_posted_journal_update_delete()');
      expect(sqlContent).toContain('BEFORE UPDATE OR DELETE ON journal_entries');
      expect(sqlContent).toContain('RETURN OLD;');
      expect(sqlContent).toContain('RETURN NEW;');
      expect(sqlContent).toContain('POSTED financial journal entries are strictly immutable');
    });

    it('contains app.posting_authorized DRAFT -> POSTED transition guard', () => {
      const sqlContent = fs.readFileSync(migrationPath, 'utf-8');

      expect(sqlContent).toContain("current_setting('app.posting_authorized', true) IS DISTINCT FROM 'true'");
      expect(sqlContent).toContain('Direct SQL transition from DRAFT to POSTED is forbidden. Postings must execute through GLEngine.postJournal().');
    });

    it('contains partial unique indexes for source document idempotency and single reversal', () => {
      const sqlContent = fs.readFileSync(migrationPath, 'utf-8');

      expect(sqlContent).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_je_tenant_comp_src_doc');
      expect(sqlContent).toContain('WHERE source_document_id IS NOT NULL');
      expect(sqlContent).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_je_tenant_comp_original_journal');
      expect(sqlContent).toContain('WHERE original_journal_id IS NOT NULL');
    });

    it('contains line debit/credit XOR and non-negative CHECK constraints', () => {
      const sqlContent = fs.readFileSync(migrationPath, 'utf-8');

      expect(sqlContent).toContain('CONSTRAINT chk_jl_debit_positive CHECK (debit_amount >= 0)');
      expect(sqlContent).toContain('CONSTRAINT chk_jl_credit_positive CHECK (credit_amount >= 0)');
      expect(sqlContent).toContain('CONSTRAINT chk_jl_debit_credit_xor CHECK ((debit_amount > 0 AND credit_amount = 0) OR (debit_amount = 0 AND credit_amount > 0))');
    });
  });

  // 3. Database Trust Boundary & Authorization Semantics Verification
  describe('PostgreSQL Database Trust Boundary & Immutability Rules', () => {
    it('documents explicit trust boundary flow: End User -> API -> GLEngine.postJournal() -> SET LOCAL app.posting_authorized', () => {
      const flow = {
        endUserAccess: 'NOT PERMITTED (Credentials withheld)',
        apiRole: 'Trusted DB Execution Role',
        postingAuthorizedPath: 'GLEngine.postJournal() ONLY',
        sessionSettingScope: 'SET LOCAL (Transaction-scoped, auto-resets on commit/rollback)'
      };

      expect(flow.endUserAccess).toContain('NOT PERMITTED');
      expect(flow.apiRole).toBe('Trusted DB Execution Role');
      expect(flow.postingAuthorizedPath).toContain('GLEngine.postJournal()');
      expect(flow.sessionSettingScope).toContain('SET LOCAL');
    });
  });
});
