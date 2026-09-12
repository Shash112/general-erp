import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext, ValidationError, NotFoundError, ForbiddenError, BusinessRuleViolationError } from '@general-erp/core';
import { apSettlementService } from '../src/modules/finance/ap/ap-settlement.service.js';
import { apPaymentService } from '../src/modules/finance/ap/ap-payment.service.js';
import { apDocumentService } from '../src/modules/finance/ap/ap-document.service.js';
import { apAllocationService } from '../src/modules/finance/ap/ap-allocation.service.js';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { accountingConfigurationService } from '../src/modules/finance/accounting-core.service.js';

describe('Phase 2.7.5.1 — AP Open Item Settlement & Source Utilization Service', () => {
  const tenantId = 'tenant_ap_settle_5_1';
  const companyId = 'cmp_ap_settle_5_1';
  const supplierId = 'supp_ap_settle_001';

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
    tenantId: 'tenant_other_5_1',
    companyId: 'cmp_other_5_1',
    user: {
      id: 'usr_other',
      tenantId: 'tenant_other_5_1',
      roles: ['AP_CLERK'],
      permissions: ['*']
    }
  };

  let bankAccountId: string;
  let expAccountId: string;
  let apAccountId: string;
  let discountIncomeAccountId: string;

  beforeEach(async () => {
    apSettlementService.clear?.();
    apAllocationService.clear();
    apPaymentService.clear();
    apDocumentService.clear();
    masterDataService.clear();
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    accountingConfigurationService.clear();

    await masterDataService.createCompany(ctx, {
      id: companyId,
      name: 'Acme Settlement Corp',
      legalName: 'Acme Settlement Corp Ltd',
      currency: 'INR'
    });

    await masterDataService.createSupplier(ctx, {
      id: supplierId,
      companyId,
      name: 'Vendor One Ltd',
      code: 'VEND-001'
    });

    await masterDataService.createSupplier(ctx, {
      id: 'supp_ap_settle_002',
      companyId,
      name: 'Vendor Two Ltd',
      code: 'VEND-002'
    });

    await masterDataService.createCompany(otherTenantCtx, {
      id: 'cmp_other_5_1',
      name: 'Other Corp',
      legalName: 'Other Corp Ltd',
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
    }
  });

  describe('1. Open Item Settlement Evaluation (Live Mode)', () => {
    it('evaluates OPEN status for an unallocated bill open item', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '10000.00', taxableAmount: '10000.00', taxAmount: '0.00', grossAmount: '10000.00', expenseAccountId: expAccountId }]
      });
      const bill = await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === bill.id)!;

      const settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);

      expect(settlement.openItemId).toBe(openItem.id);
      expect(settlement.originalAmount).toBe('10000.00');
      expect(settlement.activeAllocationsTotal).toBe('0.00');
      expect(settlement.activeDiscountsTotal).toBe('0.00');
      expect(settlement.outstandingAmount).toBe('10000.00');
      expect(settlement.settlementStatus).toBe('OPEN');
    });

    it('evaluates PARTIALLY_SETTLED status after partial payment allocation', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '10000.00', taxableAmount: '10000.00', taxAmount: '0.00', grossAmount: '10000.00', expenseAccountId: expAccountId }]
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
        totalAmount: '4000.00'
      });
      const payment = await apPaymentService.postPayment(ctx, payDraft.id);

      await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '4000.00'
      });

      const settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);

      expect(settlement.originalAmount).toBe('10000.00');
      expect(settlement.activeAllocationsTotal).toBe('4000.00');
      expect(settlement.activeDiscountsTotal).toBe('0.00');
      expect(settlement.outstandingAmount).toBe('6000.00');
      expect(settlement.settlementStatus).toBe('PARTIALLY_SETTLED');
    });

    it('evaluates SETTLED status after full payment and discount allocation', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '10000.00', taxableAmount: '10000.00', taxAmount: '0.00', grossAmount: '10000.00', expenseAccountId: expAccountId }]
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

      const settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);

      expect(settlement.originalAmount).toBe('10000.00');
      expect(settlement.activeAllocationsTotal).toBe('9500.00');
      expect(settlement.activeDiscountsTotal).toBe('500.00');
      expect(settlement.outstandingAmount).toBe('0.00');
      expect(settlement.settlementStatus).toBe('SETTLED');
    });

    it('evaluates multiple allocations correctly and excludes reversed allocations', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '10000.00', taxableAmount: '10000.00', taxAmount: '0.00', grossAmount: '10000.00', expenseAccountId: expAccountId }]
      });
      const bill = await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === bill.id)!;

      const payDraft1 = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '3000.00'
      });
      const payment1 = await apPaymentService.postPayment(ctx, payDraft1.id);

      const alloc1 = await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment1.id,
        openItemId: openItem.id,
        allocatedAmount: '3000.00'
      });

      const payDraft2 = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId,
        paymentDate: '2025-04-16',
        accountingDate: '2025-04-16',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '2000.00'
      });
      const payment2 = await apPaymentService.postPayment(ctx, payDraft2.id);

      await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment2.id,
        openItemId: openItem.id,
        allocatedAmount: '2000.00'
      });

      // Reverse alloc1
      await apAllocationService.reverseAllocation(ctx, { allocationId: alloc1.id });

      const settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);

      // Only payment2 (2000.00) remains active!
      expect(settlement.activeAllocationsTotal).toBe('2000.00');
      expect(settlement.outstandingAmount).toBe('8000.00');
      expect(settlement.settlementStatus).toBe('PARTIALLY_SETTLED');
    });

    it('enforces tenant and company context isolation on open item settlement', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '5000.00', taxableAmount: '5000.00', taxAmount: '0.00', grossAmount: '5000.00', expenseAccountId: expAccountId }]
      });
      const bill = await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === bill.id)!;

      await expect(apSettlementService.getOpenItemSettlement(otherTenantCtx, openItem.id)).rejects.toThrow();
    });

    it('throws NotFoundError for non-existent open item', async () => {
      await expect(apSettlementService.getOpenItemSettlement(ctx, 'openitem_non_existent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('2. Historical Mode Open Item Settlement', () => {
    it('evaluates historical open item settlement as of specific accounting and allocation cutoffs', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-05',
        accountingDate: '2025-04-05',
        dueDate: '2025-05-05',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '10000.00', taxableAmount: '10000.00', taxAmount: '0.00', grossAmount: '10000.00', expenseAccountId: expAccountId }]
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
        totalAmount: '4000.00'
      });
      const payment = await apPaymentService.postPayment(ctx, payDraft.id);

      await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '4000.00',
        allocationDate: '2025-04-15'
      });

      // 1. Query asOfDate = 2025-04-10 (Before allocation on 2025-04-15) -> OPEN (10000.00)
      const hist1 = await apSettlementService.getOpenItemSettlement(ctx, openItem.id, '2025-04-10', 'HISTORICAL');
      expect(hist1.outstandingAmount).toBe('10000.00');
      expect(hist1.settlementStatus).toBe('OPEN');
      expect(hist1.activeAllocationsTotal).toBe('0.00');

      // 2. Query asOfDate = 2025-04-20 (After allocation on 2025-04-15) -> PARTIALLY_SETTLED (6000.00)
      const hist2 = await apSettlementService.getOpenItemSettlement(ctx, openItem.id, '2025-04-20', 'HISTORICAL');
      expect(hist2.outstandingAmount).toBe('6000.00');
      expect(hist2.settlementStatus).toBe('PARTIALLY_SETTLED');
      expect(hist2.activeAllocationsTotal).toBe('4000.00');
    });

    it('requires asOfDate when calculation mode is HISTORICAL', async () => {
      await expect(
        apSettlementService.getOpenItemSettlement(ctx, 'openitem_123', undefined, 'HISTORICAL')
      ).rejects.toThrow(ValidationError);
    });

    it('rejects historical query when open item was posted after requested asOfDate', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-20',
        accountingDate: '2025-04-20',
        dueDate: '2025-05-20',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '5000.00', taxableAmount: '5000.00', taxAmount: '0.00', grossAmount: '5000.00', expenseAccountId: expAccountId }]
      });
      const bill = await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === bill.id)!;

      await expect(
        apSettlementService.getOpenItemSettlement(ctx, openItem.id, '2025-04-10', 'HISTORICAL')
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('retains active status prior to reversal date in historical mode', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-05',
        accountingDate: '2025-04-05',
        dueDate: '2025-05-05',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '8000.00', taxableAmount: '8000.00', taxAmount: '0.00', grossAmount: '8000.00', expenseAccountId: expAccountId }]
      });
      const bill = await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === bill.id)!;

      const payDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId,
        paymentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '8000.00'
      });
      const payment = await apPaymentService.postPayment(ctx, payDraft.id);

      const alloc = await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '8000.00',
        allocationDate: '2025-04-10'
      });

      // Reverse allocation with reversal accounting date logic
      (alloc as any).reversalAccountingDate = '2025-04-25';
      await apAllocationService.reverseAllocation(ctx, { allocationId: alloc.id });

      // Live mode shows OPEN (allocation reversed)
      const live = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);
      expect(live.settlementStatus).toBe('OPEN');
      expect(live.outstandingAmount).toBe('8000.00');

      // Historical as of 2025-04-15 (between alloc date 04-10 and reversal date 04-25) -> SETTLED (0.00)
      const histMid = await apSettlementService.getOpenItemSettlement(ctx, openItem.id, '2025-04-15', 'HISTORICAL');
      expect(histMid.settlementStatus).toBe('SETTLED');
      expect(histMid.outstandingAmount).toBe('0.00');

      // Historical as of 2025-04-30 (after reversal date 04-25) -> OPEN (8000.00)
      const histLate = await apSettlementService.getOpenItemSettlement(ctx, openItem.id, '2025-04-30', 'HISTORICAL');
      expect(histLate.settlementStatus).toBe('OPEN');
      expect(histLate.outstandingAmount).toBe('8000.00');
    });
  });

  describe('3. Credit Source Utilization Evaluation (Live & Historical Mode)', () => {
    it('evaluates FULLY_UNAPPLIED status for a fresh payment', async () => {
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

      const util = await apSettlementService.getSourceUtilization(ctx, 'PAYMENT', payment.id);

      expect(util.sourceId).toBe(payment.id);
      expect(util.sourceType).toBe('PAYMENT');
      expect(util.totalAmount).toBe('5000.00');
      expect(util.allocatedAmount).toBe('0.00');
      expect(util.unappliedAmount).toBe('5000.00');
      expect(util.utilizationStatus).toBe('FULLY_UNAPPLIED');
    });

    it('evaluates PARTIALLY_APPLIED and FULLY_APPLIED for payment source', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '10000.00', taxableAmount: '10000.00', taxAmount: '0.00', grossAmount: '10000.00', expenseAccountId: expAccountId }]
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

      // Allocate partial 2000.00
      await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '2000.00'
      });

      const utilPartial = await apSettlementService.getSourceUtilization(ctx, 'PAYMENT', payment.id);
      expect(utilPartial.allocatedAmount).toBe('2000.00');
      expect(utilPartial.unappliedAmount).toBe('3000.00');
      expect(utilPartial.utilizationStatus).toBe('PARTIALLY_APPLIED');

      // Allocate remaining 3000.00
      await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '3000.00'
      });

      const utilFull = await apSettlementService.getSourceUtilization(ctx, 'PAYMENT', payment.id);
      expect(utilFull.allocatedAmount).toBe('5000.00');
      expect(utilFull.unappliedAmount).toBe('0.00');
      expect(utilFull.utilizationStatus).toBe('FULLY_APPLIED');
    });

    it('evaluates source utilization for a Credit Note source', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '10000.00', taxableAmount: '10000.00', taxAmount: '0.00', grossAmount: '10000.00', expenseAccountId: expAccountId }]
      });
      const bill = await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === bill.id)!;

      const cnDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'CREDIT_NOTE',
        documentDate: '2025-04-12',
        accountingDate: '2025-04-12',
        dueDate: '2025-05-12',
        lines: [{ description: 'CN Line 1', quantity: '1.0000', unitPrice: '3000.00', taxableAmount: '3000.00', taxAmount: '0.00', grossAmount: '3000.00', expenseAccountId: expAccountId }]
      });
      const creditNote = await apDocumentService.postDocument(ctx, cnDraft.id);

      await apAllocationService.allocate(ctx, {
        allocationSourceType: 'CREDIT_NOTE',
        creditNoteId: creditNote.id,
        openItemId: openItem.id,
        allocatedAmount: '3000.00'
      });

      const utilCN = await apSettlementService.getSourceUtilization(ctx, 'CREDIT_NOTE', creditNote.id);
      expect(utilCN.sourceType).toBe('CREDIT_NOTE');
      expect(utilCN.totalAmount).toBe('3000.00');
      expect(utilCN.allocatedAmount).toBe('3000.00');
      expect(utilCN.unappliedAmount).toBe('0.00');
      expect(utilCN.utilizationStatus).toBe('FULLY_APPLIED');
    });

    it('rejects invalid sourceType or non-credit note document', async () => {
      await expect(
        apSettlementService.getSourceUtilization(ctx, 'INVALID' as any, 'pay_123')
      ).rejects.toThrow(ValidationError);

      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '5000.00', taxableAmount: '5000.00', taxAmount: '0.00', grossAmount: '5000.00', expenseAccountId: expAccountId }]
      });
      const bill = await apDocumentService.postDocument(ctx, billDraft.id);

      await expect(
        apSettlementService.getSourceUtilization(ctx, 'CREDIT_NOTE', bill.id)
      ).rejects.toThrow(ValidationError);
    });

    it('enforces tenant and company context isolation on source utilization', async () => {
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

      await expect(apSettlementService.getSourceUtilization(otherTenantCtx, 'PAYMENT', payment.id)).rejects.toThrow();
    });
  });

  describe('4. Database Snapshot & Financial Integrity Invariant Protection', () => {
    it('executes read queries using REPEATABLE READ READ ONLY snapshot when pool is configured', async () => {
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

      const result = await (apSettlementService as any).getSourceUtilization(ctx, 'PAYMENT', 'non_existent').catch(() => null);
      expect(queryExecuted).toBe(true);
      expect(transactionMode).toContain('REPEATABLE READ');
      expect(transactionMode).toContain('READ ONLY');
      expect(transactionMode).not.toContain('FOR UPDATE');

      // Reset pool
      apSettlementService.setDbPool(undefined as any);
    });

    it('detects impossible open item balance corruption (allocations > originalAmount) and surfaces explicit integrity error', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '1000.00', taxableAmount: '1000.00', taxAmount: '0.00', grossAmount: '1000.00', expenseAccountId: expAccountId }]
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

      // Force an allocation exceeding open item original amount into store
      const store = (apAllocationService as any).allocationsStore;
      const corruptId = 'alloc_corrupt_openitem';
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
        allocatedAmount: '2000.00',
        discountAmount: '0.00',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Querying settlement should detect total allocations (2000.00) > original (1000.00)
      await expect(apSettlementService.getOpenItemSettlement(ctx, openItem.id)).rejects.toThrow(BusinessRuleViolationError);
    });

    it('detects source over-utilization corruption (allocations > totalAmount) and surfaces explicit integrity error', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '10000.00', taxableAmount: '10000.00', taxAmount: '0.00', grossAmount: '10000.00', expenseAccountId: expAccountId }]
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

      // Force an allocation larger than payment amount to simulate data corruption
      const store = (apAllocationService as any).allocationsStore;
      const corruptId = 'alloc_corrupt_source';
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
        allocatedAmount: '3000.00',
        discountAmount: '0.00',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await expect(apSettlementService.getSourceUtilization(ctx, 'PAYMENT', payment.id)).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  describe('5. 50 Randomized Financial Calculation Scenarios', () => {
    it('executes 50 randomized allocation and settlement flows asserting exact decimal conservation', async () => {
      for (let i = 0; i < 50; i++) {
        const amountVal = Math.floor(Math.random() * 5000) + 500;
        const amountStr = amountVal.toFixed(2);

        const billDraft = await apDocumentService.createDraft(ctx, {
          companyId,
          supplierId,
          documentType: 'SUPPLIER_BILL',
          documentDate: '2025-04-10',
          accountingDate: '2025-04-10',
          dueDate: '2025-05-10',
          lines: [{ description: 'Rand Item', quantity: '1.0000', unitPrice: amountStr, taxableAmount: amountStr, taxAmount: '0.00', grossAmount: amountStr, expenseAccountId: expAccountId }]
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
          totalAmount: amountStr
        });
        const payment = await apPaymentService.postPayment(ctx, payDraft.id);

        await apAllocationService.allocate(ctx, {
          allocationSourceType: 'PAYMENT',
          paymentId: payment.id,
          openItemId: openItem.id,
          allocatedAmount: amountStr
        });

        const settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);
        expect(settlement.settlementStatus).toBe('SETTLED');
        expect(settlement.outstandingAmount).toBe('0.00');

        const util = await apSettlementService.getSourceUtilization(ctx, 'PAYMENT', payment.id);
        expect(util.utilizationStatus).toBe('FULLY_APPLIED');
        expect(util.unappliedAmount).toBe('0.00');
      }
    });
  });
});
