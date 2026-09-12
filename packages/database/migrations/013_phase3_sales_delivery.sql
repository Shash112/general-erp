-- Phase 3.3 — Sales Delivery & Dispatch Schema Migration
-- Authoritative sales_deliveries and sales_delivery_lines tables

CREATE TABLE IF NOT EXISTS sales_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id),
  branch_id UUID REFERENCES branches(id),
  delivery_number VARCHAR(64) NOT NULL,
  sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE RESTRICT,
  sales_order_number VARCHAR(64) NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id),
  delivery_date VARCHAR(10) NOT NULL,
  shipping_address_id UUID NOT NULL REFERENCES commercial_addresses(id),
  shipping_address_snapshot JSONB NOT NULL,
  contact_id UUID REFERENCES commercial_contacts(id),
  contact_snapshot JSONB,
  warehouse_reference VARCHAR(128),
  transporter_name VARCHAR(255),
  vehicle_number VARCHAR(64),
  lr_number VARCHAR(64),
  lr_date VARCHAR(10),
  notes TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  picked_at TIMESTAMP,
  picked_by UUID REFERENCES users(id),
  packed_at TIMESTAMP,
  packed_by UUID REFERENCES users(id),
  dispatched_at TIMESTAMP,
  dispatched_by UUID REFERENCES users(id),
  delivered_at TIMESTAMP,
  delivered_by UUID REFERENCES users(id),
  cancelled_at TIMESTAMP,
  cancelled_by UUID REFERENCES users(id),
  cancellation_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,

  CONSTRAINT uq_sales_delivery_tenant_company_num UNIQUE (tenant_id, company_id, delivery_number),
  CONSTRAINT chk_sales_delivery_status CHECK (status IN ('DRAFT', 'PICKED', 'PACKED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS idx_sales_delivery_order ON sales_deliveries(tenant_id, company_id, sales_order_id);
CREATE INDEX IF NOT EXISTS idx_sales_delivery_customer ON sales_deliveries(tenant_id, company_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_delivery_status ON sales_deliveries(tenant_id, company_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_delivery_date ON sales_deliveries(tenant_id, company_id, delivery_date);

CREATE TABLE IF NOT EXISTS sales_delivery_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES sales_deliveries(id) ON DELETE CASCADE,
  sales_order_line_id UUID NOT NULL REFERENCES sales_order_lines(id) ON DELETE RESTRICT,
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL,
  line_number INTEGER NOT NULL,
  product_id UUID NOT NULL REFERENCES products(id),
  product_code_snapshot VARCHAR(64) NOT NULL,
  product_name_snapshot VARCHAR(255) NOT NULL,
  description TEXT,
  uom VARCHAR(32) NOT NULL REFERENCES uom_definitions(code),
  ordered_quantity_snapshot NUMERIC(18, 4) NOT NULL,
  previously_delivered_quantity_snapshot NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
  delivery_quantity NUMERIC(18, 4) NOT NULL,
  rejected_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
  remaining_quantity_snapshot NUMERIC(18, 4) NOT NULL,
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_sales_delivery_line_num UNIQUE (delivery_id, line_number),
  CONSTRAINT chk_sales_delivery_line_qty_pos CHECK (delivery_quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_sales_delivery_line_so_line ON sales_delivery_lines(tenant_id, company_id, sales_order_line_id);
