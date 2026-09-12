import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext, ValidationError, NotFoundError, BusinessRuleViolationError } from '@general-erp/core';
import { apReconciliationService } from '../src/modules/finance/ap/ap-reconciliation.service.js';
import { apSettlementService } from '../src/modules/finance/ap/ap-settlement.service.js';
import { apPaymentService } from '../src/modules/finance/ap/ap-payment.service.js';
import { apDocumentService } from '../src/modules/finance/ap/ap-document.service.js';
import { apAllocationService } from '../src/modules/finance/ap/ap-allocation.service.js';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { journalDraftService } from '../src/modules/finance/journal-draft.service.js';
import { accountingConfigurationService } from '../src/modules/finance/accounting-core.service.js';

describe('Phase 2.7.5.3 — AP Subledger & Company Reconciliation Engine', () => {
  const tenantId = 'tenant_ap_recon_5_3';
  const companyId = 'cmp_ap_recon_5_3';
  const supplierId1 = 'supp_ap_recon_001';
  const supplierId2 = 'supp_ap_recon_002';

  const ctx: RequestContext = {
    tenantId,
    companyId,
    user: {
      id: 'usr_ap_clerk',
      tenantId,
      roles: ['AP_CLERK'],
      permissions: ['*']
    }
  };

  const otherTenantCtx: RequestContext = {
    tenantId: 'tenant_other_5_3',
    companyId: 'cmp_other_5_3',
    user: {
      id: 'usr_other',
      tenantId: 'tenant_other_5_3',
      roles: ['AP_CLERK'],
      permissions: ['*']
    }
  };

  let bankAccountId: string;
  let expAccountId: string;
  let apAccountId: string;
  let discountIncomeAccountId: string;
  let equityAccountId: string;

  beforeEach(async () => {
    apAllocationService.clear();
    apPaymentService.clear();
    apDocumentService.clear();
    masterDataService.clear();
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    accountingConfigurationService.clear();
    journalDraftService.clear();

    await masterDataService.createCompany(ctx, {
      id: companyId,
      name: 'Acme Reconciliation Corp',
      legalName: 'Acme Reconciliation Corp Ltd',
      currency: 'INR'
    });

    await masterDataService.createSupplier(ctx, {
      id: supplierId1,
      companyId,
      name: 'Vendor Primary Ltd',
      code: 'VEND-001'
    });

    await masterDataService.createSupplier(ctx, {
      id: supplierId2,
      companyId,
      name: 'Vendor Secondary Ltd',
      code: 'VEND-002'
    });

    await masterDataService.createCompany(otherTenantCtx, {
      id: 'cmp_other_5_3',
      name: 'Other Recon Corp',
      legalName: 'Other Recon Corp Ltd',
      currency: 'INR'
    });

    const { fiscalYear } = await fiscalPeriodService.createFiscalYear(ctx, {
      companyId,
      name: 'FY 2025-26',
      startDate: new Date('2025-04-01T00:00:00.000Z'),
      endDate: new Date('2026-03-31T23:59:59.999Z')
    });
    await fiscalPeriodService.activateFiscalYear(ctx, fiscalYear.id);

    const apAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '2100',
      accountName: 'Accounts Payable Control',
      accountType: 'LIABILITY',
      isControlAccount: true,
      controlAccountType: 'AP'
    });
    await chartOfAccountsService.activateAccount(ctx, apAccount.id);
    apAccountId = apAccount.id;

    const bankAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '1010',
      accountName: 'HDFC Bank Account',
      accountType: 'ASSET',
      isControlAccount: true,
      controlAccountType: 'BANK'
    });
    await chartOfAccountsService.activateAccount(ctx, bankAccount.id);
    bankAccountId = bankAccount.id;

    const expAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '5000',
      accountName: 'Operating Expense',
      accountType: 'EXPENSE'
    });
    await chartOfAccountsService.activateAccount(ctx, expAccount.id);
    expAccountId = expAccount.id;

    const discountAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '4900',
      accountName: 'Purchase Discount Income',
      accountType: 'INCOME'
    });
    await chartOfAccountsService.activateAccount(ctx, discountAccount.id);
    discountIncomeAccountId = discountAccount.id;

    const equityAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '3000',
      accountName: 'Retained Earnings Equity',
      accountType: 'EQUITY'
    });
    await chartOfAccountsService.activateAccount(ctx, equityAccount.id);
    equityAccountId = equityAccount.id;

    const eventTypes = ['AP_SUPPLIER_BILL', 'AP_CREDIT_NOTE', 'AP_DEBIT_NOTE', 'AP_OPENING_BALANCE', 'AP_PAYMENT', 'AP_DISCOUNT'];
    for (const et of eventTypes) {
      await accountingConfigurationService.setMapping(ctx, {
        companyId,
        eventType: et,
        lineRole: 'AP_CONTROL',
        accountId: apAccountId
      });
      await accountingConfigurationService.setMapping(ctx, {
        companyId,
        eventType: et,
        lineRole: 'PURCHASE_EXPENSE',
        accountId: expAccountId
      });
      await accountingConfigurationService.setMapping(ctx, {
        companyId,
        eventType: et,
        lineRole: 'PURCHASE_DISCOUNT_INCOME',
        accountId: discountIncomeAccountId
      });
      await accountingConfigurationService.setMapping(ctx, {
        companyId,
        eventType: et,
        lineRole: 'BANK_ACCOUNT',
        accountId: bankAccountId
      });
      await accountingConfigurationService.setMapping(ctx, {
        companyId,
        eventType: et,
        lineRole: 'RETAINED_EARNINGS',
        accountId: equityAccountId
      });
    }
  });

  describe('1. Perfect Subledger-to-GL Reconciliation (PASS Scenarios)', () => {
    it('reconciles balanced open bills with posted GL entries (PASS)', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId: supplierId1,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '20000.00', taxableAmount: '20000.00', taxAmount: '0.00', grossAmount: '20000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, billDraft.id);

      const recon = await apReconciliationService.reconcileCompanyAP(ctx, companyId);

      expect(recon.reconciliationStatus).toBe('PASS');
      expect(recon.subledgerOutstandingOpenItemsTotal).toBe('20000.00');
      expect(recon.subledgerUnappliedPaymentsTotal).toBe('0.00');
      expect(recon.subledgerUnappliedCreditNotesTotal).toBe('0.00');
      expect(recon.netSubledgerPayableTotal).toBe('20000.00');
      expect(recon.glApControlBalance).toBe('20000.00'); // Credit 20000 - Debit 0
      expect(recon.reconciliationDifference).toBe('0.00');
      expect(recon.diagnostics).toHaveLength(0);
    });

    it('reconciles partially allocated payment with posted GL entries (PASS)', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId: supplierId1,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '10000.00', taxableAmount: '10000.00', taxAmount: '0.00', grossAmount: '10000.00', expenseAccountId: expAccountId }]
      });
      const bill = await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId: supplierId1 });
      const openItem = openItems.find(i => i.apDocumentId === bill.id)!;

      const payDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId: supplierId1,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '4000.00'
      });
      const payment = await apPaymentService.postPayment(ctx, payDraft.id);

      await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '4000.00'
      });

      const recon = await apReconciliationService.reconcileCompanyAP(ctx, companyId);

      expect(recon.reconciliationStatus).toBe('PASS');
      expect(recon.subledgerOutstandingOpenItemsTotal).toBe('6000.00'); // 10000 - 4000
      expect(recon.subledgerUnappliedPaymentsTotal).toBe('0.00'); // 4000 - 4000
      expect(recon.netSubledgerPayableTotal).toBe('6000.00');
      expect(recon.glApControlBalance).toBe('6000.00'); // Credit 10000 - Debit 4000
      expect(recon.reconciliationDifference).toBe('0.00');
    });

    it('reconciles negative net supplier payable (advance payment) with negative GL signed balance (PASS)', async () => {
      const payDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId: supplierId1,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '7000.00'
      });
      await apPaymentService.postPayment(ctx, payDraft.id);

      const recon = await apReconciliationService.reconcileCompanyAP(ctx, companyId);

      expect(recon.reconciliationStatus).toBe('PASS');
      expect(recon.subledgerOutstandingOpenItemsTotal).toBe('0.00');
      expect(recon.subledgerUnappliedPaymentsTotal).toBe('7000.00');
      expect(recon.netSubledgerPayableTotal).toBe('-7000.00');
      expect(recon.glApControlBalance).toBe('-7000.00'); // Credit 0 - Debit 7000
      expect(recon.reconciliationDifference).toBe('0.00');
    });
  });

  describe('2. Discrepancy & Diagnostic Triggers (FAIL Scenarios)', () => {
    it('detects UNMAPPED_GL_CONTROL_ACCOUNT when AP_CONTROL is unmapped in configuration', async () => {
      const recon = await apReconciliationService.reconcileCompanyAP(otherTenantCtx, 'cmp_other_5_3');

      expect(recon.reconciliationStatus).toBe('FAIL');
      expect(recon.diagnostics.some(d => d.code === 'UNMAPPED_GL_CONTROL_ACCOUNT')).toBe(true);
    });

    it('detects SUBLEDGER_GL_DISCREPANCY when GL AP_CONTROL has missing or extra journal entry', async () => {
      // Create subledger bill but suppress GL posting (or inject imbalance)
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId: supplierId1,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '5000.00', taxableAmount: '5000.00', taxAmount: '0.00', grossAmount: '5000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, billDraft.id);

      // Artificially clear GL posted journals store to simulate GL imbalance
      journalDraftService.clear();

      const recon = await apReconciliationService.reconcileCompanyAP(ctx, companyId);

      expect(recon.reconciliationStatus).toBe('FAIL');
      expect(recon.netSubledgerPayableTotal).toBe('5000.00');
      expect(recon.glApControlBalance).toBe('0.00');
      expect(recon.reconciliationDifference).toBe('5000.00');
      expect(recon.diagnostics.some(d => d.code === 'SUBLEDGER_GL_DISCREPANCY')).toBe(true);
    });

    it('detects OPEN_ITEM_BALANCE_MISMATCH on corrupted subledger open item', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId: supplierId1,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '1000.00', taxableAmount: '1000.00', taxAmount: '0.00', grossAmount: '1000.00', expenseAccountId: expAccountId }]
      });
      const bill = await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId: supplierId1 });
      const openItem = openItems.find(i => i.apDocumentId === bill.id)!;

      const payDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId: supplierId1,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '1000.00'
      });
      const payment = await apPaymentService.postPayment(ctx, payDraft.id);

      // Force corrupted allocation exceeding original amount
      const allocStore = (apAllocationService as any).allocationsStore;
      const corruptId = 'alloc_corrupt_recon';
      allocStore.set(`${ctx.tenantId}:${corruptId}`, {
        id: corruptId,
        tenantId: ctx.tenantId,
        companyId,
        supplierId: supplierId1,
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        creditNoteId: null,
        openItemId: openItem.id,
        allocationDate: '2025-04-15',
        allocatedAmount: '9000.00',
        discountAmount: '0.00',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const recon = await apReconciliationService.reconcileCompanyAP(ctx, companyId);

      expect(recon.reconciliationStatus).toBe('FAIL');
      expect(recon.diagnostics.some(d => d.code === 'OPEN_ITEM_BALANCE_MISMATCH')).toBe(true);
    });
  });

  describe('3. Historical As-Of Reconciliation Mode', () => {
    it('reconciles subledger and GL as of historical date cutoffs', async () => {
      // Bill on 2025-04-05 (10,000)
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId: supplierId1,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-05',
        accountingDate: '2025-04-05',
        dueDate: '2025-05-05',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '10000.00', taxableAmount: '10000.00', taxAmount: '0.00', grossAmount: '10000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, billDraft.id);

      // Payment on 2025-04-20 (4,000)
      const payDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId: supplierId1,
        paymentDate: '2025-04-20',
        accountingDate: '2025-04-20',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '4000.00'
      });
      await apPaymentService.postPayment(ctx, payDraft.id);

      // 1. asOfDate = 2025-04-10 (After bill 04-05, before payment 04-20) -> 10,000 net payable
      const hist1 = await apReconciliationService.reconcileCompanyAP(ctx, companyId, '2025-04-10', 'HISTORICAL');
      expect(hist1.reconciliationStatus).toBe('PASS');
      expect(hist1.netSubledgerPayableTotal).toBe('10000.00');
      expect(hist1.glApControlBalance).toBe('10000.00');

      // 2. asOfDate = 2025-04-25 (After payment 04-20) -> 6,000 net payable
      const hist2 = await apReconciliationService.reconcileCompanyAP(ctx, companyId, '2025-04-25', 'HISTORICAL');
      expect(hist2.reconciliationStatus).toBe('PASS');
      expect(hist2.netSubledgerPayableTotal).toBe('6000.00');
      expect(hist2.glApControlBalance).toBe('6000.00');
    });
  });

  describe('4. Invariants, Context Isolation, & Database Snapshot Protection', () => {
    it('executes database reads within REPEATABLE READ READ ONLY snapshot when pool is configured', async () => {
      let queryExecuted = false;
      let transactionMode = '';

      const mockClient = {
        query: async (sql: string) => {
          if (typeof sql === 'string' && sql.includes('REPEATABLE READ')) {
            transactionMode = sql;
            queryExecuted = true;
          }
          return { rows: [] };
        },
        release: () => {}
      };

      const mockPool: any = {
        connect: async () => mockClient
      };

      apReconciliationService.setDbPool(mockPool);
      expect(apReconciliationService.getDbPool()).toBe(mockPool);

      await apReconciliationService.reconcileCompanyAP(ctx, companyId).catch(() => null);

      expect(queryExecuted).toBe(true);
      expect(transactionMode).toContain('REPEATABLE READ');
      expect(transactionMode).toContain('READ ONLY');
      expect(transactionMode).not.toContain('FOR UPDATE');

      // Reset pool
      apReconciliationService.setDbPool(undefined as any);
    });

    it('enforces company subledger equivalence: Company Net Payable == Sum(Supplier Net Payables)', async () => {
      // Supplier 1 bill 12000
      const b1 = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId: supplierId1,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'S1 Bill', quantity: '1.0000', unitPrice: '12000.00', taxableAmount: '12000.00', taxAmount: '0.00', grossAmount: '12000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, b1.id);

      // Supplier 2 bill 8000 + payment 3000
      const b2 = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId: supplierId2,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'S2 Bill', quantity: '1.0000', unitPrice: '8000.00', taxableAmount: '8000.00', taxAmount: '0.00', grossAmount: '8000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, b2.id);

      const pay2 = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId: supplierId2,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '3000.00'
      });
      await apPaymentService.postPayment(ctx, pay2.id);

      // 1. Supplier Summaries
      const supp1 = await apSettlementService.getSupplierSettlementSummary(ctx, supplierId1);
      const supp2 = await apSettlementService.getSupplierSettlementSummary(ctx, supplierId2);

      const sumSupplierNet = parseFloat(supp1.netPayableAmount) + parseFloat(supp2.netPayableAmount);

      // 2. Company Reconciliation
      const recon = await apReconciliationService.reconcileCompanyAP(ctx, companyId);
      const companyNet = parseFloat(recon.netSubledgerPayableTotal);

      expect(companyNet).toBe(sumSupplierNet);
      expect(recon.reconciliationStatus).toBe('PASS');
    });

    it('enforces tenant and company context isolation', async () => {
      await expect(apReconciliationService.reconcileCompanyAP(otherTenantCtx, companyId)).rejects.toThrow();
    });
  });

  describe('5. 50 Randomized Reconciliation Invariant Assertions', () => {
    it('executes 50 randomized posted transaction flows asserting subledger-to-GL exact reconciliation conservation', async () => {
      for (let i = 0; i < 50; i++) {
        const billAmt = (Math.floor(Math.random() * 5000) + 1000).toFixed(2);
        const payAmt = (Math.floor(Math.random() * 4000) + 500).toFixed(2);

        const billDraft = await apDocumentService.createDraft(ctx, {
          companyId,
          supplierId: supplierId1,
          documentType: 'SUPPLIER_BILL',
          documentDate: '2025-04-10',
          accountingDate: '2025-04-10',
          dueDate: '2025-05-10',
          lines: [{ description: 'Rand Item', quantity: '1.0000', unitPrice: billAmt, taxableAmount: billAmt, taxAmount: '0.00', grossAmount: billAmt, expenseAccountId: expAccountId }]
        });
        const bill = await apDocumentService.postDocument(ctx, billDraft.id);
        const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId: supplierId1 });
        const openItem = openItems.find(item => item.apDocumentId === bill.id)!;

        const payDraft = await apPaymentService.createDraft(ctx, {
          companyId,
          supplierId: supplierId1,
          paymentDate: '2025-04-15',
          accountingDate: '2025-04-15',
          paymentMode: 'BANK_TRANSFER',
          bankAccountId,
          totalAmount: payAmt
        });
        const payment = await apPaymentService.postPayment(ctx, payDraft.id);

        const allocVal = Math.min(parseFloat(billAmt), parseFloat(payAmt)).toFixed(2);
        await apAllocationService.allocate(ctx, {
          allocationSourceType: 'PAYMENT',
          paymentId: payment.id,
          openItemId: openItem.id,
          allocatedAmount: allocVal
        });

        const recon = await apReconciliationService.reconcileCompanyAP(ctx, companyId);
        expect(recon.reconciliationStatus).toBe('PASS');
        expect(recon.reconciliationDifference).toBe('0.00');
      }
    });
  });
});
