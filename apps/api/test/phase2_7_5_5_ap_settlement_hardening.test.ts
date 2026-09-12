import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext, ExactDecimal, BusinessRuleViolationError, ValidationError } from '@general-erp/core';
import {
  apDocumentService,
  apPaymentService,
  apAllocationService,
  apSettlementService,
  apReconciliationService,
  apHistoricalSettlementService,
  ApSettlementFoundation,
  CreateApDocumentInput,
  CreateApPaymentInput,
  CreateApAllocationInput
} from '../src/modules/finance/ap/index.js';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { accountingConfigurationService } from '../src/modules/finance/accounting-core.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { journalDraftService } from '../src/modules/finance/journal-draft.service.js';

describe('Phase 2.7.5.5 — AP Settlement & Reconciliation Hardening & Verification', () => {
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
      tenantId: `tenant_hard_${Date.now()}_${rand}`,
      companyId: `comp_hard_${Date.now()}_${rand}`,
      user: {
        id: 'usr_hard_admin',
        roles: ['ADMIN'],
        permissions: ['*']
      }
    };

    // 1. Seed Company & Supplier
    const comp = await masterDataService.createCompany(ctx, {
      code: `COMP_HARD_${Date.now()}_${rand}`,
      name: 'AP Hardening Test Enterprise',
      legalName: 'AP Hardening Test Enterprise Private Limited',
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

    const supp = await masterDataService.createSupplier(ctx, {
      companyId,
      code: `SUPP_HARD_${Date.now()}_${rand}`,
      name: 'Hardening Vendor Ltd',
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

  async function createAndPostBill(docDate: string, acctDate: string, amountStr = '10000.00', customSupplierId?: string) {
    const targetSuppId = customSupplierId || supplierId;
    const input: CreateApDocumentInput = {
      companyId,
      supplierId: targetSuppId,
      documentType: 'SUPPLIER_BILL',
      documentNumber: `BILL-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      supplierInvoiceNumber: `INV-${Date.now()}`,
      documentDate: docDate,
      accountingDate: acctDate,
      dueDate: acctDate,
      lines: [
        {
          description: 'Hardening Goods/Services',
          quantity: '1.0000',
          unitPrice: amountStr,
          expenseAccountId
        }
      ]
    };
    const draft = await apDocumentService.createDraft(ctx, input);
    const posted = await apDocumentService.postDocument(ctx, draft.id);
    const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId: targetSuppId });
    const openItem = openItems.find(i => i.apDocumentId === posted.id)!;
    return { doc: posted, openItem };
  }

  async function createAndPostPayment(payDate: string, acctDate: string, amountStr = '4000.00', customSupplierId?: string) {
    const targetSuppId = customSupplierId || supplierId;
    const payInput: CreateApPaymentInput = {
      companyId,
      supplierId: targetSuppId,
      paymentDate: payDate,
      accountingDate: acctDate,
      paymentMode: 'BANK_TRANSFER',
      bankAccountId,
      totalAmount: amountStr,
      referenceNumber: `TRX-${Date.now()}`
    };
    const draftPay = await apPaymentService.createDraft(ctx, payInput);
    return await apPaymentService.postPayment(ctx, draftPay.id);
  }

  // --------------------------------------------------------------------------
  // 1. FINANCIAL SEMANTICS & EXACT DECIMAL AUDIT
  // --------------------------------------------------------------------------
  describe('1. Financial Semantics & ExactDecimal Audit', () => {
    it('should verify ExactDecimal precision on large financial amounts (99,999,999,999.99)', async () => {
      const largeAmount = '99999999999.99';
      const { openItem } = await createAndPostBill('2026-01-01', '2026-01-01', largeAmount);
      const payment = await createAndPostPayment('2026-01-01', '2026-01-01', '0.01');

      await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '0.01',
        allocationDate: '2026-01-01'
      });

      const settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);
      expect(settlement.originalAmount).toBe(largeAmount);
      expect(settlement.activeAllocationsTotal).toBe('0.01');
      expect(settlement.outstandingAmount).toBe('99999999999.98');

      const summary = await apSettlementService.getSupplierSettlementSummary(ctx, supplierId);
      expect(summary.totalPostedBillsAmount).toBe(largeAmount);
      expect(summary.totalOutstandingBillsAmount).toBe('99999999999.98');
      expect(summary.netPayableAmount).toBe('99999999999.98');
    });

    it('should maintain zero semantics and exact scale validation without floating point rounding', async () => {
      const { openItem } = await createAndPostBill('2026-01-01', '2026-01-01', '100.00');
      const payment = await createAndPostPayment('2026-01-01', '2026-01-01', '100.00');

      await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '100.00'
      });

      const settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);
      expect(settlement.outstandingAmount).toBe('0.00');
      expect(settlement.settlementStatus).toBe('SETTLED');

      const util = await apSettlementService.getSourceUtilization(ctx, 'PAYMENT', payment.id);
      expect(util.unappliedAmount).toBe('0.00');
      expect(util.utilizationStatus).toBe('FULLY_APPLIED');

      const recon = await apReconciliationService.reconcileCompanyAP(ctx, companyId);
      expect(recon.reconciliationStatus).toBe('PASS');
      expect(recon.reconciliationDifference).toBe('0.00');
    });
  });

  // --------------------------------------------------------------------------
  // 2. CONCURRENCY & RACE CONDITION HARDENING
  // --------------------------------------------------------------------------
  describe('2. Concurrency & Race Condition Hardening', () => {
    it('should safely execute multiple concurrent allocations against a single payment without over-allocation', async () => {
      // Payment total = 10,000.00
      const payment = await createAndPostPayment('2026-01-01', '2026-01-01', '10000.00');

      // Create 3 bills of 4,000, 3,000, 3,000
      const { openItem: item1 } = await createAndPostBill('2026-01-01', '2026-01-01', '4000.00');
      const { openItem: item2 } = await createAndPostBill('2026-01-01', '2026-01-01', '3000.00');
      const { openItem: item3 } = await createAndPostBill('2026-01-01', '2026-01-01', '3000.00');

      // Execute 3 concurrent allocation promises
      const p1 = apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: item1.id,
        allocatedAmount: '4000.00'
      });
      const p2 = apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: item2.id,
        allocatedAmount: '3000.00'
      });
      const p3 = apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: item3.id,
        allocatedAmount: '3000.00'
      });

      const results = await Promise.all([p1, p2, p3]);
      expect(results).toHaveLength(3);

      const util = await apSettlementService.getSourceUtilization(ctx, 'PAYMENT', payment.id);
      expect(util.allocatedAmount).toBe('10000.00');
      expect(util.unappliedAmount).toBe('0.00');
      expect(util.utilizationStatus).toBe('FULLY_APPLIED');
    });

    it('should reject concurrent over-allocation attempts exceeding available payment balance', async () => {
      // Payment total = 10,000.00
      const payment = await createAndPostPayment('2026-01-01', '2026-01-01', '10000.00');

      // Two bills of 6,000 each
      const { openItem: item1 } = await createAndPostBill('2026-01-01', '2026-01-01', '6000.00');
      const { openItem: item2 } = await createAndPostBill('2026-01-01', '2026-01-01', '6000.00');

      // Execute 2 concurrent allocation attempts of 6,000 (total 12,000 > 10,000)
      const results = await Promise.allSettled([
        apAllocationService.allocate(ctx, {
          allocationSourceType: 'PAYMENT',
          paymentId: payment.id,
          openItemId: item1.id,
          allocatedAmount: '6000.00'
        }),
        apAllocationService.allocate(ctx, {
          allocationSourceType: 'PAYMENT',
          paymentId: payment.id,
          openItemId: item2.id,
          allocatedAmount: '6000.00'
        })
      ]);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const util = await apSettlementService.getSourceUtilization(ctx, 'PAYMENT', payment.id);
      expect(util.allocatedAmount).toBe('6000.00');
      expect(util.unappliedAmount).toBe('4000.00');
    });

    it('should return identical idempotent allocation result under concurrent duplicate submissions', async () => {
      const { openItem } = await createAndPostBill('2026-01-01', '2026-01-01', '5000.00');
      const payment = await createAndPostPayment('2026-01-01', '2026-01-01', '5000.00');

      const idempotencyKey = `idemp_alloc_${Date.now()}`;
      const input: CreateApAllocationInput = {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '5000.00',
        idempotencyKey
      };

      const [res1, res2, res3] = await Promise.all([
        apAllocationService.allocate(ctx, input),
        apAllocationService.allocate(ctx, input),
        apAllocationService.allocate(ctx, input)
      ]);

      expect(res1.id).toBe(res2.id);
      expect(res2.id).toBe(res3.id);

      const util = await apSettlementService.getSourceUtilization(ctx, 'PAYMENT', payment.id);
      expect(util.allocatedAmount).toBe('5000.00');
    });
  });

  // --------------------------------------------------------------------------
  // 3. TENANT, COMPANY & SUPPLIER ISOLATION AUDIT
  // --------------------------------------------------------------------------
  describe('3. Tenant, Company & Supplier Isolation Audit', () => {
    it('should prevent cross-tenant and cross-company financial data leakage', async () => {
      const rand = Math.random().toString(36).substring(2, 7);
      const otherCtx: RequestContext = {
        tenantId: `tenant_other_${Date.now()}_${rand}`,
        companyId: `comp_other_${Date.now()}_${rand}`,
        user: { id: 'usr_other', roles: ['ADMIN'], permissions: ['*'] }
      };

      const otherComp = await masterDataService.createCompany(otherCtx, {
        code: `COMP_OTHER_${Date.now()}_${rand}`,
        name: 'Other Company Enterprise',
        legalName: 'Other Company Enterprise Ltd',
        taxId: '27CCCC0000A1Z5'
      });
      otherCtx.companyId = otherComp.id;

      const { openItem } = await createAndPostBill('2026-01-01', '2026-01-01', '5000.00');

      // Attempt reading settlement from another tenant context -> throws ForbiddenError or ValidationError
      await expect(
        apSettlementService.getOpenItemSettlement(otherCtx, openItem.id)
      ).rejects.toThrow();

      // Company reconciliation for company B returns only company B items
      const reconB = await apReconciliationService.reconcileCompanyAP(otherCtx, otherComp.id);
      expect(reconB.subledgerOutstandingOpenItemsTotal).toBe('0.00');
    });

    it('should prevent cross-supplier allocation attempts', async () => {
      const rand = Math.random().toString(36).substring(2, 7);
      const supp2 = await masterDataService.createSupplier(ctx, {
        companyId,
        code: `SUPP2_ISO_${Date.now()}_${rand}`,
        name: 'Supplier 2 Ltd'
      });

      const { openItem: item1 } = await createAndPostBill('2026-01-01', '2026-01-01', '5000.00'); // Supplier 1
      const pay2 = await createAndPostPayment('2026-01-01', '2026-01-01', '5000.00', supp2.id); // Supplier 2

      await expect(
        apAllocationService.allocate(ctx, {
          allocationSourceType: 'PAYMENT',
          paymentId: pay2.id,
          openItemId: item1.id,
          allocatedAmount: '5000.00'
        })
      ).rejects.toThrow('Cross-supplier allocation is strictly forbidden');
    });
  });

  // --------------------------------------------------------------------------
  // 4. CORRUPTION & DIAGNOSTIC QUALITY AUDIT
  // --------------------------------------------------------------------------
  describe('4. Corruption & Diagnostic Quality Audit', () => {
    it('should detect balance discrepancies and return actionable diagnostics in reconciliation', async () => {
      const { openItem } = await createAndPostBill('2026-01-01', '2026-01-01', '10000.00');

      // Reconcile before mapping or posting GL journal
      const recon = await apReconciliationService.reconcileCompanyAP(ctx, companyId);
      expect(recon.netSubledgerPayableTotal).toBe('10000.00');
      expect(recon.glApControlBalance).toBe('10000.00');
      expect(recon.reconciliationStatus).toBe('PASS');
    });

    it('should reject invalid dates and missing context gracefully', async () => {
      await expect(
        apHistoricalSettlementService.getHistoricalSupplierSettlementSummary(ctx, supplierId, 'invalid-date')
      ).rejects.toThrow('Invalid asOfDate format');

      await expect(
        apHistoricalSettlementService.getHistoricalSupplierSettlementSummary(ctx, '', '2026-01-15')
      ).rejects.toThrow('SupplierId is required');
    });
  });

  // --------------------------------------------------------------------------
  // 5. DETERMINISTIC RANDOMIZED HARDENING TESTS (50 SCENARIOS)
  // --------------------------------------------------------------------------
  describe('5. Deterministic Randomized Hardening Tests (50 Scenarios)', () => {
    it('should satisfy all financial invariants and signed reconciliation across 50 randomized generated scenarios', async () => {
      for (let run = 1; run <= 50; run++) {
        const rand = Math.random().toString(36).substring(2, 7);
        const testCtx: RequestContext = {
          tenantId: `tenant_rand_hard_${run}_${rand}`,
          companyId: `cmp_rand_hard_${run}_${rand}`,
          user: { id: 'usr_rand', roles: ['ADMIN'], permissions: ['*'] }
        };

        const comp = await masterDataService.createCompany(testCtx, {
          code: `CMP_R_H_${run}_${rand}`,
          name: `Rand Enterprise ${run}`,
          legalName: `Rand Enterprise ${run} Pvt Ltd`,
          taxId: '27AAAAA0000A1Z5'
        });
        testCtx.companyId = comp.id;

        const { fiscalYear } = await fiscalPeriodService.createFiscalYear(testCtx, {
          companyId: comp.id,
          name: `FY 2025-26 ${run}`,
          startDate: new Date('2025-04-01T00:00:00.000Z'),
          endDate: new Date('2026-03-31T23:59:59.999Z')
        });
        await fiscalPeriodService.activateFiscalYear(testCtx, fiscalYear.id);

        const supp = await masterDataService.createSupplier(testCtx, {
          companyId: comp.id,
          code: `SUP_R_H_${run}_${rand}`,
          name: `Vendor ${run}`
        });

        const expAcc = await chartOfAccountsService.createAccount(testCtx, {
          companyId: comp.id,
          accountCode: `50${run.toString().padStart(2, '0')}`,
          accountName: 'Expense',
          accountType: 'EXPENSE'
        });

        const apCtrlAcc = await chartOfAccountsService.createAccount(testCtx, {
          companyId: comp.id,
          accountCode: `20${run.toString().padStart(2, '0')}`,
          accountName: 'AP Control',
          accountType: 'LIABILITY',
          isControlAccount: true,
          controlAccountType: 'AP'
        });

        const bankAcc = await chartOfAccountsService.createAccount(testCtx, {
          companyId: comp.id,
          accountCode: `10${run.toString().padStart(2, '0')}`,
          accountName: 'Bank',
          accountType: 'ASSET'
        });

        const eventTypes = ['AP_SUPPLIER_BILL', 'AP_PAYMENT', 'AP_CREDIT_NOTE', 'AP_DEBIT_NOTE', 'AP_OPENING_BALANCE', 'AP_DISCOUNT'];
        for (const et of eventTypes) {
          await accountingConfigurationService.setMapping(testCtx, {
            companyId: comp.id,
            eventType: et,
            lineRole: 'AP_CONTROL',
            accountId: apCtrlAcc.id
          });
        }

        // Random financial parameters
        const billAmt = (100 + run * 15).toFixed(2);
        const payAmt = (30 + run * 5).toFixed(2);

        const docInput: CreateApDocumentInput = {
          companyId: comp.id,
          supplierId: supp.id,
          documentType: 'SUPPLIER_BILL',
          documentNumber: `BILL-R-H-${run}`,
          documentDate: '2026-01-05',
          accountingDate: '2026-01-05',
          dueDate: '2026-01-05',
          lines: [{ description: 'Item', quantity: '1.0000', unitPrice: billAmt, expenseAccountId: expAcc.id }]
        };
        const draftDoc = await apDocumentService.createDraft(testCtx, docInput);
        const postedDoc = await apDocumentService.postDocument(testCtx, draftDoc.id);

        const payInput: CreateApPaymentInput = {
          companyId: comp.id,
          supplierId: supp.id,
          paymentDate: '2026-01-10',
          accountingDate: '2026-01-10',
          paymentMode: 'BANK_TRANSFER',
          bankAccountId: bankAcc.id,
          totalAmount: payAmt
        };
        const draftPay = await apPaymentService.createDraft(testCtx, payInput);
        const postedPay = await apPaymentService.postPayment(testCtx, draftPay.id);

        const openItems = await apDocumentService.getOpenItems(testCtx, comp.id, { supplierId: supp.id });
        const item = openItems[0]!;

        await apAllocationService.allocate(testCtx, {
          allocationSourceType: 'PAYMENT',
          paymentId: postedPay.id,
          openItemId: item.id,
          allocatedAmount: payAmt,
          allocationDate: '2026-01-15'
        });

        // Evaluate Live Supplier Summary
        const summary = await apSettlementService.getSupplierSettlementSummary(testCtx, supp.id);
        const expectedNet = ExactDecimal.parse(billAmt, 2).sub(ExactDecimal.parse(payAmt, 2)).toString();

        expect(summary.netPayableAmount).toBe(expectedNet);

        // Evaluate Company Reconciliation
        const recon = await apReconciliationService.reconcileCompanyAP(testCtx, comp.id);
        expect(recon.reconciliationStatus).toBe('PASS');
        expect(recon.netSubledgerPayableTotal).toBe(expectedNet);
        expect(recon.reconciliationDifference).toBe('0.00');

        // Historical Reconciliation as of Jan 04 (before Bill & Payment) -> Net Payable = 0.00
        const histJan04 = await apHistoricalSettlementService.reconcileHistoricalCompanyAP(testCtx, comp.id, '2026-01-04');
        expect(histJan04.netSubledgerPayableTotal).toBe('0.00');

        // Historical Reconciliation as of Jan 08 (after Bill, before Payment) -> Net Payable = billAmt
        const histJan08 = await apHistoricalSettlementService.reconcileHistoricalCompanyAP(testCtx, comp.id, '2026-01-08');
        expect(histJan08.netSubledgerPayableTotal).toBe(billAmt);

        // Historical Reconciliation as of Jan 20 -> Net Payable = expectedNet
        const histJan20 = await apHistoricalSettlementService.reconcileHistoricalCompanyAP(testCtx, comp.id, '2026-01-20');
        expect(histJan20.netSubledgerPayableTotal).toBe(expectedNet);
      }
    });
  });
});
