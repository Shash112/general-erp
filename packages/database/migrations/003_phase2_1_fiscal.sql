-- 003_phase2_1_fiscal.sql
-- Phase 2.1 Fiscal Years & Accounting Periods Migration

CREATE TABLE IF NOT EXISTS fiscal_years (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    name VARCHAR(32) NOT NULL,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    is_closed BOOLEAN NOT NULL DEFAULT false,
    closed_at TIMESTAMPTZ,
    closed_by VARCHAR(255),
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fy_tenant_comp_name ON fiscal_years(tenant_id, company_id, name);

-- Drop legacy table if exists from 001, then create full phase 2.1 schema
DROP TABLE IF EXISTS fiscal_periods CASCADE;

CREATE TABLE IF NOT EXISTS fiscal_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    fiscal_year_id UUID NOT NULL REFERENCES fiscal_years(id) ON DELETE RESTRICT,
    period_number INT NOT NULL,
    period_type VARCHAR(32) NOT NULL DEFAULT 'STANDARD',
    name VARCHAR(32) NOT NULL,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    is_closed BOOLEAN NOT NULL DEFAULT false,
    closed_at TIMESTAMPTZ,
    closed_by VARCHAR(255),
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fp_tenant_fy_num ON fiscal_periods(tenant_id, fiscal_year_id, period_number);
