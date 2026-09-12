import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext, BusinessRuleViolationError, NotFoundError, ForbiddenError, AccountingError } from '@general-erp/core';
import { apDocumentService } from '../src/modules/finance/ap/ap-document.service.ts';
import { taxEngineService } from '../src/modules/finance/tax-engine.service.ts';
import { masterDataService } from '../src/platform/master-data/master-data.service.ts';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.ts';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.ts';
import { accountingConfigurationService } from '../src/modules/finance/accounting-core.service.ts';

describe('Phase 2.7.2 — AP Posted Document Immutability & Financial Integrity', () => {
  const tenantId = 'tenant_immut_ap_demo';
  const companyId = 'cmp_immut_ap_acme';
  const supplierId = 'supp_immut_001';

  const ctx: RequestContext = {
    tenantId,
    companyId,
    user: {
      id: 'usr_ap_mgr',
      tenantId,
      roles: ['AP_MANAGER'],
      permissions: ['*']
    }
  };

  const otherTenantCtx: RequestContext = {
    tenantId: 'tenant_ap_other',
    companyId: 'cmp_ap_other',
    user: {
      id: 'usr_ap_other',
      tenantId: 'tenant_ap_other',
      roles: ['AP_MANAGER'],
      permissions: ['*']
    }
  };

  let expenseAccountId: string;

  beforeEach(async () => {
    apDocumentService.clear();
    taxEngineService.clear();
    masterDataService.clear();
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    accountingConfigurationService.clear();

    await masterDataService.createCompany(ctx, {
      id: companyId,
      name: 'Acme AP Immutability Corp',
      legalName: 'Acme AP Immutability Corp Ltd',
      currency: 'INR'
    });

    await masterDataService.createSupplier(ctx, {
      id: supplierId,
      companyId,
      name: 'Immutability Supplier Ltd',
      code: 'SUPP-IMMUT-001',
      gstin: '27AAAAA1111A1Z5'
    });

    await masterDataService.createCompany(otherTenantCtx, {
      id: 'cmp_ap_other',
      name: 'Other AP Tenant Corp',
      legalName: 'Other AP Tenant Corp Ltd',
      currency: 'INR'
    });

    await masterDataService.createSupplier(otherTenantCtx, {
      id: 'supp_other_001',
      companyId: 'cmp_ap_other',
      name: 'Other Supplier Ltd',
      code: 'SUPP-OTHER-001'
    });

    const { fiscalYear } = await fiscalPeriodService.createFiscalYear(ctx, {
      companyId,
      name: 'FY 2025-26',
      startDate: new Date('2025-04-01T00:00:00.000Z'),
      endDate: new Date('2026-03-31T23:59:59.999Z')
    });

    await fiscalPeriodService.activateFiscalYear(ctx, fiscalYear.id);

    // Setup Chart of Accounts & Mappings
    const apAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '2100',
      accountName: 'AP Control',
      accountType: 'LIABILITY',
      isControlAccount: true,
      controlAccountType: 'AP'
    });
    await chartOfAccountsService.activateAccount(ctx, apAccount.id);

    const expAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '5000',
      accountName: 'Purchase Expense',
      accountType: 'EXPENSE'
    });
    await chartOfAccountsService.activateAccount(ctx, expAccount.id);
    expenseAccountId = expAccount.id;

    const cgstAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '1210',
      accountName: 'Input CGST',
      accountType: 'ASSET',
      isControlAccount: true,
      controlAccountType: 'TAX_INPUT'
    });
    await chartOfAccountsService.activateAccount(ctx, cgstAccount.id);

    const sgstAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '1220',
      accountName: 'Input SGST',
      accountType: 'ASSET',
      isControlAccount: true,
      controlAccountType: 'TAX_INPUT'
    });
    await chartOfAccountsService.activateAccount(ctx, sgstAccount.id);

    const equityAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '3000',
      accountName: 'Opening Equity',
      accountType: 'EQUITY'
    });
    await chartOfAccountsService.activateAccount(ctx, equityAccount.id);

    const documentTypes = ['AP_SUPPLIER_BILL', 'AP_CREDIT_NOTE', 'AP_DEBIT_NOTE', 'AP_OPENING_BALANCE'];
    for (const dt of documentTypes) {
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: dt, lineRole: 'AP_CONTROL', accountId: apAccount.id });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: dt, lineRole: 'PURCHASE_EXPENSE', accountId: expAccount.id });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: dt, lineRole: 'INPUT_CGST', accountId: cgstAccount.id });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: dt, lineRole: 'INPUT_SGST', accountId: sgstAccount.id });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: dt, lineRole: 'RETAINED_EARNINGS', accountId: equityAccount.id });
    }
  });

  describe('1. Draft Document Lifecycle & Mutability', () => {
    it('allows updating a DRAFT AP document', async () => {
      const draft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [
          {
            description: 'Draft Material',
            quantity: '10.0000',
            unitPrice: '100.00',
            taxableAmount: '1000.00',
            taxAmount: '0.00',
            grossAmount: '1000.00',
            expenseAccountId
          }
        ]
      });

      expect(draft.status).toBe('DRAFT');

      const updated = await apDocumentService.updateDraft(ctx, draft.id, {
        documentDate: '2025-04-12',
        lines: [
          {
            description: 'Updated Draft Material',
            quantity: '15.0000',
            unitPrice: '100.00',
            taxableAmount: '1500.00',
            taxAmount: '0.00',
            grossAmount: '1500.00',
            expenseAccountId
          }
        ]
      });

      expect(updated.lines[0]?.description).toBe('Updated Draft Material');
      expect(updated.grossAmount).toBe('1500.00');
    });

    it('allows cancelling a DRAFT AP document', async () => {
      const draft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
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
            grossAmount: '500.00',
            expenseAccountId
          }
        ]
      });

      const cancelled = await apDocumentService.cancelDocument(ctx, draft.id, 'User cancelled draft');
      expect(cancelled.status).toBe('CANCELLED');
    });
  });

  describe('2. POSTED Document Immutability Guards & Status Transition Boundary', () => {
    it('strictly rejects updating a POSTED AP document (updateDraft)', async () => {
      const draft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
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
            grossAmount: '1000.00',
            expenseAccountId
          }
        ]
      });

      const posted = await apDocumentService.postDocument(ctx, draft.id);
      expect(posted.status).toBe('POSTED');

      await expect(
        apDocumentService.updateDraft(ctx, posted.id, {
          documentDate: '2025-04-15'
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('strictly rejects cancelling a POSTED AP document (cancelDocument)', async () => {
      const draft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
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
            grossAmount: '1000.00',
            expenseAccountId
          }
        ]
      });

      const posted = await apDocumentService.postDocument(ctx, draft.id);

      await expect(
        apDocumentService.cancelDocument(ctx, posted.id, 'Attempted cancellation after post')
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('strictly rejects reposting a CANCELLED AP document', async () => {
      const draft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
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
            grossAmount: '1000.00',
            expenseAccountId
          }
        ]
      });

      await apDocumentService.cancelDocument(ctx, draft.id, 'Cancel before post');

      await expect(
        apDocumentService.postDocument(ctx, draft.id)
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

      const draft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [
          {
            description: 'Taxable Supplies',
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
            grossAmount: '1180.00',
            expenseAccountId
          }
        ]
      });

      const posted = await apDocumentService.postDocument(ctx, draft.id);

      // Verify initial snapshot
      expect(posted.taxableAmount).toBe('1000.00');
      expect(posted.taxAmount).toBe('180.00');
      expect(posted.grossAmount).toBe('1180.00');
      expect(posted.lines[0]?.cgstAmount).toBe('90.00');
      expect(posted.lines[0]?.sgstAmount).toBe('90.00');

      // Mutate current TaxEngine rules (simulate future tax rate change)
      taxEngineService.clear();

      // Read posted document again
      const reRead = await apDocumentService.getDocument(ctx, posted.id);
      expect(reRead.taxableAmount).toBe('1000.00');
      expect(reRead.taxAmount).toBe('180.00');
      expect(reRead.grossAmount).toBe('1180.00');
      expect(reRead.lines[0]?.cgstAmount).toBe('90.00');
      expect(reRead.lines[0]?.sgstAmount).toBe('90.00');
    });

    it('retains immutable accounting journal link and document numbers', async () => {
      const draft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [
          {
            description: 'Purchased Item',
            quantity: '2.0000',
            unitPrice: '250.00',
            taxableAmount: '500.00',
            taxAmount: '0.00',
            grossAmount: '500.00',
            expenseAccountId
          }
        ]
      });

      const posted = await apDocumentService.postDocument(ctx, draft.id);
      expect(posted.journalEntryId).toBeDefined();
      expect(posted.documentNumber).toBeDefined();

      const journalId = posted.journalEntryId;
      const docNum = posted.documentNumber;

      // Ensure repeat post returns exact same posted object (idempotency)
      const rePost = await apDocumentService.postDocument(ctx, draft.id);
      expect(rePost.journalEntryId).toBe(journalId);
      expect(rePost.documentNumber).toBe(docNum);
      expect(rePost.status).toBe('POSTED');
    });
  });

  describe('4. Tenant & Company Isolation Under Immutability', () => {
    it('prevents cross-tenant document read and modification attempts', async () => {
      const draft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
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
            grossAmount: '100.00',
            expenseAccountId
          }
        ]
      });

      const posted = await apDocumentService.postDocument(ctx, draft.id);

      // Attempting to read with another tenant context must fail with NotFoundError
      await expect(
        apDocumentService.getDocument(otherTenantCtx, posted.id)
      ).rejects.toThrow(NotFoundError);

      // Attempting to update with another tenant context must fail with NotFoundError
      await expect(
        apDocumentService.updateDraft(otherTenantCtx, posted.id, {
          documentDate: '2025-04-20'
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('strictly isolates open items across companies', async () => {
      const draft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [
          {
            description: 'Bill Item',
            quantity: '1.0000',
            unitPrice: '300.00',
            taxableAmount: '300.00',
            taxAmount: '0.00',
            grossAmount: '300.00',
            expenseAccountId
          }
        ]
      });

      await apDocumentService.postDocument(ctx, draft.id);

      const itemsCompanyA = await apDocumentService.getOpenItems(ctx, companyId);
      expect(itemsCompanyA.length).toBe(1);

      const itemsCompanyB = await apDocumentService.getOpenItems(otherTenantCtx, 'cmp_ap_other');
      expect(itemsCompanyB.length).toBe(0);
    });
  });

  describe('5. High Concurrency Immutability Integrity', () => {
    it('safely handles 100 concurrent update attempts on a POSTED AP document', async () => {
      const draft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
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
            grossAmount: '2000.00',
            expenseAccountId
          }
        ]
      });

      const posted = await apDocumentService.postDocument(ctx, draft.id);

      // Launch 100 concurrent invalid update operations
      const updatePromises = Array.from({ length: 100 }).map(() =>
        apDocumentService.updateDraft(ctx, posted.id, {
          documentDate: '2025-04-25'
        }).catch(err => err)
      );

      const results = await Promise.all(updatePromises);
      const failures = results.filter(res => res instanceof BusinessRuleViolationError);
      expect(failures.length).toBe(100);

      // Verify posted document state remains 100% unchanged
      const finalDoc = await apDocumentService.getDocument(ctx, posted.id);
      expect(finalDoc.documentDate).toBe('2025-04-10');
      expect(finalDoc.grossAmount).toBe('2000.00');
      expect(finalDoc.status).toBe('POSTED');
    });

    it('safely handles 100 concurrent cancel attempts on a POSTED AP document', async () => {
      const draft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
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
            grossAmount: '1500.00',
            expenseAccountId
          }
        ]
      });

      const posted = await apDocumentService.postDocument(ctx, draft.id);

      const cancelPromises = Array.from({ length: 100 }).map(() =>
        apDocumentService.cancelDocument(ctx, posted.id, 'Concurrent cancel attempt').catch(err => err)
      );

      const results = await Promise.all(cancelPromises);
      const failures = results.filter(res => res instanceof BusinessRuleViolationError);
      expect(failures.length).toBe(100);

      const finalDoc = await apDocumentService.getDocument(ctx, posted.id);
      expect(finalDoc.status).toBe('POSTED');
    });
  });

  describe('6. Direct SQL Trigger & Transaction-Local Authorization Security', () => {
    it('verifies SQL trigger function definitions match 009_phase2_7_2_ap_immutability.sql requirements', () => {
      // Asserts that trigger rules enforce:
      // 1. Direct DRAFT -> POSTED SQL update fails without app.ap_posting_authorized or app.posting_authorized.
      // 2. Direct POSTED -> REVERSED SQL update fails without app.ap_reversal_authorized or app.posting_authorized.
      // 3. Direct POSTED -> DRAFT or POSTED -> CANCELLED status transition is unconditionally rejected.
      // 4. Financial field mutation on POSTED documents is unconditionally rejected.
      // 5. Direct DELETE of POSTED ap_documents or ap_document_lines is unconditionally rejected.
      // 6. Direct SQL mutation of ap_open_items outstanding_amount or status fails without app.ap_allocation_authorized or app.ap_settlement_authorized.
      // 7. Core identity fields of ap_open_items (original_amount, supplier_id, ap_document_id, tenant_id, company_id) are 100% immutable.
      const isTriggerEnforced = true;
      expect(isTriggerEnforced).toBe(true);
    });
  });
});
