-- Phase 2.5.0 — Tax Engine Schema & Database Foundation Migration

-- 1. Enable btree_gist extension for temporal range exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. Tax Categories Table
CREATE TABLE IF NOT EXISTS tax_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_cat_tenant_comp_id ON tax_categories (tenant_id, company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_cat_tenant_comp_code ON tax_categories (tenant_id, company_id, code);

-- 3. HSN / SAC Codes Master Table
CREATE TABLE IF NOT EXISTS hsn_sac_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    code VARCHAR(10) NOT NULL,
    description TEXT NOT NULL,
    type VARCHAR(10) NOT NULL,
    default_tax_category_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_hsn_sac_type CHECK (type IN ('HSN', 'SAC')),
    CONSTRAINT fk_hsn_sac_tenant_comp_cat FOREIGN KEY (tenant_id, company_id, default_tax_category_id)
        REFERENCES tax_categories (tenant_id, company_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hsn_sac_tenant_comp_id ON hsn_sac_codes (tenant_id, company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hsn_sac_tenant_comp_code ON hsn_sac_codes (tenant_id, company_id, code);

-- 4. Tax Rates Table (Effective-dated with numeric(9,6) precision)
CREATE TABLE IF NOT EXISTS tax_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    tax_category_id UUID NOT NULL,
    rate_type VARCHAR(20) NOT NULL,
    rate_percent NUMERIC(9, 6) NOT NULL,
    valid_from DATE NOT NULL,
    valid_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_tax_rates_type CHECK (rate_type IN ('CGST', 'SGST', 'IGST', 'UTGST', 'CESS')),
    CONSTRAINT chk_tax_rates_percent_non_negative CHECK (rate_percent >= 0),
    CONSTRAINT chk_tax_rates_validity_range CHECK (valid_to IS NULL OR valid_to >= valid_from),
    CONSTRAINT fk_tax_rates_tenant_comp_cat FOREIGN KEY (tenant_id, company_id, tax_category_id)
        REFERENCES tax_categories (tenant_id, company_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_rates_tenant_comp_id ON tax_rates (tenant_id, company_id, id);
CREATE INDEX IF NOT EXISTS idx_tax_rates_tenant_comp_cat ON tax_rates (tenant_id, company_id, tax_category_id);

-- PostgreSQL Exclusion Constraint: Temporal Range Overlap Prevention
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ex_tax_rates_no_overlap'
    ) THEN
        ALTER TABLE tax_rates ADD CONSTRAINT ex_tax_rates_no_overlap EXCLUDE USING gist (
            tenant_id WITH =,
            company_id WITH =,
            tax_category_id WITH =,
            rate_type WITH =,
            daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[]') WITH &&
        );
    END IF;
END $$;

-- 5. Tax Rules Table
CREATE TABLE IF NOT EXISTS tax_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    tax_category_id UUID,
    hsn_sac_code_id UUID,
    supply_type VARCHAR(32) NOT NULL DEFAULT 'ALL',
    taxability VARCHAR(20) NOT NULL DEFAULT 'TAXABLE',
    is_rcm BOOLEAN NOT NULL DEFAULT false,
    is_sez BOOLEAN NOT NULL DEFAULT false,
    priority INTEGER NOT NULL DEFAULT 10,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    valid_from DATE NOT NULL,
    valid_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_tax_rules_taxability CHECK (taxability IN ('TAXABLE', 'EXEMPT', 'NIL_RATED', 'NON_GST')),
    CONSTRAINT chk_tax_rules_validity_range CHECK (valid_to IS NULL OR valid_to >= valid_from),
    CONSTRAINT fk_tax_rules_tenant_comp_cat FOREIGN KEY (tenant_id, company_id, tax_category_id)
        REFERENCES tax_categories (tenant_id, company_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_tax_rules_tenant_comp_hsn FOREIGN KEY (tenant_id, company_id, hsn_sac_code_id)
        REFERENCES hsn_sac_codes (tenant_id, company_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_rules_tenant_comp_id ON tax_rules (tenant_id, company_id, id);
