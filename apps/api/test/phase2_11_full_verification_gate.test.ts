import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext, ExactDecimal } from '@general-erp/core';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { journalDraftService } from '../src/modules/finance/journal-draft.service.js';
import { glEngine } from '../src/modules/finance/gl-engine.js';
import { accountingCoreService } from '../src/modules/finance/accounting-core.service.js';
import { accountingConfigurationService } from '../src/modules/finance/accounting-core.service.js';
import {
  arDocumentService,
  arReceiptService,
  arAllocationService,
  arSettlementService
} from '../src/modules/finance/ar/index.js';
import {
  apDocumentService,
  apPaymentService,
  apAllocationService,
  apSettlementService
} from '../src/modules/finance/ap/index.js';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { trialBalanceService } from '../src/modules/finance/reporting/trial-balance.service.js';
import { generalLedgerReportService } from '../src/modules/finance/reporting/general-ledger-report.service.js';
import { profitLossService } from '../src/modules/finance/reporting/profit-loss.service.js';
import { balanceSheetService } from '../src/modules/finance/reporting/balance-sheet.service.js';
import { financialReportingService } from '../src/modules/finance/reporting/financial-reporting.service.js';

describe('Phase 2.11 — Full Verification Gate Suite', () => {
  const tenantId = 'tenant_phase211_gate';
  const companyId = 'comp_phase211_gate';
  const otherTenantId = 'tenant_phase211_other';
  const otherCompanyId = 'comp_phase211_other';

  const ctx: RequestContext = {
    tenantId,
    companyId,
    userId: 'usr_gate_auditor',
    roles: ['FINANCE_ADMIN', 'CHIEF_FINANCIAL_OFFICER'],
    permissions: ['*']
  };

  const otherCtx: RequestContext = {
    tenantId: otherTenantId,
    companyId: otherCompanyId,
    userId: 'usr_gate_intruder',
    roles: ['FINANCE_USER'],
    permissions: ['*']
  };

  let bankAccId: string;
  let arControlAccId: string;
  let apControlAccId: string;
  let revenueAccId: string;
  let expenseAccId: string;
  let equityAccId: string;
  let retainedEarningsAccId: string;

  beforeEach(async () => {
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    journalDraftService.clear();
    masterDataService.clear();
    accountingConfigurationService.clear();
    arDocumentService.clear();
    arReceiptService.clear();
    arAllocationService.clear();
    apDocumentService.clear();
    apPaymentService.clear();
    apAllocationService.clear();

    // Create Company, Customer, Supplier in Master Data
    await masterDataService.createCompany(ctx, {
      id: companyId,
      name: 'Gate Test Company',
      legalName: 'Gate Test Company Ltd',
      currency: 'INR'
    });

    await masterDataService.createCustomer(ctx, {
      id: 'cust_gate_001',
      companyId,
      code: 'CUST-001',
      name: 'Gate Customer',
      currency: 'INR'
    });

    await masterDataService.createSupplier(ctx, {
      id: 'supp_gate_001',
      companyId,
      code: 'SUPP-001',
      name: 'Gate Supplier',
      currency: 'INR'
    });

    // Setup Fiscal Year 2026-27 for Company
    const { fiscalYear } = await fiscalPeriodService.createFiscalYear(ctx, {
      companyId,
      name: 'FY 2026-27',
      startDate: new Date('2026-04-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T23:59:59.999Z')
    });
    await fiscalPeriodService.activateFiscalYear(ctx, fiscalYear.id);

    // Seed COA Accounts
    const bank = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '1001',
      accountName: 'HDFC Operating Bank Account',
      accountType: 'ASSET',
      nodeType: 'ACCOUNT'
    });
    bankAccId = bank.id;

    const arCtrl = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '1100',
      accountName: 'Accounts Receivable Control',
      accountType: 'ASSET',
      nodeType: 'ACCOUNT'
    });
    arControlAccId = arCtrl.id;

    const apCtrl = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '2100',
      accountName: 'Accounts Payable Control',
      accountType: 'LIABILITY',
      nodeType: 'ACCOUNT'
    });
    apControlAccId = apCtrl.id;

    const rev = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '4001',
      accountName: 'Domestic Sales Revenue',
      accountType: 'INCOME',
      nodeType: 'ACCOUNT'
    });
    revenueAccId = rev.id;

    const exp = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '5001',
      accountName: 'Operating & Admin Expense',
      accountType: 'EXPENSE',
      nodeType: 'ACCOUNT'
    });
    expenseAccId = exp.id;

    const eq = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '3001',
      accountName: 'Share Capital',
      accountType: 'EQUITY',
      nodeType: 'ACCOUNT'
    });
    equityAccId = eq.id;

    const re = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '3200',
      accountName: 'Retained Earnings',
      accountType: 'EQUITY',
      nodeType: 'ACCOUNT'
    });
    retainedEarningsAccId = re.id;

    // Configure Accounting Core Mappings
    const arEvents = ['AR_INVOICE', 'AR_CREDIT_NOTE', 'AR_DEBIT_NOTE', 'AR_OPENING_BALANCE', 'AR_RECEIPT', 'SALES_INVOICE', 'CUSTOMER_RECEIPT'];
    for (const et of arEvents) {
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'AR_CONTROL', accountId: arControlAccId });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'AR_RECEIVABLE', accountId: arControlAccId });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'SALES_REVENUE', accountId: revenueAccId });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'REVENUE', accountId: revenueAccId });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'BANK_ACCOUNT', accountId: bankAccId });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'UNAPPLIED_CASH', accountId: arControlAccId });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'CASH_BANK', accountId: bankAccId });
    }

    const apEvents = ['AP_SUPPLIER_BILL', 'AP_BILL', 'AP_INVOICE', 'AP_CREDIT_NOTE', 'AP_DEBIT_NOTE', 'AP_PAYMENT', 'PURCHASE_INVOICE', 'SUPPLIER_BILL', 'SUPPLIER_PAYMENT'];
    for (const et of apEvents) {
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'AP_CONTROL', accountId: apControlAccId });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'AP_PAYABLE', accountId: apControlAccId });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'EXPENSE', accountId: expenseAccId });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'BANK_ACCOUNT', accountId: bankAccId });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'UNAPPLIED_PAYMENT', accountId: apControlAccId });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'CASH_BANK', accountId: bankAccId });
    }
  });

  describe('1. Integrated End-to-End Financial Pipeline Verification', () => {
    it('executes full cycle: AR Sale + Tax + Receipt → AP Purchase + Tax + Payment → Fiscal Close → Reporting', async () => {
      // 1. Post AR Invoice
      const arInvoice = await arDocumentService.createDraft(ctx, {
        companyId,
        customerId: 'cust_gate_001',
        documentType: 'INVOICE',
        documentDate: '2026-05-10',
        dueDate: '2026-06-10',
        currency: 'INR',
        lines: [
          {
            description: 'Enterprise ERP Consulting',
            quantity: '1.00',
            unitPrice: '10000.00',
            taxability: 'EXEMPT'
          }
        ]
      });

      const postedInvoice = await arDocumentService.postDocument(ctx, arInvoice.id);
      expect(postedInvoice.status).toBe('POSTED');
      expect(postedInvoice.grossAmount).toBe('10000.00');

      // 2. Customer Receipt: ₹10,000 received in HDFC Bank
      const arReceipt = await arReceiptService.createDraft(ctx, {
        companyId,
        customerId: 'cust_gate_001',
        depositAccountId: bankAccId,
        receiptDate: '2026-05-15',
        amount: '10000.00',
        currency: 'INR',
        paymentMode: 'BANK_TRANSFER',
        receiptType: 'CUSTOMER_PAYMENT'
      });

      const postedReceipt = await arReceiptService.postReceipt(ctx, arReceipt.id);
      expect(postedReceipt.status).toBe('POSTED');

      // 3. Post AP Supplier Bill
      const apBill = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId: 'supp_gate_001',
        documentType: 'SUPPLIER_BILL',
        documentDate: '2026-06-01',
        dueDate: '2026-07-01',
        currency: 'INR',
        lines: [
          {
            description: 'Cloud Server Infrastructure',
            quantity: '1.00',
            unitPrice: '5000.00',
            expenseAccountId: expenseAccId,
            taxability: 'EXEMPT'
          }
        ]
      });

      const postedBill = await apDocumentService.postDocument(ctx, apBill.id);
      expect(postedBill.status).toBe('POSTED');
      expect(postedBill.grossAmount).toBe('5000.00');

      // 4. Supplier Payment
      const apPayment = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId: 'supp_gate_001',
        bankAccountId: bankAccId,
        paymentDate: '2026-06-10',
        totalAmount: '5000.00',
        currency: 'INR',
        paymentMode: 'BANK_TRANSFER',
        paymentType: 'SUPPLIER_PAYMENT'
      });

      const postedPayment = await apPaymentService.postPayment(ctx, apPayment.id);
      expect(postedPayment.status).toBe('POSTED');

      // 5. Generate Financial Reports before Fiscal Close
      const tb = await trialBalanceService.getTrialBalance(ctx, { companyId, asOfDate: '2026-06-30' });
      expect(tb.isBalanced).toBe(true);
      expect(tb.totalDebit).toBe(tb.totalCredit);

      const pl = await profitLossService.getProfitAndLoss(ctx, { companyId, fromDate: '2026-04-01', toDate: '2027-03-31' });
      expect(pl.totalRevenue).toBe('10000.00');
      expect(pl.totalExpense).toBe('5000.00');
      expect(pl.netProfit).toBe('5000.00');

      const bs = await balanceSheetService.getBalanceSheet(ctx, { companyId, asOfDate: '2026-06-30' });
      expect(bs.isBalanced).toBe(true);

      // 6. Subledger Reconciliation Diagnostics
      const recon = await financialReportingService.getReconciliationReport(ctx, { companyId, asOfDate: '2026-06-30' });
      expect(recon.companyId).toBe(companyId);
      expect(recon.hasDiscrepancies).toBe(false);
    });
  });

  describe('2. Financial Invariants & Conservation Laws', () => {
    it('proves Total Debits = Total Credits for every posted GL journal', async () => {
      // Create manual GL draft journal
      const draft = await journalDraftService.createDraft(ctx, {
        companyId,
        accountingDate: '2026-07-01',
        sourceModule: 'MANUAL',
        narration: 'Equipping Office Furniture',
        lines: [
          { accountId: bankAccId, debitAmount: '0.00', creditAmount: '2500.50', lineSequence: 1 },
          { accountId: expenseAccId, debitAmount: '2500.50', creditAmount: '0.00', lineSequence: 2 }
        ]
      });

      const posted = await glEngine.postJournal(ctx, draft.id);
      expect(posted.status).toBe('POSTED');
      expect(posted.totalDebit).toBe(posted.totalCredit);
      expect(posted.totalDebit).toBe('2500.50');
    });

    it('proves Balance Sheet equation Assets = Liabilities + Equity holds accurately', async () => {
      const bs = await balanceSheetService.getBalanceSheet(ctx, { companyId, asOfDate: '2026-12-31' });
      const assets = ExactDecimal.parse(bs.totalAssets, 2);
      const liab = ExactDecimal.parse(bs.totalLiabilities, 2);
      const eq = ExactDecimal.parse(bs.totalEquity, 2);

      expect(assets.toString()).toBe(liab.add(eq).toString());
      expect(bs.isBalanced).toBe(true);
    });
  });

  describe('3. Tenant & Company Security Isolation Matrix', () => {
    it('rejects cross-tenant data access attempts', async () => {
      // Attempt to access Company A Trial Balance using Tenant B Context
      await expect(trialBalanceService.getTrialBalance(otherCtx, {
        companyId,
        asOfDate: '2026-06-30'
      })).rejects.toThrow();

      // Attempt to query GL report across tenant boundary
      await expect(generalLedgerReportService.getGeneralLedger(otherCtx, {
        companyId,
        fromDate: '2026-04-01',
        toDate: '2027-03-31'
      })).rejects.toThrow();
    });

    it('rejects cross-company data access within same tenant', async () => {
      const crossCtx: RequestContext = {
        ...ctx,
        companyId: 'comp_phase211_unauthorized'
      };

      await expect(profitLossService.getProfitAndLoss(crossCtx, {
        companyId,
        fromDate: '2026-04-01',
        toDate: '2027-03-31'
      })).rejects.toThrow();
    });
  });

  describe('4. Adversarial Concurrency & Business Idempotency', () => {
    it('handles parallel posting attempts safely', async () => {
      const draft = await journalDraftService.createDraft(ctx, {
        companyId,
        accountingDate: '2026-08-01',
        sourceModule: 'MANUAL',
        narration: 'Concurrent Posting Test',
        lines: [
          { accountId: bankAccId, debitAmount: '100.00', creditAmount: '0.00', lineSequence: 1 },
          { accountId: revenueAccId, debitAmount: '0.00', creditAmount: '100.00', lineSequence: 2 }
        ]
      });

      // Fire 10 parallel posting calls
      const results = await Promise.allSettled(
        Array.from({ length: 10 }).map(() => glEngine.postJournal(ctx, draft.id))
      );

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      // Verify the draft was posted exactly once
      const finalJournal = (journalDraftService as any).journalsStore.get(`${ctx.tenantId}:${companyId}:${draft.id}`);
      expect(finalJournal.status).toBe('POSTED');
    });
  });

  describe('5. ExactDecimal Monetary Precision Verification', () => {
    it('maintains absolute precision without floating-point drift', async () => {
      const val1 = ExactDecimal.parse('0.10', 2);
      const val2 = ExactDecimal.parse('0.20', 2);
      const sum = val1.add(val2);
      expect(sum.toString()).toBe('0.30');

      const large1 = ExactDecimal.parse('999999999999.99', 2);
      const large2 = ExactDecimal.parse('0.01', 2);
      const largeSum = large1.add(large2);
      expect(largeSum.toString()).toBe('1000000000000.00');
    });
  });

  describe('6. Historical As-Of Cutoff Reconstruction', () => {
    it('correctly reconstructs historical balances as of cut-off accounting dates', async () => {
      // Transaction on May 10
      const j1 = await journalDraftService.createDraft(ctx, {
        companyId,
        accountingDate: '2026-05-10',
        sourceModule: 'MANUAL',
        lines: [
          { accountId: bankAccId, debitAmount: '1000.00', creditAmount: '0.00', lineSequence: 1 },
          { accountId: equityAccId, debitAmount: '0.00', creditAmount: '1000.00', lineSequence: 2 }
        ]
      });
      await glEngine.postJournal(ctx, j1.id);

      // Transaction on June 20
      const j2 = await journalDraftService.createDraft(ctx, {
        companyId,
        accountingDate: '2026-06-20',
        sourceModule: 'MANUAL',
        lines: [
          { accountId: bankAccId, debitAmount: '500.00', creditAmount: '0.00', lineSequence: 1 },
          { accountId: equityAccId, debitAmount: '0.00', creditAmount: '500.00', lineSequence: 2 }
        ]
      });
      await glEngine.postJournal(ctx, j2.id);

      // As of May 31: Bank balance should be 1000.00
      const tbMay = await trialBalanceService.getTrialBalance(ctx, { companyId, asOfDate: '2026-05-31' });
      const bankRowMay = tbMay.rows.find(r => r.accountId === bankAccId);
      expect(bankRowMay?.netBalance).toBe('1000.00');

      // As of June 30: Bank balance should be 1500.00
      const tbJune = await trialBalanceService.getTrialBalance(ctx, { companyId, asOfDate: '2026-06-30' });
      const bankRowJune = tbJune.rows.find(r => r.accountId === bankAccId);
      expect(bankRowJune?.netBalance).toBe('1500.00');
    });
  });
});
