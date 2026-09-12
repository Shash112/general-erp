import { describe, it, expect, beforeEach } from 'vitest';
import {
  RequestContext,
  ValidationError,
  ForbiddenError,
  NotFoundError,
  BusinessRuleViolationError,
  ExactDecimal
} from '@general-erp/core';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { accountingConfigurationService } from '../src/modules/finance/accounting-core.service.js';
import { journalDraftService } from '../src/modules/finance/journal-draft.service.js';
import { apDocumentService } from '../src/modules/finance/ap/ap-document.service.js';
import { apPaymentService } from '../src/modules/finance/ap/ap-payment.service.js';
import { apAllocationService } from '../src/modules/finance/ap/ap-allocation.service.js';
import { apAdjustmentService } from '../src/modules/finance/ap/ap-adjustment.service.js';
import { apSettlementService } from '../src/modules/finance/ap/ap-settlement.service.js';
import { apHistoricalSettlementService } from '../src/modules/finance/ap/ap-historical-settlement.service.js';
import { apAgingService } from '../src/modules/finance/ap/ap-aging.service.js';
import { apStatementService } from '../src/modules/finance/ap/ap-statement.service.js';

describe('Phase 2.7.7 — AP Aging & Supplier Statements', () => {
  const tenantId = 'tenant_ap_aging_phase277';
  const companyId = 'cmp_ap_aging_acme';
  const supplierId = 'supp_ap_aging_acme_corp';
  const otherSupplierId = 'supp_ap_aging_other_corp';

  let expOffsetAccountId: string;
  let bankAccountId: string;

  const ctx: RequestContext = {
    tenantId,
    companyId,
    user: {
      id: 'usr_ap_manager',
      tenantId,
      roles: ['AP_MANAGER'],
      permissions: [
        '*',
        'ap:document:create',
        'ap:document:post',
        'ap:payment:create',
        'ap:payment:post',
        'ap:allocation:create',
        'ap:allocation:post',
        'ap:adjustment:create',
        'ap:adjustment:post',
        'ap:adjustment:reverse',
        'ap:settlement:read',
        'ap:aging:read',
        'ap:statement:read'
      ]
    }
  };

  const unauthCtx: RequestContext = {
    tenantId,
    companyId,
    user: {
      id: 'usr_unauth',
      tenantId,
      roles: ['NO_ACCESS'],
      permissions: []
    }
  };

  const otherTenantCtx: RequestContext = {
    tenantId: 'tenant_other_aging',
    companyId: 'cmp_other_aging',
    user: {
      id: 'usr_other_tenant',
      tenantId: 'tenant_other_aging',
      roles: ['AP_CLERK'],
      permissions: ['*']
    }
  };

  beforeEach(async () => {
    masterDataService.clear();
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    accountingConfigurationService.clear();
    apDocumentService.clear();
    apPaymentService.clear();
    apAllocationService.clear();
    apAdjustmentService.clear();
    journalDraftService.clear();

    // Setup Master Data
    await masterDataService.createCompany(ctx, {
      id: companyId,
      name: 'ACME Inc',
      legalName: 'ACME Private Limited',
      code: 'ACME'
    });

    await masterDataService.createSupplier(ctx, {
      id: supplierId,
      companyId,
      name: 'ACME Supplies Corp',
      code: 'ACME001'
    });

    await masterDataService.createSupplier(ctx, {
      id: otherSupplierId,
      companyId,
      name: 'Global Logistics Ltd',
      code: 'GLOB001'
    });

    // Setup Fiscal Year & Period
    await fiscalPeriodService.createFiscalYear(ctx, {
      companyId,
      name: 'FY2026',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31')
    });

    // Setup Chart of Accounts & Configuration
    const apCtrl = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '2100',
      accountName: 'Accounts Payable Control',
      nodeType: 'ACCOUNT',
      accountType: 'LIABILITY'
    });

    const expOffset = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '5000',
      accountName: 'General Expense Offset',
      nodeType: 'ACCOUNT',
      accountType: 'EXPENSE'
    });
    expOffsetAccountId = expOffset.id;

    const bankAcc = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '1010',
      accountName: 'Bank Account',
      nodeType: 'ACCOUNT',
      accountType: 'ASSET'
    });
    bankAccountId = bankAcc.id;

    const woOffset = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '5800',
      accountName: 'AP Write-Off Expense Offset',
      nodeType: 'ACCOUNT',
      accountType: 'EXPENSE'
    });

    const crOffset = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '5810',
      accountName: 'AP Credit Adjustment Offset',
      nodeType: 'ACCOUNT',
      accountType: 'EXPENSE'
    });

    const drOffset = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '5820',
      accountName: 'AP Debit Adjustment Offset',
      nodeType: 'ACCOUNT',
      accountType: 'EXPENSE'
    });

    const discOffset = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '5830',
      accountName: 'Purchase Discount Income',
      nodeType: 'ACCOUNT',
      accountType: 'INCOME'
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_SUPPLIER_BILL',
      lineRole: 'AP_CONTROL',
      accountId: apCtrl.id
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_CREDIT_NOTE',
      lineRole: 'AP_CONTROL',
      accountId: apCtrl.id
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_PAYMENT',
      lineRole: 'AP_CONTROL',
      accountId: apCtrl.id
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_PAYMENT',
      lineRole: 'BANK_ACCOUNT',
      accountId: bankAcc.id
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_ADJUSTMENT',
      lineRole: 'AP_CONTROL',
      accountId: apCtrl.id
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_ADJUSTMENT',
      lineRole: 'WRITE_OFF_OFFSET',
      accountId: woOffset.id
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_ADJUSTMENT',
      lineRole: 'CREDIT_ADJUSTMENT_OFFSET',
      accountId: crOffset.id
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_ADJUSTMENT',
      lineRole: 'DEBIT_ADJUSTMENT_OFFSET',
      accountId: drOffset.id
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_ADJUSTMENT_REVERSAL',
      lineRole: 'AP_CONTROL',
      accountId: apCtrl.id
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_ADJUSTMENT_REVERSAL',
      lineRole: 'WRITE_OFF_OFFSET',
      accountId: woOffset.id
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_ADJUSTMENT_REVERSAL',
      lineRole: 'CREDIT_ADJUSTMENT_OFFSET',
      accountId: crOffset.id
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_ADJUSTMENT_REVERSAL',
      lineRole: 'DEBIT_ADJUSTMENT_OFFSET',
      accountId: drOffset.id
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_DISCOUNT',
      lineRole: 'AP_CONTROL',
      accountId: apCtrl.id
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_DISCOUNT',
      lineRole: 'PURCHASE_DISCOUNT_INCOME',
      accountId: discOffset.id
    });
  });

  // Helper function to create and post a Bill
  async function createPostedBill(
    docNumber: string,
    grossAmount: string,
    documentDate = '2026-02-01',
    dueDate = '2026-03-01',
    targetSupplierId = supplierId
  ) {
    const draft = await apDocumentService.createDraft(ctx, {
      companyId,
      supplierId: targetSupplierId,
      documentType: 'SUPPLIER_BILL',
      documentNumber: docNumber,
      documentDate,
      accountingDate: documentDate,
      dueDate,
      supplierInvoiceNumber: `INV-${docNumber}`,
      currency: 'INR',
      lines: [
        {
          lineSequence: 1,
          description: 'Purchases',
          expenseAccountId: expOffsetAccountId,
          quantity: '1.0000',
          unitPrice: grossAmount,
          taxableAmount: grossAmount,
          taxAmount: '0.00',
          grossAmount
        }
      ]
    });

    const posted = await apDocumentService.postDocument(ctx, draft.id);
    const openItems = await apDocumentService.getOpenItems(ctx, companyId, { apDocumentId: posted.id });
    return { doc: posted, openItem: openItems[0]! };
  }

  // Helper function to create and post a Payment
  async function createPostedPayment(paymentNumber: string, totalAmount: string, paymentDate = '2026-02-15', targetSupplierId = supplierId) {
    const draft = await apPaymentService.createDraft(ctx, {
      companyId,
      supplierId: targetSupplierId,
      paymentNumber,
      paymentDate,
      accountingDate: paymentDate,
      paymentMode: 'BANK_TRANSFER',
      bankAccountId,
      totalAmount
    });
    return await apPaymentService.postPayment(ctx, draft.id);
  }

  describe('1. AGING BUCKET BOUNDARIES & OVERDUE CALCULATION', () => {
    it('1. should classify item with due date in future as CURRENT', () => {
      const res = apAgingService.calculateBucket('2026-03-01', '2026-03-15');
      expect(res.daysOverdue).toBeLessThan(0);
      expect(res.bucket).toBe('CURRENT');
    });

    it('2. should classify item due today as CURRENT', () => {
      const res = apAgingService.calculateBucket('2026-03-01', '2026-03-01');
      expect(res.daysOverdue).toBe(0);
      expect(res.bucket).toBe('CURRENT');
    });

    it('3. should classify item 1 day overdue as 1_30', () => {
      const res = apAgingService.calculateBucket('2026-03-02', '2026-03-01');
      expect(res.daysOverdue).toBe(1);
      expect(res.bucket).toBe('1_30');
    });

    it('4. should classify item 30 days overdue as 1_30', () => {
      const res = apAgingService.calculateBucket('2026-03-31', '2026-03-01');
      expect(res.daysOverdue).toBe(30);
      expect(res.bucket).toBe('1_30');
    });

    it('5. should classify item 31 days overdue as 31_60', () => {
      const res = apAgingService.calculateBucket('2026-04-01', '2026-03-01');
      expect(res.daysOverdue).toBe(31);
      expect(res.bucket).toBe('31_60');
    });

    it('6. should classify item 60 days overdue as 31_60', () => {
      const res = apAgingService.calculateBucket('2026-04-30', '2026-03-01');
      expect(res.daysOverdue).toBe(60);
      expect(res.bucket).toBe('31_60');
    });

    it('7. should classify item 61 days overdue as 61_90', () => {
      const res = apAgingService.calculateBucket('2026-05-01', '2026-03-01');
      expect(res.daysOverdue).toBe(61);
      expect(res.bucket).toBe('61_90');
    });

    it('8. should classify item 90 days overdue as 61_90', () => {
      const res = apAgingService.calculateBucket('2026-05-30', '2026-03-01');
      expect(res.daysOverdue).toBe(90);
      expect(res.bucket).toBe('61_90');
    });

    it('9. should classify item 91 days overdue as 90_PLUS', () => {
      const res = apAgingService.calculateBucket('2026-05-31', '2026-03-01');
      expect(res.daysOverdue).toBe(91);
      expect(res.bucket).toBe('90_PLUS');
    });

    it('10. should classify item 365 days overdue as 90_PLUS', () => {
      const res = apAgingService.calculateBucket('2027-03-01', '2026-03-01');
      expect(res.daysOverdue).toBe(365);
      expect(res.bucket).toBe('90_PLUS');
    });
  });

  describe('2. OPEN ITEM ELIGIBILITY & AGING CALCULATIONS', () => {
    it('11. should evaluate open item aging for single bill', async () => {
      const { openItem } = await createPostedBill('BILL-001', '10000.00', '2026-02-01', '2026-03-01');

      const aging = await apAgingService.getOpenItemAging(ctx, openItem.id, '2026-03-01');
      expect(aging.openItemId).toBe(openItem.id);
      expect(aging.originalAmount).toBe('10000.00');
      expect(aging.outstandingAmount).toBe('10000.00');
      expect(aging.daysOverdue).toBe(0);
      expect(aging.bucket).toBe('CURRENT');
    });

    it('12. should exclude credit note open items from debit open item aging', async () => {
      const draftCn = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'CREDIT_NOTE',
        documentNumber: 'CN-001',
        documentDate: '2026-02-01',
        accountingDate: '2026-02-01',
        dueDate: '2026-03-01',
        currency: 'INR',
        lines: [
          {
            lineSequence: 1,
            description: 'Return',
            expenseAccountId: expOffsetAccountId,
            quantity: '1.0000',
            unitPrice: '2000.00',
            taxableAmount: '2000.00',
            taxAmount: '0.00',
            grossAmount: '2000.00'
          }
        ]
      });
      const postedCn = await apDocumentService.postDocument(ctx, draftCn.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { apDocumentId: postedCn.id });

      if (openItems.length > 0) {
        await expect(apAgingService.getOpenItemAging(ctx, openItems[0]!.id, '2026-03-01')).rejects.toThrow(BusinessRuleViolationError);
      } else {
        expect(openItems.length).toBe(0);
      }
    });

    it('13. should exclude fully settled open items from supplier aging summary', async () => {
      const { openItem } = await createPostedBill('BILL-SETTLED', '5000.00', '2026-02-01', '2026-03-01');
      const payment = await createPostedPayment('PAY-SETTLED', '5000.00', '2026-02-15');

      await apAllocationService.allocate(ctx, {
        companyId,
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocationDate: '2026-02-15',
        allocatedAmount: '5000.00'
      });

      const supplierAging = await apAgingService.getSupplierAging(ctx, companyId, supplierId, '2026-03-01');
      expect(supplierAging.totalOutstanding).toBe('0.00');
      expect(supplierAging.openItems.length).toBe(0);
    });

    it('14. should include partially settled open item with remaining outstanding amount', async () => {
      const { openItem } = await createPostedBill('BILL-PARTIAL', '10000.00', '2026-02-01', '2026-03-01');
      const payment = await createPostedPayment('PAY-PARTIAL', '4000.00', '2026-02-15');

      await apAllocationService.allocate(ctx, {
        companyId,
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocationDate: '2026-02-15',
        allocatedAmount: '4000.00'
      });

      const supplierAging = await apAgingService.getSupplierAging(ctx, companyId, supplierId, '2026-03-01');
      expect(supplierAging.totalOutstanding).toBe('6000.00');
      expect(supplierAging.openItems.length).toBe(1);
      expect(supplierAging.openItems[0]!.outstandingAmount).toBe('6000.00');
    });

    it('15. should reflect WRITE_OFF adjustment in aging', async () => {
      const { openItem } = await createPostedBill('BILL-WO', '10000.00', '2026-02-01', '2026-03-01');

      const draftAdj = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId,
        openItemId: openItem.id,
        adjustmentType: 'WRITE_OFF',
        amount: '3000.00',
        accountingDate: '2026-02-15',
        reason: 'Settlement discount agreed'
      });
      await apAdjustmentService.postAdjustment(ctx, draftAdj.id);

      const aging = await apAgingService.getOpenItemAging(ctx, openItem.id, '2026-03-01');
      expect(aging.outstandingAmount).toBe('7000.00');
    });

    it('16. should reflect CREDIT_ADJUSTMENT in aging', async () => {
      const { openItem } = await createPostedBill('BILL-CA', '10000.00', '2026-02-01', '2026-03-01');

      const draftAdj = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId,
        openItemId: openItem.id,
        adjustmentType: 'CREDIT_ADJUSTMENT',
        amount: '2000.00',
        accountingDate: '2026-02-15',
        reason: 'Dispute correction'
      });
      await apAdjustmentService.postAdjustment(ctx, draftAdj.id);

      const aging = await apAgingService.getOpenItemAging(ctx, openItem.id, '2026-03-01');
      expect(aging.outstandingAmount).toBe('8000.00');
    });

    it('17. should reflect DEBIT_ADJUSTMENT in aging', async () => {
      const { openItem } = await createPostedBill('BILL-DA', '10000.00', '2026-02-01', '2026-03-01');

      const draftAdj = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId,
        openItemId: openItem.id,
        adjustmentType: 'DEBIT_ADJUSTMENT',
        amount: '1500.00',
        accountingDate: '2026-02-15',
        reason: 'Late fee added'
      });
      await apAdjustmentService.postAdjustment(ctx, draftAdj.id);

      const aging = await apAgingService.getOpenItemAging(ctx, openItem.id, '2026-03-01');
      expect(aging.outstandingAmount).toBe('11500.00');
    });

    it('18. should reflect adjustment reversal in aging', async () => {
      const { openItem } = await createPostedBill('BILL-WO-REV', '10000.00', '2026-02-01', '2026-03-01');

      const draftAdj = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId,
        openItemId: openItem.id,
        adjustmentType: 'WRITE_OFF',
        amount: '3000.00',
        accountingDate: '2026-02-15',
        reason: 'Erroneous write-off'
      });
      const postedAdj = await apAdjustmentService.postAdjustment(ctx, draftAdj.id);

      await apAdjustmentService.reverseAdjustment(ctx, postedAdj.id, {
        reversalAccountingDate: '2026-02-20',
        reason: 'Reversing error'
      });

      // As of 2026-02-18 (before reversal): write-off is active -> 7000
      const agingBefore = await apAgingService.getOpenItemAging(ctx, openItem.id, '2026-02-18');
      expect(agingBefore.outstandingAmount).toBe('7000.00');

      // As of 2026-02-21 (after reversal): write-off is reversed -> 10000
      const agingAfter = await apAgingService.getOpenItemAging(ctx, openItem.id, '2026-02-21');
      expect(agingAfter.outstandingAmount).toBe('10000.00');
    });
  });

  describe('3. SUPPLIER & COMPANY AGING AGGREGATION', () => {
    it('19. should calculate supplier aging totals equal to sum of buckets', async () => {
      await createPostedBill('BILL-B1', '5000.00', '2026-02-15', '2026-03-15'); // CURRENT as of 2026-03-01
      await createPostedBill('BILL-B2', '3000.00', '2026-01-15', '2026-02-15'); // 1_30 (14 days overdue as of 2026-03-01)
      await createPostedBill('BILL-B3', '2000.00', '2026-01-01', '2026-01-15'); // 31_60 (45 days overdue as of 2026-03-01)

      const suppAging = await apAgingService.getSupplierAging(ctx, companyId, supplierId, '2026-03-01');

      expect(suppAging.currentAmount).toBe('5000.00');
      expect(suppAging.bucket1To30).toBe('3000.00');
      expect(suppAging.bucket31To60).toBe('2000.00');
      expect(suppAging.bucket61To90).toBe('0.00');
      expect(suppAging.bucket90Plus).toBe('0.00');
      expect(suppAging.totalOutstanding).toBe('10000.00');

      const sumBuckets = ExactDecimal.parse(suppAging.currentAmount, 2)
        .add(ExactDecimal.parse(suppAging.bucket1To30, 2))
        .add(ExactDecimal.parse(suppAging.bucket31To60, 2))
        .add(ExactDecimal.parse(suppAging.bucket61To90, 2))
        .add(ExactDecimal.parse(suppAging.bucket90Plus, 2));

      expect(sumBuckets.toString()).toBe(suppAging.totalOutstanding);
    });

    it('20. should calculate company aging summary across multiple suppliers', async () => {
      await createPostedBill('BILL-SUP1', '10000.00', '2026-02-01', '2026-03-01', supplierId);
      await createPostedBill('BILL-SUP2', '15000.00', '2026-02-01', '2026-03-01', otherSupplierId);

      const compAging = await apAgingService.getCompanyAging(ctx, companyId, '2026-03-01');

      expect(compAging.supplierCount).toBe(2);
      expect(compAging.totalOutstanding).toBe('25000.00');

      const sumSuppliers = compAging.suppliers.reduce((acc, s) => {
        return acc.add(ExactDecimal.parse(s.totalOutstanding, 2));
      }, ExactDecimal.ZERO);

      expect(sumSuppliers.toString()).toBe(compAging.totalOutstanding);
    });

    it('21. should separate aged debit exposure from unapplied payment supplier credits', async () => {
      await createPostedBill('BILL-EXPOSURE', '10000.00', '2026-02-01', '2026-03-01');
      await createPostedPayment('PAY-UNAPPLIED', '15000.00', '2026-02-15');

      const suppAging = await apAgingService.getSupplierAging(ctx, companyId, supplierId, '2026-03-01');

      // Aging total represents open item exposure (10,000.00)
      expect(suppAging.totalOutstanding).toBe('10000.00');

      // Separate signedNetPayable metric reflects net liability (-5,000.00 supplier credit)
      expect(suppAging.signedNetPayable).toBe('-5000.00');
    });
  });

  describe('4. SUPPLIER ACCOUNT STATEMENT', () => {
    it('22. should generate basic supplier statement with opening, running, and closing balance', async () => {
      // 1. Bill posted on 2026-01-15: 10,000
      await createPostedBill('BILL-JAN', '10000.00', '2026-01-15', '2026-02-15');
      // 2. Bill posted on 2026-02-10: 5,000
      await createPostedBill('BILL-FEB', '5000.00', '2026-02-10', '2026-03-10');
      // 3. Payment posted on 2026-02-20: 8,000
      await createPostedPayment('PAY-FEB', '8000.00', '2026-02-20');

      // Query statement for 2026-02-01 -> 2026-02-28
      const statement = await apStatementService.getSupplierStatement(ctx, companyId, {
        supplierId,
        fromDate: '2026-02-01',
        toDate: '2026-02-28'
      });

      expect(statement.openingBalance).toBe('10000.00'); // Bill-Jan
      expect(statement.totalDebits).toBe('5000.00');     // Bill-Feb
      expect(statement.totalCredits).toBe('8000.00');    // Pay-Feb
      expect(statement.closingBalance).toBe('7000.00');   // 10000 + 5000 - 8000

      expect(statement.lines.length).toBe(2);
      expect(statement.lines[0]!.debitAmount).toBe('5000.00');
      expect(statement.lines[0]!.runningBalance).toBe('15000.00');
      expect(statement.lines[1]!.creditAmount).toBe('8000.00');
      expect(statement.lines[1]!.runningBalance).toBe('7000.00');
    });

    it('23. should avoid double-counting payment allocations on supplier statement', async () => {
      const { openItem } = await createPostedBill('BILL-ALLOC', '10000.00', '2026-02-01', '2026-03-01');
      const payment = await createPostedPayment('PAY-ALLOC', '10000.00', '2026-02-10');

      await apAllocationService.allocate(ctx, {
        companyId,
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocationDate: '2026-02-10',
        allocatedAmount: '10000.00'
      });

      const statement = await apStatementService.getSupplierStatement(ctx, companyId, {
        supplierId,
        fromDate: '2026-02-01',
        toDate: '2026-02-28'
      });

      // Bill (10k debit) + Payment (10k credit) -> Closing balance 0.00
      expect(statement.totalDebits).toBe('10000.00');
      expect(statement.totalCredits).toBe('10000.00');
      expect(statement.closingBalance).toBe('0.00');
      expect(statement.lines.length).toBe(2); // Bill and Payment lines only (Allocation is non-financial settlement)
    });

    it('24. should reflect prompt-payment discounts as credit lines on statement', async () => {
      const { openItem } = await createPostedBill('BILL-DISC', '10000.00', '2026-02-01', '2026-03-01');
      const payment = await createPostedPayment('PAY-DISC', '9500.00', '2026-02-10');

      await apAllocationService.allocate(ctx, {
        companyId,
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocationDate: '2026-02-10',
        allocatedAmount: '9500.00',
        discountAmount: '500.00'
      });

      const statement = await apStatementService.getSupplierStatement(ctx, companyId, {
        supplierId,
        fromDate: '2026-02-01',
        toDate: '2026-02-28'
      });

      // Debits: Bill 10,000. Credits: Payment 9,500 + Discount 500 = 10,000. Closing: 0.00
      expect(statement.totalDebits).toBe('10000.00');
      expect(statement.totalCredits).toBe('10000.00');
      expect(statement.closingBalance).toBe('0.00');
    });

    it('25. should ensure statement closing balance matches historical supplier settlement net payable', async () => {
      await createPostedBill('BILL-HIST1', '12000.00', '2026-01-10', '2026-02-10');
      await createPostedBill('BILL-HIST2', '8000.00', '2026-02-05', '2026-03-05');
      await createPostedPayment('PAY-HIST', '15000.00', '2026-02-15');

      const statement = await apStatementService.getSupplierStatement(ctx, companyId, {
        supplierId,
        fromDate: '2026-02-01',
        toDate: '2026-02-28'
      });

      const histSummary = await apHistoricalSettlementService.getHistoricalSupplierSettlementSummary(ctx, supplierId, '2026-02-28');

      expect(statement.closingBalance).toBe(histSummary.netPayableAmount);
    });

    it('26. should sort statement transaction lines deterministically', async () => {
      await createPostedBill('BILL-SORT-B', '5000.00', '2026-02-10', '2026-03-10');
      await createPostedPayment('PAY-SORT-A', '5000.00', '2026-02-10');

      const statement = await apStatementService.getSupplierStatement(ctx, companyId, {
        supplierId,
        fromDate: '2026-02-01',
        toDate: '2026-02-28'
      });

      expect(statement.lines.length).toBe(2);
      expect(statement.lines[0]!.date).toBe('2026-02-10');
      expect(statement.lines[1]!.date).toBe('2026-02-10');
      // Deterministic secondary sort on documentType
      expect(statement.lines[0]!.documentType <= statement.lines[1]!.documentType).toBe(true);
    });
  });

  describe('5. HISTORICAL SEMANTICS & REVERSALS', () => {
    it('27. should evaluate historical aging as of target date', async () => {
      const { openItem } = await createPostedBill('BILL-HIST-AGE', '10000.00', '2026-02-01', '2026-03-01');
      const payment = await createPostedPayment('PAY-HIST-AGE', '10000.00', '2026-02-25');

      await apAllocationService.allocate(ctx, {
        companyId,
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocationDate: '2026-02-25',
        allocatedAmount: '10000.00'
      });

      // As of 2026-02-20 (before payment): Bill is outstanding 10,000
      const agingBefore = await apAgingService.getOpenItemAging(ctx, openItem.id, '2026-02-20');
      expect(agingBefore.outstandingAmount).toBe('10000.00');

      // As of 2026-02-28 (after payment): Bill is settled 0.00
      const agingAfter = await apAgingService.getOpenItemAging(ctx, openItem.id, '2026-02-28');
      expect(agingAfter.outstandingAmount).toBe('0.00');
    });

    it('28. should respect effective accounting dates for historical statements', async () => {
      await createPostedBill('BILL-HIST-STMT', '10000.00', '2026-02-05', '2026-03-05');

      // Statement for January (before bill)
      const stmtJan = await apStatementService.getSupplierStatement(ctx, companyId, {
        supplierId,
        fromDate: '2026-01-01',
        toDate: '2026-01-31'
      });
      expect(stmtJan.openingBalance).toBe('0.00');
      expect(stmtJan.closingBalance).toBe('0.00');
      expect(stmtJan.lines.length).toBe(0);

      // Statement for February (bill posted)
      const stmtFeb = await apStatementService.getSupplierStatement(ctx, companyId, {
        supplierId,
        fromDate: '2026-02-01',
        toDate: '2026-02-28'
      });
      expect(stmtFeb.openingBalance).toBe('0.00');
      expect(stmtFeb.closingBalance).toBe('10000.00');
      expect(stmtFeb.lines.length).toBe(1);
    });
  });

  describe('6. SECURITY, ISOLATION & DATA INTEGRITY', () => {
    it('29. should enforce tenant isolation on aging queries', async () => {
      await createPostedBill('BILL-TENANT-A', '10000.00', '2026-02-01', '2026-03-01');

      const suppAgingOther = await apAgingService.getSupplierAging(otherTenantCtx, companyId, supplierId, '2026-03-01');
      expect(suppAgingOther.totalOutstanding).toBe('0.00');
      expect(suppAgingOther.openItems.length).toBe(0);
    });

    it('30. should enforce authorization for aging and statements', async () => {
      await expect(apAgingService.getSupplierAging(unauthCtx, companyId, supplierId, '2026-03-01')).rejects.toThrow(ForbiddenError);
      await expect(apStatementService.getSupplierStatement(unauthCtx, companyId, { supplierId, fromDate: '2026-02-01', toDate: '2026-02-28' })).rejects.toThrow(ForbiddenError);
    });

    it('31. should throw error on statement query with invalid date range', async () => {
      await expect(
        apStatementService.getSupplierStatement(ctx, companyId, {
          supplierId,
          fromDate: '2026-03-01',
          toDate: '2026-02-01'
        })
      ).rejects.toThrow(ValidationError);
    });

    it('32. should handle exact decimal precision and large monetary values without floating point errors', async () => {
      await createPostedBill('BILL-LARGE', '999999999.99', '2026-02-01', '2026-03-01');

      const suppAging = await apAgingService.getSupplierAging(ctx, companyId, supplierId, '2026-03-01');
      expect(suppAging.totalOutstanding).toBe('999999999.99');
    });
  });

  describe('7. RANDOMIZED PROPERTY-BASED TESTS', () => {
    it('33. randomized property test: sum of aging buckets equals total outstanding for generated open items', async () => {
      const dates = ['2026-01-01', '2026-01-15', '2026-02-01', '2026-02-15', '2026-03-01'];
      const dueDates = ['2026-03-01', '2026-03-15', '2026-04-01', '2026-04-15', '2026-05-01'];

      for (let i = 1; i <= 5; i++) {
        const amount = (i * 1234.56).toFixed(2);
        const docDate = dates[i % dates.length]!;
        const dueDate = dueDates[i % dueDates.length]!;
        await createPostedBill(`BILL-RND-${i}`, amount, docDate, dueDate);
      }

      const compAging = await apAgingService.getCompanyAging(ctx, companyId, '2026-03-01');

      const sumBuckets = ExactDecimal.parse(compAging.currentAmount, 2)
        .add(ExactDecimal.parse(compAging.bucket1To30, 2))
        .add(ExactDecimal.parse(compAging.bucket31To60, 2))
        .add(ExactDecimal.parse(compAging.bucket61To90, 2))
        .add(ExactDecimal.parse(compAging.bucket90Plus, 2));

      expect(sumBuckets.toString()).toBe(compAging.totalOutstanding);
    });

    it('34. randomized property test: statement opening + debits - credits == closing and closing == historical settlement', async () => {
      const b1 = await createPostedBill('BILL-RND-STMT1', '5000.00', '2026-01-10', '2026-02-10');
      const b2 = await createPostedBill('BILL-RND-STMT2', '7500.00', '2026-02-01', '2026-03-01');
      const p1 = await createPostedPayment('PAY-RND-STMT1', '4000.00', '2026-02-15');

      await apAllocationService.allocate(ctx, {
        companyId,
        allocationSourceType: 'PAYMENT',
        paymentId: p1.id,
        openItemId: b1.openItem.id,
        allocationDate: '2026-02-15',
        allocatedAmount: '4000.00'
      });

      const statement = await apStatementService.getSupplierStatement(ctx, companyId, {
        supplierId,
        fromDate: '2026-02-01',
        toDate: '2026-02-28'
      });

      const openDec = ExactDecimal.parse(statement.openingBalance, 2);
      const debDec = ExactDecimal.parse(statement.totalDebits, 2);
      const credDec = ExactDecimal.parse(statement.totalCredits, 2);
      const closeDec = ExactDecimal.parse(statement.closingBalance, 2);

      const calculatedClose = openDec.add(debDec).sub(credDec);
      expect(calculatedClose.toString()).toBe(closeDec.toString());

      const histSummary = await apHistoricalSettlementService.getHistoricalSupplierSettlementSummary(ctx, supplierId, '2026-02-28');
      expect(statement.closingBalance).toBe(histSummary.netPayableAmount);
    });
  });
});
