-- Migration: 017_phase3_7_sourcing_purchase_orders.sql
-- Description: Phase 3.7 - Sourcing, RFQs, Supplier Quotations & Purchase Orders

CREATE TABLE IF NOT EXISTS "procurement_rfqs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" VARCHAR(64) NOT NULL,
  "company_id" UUID NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,
  "branch_id" UUID REFERENCES "branches"("id") ON DELETE RESTRICT,
  "department_id" UUID REFERENCES "departments"("id") ON DELETE RESTRICT,
  "purchase_request_id" UUID REFERENCES "purchase_requests"("id") ON DELETE SET NULL,

  "rfq_number" VARCHAR(64) NOT NULL,
  "rfq_date" VARCHAR(10) NOT NULL,
  "response_due_date" VARCHAR(10) NOT NULL,

  "title" VARCHAR(255) NOT NULL,
  "purpose" TEXT,
  "instructions" TEXT,
  "terms" TEXT,

  "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
  "status" VARCHAR(32) NOT NULL DEFAULT 'DRAFT',

  "notes" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "created_by" VARCHAR(64) NOT NULL,
  "updated_by" VARCHAR(64) NOT NULL,

  CONSTRAINT "uq_procurement_rfqs_tenant_company_num" UNIQUE ("tenant_id", "company_id", "rfq_number"),
  CONSTRAINT "chk_rfqs_status" CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'RESPONSE_OPEN', 'RESPONSE_CLOSED', 'EVALUATED', 'AWARDED', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS "idx_procurement_rfqs_tenant_comp" ON "procurement_rfqs" ("tenant_id", "company_id");
CREATE INDEX IF NOT EXISTS "idx_procurement_rfqs_status" ON "procurement_rfqs" ("tenant_id", "company_id", "status");
CREATE INDEX IF NOT EXISTS "idx_procurement_rfqs_pr" ON "procurement_rfqs" ("purchase_request_id");

CREATE TABLE IF NOT EXISTS "procurement_rfq_lines" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "rfq_id" UUID NOT NULL REFERENCES "procurement_rfqs"("id") ON DELETE CASCADE,
  "line_number" INTEGER NOT NULL,

  "purchase_request_line_id" UUID REFERENCES "purchase_request_lines"("id") ON DELETE SET NULL,
  "product_id" UUID REFERENCES "products"("id") ON DELETE RESTRICT,
  "description" TEXT NOT NULL,
  "specification" TEXT,

  "requested_quantity" NUMERIC(18, 4) NOT NULL,
  "uom" VARCHAR(32) NOT NULL,

  "target_date" VARCHAR(10),
  "notes" TEXT,

  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "uq_procurement_rfq_lines_num" UNIQUE ("rfq_id", "line_number"),
  CONSTRAINT "chk_rfq_lines_requested_qty_pos" CHECK ("requested_quantity" > 0)
);

CREATE INDEX IF NOT EXISTS "idx_rfq_lines_product" ON "procurement_rfq_lines" ("product_id");

CREATE TABLE IF NOT EXISTS "procurement_rfq_suppliers" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "rfq_id" UUID NOT NULL REFERENCES "procurement_rfqs"("id") ON DELETE CASCADE,
  "supplier_id" UUID NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "status" VARCHAR(32) NOT NULL DEFAULT 'INVITED',
  "invited_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "responded_at" TIMESTAMP WITH TIME ZONE,
  "notes" TEXT,

  CONSTRAINT "uq_procurement_rfq_suppliers_rfq_sup" UNIQUE ("rfq_id", "supplier_id")
);

CREATE TABLE IF NOT EXISTS "procurement_supplier_quotations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" VARCHAR(64) NOT NULL,
  "company_id" UUID NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,

  "supplier_id" UUID NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "rfq_id" UUID REFERENCES "procurement_rfqs"("id") ON DELETE SET NULL,

  "supplier_quote_number" VARCHAR(64) NOT NULL,
  "internal_quote_number" VARCHAR(64) NOT NULL,

  "quotation_date" VARCHAR(10) NOT NULL,
  "valid_until" VARCHAR(10) NOT NULL,

  "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
  "exchange_rate" NUMERIC(12, 6) NOT NULL DEFAULT 1.000000,

  "payment_terms" VARCHAR(128),
  "delivery_terms" VARCHAR(128),
  "warranty_terms" VARCHAR(128),
  "shipping_terms" VARCHAR(128),

  "subtotal" NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  "discount" NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  "tax" NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  "total" NUMERIC(15, 2) NOT NULL DEFAULT 0.00,

  "status" VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,

  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "created_by" VARCHAR(64) NOT NULL,
  "updated_by" VARCHAR(64) NOT NULL,

  CONSTRAINT "uq_procurement_sq_tenant_company_num" UNIQUE ("tenant_id", "company_id", "internal_quote_number"),
  CONSTRAINT "chk_sq_status" CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'AWARDED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS "idx_procurement_sq_tenant_comp" ON "procurement_supplier_quotations" ("tenant_id", "company_id");
