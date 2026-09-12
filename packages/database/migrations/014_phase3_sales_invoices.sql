-- Phase 3.4 — Sales Invoicing + AR + Accounting Integration Schema Migration
-- Authoritative sales_invoices and sales_invoice_lines tables

CREATE TABLE IF NOT EXISTS sales_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id),
  branch_id UUID REFERENCES branches(id),
  invoice_number VARCHAR(64) NOT NULL,
  sales_order_id UUID REFERENCES sales_orders(id) ON DELETE RESTRICT,
  sales_order_number VARCHAR(64),
  sales_delivery_id UUID REFERENCES sales_deliveries(id) ON DELETE RESTRICT,
  sales_delivery_number VARCHAR(64),
  customer_id UUID NOT NULL REFERENCES customers(id),
  invoice_date VARCHAR(10) NOT NULL,
  due_date VARCHAR(10) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  exchange_rate NUMERIC(18, 6) NOT NULL DEFAULT 1.000000,
  billing_address_id UUID NOT NULL REFERENCES commercial_addresses(id),
  billing_address_snapshot JSONB NOT NULL,
  shipping_address_id UUID NOT NULL REFERENCES commercial_addresses(id),
  shipping_address_snapshot JSONB NOT NULL,
  contact_id UUID REFERENCES commercial_contacts(id),
  contact_snapshot JSONB,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  notes TEXT,
  terms_and_conditions TEXT,
  subtotal_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  header_discount_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  discount_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  taxable_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  cgst_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  sgst_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  igst_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  tax_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  total_amount_base NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  ar_document_id VARCHAR(64),
  ar_open_item_id VARCHAR(64),
  journal_entry_id VARCHAR(64),
  posted_at TIMESTAMP,
  posted_by UUID REFERENCES users(id),
  cancelled_at TIMESTAMP,
  cancelled_by UUID REFERENCES users(id),
  cancellation_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,

  CONSTRAINT uq_sales_invoice_tenant_company_num UNIQUE (tenant_id, company_id, invoice_number),
  CONSTRAINT chk_sales_invoice_status CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'PARTIALLY_SETTLED', 'SETTLED', 'CANCELLED', 'REVERSED'))
);

CREATE INDEX IF NOT EXISTS idx_sales_invoice_order ON sales_invoices(tenant_id, company_id, sales_order_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_customer ON sales_invoices(tenant_id, company_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_status ON sales_invoices(tenant_id, company_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_date ON sales_invoices(tenant_id, company_id, invoice_date);

CREATE TABLE IF NOT EXISTS sales_invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  sales_order_line_id UUID REFERENCES sales_order_lines(id) ON DELETE RESTRICT,
  sales_delivery_line_id UUID REFERENCES sales_delivery_lines(id) ON DELETE RESTRICT,
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL,
  line_number INTEGER NOT NULL,
  product_id UUID NOT NULL REFERENCES products(id),
  product_code_snapshot VARCHAR(64) NOT NULL,
  product_name_snapshot VARCHAR(255) NOT NULL,
  description TEXT,
  uom VARCHAR(32) NOT NULL REFERENCES uom_definitions(code),
  invoiced_quantity NUMERIC(18, 4) NOT NULL,
  unit_price NUMERIC(18, 4) NOT NULL,
  discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  discount_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  allocated_header_discount_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  gross_amount NUMERIC(15, 2) NOT NULL,
  taxable_amount NUMERIC(15, 2) NOT NULL,
  hsn_sac VARCHAR(16) NOT NULL,
  cgst_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  cgst_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  sgst_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  sgst_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  igst_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  igst_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  tax_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  line_total NUMERIC(15, 2) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_sales_invoice_line_num UNIQUE (invoice_id, line_number),
  CONSTRAINT chk_sales_invoice_line_qty_pos CHECK (invoiced_quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_sales_invoice_line_so_line ON sales_invoice_lines(tenant_id, company_id, sales_order_line_id);
