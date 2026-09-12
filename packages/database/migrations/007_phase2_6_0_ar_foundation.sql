-- 007_phase2_6_0_ar_foundation.sql
-- Phase 2.6.0 Accounts Receivable Database Foundation Migration

-- Composite unique indexes on master tables to support composite tenant/company FK references
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_comp_id ON customers(tenant_id, company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_tenant_comp_id ON products(tenant_id, company_id, id);

-- 1. ar_documents
CREATE TABLE IF NOT EXISTS ar_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL,
  document_type VARCHAR(32) NOT NULL,
  document_number VARCHAR(64),
  document_date DATE NOT NULL,
  accounting_date DATE NOT NULL,
  due_date DATE NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  exchange_rate NUMERIC(12, 6) NOT NULL DEFAULT '1.000000',
  place_of_supply_state_code VARCHAR(2),
  supply_nature VARCHAR(32),
  taxability VARCHAR(32),
  is_rcm BOOLEAN NOT NULL DEFAULT FALSE,
  is_sez BOOLEAN NOT NULL DEFAULT FALSE,
  taxable_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  tax_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  gross_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  outstanding_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  allocated_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  unapplied_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  source_module VARCHAR(64) NOT NULL DEFAULT 'AR',
  source_document_id VARCHAR(255),
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ar_doc_tenant_comp_id ON ar_documents(tenant_id, company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ar_doc_tenant_comp_num ON ar_documents(tenant_id, company_id, document_number);
CREATE INDEX IF NOT EXISTS idx_ar_doc_tenant_comp_customer ON ar_documents(tenant_id, company_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_ar_doc_tenant_comp_doc_date ON ar_documents(tenant_id, company_id, document_date);
CREATE INDEX IF NOT EXISTS idx_ar_doc_tenant_comp_acc_date ON ar_documents(tenant_id, company_id, accounting_date);
CREATE INDEX IF NOT EXISTS idx_ar_doc_tenant_comp_due_date ON ar_documents(tenant_id, company_id, due_date);
CREATE INDEX IF NOT EXISTS idx_ar_doc_tenant_comp_status ON ar_documents(tenant_id, company_id, status);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ar_doc_customer') THEN
        ALTER TABLE ar_documents
        ADD CONSTRAINT fk_ar_doc_customer
        FOREIGN KEY (tenant_id, company_id, customer_id)
        REFERENCES customers(tenant_id, company_id, id)
        ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ar_doc_outstanding_pos') THEN
        ALTER TABLE ar_documents
        ADD CONSTRAINT chk_ar_doc_outstanding_pos
        CHECK (outstanding_amount >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ar_doc_unapplied_pos') THEN
        ALTER TABLE ar_documents
        ADD CONSTRAINT chk_ar_doc_unapplied_pos
        CHECK (unapplied_amount >= 0);
    END IF;
END $$;

-- 2. ar_document_lines
CREATE TABLE IF NOT EXISTS ar_document_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  ar_document_id UUID NOT NULL,
  line_sequence INT NOT NULL,
  product_id UUID,
  description TEXT NOT NULL,
  hsn_sac VARCHAR(10),
  quantity NUMERIC(15, 4) NOT NULL DEFAULT '1.0000',
  unit_price NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  taxable_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  tax_category_id UUID,
  tax_rate_percent NUMERIC(9, 6) NOT NULL DEFAULT '0.000000',
  cgst_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  sgst_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  igst_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  utgst_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  cess_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  tax_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  gross_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  is_rcm BOOLEAN NOT NULL DEFAULT FALSE,
  is_sez BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ar_line_tenant_comp_id ON ar_document_lines(tenant_id, company_id, id);
CREATE INDEX IF NOT EXISTS idx_ar_line_tenant_comp_doc ON ar_document_lines(tenant_id, company_id, ar_document_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ar_line_doc') THEN
        ALTER TABLE ar_document_lines
        ADD CONSTRAINT fk_ar_line_doc
        FOREIGN KEY (tenant_id, company_id, ar_document_id)
        REFERENCES ar_documents(tenant_id, company_id, id)
        ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ar_line_product') THEN
        ALTER TABLE ar_document_lines
        ADD CONSTRAINT fk_ar_line_product
        FOREIGN KEY (tenant_id, company_id, product_id)
        REFERENCES products(tenant_id, company_id, id)
        ON DELETE RESTRICT;
    END IF;
END $$;

-- 3. ar_open_items
CREATE TABLE IF NOT EXISTS ar_open_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL,
  ar_document_id UUID NOT NULL,
  document_type VARCHAR(32) NOT NULL DEFAULT 'INVOICE',
  document_number VARCHAR(64) NOT NULL,
  document_date DATE NOT NULL,
  due_date DATE NOT NULL,
  original_amount NUMERIC(20, 2) NOT NULL,
  outstanding_amount NUMERIC(20, 2) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ar_open_tenant_comp_id ON ar_open_items(tenant_id, company_id, id);
CREATE INDEX IF NOT EXISTS idx_ar_open_tenant_comp_cust_status ON ar_open_items(tenant_id, company_id, customer_id, status);
CREATE INDEX IF NOT EXISTS idx_ar_open_tenant_comp_due_date ON ar_open_items(tenant_id, company_id, due_date);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ar_open_customer') THEN
        ALTER TABLE ar_open_items
        ADD CONSTRAINT fk_ar_open_customer
        FOREIGN KEY (tenant_id, company_id, customer_id)
        REFERENCES customers(tenant_id, company_id, id)
        ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ar_open_doc') THEN
        ALTER TABLE ar_open_items
        ADD CONSTRAINT fk_ar_open_doc
        FOREIGN KEY (tenant_id, company_id, ar_document_id)
        REFERENCES ar_documents(tenant_id, company_id, id)
        ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ar_open_outstanding_pos') THEN
        ALTER TABLE ar_open_items
        ADD CONSTRAINT chk_ar_open_outstanding_pos
        CHECK (outstanding_amount >= 0);
    END IF;
END $$;

-- 4. ar_receipts
CREATE TABLE IF NOT EXISTS ar_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL,
  receipt_number VARCHAR(64),
  receipt_date DATE NOT NULL,
  accounting_date DATE NOT NULL,
  payment_mode VARCHAR(32) NOT NULL,
  bank_account_id UUID,
  total_amount NUMERIC(20, 2) NOT NULL,
  allocated_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  unapplied_amount NUMERIC(20, 2) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'POSTED',
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ar_receipt_tenant_comp_id ON ar_receipts(tenant_id, company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ar_receipt_tenant_comp_num ON ar_receipts(tenant_id, company_id, receipt_number);
CREATE INDEX IF NOT EXISTS idx_ar_receipt_tenant_comp_customer ON ar_receipts(tenant_id, company_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_ar_receipt_tenant_comp_date ON ar_receipts(tenant_id, company_id, receipt_date);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ar_receipt_customer') THEN
        ALTER TABLE ar_receipts
        ADD CONSTRAINT fk_ar_receipt_customer
        FOREIGN KEY (tenant_id, company_id, customer_id)
        REFERENCES customers(tenant_id, company_id, id)
        ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ar_receipt_bank_acc') THEN
        ALTER TABLE ar_receipts
        ADD CONSTRAINT fk_ar_receipt_bank_acc
        FOREIGN KEY (tenant_id, company_id, bank_account_id)
        REFERENCES chart_of_accounts(tenant_id, company_id, id)
        ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ar_receipt_unapplied_pos') THEN
        ALTER TABLE ar_receipts
        ADD CONSTRAINT chk_ar_receipt_unapplied_pos
        CHECK (unapplied_amount >= 0);
    END IF;
END $$;

-- 5. ar_allocations
CREATE TABLE IF NOT EXISTS ar_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  allocation_source_type VARCHAR(32) NOT NULL,
  receipt_id UUID,
  credit_note_id UUID,
  open_item_id UUID NOT NULL,
  allocated_amount NUMERIC(20, 2) NOT NULL,
  discount_amount NUMERIC(20, 2) NOT NULL DEFAULT '0.00',
  allocation_date DATE NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  reversed_at TIMESTAMPTZ,
  reversed_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ar_alloc_tenant_comp_id ON ar_allocations(tenant_id, company_id, id);
CREATE INDEX IF NOT EXISTS idx_ar_alloc_receipt_id ON ar_allocations(tenant_id, company_id, receipt_id);
CREATE INDEX IF NOT EXISTS idx_ar_alloc_cn_id ON ar_allocations(tenant_id, company_id, credit_note_id);
CREATE INDEX IF NOT EXISTS idx_ar_alloc_open_item_id ON ar_allocations(tenant_id, company_id, open_item_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ar_alloc_receipt') THEN
        ALTER TABLE ar_allocations
        ADD CONSTRAINT fk_ar_alloc_receipt
        FOREIGN KEY (tenant_id, company_id, receipt_id)
        REFERENCES ar_receipts(tenant_id, company_id, id)
        ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ar_alloc_cn') THEN
        ALTER TABLE ar_allocations
        ADD CONSTRAINT fk_ar_alloc_cn
        FOREIGN KEY (tenant_id, company_id, credit_note_id)
        REFERENCES ar_documents(tenant_id, company_id, id)
        ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ar_alloc_open_item') THEN
        ALTER TABLE ar_allocations
        ADD CONSTRAINT fk_ar_alloc_open_item
        FOREIGN KEY (tenant_id, company_id, open_item_id)
        REFERENCES ar_open_items(tenant_id, company_id, id)
        ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ar_alloc_source_exclusivity') THEN
        ALTER TABLE ar_allocations
        ADD CONSTRAINT chk_ar_alloc_source_exclusivity
        CHECK (
          (allocation_source_type = 'RECEIPT' AND receipt_id IS NOT NULL AND credit_note_id IS NULL) OR 
          (allocation_source_type = 'CREDIT_NOTE' AND credit_note_id IS NOT NULL AND receipt_id IS NULL)
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ar_alloc_amount_pos') THEN
        ALTER TABLE ar_allocations
        ADD CONSTRAINT chk_ar_alloc_amount_pos
        CHECK (allocated_amount > 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ar_alloc_discount_pos') THEN
        ALTER TABLE ar_allocations
        ADD CONSTRAINT chk_ar_alloc_discount_pos
        CHECK (discount_amount >= 0);
    END IF;
END $$;

-- 6. ar_adjustments
CREATE TABLE IF NOT EXISTS ar_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL,
  open_item_id UUID NOT NULL,
  adjustment_type VARCHAR(32) NOT NULL,
  amount NUMERIC(20, 2) NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ar_adj_tenant_comp_id ON ar_adjustments(tenant_id, company_id, id);
CREATE INDEX IF NOT EXISTS idx_ar_adj_tenant_comp_cust_open ON ar_adjustments(tenant_id, company_id, customer_id, open_item_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ar_adj_customer') THEN
        ALTER TABLE ar_adjustments
        ADD CONSTRAINT fk_ar_adj_customer
        FOREIGN KEY (tenant_id, company_id, customer_id)
        REFERENCES customers(tenant_id, company_id, id)
        ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ar_adj_open_item') THEN
        ALTER TABLE ar_adjustments
        ADD CONSTRAINT fk_ar_adj_open_item
        FOREIGN KEY (tenant_id, company_id, open_item_id)
        REFERENCES ar_open_items(tenant_id, company_id, id)
        ON DELETE RESTRICT;
    END IF;
END $$;
