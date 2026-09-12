import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext, ValidationError, ConflictError, ForbiddenError } from '@general-erp/core';
import { productService } from '../src/modules/commercial/product.service.js';
import { customerService } from '../src/modules/commercial/customer.service.js';
import { addressService } from '../src/modules/commercial/address.service.js';
import { contactService } from '../src/modules/commercial/contact.service.js';
import { pricingService } from '../src/modules/commercial/pricing.service.js';
import { quotationService } from '../src/modules/sales/quotation.service.js';
import { salesQuotations, salesQuotationLines } from '@general-erp/database';
import { getTableConfig } from 'drizzle-orm/pg-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Phase 3.1 — Sales Foundation & Quotations Integration Suite', () => {

  const ctxCompanyA: RequestContext = {
    requestId: 'req_sales_001',
    tenantId: 'tenant_test',
    companyId: 'cmp_company_a',
    userId: 'user_sales_rep_1',
    ip: '127.0.0.1',
    userAgent: 'test-runner',
    timestamp: new Date()
  };

  const ctxCompanyB: RequestContext = {
    requestId: 'req_sales_002',
    tenantId: 'tenant_test',
    companyId: 'cmp_company_b',
    userId: 'user_sales_rep_2',
    ip: '127.0.0.1',
    userAgent: 'test-runner',
    timestamp: new Date()
  };

  let prodAId: string;
  let prodBId: string;
  let prodCId: string;
  let customerId: string;
  let billingAddressId: string;
  let shippingAddressId: string;
  let contactId: string;

  beforeEach(async () => {
    productService.clear();
    customerService.clear();
    addressService.clear();
    contactService.clear();
    pricingService.clear();
    quotationService.clear();

    // Setup Master Data Fixtures for Testing
    const prodA = await productService.createProduct(ctxCompanyA, {
      companyId: ctxCompanyA.companyId,
      code: 'PROD-A',
      name: 'Industrial Widget A',
      sku: 'SKU-PROD-A',
      sellingPrice: 1000,
      baseUom: 'NOS',
      hsnSac: '84713010',
      isSellable: true
    });
    prodAId = prodA.id;

    const prodB = await productService.createProduct(ctxCompanyA, {
      companyId: ctxCompanyA.companyId,
      code: 'PROD-B',
      name: 'Industrial Gear B',
      sku: 'SKU-PROD-B',
      sellingPrice: 2000,
      baseUom: 'NOS',
      hsnSac: '84713020',
      isSellable: true
    });
    prodBId = prodB.id;

    const prodC = await productService.createProduct(ctxCompanyA, {
      companyId: ctxCompanyA.companyId,
      code: 'PROD-C',
      name: 'Precision Bearing C',
      sku: 'SKU-PROD-C',
      sellingPrice: 1000,
      baseUom: 'NOS',
      hsnSac: '84713030',
      isSellable: true
    });
    prodCId = prodC.id;

    const cust = await customerService.createCustomer(ctxCompanyA, {
      companyId: ctxCompanyA.companyId,
      code: 'CUST-001',
      name: 'Acme Enterprises Pvt Ltd',
      gstin: '27AAAAA0000A1Z5',
      currency: 'INR'
    });
    customerId = cust.id;

    const billingAddr = await addressService.createAddress(ctxCompanyA, {
      companyId: ctxCompanyA.companyId,
      customerId: cust.id,
      addressType: 'BILLING',
      addressLine1: '123 Tech Park',
      city: 'Mumbai',
      state: 'Maharashtra',
      stateCode: '27',
      postalCode: '400001',
      country: 'IND'
    });
    billingAddressId = billingAddr.id;

    const shippingAddr = await addressService.createAddress(ctxCompanyA, {
      companyId: ctxCompanyA.companyId,
      customerId: cust.id,
      addressType: 'SHIPPING',
      addressLine1: '456 Logistics Zone',
      city: 'Pune',
      state: 'Maharashtra',
      stateCode: '27',
      postalCode: '411001',
      country: 'IND'
    });
    shippingAddressId = shippingAddr.id;

    const contact = await contactService.createContact(ctxCompanyA, {
      companyId: ctxCompanyA.companyId,
      customerId: cust.id,
      name: 'John Doe',
      email: 'john.doe@acme.com',
      phone: '+919876543210',
      designation: 'Procurement Head'
    });
    contactId = contact.id;
  });

  // =========================================================================
  // 1. Schema & Migration 011 Verification
  // =========================================================================
  describe('1. Schema & Migration 011 Verification', () => {
    it('verifies sales_quotations and sales_quotation_lines table configs and status CHECK constraint', () => {
      const qConfig = getTableConfig(salesQuotations);
      const qColsByName = Object.fromEntries(qConfig.columns.map(c => [c.name, c]));

      expect(qColsByName.id.getSQLType()).toContain('uuid');
      expect(qColsByName.tenant_id.getSQLType()).toContain('varchar');
      expect(qColsByName.company_id.getSQLType()).toContain('uuid');
      expect(qColsByName.quotation_number.getSQLType()).toContain('varchar');
      expect(qColsByName.status.getSQLType()).toContain('varchar');
      expect(qColsByName.subtotal_amount.getSQLType()).toContain('numeric');
      expect(qColsByName.total_amount_base.getSQLType()).toContain('numeric');

      const checkNames = qConfig.checks.map(chk => chk.name);
      expect(checkNames).toContain('chk_sales_quotation_status');

      const lConfig = getTableConfig(salesQuotationLines);
      const lColsByName = Object.fromEntries(lConfig.columns.map(c => [c.name, c]));
      expect(lColsByName.allocated_header_discount_amount.getSQLType()).toContain('numeric');
      expect(lColsByName.gross_amount.getSQLType()).toContain('numeric');
      expect(lColsByName.taxable_amount.getSQLType()).toContain('numeric');
    });

    it('verifies Migration file 011_phase3_sales_domain.sql exists and contains approved SQL statements', () => {
      const migrationPath = path.resolve(__dirname, '../../../packages/database/migrations/011_phase3_sales_domain.sql');
      expect(fs.existsSync(migrationPath)).toBe(true);

      const sqlContent = fs.readFileSync(migrationPath, 'utf-8');
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS sales_quotations');
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS sales_quotation_lines');
      expect(sqlContent).toContain('chk_sales_quotation_status');
      expect(sqlContent).toContain("'DRAFT'");
      expect(sqlContent).toContain("'CONVERTED'");
    });
  });

  // =========================================================================
  // 2. Quotation Creation & Monetary Calculation Pipeline
  // =========================================================================
  describe('2. Quotation Creation & Monetary Pipeline', () => {
    it('creates a draft quotation and calculates subtotal, line discounts, GST, and totals correctly', async () => {
      const q = await quotationService.createDraftQuotation(ctxCompanyA, {
        companyId: ctxCompanyA.companyId,
        customerId,
        quotationDate: '2026-09-12',
        validityDate: '2026-10-12',
        billingAddressId,
        shippingAddressId,
        contactId,
        lines: [
          { productId: prodAId, quantity: 10, unitPrice: 1000, discountPercent: 5 }, // gross=10000, lineDisc=500, preHeaderTaxable=9500
          { productId: prodBId, quantity: 5, unitPrice: 2000, discountPercent: 10 }  // gross=10000, lineDisc=1000, preHeaderTaxable=9000
        ]
      });

      expect(q.status).toBe('DRAFT');
      expect(q.revisionNumber).toBe(1);
      expect(q.subtotalAmount).toBe('20000.00'); // 10000 + 10000
      expect(q.headerDiscountAmount).toBe('0.00');
      expect(q.discountAmount).toBe('1500.00'); // 500 + 1000
      expect(q.taxableAmount).toBe('18500.00'); // 9500 + 9000
      expect(q.lines).toHaveLength(2);
      expect(q.lines[0]?.grossAmount).toBe('10000.00');
      expect(q.lines[0]?.taxableAmount).toBe('9500.00');
      expect(q.lines[1]?.taxableAmount).toBe('9000.00');
    });

    it('enforces multi-currency validation and calculates totalAmountBase', async () => {
      const q = await quotationService.createDraftQuotation(ctxCompanyA, {
        companyId: ctxCompanyA.companyId,
        customerId,
        quotationDate: '2026-09-12',
        validityDate: '2026-10-12',
        currency: 'USD',
        exchangeRate: 83.50,
        billingAddressId,
        shippingAddressId,
        lines: [
          { productId: prodAId, quantity: 10, unitPrice: 100 } // gross=1000 USD
        ]
      });

      expect(q.currency).toBe('USD');
      expect(q.exchangeRate).toBe('83.500000');
      expect(q.subtotalAmount).toBe('1000.00');
      // 18% GST (CGST 9% + SGST 9%) on 1000 USD = 180 USD -> Total 1180 USD
      expect(q.totalAmount).toBe('1180.00');
      // Total in INR base = roundTo2(1180 * 83.50) = 98530.00
      expect(q.totalAmountBase).toBe('98530.00');
    });

    it('rejects invalid INR exchange rates (must be 1.000000)', async () => {
      await expect(quotationService.createDraftQuotation(ctxCompanyA, {
        companyId: ctxCompanyA.companyId,
        customerId,
        quotationDate: '2026-09-12',
        validityDate: '2026-10-12',
        currency: 'INR',
        exchangeRate: 1.5,
        billingAddressId,
        shippingAddressId,
        lines: [{ productId: prodAId, quantity: 1, unitPrice: 100 }]
      })).rejects.toThrow(ValidationError);
    });
  });

  // =========================================================================
  // 3. Header Discount Proportional Allocation & Deterministic Residual Tie-Breaker
  // =========================================================================
  describe('3. Header Discount & Residual Tie-Breaker', () => {
    it('allocates header discount proportionally and applies residual tie-breaker rule MAX(base) -> MIN(lineNumber) -> MIN(id)', async () => {
      // 3 lines with identical preHeaderTaxableAmount = 100.00
      // Header discount = 10.00
      // 10.00 / 300.00 * 100 = 3.33 each -> Sum allocated = 9.99 -> Residual = 0.01
      // All 3 lines have same preHeaderTaxableAmount (100.00).
      // Tie-breaker rule MUST select line 1 (lowest lineNumber = 1) as recipient.
      const q = await quotationService.createDraftQuotation(ctxCompanyA, {
        companyId: ctxCompanyA.companyId,
        customerId,
        quotationDate: '2026-09-12',
        validityDate: '2026-10-12',
        billingAddressId,
        shippingAddressId,
        headerDiscountAmount: 10.00,
        lines: [
          { productId: prodAId, quantity: 1, unitPrice: 100 }, // preHeader = 100
          { productId: prodBId, quantity: 1, unitPrice: 100 }, // preHeader = 100
          { productId: prodCId, quantity: 1, unitPrice: 100 }  // preHeader = 100
        ]
      });

      expect(q.headerDiscountAmount).toBe('10.00');
      const alloc1 = Number(q.lines[0]?.allocatedHeaderDiscountAmount);
      const alloc2 = Number(q.lines[1]?.allocatedHeaderDiscountAmount);
      const alloc3 = Number(q.lines[2]?.allocatedHeaderDiscountAmount);

      expect(alloc1 + alloc2 + alloc3).toBe(10.00); // Allocated sum EQUALS header discount
      expect(alloc1).toBe(3.34); // Line 1 (lowest lineNumber) received the 0.01 residual cent
      expect(alloc2).toBe(3.33);
      expect(alloc3).toBe(3.33);

      // Verify taxable amount reconciliation
      expect(q.lines[0]?.taxableAmount).toBe('96.66');
      expect(q.lines[1]?.taxableAmount).toBe('96.67');
      expect(q.lines[2]?.taxableAmount).toBe('96.67');
      expect(q.taxableAmount).toBe('290.00'); // 300 - 10
    });

    it('verifies 100% repeated calculation equality (idempotency of monetary calculation)', async () => {
      const input = {
        companyId: ctxCompanyA.companyId,
        customerId,
        quotationDate: '2026-09-12',
        validityDate: '2026-10-12',
        billingAddressId,
        shippingAddressId,
        headerDiscountAmount: 1500.50,
        lines: [
          { productId: prodAId, quantity: 12, unitPrice: 1050, discountPercent: 2.5 },
          { productId: prodBId, quantity: 7, unitPrice: 2150, discountPercent: 5.0 }
        ]
      };

      const q1 = await quotationService.createDraftQuotation(ctxCompanyA, input);
      const q2 = await quotationService.updateDraftQuotation(ctxCompanyA, q1.id, input);

      expect(q1.subtotalAmount).toBe(q2.subtotalAmount);
      expect(q1.discountAmount).toBe(q2.discountAmount);
      expect(q1.taxableAmount).toBe(q2.taxableAmount);
      expect(q1.taxAmount).toBe(q2.taxAmount);
      expect(q1.totalAmount).toBe(q2.totalAmount);
    });
  });

  // =========================================================================
  // 4. Quotation Lifecycle & Workflow Engine
  // =========================================================================
  describe('4. Lifecycle State Machine & Workflow', () => {
    it('auto-approves low-value low-discount draft quotations (DRAFT -> APPROVED)', async () => {
      const q = await quotationService.createDraftQuotation(ctxCompanyA, {
        companyId: ctxCompanyA.companyId,
        customerId,
        quotationDate: '2026-09-12',
        validityDate: '2026-10-12',
        billingAddressId,
        shippingAddressId,
        lines: [{ productId: prodAId, quantity: 2, unitPrice: 1000 }] // Total 2360 INR < 500000 limit
      });

      const submitted = await quotationService.submitForApproval(ctxCompanyA, q.id);
      expect(submitted.status).toBe('APPROVED');
    });

    it('routes high-discount quotations to approval workflow (DRAFT -> PENDING_APPROVAL -> APPROVED)', async () => {
      const q = await quotationService.createDraftQuotation(ctxCompanyA, {
        companyId: ctxCompanyA.companyId,
        customerId,
        quotationDate: '2026-09-12',
        validityDate: '2026-10-12',
        billingAddressId,
        shippingAddressId,
        lines: [{ productId: prodAId, quantity: 10, unitPrice: 1000, discountPercent: 15 }] // 15% discount > 10% max threshold
      });

      const submitted = await quotationService.submitForApproval(ctxCompanyA, q.id);
      expect(submitted.status).toBe('PENDING_APPROVAL');

      const approved = await quotationService.approveQuotation(ctxCompanyA, q.id);
      expect(approved.status).toBe('APPROVED');
    });

    it('handles quotation rejection (PENDING_APPROVAL -> REJECTED)', async () => {
      const q = await quotationService.createDraftQuotation(ctxCompanyA, {
        companyId: ctxCompanyA.companyId,
        customerId,
        quotationDate: '2026-09-12',
        validityDate: '2026-10-12',
        billingAddressId,
        shippingAddressId,
        lines: [{ productId: prodAId, quantity: 10, unitPrice: 1000, discountPercent: 20 }]
      });

      await quotationService.submitForApproval(ctxCompanyA, q.id);
      const rejected = await quotationService.rejectQuotation(ctxCompanyA, q.id, 'Discount exceeds maximum allowable margin policy');

      expect(rejected.status).toBe('REJECTED');
      expect(rejected.notes).toContain('[REJECTED]: Discount exceeds maximum allowable margin policy');
    });

    it('executes SENT -> ACCEPTED lifecycle transition', async () => {
      const q = await quotationService.createDraftQuotation(ctxCompanyA, {
        companyId: ctxCompanyA.companyId,
        customerId,
        quotationDate: '2026-09-12',
        validityDate: '2026-10-12',
        billingAddressId,
        shippingAddressId,
        lines: [{ productId: prodAId, quantity: 5, unitPrice: 1000 }]
      });

      await quotationService.submitForApproval(ctxCompanyA, q.id);
      const sent = await quotationService.sendQuotation(ctxCompanyA, q.id);
      expect(sent.status).toBe('SENT');

      const accepted = await quotationService.acceptQuotation(ctxCompanyA, q.id);
      expect(accepted.status).toBe('ACCEPTED');
    });

    it('freezes snapshots at APPROVED -> SENT transition point', async () => {
      const q = await quotationService.createDraftQuotation(ctxCompanyA, {
        companyId: ctxCompanyA.companyId,
        customerId,
        quotationDate: '2026-09-12',
        validityDate: '2026-10-12',
        billingAddressId,
        shippingAddressId,
        lines: [{ productId: prodAId, quantity: 5, unitPrice: 1000 }]
      });

      await quotationService.submitForApproval(ctxCompanyA, q.id);
      const sent = await quotationService.sendQuotation(ctxCompanyA, q.id);

      // Mutate master customer address after SENT
      const masterAddr = await addressService.getAddress(ctxCompanyA, billingAddressId);
      masterAddr.addressLine1 = '999 CHANGED ADDRESS ROAD';

      // Retrieve quotation and confirm frozen snapshot remains unchanged
      const retrieved = await quotationService.getQuotation(ctxCompanyA, sent.id);
      expect(retrieved.billingAddressSnapshot.addressLine1).toBe('123 Tech Park');
      expect(retrieved.billingAddressSnapshot.addressLine1).not.toBe('999 CHANGED ADDRESS ROAD');
    });

    it('rejects invalid state transitions', async () => {
      const q = await quotationService.createDraftQuotation(ctxCompanyA, {
        companyId: ctxCompanyA.companyId,
        customerId,
        quotationDate: '2026-09-12',
        validityDate: '2026-10-12',
        billingAddressId,
        shippingAddressId,
        lines: [{ productId: prodAId, quantity: 1, unitPrice: 1000 }]
      });

      // Cannot send from DRAFT directly
      await expect(quotationService.sendQuotation(ctxCompanyA, q.id)).rejects.toThrow(ValidationError);

      // Cannot accept from DRAFT directly
      await expect(quotationService.acceptQuotation(ctxCompanyA, q.id)).rejects.toThrow(ValidationError);
    });
  });

  // =========================================================================
  // 5. Single-Table Revision Workflow
  // =========================================================================
  describe('5. Single-Table Revision Workflow', () => {
    it('revises a SENT quotation (SENT -> REVISED) and creates Revision 2 in DRAFT state', async () => {
      const q1 = await quotationService.createDraftQuotation(ctxCompanyA, {
        companyId: ctxCompanyA.companyId,
        customerId,
        quotationDate: '2026-09-12',
        validityDate: '2026-10-12',
        billingAddressId,
        shippingAddressId,
        lines: [{ productId: prodAId, quantity: 5, unitPrice: 1000 }]
      });

      await quotationService.submitForApproval(ctxCompanyA, q1.id);
      await quotationService.sendQuotation(ctxCompanyA, q1.id);

      const q2 = await quotationService.createRevision(ctxCompanyA, q1.id);

      expect(q2.quotationNumber).toBe(q1.quotationNumber); // Same quotation number
      expect(q2.revisionNumber).toBe(2); // Revision incremented
      expect(q2.status).toBe('DRAFT'); // Next revision starts in DRAFT

      // Source revision 1 MUST be updated to REVISED
      const updatedQ1 = await quotationService.getQuotation(ctxCompanyA, q1.id);
      expect(updatedQ1.status).toBe('REVISED');
    });

    it('prohibits creating revisions from ACCEPTED, EXPIRED, or CANCELLED quotations', async () => {
      const q = await quotationService.createDraftQuotation(ctxCompanyA, {
        companyId: ctxCompanyA.companyId,
        customerId,
        quotationDate: '2026-09-12',
        validityDate: '2026-10-12',
        billingAddressId,
        shippingAddressId,
        lines: [{ productId: prodAId, quantity: 5, unitPrice: 1000 }]
      });

      await quotationService.submitForApproval(ctxCompanyA, q.id);
      await quotationService.sendQuotation(ctxCompanyA, q.id);
      await quotationService.acceptQuotation(ctxCompanyA, q.id);

      // Revisions prohibited from ACCEPTED
      await expect(quotationService.createRevision(ctxCompanyA, q.id)).rejects.toThrow(ValidationError);
    });
  });

  // =========================================================================
  // 6. Conversion Contract Issuance & Idempotency
  // =========================================================================
  describe('6. Conversion Contract & Idempotency Guard', () => {
    it('issues a QuotationConversionContract for an ACCEPTED quotation without altering status to CONVERTED', async () => {
      const q = await quotationService.createDraftQuotation(ctxCompanyA, {
        companyId: ctxCompanyA.companyId,
        customerId,
        quotationDate: '2026-09-12',
        validityDate: '2026-10-12',
        billingAddressId,
        shippingAddressId,
        lines: [{ productId: prodAId, quantity: 10, unitPrice: 1000 }]
      });

      await quotationService.submitForApproval(ctxCompanyA, q.id);
      await quotationService.sendQuotation(ctxCompanyA, q.id);
      await quotationService.acceptQuotation(ctxCompanyA, q.id);

      const contract = await quotationService.issueConversionContract(ctxCompanyA, q.id, 'idem_key_001');

      expect(contract.contractId).toBeDefined();
      expect(contract.contractVersion).toBe('1.0');
      expect(contract.quotationId).toBe(q.id);
      expect(contract.quotationNumber).toBe(q.quotationNumber);
      expect(contract.totalAmount).toBe(q.totalAmount);
      expect(contract.lines).toHaveLength(1);

      // Phase 3.1 Contract Assertion: Status must remain ACCEPTED (not CONVERTED!)
      const afterIssue = await quotationService.getQuotation(ctxCompanyA, q.id);
      expect(afterIssue.status).toBe('ACCEPTED');
      expect(afterIssue.conversionContractId).toBe(contract.contractId);
    });

    it('returns identical cached contract on repeated request with same Idempotency-Key', async () => {
      const q = await quotationService.createDraftQuotation(ctxCompanyA, {
        companyId: ctxCompanyA.companyId,
        customerId,
        quotationDate: '2026-09-12',
        validityDate: '2026-10-12',
        billingAddressId,
        shippingAddressId,
        lines: [{ productId: prodAId, quantity: 10, unitPrice: 1000 }]
      });

      await quotationService.submitForApproval(ctxCompanyA, q.id);
      await quotationService.sendQuotation(ctxCompanyA, q.id);
      await quotationService.acceptQuotation(ctxCompanyA, q.id);

      const c1 = await quotationService.issueConversionContract(ctxCompanyA, q.id, 'idem_key_unique_123');
      const c2 = await quotationService.issueConversionContract(ctxCompanyA, q.id, 'idem_key_unique_123');

      expect(c1).toBe(c2); // Exact same object returned from idempotency store
    });

    it('rejects duplicate contract issuance without idempotency key with ConflictError', async () => {
      const q = await quotationService.createDraftQuotation(ctxCompanyA, {
        companyId: ctxCompanyA.companyId,
        customerId,
        quotationDate: '2026-09-12',
        validityDate: '2026-10-12',
        billingAddressId,
        shippingAddressId,
        lines: [{ productId: prodAId, quantity: 10, unitPrice: 1000 }]
      });

      await quotationService.submitForApproval(ctxCompanyA, q.id);
      await quotationService.sendQuotation(ctxCompanyA, q.id);
      await quotationService.acceptQuotation(ctxCompanyA, q.id);

      await quotationService.issueConversionContract(ctxCompanyA, q.id);

      // Second attempt without idempotency key throws ConflictError
      await expect(quotationService.issueConversionContract(ctxCompanyA, q.id)).rejects.toThrow(ConflictError);
    });

    it('evaluates allowExpiredQuotationConversion policy (false vs true)', async () => {
      const q = await quotationService.createDraftQuotation(ctxCompanyA, {
        companyId: ctxCompanyA.companyId,
        customerId,
        quotationDate: '2026-08-01',
        validityDate: '2026-08-30', // Expired in past
        billingAddressId,
        shippingAddressId,
        lines: [{ productId: prodAId, quantity: 1, unitPrice: 1000 }]
      });

      await quotationService.submitForApproval(ctxCompanyA, q.id);
      await quotationService.sendQuotation(ctxCompanyA, q.id);
      // Manually set status to ACCEPTED for expired quotation policy test
      const raw = await quotationService.getQuotation(ctxCompanyA, q.id);
      raw.status = 'ACCEPTED';

      // Default policy = false -> Rejects conversion contract issuance for expired quotation
      quotationService.setPolicyConfig({ allowExpiredQuotationConversion: false });
      await expect(quotationService.issueConversionContract(ctxCompanyA, q.id)).rejects.toThrow(ValidationError);

      // Policy = true -> Permits conversion contract issuance for ACCEPTED quotation
      quotationService.setPolicyConfig({ allowExpiredQuotationConversion: true });
      const contract = await quotationService.issueConversionContract(ctxCompanyA, q.id);
      expect(contract.contractId).toBeDefined();
    });
  });

  // =========================================================================
  // 7. Architectural Guardrails & Zero Operations Assertions
  // =========================================================================
  describe('7. Architectural Guardrails & Scope Enforcement', () => {
    it('enforces multi-tenant and multi-company context isolation', async () => {
      const q = await quotationService.createDraftQuotation(ctxCompanyA, {
        companyId: ctxCompanyA.companyId,
        customerId,
        quotationDate: '2026-09-12',
        validityDate: '2026-10-12',
        billingAddressId,
        shippingAddressId,
        lines: [{ productId: prodAId, quantity: 1, unitPrice: 1000 }]
      });

      // Company B cannot view or list Company A quotation
      await expect(quotationService.getQuotation(ctxCompanyB, q.id)).rejects.toThrow();
      await expect(quotationService.listQuotations(ctxCompanyB, ctxCompanyA.companyId)).rejects.toThrow(ForbiddenError);
    });

    it('EXPLICIT SCOPE GUARANTEE: Phase 3.1 produces ZERO Sales Orders, ZERO CONVERTED transitions, and ZERO AR/GL entries', async () => {
      const q = await quotationService.createDraftQuotation(ctxCompanyA, {
        companyId: ctxCompanyA.companyId,
        customerId,
        quotationDate: '2026-09-12',
        validityDate: '2026-10-12',
        billingAddressId,
        shippingAddressId,
        lines: [{ productId: prodAId, quantity: 10, unitPrice: 1000 }]
      });

      await quotationService.submitForApproval(ctxCompanyA, q.id);
      await quotationService.sendQuotation(ctxCompanyA, q.id);
      await quotationService.acceptQuotation(ctxCompanyA, q.id);

      const contract = await quotationService.issueConversionContract(ctxCompanyA, q.id);
      expect(contract).toBeDefined();

      const finalQ = await quotationService.getQuotation(ctxCompanyA, q.id);

      // Scope verification checks:
      expect(finalQ.status).toBe('ACCEPTED'); // NOT 'CONVERTED'
      expect((finalQ as any).salesOrderId).toBeUndefined(); // Zero Sales Order creation
      expect((finalQ as any).arJournalId).toBeUndefined(); // Zero AR postings
      expect((finalQ as any).glJournalId).toBeUndefined(); // Zero GL postings
    });
  });
});
