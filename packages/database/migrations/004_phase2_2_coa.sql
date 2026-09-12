-- 004_phase2_2_coa.sql
-- Phase 2.2 Chart of Accounts Productionization Migration

-- Safely expand chart_of_accounts columns if not present
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS node_type VARCHAR(16) NOT NULL DEFAULT 'ACCOUNT';
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS account_subtype VARCHAR(64);
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS account_nature VARCHAR(16) NOT NULL DEFAULT 'NORMAL';
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS normal_balance VARCHAR(8) NOT NULL DEFAULT 'DEBIT';
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS is_postable BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS is_control_account BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS control_account_type VARCHAR(32);
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS currency VARCHAR(3);
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS display_order INT NOT NULL DEFAULT 0;
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Drop legacy column is_active if present
ALTER TABLE chart_of_accounts DROP COLUMN IF EXISTS is_active;

-- Composite unique indexes for tenant+company scope & identity
CREATE UNIQUE INDEX IF NOT EXISTS idx_coa_tenant_comp_id ON chart_of_accounts(tenant_id, company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_coa_tenant_comp_code ON chart_of_accounts(tenant_id, company_id, account_code);

-- Performance indexes for hierarchy lookup & account type filtering
CREATE INDEX IF NOT EXISTS idx_coa_tenant_comp_parent ON chart_of_accounts(tenant_id, company_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_coa_tenant_comp_type ON chart_of_accounts(tenant_id, company_id, account_type);

-- Composite Foreign Key ensuring parent_id MUST belong to same tenant and company
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_coa_tenant_comp_parent'
    ) THEN
        ALTER TABLE chart_of_accounts
        ADD CONSTRAINT fk_coa_tenant_comp_parent
        FOREIGN KEY (tenant_id, company_id, parent_id)
        REFERENCES chart_of_accounts(tenant_id, company_id, id)
        ON DELETE RESTRICT;
    END IF;
END $$;
