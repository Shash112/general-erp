-- Migration 018: Phase 3.8 Goods Receipt Notes (GRN), Inventory Receiving & Inspection

ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS received_quantity numeric(18, 4) NOT NULL DEFAULT '0.0000';
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS accepted_quantity numeric(18, 4) NOT NULL DEFAULT '0.0000';

CREATE TABLE IF NOT EXISTS goods_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,

  grn_number VARCHAR(64) NOT NULL,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,

  receipt_date VARCHAR(10) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  warehouse_id VARCHAR(128),
  receiving_location_id VARCHAR(128),

  supplier_delivery_note_number VARCHAR(64),
  supplier_delivery_note_date VARCHAR(10),

  transporter VARCHAR(128),
  vehicle_number VARCHAR(64),
  lr_number VARCHAR(64),

  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  inspection_status VARCHAR(32) NOT NULL DEFAULT 'NOT_REQUIRED',

  received_by VARCHAR(64) NOT NULL,
  notes TEXT,

  version INTEGER NOT NULL DEFAULT 1,

  submitted_at TIMESTAMPTZ,
  submitted_by VARCHAR(64),

  inspected_at TIMESTAMPTZ,
  inspected_by VARCHAR(64),

  accepted_at TIMESTAMPTZ,
  accepted_by VARCHAR(64),

  cancelled_at TIMESTAMPTZ,
  cancelled_by VARCHAR(64),
  cancellation_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,

  CONSTRAINT uq_goods_receipts_tenant_company_num UNIQUE (tenant_id, company_id, grn_number),
  CONSTRAINT chk_grn_status CHECK (status IN ('DRAFT', 'RECEIVED', 'INSPECTION_PENDING', 'ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED', 'CANCELLED')),
  CONSTRAINT chk_grn_inspection_status CHECK (inspection_status IN ('NOT_REQUIRED', 'PENDING', 'PASSED', 'PARTIALLY_PASSED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_goods_receipts_tenant_comp ON goods_receipts(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_po ON goods_receipts(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_supplier ON goods_receipts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_status ON goods_receipts(tenant_id, company_id, status);

CREATE TABLE IF NOT EXISTS goods_receipt_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goods_receipt_id UUID NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,

  purchase_order_line_id UUID NOT NULL REFERENCES purchase_order_lines(id) ON DELETE RESTRICT,
  product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
  description_snapshot TEXT NOT NULL,
  product_code_snapshot VARCHAR(64),
  uom VARCHAR(32) NOT NULL,

  ordered_quantity NUMERIC(18, 4) NOT NULL,
  previously_received_quantity NUMERIC(18, 4) NOT NULL DEFAULT '0.0000',
  received_quantity NUMERIC(18, 4) NOT NULL,
  accepted_quantity NUMERIC(18, 4) NOT NULL DEFAULT '0.0000',
  rejected_quantity NUMERIC(18, 4) NOT NULL DEFAULT '0.0000',
  remaining_quantity NUMERIC(18, 4) NOT NULL DEFAULT '0.0000',

  inspection_required BOOLEAN NOT NULL DEFAULT FALSE,
  rejection_reason TEXT,

  batch_reference VARCHAR(128),
  serial_reference VARCHAR(128),

  notes TEXT,

  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_goods_receipt_lines_num UNIQUE (goods_receipt_id, line_number),
  CONSTRAINT chk_grn_lines_received_qty_pos CHECK (received_quantity >= 0)
);

CREATE INDEX IF NOT EXISTS idx_grn_lines_po_line ON goods_receipt_lines(purchase_order_line_id);
CREATE INDEX IF NOT EXISTS idx_grn_lines_product ON goods_receipt_lines(product_id);
