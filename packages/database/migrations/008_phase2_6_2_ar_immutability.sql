-- Migration: 008_phase2_6_2_ar_immutability.sql
-- Description: Phase 2.6.2 AR Posted Document Immutability & Financial Integrity Triggers
-- Protects POSTED ar_documents and ar_document_lines against UPDATE and DELETE operations.
-- Forbids direct SQL DRAFT -> POSTED status transitions outside authorized posting transactions.

-- 1. Trigger Function for ar_documents Immutability & Direct SQL Transition Defense
CREATE OR REPLACE FUNCTION trg_prevent_posted_ar_document_update_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Rejects UPDATE or DELETE on POSTED AR documents
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    IF OLD.status = 'POSTED' THEN
      RAISE EXCEPTION 'POSTED AR documents are strictly immutable and cannot be updated or deleted (Document Number: %). Reversal requires a Credit Note or Debit Note.', OLD.document_number;
    END IF;
  END IF;

  -- Guard DRAFT -> POSTED transition: Require authorized session variable
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'DRAFT' AND NEW.status = 'POSTED' THEN
      IF current_setting('app.ar_posting_authorized', true) IS DISTINCT FROM 'true' 
         AND current_setting('app.posting_authorized', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Direct SQL transition from DRAFT to POSTED is forbidden. Postings must execute through authorized AR Posting Service.';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ar_documents_immutability ON ar_documents;
CREATE TRIGGER trg_ar_documents_immutability
BEFORE UPDATE OR DELETE ON ar_documents
FOR EACH ROW EXECUTE FUNCTION trg_prevent_posted_ar_document_update_delete();

-- 2. Trigger Function for ar_document_lines Immutability
CREATE OR REPLACE FUNCTION trg_prevent_posted_ar_line_update_delete()
RETURNS TRIGGER AS $$
DECLARE
  parent_status VARCHAR(32);
BEGIN
  SELECT status INTO parent_status FROM ar_documents WHERE id = OLD.ar_document_id;
  IF parent_status = 'POSTED' THEN
    RAISE EXCEPTION 'AR document lines associated with POSTED AR documents are strictly immutable.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ar_document_lines_immutability ON ar_document_lines;
CREATE TRIGGER trg_ar_document_lines_immutability
BEFORE UPDATE OR DELETE ON ar_document_lines
FOR EACH ROW EXECUTE FUNCTION trg_prevent_posted_ar_line_update_delete();
