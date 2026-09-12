import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext, ExactDecimal } from '@general-erp/core';
import {
  apDocumentService,
  apPaymentService,
  apAllocationService,
  apSettlementService,
  apReconciliationService,
  apHistoricalSettlementService,
  CreateApDocumentInput,
  CreateApPaymentInput,
  CreateApAllocationInput
} from '../src/modules/finance/ap/index.js';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { accountingConfigurationService } from '../src/modules/finance/accounting-core.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { journalDraftService } from '../src/modules/finance/journal-draft.service.js';

describe('Phase 2.7.5.4 — AP Historical Settlement Reconstruction', () => {
  let ctx: RequestContext;
  let companyId: string;
  let supplierId: string;
  let expenseAccountId: string;
  let apControlAccountId: string;
  let bankAccountId: string;

  beforeEach(async () => {
    apDocumentService.clear();
    apPaymentService.clear();
    apAllocationService.clear();
    masterDataService.clear();
    chartOfAccountsService.clear();
    accountingConfigurationService.clear();
    journalDraftService.clear();

    const rand = Math.random().toString(36).substring(2, 7);
    ctx = {
      tenantId: `tenant_hist_${Date.now()}_${rand}`,
      companyId: `comp_hist_${Date.now()}_${rand}`,
      user: {
        id: 'usr_hist_admin',
        roles: ['ADMIN'],
        permissions: ['*']
      }
    };

    // 1. Seed Company & Supplier
    const comp = await masterDataService.createCompany(ctx, {
      code: `COMP_HIST_${Date.now()}_${rand}`,
      name: 'Historical AP Test Enterprise',
      legalName: 'Historical AP Test Enterprise Private Limited',
      taxId: '27AAAAA0000A1Z5'
    });
    companyId = comp.id;
    ctx.companyId = companyId;

    const { fiscalYear: fy2025 } = await fiscalPeriodService.createFiscalYear(ctx, {
      companyId,
      name: 'FY 2025-26',
      startDate: new Date('2025-04-01T00:00:00.000Z'),
      endDate: new Date('2026-03-31T23:59:59.999Z')
    });
    await fiscalPeriodService.activateFiscalYear(ctx, fy2025.id);

    const { fiscalYear: fy2026 } = await fiscalPeriodService.createFiscalYear(ctx, {
      companyId,
      name: 'FY 2026-27',
      startDate: new Date('2026-04-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T23:59:59.999Z')
    });
    await fiscalPeriodService.activateFiscalYear(ctx, fy2026.id);

    const supp = await masterDataService.createSupplier(ctx, {
      companyId,
      code: `SUPP_HIST_${Date.now()}_${rand}`,
      name: 'Historical Apex Supplies Ltd',
      gstin: '27BBBBA1111A1Z2'
    });
    supplierId = supp.id;

    // 2. Seed COA & Account Mappings
    const expAcc = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '5001',
      accountName: 'General Operating Expense',
      accountType: 'EXPENSE'
    });
    expenseAccountId = expAcc.id;

    const apCtrlAcc = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '2001',
      accountName: 'AP Trade Control Account',
      accountType: 'LIABILITY',
      isControlAccount: true,
      controlAccountType: 'AP'
    });
    apControlAccountId = apCtrlAcc.id;

    const bankAcc = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '1001',
      accountName: 'Main Bank Account',
      accountType: 'ASSET'
    });
    bankAccountId = bankAcc.id;

    const eventTypes = ['AP_SUPPLIER_BILL', 'AP_PAYMENT', 'AP_CREDIT_NOTE', 'AP_DEBIT_NOTE', 'AP_OPENING_BALANCE', 'AP_DISCOUNT'];
    for (const et of eventTypes) {
      await accountingConfigurationService.setMapping(ctx, {
        companyId,
        eventType: et,
        lineRole: 'AP_CONTROL',
        accountId: apControlAccountId
      });
    }
  });

  // Helper helper to create and post a supplier bill
  async function createAndPostBill(docDate: string, acctDate: string, amountStr = '10000.00') {
    const input: CreateApDocumentInput = {
      companyId,
      supplierId,
      documentType: 'SUPPLIER_BILL',
      documentNumber: `BILL-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      supplierInvoiceNumber: `INV-${Date.now()}`,
      documentDate: docDate,
      accountingDate: acctDate,
      dueDate: acctDate,
      lines: [
        {
          description: 'Historical Goods/Services',
          quantity: '1.0000',
          unitPrice: amountStr,
          expenseAccountId
        }
      ]
    };
    const draft = await apDocumentService.createDraft(ctx, input);
    const posted = await apDocumentService.postDocument(ctx, draft.id);
    const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
    const openItem = openItems.find(i => i.apDocumentId === posted.id)!;
    return { doc: posted, openItem };
  }

  // Helper to create and post a payment
  async function createAndPostPayment(payDate: string, acctDate: string, amountStr = '4000.00') {
    const payInput: CreateApPaymentInput = {
      companyId,
      supplierId,
      paymentDate: payDate,
      accountingDate: acctDate,
      paymentMode: 'BANK_TRANSFER',
      bankAccountId,
      totalAmount: amountStr
    };
    const draft = await apPaymentService.createDraft(ctx, payInput);
    return await apPaymentService.postPayment(ctx, draft.id);
  }

  // Helper to create and post a credit note
  async function createAndPostCreditNote(docDate: string, acctDate: string, amountStr = '2000.00') {
    const input: CreateApDocumentInput = {
      companyId,
      supplierId,
      documentType: 'CREDIT_NOTE',
      documentNumber: `CN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      documentDate: docDate,
      accountingDate: acctDate,
      dueDate: acctDate,
      lines: [
        {
          description: 'Historical Purchase Return Credit Note',
          quantity: '1.0000',
          unitPrice: amountStr,
          expenseAccountId
        }
      ]
    };
    const draft = await apDocumentService.createDraft(ctx, input);
    return await apDocumentService.postDocument(ctx, draft.id);
  }

  // --------------------------------------------------------------------------
  // 1. DATE BOUNDARY & ENTITY INCLUSION TESTS
  // --------------------------------------------------------------------------
  describe('1. Date Boundaries & Inclusion Rules', () => {
    it('should include document on or after accountingDate and exclude before accountingDate', async () => {
      const { openItem } = await createAndPostBill('2026-02-01', '2026-02-15', '5000.00');

      // Before accounting date (2026-02-14) -> Should throw BusinessRuleViolationError
      await expect(
        apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItem.id, '2026-02-14')
      ).rejects.toThrow('was posted on accountingDate');

      // On accounting date (2026-02-15) -> Should succeed
      const settlementOn = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItem.id, '2026-02-15');
      expect(settlementOn.outstandingAmount).toBe('5000.00');

      // After accounting date (2026-02-28) -> Should succeed
      const settlementAfter = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItem.id, '2026-02-28');
      expect(settlementAfter.outstandingAmount).toBe('5000.00');
    });

    it('should include allocation on or after allocationDate and exclude before allocationDate', async () => {
      const { openItem } = await createAndPostBill('2026-01-01', '2026-01-01', '10000.00');
      const payment = await createAndPostPayment('2026-01-01', '2026-01-01', '4000.00');

      // Create allocation with explicit allocationDate = 2026-01-15
      const allocInput: CreateApAllocationInput = {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '4000.00',
        allocationDate: '2026-01-15'
      };
      await apAllocationService.allocate(ctx, allocInput);

      // As of 2026-01-14: Allocation not effective yet -> Outstanding = 10,000.00
      const settlementBefore = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItem.id, '2026-01-14');
      expect(settlementBefore.outstandingAmount).toBe('10000.00');
      expect(settlementBefore.activeAllocationsTotal).toBe('0.00');

      // As of 2026-01-15: Allocation effective -> Outstanding = 6,000.00
      const settlementOn = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItem.id, '2026-01-15');
      expect(settlementOn.outstandingAmount).toBe('6000.00');
      expect(settlementOn.activeAllocationsTotal).toBe('4000.00');
    });
  });

  // --------------------------------------------------------------------------
  // 2. REVERSAL TIMING & MONOTONIC EVENT BOUNDARY TESTS
  // --------------------------------------------------------------------------
  describe('2. Reversal Timing & Monotonic Event Boundaries (Jan 09 -> 10k, Jan 15 -> 6k, Apr 09 -> 6k, Apr 15 -> 10k)', () => {
    it('should preserve state prior to reversal accounting date and exclude allocation on or after reversal accounting date', async () => {
      // Bill 10,000 posted Jan 01
      const { openItem } = await createAndPostBill('2026-01-01', '2026-01-01', '10000.00');

      // Payment 4,000 posted Jan 01
      const payment = await createAndPostPayment('2026-01-01', '2026-01-01', '4000.00');

      // Allocation 4,000 on Jan 15
      const alloc = await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '4000.00',
        allocationDate: '2026-01-15'
      });

      // Reverse allocation on Apr 15
      await apAllocationService.reverseAllocation(ctx, {
        allocationId: alloc.id,
        reversalAccountingDate: '2026-04-15',
        reason: 'Historical Reversal Test'
      });

      // Verification matrix across time boundaries:
      // Jan 09: Bill open 10,000 (alloc not active)
      const resJan09 = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItem.id, '2026-01-09');
      expect(resJan09.outstandingAmount).toBe('10000.00');

      // Jan 15: Bill outstanding 6,000 (alloc active)
      const resJan15 = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItem.id, '2026-01-15');
      expect(resJan15.outstandingAmount).toBe('6000.00');

      // Apr 09: Bill outstanding 6,000 (reversal not active yet!)
      const resApr09 = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItem.id, '2026-04-09');
      expect(resApr09.outstandingAmount).toBe('6000.00');

      // Apr 15: Bill outstanding 10,000 (reversal active on reversal accounting date!)
      const resApr15 = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItem.id, '2026-04-15');
      expect(resApr15.outstandingAmount).toBe('10000.00');

      // Apr 20: Bill outstanding 10,000 (reversal remains active)
      const resApr20 = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItem.id, '2026-04-20');
      expect(resApr20.outstandingAmount).toBe('10000.00');
    });

    it('should handle document reversals on reversal accounting date', async () => {
      const { doc, openItem } = await createAndPostBill('2026-01-01', '2026-01-01', '7500.00');

      // Reverse document on 2026-03-01
      await apDocumentService.reverseDocument(ctx, doc.id, 'Customer Cancel', '2026-03-01');

      // As of 2026-02-28: Document was active -> settlement query succeeds
      const summaryFeb = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItem.id, '2026-02-28');
      expect(summaryFeb.outstandingAmount).toBe('7500.00');

      // As of 2026-03-01: Document is reversed -> settlement query rejects
      await expect(
        apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItem.id, '2026-03-01')
      ).rejects.toThrow('was reversed on reversalAccountingDate');
    });

    it('should handle payment reversals on reversal accounting date', async () => {
      const payment = await createAndPostPayment('2026-01-01', '2026-01-01', '5000.00');

      // Reverse payment on 2026-03-10
      await apPaymentService.reversePayment(ctx, payment.id, 'Bounced Cheque', '2026-03-10');

      // As of 2026-03-09: Payment active -> utilization unapplied = 5,000.00
      const utilMar09 = await apHistoricalSettlementService.getHistoricalSourceUtilization(ctx, 'PAYMENT', payment.id, '2026-03-09');
      expect(utilMar09.unappliedAmount).toBe('5000.00');

      // As of 2026-03-10: Payment reversed -> utilization query rejects
      await expect(
        apHistoricalSettlementService.getHistoricalSourceUtilization(ctx, 'PAYMENT', payment.id, '2026-03-10')
      ).rejects.toThrow('was reversed on reversalAccountingDate');
    });
  });

  // --------------------------------------------------------------------------
  // 3. CURRENT VS HISTORICAL DIFFERENCE TEST (MANDATORY)
  // --------------------------------------------------------------------------
  describe('3. Current vs Historical State Difference (Proves True Historical Event Reconstruction)', () => {
    it('should produce different financial results for historical asOfDate vs current live state', async () => {
      // Bill 12,000 posted Jan 01
      const { openItem } = await createAndPostBill('2026-01-01', '2026-01-01', '12000.00');

      // Payment 12,000 posted Feb 01
      const payment = await createAndPostPayment('2026-02-01', '2026-02-01', '12000.00');

      // Allocate fully on Feb 01 -> Bill settled in LIVE state
      await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '12000.00',
        allocationDate: '2026-02-01'
      });

      // 1. Current LIVE State:
      const liveSummary = await apSettlementService.getSupplierSettlementSummary(ctx, supplierId);
      expect(liveSummary.totalOutstandingBillsAmount).toBe('0.00');
      expect(liveSummary.totalUnappliedPaymentsAmount).toBe('0.00');
      expect(liveSummary.netPayableAmount).toBe('0.00');
      expect(liveSummary.openItemsCount).toBe(0);

      // 2. Historical State as of Jan 15 (after Bill, before Payment & Allocation):
      const histSummaryJan = await apHistoricalSettlementService.getHistoricalSupplierSettlementSummary(ctx, supplierId, '2026-01-15');
      expect(histSummaryJan.totalPostedBillsAmount).toBe('12000.00');
      expect(histSummaryJan.totalOutstandingBillsAmount).toBe('12000.00');
      expect(histSummaryJan.totalPaymentsAmount).toBe('0.00');
      expect(histSummaryJan.totalUnappliedPaymentsAmount).toBe('0.00');
      expect(histSummaryJan.netPayableAmount).toBe('12000.00');
      expect(histSummaryJan.openItemsCount).toBe(1);

      // 3. Proves that Historical Result != Current Live Result
      expect(histSummaryJan.netPayableAmount).not.toBe(liveSummary.netPayableAmount);
      expect(histSummaryJan.totalOutstandingBillsAmount).not.toBe(liveSummary.totalOutstandingBillsAmount);
    });
  });

  // --------------------------------------------------------------------------
  // 4. SUPPLIER & COMPANY HISTORICAL SUMMARY EQUIVALENCE
  // --------------------------------------------------------------------------
  describe('4. Historical Supplier & Company Summaries Equivalence', () => {
    it('should verify company historical net payable equals sum of historical supplier net payables', async () => {
      // Seed 2nd supplier
      const supp2 = await masterDataService.createSupplier(ctx, {
        companyId,
        code: `SUPP2_HIST_${Date.now()}`,
        name: 'Second Historical Vendor'
      });

      // Supplier 1: Bill 10,000 (Jan 01), Payment 3,000 (Jan 10)
      const { openItem: item1 } = await createAndPostBill('2026-01-01', '2026-01-01', '10000.00');
      const pay1 = await createAndPostPayment('2026-01-10', '2026-01-10', '3000.00');

      // Supplier 2: Bill 15,000 (Jan 05), Credit Note 5,000 (Jan 12)
      const input2: CreateApDocumentInput = {
        companyId,
        supplierId: supp2.id,
        documentType: 'SUPPLIER_BILL',
        documentNumber: `BILL2-${Date.now()}`,
        documentDate: '2026-01-05',
        accountingDate: '2026-01-05',
        dueDate: '2026-01-05',
        lines: [{ description: 'Vendor 2 Bill', quantity: '1.0000', unitPrice: '15000.00', expenseAccountId }]
      };
      const draft2 = await apDocumentService.createDraft(ctx, input2);
      await apDocumentService.postDocument(ctx, draft2.id);

      const cn2Input: CreateApDocumentInput = {
        companyId,
        supplierId: supp2.id,
        documentType: 'CREDIT_NOTE',
        documentNumber: `CN2-${Date.now()}`,
        documentDate: '2026-01-12',
        accountingDate: '2026-01-12',
        dueDate: '2026-01-12',
        lines: [{ description: 'Vendor 2 Credit Note', quantity: '1.0000', unitPrice: '5000.00', expenseAccountId }]
      };
      const cn2Draft = await apDocumentService.createDraft(ctx, cn2Input);
      await apDocumentService.postDocument(ctx, cn2Draft.id);

      // Evaluate Historical Summary as of 2026-01-15:
      const summarySupp1 = await apHistoricalSettlementService.getHistoricalSupplierSettlementSummary(ctx, supplierId, '2026-01-15');
      // Supplier 1: Outstanding = 10,000, Unapplied Pay = 3,000 -> Net Payable = 7,000.00

      ctx.companyId = companyId;
      const summarySupp2 = await apHistoricalSettlementService.getHistoricalSupplierSettlementSummary(ctx, supp2.id, '2026-01-15');
      // Supplier 2: Outstanding = 15,000, Unapplied CN = 5,000 -> Net Payable = 10,000.00

      const supp1Net = ExactDecimal.parse(summarySupp1.netPayableAmount, 2);
      const supp2Net = ExactDecimal.parse(summarySupp2.netPayableAmount, 2);
      const expectedCompanyNet = supp1Net.add(supp2Net).toString();

      // Company Reconciliation as of 2026-01-15:
      const companyRecon = await apHistoricalSettlementService.reconcileHistoricalCompanyAP(ctx, companyId, '2026-01-15');

      expect(companyRecon.netSubledgerPayableTotal).toBe(expectedCompanyNet);
      expect(companyRecon.netSubledgerPayableTotal).toBe('17000.00');
    });

    it('should support signed negative historical net payable positions without clamping', async () => {
      // Payment 8,000 posted Jan 01 (no bills) -> Net payable = -8,000.00
      await createAndPostPayment('2026-01-01', '2026-01-01', '8000.00');

      const summary = await apHistoricalSettlementService.getHistoricalSupplierSettlementSummary(ctx, supplierId, '2026-01-15');
      expect(summary.netPayableAmount).toBe('-8000.00');

      const recon = await apHistoricalSettlementService.reconcileHistoricalCompanyAP(ctx, companyId, '2026-01-15');
      expect(recon.netSubledgerPayableTotal).toBe('-8000.00');
    });
  });

  // --------------------------------------------------------------------------
  // 5. DETERMINISTIC RANDOMIZED HISTORICAL PROPERTY TESTS (50 SCENARIOS)
  // --------------------------------------------------------------------------
  describe('5. Deterministic Randomized Historical Property Tests (50 Scenarios)', () => {
    it('should satisfy historical balance conservation and signed reconciliation across 50 randomized generated scenarios', async () => {
      for (let i = 0; i < 50; i++) {
        const testCtx: RequestContext = {
          tenantId: `tenant_rand_hist_${i}`,
          companyId: `comp_rand_hist_${i}`,
          user: { id: 'usr_rand', roles: ['ADMIN'], permissions: ['*'] }
        };

        const comp = await masterDataService.createCompany(testCtx, {
          code: `COMP_R_${i}_${Date.now()}`,
          name: `Rand Comp ${i}`,
          legalName: `Rand Comp Legal ${i}`,
          taxId: '27AAAAA0000A1Z5'
        });
        testCtx.companyId = comp.id;

        const { fiscalYear: rFy } = await fiscalPeriodService.createFiscalYear(testCtx, {
          companyId: comp.id,
          name: `FY 2025-26 ${i}`,
          startDate: new Date('2025-04-01T00:00:00.000Z'),
          endDate: new Date('2026-03-31T23:59:59.999Z')
        });
        await fiscalPeriodService.activateFiscalYear(testCtx, rFy.id);

        const supp = await masterDataService.createSupplier(testCtx, {
          companyId: comp.id,
          code: `SUPP_R_${i}`,
          name: `Rand Supp ${i}`
        });

        const expAcc = await chartOfAccountsService.createAccount(testCtx, {
          companyId: comp.id,
          accountCode: String(5000 + i),
          accountName: 'Expense',
          accountType: 'EXPENSE'
        });
        const ctrlAcc = await chartOfAccountsService.createAccount(testCtx, {
          companyId: comp.id,
          accountCode: String(2000 + i),
          accountName: 'AP Control',
          accountType: 'LIABILITY',
          isControlAccount: true,
          controlAccountType: 'AP'
        });
        const bnkAcc = await chartOfAccountsService.createAccount(testCtx, {
          companyId: comp.id,
          accountCode: String(1000 + i),
          accountName: 'Bank',
          accountType: 'ASSET'
        });

        const eventTypes = ['AP_SUPPLIER_BILL', 'AP_PAYMENT', 'AP_CREDIT_NOTE', 'AP_DEBIT_NOTE', 'AP_OPENING_BALANCE', 'AP_DISCOUNT'];
        for (const et of eventTypes) {
          await accountingConfigurationService.setMapping(testCtx, {
            companyId: comp.id,
            eventType: et,
            lineRole: 'AP_CONTROL',
            accountId: ctrlAcc.id
          });
        }

        // Deterministic amounts
        const billAmt = (100 + i * 10).toFixed(2);
        const payAmt = (30 + i * 2).toFixed(2);

        // Bill posted 2026-01-05
        const billDraft = await apDocumentService.createDraft(testCtx, {
          companyId: comp.id,
          supplierId: supp.id,
          documentType: 'SUPPLIER_BILL',
          documentNumber: `BILL-R-${i}`,
          documentDate: '2026-01-05',
          accountingDate: '2026-01-05',
          dueDate: '2026-01-05',
          lines: [{ description: 'Rand item', quantity: '1.0000', unitPrice: billAmt, expenseAccountId: expAcc.id }]
        });
        const billPosted = await apDocumentService.postDocument(testCtx, billDraft.id);
        const openItems = await apDocumentService.getOpenItems(testCtx, comp.id, { supplierId: supp.id });
        const openItem = openItems.find(x => x.apDocumentId === billPosted.id)!;

        // Payment posted 2026-01-10
        const payDraft = await apPaymentService.createDraft(testCtx, {
          companyId: comp.id,
          supplierId: supp.id,
          paymentDate: '2026-01-10',
          accountingDate: '2026-01-10',
          paymentMode: 'BANK_TRANSFER',
          bankAccountId: bnkAcc.id,
          totalAmount: payAmt
        });
        const payPosted = await apPaymentService.postPayment(testCtx, payDraft.id);

        // Allocation on 2026-01-15
        await apAllocationService.allocate(testCtx, {
          allocationSourceType: 'PAYMENT',
          paymentId: payPosted.id,
          openItemId: openItem.id,
          allocatedAmount: payAmt,
          allocationDate: '2026-01-15'
        });

        // Evaluate Historical position as of 2026-01-20:
        const summary = await apHistoricalSettlementService.getHistoricalSupplierSettlementSummary(testCtx, supp.id, '2026-01-20');

        // Conservation Invariant: Allocated + Unapplied = Total Payment
        const allocDec = ExactDecimal.parse(summary.totalActiveAllocationsAmount, 2);
        const unappDec = ExactDecimal.parse(summary.totalUnappliedPaymentsAmount, 2);
        const totalPayDec = ExactDecimal.parse(summary.totalPaymentsAmount, 2);
        expect(allocDec.add(unappDec).equals(totalPayDec)).toBe(true);

        // Net Payable Invariant: Net Payable = Outstanding Bills - Unapplied Payments
        const outBillsDec = ExactDecimal.parse(summary.totalOutstandingBillsAmount, 2);
        const expectedNet = outBillsDec.sub(unappDec).toString();
        expect(summary.netPayableAmount).toBe(expectedNet);
      }
    });
  });
});