CREATE INDEX IF NOT EXISTS "idx_procurement_sq_supplier" ON "procurement_supplier_quotations" ("tenant_id", "company_id", "supplier_id");
CREATE INDEX IF NOT EXISTS "idx_procurement_sq_rfq" ON "procurement_supplier_quotations" ("rfq_id");

CREATE TABLE IF NOT EXISTS "procurement_supplier_quotation_lines" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "supplier_quotation_id" UUID NOT NULL REFERENCES "procurement_supplier_quotations"("id") ON DELETE CASCADE,
  "line_number" INTEGER NOT NULL,

  "rfq_line_id" UUID REFERENCES "procurement_rfq_lines"("id") ON DELETE SET NULL,
  "product_id" UUID REFERENCES "products"("id") ON DELETE RESTRICT,
  "description" TEXT NOT NULL,

  "quoted_quantity" NUMERIC(18, 4) NOT NULL,
  "uom" VARCHAR(32) NOT NULL,

  "unit_price" NUMERIC(15, 2) NOT NULL,
  "discount" NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  "taxable_amount" NUMERIC(15, 2) NOT NULL,
  "tax" NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  "line_total" NUMERIC(15, 2) NOT NULL,

  "delivery_date" VARCHAR(10),
  "lead_time_days" INTEGER,
  "specification" TEXT,
  "notes" TEXT,

  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "uq_procurement_sq_lines_num" UNIQUE ("supplier_quotation_id", "line_number"),
  CONSTRAINT "chk_sq_lines_quoted_qty_pos" CHECK ("quoted_quantity" > 0)
);

CREATE INDEX IF NOT EXISTS "idx_sq_lines_product" ON "procurement_supplier_quotation_lines" ("product_id");

CREATE TABLE IF NOT EXISTS "procurement_quotation_comparisons" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" VARCHAR(64) NOT NULL,
  "company_id" UUID NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,

  "rfq_id" UUID NOT NULL REFERENCES "procurement_rfqs"("id") ON DELETE CASCADE,
  "comparison_date" VARCHAR(10) NOT NULL,

  "status" VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  "evaluation_notes" TEXT,

  "awarded_supplier_id" UUID REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "awarded_at" TIMESTAMP WITH TIME ZONE,
  "awarded_by" VARCHAR(64),

  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "created_by" VARCHAR(64) NOT NULL,
  "updated_by" VARCHAR(64) NOT NULL,

  CONSTRAINT "uq_procurement_comparison_rfq" UNIQUE ("tenant_id", "company_id", "rfq_id")
);

CREATE INDEX IF NOT EXISTS "idx_procurement_comp_rfq" ON "procurement_quotation_comparisons" ("rfq_id");

CREATE TABLE IF NOT EXISTS "procurement_quotation_comparison_lines" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "comparison_id" UUID NOT NULL REFERENCES "procurement_quotation_comparisons"("id") ON DELETE CASCADE,

  "rfq_line_id" UUID NOT NULL REFERENCES "procurement_rfq_lines"("id") ON DELETE CASCADE,
  "supplier_quotation_id" UUID NOT NULL REFERENCES "procurement_supplier_quotations"("id") ON DELETE CASCADE,
  "supplier_quotation_line_id" UUID NOT NULL REFERENCES "procurement_supplier_quotation_lines"("id") ON DELETE CASCADE,
  "supplier_id" UUID NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,

  "quoted_unit_price" NUMERIC(15, 2) NOT NULL,
  "quoted_quantity" NUMERIC(18, 4) NOT NULL,
  "quoted_line_total" NUMERIC(15, 2) NOT NULL,

  "is_awarded" BOOLEAN NOT NULL DEFAULT FALSE,
  "award_quantity" NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,

  "rejection_reason" TEXT,
  "evaluation_notes" TEXT,

  CONSTRAINT "uq_procurement_comp_lines_unique" UNIQUE ("comparison_id", "rfq_line_id", "supplier_quotation_line_id")
);

