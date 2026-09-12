import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext, ValidationError, NotFoundError, BusinessRuleViolationError } from '@general-erp/core';
import { apSettlementService } from '../src/modules/finance/ap/ap-settlement.service.js';
import { apPaymentService } from '../src/modules/finance/ap/ap-payment.service.js';
import { apDocumentService } from '../src/modules/finance/ap/ap-document.service.js';
import { apAllocationService } from '../src/modules/finance/ap/ap-allocation.service.js';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { accountingConfigurationService } from '../src/modules/finance/accounting-core.service.js';

describe('Phase 2.7.5.2 — AP Supplier Settlement Summary Engine', () => {
  const tenantId = 'tenant_ap_summary_5_2';
  const companyId = 'cmp_ap_summary_5_2';
  const supplierId = 'supp_ap_summary_001';

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
    tenantId: 'tenant_other_5_2',
    companyId: 'cmp_other_5_2',
    user: {
      id: 'usr_other',
      tenantId: 'tenant_other_5_2',
      roles: ['AP_CLERK'],
      permissions: ['*']
    }
  };

  let bankAccountId: string;
  let expAccountId: string;
  let apAccountId: string;
  let discountIncomeAccountId: string;

  beforeEach(async () => {
    apAllocationService.clear();
    apPaymentService.clear();
    apDocumentService.clear();
    masterDataService.clear();
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    accountingConfigurationService.clear();

    await masterDataService.createCompany(ctx, {
      id: companyId,
      name: 'Acme Summary Corp',
      legalName: 'Acme Summary Corp Ltd',
      currency: 'INR'
    });

    await masterDataService.createSupplier(ctx, {
      id: supplierId,
      companyId,
      name: 'Vendor Primary Ltd',
      code: 'VEND-001'
    });

    await masterDataService.createSupplier(ctx, {
      id: 'supp_ap_summary_002',
      companyId,
      name: 'Vendor Secondary Ltd',
      code: 'VEND-002'
    });

    await masterDataService.createCompany(otherTenantCtx, {
      id: 'cmp_other_5_2',
      name: 'Other Summary Corp',
      legalName: 'Other Summary Corp Ltd',
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
      controlAccountType: 'PAYABLE'
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
        accountId: equityAccount.id
      });
    }
  });

  describe('1. Basic Supplier Settlement Aggregation (Live Mode)', () => {
    it('aggregates single unallocated bill: netPayable = outstanding bills', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Bill 1', quantity: '1.0000', unitPrice: '15000.00', taxableAmount: '15000.00', taxAmount: '0.00', grossAmount: '15000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, billDraft.id);

      const summary = await apSettlementService.getSupplierSettlementSummary(ctx, supplierId);

      expect(summary.supplierName).toBe('Vendor Primary Ltd');
      expect(summary.totalPostedBillsAmount).toBe('15000.00');
      expect(summary.totalOutstandingBillsAmount).toBe('15000.00');
      expect(summary.openItemsCount).toBe(1);
      expect(summary.totalPaymentsAmount).toBe('0.00');
      expect(summary.totalUnappliedPaymentsAmount).toBe('0.00');
      expect(summary.totalCreditNotesAmount).toBe('0.00');
      expect(summary.totalUnappliedCreditNotesAmount).toBe('0.00');
      expect(summary.netPayableAmount).toBe('15000.00');
    });

    it('aggregates multiple bills, debit notes, and opening balances accurately', async () => {
      // 1. Bill 10,000
      const b1 = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Bill 1', quantity: '1.0000', unitPrice: '10000.00', taxableAmount: '10000.00', taxAmount: '0.00', grossAmount: '10000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, b1.id);

      // 2. Debit Note 3,000
      const dn = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'DEBIT_NOTE',
        documentDate: '2025-04-12',
        accountingDate: '2025-04-12',
        dueDate: '2025-05-12',
        lines: [{ description: 'Debit Note 1', quantity: '1.0000', unitPrice: '3000.00', taxableAmount: '3000.00', taxAmount: '0.00', grossAmount: '3000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, dn.id);

      // 3. Opening Balance 2,000
      const ob = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'OPENING_BALANCE',
        documentDate: '2025-04-01',
        accountingDate: '2025-04-01',
        dueDate: '2025-04-30',
        lines: [{ description: 'OB 1', quantity: '1.0000', unitPrice: '2000.00', taxableAmount: '2000.00', taxAmount: '0.00', grossAmount: '2000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, ob.id);

      const summary = await apSettlementService.getSupplierSettlementSummary(ctx, supplierId);

      expect(summary.totalPostedBillsAmount).toBe('15000.00');
      expect(summary.totalOutstandingBillsAmount).toBe('15000.00');
      expect(summary.openItemsCount).toBe(3);
      expect(summary.netPayableAmount).toBe('15000.00');
    });

    it('handles fully settled open items (openItemsCount ignores 0.00 balance items)', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Bill 1', quantity: '1.0000', unitPrice: '5000.00', taxableAmount: '5000.00', taxAmount: '0.00', grossAmount: '5000.00', expenseAccountId: expAccountId }]
      });
      const bill = await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === bill.id)!;

      const payDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '5000.00'
      });
      const payment = await apPaymentService.postPayment(ctx, payDraft.id);

      await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '5000.00'
      });

      const summary = await apSettlementService.getSupplierSettlementSummary(ctx, supplierId);

      expect(summary.totalPostedBillsAmount).toBe('5000.00');
      expect(summary.totalOutstandingBillsAmount).toBe('0.00');
      expect(summary.openItemsCount).toBe(0);
      expect(summary.totalPaymentsAmount).toBe('5000.00');
      expect(summary.totalUnappliedPaymentsAmount).toBe('0.00');
      expect(summary.totalActiveAllocationsAmount).toBe('5000.00');
      expect(summary.netPayableAmount).toBe('0.00');
    });

    it('evaluates partially applied payment and unapplied credit note correctly', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Bill 1', quantity: '1.0000', unitPrice: '10000.00', taxableAmount: '10000.00', taxAmount: '0.00', grossAmount: '10000.00', expenseAccountId: expAccountId }]
      });
      const bill = await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === bill.id)!;

      // Payment 6000, alloc 4000 (unapplied 2000)
      const payDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '6000.00'
      });
      const payment = await apPaymentService.postPayment(ctx, payDraft.id);

      await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '4000.00'
      });

      // Credit Note 1500 (unapplied 1500)
      const cnDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'CREDIT_NOTE',
        documentDate: '2025-04-16',
        accountingDate: '2025-04-16',
        dueDate: '2025-05-16',
        lines: [{ description: 'CN 1', quantity: '1.0000', unitPrice: '1500.00', taxableAmount: '1500.00', taxAmount: '0.00', grossAmount: '1500.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, cnDraft.id);

      const summary = await apSettlementService.getSupplierSettlementSummary(ctx, supplierId);

      expect(summary.totalOutstandingBillsAmount).toBe('6000.00'); // 10000 - 4000
      expect(summary.totalUnappliedPaymentsAmount).toBe('2000.00'); // 6000 - 4000
      expect(summary.totalUnappliedCreditNotesAmount).toBe('1500.00');
      // Net Payable = 6000 - 2000 - 1500 = 2500
      expect(summary.netPayableAmount).toBe('2500.00');
    });

    it('supports negative net payable (supplier credit / advance balance)', async () => {
      // Payment 5000 unapplied + Credit Note 3000 unapplied, 0 bills
      const payDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '5000.00'
      });
      await apPaymentService.postPayment(ctx, payDraft.id);

      const cnDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'CREDIT_NOTE',
        documentDate: '2025-04-16',
        accountingDate: '2025-04-16',
        dueDate: '2025-05-16',
        lines: [{ description: 'CN 1', quantity: '1.0000', unitPrice: '3000.00', taxableAmount: '3000.00', taxAmount: '0.00', grossAmount: '3000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, cnDraft.id);

      const summary = await apSettlementService.getSupplierSettlementSummary(ctx, supplierId);

      expect(summary.totalOutstandingBillsAmount).toBe('0.00');
      expect(summary.totalUnappliedPaymentsAmount).toBe('5000.00');
      expect(summary.totalUnappliedCreditNotesAmount).toBe('3000.00');
      // Net Payable = 0 - 5000 - 3000 = -8000.00
      expect(summary.netPayableAmount).toBe('-8000.00');
    });

    it('evaluates exact zero net payable when outstanding bills equal unapplied sources', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Bill 1', quantity: '1.0000', unitPrice: '4000.00', taxableAmount: '4000.00', taxAmount: '0.00', grossAmount: '4000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, billDraft.id);

      const payDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '4000.00'
      });
      await apPaymentService.postPayment(ctx, payDraft.id);

      const summary = await apSettlementService.getSupplierSettlementSummary(ctx, supplierId);

      expect(summary.totalOutstandingBillsAmount).toBe('4000.00');
      expect(summary.totalUnappliedPaymentsAmount).toBe('4000.00');
      expect(summary.netPayableAmount).toBe('0.00');
    });
  });

  describe('2. Allocation Integrity, Discounts, & Reversals', () => {
    it('includes prompt payment discounts in totalPromptPaymentDiscountsAmount and reduces outstanding bills', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Bill 1', quantity: '1.0000', unitPrice: '10000.00', taxableAmount: '10000.00', taxAmount: '0.00', grossAmount: '10000.00', expenseAccountId: expAccountId }]
      });
      const bill = await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === bill.id)!;

      const payDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '9500.00'
      });
      const payment = await apPaymentService.postPayment(ctx, payDraft.id);

      await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '9500.00',
        discountAmount: '500.00'
      });

      const summary = await apSettlementService.getSupplierSettlementSummary(ctx, supplierId);

      expect(summary.totalActiveAllocationsAmount).toBe('9500.00');
      expect(summary.totalPromptPaymentDiscountsAmount).toBe('500.00');
      expect(summary.totalOutstandingBillsAmount).toBe('0.00');
      expect(summary.totalUnappliedPaymentsAmount).toBe('0.00');
      expect(summary.netPayableAmount).toBe('0.00');
    });

    it('excludes reversed allocations from live summary', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Bill 1', quantity: '1.0000', unitPrice: '8000.00', taxableAmount: '8000.00', taxAmount: '0.00', grossAmount: '8000.00', expenseAccountId: expAccountId }]
      });
      const bill = await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === bill.id)!;

      const payDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '8000.00'
      });
      const payment = await apPaymentService.postPayment(ctx, payDraft.id);

      const alloc = await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '8000.00'
      });

      // Reverse allocation
      await apAllocationService.reverseAllocation(ctx, { allocationId: alloc.id });

      const summary = await apSettlementService.getSupplierSettlementSummary(ctx, supplierId);

      expect(summary.totalActiveAllocationsAmount).toBe('0.00');
      expect(summary.totalOutstandingBillsAmount).toBe('8000.00');
      expect(summary.totalUnappliedPaymentsAmount).toBe('8000.00');
      expect(summary.netPayableAmount).toBe('0.00');
    });

    it('enforces context isolation across tenant, company, and supplier', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Bill 1', quantity: '1.0000', unitPrice: '5000.00', taxableAmount: '5000.00', taxAmount: '0.00', grossAmount: '5000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, billDraft.id);

      // 1. Cross-tenant rejection
      await expect(apSettlementService.getSupplierSettlementSummary(otherTenantCtx, supplierId)).rejects.toThrow();

      // 2. Cross-supplier context rejection (supplier2 in same company)
      const summary2 = await apSettlementService.getSupplierSettlementSummary(ctx, 'supp_ap_summary_002');
      expect(summary2.supplierId).toBe('supp_ap_summary_002');
      expect(summary2.totalPostedBillsAmount).toBe('0.00');
      expect(summary2.netPayableAmount).toBe('0.00');

      // 3. Non-existent supplier rejection
      await expect(apSettlementService.getSupplierSettlementSummary(ctx, 'supp_non_existent')).rejects.toThrow(NotFoundError);
    });

    it('surfaces corrupted open item or source allocation amounts via explicit BusinessRuleViolationError', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Bill 1', quantity: '1.0000', unitPrice: '1000.00', taxableAmount: '1000.00', taxAmount: '0.00', grossAmount: '1000.00', expenseAccountId: expAccountId }]
      });
      const bill = await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === bill.id)!;

      const payDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '1000.00'
      });
      const payment = await apPaymentService.postPayment(ctx, payDraft.id);

      // Force a corrupted allocation into store exceeding original bill amount
      const store = (apAllocationService as any).allocationsStore;
      const corruptId = 'alloc_corrupt_summary';
      store.set(`${ctx.tenantId}:${corruptId}`, {
        id: corruptId,
        tenantId: ctx.tenantId,
        companyId,
        supplierId,
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        creditNoteId: null,
        openItemId: openItem.id,
        allocationDate: '2025-04-15',
        allocatedAmount: '5000.00',
        discountAmount: '0.00',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await expect(apSettlementService.getSupplierSettlementSummary(ctx, supplierId)).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  describe('3. Historical As-Of Supplier Settlement Summary', () => {
    it('evaluates historical supplier summary before and after document accounting dates & allocation dates', async () => {
      // Bill on 2025-04-05 (10,000)
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-05',
        accountingDate: '2025-04-05',
        dueDate: '2025-05-05',
        lines: [{ description: 'Bill 1', quantity: '1.0000', unitPrice: '10000.00', taxableAmount: '10000.00', taxAmount: '0.00', grossAmount: '10000.00', expenseAccountId: expAccountId }]
      });
      const bill = await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === bill.id)!;

      // Payment on 2025-04-15 (6,000)
      const payDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '6000.00'
      });
      const payment = await apPaymentService.postPayment(ctx, payDraft.id);

      // Allocation on 2025-04-15 (6,000)
      await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '6000.00',
        allocationDate: '2025-04-15'
      });

      // 1. asOfDate = 2025-04-01 (Before bill 04-05 and payment 04-15) -> 0.00 net payable
      const hist1 = await apSettlementService.getSupplierSettlementSummary(ctx, supplierId, '2025-04-01', 'HISTORICAL');
      expect(hist1.totalPostedBillsAmount).toBe('0.00');
      expect(hist1.totalOutstandingBillsAmount).toBe('0.00');
      expect(hist1.totalPaymentsAmount).toBe('0.00');
      expect(hist1.netPayableAmount).toBe('0.00');

      // 2. asOfDate = 2025-04-10 (After bill 04-05, before payment 04-15) -> 10,000.00 net payable
      const hist2 = await apSettlementService.getSupplierSettlementSummary(ctx, supplierId, '2025-04-10', 'HISTORICAL');
      expect(hist2.totalPostedBillsAmount).toBe('10000.00');
      expect(hist2.totalOutstandingBillsAmount).toBe('10000.00');
      expect(hist2.totalPaymentsAmount).toBe('0.00');
      expect(hist2.netPayableAmount).toBe('10000.00');

      // 3. asOfDate = 2025-04-20 (After allocation 04-15) -> 4,000.00 net payable
      const hist3 = await apSettlementService.getSupplierSettlementSummary(ctx, supplierId, '2025-04-20', 'HISTORICAL');
      expect(hist3.totalPostedBillsAmount).toBe('10000.00');
      expect(hist3.totalOutstandingBillsAmount).toBe('4000.00');
      expect(hist3.totalPaymentsAmount).toBe('6000.00');
      expect(hist3.totalActiveAllocationsAmount).toBe('6000.00');
      expect(hist3.netPayableAmount).toBe('4000.00');
    });

    it('requires asOfDate when calculation mode is HISTORICAL', async () => {
      await expect(
        apSettlementService.getSupplierSettlementSummary(ctx, supplierId, undefined, 'HISTORICAL')
      ).rejects.toThrow(ValidationError);
    });

    it('does not mutate live state while serving historical requests', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Bill 1', quantity: '1.0000', unitPrice: '5000.00', taxableAmount: '5000.00', taxAmount: '0.00', grossAmount: '5000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, billDraft.id);

      // Execute historical query
      await apSettlementService.getSupplierSettlementSummary(ctx, supplierId, '2025-04-01', 'HISTORICAL');

      // Query live summary and verify current state remains intact
      const live = await apSettlementService.getSupplierSettlementSummary(ctx, supplierId);
      expect(live.totalOutstandingBillsAmount).toBe('5000.00');
      expect(live.netPayableAmount).toBe('5000.00');
    });
  });

  describe('4. ExactDecimal & Database Snapshot Invariants', () => {
    it('executes database queries within REPEATABLE READ READ ONLY snapshot when pool is configured', async () => {
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

      apSettlementService.setDbPool(mockPool);
      expect(apSettlementService.getDbPool()).toBe(mockPool);

      await apSettlementService.getSupplierSettlementSummary(ctx, supplierId).catch(() => null);

      expect(queryExecuted).toBe(true);
      expect(transactionMode).toContain('REPEATABLE READ');
      expect(transactionMode).toContain('READ ONLY');
      expect(transactionMode).not.toContain('FOR UPDATE');

      // Reset pool
      apSettlementService.setDbPool(undefined as any);
    });

    it('handles large financial aggregates with exact decimal precision', async () => {
      const largeValStr = '999999999.99';
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Large Bill', quantity: '1.0000', unitPrice: largeValStr, taxableAmount: largeValStr, taxAmount: '0.00', grossAmount: largeValStr, expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, billDraft.id);

      const summary = await apSettlementService.getSupplierSettlementSummary(ctx, supplierId);

      expect(summary.totalPostedBillsAmount).toBe(largeValStr);
      expect(summary.totalOutstandingBillsAmount).toBe(largeValStr);
      expect(summary.netPayableAmount).toBe(largeValStr);
    });
  });

  describe('5. 50 Randomized Financial Scenario Assertions', () => {
    it('executes 50 randomized allocation and settlement flows asserting exact Net Payable conservation (Net = Outstanding - UnappliedPay - UnappliedCN)', async () => {
      for (let i = 0; i < 50; i++) {
        const billAmt = (Math.floor(Math.random() * 5000) + 1000).toFixed(2);
        const payAmt = (Math.floor(Math.random() * 4000) + 500).toFixed(2);

        const billDraft = await apDocumentService.createDraft(ctx, {
          companyId,
          supplierId,
          documentType: 'SUPPLIER_BILL',
          documentDate: '2025-04-10',
          accountingDate: '2025-04-10',
          dueDate: '2025-05-10',
          lines: [{ description: 'Rand Item', quantity: '1.0000', unitPrice: billAmt, taxableAmount: billAmt, taxAmount: '0.00', grossAmount: billAmt, expenseAccountId: expAccountId }]
        });
        const bill = await apDocumentService.postDocument(ctx, billDraft.id);
        const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
        const openItem = openItems.find(item => item.apDocumentId === bill.id)!;

        const payDraft = await apPaymentService.createDraft(ctx, {
          companyId,
          supplierId,
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

        const summary = await apSettlementService.getSupplierSettlementSummary(ctx, supplierId);

        // Verify Net Payable formula conservation
        const outBillNum = parseFloat(summary.totalOutstandingBillsAmount);
        const unappPayNum = parseFloat(summary.totalUnappliedPaymentsAmount);
        const unappCnNum = parseFloat(summary.totalUnappliedCreditNotesAmount);
        const expectedNetNum = outBillNum - unappPayNum - unappCnNum;

        expect(parseFloat(summary.netPayableAmount)).toBeCloseTo(expectedNetNum, 2);
      }
    });
  });
});
