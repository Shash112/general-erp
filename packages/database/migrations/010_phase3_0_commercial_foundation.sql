-- Migration 010: Phase 3.0 Shared Commercial Foundation

-- 1. Create commercial_addresses table
CREATE TABLE IF NOT EXISTS "commercial_addresses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" varchar(64) NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE CASCADE,
  "supplier_id" uuid REFERENCES "suppliers"("id") ON DELETE CASCADE,
  "branch_id" uuid REFERENCES "branches"("id") ON DELETE CASCADE,
  "address_type" varchar(32) NOT NULL DEFAULT 'BILLING',
  "address_line1" varchar(255) NOT NULL,
  "address_line2" varchar(255),
  "city" varchar(128) NOT NULL,
  "district" varchar(128),
  "state" varchar(128) NOT NULL,
  "state_code" varchar(2) NOT NULL,
  "postal_code" varchar(10) NOT NULL,
  "country" varchar(3) NOT NULL DEFAULT 'IND',
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "chk_comm_addr_one_parent" CHECK (((customer_id IS NOT NULL)::int + (supplier_id IS NOT NULL)::int + (branch_id IS NOT NULL)::int) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_comm_addr_tenant_comp_id" ON "commercial_addresses" ("tenant_id", "company_id", "id");
CREATE INDEX IF NOT EXISTS "idx_comm_addr_customer" ON "commercial_addresses" ("tenant_id", "company_id", "customer_id");
CREATE INDEX IF NOT EXISTS "idx_comm_addr_supplier" ON "commercial_addresses" ("tenant_id", "company_id", "supplier_id");
CREATE INDEX IF NOT EXISTS "idx_comm_addr_branch" ON "commercial_addresses" ("tenant_id", "company_id", "branch_id");

-- 2. Create commercial_contacts table
CREATE TABLE IF NOT EXISTS "commercial_contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" varchar(64) NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE CASCADE,
  "supplier_id" uuid REFERENCES "suppliers"("id") ON DELETE CASCADE,
  "branch_id" uuid REFERENCES "branches"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "designation" varchar(128),
  "email" varchar(255),
  "phone" varchar(32),
  "mobile" varchar(32),
  "is_primary" boolean NOT NULL DEFAULT false,
  "custom_fields" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "chk_comm_cont_one_parent" CHECK (((customer_id IS NOT NULL)::int + (supplier_id IS NOT NULL)::int + (branch_id IS NOT NULL)::int) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_comm_cont_tenant_comp_id" ON "commercial_contacts" ("tenant_id", "company_id", "id");
CREATE INDEX IF NOT EXISTS "idx_comm_cont_customer" ON "commercial_contacts" ("tenant_id", "company_id", "customer_id");
CREATE INDEX IF NOT EXISTS "idx_comm_cont_supplier" ON "commercial_contacts" ("tenant_id", "company_id", "supplier_id");
CREATE INDEX IF NOT EXISTS "idx_comm_cont_branch" ON "commercial_contacts" ("tenant_id", "company_id", "branch_id");

-- 3. Create uom_definitions table
CREATE TABLE IF NOT EXISTS "uom_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" varchar(64) NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,
  "code" varchar(20) NOT NULL,
  "name" varchar(128) NOT NULL,
  "symbol" varchar(20) NOT NULL,
  "category" varchar(64) NOT NULL DEFAULT 'UNIT',
  "precision" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_uom_def_tenant_comp_id" ON "uom_definitions" ("tenant_id", "company_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_uom_def_tenant_comp_code" ON "uom_definitions" ("tenant_id", "company_id", "code");

-- 4. Create uom_conversions table
CREATE TABLE IF NOT EXISTS "uom_conversions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" varchar(64) NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,
  "from_uom" varchar(20) NOT NULL,
  "to_uom" varchar(20) NOT NULL,
  "conversion_factor" numeric(18, 6) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_uom_conv_tenant_comp_id" ON "uom_conversions" ("tenant_id", "company_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_uom_conv_tenant_comp_pair" ON "uom_conversions" ("tenant_id", "company_id", "from_uom", "to_uom");

-- 5. Create pricing_lists table
CREATE TABLE IF NOT EXISTS "pricing_lists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" varchar(64) NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,
  "code" varchar(64) NOT NULL,
  "name" varchar(255) NOT NULL,
  "pricing_type" varchar(32) NOT NULL DEFAULT 'SALES',
  "currency" varchar(3) NOT NULL DEFAULT 'INR',
  "effective_from" date NOT NULL,
  "effective_to" date,
  "is_active" boolean NOT NULL DEFAULT true,
  "description" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_pricing_list_tenant_comp_id" ON "pricing_lists" ("tenant_id", "company_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_pricing_list_tenant_comp_code" ON "pricing_lists" ("tenant_id", "company_id", "code");

-- 6. Create pricing_rules table
CREATE TABLE IF NOT EXISTS "pricing_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" varchar(64) NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,
  "pricing_list_id" uuid REFERENCES "pricing_lists"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE CASCADE,
  "supplier_id" uuid REFERENCES "suppliers"("id") ON DELETE CASCADE,
  "unit_price" numeric(15, 2) NOT NULL,
  "currency" varchar(3) NOT NULL DEFAULT 'INR',
  "effective_from" date NOT NULL,
  "effective_to" date,
  "min_quantity" numeric(15, 4) NOT NULL DEFAULT '1.0000',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_pricing_rule_tenant_comp_id" ON "pricing_rules" ("tenant_id", "company_id", "id");
CREATE INDEX IF NOT EXISTS "idx_pricing_rule_product" ON "pricing_rules" ("tenant_id", "company_id", "product_id");
CREATE INDEX IF NOT EXISTS "idx_pricing_rule_customer" ON "pricing_rules" ("tenant_id", "company_id", "customer_id");
CREATE INDEX IF NOT EXISTS "idx_pricing_rule_supplier" ON "pricing_rules" ("tenant_id", "company_id", "supplier_id");

-- 7. Create pricing_quantity_tiers table
CREATE TABLE IF NOT EXISTS "pricing_quantity_tiers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" varchar(64) NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,
  "pricing_rule_id" uuid NOT NULL REFERENCES "pricing_rules"("id") ON DELETE CASCADE,
  "min_quantity" numeric(15, 4) NOT NULL,
  "max_quantity" numeric(15, 4),
  "unit_price" numeric(15, 2) NOT NULL,
  "discount_percent" numeric(5, 2) NOT NULL DEFAULT '0.00',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_pricing_tier_tenant_comp_id" ON "pricing_quantity_tiers" ("tenant_id", "company_id", "id");
CREATE INDEX IF NOT EXISTS "idx_pricing_tier_rule" ON "pricing_quantity_tiers" ("tenant_id", "company_id", "pricing_rule_id");

-- 8. Enhance products, customers, suppliers tables
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "product_type" varchar(32) NOT NULL DEFAULT 'GOODS';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "category" varchar(128);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "base_uom" varchar(20) NOT NULL DEFAULT 'PCS';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "min_order_qty" numeric(15, 4) NOT NULL DEFAULT '1.0000';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "is_sellable" boolean NOT NULL DEFAULT true;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "is_purchasable" boolean NOT NULL DEFAULT true;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now();

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "legal_name" varchar(255);
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "gst_type" varchar(32) NOT NULL DEFAULT 'REGULAR';
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "pan" varchar(10);
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "currency" varchar(3) NOT NULL DEFAULT 'INR';
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "payment_terms_id" varchar(64);
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "credit_days" integer NOT NULL DEFAULT 0;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now();

ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "legal_name" varchar(255);
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "gst_type" varchar(32) NOT NULL DEFAULT 'REGULAR';
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "pan" varchar(10);
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "msme_type" varchar(32) NOT NULL DEFAULT 'NONE';
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "msme_reg_no" varchar(64);
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "tds_section" varchar(32);
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "currency" varchar(3) NOT NULL DEFAULT 'INR';
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "payment_terms_id" varchar(64);
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now();
