-- Migration: 009_phase2_7_2_ap_immutability.sql
-- Description: Phase 2.7.2 AP Posted Document Immutability & Financial Integrity Triggers
-- Protects POSTED ap_documents, ap_document_lines, and ap_open_items against unauthorized UPDATE and DELETE operations.
-- Forbids direct SQL DRAFT -> POSTED and POSTED -> REVERSED status transitions outside authorized transactions.
-- Forbids direct SQL mutation of ap_open_items outstanding_amount and status outside authorized allocation/settlement transactions.

-- 1. Trigger Function for ap_documents Immutability & Direct SQL Transition Defense
CREATE OR REPLACE FUNCTION trg_prevent_posted_ap_document_update_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Rejects DELETE on POSTED or REVERSED AP documents
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'POSTED' OR OLD.status = 'REVERSED' THEN
      RAISE EXCEPTION 'POSTED AP documents are strictly immutable and cannot be deleted (Document Number: %). Reversal requires a Credit Note or Debit Note.', OLD.document_number;
    END IF;
    RETURN OLD;
  END IF;

  -- Rejects unauthorized UPDATE on POSTED AP documents
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'POSTED' OR OLD.status = 'REVERSED' THEN
      -- FORBID POSTED -> DRAFT transition
      IF NEW.status = 'DRAFT' THEN
        RAISE EXCEPTION 'POSTED AP documents cannot transition to DRAFT status.';
      END IF;

      -- FORBID POSTED -> CANCELLED transition
      IF NEW.status = 'CANCELLED' THEN
        RAISE EXCEPTION 'POSTED AP documents cannot transition to CANCELLED status. Use formal reversal mechanism.';
      END IF;

      -- Prevent changing core financial identity fields
      IF NEW.supplier_id <> OLD.supplier_id OR
         NEW.document_type <> OLD.document_type OR
         (OLD.document_number IS NOT NULL AND NEW.document_number <> OLD.document_number) OR
         NEW.accounting_date <> OLD.accounting_date OR
         NEW.gross_amount <> OLD.gross_amount OR
         NEW.taxable_amount <> OLD.taxable_amount OR
         NEW.tax_amount <> OLD.tax_amount OR
         NEW.tenant_id <> OLD.tenant_id OR
         NEW.company_id <> OLD.company_id OR
         (OLD.journal_entry_id IS NOT NULL AND NEW.journal_entry_id <> OLD.journal_entry_id) THEN
        RAISE EXCEPTION 'POSTED AP documents are strictly immutable and financial core fields cannot be altered (Document Number: %).', OLD.document_number;
      END IF;

      -- POSTED -> REVERSED transition requires explicit transaction-local authorization
      IF OLD.status = 'POSTED' AND NEW.status = 'REVERSED' THEN
        IF current_setting('app.ap_reversal_authorized', true) IS DISTINCT FROM 'true' 
           AND current_setting('app.posting_authorized', true) IS DISTINCT FROM 'true' THEN
          RAISE EXCEPTION 'Direct SQL transition from POSTED to REVERSED is forbidden. Reversals must execute through authorized AP Reversal Service.';
        END IF;
      END IF;
    END IF;

    -- Guard DRAFT -> POSTED transition: Require authorized session variable
    IF OLD.status = 'DRAFT' AND NEW.status = 'POSTED' THEN
      IF current_setting('app.ap_posting_authorized', true) IS DISTINCT FROM 'true' 
         AND current_setting('app.posting_authorized', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Direct SQL transition from DRAFT to POSTED is forbidden. Postings must execute through authorized AP Posting Service.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ap_documents_immutability ON ap_documents;
CREATE TRIGGER trg_ap_documents_immutability
BEFORE UPDATE OR DELETE ON ap_documents
FOR EACH ROW EXECUTE FUNCTION trg_prevent_posted_ap_document_update_delete();

-- 2. Trigger Function for ap_document_lines Immutability
CREATE OR REPLACE FUNCTION trg_prevent_posted_ap_line_update_delete()
RETURNS TRIGGER AS $$
DECLARE
  parent_status VARCHAR(32);
BEGIN
  SELECT status INTO parent_status FROM ap_documents WHERE id = OLD.ap_document_id;
  IF parent_status = 'POSTED' OR parent_status = 'REVERSED' THEN
    RAISE EXCEPTION 'AP document lines associated with POSTED AP documents are strictly immutable.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ap_document_lines_immutability ON ap_document_lines;
CREATE TRIGGER trg_ap_document_lines_immutability
BEFORE UPDATE OR DELETE ON ap_document_lines
FOR EACH ROW EXECUTE FUNCTION trg_prevent_posted_ap_line_update_delete();

-- 3. Trigger Function for ap_open_items Immutability & Unauthorized Mutation Protection
CREATE OR REPLACE FUNCTION trg_prevent_ap_open_item_unauthorized_mutation_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Rejects DELETE on AP open items
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AP open items represent authoritative payable exposure and cannot be deleted (Document Number: %).', OLD.document_number;
  END IF;

  -- Rejects unauthorized UPDATE on AP open items
  IF TG_OP = 'UPDATE' THEN
    -- Identity fields are 100% immutable forever
    IF NEW.ap_document_id <> OLD.ap_document_id OR
       NEW.supplier_id <> OLD.supplier_id OR
       NEW.original_amount <> OLD.original_amount OR
       NEW.tenant_id <> OLD.tenant_id OR
       NEW.company_id <> OLD.company_id OR
       NEW.document_type <> OLD.document_type OR
       NEW.document_number <> OLD.document_number THEN
      RAISE EXCEPTION 'Core financial properties of AP open items (original_amount, supplier_id, ap_document_id, tenant_id, company_id) are strictly immutable.';
    END IF;

    -- Outstanding amount or status mutation requires explicit transaction-local authorization
    IF NEW.outstanding_amount <> OLD.outstanding_amount OR NEW.status <> OLD.status THEN
      IF current_setting('app.ap_allocation_authorized', true) IS DISTINCT FROM 'true'
         AND current_setting('app.ap_settlement_authorized', true) IS DISTINCT FROM 'true'
         AND current_setting('app.posting_authorized', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Direct SQL mutation of AP open item outstanding_amount or status is forbidden. Mutations must execute through authorized AP Allocation or Settlement Service.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ap_open_items_immutability ON ap_open_items;
CREATE TRIGGER trg_ap_open_items_immutability
BEFORE UPDATE OR DELETE ON ap_open_items
FOR EACH ROW EXECUTE FUNCTION trg_prevent_ap_open_item_unauthorized_mutation_delete();

-- 4. Trigger Function for ap_payments Immutability & Balance Mutation Authorization
CREATE OR REPLACE FUNCTION trg_prevent_posted_ap_payment_update_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Rejects DELETE on POSTED or REVERSED AP payments
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'POSTED' OR OLD.status = 'REVERSED' THEN
      RAISE EXCEPTION 'POSTED AP payments are strictly immutable and cannot be deleted (Payment Number: %).', OLD.payment_number;
    END IF;
    RETURN OLD;
  END IF;

  -- Rejects unauthorized UPDATE on POSTED AP payments
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'POSTED' OR OLD.status = 'REVERSED' THEN
      -- FORBID POSTED -> DRAFT transition
      IF NEW.status = 'DRAFT' THEN
        RAISE EXCEPTION 'POSTED AP payments cannot transition to DRAFT status.';
      END IF;

      -- Prevent changing core financial identity fields
      IF NEW.supplier_id <> OLD.supplier_id OR
         (OLD.payment_number IS NOT NULL AND NEW.payment_number <> OLD.payment_number) OR
         NEW.payment_date <> OLD.payment_date OR
         NEW.accounting_date <> OLD.accounting_date OR
         NEW.payment_mode <> OLD.payment_mode OR
         NEW.bank_account_id <> OLD.bank_account_id OR
         NEW.total_amount <> OLD.total_amount OR
         NEW.tenant_id <> OLD.tenant_id OR
         NEW.company_id <> OLD.company_id OR
         (OLD.journal_entry_id IS NOT NULL AND NEW.journal_entry_id <> OLD.journal_entry_id) THEN
        RAISE EXCEPTION 'POSTED AP payments are strictly immutable and core financial fields cannot be altered (Payment Number: %).', OLD.payment_number;
      END IF;

      -- POSTED -> REVERSED transition requires explicit transaction-local authorization
      IF OLD.status = 'POSTED' AND NEW.status = 'REVERSED' THEN
        IF current_setting('app.ap_reversal_authorized', true) IS DISTINCT FROM 'true'
           AND current_setting('app.posting_authorized', true) IS DISTINCT FROM 'true' THEN
          RAISE EXCEPTION 'Direct SQL transition from POSTED to REVERSED is forbidden. Reversals must execute through authorized AP Reversal Service.';
        END IF;
      END IF;

      -- Allocated or unapplied amount mutation requires explicit transaction-local authorization
      IF NEW.allocated_amount <> OLD.allocated_amount OR NEW.unapplied_amount <> OLD.unapplied_amount THEN
        IF current_setting('app.ap_allocation_authorized', true) IS DISTINCT FROM 'true'
           AND current_setting('app.ap_settlement_authorized', true) IS DISTINCT FROM 'true'
           AND current_setting('app.posting_authorized', true) IS DISTINCT FROM 'true' THEN
          RAISE EXCEPTION 'Direct SQL mutation of AP payment allocated_amount or unapplied_amount is forbidden. Mutations must execute through authorized AP Allocation Engine.';
        END IF;
      END IF;
    END IF;

    -- Guard DRAFT -> POSTED transition: Require authorized session variable
    IF OLD.status = 'DRAFT' AND NEW.status = 'POSTED' THEN
      IF current_setting('app.ap_posting_authorized', true) IS DISTINCT FROM 'true'
         AND current_setting('app.posting_authorized', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Direct SQL transition from DRAFT to POSTED is forbidden. Postings must execute through authorized AP Payment Service.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ap_payments_immutability ON ap_payments;
CREATE TRIGGER trg_ap_payments_immutability
BEFORE UPDATE OR DELETE ON ap_payments
FOR EACH ROW EXECUTE FUNCTION trg_prevent_posted_ap_payment_update_delete();

