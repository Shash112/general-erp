import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext, BusinessRuleViolationError, NotFoundError, ForbiddenError } from '@general-erp/core';
import { arDocumentService } from '../src/modules/finance/ar/ar-document.service.js';
import { taxEngineService } from '../src/modules/finance/tax-engine.service.js';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { accountingConfigurationService } from '../src/modules/finance/accounting-core.service.js';

describe('Phase 2.6.2 — AR Posted Document Immutability & Financial Integrity', () => {
  const tenantId = 'tenant_immut_demo';
  const companyId = 'cmp_immut_acme';
  const customerId = 'cust_immut_001';

  const ctx: RequestContext = {
    tenantId,
    companyId,
    user: {
      id: 'usr_ar_mgr',
      tenantId,
      roles: ['AR_MANAGER'],
      permissions: ['*']
    }
  };

  const otherTenantCtx: RequestContext = {
    tenantId: 'tenant_other',
    companyId: 'cmp_other',
    user: {
      id: 'usr_other',
      tenantId: 'tenant_other',
      roles: ['AR_MANAGER'],
      permissions: ['*']
    }
  };

  beforeEach(async () => {
    arDocumentService.clear();
    taxEngineService.clear();
    masterDataService.clear();
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    accountingConfigurationService.clear();

    await masterDataService.createCompany(ctx, {
      id: companyId,
      name: 'Acme Immutability Corp',
      legalName: 'Acme Immutability Corp Ltd',
      currency: 'INR'
    });

    await masterDataService.createCustomer(ctx, {
      id: customerId,
      companyId,
      name: 'Immutability Customer Ltd',
      code: 'CUST-IMMUT-001',
      creditLimit: 500000
    });

    await masterDataService.createCompany(otherTenantCtx, {
      id: 'cmp_other',
      name: 'Other Tenant Corp',
      legalName: 'Other Tenant Corp Ltd',
      currency: 'INR'
    });

    await masterDataService.createCustomer(otherTenantCtx, {
      id: 'cust_other_001',
      companyId: 'cmp_other',
      name: 'Other Customer Ltd',
      code: 'CUST-OTHER-001',
      creditLimit: 100000
    });

    const { fiscalYear } = await fiscalPeriodService.createFiscalYear(ctx, {
      companyId,
      name: 'FY 2025-26',
      startDate: new Date('2025-04-01T00:00:00.000Z'),
      endDate: new Date('2026-03-31T23:59:59.999Z')
    });

    await fiscalPeriodService.activateFiscalYear(ctx, fiscalYear.id);

    // Setup Chart of Accounts & Mappings
    const arAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '1100',
      accountName: 'AR Control',
      accountType: 'ASSET',
      isControlAccount: true,
      controlAccountType: 'AR'
    });
    await chartOfAccountsService.activateAccount(ctx, arAccount.id);

    const revAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '4000',
      accountName: 'Sales Revenue',
      accountType: 'INCOME'
    });
    await chartOfAccountsService.activateAccount(ctx, revAccount.id);

    const cgstAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '2210',
      accountName: 'Output CGST',
      accountType: 'LIABILITY',
      isControlAccount: true,
      controlAccountType: 'TAX_OUTPUT'
    });
    await chartOfAccountsService.activateAccount(ctx, cgstAccount.id);

    const sgstAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '2220',
      accountName: 'Output SGST',
      accountType: 'LIABILITY',
      isControlAccount: true,
      controlAccountType: 'TAX_OUTPUT'
    });
    await chartOfAccountsService.activateAccount(ctx, sgstAccount.id);

    const equityAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '3000',
      accountName: 'Opening Equity',
      accountType: 'EQUITY'
    });
    await chartOfAccountsService.activateAccount(ctx, equityAccount.id);

    const documentTypes = ['AR_INVOICE', 'AR_CREDIT_NOTE', 'AR_DEBIT_NOTE', 'AR_OPENING_BALANCE'];
    for (const dt of documentTypes) {
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: dt, lineRole: 'AR_CONTROL', accountId: arAccount.id });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: dt, lineRole: 'SALES_REVENUE', accountId: revAccount.id });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: dt, lineRole: 'OUTPUT_CGST', accountId: cgstAccount.id });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: dt, lineRole: 'OUTPUT_SGST', accountId: sgstAccount.id });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: dt, lineRole: 'RETAINED_EARNINGS', accountId: equityAccount.id });
    }
  });

  describe('1. Draft Document Lifecycle & Mutability', () => {
    it('allows updating a DRAFT document', async () => {
      const draft = await arDocumentService.createDraft(ctx, {
        companyId,
        customerId,
        documentType: 'INVOICE',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [
          {
            description: 'Draft Widget',
            quantity: '10.0000',
            unitPrice: '100.00',
            taxableAmount: '1000.00',
            taxAmount: '0.00',
            grossAmount: '1000.00'
          }
        ]
      });

      expect(draft.status).toBe('DRAFT');

      const updated = await arDocumentService.updateDraft(ctx, draft.id, {
        documentDate: '2025-04-12',
        lines: [
          {
            description: 'Updated Draft Widget',
            quantity: '15.0000',
            unitPrice: '100.00',
            taxableAmount: '1500.00',
            taxAmount: '0.00',
            grossAmount: '1500.00'
          }
        ]
      });

      expect(updated.lines[0]?.description).toBe('Updated Draft Widget');
      expect(updated.grossAmount).toBe('1500.00');
    });

    it('allows cancelling a DRAFT document', async () => {
      const draft = await arDocumentService.createDraft(ctx, {
        companyId,
        customerId,
        documentType: 'INVOICE',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [
          {
            description: 'Draft to cancel',
            quantity: '1.0000',
            unitPrice: '500.00',
            taxableAmount: '500.00',
            taxAmount: '0.00',
            grossAmount: '500.00'
          }
        ]
      });

      const cancelled = await arDocumentService.cancelDocument(ctx, draft.id, 'User cancelled draft');
      expect(cancelled.status).toBe('CANCELLED');
    });
  });

  describe('2. POSTED Document Immutability Guards', () => {
    it('strictly rejects updating a POSTED document (updateDraft)', async () => {
      const draft = await arDocumentService.createDraft(ctx, {
        companyId,
        customerId,
        documentType: 'INVOICE',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [
          {
            description: 'Posted Line 1',
            quantity: '1.0000',
            unitPrice: '1000.00',
            taxableAmount: '1000.00',
            taxAmount: '0.00',
            grossAmount: '1000.00'
          }
        ]
      });

      const posted = await arDocumentService.postDocument(ctx, draft.id);
      expect(posted.status).toBe('POSTED');

      await expect(
        arDocumentService.updateDraft(ctx, posted.id, {
          documentDate: '2025-04-15'
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('strictly rejects cancelling a POSTED document (cancelDocument)', async () => {
      const draft = await arDocumentService.createDraft(ctx, {
        companyId,
        customerId,
        documentType: 'INVOICE',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [
          {
            description: 'Posted Line 1',
            quantity: '1.0000',
            unitPrice: '1000.00',
            taxableAmount: '1000.00',
            taxAmount: '0.00',
            grossAmount: '1000.00'
          }
        ]
      });

      const posted = await arDocumentService.postDocument(ctx, draft.id);

      await expect(
        arDocumentService.cancelDocument(ctx, posted.id, 'Attempted cancellation after post')
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('strictly rejects reposting a CANCELLED document', async () => {
      const draft = await arDocumentService.createDraft(ctx, {
        companyId,
        customerId,
        documentType: 'INVOICE',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [
          {
            description: 'Cancelled Line 1',
            quantity: '1.0000',
            unitPrice: '1000.00',
            taxableAmount: '1000.00',
            taxAmount: '0.00',
            grossAmount: '1000.00'
          }
        ]
      });

      await arDocumentService.cancelDocument(ctx, draft.id, 'Cancel before post');

      await expect(
        arDocumentService.postDocument(ctx, draft.id)
      ).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  describe('3. Field-Level & Historical Tax Preservation Under Immutability', () => {
    it('preserves historical tax snapshot when current TaxEngine configuration changes', async () => {
      const cat = await taxEngineService.createTaxCategory(ctx, {
        companyId,
        code: 'STANDARD_18',
        name: 'Standard GST 18%'
      });

      await taxEngineService.createTaxRate(ctx, {
        companyId,
        taxCategoryId: cat.id,
        rateType: 'CGST',
        ratePercent: '9.000000',
        validFrom: '2025-01-01'
      });

      await taxEngineService.createTaxRate(ctx, {
        companyId,
        taxCategoryId: cat.id,
        rateType: 'SGST',
        ratePercent: '9.000000',
        validFrom: '2025-01-01'
      });

      const draft = await arDocumentService.createDraft(ctx, {
        companyId,
        customerId,
        documentType: 'INVOICE',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [
          {
            description: 'Taxable Goods',
            quantity: '1.0000',
            unitPrice: '1000.00',
            taxableAmount: '1000.00',
            taxCategoryId: cat.id,
            taxRatePercent: '18.000000',
            cgstAmount: '90.00',
            sgstAmount: '90.00',
            igstAmount: '0.00',
            utgstAmount: '0.00',
            cessAmount: '0.00',
            taxAmount: '180.00',
            grossAmount: '1180.00'
          }
        ]
      });

      const posted = await arDocumentService.postDocument(ctx, draft.id);

      // Verify initial snapshot
      expect(posted.taxableAmount).toBe('1000.00');
      expect(posted.taxAmount).toBe('180.00');
      expect(posted.grossAmount).toBe('1180.00');
      expect(posted.lines[0]?.cgstAmount).toBe('90.00');
      expect(posted.lines[0]?.sgstAmount).toBe('90.00');

      // Now mutate current TaxEngine rules (simulate future tax rate change)
      taxEngineService.clear();

      // Read posted document again
      const reRead = await arDocumentService.getDocument(ctx, posted.id);
      expect(reRead.taxableAmount).toBe('1000.00');
      expect(reRead.taxAmount).toBe('180.00');
      expect(reRead.grossAmount).toBe('1180.00');
      expect(reRead.lines[0]?.cgstAmount).toBe('90.00');
      expect(reRead.lines[0]?.sgstAmount).toBe('90.00');
    });

    it('retains immutable accounting journal link and document numbers', async () => {
      const draft = await arDocumentService.createDraft(ctx, {
        companyId,
        customerId,
        documentType: 'INVOICE',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [
          {
            description: 'Goods Item',
            quantity: '2.0000',
            unitPrice: '250.00',
            taxableAmount: '500.00',
            taxAmount: '0.00',
            grossAmount: '500.00'
          }
        ]
      });

      const posted = await arDocumentService.postDocument(ctx, draft.id);
      expect(posted.journalEntryId).toBeDefined();
      expect(posted.documentNumber).toBeDefined();

      const journalId = posted.journalEntryId;
      const docNum = posted.documentNumber;

      // Ensure repeat post returns exact same posted object (idempotency)
      const rePost = await arDocumentService.postDocument(ctx, draft.id);
      expect(rePost.journalEntryId).toBe(journalId);
      expect(rePost.documentNumber).toBe(docNum);
      expect(rePost.status).toBe('POSTED');
    });
  });

  describe('4. Tenant & Company Isolation Under Immutability', () => {
    it('prevents cross-tenant document read and modification attempts', async () => {
      const draft = await arDocumentService.createDraft(ctx, {
        companyId,
        customerId,
        documentType: 'INVOICE',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [
          {
            description: 'Tenant Item',
            quantity: '1.0000',
            unitPrice: '100.00',
            taxableAmount: '100.00',
            taxAmount: '0.00',
            grossAmount: '100.00'
          }
        ]
      });

      const posted = await arDocumentService.postDocument(ctx, draft.id);

      // Attempting to read with another tenant context must fail with NotFoundError
      await expect(
        arDocumentService.getDocument(otherTenantCtx, posted.id)
      ).rejects.toThrow(NotFoundError);

      // Attempting to update with another tenant context must fail with NotFoundError
      await expect(
        arDocumentService.updateDraft(otherTenantCtx, posted.id, {
          documentDate: '2025-04-20'
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('strictly isolates open items across companies', async () => {
      const draft = await arDocumentService.createDraft(ctx, {
        companyId,
        customerId,
        documentType: 'INVOICE',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [
          {
            description: 'Invoice Item',
            quantity: '1.0000',
            unitPrice: '300.00',
            taxableAmount: '300.00',
            taxAmount: '0.00',
            grossAmount: '300.00'
          }
        ]
      });

      await arDocumentService.postDocument(ctx, draft.id);

      const itemsCompanyA = await arDocumentService.getOpenItems(ctx, companyId);
      expect(itemsCompanyA.length).toBe(1);

      const itemsCompanyB = await arDocumentService.getOpenItems(otherTenantCtx, 'cmp_other');
      expect(itemsCompanyB.length).toBe(0);
    });
  });

  describe('5. High Concurrency Immutability Integrity', () => {
    it('safely handles 100 concurrent update/delete attempts on a POSTED document', async () => {
      const draft = await arDocumentService.createDraft(ctx, {
        companyId,
        customerId,
        documentType: 'INVOICE',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [
          {
            description: 'Concurrent Test Item',
            quantity: '1.0000',
            unitPrice: '2000.00',
            taxableAmount: '2000.00',
            taxAmount: '0.00',
            grossAmount: '2000.00'
          }
        ]
      });

      const posted = await arDocumentService.postDocument(ctx, draft.id);

      // Launch 100 concurrent invalid update operations
      const updatePromises = Array.from({ length: 100 }).map(() =>
        arDocumentService.updateDraft(ctx, posted.id, {
          documentDate: '2025-04-25'
        }).catch(err => err)
      );

      const results = await Promise.all(updatePromises);
      const failures = results.filter(res => res instanceof BusinessRuleViolationError);
      expect(failures.length).toBe(100);

      // Verify posted document state remains 100% unchanged
      const finalDoc = await arDocumentService.getDocument(ctx, posted.id);
      expect(finalDoc.documentDate).toBe('2025-04-10');
      expect(finalDoc.grossAmount).toBe('2000.00');
      expect(finalDoc.status).toBe('POSTED');
    });

    it('safely handles 100 concurrent cancel attempts on a POSTED document', async () => {
      const draft = await arDocumentService.createDraft(ctx, {
        companyId,
        customerId,
        documentType: 'INVOICE',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [
          {
            description: 'Concurrent Cancel Item',
            quantity: '1.0000',
            unitPrice: '1500.00',
            taxableAmount: '1500.00',
            taxAmount: '0.00',
            grossAmount: '1500.00'
          }
        ]
      });

      const posted = await arDocumentService.postDocument(ctx, draft.id);

      const cancelPromises = Array.from({ length: 100 }).map(() =>
        arDocumentService.cancelDocument(ctx, posted.id, 'Concurrent cancel attempt').catch(err => err)
      );

      const results = await Promise.all(cancelPromises);
      const failures = results.filter(res => res instanceof BusinessRuleViolationError);
      expect(failures.length).toBe(100);

      const finalDoc = await arDocumentService.getDocument(ctx, posted.id);
      expect(finalDoc.status).toBe('POSTED');
    });
  });
});
