-- Migration 019: Phase 3.9 Supplier Billing, AP Integration & Three-Way Matching

ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS billed_quantity numeric(18, 4) NOT NULL DEFAULT '0.0000';
ALTER TABLE goods_receipt_lines ADD COLUMN IF NOT EXISTS billed_quantity numeric(18, 4) NOT NULL DEFAULT '0.0000';

CREATE TABLE IF NOT EXISTS supplier_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,

  bill_number VARCHAR(64) NOT NULL,
  supplier_invoice_number VARCHAR(64) NOT NULL,
  supplier_invoice_date VARCHAR(10) NOT NULL,

  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  primary_grn_id UUID REFERENCES goods_receipts(id) ON DELETE RESTRICT,

  bill_date VARCHAR(10) NOT NULL,
  due_date VARCHAR(10) NOT NULL,

  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  exchange_rate NUMERIC(12, 6) NOT NULL DEFAULT '1.000000',

  payment_terms_days INTEGER DEFAULT 30,

  supplier_billing_address TEXT,
  receiving_address TEXT,

  subtotal NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  discount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  taxable_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  tax_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  rounding NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  grand_total NUMERIC(20, 2) NOT NULL DEFAULT '0.00',

  match_status VARCHAR(32) NOT NULL DEFAULT 'UNMATCHED',
  match_override_reason TEXT,
  match_override_by VARCHAR(255),
  match_override_at TIMESTAMPTZ,

  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',

  ap_document_id UUID REFERENCES ap_documents(id) ON DELETE RESTRICT,
  ap_open_item_id UUID REFERENCES ap_open_items(id) ON DELETE RESTRICT,
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,

  posted_at TIMESTAMPTZ,
  posted_by VARCHAR(255),

  cancelled_at TIMESTAMPTZ,
  cancelled_by VARCHAR(255),
  cancellation_reason TEXT,

  remarks TEXT,

  version INTEGER NOT NULL DEFAULT 1,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by VARCHAR(255) NOT NULL,
  updated_by VARCHAR(255) NOT NULL,

  CONSTRAINT uq_supplier_bills_tenant_company_num UNIQUE (tenant_id, company_id, bill_number),
  CONSTRAINT uq_supplier_bills_dup_invoice UNIQUE (tenant_id, company_id, supplier_id, supplier_invoice_number),
  CONSTRAINT chk_sb_status CHECK (status IN ('DRAFT', 'SUBMITTED', 'MATCHED', 'MATCH_EXCEPTION', 'APPROVED', 'POSTED', 'CANCELLED')),
  CONSTRAINT chk_sb_match_status CHECK (match_status IN ('UNMATCHED', 'MATCHING', 'MATCHED', 'EXCEPTION', 'RESOLVED'))
);

CREATE INDEX IF NOT EXISTS idx_supplier_bills_tenant_comp ON supplier_bills(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_po ON supplier_bills(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_grn ON supplier_bills(primary_grn_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_supplier ON supplier_bills(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_status ON supplier_bills(tenant_id, company_id, status);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_match_status ON supplier_bills(tenant_id, company_id, match_status);

CREATE TABLE IF NOT EXISTS supplier_bill_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_bill_id UUID NOT NULL REFERENCES supplier_bills(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,

  purchase_order_line_id UUID REFERENCES purchase_order_lines(id) ON DELETE RESTRICT,
  goods_receipt_line_id UUID REFERENCES goods_receipt_lines(id) ON DELETE RESTRICT,
  product_id UUID REFERENCES products(id) ON DELETE RESTRICT,

  description_snapshot TEXT NOT NULL,
  product_code_snapshot VARCHAR(64),
  uom VARCHAR(32) NOT NULL,

  billed_quantity NUMERIC(18, 4) NOT NULL,
  unit_price NUMERIC(20, 2) NOT NULL,

  discount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  discount_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',

  taxable_amount NUMERIC(20, 2) NOT NULL,
  tax_category_id UUID,
  tax_rate_percent NUMERIC(9, 6) NOT NULL DEFAULT '0.000000',
  cgst_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  sgst_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  igst_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  utgst_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  cess_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  tax_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  line_total NUMERIC(20, 2) NOT NULL,

  expense_account_id UUID,

  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_supplier_bill_lines_num UNIQUE (supplier_bill_id, line_number),
  CONSTRAINT chk_sb_lines_billed_qty_pos CHECK (billed_quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_sb_lines_po_line ON supplier_bill_lines(purchase_order_line_id);
CREATE INDEX IF NOT EXISTS idx_sb_lines_grn_line ON supplier_bill_lines(goods_receipt_line_id);
CREATE INDEX IF NOT EXISTS idx_sb_lines_product ON supplier_bill_lines(product_id);

CREATE TABLE IF NOT EXISTS supplier_bill_match_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,

  supplier_bill_id UUID NOT NULL REFERENCES supplier_bills(id) ON DELETE CASCADE,
  supplier_bill_line_id UUID REFERENCES supplier_bill_lines(id) ON DELETE CASCADE,

  exception_type VARCHAR(64) NOT NULL,
  severity VARCHAR(32) NOT NULL DEFAULT 'MEDIUM',

  expected_value VARCHAR(128) NOT NULL,
  actual_value VARCHAR(128) NOT NULL,
  variance VARCHAR(128) NOT NULL,
  configured_tolerance VARCHAR(128) NOT NULL,

  reason TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',

  resolved_by VARCHAR(255),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_sb_exception_status CHECK (status IN ('OPEN', 'OVERRIDDEN', 'RESOLVED', 'REJECTED'))
);

CREATE INDEX IF NOT EXISTS idx_sb_exceptions_bill ON supplier_bill_match_exceptions(supplier_bill_id);
CREATE INDEX IF NOT EXISTS idx_sb_exceptions_status ON supplier_bill_match_exceptions(tenant_id, company_id, status);
