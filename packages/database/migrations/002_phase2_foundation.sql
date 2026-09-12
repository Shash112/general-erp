-- 002_phase2_foundation.sql
-- Phase 2.0 Foundation Productionization & Numbering Sequences Migration

CREATE TABLE IF NOT EXISTS numbering_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    company_id VARCHAR(64) NOT NULL,
    document_type VARCHAR(64) NOT NULL,
    fiscal_year VARCHAR(32) NOT NULL,
    branch_code VARCHAR(32) NOT NULL DEFAULT 'DEFAULT',
    current_sequence INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_num_seq_tenant_doc 
ON numbering_sequences(tenant_id, company_id, document_type, fiscal_year, branch_code);
