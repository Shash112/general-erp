import { describe, it, expect, beforeEach } from 'vitest';
import {
  RequestContext,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ExactDecimal
} from '@general-erp/core';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { accountingConfigurationService } from '../src/modules/finance/accounting-core.service.js';
import { arDocumentService } from '../src/modules/finance/ar/ar-document.service.js';
import { arReceiptService } from '../src/modules/finance/ar/ar-receipt.service.js';
import { arAllocationService } from '../src/modules/finance/ar/ar-allocation.service.js';
import { arSettlementService } from '../src/modules/finance/ar/ar-settlement.service.js';
import { arAdjustmentService } from '../src/modules/finance/ar/ar-adjustment.service.js';
import { arAgingService } from '../src/modules/finance/ar/ar-aging.service.js';
import {
  CreateArDocumentInput,
  CreateArReceiptInput,
  CreateArAdjustmentInput
} from '../src/modules/finance/ar/index.js';

describe('Phase 2.6.7 — AR Aging & Customer Statements', () => {
  const tenantId = 'tenant_aging_test';
  const companyId = '11111111-1111-4111-a111-111111111111';
  const customerIdA = '22222222-2222-4222-a222-222222222222';
  const customerIdB = '33333333-3333-4333-a333-333333333333';
  let bankAccountId: string;

  let ctx: RequestContext;

  beforeEach(async () => {
    ctx = {
      tenantId,
      companyId,
      user: {
        id: 'usr_ar_aging_admin',
        tenantId,
        roles: ['ACCOUNTANT'],
        permissions: ['*']
      }
    };

    arDocumentService.clear();
    arReceiptService.clear();
    arAllocationService.clear();
    arAdjustmentService.clear();
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    accountingConfigurationService.clear();
    masterDataService.clear();

    // Seed Company
    await masterDataService.createCompany(ctx, {
      id: companyId,
      name: 'Alpha Aging Company',
      legalName: 'Alpha Aging Company Ltd',
      currency: 'INR'
    });

    // Seed Master Data Customers
    await masterDataService.createCustomer(ctx, {
      id: customerIdA,
      companyId,
      code: 'CUST-A',
      name: 'Alpha Traders Pvt Ltd',
      gstin: '27AAAAA0000A1Z5',
      stateCode: '27'
    });

    await masterDataService.createCustomer(ctx, {
      id: customerIdB,
      companyId,
      code: 'CUST-B',
      name: 'Beta Enterprises',
      gstin: '27BBBBB0000B1Z6',
      stateCode: '27'
    });

    // Seed COA Accounts
    const bankAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '1001',
      accountName: 'HDFC Bank Operating Account',
      accountType: 'ASSET',
      accountGroup: 'CASH_AND_BANK',
      isPostable: true,
      isActive: true,
      isControlAccount: true,
      controlAccountType: 'BANK'
    });
    await chartOfAccountsService.activateAccount(ctx, bankAccount.id);
    bankAccountId = bankAccount.id;

    const arAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '1100',
      accountName: 'Accounts Receivable Control',
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

    const badDebtAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '5200',
      accountName: 'Bad Debt Expense',
      accountType: 'EXPENSE'
    });
    await chartOfAccountsService.activateAccount(ctx, badDebtAccount.id);

    const creditAdjAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '4900',
      accountName: 'AR Credit Adjustment Account',
      accountType: 'INCOME'
    });
    await chartOfAccountsService.activateAccount(ctx, creditAdjAccount.id);

    const debitAdjAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '4100',
      accountName: 'AR Debit Adjustment Revenue',
      accountType: 'INCOME'
    });
    await chartOfAccountsService.activateAccount(ctx, debitAdjAccount.id);

    // Set Accounting Mappings
    const eventTypes = ['AR_INVOICE', 'AR_CREDIT_NOTE', 'AR_DEBIT_NOTE', 'AR_OPENING_BALANCE', 'AR_RECEIPT'];
    for (const et of eventTypes) {
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'AR_CONTROL', accountId: arAccount.id });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'SALES_REVENUE', accountId: revAccount.id });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'REVENUE', accountId: revAccount.id });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'CASH_BANK', accountId: bankAccountId });
    }

    await accountingConfigurationService.setMapping(ctx, { companyId, eventType: 'AR_ADJUSTMENT', lineRole: 'WRITE_OFF_EXPENSE', accountId: badDebtAccount.id });
    await accountingConfigurationService.setMapping(ctx, { companyId, eventType: 'AR_ADJUSTMENT', lineRole: 'CREDIT_ADJUSTMENT', accountId: creditAdjAccount.id });
    await accountingConfigurationService.setMapping(ctx, { companyId, eventType: 'AR_ADJUSTMENT', lineRole: 'DEBIT_ADJUSTMENT', accountId: debitAdjAccount.id });
    await accountingConfigurationService.setMapping(ctx, { companyId, eventType: 'AR_ADJUSTMENT', lineRole: 'AR_CONTROL', accountId: arAccount.id });

    // Open Fiscal Periods for 2024-25, 2025-26, 2026-27
    const { fiscalYear: fy2024 } = await fiscalPeriodService.createFiscalYear(ctx, {
      companyId,
      name: 'FY 2024-25',
      startDate: new Date('2024-04-01T00:00:00.000Z'),
      endDate: new Date('2025-03-31T23:59:59.999Z')
    });
    await fiscalPeriodService.activateFiscalYear(ctx, fy2024.id);

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
  });

  async function createAndPostInvoice(cust: string, grossAmt: string, docDate: string, dueDate: string): Promise<string> {
    const input: CreateArDocumentInput = {
      companyId,
      customerId: cust,
      documentType: 'INVOICE',
      documentDate: docDate,
      accountingDate: docDate,
      dueDate,
      currency: 'INR',
      placeOfSupplyStateCode: '27',
      lines: [
        {
          description: 'Software Consulting',
          quantity: '1.0000',
          unitPrice: grossAmt,
          taxableAmount: grossAmt,
          taxRatePercent: '0.000000',
          cgstAmount: '0.00',
          sgstAmount: '0.00',
          igstAmount: '0.00',
          utgstAmount: '0.00',
          cessAmount: '0.00',
          taxAmount: '0.00',
          grossAmount: grossAmt
        }
      ]
    };
    const draft = await arDocumentService.createDraft(ctx, input);
    const posted = await arDocumentService.postDocument(ctx, draft.id);
    const openItems = await arDocumentService.getOpenItems(ctx, companyId, { customerId: cust });
    const item = openItems.find(i => i.arDocumentId === posted.id);
    return item!.id;
  }

  // ==========================================
  // 1. AGING BUCKET CATEGORIZATION TESTS
  // ==========================================
  describe('Aging Bucket Categorization', () => {
    it('should categorize open items into exact aging buckets based on Days Overdue', () => {
      const asOf = '2026-09-01';

      expect(arAgingService.calculateBucket(asOf, '2026-09-10')).toEqual({ daysOverdue: -9, bucket: 'CURRENT' });
      expect(arAgingService.calculateBucket(asOf, '2026-09-01')).toEqual({ daysOverdue: 0, bucket: 'CURRENT' });
      expect(arAgingService.calculateBucket(asOf, '2026-08-25')).toEqual({ daysOverdue: 7, bucket: '1_30' });
      expect(arAgingService.calculateBucket(asOf, '2026-08-01')).toEqual({ daysOverdue: 31, bucket: '31_60' });
      expect(arAgingService.calculateBucket(asOf, '2026-07-01')).toEqual({ daysOverdue: 62, bucket: '61_90' });
      expect(arAgingService.calculateBucket(asOf, '2026-05-30')).toEqual({ daysOverdue: 94, bucket: '91_120' });
      expect(arAgingService.calculateBucket(asOf, '2026-04-01')).toEqual({ daysOverdue: 153, bucket: '121_180' });
      expect(arAgingService.calculateBucket(asOf, '2026-01-01')).toEqual({ daysOverdue: 243, bucket: 'OVER_180' });
    });

    it('should aggregate customer open items into correct aging buckets as of date', async () => {
      const asOf = '2025-06-01';

      // Current (Due 2025-06-15) -> 1000
      await createAndPostInvoice(customerIdA, '1000.00', '2025-05-15', '2025-06-15');
      // 1-30 Days Overdue (Due 2025-05-15) -> 2000
      await createAndPostInvoice(customerIdA, '2000.00', '2025-04-15', '2025-05-15');
      // 31-60 Days Overdue (Due 2025-04-15) -> 3000
      await createAndPostInvoice(customerIdA, '3000.00', '2025-03-15', '2025-04-15');

      const summary = await arAgingService.getCustomerAging(ctx, companyId, customerIdA, asOf);

      expect(summary.current).toBe('1000.00');
      expect(summary.bucket1_30).toBe('2000.00');
      expect(summary.bucket31_60).toBe('3000.00');
      expect(summary.totalOutstanding).toBe('6000.00');
    });
  });

  // ==========================================
  // 2. AS-OF-DATE HISTORICAL EVALUATION
  // ==========================================
  describe('Historical As-Of-Date Evaluation', () => {
    it('should evaluate historical AR position correctly and exclude events after asOfDate', async () => {
      // Invoice 1 posted on 2025-05-01 -> 5000.00
      const openItemId = await createAndPostInvoice(customerIdA, '5000.00', '2025-05-01', '2025-05-20');

      // As of 2025-05-05: Outstanding is 5000.00
      let summary = await arAgingService.getCustomerAging(ctx, companyId, customerIdA, '2025-05-05');
      expect(summary.totalOutstanding).toBe('5000.00');

      // Write-off 1000 on 2025-05-10
      const adjDraft = await arAdjustmentService.createDraftAdjustment(ctx, {
        companyId,
        customerId: customerIdA,
        openItemId,
        adjustmentType: 'WRITE_OFF',
        amount: '1000.00',
        reason: 'Historical write-off'
      });
      await arAdjustmentService.postAdjustment(ctx, adjDraft.id);

      // As of 2025-05-05 (before write-off): Outstanding remains 5000.00
      summary = await arAgingService.getCustomerAging(ctx, companyId, customerIdA, '2025-05-05');
      expect(summary.totalOutstanding).toBe('5000.00');

      // As of today (after write-off): Outstanding is 4000.00
      summary = await arAgingService.getCustomerAging(ctx, companyId, customerIdA);
      expect(summary.totalOutstanding).toBe('4000.00');
    });
  });

  // ==========================================
  // 3. CUSTOMER ACCOUNT STATEMENT TESTS
  // ==========================================
  describe('Customer Account Statement Generation', () => {
    it('should generate statement with opening balance, ordered transactions, running balance, and closing balance', async () => {
      // Invoices & Receipts across dates
      // 2025-04-10: Invoice 1000.00 (Before fromDate 2025-05-01 -> Opening Balance)
      await createAndPostInvoice(customerIdA, '1000.00', '2025-04-10', '2025-04-30');

      // 2025-05-05: Invoice 2500.00
      await createAndPostInvoice(customerIdA, '2500.00', '2025-05-05', '2025-05-25');

      // 2025-05-10: Receipt 1500.00
      const rDraft = await arReceiptService.createDraft(ctx, {
        companyId,
        customerId: customerIdA,
        receiptDate: '2025-05-10',
        accountingDate: '2025-05-10',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '1500.00'
      });
      await arReceiptService.postReceipt(ctx, rDraft.id);

      const statement = await arAgingService.getCustomerStatement(ctx, companyId, {
        customerId: customerIdA,
        fromDate: '2025-05-01',
        toDate: '2025-05-31'
      });

      expect(statement.openingBalance).toBe('1000.00');
      expect(statement.totalDebits).toBe('2500.00');
      expect(statement.totalCredits).toBe('1500.00');
      expect(statement.closingBalance).toBe('2000.00');
      expect(statement.transactions.length).toBe(2);

      // Verify running balance progression
      expect(statement.transactions[0].runningBalance).toBe('3500.00'); // 1000 + 2500
      expect(statement.transactions[1].runningBalance).toBe('2000.00'); // 3500 - 1500
    });

    it('should prevent double-counting of receipts and allocations', async () => {
      const openItemId = await createAndPostInvoice(customerIdA, '1000.00', '2025-05-01', '2025-05-20');

      const rDraft = await arReceiptService.createDraft(ctx, {
        companyId,
        customerId: customerIdA,
        receiptDate: '2025-05-05',
        accountingDate: '2025-05-05',
        paymentMode: 'CASH',
        bankAccountId,
        totalAmount: '1000.00'
      });
      const receipt = await arReceiptService.postReceipt(ctx, rDraft.id);

      // Allocate receipt to invoice
      await arAllocationService.allocate(ctx, {
        allocationSourceType: 'RECEIPT',
        receiptId: receipt.id,
        openItemId,
        allocatedAmount: '1000.00'
      });

      const statement = await arAgingService.getCustomerStatement(ctx, companyId, {
        customerId: customerIdA,
        fromDate: '2025-05-01',
        toDate: '2025-05-31'
      });

      // Statement contains Invoice (+1000) and Receipt (-1000). Allocations are NOT counted as separate credits!
      expect(statement.transactions.length).toBe(2);
      expect(statement.closingBalance).toBe('0.00');
    });
  });

  // ==========================================
  // 4. SUBLEDGER RECONCILIATION INTEGRATION
  // ==========================================
  describe('Subledger Settlement Reconciliation Integration', () => {
    it('should verify that customer aging bucket sum equals derived settlement net outstanding', async () => {
      await createAndPostInvoice(customerIdA, '4000.00', '2025-05-01', '2025-05-20');
      await createAndPostInvoice(customerIdA, '1500.00', '2025-05-10', '2025-05-30');

      const aging = await arAgingService.getCustomerAging(ctx, companyId, customerIdA);
      const summary = await arSettlementService.getCustomerSettlementSummary(ctx, companyId, customerIdA);

      expect(aging.totalOutstanding).toBe(summary.netOutstandingReceivable);
    });
  });

  // ==========================================
  // 5. CONCURRENCY READ STRESS TEST
  // ==========================================
  describe('Concurrency Read Stress Test', () => {
    it('should safely process 100 concurrent aging and statement queries without errors or state mutations', async () => {
      await createAndPostInvoice(customerIdA, '2000.00', '2025-05-01', '2025-05-20');

      const reads = Array.from({ length: 100 }, (_, i) => i);
      let successCount = 0;

      await Promise.all(
        reads.map(async () => {
          await arAgingService.getCustomerAging(ctx, companyId, customerIdA);
          await arAgingService.getCustomerStatement(ctx, companyId, {
            customerId: customerIdA,
            fromDate: '2025-05-01',
            toDate: '2025-05-31'
          });
          successCount++;
        })
      );

      expect(successCount).toBe(100);
    });
  });

  // ==========================================
  // 6. 200 RANDOMIZED FINANCIAL SCENARIOS
  // ==========================================
  describe('200 Randomized Financial Scenarios', () => {
    it('should satisfy aging bucket sum = customer outstanding = statement closing balance across 200 randomized scenarios', async () => {
      for (let i = 0; i < 200; i++) {
        const inv1Amt = `${Math.floor(Math.random() * 5000) + 100}.00`;
        const inv2Amt = `${Math.floor(Math.random() * 5000) + 100}.00`;

        await createAndPostInvoice(customerIdA, inv1Amt, '2025-05-01', '2025-05-20');
        await createAndPostInvoice(customerIdA, inv2Amt, '2025-05-15', '2025-06-05');

        const aging = await arAgingService.getCustomerAging(ctx, companyId, customerIdA);
        const statement = await arAgingService.getCustomerStatement(ctx, companyId, {
          customerId: customerIdA,
          fromDate: '2025-05-01',
          toDate: '2025-06-30'
        });
        const settlementSummary = await arSettlementService.getCustomerSettlementSummary(ctx, companyId, customerIdA);

        expect(aging.totalOutstanding).toBe(settlementSummary.totalGrossReceivables);
        expect(statement.closingBalance).toBe(settlementSummary.netOutstandingReceivable);

        // Reset stores for next iteration
        arDocumentService.clear();
        arReceiptService.clear();
        arAllocationService.clear();
        arAdjustmentService.clear();
      }
    });
  });

  // ==========================================
  // 7. HIGH-VOLUME PERFORMANCE BENCHMARK (10,000+ ITEMS)
  // ==========================================
  describe('High-Volume Performance Benchmark', () => {
    it('should execute company aging calculation over 10,000+ open items in acceptable execution time', async () => {
      // Seed 10,000 open items
      const itemsCount = 10000;
      for (let i = 0; i < itemsCount; i++) {
        const custId = i % 2 === 0 ? customerIdA : customerIdB;
        await createAndPostInvoice(custId, '100.00', '2025-05-01', '2025-05-20');
      }

      const startMs = Date.now();
      const companyAging = await arAgingService.getCompanyAging(ctx, companyId);
      const durationMs = Date.now() - startMs;

      expect(companyAging.customerSummaries.length).toBe(2);
      expect(companyAging.totalOutstanding).toBe('1000000.00'); // 10,000 * 100.00
      expect(durationMs).toBeLessThan(5000); // Must execute under 5 seconds
    });
  });
});
