-- Migration: 016_phase3_6_purchase_requests.sql
-- Phase 3.6 — Procurement Foundation & Purchase Requests

CREATE TABLE IF NOT EXISTS purchase_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
    department_id UUID REFERENCES departments(id) ON DELETE RESTRICT,
    
    request_number VARCHAR(64) NOT NULL,
    request_date VARCHAR(10) NOT NULL,
    required_date VARCHAR(10) NOT NULL,
    
    requester_user_id VARCHAR(64) NOT NULL,
    requester_employee_id VARCHAR(64),
    
    purpose TEXT,
    justification TEXT,
    priority VARCHAR(32) NOT NULL DEFAULT 'NORMAL',
    
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    
    preferred_supplier_id UUID REFERENCES suppliers(id) ON DELETE RESTRICT,
    project_id VARCHAR(64),
    cost_center_id VARCHAR(64),
    
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    estimated_total NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    
    notes TEXT,
    
    submitted_at TIMESTAMPTZ,
    submitted_by VARCHAR(64),
    
    approved_at TIMESTAMPTZ,
    approved_by VARCHAR(64),
    
    rejected_at TIMESTAMPTZ,
    rejected_by VARCHAR(64),
    rejection_reason TEXT,
    
    cancelled_at TIMESTAMPTZ,
    cancelled_by VARCHAR(64),
    cancellation_reason TEXT,
    
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by VARCHAR(64) NOT NULL,
    updated_by VARCHAR(64) NOT NULL,
    
    CONSTRAINT uq_purchase_requests_tenant_company_num UNIQUE (tenant_id, company_id, request_number),
    CONSTRAINT chk_purchase_requests_priority CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
    CONSTRAINT chk_purchase_requests_status CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'ORDERED'))
);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_tenant_comp ON purchase_requests (tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_status ON purchase_requests (tenant_id, company_id, status);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_dept ON purchase_requests (tenant_id, company_id, department_id);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_requester ON purchase_requests (tenant_id, company_id, requester_user_id);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_required_date ON purchase_requests (tenant_id, company_id, required_date);

CREATE TABLE IF NOT EXISTS purchase_request_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_request_id UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    
    product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
    description TEXT NOT NULL,
    
    requested_quantity NUMERIC(18, 4) NOT NULL,
    ordered_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    remaining_quantity NUMERIC(18, 4) NOT NULL,
    
    uom VARCHAR(32) NOT NULL,
    
    estimated_unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    estimated_discount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    estimated_tax NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    estimated_line_total NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    
    required_date VARCHAR(10),
    preferred_supplier_id UUID REFERENCES suppliers(id) ON DELETE RESTRICT,
    specification TEXT,
    notes TEXT,
    
    project_id VARCHAR(64),
    cost_center_id VARCHAR(64),
    
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT uq_purchase_request_lines_num UNIQUE (purchase_request_id, line_number),
    CONSTRAINT chk_pr_lines_requested_qty_pos CHECK (requested_quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_pr_lines_product ON purchase_request_lines (product_id);