CREATE TABLE IF NOT EXISTS "purchase_orders" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" VARCHAR(64) NOT NULL,
  "company_id" UUID NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,
  "branch_id" UUID REFERENCES "branches"("id") ON DELETE RESTRICT,

  "po_number" VARCHAR(64) NOT NULL,
  "supplier_id" UUID NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,

  "purchase_request_id" UUID REFERENCES "purchase_requests"("id") ON DELETE SET NULL,
  "rfq_id" UUID REFERENCES "procurement_rfqs"("id") ON DELETE SET NULL,
  "supplier_quotation_id" UUID REFERENCES "procurement_supplier_quotations"("id") ON DELETE SET NULL,
  "comparison_id" UUID REFERENCES "procurement_quotation_comparisons"("id") ON DELETE SET NULL,

  "po_date" VARCHAR(10) NOT NULL,
  "expected_delivery_date" VARCHAR(10) NOT NULL,

  "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
  "exchange_rate" NUMERIC(12, 6) NOT NULL DEFAULT 1.000000,

  "payment_terms" VARCHAR(128),
  "delivery_terms" VARCHAR(128),
  "shipping_terms" VARCHAR(128),
  "warranty_terms" VARCHAR(128),

  "billing_address" TEXT,
  "shipping_location" TEXT,

  "status" VARCHAR(32) NOT NULL DEFAULT 'DRAFT',

  "subtotal" NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  "discount" NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  "taxable_amount" NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  "tax" NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  "rounding" NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  "grand_total" NUMERIC(15, 2) NOT NULL DEFAULT 0.00,

  "notes" TEXT,
  "terms_and_conditions" TEXT,

  "version" INTEGER NOT NULL DEFAULT 1,

  "submitted_at" TIMESTAMP WITH TIME ZONE,
  "submitted_by" VARCHAR(64),

  "approved_at" TIMESTAMP WITH TIME ZONE,
  "approved_by" VARCHAR(64),

  "issued_at" TIMESTAMP WITH TIME ZONE,
  "issued_by" VARCHAR(64),

  "acknowledged_at" TIMESTAMP WITH TIME ZONE,
  "acknowledged_by" VARCHAR(64),

  "cancelled_at" TIMESTAMP WITH TIME ZONE,
  "cancelled_by" VARCHAR(64),
  "cancellation_reason" TEXT,

  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "created_by" VARCHAR(64) NOT NULL,
  "updated_by" VARCHAR(64) NOT NULL,

  CONSTRAINT "uq_purchase_orders_tenant_company_num" UNIQUE ("tenant_id", "company_id", "po_number"),
  CONSTRAINT "chk_po_status" CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'ISSUED', 'ACKNOWLEDGED', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS "idx_purchase_orders_tenant_comp" ON "purchase_orders" ("tenant_id", "company_id");
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_supplier" ON "purchase_orders" ("tenant_id", "company_id", "supplier_id");
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_status" ON "purchase_orders" ("tenant_id", "company_id", "status");
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_pr" ON "purchase_orders" ("purchase_request_id");
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_rfq" ON "purchase_orders" ("rfq_id");
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_sq" ON "purchase_orders" ("supplier_quotation_id");

CREATE TABLE IF NOT EXISTS "purchase_order_lines" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "purchase_order_id" UUID NOT NULL REFERENCES "purchase_orders"("id") ON DELETE CASCADE,
  "line_number" INTEGER NOT NULL,

  "purchase_request_line_id" UUID REFERENCES "purchase_request_lines"("id") ON DELETE SET NULL,
  "rfq_line_id" UUID REFERENCES "procurement_rfq_lines"("id") ON DELETE SET NULL,
  "supplier_quotation_line_id" UUID REFERENCES "procurement_supplier_quotation_lines"("id") ON DELETE SET NULL,

  "product_id" UUID REFERENCES "products"("id") ON DELETE RESTRICT,
  "product_code_snapshot" VARCHAR(64),
  "product_name_snapshot" VARCHAR(255),
  "description" TEXT NOT NULL,
  "uom" VARCHAR(32) NOT NULL,

  "ordered_quantity" NUMERIC(18, 4) NOT NULL,
  "unit_price" NUMERIC(15, 2) NOT NULL,

  "discount" NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  "discount_amount" NUMERIC(15, 2) NOT NULL DEFAULT 0.00,

  "taxable_amount" NUMERIC(15, 2) NOT NULL,
  "tax_rate" NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  "tax_amount" NUMERIC(15, 2) NOT NULL DEFAULT 0.00,

  "line_total" NUMERIC(15, 2) NOT NULL,

  "expected_delivery_date" VARCHAR(10),
  "notes" TEXT,

  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "uq_purchase_order_lines_num" UNIQUE ("purchase_order_id", "line_number"),
  CONSTRAINT "chk_po_lines_ordered_qty_pos" CHECK ("ordered_quantity" > 0)
);

CREATE INDEX IF NOT EXISTS "idx_po_lines_product" ON "purchase_order_lines" ("product_id");
