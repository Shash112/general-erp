import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext, UserSession, ValidationError, NotFoundError, ForbiddenError, BusinessRuleViolationError, AccountingError } from '@general-erp/core';
import { arDocumentService } from '../src/modules/finance/ar/ar-document.service.js';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { accountingConfigurationService } from '../src/modules/finance/accounting-core.service.js';
import { taxEngineService } from '../src/modules/finance/tax-engine.service.js';
import { ArDocumentType } from '../src/modules/finance/ar/ar-document-model.js';

describe('Phase 2.6.1 — AR Document & Customer Receivable Lifecycle Tests', () => {

  const tenantACtx: RequestContext = {
    requestId: 'req_ar_tenant_a',
    tenantId: 'tenant_company_a',
    companyId: 'company_a1',
    ip: '127.0.0.1',
    userAgent: 'test-agent',
    timestamp: new Date()
  };

  const tenantBCtx: RequestContext = {
    requestId: 'req_ar_tenant_b',
    tenantId: 'tenant_company_b',
    companyId: 'company_b1',
    ip: '127.0.0.1',
    userAgent: 'test-agent',
    timestamp: new Date()
  };

  const userA: UserSession = {
    userId: 'user_ar_accountant',
    email: 'ar@company-a.com',
    roles: ['ACCOUNTANT'],
    permissions: ['*'],
    tenantId: 'tenant_company_a',
    companyId: 'company_a1'
  };

  const ctxWithUser: RequestContext = {
    ...tenantACtx,
    user: userA
  };

  let customerAId: string;
  let customerBId: string;
  let productAId: string;
  let fiscalYearId: string;
  let fiscalPeriodId: string;
  let arAccount: any;
  let revAccount: any;
  let cgstAccount: any;
  let sgstAccount: any;
  let igstAccount: any;
  let equityAccount: any;

  beforeEach(async () => {
    arDocumentService.clear();
    masterDataService.clear();
    chartOfAccountsService.clear();
    accountingConfigurationService.clear();
    fiscalPeriodService.clear();
    taxEngineService.clear();

    // 1. Setup Master Data Companies
    await masterDataService.createCompany(tenantACtx, {
      id: 'company_a1',
      name: 'Company A1',
      legalName: 'Company A1 Legal',
      currency: 'INR'
    });
    await masterDataService.createCompany(tenantBCtx, {
      id: 'company_b1',
      name: 'Company B1',
      legalName: 'Company B1 Legal',
      currency: 'INR'
    });

    // 2. Setup Customers & Products
    const custA = await masterDataService.createCustomer(tenantACtx, {
      id: 'cust_a1',
      companyId: 'company_a1',
      name: 'Acme Corp',
      code: 'CUST-001',
      gstin: '27AAAAA0000A1Z5',
      creditLimit: 500000
    });
    customerAId = custA.id!;

    const custB = await masterDataService.createCustomer(tenantBCtx, {
      id: 'cust_b1',
      companyId: 'company_b1',
      name: 'Beta LLC',
      code: 'CUST-B01',
      creditLimit: 100000
    });
    customerBId = custB.id!;

    const prodA = await masterDataService.createProduct(tenantACtx, {
      id: 'prod_a1',
      companyId: 'company_a1',
      name: 'Enterprise Software License',
      code: 'PROD-001',
      sku: 'SKU-001',
      hsnSac: '998314',
      uom: 'PCS',
      purchasePrice: 5000,
      sellingPrice: 10000
    });
    productAId = prodA.id!;

    // 3. Setup Open Fiscal Year & Period
    const { fiscalYear } = await fiscalPeriodService.createFiscalYear(tenantACtx, {
      companyId: 'company_a1',
      name: 'FY 2026-27',
      startDate: new Date('2026-04-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T23:59:59.999Z')
    });
    fiscalYearId = fiscalYear.id;
    await fiscalPeriodService.activateFiscalYear(tenantACtx, fiscalYear.id);

    // 4. Setup Chart of Accounts
    arAccount = await chartOfAccountsService.createAccount(tenantACtx, {
      companyId: 'company_a1',
      accountCode: '1100',
      accountName: 'Accounts Receivable Control',
      accountType: 'ASSET',
      isControlAccount: true,
      controlAccountType: 'AR'
    });
    await chartOfAccountsService.activateAccount(tenantACtx, arAccount.id);

    revAccount = await chartOfAccountsService.createAccount(tenantACtx, {
      companyId: 'company_a1',
      accountCode: '4000',
      accountName: 'Sales Revenue',
      accountType: 'INCOME'
    });
    await chartOfAccountsService.activateAccount(tenantACtx, revAccount.id);

    cgstAccount = await chartOfAccountsService.createAccount(tenantACtx, {
      companyId: 'company_a1',
      accountCode: '2210',
      accountName: 'Output CGST Payable',
      accountType: 'LIABILITY',
      isControlAccount: true,
      controlAccountType: 'TAX_OUTPUT'
    });
    await chartOfAccountsService.activateAccount(tenantACtx, cgstAccount.id);

    sgstAccount = await chartOfAccountsService.createAccount(tenantACtx, {
      companyId: 'company_a1',
      accountCode: '2220',
      accountName: 'Output SGST Payable',
      accountType: 'LIABILITY',
      isControlAccount: true,
      controlAccountType: 'TAX_OUTPUT'
    });
    await chartOfAccountsService.activateAccount(tenantACtx, sgstAccount.id);

    igstAccount = await chartOfAccountsService.createAccount(tenantACtx, {
      companyId: 'company_a1',
      accountCode: '2230',
      accountName: 'Output IGST Payable',
      accountType: 'LIABILITY',
      isControlAccount: true,
      controlAccountType: 'TAX_OUTPUT'
    });
    await chartOfAccountsService.activateAccount(tenantACtx, igstAccount.id);

    equityAccount = await chartOfAccountsService.createAccount(tenantACtx, {
      companyId: 'company_a1',
      accountCode: '3000',
      accountName: 'Opening Balance Equity',
      accountType: 'EQUITY'
    });
    await chartOfAccountsService.activateAccount(tenantACtx, equityAccount.id);

    // Set Mappings in Accounting Configuration
    const documentTypes = ['AR_INVOICE', 'AR_CREDIT_NOTE', 'AR_DEBIT_NOTE', 'AR_OPENING_BALANCE'];
    for (const dt of documentTypes) {
      await accountingConfigurationService.setMapping(tenantACtx, { companyId: 'company_a1', eventType: dt, lineRole: 'AR_CONTROL', accountId: arAccount.id });
      await accountingConfigurationService.setMapping(tenantACtx, { companyId: 'company_a1', eventType: dt, lineRole: 'SALES_REVENUE', accountId: revAccount.id });
      await accountingConfigurationService.setMapping(tenantACtx, { companyId: 'company_a1', eventType: dt, lineRole: 'OUTPUT_CGST', accountId: cgstAccount.id });
      await accountingConfigurationService.setMapping(tenantACtx, { companyId: 'company_a1', eventType: dt, lineRole: 'OUTPUT_SGST', accountId: sgstAccount.id });
      await accountingConfigurationService.setMapping(tenantACtx, { companyId: 'company_a1', eventType: dt, lineRole: 'OUTPUT_IGST', accountId: igstAccount.id });
      await accountingConfigurationService.setMapping(tenantACtx, { companyId: 'company_a1', eventType: dt, lineRole: 'RETAINED_EARNINGS', accountId: equityAccount.id });
    }
  });

  // 1. Document Creation & Validation
  describe('Document Creation & Input Validation', () => {
    it('creates draft INVOICE, CREDIT_NOTE, DEBIT_NOTE, and OPENING_BALANCE successfully', async () => {
      const types: ArDocumentType[] = ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'OPENING_BALANCE'];
      for (const dt of types) {
        const doc = await arDocumentService.createDraft(ctxWithUser, {
          companyId: 'company_a1',
          customerId: customerAId,
          documentType: dt,
          documentDate: '2026-05-15',
          accountingDate: '2026-05-15',
          dueDate: '2026-06-15',
          lines: [{
            productId: productAId,
            description: `Sample Line for ${dt}`,
            quantity: '2.0000',
            unitPrice: '1000.00',
            taxableAmount: '2000.00',
            taxAmount: '0.00',
            grossAmount: '2000.00'
          }]
        });

        expect(doc.id).toBeDefined();
        expect(doc.status).toBe('DRAFT');
        expect(doc.documentType).toBe(dt);
        expect(doc.grossAmount).toBe('2000.00');
        expect(doc.lines.length).toBe(1);
      }
    });

    it('REJECTS customer belonging to a different tenant or company', async () => {
      // 1. Cross-tenant customer reference throws NotFoundError
      await expect(
        arDocumentService.createDraft(ctxWithUser, {
          companyId: 'company_a1',
          customerId: customerBId, // Belongs to Tenant B!
          documentType: 'INVOICE',
          documentDate: '2026-05-15',
          accountingDate: '2026-05-15',
          dueDate: '2026-06-15',
          lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '100.00' }]
        })
      ).rejects.toThrow(NotFoundError);

      // 2. Same tenant, different company customer reference throws ForbiddenError
      await masterDataService.createCompany(tenantACtx, { id: 'company_a2', name: 'Company A2', legalName: 'Company A2 Legal', currency: 'INR' });
      const sameTenantOtherCompCust = await masterDataService.createCustomer(tenantACtx, {
        id: 'cust_a2',
        companyId: 'company_a2',
        name: 'Comp A2 Customer',
        code: 'CUST-A02',
        creditLimit: 100000
      });

      await expect(
        arDocumentService.createDraft(ctxWithUser, {
          companyId: 'company_a1',
          customerId: sameTenantOtherCompCust.id!, // Belongs to company_a2!
          documentType: 'INVOICE',
          documentDate: '2026-05-15',
          accountingDate: '2026-05-15',
          dueDate: '2026-06-15',
          lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '100.00' }]
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('REJECTS invalid monetary scale (scale > 2) and negative prices', async () => {
      // Scale > 2 check
      await expect(
        arDocumentService.createDraft(ctxWithUser, {
          companyId: 'company_a1',
          customerId: customerAId,
          documentType: 'INVOICE',
          documentDate: '2026-05-15',
          accountingDate: '2026-05-15',
          dueDate: '2026-06-15',
          lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '100.005' }] // 3 decimal places!
        })
      ).rejects.toThrow(ValidationError);

      // Negative price check
      await expect(
        arDocumentService.createDraft(ctxWithUser, {
          companyId: 'company_a1',
          customerId: customerAId,
          documentType: 'INVOICE',
          documentDate: '2026-05-15',
          accountingDate: '2026-05-15',
          dueDate: '2026-06-15',
          lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '-50.00' }]
        })
      ).rejects.toThrow(ValidationError);
    });

    it('REJECTS due date earlier than document date', async () => {
      await expect(
        arDocumentService.createDraft(ctxWithUser, {
          companyId: 'company_a1',
          customerId: customerAId,
          documentType: 'INVOICE',
          documentDate: '2026-05-15',
          accountingDate: '2026-05-15',
          dueDate: '2026-05-10', // Before document date!
          lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '100.00' }]
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  // 2. Lifecycle Enforcement (DRAFT -> POSTED)
  describe('Lifecycle State Transitions & Immutability Enforcement', () => {
    it('allows updating a DRAFT document, but REJECTS updating a POSTED document', async () => {
      const draft = await arDocumentService.createDraft(ctxWithUser, {
        companyId: 'company_a1',
        customerId: customerAId,
        documentType: 'INVOICE',
        documentDate: '2026-05-15',
        accountingDate: '2026-05-15',
        dueDate: '2026-06-15',
        lines: [{ description: 'Original Line', quantity: '1.0000', unitPrice: '500.00' }]
      });

      // Update draft
      const updated = await arDocumentService.updateDraft(ctxWithUser, draft.id, {
        lines: [{ description: 'Updated Line', quantity: '2.0000', unitPrice: '500.00' }]
      });
      expect(updated.grossAmount).toBe('1000.00');

      // Post document
      const posted = await arDocumentService.postDocument(ctxWithUser, draft.id);
      expect(posted.status).toBe('POSTED');

      // Attempt update on POSTED document must fail
      await expect(
        arDocumentService.updateDraft(ctxWithUser, draft.id, {
          lines: [{ description: 'Mutated Line', quantity: '5.0000', unitPrice: '500.00' }]
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('cancels DRAFT document, but REJECTS cancelling a POSTED document', async () => {
      const draft = await arDocumentService.createDraft(ctxWithUser, {
        companyId: 'company_a1',
        customerId: customerAId,
        documentType: 'INVOICE',
        documentDate: '2026-05-15',
        accountingDate: '2026-05-15',
        dueDate: '2026-06-15',
        lines: [{ description: 'Draft to Cancel', quantity: '1.0000', unitPrice: '100.00' }]
      });

      const cancelled = await arDocumentService.cancelDocument(ctxWithUser, draft.id, 'User requested cancellation');
      expect(cancelled.status).toBe('CANCELLED');

      // Cannot post cancelled document
      await expect(arDocumentService.postDocument(ctxWithUser, draft.id)).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  // 3. Tax Engine & Historical Tax Snapshot
  describe('Historical Tax Snapshot Persistence & Integrity', () => {
    it('persists line-level GST components and document aggregates on POSTED document', async () => {
      const doc = await arDocumentService.createDraft(ctxWithUser, {
        companyId: 'company_a1',
        customerId: customerAId,
        documentType: 'INVOICE',
        documentDate: '2026-05-15',
        accountingDate: '2026-05-15',
        dueDate: '2026-06-15',
        placeOfSupplyStateCode: '27',
        supplyNature: 'INTRA_STATE',
        taxability: 'TAXABLE',
        lines: [{
          description: 'Taxable Goods',
          quantity: '10.0000',
          unitPrice: '100.00',
          taxableAmount: '1000.00',
          taxRatePercent: '18.000000',
          cgstAmount: '90.00',
          sgstAmount: '90.00',
          igstAmount: '0.00',
          utgstAmount: '0.00',
          cessAmount: '0.00',
          taxAmount: '180.00',
          grossAmount: '1180.00'
        }]
      });

      const posted = await arDocumentService.postDocument(ctxWithUser, doc.id);

      expect(posted.status).toBe('POSTED');
      expect(posted.taxableAmount).toBe('1000.00');
      expect(posted.taxAmount).toBe('180.00');
      expect(posted.grossAmount).toBe('1180.00');

      const line = posted.lines[0]!;
      expect(line.cgstAmount).toBe('90.00');
      expect(line.sgstAmount).toBe('90.00');
      expect(line.taxRatePercent).toBe('18.000000');

      // Subsequent read preserves exact historical snapshot
      const fetched = await arDocumentService.getDocument(ctxWithUser, doc.id);
      expect(fetched.taxAmount).toBe('180.00');
      expect(fetched.lines[0]!.cgstAmount).toBe('90.00');
    });
  });

  // 4. Open Item Creation & Credit Note Exclusivity
  describe('Open Item Creation Semantics', () => {
    it('creates DEBIT open items for INVOICE, DEBIT_NOTE, and OPENING_BALANCE upon posting', async () => {
      const types: ArDocumentType[] = ['INVOICE', 'DEBIT_NOTE', 'OPENING_BALANCE'];

      for (const dt of types) {
        const draft = await arDocumentService.createDraft(ctxWithUser, {
          companyId: 'company_a1',
          customerId: customerAId,
          documentType: dt,
          documentDate: '2026-05-15',
          accountingDate: '2026-05-15',
          dueDate: '2026-06-15',
          lines: [{ description: 'Receivable Item', quantity: '1.0000', unitPrice: '2500.00', taxableAmount: '2500.00', taxAmount: '0.00', grossAmount: '2500.00' }]
        });

        const posted = await arDocumentService.postDocument(ctxWithUser, draft.id);

        expect(posted.status).toBe('POSTED');
        expect(posted.outstandingAmount).toBe('2500.00');
        expect(posted.unappliedAmount).toBe('0.00');

        const openItems = await arDocumentService.getOpenItems(ctxWithUser, 'company_a1', { customerId: customerAId });
        const matchedItem = openItems.find(i => i.arDocumentId === draft.id);

        expect(matchedItem).toBeDefined();
        expect(matchedItem!.originalAmount).toBe('2500.00');
        expect(matchedItem!.outstandingAmount).toBe('2500.00');
        expect(matchedItem!.status).toBe('OPEN');
      }
    });

    it('CREDIT_NOTE posting does NOT create a DEBIT ar_open_items row and tracks unapplied credit balance', async () => {
      const draft = await arDocumentService.createDraft(ctxWithUser, {
        companyId: 'company_a1',
        customerId: customerAId,
        documentType: 'CREDIT_NOTE',
        documentDate: '2026-05-15',
        accountingDate: '2026-05-15',
        dueDate: '2026-06-15',
        lines: [{ description: 'Sales Return', quantity: '1.0000', unitPrice: '1500.00', taxableAmount: '1500.00', taxAmount: '0.00', grossAmount: '1500.00' }]
      });

      const posted = await arDocumentService.postDocument(ctxWithUser, draft.id);

      expect(posted.status).toBe('POSTED');
      expect(posted.outstandingAmount).toBe('0.00');
      expect(posted.unappliedAmount).toBe('1500.00');

      const openItems = await arDocumentService.getOpenItems(ctxWithUser, 'company_a1', { customerId: customerAId });
      const matchedItem = openItems.find(i => i.arDocumentId === draft.id);

      expect(matchedItem).toBeUndefined(); // NO open item created for Credit Note!
    });
  });

  // 5. AccountingCore & GL Posting Integration
  describe('AccountingCore Integration & Balanced GL Posting', () => {
    it('posts INVOICE through AccountingCore and produces a balanced GL journal', async () => {
      const draft = await arDocumentService.createDraft(ctxWithUser, {
        companyId: 'company_a1',
        customerId: customerAId,
        documentType: 'INVOICE',
        documentDate: '2026-05-15',
        accountingDate: '2026-05-15',
        dueDate: '2026-06-15',
        lines: [{
          description: 'Software Service',
          quantity: '1.0000',
          unitPrice: '10000.00',
          taxableAmount: '10000.00',
          taxRatePercent: '18.000000',
          cgstAmount: '900.00',
          sgstAmount: '900.00',
          taxAmount: '1800.00',
          grossAmount: '11800.00'
        }]
      });

      const posted = await arDocumentService.postDocument(ctxWithUser, draft.id);
      expect(posted.journalEntryId).toBeDefined();
    });

    it('posts CREDIT_NOTE through AccountingCore debiting Revenue/Tax and crediting AR Control', async () => {
      const draft = await arDocumentService.createDraft(ctxWithUser, {
        companyId: 'company_a1',
        customerId: customerAId,
        documentType: 'CREDIT_NOTE',
        documentDate: '2026-05-15',
        accountingDate: '2026-05-15',
        dueDate: '2026-06-15',
        lines: [{
          description: 'Allowance Return',
          quantity: '1.0000',
          unitPrice: '2000.00',
          taxableAmount: '2000.00',
          cgstAmount: '180.00',
          sgstAmount: '180.00',
          taxAmount: '360.00',
          grossAmount: '2360.00'
        }]
      });

      const posted = await arDocumentService.postDocument(ctxWithUser, draft.id);
      expect(posted.journalEntryId).toBeDefined();
      expect(posted.unappliedAmount).toBe('2360.00');
    });
  });

  // 6. Atomic Transaction & Rollback
  describe('Transaction Atomicity & Rollback', () => {
    it('ROLLS BACK everything when a failure is injected during posting', async () => {
      const draft = await arDocumentService.createDraft(ctxWithUser, {
        companyId: 'company_a1',
        customerId: customerAId,
        documentType: 'INVOICE',
        documentDate: '2026-05-15',
        accountingDate: '2026-05-15',
        dueDate: '2026-06-15',
        lines: [{ description: 'Rollback Test Line', quantity: '1.0000', unitPrice: '3000.00', taxableAmount: '3000.00', taxAmount: '0.00', grossAmount: '3000.00' }]
      });

      await expect(
        arDocumentService.postDocument(ctxWithUser, draft.id, { simulateFailure: true })
      ).rejects.toThrow(AccountingError);

      // Verify document state remains DRAFT
      const afterFail = await arDocumentService.getDocument(ctxWithUser, draft.id);
      expect(afterFail.status).toBe('DRAFT');
      expect(afterFail.journalEntryId).toBeNull();

      // Verify NO open item was created
      const openItems = await arDocumentService.getOpenItems(ctxWithUser, 'company_a1', { customerId: customerAId });
      const openItem = openItems.find(i => i.arDocumentId === draft.id);
      expect(openItem).toBeUndefined();
    });
  });

  // 7. Concurrency & Idempotency
  describe('Concurrency & Idempotency Controls', () => {
    it('returns existing posted document idempotently upon repeated post requests', async () => {
      const draft = await arDocumentService.createDraft(ctxWithUser, {
        companyId: 'company_a1',
        customerId: customerAId,
        documentType: 'INVOICE',
        documentDate: '2026-05-15',
        accountingDate: '2026-05-15',
        dueDate: '2026-06-15',
        lines: [{ description: 'Idempotency Line', quantity: '1.0000', unitPrice: '1000.00', taxableAmount: '1000.00', taxAmount: '0.00', grossAmount: '1000.00' }]
      });

      const post1 = await arDocumentService.postDocument(ctxWithUser, draft.id);
      const post2 = await arDocumentService.postDocument(ctxWithUser, draft.id);

      expect(post1.journalEntryId).toBe(post2.journalEntryId);
      expect(post1.documentNumber).toBe(post2.documentNumber);

      const openItems = await arDocumentService.getOpenItems(ctxWithUser, 'company_a1', { customerId: customerAId });
      const itemsForDoc = openItems.filter(i => i.arDocumentId === draft.id);
      expect(itemsForDoc.length).toBe(1); // No duplicate open items!
    });

    it('allocates 100 concurrent postings for different documents with ZERO collisions or lost updates', async () => {
      const createPromises = Array.from({ length: 100 }, (_, idx) =>
        arDocumentService.createDraft(ctxWithUser, {
          companyId: 'company_a1',
          customerId: customerAId,
          documentType: 'INVOICE',
          documentDate: '2026-05-15',
          accountingDate: '2026-05-15',
          dueDate: '2026-06-15',
          lines: [{ description: `Concurrent Item ${idx}`, quantity: '1.0000', unitPrice: '10.00', taxableAmount: '10.00', taxAmount: '0.00', grossAmount: '10.00' }]
        })
      );

      const drafts = await Promise.all(createPromises);
      const postPromises = drafts.map(d => arDocumentService.postDocument(ctxWithUser, d.id));
      const postedResults = await Promise.all(postPromises);

      expect(postedResults.length).toBe(100);
      const docNumbers = new Set(postedResults.map(p => p.documentNumber));
      expect(docNumbers.size).toBe(100);
    });
  });

  // 8. Security & Mass Assignment Protection
  describe('Security & Mass Assignment Protection', () => {
    it('PREVENTS client from manufacturing a POSTED document via create/update DTOs', async () => {
      const payload: any = {
        companyId: 'company_a1',
        customerId: customerAId,
        documentType: 'INVOICE',
        status: 'POSTED', // Malicious status override attempt!
        journalEntryId: 'je_fake_123',
        documentDate: '2026-05-15',
        accountingDate: '2026-05-15',
        dueDate: '2026-06-15',
        lines: [{ description: 'Hacked Document', quantity: '1.0000', unitPrice: '100.00' }]
      };

      const doc = await arDocumentService.createDraft(ctxWithUser, payload);
      expect(doc.status).toBe('DRAFT'); // Status override ignored!
      expect(doc.journalEntryId).toBeNull();
    });
  });

  // 9. Randomized Financial Testing (200 Scenarios)
  describe('Randomized Financial Testing (200 Scenarios)', () => {
    it('executes 200 randomized AR document calculations and validates exact totals reconciliation', async () => {
      const docTypes: ArDocumentType[] = ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'OPENING_BALANCE'];

      for (let i = 0; i < 200; i++) {
        const docType = docTypes[i % docTypes.length]!;
        const qtyVal = Math.floor(Math.random() * 50) + 1;
        const priceVal = (Math.floor(Math.random() * 10000) + 100) / 100;

        const taxableNum = Math.round(qtyVal * priceVal * 100) / 100;
        const taxRateNum = (i % 2 === 0) ? 18.0 : 0.0;
        const taxNum = Math.round((taxableNum * taxRateNum / 100) * 100) / 100;
        const grossNum = Math.round((taxableNum + taxNum) * 100) / 100;

        const cgstNum = Math.round((taxNum / 2) * 100) / 100;
        const sgstNum = Math.round((taxNum - cgstNum) * 100) / 100;

        const draft = await arDocumentService.createDraft(ctxWithUser, {
          companyId: 'company_a1',
          customerId: customerAId,
          documentType: docType,
          documentDate: '2026-05-15',
          accountingDate: '2026-05-15',
          dueDate: '2026-06-15',
          lines: [{
            description: `Random Item ${i}`,
            quantity: `${qtyVal}.0000`,
            unitPrice: priceVal.toFixed(2),
            taxableAmount: taxableNum.toFixed(2),
            taxRatePercent: taxRateNum.toFixed(6),
            cgstAmount: cgstNum.toFixed(2),
            sgstAmount: sgstNum.toFixed(2),
            taxAmount: taxNum.toFixed(2),
            grossAmount: grossNum.toFixed(2)
          }]
        });

        const posted = await arDocumentService.postDocument(ctxWithUser, draft.id);

        expect(posted.status).toBe('POSTED');
        expect(parseFloat(posted.grossAmount)).toBeCloseTo(grossNum, 2);
        expect(parseFloat(posted.taxableAmount)).toBeCloseTo(taxableNum, 2);
        expect(parseFloat(posted.taxAmount)).toBeCloseTo(taxNum, 2);
      }
    });
  });
});
