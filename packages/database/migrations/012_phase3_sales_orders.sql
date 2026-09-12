-- ============================================================================
-- MIGRATION 012: PHASE 3.2 SALES ORDERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id),
  order_number VARCHAR(64) NOT NULL,
  quotation_id UUID NOT NULL REFERENCES sales_quotations(id),
  quotation_number VARCHAR(64) NOT NULL,
  revision_number INTEGER NOT NULL,
  conversion_contract_id UUID NOT NULL, -- Application contract UUID (NOT a DB FK - no contract DB table exists)
  customer_id UUID NOT NULL REFERENCES customers(id),
  order_date VARCHAR(10) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  exchange_rate NUMERIC(18,6) NOT NULL DEFAULT 1.000000,
  sales_representative_id UUID REFERENCES users(id),
  billing_address_id UUID NOT NULL REFERENCES commercial_addresses(id),
  shipping_address_id UUID NOT NULL REFERENCES commercial_addresses(id),
  billing_address_snapshot JSONB NOT NULL,
  shipping_address_snapshot JSONB NOT NULL,
  contact_id UUID REFERENCES commercial_contacts(id),
  contact_snapshot JSONB,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  notes TEXT,
  terms_and_conditions TEXT,
  subtotal_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  header_discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  taxable_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  total_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  total_amount_base NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  credit_override_by UUID REFERENCES users(id),
  credit_override_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  CONSTRAINT uq_sales_order_tenant_company_num UNIQUE (tenant_id, company_id, order_number),
  CONSTRAINT uq_sales_order_contract_id UNIQUE (tenant_id, company_id, conversion_contract_id),
  CONSTRAINT chk_sales_order_status CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELLED', 'COMPLETED'))
);

CREATE INDEX IF NOT EXISTS idx_sales_order_customer ON sales_orders (tenant_id, company_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_order_status ON sales_orders (tenant_id, company_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_order_date ON sales_orders (tenant_id, company_id, order_date);

CREATE TABLE IF NOT EXISTS sales_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  -- Relational traceability: explicit DB FK to sales_quotation_lines(id) with ON DELETE RESTRICT
  quotation_line_id UUID NOT NULL REFERENCES sales_quotation_lines(id) ON DELETE RESTRICT,
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL,
  line_number INTEGER NOT NULL,
  product_id UUID NOT NULL REFERENCES products(id),
  product_code_snapshot VARCHAR(64) NOT NULL,
  product_name_snapshot VARCHAR(255) NOT NULL,
  description TEXT,
  uom VARCHAR(32) NOT NULL REFERENCES uom_definitions(code),
  ordered_quantity NUMERIC(18,4) NOT NULL,
  delivered_quantity NUMERIC(18,4) NOT NULL DEFAULT 0.0000,
  invoiced_quantity NUMERIC(18,4) NOT NULL DEFAULT 0.0000,
  cancelled_quantity NUMERIC(18,4) NOT NULL DEFAULT 0.0000,
  unit_price NUMERIC(18,4) NOT NULL,
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  allocated_header_discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  gross_amount NUMERIC(15,2) NOT NULL,
  taxable_amount NUMERIC(15,2) NOT NULL,
  hsn_sac VARCHAR(16) NOT NULL,
  cgst_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  cgst_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  sgst_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  sgst_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  igst_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  igst_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  line_total NUMERIC(15,2) NOT NULL,
  pricing_source VARCHAR(64) NOT NULL,
  pricing_rule_id UUID REFERENCES pricing_rules(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_sales_order_line_num UNIQUE (order_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_sales_order_line_quotation_line ON sales_order_lines (quotation_line_id);
