-- Migration: 005_phase2_3_gl.sql
-- Description: Phase 2.3 General Ledger & Posting Engine Schema Upgrade
-- Implements: Immutability triggers, numeric(20,2) precision, SQL DATE accounting_date,
-- partial unique indexes for source document idempotency & single reversal graph,
-- composite foreign keys for tenant/company isolation, line check constraints.

DO $$
DECLARE
  je_count INTEGER := 0;
  jl_count INTEGER := 0;
BEGIN
  -- Check if preliminary tables exist and have rows
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'journal_entries') THEN
    SELECT COUNT(*) INTO je_count FROM journal_entries;
  END IF;
  
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'journal_lines') THEN
    SELECT COUNT(*) INTO jl_count FROM journal_lines;
  END IF;

  IF je_count = 0 AND jl_count = 0 THEN
    -- PATH A: Safe Drop & Recreate Preliminary Scaffolding
    RAISE NOTICE 'Executing Migration Path A: Empty preliminary tables detected (je=%, jl=%). Recreating tables.', je_count, jl_count;
    
    DROP TABLE IF EXISTS journal_lines CASCADE;
    DROP TABLE IF EXISTS journal_entries CASCADE;

    CREATE TABLE journal_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id VARCHAR(64) NOT NULL,
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
      voucher_number VARCHAR(64),
      fiscal_year_id UUID NOT NULL REFERENCES fiscal_years(id) ON DELETE RESTRICT,
      fiscal_period_id UUID NOT NULL REFERENCES fiscal_periods(id) ON DELETE RESTRICT,
      accounting_date DATE NOT NULL,
      posting_date TIMESTAMP WITH TIME ZONE,
      source_module VARCHAR(64) NOT NULL DEFAULT 'MANUAL',
      source_document_type VARCHAR(64),
      source_document_id VARCHAR(255),
      original_journal_id UUID,
      status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
      total_debit NUMERIC(20,2) NOT NULL DEFAULT 0.00,
      total_credit NUMERIC(20,2) NOT NULL DEFAULT 0.00,
      currency VARCHAR(3) NOT NULL DEFAULT 'INR',
      exchange_rate NUMERIC(12,6) NOT NULL DEFAULT 1.000000,
      narration TEXT,
      created_by VARCHAR(255) NOT NULL,
      posted_by VARCHAR(255),
      posted_at TIMESTAMP WITH TIME ZONE,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );

    CREATE TABLE journal_lines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id VARCHAR(64) NOT NULL,
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
      journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
      account_id UUID NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
      line_sequence INTEGER NOT NULL,
      debit_amount NUMERIC(20,2) NOT NULL DEFAULT 0.00,
      credit_amount NUMERIC(20,2) NOT NULL DEFAULT 0.00,
      currency VARCHAR(3) NOT NULL DEFAULT 'INR',
      exchange_rate NUMERIC(12,6) NOT NULL DEFAULT 1.000000,
      base_debit_amount NUMERIC(20,2) NOT NULL DEFAULT 0.00,
      base_credit_amount NUMERIC(20,2) NOT NULL DEFAULT 0.00,
      narration TEXT,
      party_type VARCHAR(32),
      party_id UUID,
      branch_id UUID,
      department_id UUID,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );

  ELSE
    -- PATH B: Preserving Existing Financial Data via ALTER TABLE
    RAISE NOTICE 'Executing Migration Path B: Existing data detected (je=%, jl=%). Executing non-destructive ALTER statements.', je_count, jl_count;

    ALTER TABLE journal_entries ALTER COLUMN voucher_number DROP NOT NULL;
    ALTER TABLE journal_entries ALTER COLUMN total_debit TYPE NUMERIC(20,2);
    ALTER TABLE journal_entries ALTER COLUMN total_credit TYPE NUMERIC(20,2);
    
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_entries' AND COLUMN_NAME='fiscal_year_id') THEN
      ALTER TABLE journal_entries ADD COLUMN fiscal_year_id UUID REFERENCES fiscal_years(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_entries' AND COLUMN_NAME='fiscal_period_id') THEN
      ALTER TABLE journal_entries ADD COLUMN fiscal_period_id UUID REFERENCES fiscal_periods(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_entries' AND COLUMN_NAME='accounting_date') THEN
      ALTER TABLE journal_entries ADD COLUMN accounting_date DATE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_entries' AND COLUMN_NAME='posting_date') THEN
      ALTER TABLE journal_entries ADD COLUMN posting_date TIMESTAMP WITH TIME ZONE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_entries' AND COLUMN_NAME='source_document_type') THEN
      ALTER TABLE journal_entries ADD COLUMN source_document_type VARCHAR(64);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_entries' AND COLUMN_NAME='original_journal_id') THEN
      ALTER TABLE journal_entries ADD COLUMN original_journal_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_entries' AND COLUMN_NAME='currency') THEN
      ALTER TABLE journal_entries ADD COLUMN currency VARCHAR(3) NOT NULL DEFAULT 'INR';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_entries' AND COLUMN_NAME='exchange_rate') THEN
      ALTER TABLE journal_entries ADD COLUMN exchange_rate NUMERIC(12,6) NOT NULL DEFAULT 1.000000;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_entries' AND COLUMN_NAME='narration') THEN
      ALTER TABLE journal_entries ADD COLUMN narration TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_entries' AND COLUMN_NAME='created_by') THEN
      ALTER TABLE journal_entries ADD COLUMN created_by VARCHAR(255) NOT NULL DEFAULT 'SYSTEM';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_entries' AND COLUMN_NAME='updated_at') THEN
      ALTER TABLE journal_entries ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
    END IF;

    ALTER TABLE journal_lines ALTER COLUMN debit_amount TYPE NUMERIC(20,2);
    ALTER TABLE journal_lines ALTER COLUMN credit_amount TYPE NUMERIC(20,2);
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_lines' AND COLUMN_NAME='company_id') THEN
      ALTER TABLE journal_lines ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_lines' AND COLUMN_NAME='line_sequence') THEN
      ALTER TABLE journal_lines ADD COLUMN line_sequence INTEGER NOT NULL DEFAULT 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_lines' AND COLUMN_NAME='currency') THEN
      ALTER TABLE journal_lines ADD COLUMN currency VARCHAR(3) NOT NULL DEFAULT 'INR';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_lines' AND COLUMN_NAME='exchange_rate') THEN
      ALTER TABLE journal_lines ADD COLUMN exchange_rate NUMERIC(12,6) NOT NULL DEFAULT 1.000000;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_lines' AND COLUMN_NAME='base_debit_amount') THEN
      ALTER TABLE journal_lines ADD COLUMN base_debit_amount NUMERIC(20,2) NOT NULL DEFAULT 0.00;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_lines' AND COLUMN_NAME='base_credit_amount') THEN
      ALTER TABLE journal_lines ADD COLUMN base_credit_amount NUMERIC(20,2) NOT NULL DEFAULT 0.00;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_lines' AND COLUMN_NAME='party_type') THEN
      ALTER TABLE journal_lines ADD COLUMN party_type VARCHAR(32);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_lines' AND COLUMN_NAME='party_id') THEN
      ALTER TABLE journal_lines ADD COLUMN party_id UUID;
    END IF;
  END IF;
END $$;

-- Composite Unique Index on journal_entries for tenant + company + id
CREATE UNIQUE INDEX IF NOT EXISTS idx_je_tenant_comp_id 
  ON journal_entries(tenant_id, company_id, id);

-- Composite Unique Index on journal_entries for voucherNumber
CREATE UNIQUE INDEX IF NOT EXISTS idx_je_tenant_comp_voucher 
  ON journal_entries(tenant_id, company_id, voucher_number);

-- Partial Unique Index for Source Document Idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_je_tenant_comp_src_doc 
  ON journal_entries(tenant_id, company_id, source_module, source_document_type, source_document_id)
  WHERE source_document_id IS NOT NULL;

-- Partial Unique Index for Single Reversal Guarantee
CREATE UNIQUE INDEX IF NOT EXISTS idx_je_tenant_comp_original_journal 
  ON journal_entries(tenant_id, company_id, original_journal_id)
  WHERE original_journal_id IS NOT NULL;

-- Composite Foreign Key for Reversal Relationship
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_je_original_journal') THEN
    ALTER TABLE journal_entries
      ADD CONSTRAINT fk_je_original_journal
      FOREIGN KEY (tenant_id, company_id, original_journal_id)
      REFERENCES journal_entries(tenant_id, company_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Indexes for fiscal period and date lookups
CREATE INDEX IF NOT EXISTS idx_je_tenant_comp_period 
  ON journal_entries(tenant_id, company_id, fiscal_period_id);

CREATE INDEX IF NOT EXISTS idx_je_tenant_comp_date 
  ON journal_entries(tenant_id, company_id, accounting_date);

-- Composite Foreign Key on journal_lines -> journal_entries
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_jl_tenant_comp_journal') THEN
    ALTER TABLE journal_lines
      ADD CONSTRAINT fk_jl_tenant_comp_journal
      FOREIGN KEY (tenant_id, company_id, journal_entry_id)
      REFERENCES journal_entries(tenant_id, company_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Composite Foreign Key on journal_lines -> chart_of_accounts
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_jl_tenant_comp_account') THEN
    ALTER TABLE journal_lines
      ADD CONSTRAINT fk_jl_tenant_comp_account
      FOREIGN KEY (tenant_id, company_id, account_id)
      REFERENCES chart_of_accounts(tenant_id, company_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Index on journal_lines account
CREATE INDEX IF NOT EXISTS idx_jl_tenant_comp_account 
  ON journal_lines(tenant_id, company_id, account_id);

-- CHECK Constraints on journal_lines
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_jl_debit_positive') THEN
    ALTER TABLE journal_lines ADD CONSTRAINT chk_jl_debit_positive CHECK (debit_amount >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_jl_credit_positive') THEN
    ALTER TABLE journal_lines ADD CONSTRAINT chk_jl_credit_positive CHECK (credit_amount >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_jl_debit_credit_xor') THEN
    ALTER TABLE journal_lines ADD CONSTRAINT chk_jl_debit_credit_xor CHECK ((debit_amount > 0 AND credit_amount = 0) OR (debit_amount = 0 AND credit_amount > 0));
  END IF;
END $$;

-- Trigger Function for journal_entries Immutability & Direct SQL Transition Defense
CREATE OR REPLACE FUNCTION trg_prevent_posted_journal_update_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- 1. Prevent UPDATE or DELETE on POSTED journal entries
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    IF OLD.status = 'POSTED' THEN
      RAISE EXCEPTION 'POSTED financial journal entries are strictly immutable and cannot be updated or deleted (Voucher: %). Use reversal journals for corrections.', OLD.voucher_number;
    END IF;
  END IF;

  -- 2. Guard DRAFT -> POSTED transition: Require GLEngine authorized session variable
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'DRAFT' AND NEW.status = 'POSTED' THEN
      IF current_setting('app.posting_authorized', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Direct SQL transition from DRAFT to POSTED is forbidden. Postings must execute through GLEngine.postJournal().';
      END IF;
    END IF;
  END IF;

  -- 3. Return correct PostgreSQL trigger values
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_entries_immutability ON journal_entries;
CREATE TRIGGER trg_journal_entries_immutability
BEFORE UPDATE OR DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION trg_prevent_posted_journal_update_delete();

-- Trigger Function for journal_lines Immutability
CREATE OR REPLACE FUNCTION trg_prevent_posted_line_update_delete()
RETURNS TRIGGER AS $$
DECLARE
  parent_status VARCHAR(32);
BEGIN
  SELECT status INTO parent_status FROM journal_entries WHERE id = OLD.journal_entry_id;
  IF parent_status = 'POSTED' THEN
    RAISE EXCEPTION 'Journal lines associated with POSTED financial entries are strictly immutable.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_lines_immutability ON journal_lines;
CREATE TRIGGER trg_journal_lines_immutability
BEFORE UPDATE OR DELETE ON journal_lines
FOR EACH ROW EXECUTE FUNCTION trg_prevent_posted_line_update_delete();
