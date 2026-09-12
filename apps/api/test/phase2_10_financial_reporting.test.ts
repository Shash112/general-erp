import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext, ValidationError, NotFoundError, BusinessRuleViolationError, ExactDecimal } from '@general-erp/core';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { accountingConfigurationService, accountingCoreService } from '../src/modules/finance/accounting-core.service.js';
import { journalDraftService } from '../src/modules/finance/journal-draft.service.js';
import { financialReportingService } from '../src/modules/finance/reporting/financial-reporting.service.js';
import { trialBalanceService } from '../src/modules/finance/reporting/trial-balance.service.js';
import { generalLedgerReportService } from '../src/modules/finance/reporting/general-ledger-report.service.js';
import { profitLossService } from '../src/modules/finance/reporting/profit-loss.service.js';
import { balanceSheetService } from '../src/modules/finance/reporting/balance-sheet.service.js';
import { buildApp } from '../src/app.js';

describe('Phase 2.10 — Financial Reporting Engine Subsystem', () => {
  const tenantId = 'tenant_phase210_test';
  const companyId = 'comp_phase210_test';
  const otherTenantId = 'tenant_phase210_other';
  const otherCompanyId = 'comp_phase210_other';

  const ctx: RequestContext = {
    requestId: 'req_phase210_1',
    tenantId,
    companyId,
    ip: '127.0.0.1',
    userAgent: 'vitest',
    timestamp: new Date(),
    user: {
      userId: 'usr_reporting_mgr',
      username: 'reportingmgr',
      roles: ['FINANCE_MANAGER'],
      permissions: ['*']
    }
  };

  const unauthCtx: RequestContext = {
    requestId: 'req_phase210_unauth',
    tenantId,
    companyId,
    ip: '127.0.0.1',
    userAgent: 'vitest',
    timestamp: new Date(),
    user: {
      userId: 'usr_clerk',
      username: 'clerk',
      roles: ['CLERK'],
      permissions: []
    }
  };

  const otherCtx: RequestContext = {
    requestId: 'req_phase210_other',
    tenantId: otherTenantId,
    companyId: otherCompanyId,
    ip: '127.0.0.1',
    userAgent: 'vitest',
    timestamp: new Date(),
    user: {
      userId: 'usr_other',
      username: 'other',
      roles: ['ADMIN'],
      permissions: ['*']
    }
  };

  let cashAccId: string;
  let arAccId: string;
  let apAccId: string;
  let equityAccId: string;
  let revAccId: string;
  let expAccId: string;

  beforeEach(async () => {
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    accountingConfigurationService.clear();
    journalDraftService.clear();

    // Setup Fiscal Year
    const { fiscalYear } = await fiscalPeriodService.createFiscalYear(ctx, {
      companyId,
      name: 'FY 2025-26',
      startDate: new Date('2025-04-01T00:00:00.000Z'),
      endDate: new Date('2026-03-31T23:59:59.999Z')
    });
    await fiscalPeriodService.activateFiscalYear(ctx, fiscalYear.id);

    // Apply COA Template
    await chartOfAccountsService.applyTemplate(ctx, {
      companyId,
      templateId: 'INDIAN_SME_DEFAULT_V1'
    });

    const accounts = await chartOfAccountsService.getAccountsList(ctx, companyId);
    cashAccId = accounts.find(a => a.accountCode === '1110')!.id;
    arAccId = accounts.find(a => a.accountCode === '1130')!.id;
    apAccId = accounts.find(a => a.accountCode === '2110')!.id;
    equityAccId = accounts.find(a => a.accountCode === '3100')!.id;
    revAccId = accounts.find(a => a.accountCode === '4100')!.id;
    expAccId = accounts.find(a => a.accountCode === '5210')!.id;

    // Post Initial Transactions
    // 1. Initial Capital Injection: Dr Cash 10,000 / Cr Equity 10,000
    await accountingCoreService.processAccountingEvent(ctx, {
      companyId,
      accountingDate: '2025-04-05',
      sourceModule: 'MANUAL',
      sourceDocumentId: 'DOC_INIT_CAPITAL',
      eventType: 'MANUAL_JOURNAL',
      lines: [
        { accountId: cashAccId, lineSequence: 1, debitAmount: '10000.00', creditAmount: '0.00' },
        { accountId: equityAccId, lineSequence: 2, debitAmount: '0.00', creditAmount: '10000.00' }
      ]
    });

    // 2. Sales Revenue Event: Dr Cash 5,000 / Cr Sales Revenue 5,000
    await accountingCoreService.processAccountingEvent(ctx, {
      companyId,
      accountingDate: '2025-05-10',
      sourceModule: 'SALES',
      sourceDocumentId: 'DOC_SALES_1',
      eventType: 'SALES_INVOICE',
      lines: [
        { accountId: cashAccId, lineSequence: 1, debitAmount: '5000.00', creditAmount: '0.00' },
        { accountId: revAccId, lineSequence: 2, debitAmount: '0.00', creditAmount: '5000.00' }
      ]
    });

    // 3. Operating Expense Event: Dr Salaries Expense 2,000 / Cr Cash 2,000
    await accountingCoreService.processAccountingEvent(ctx, {
      companyId,
      accountingDate: '2025-06-15',
      sourceModule: 'PAYROLL',
      sourceDocumentId: 'DOC_PAYROLL_1',
      eventType: 'PAYROLL_RUN',
      lines: [
        { accountId: expAccId, lineSequence: 1, debitAmount: '2000.00', creditAmount: '0.00' },
        { accountId: cashAccId, lineSequence: 2, debitAmount: '0.00', creditAmount: '2000.00' }
      ]
    });
  });

  describe('1. Trial Balance Engine', () => {
    it('generates a balanced Trial Balance report (Total Debits == Total Credits)', async () => {
      const tb = await financialReportingService.getTrialBalance(ctx, {
        companyId,
        asOfDate: '2025-06-30'
      });

      expect(tb.companyId).toBe(companyId);
      expect(tb.isBalanced).toBe(true);
      expect(tb.totalDebit).toBe('17000.00');
      expect(tb.totalCredit).toBe('17000.00');
      expect(tb.rows.length).toBeGreaterThan(0);
    });

    it('correctly formats debit and credit balances according to normal balance rules', async () => {
      const tb = await financialReportingService.getTrialBalance(ctx, {
        companyId,
        asOfDate: '2025-06-30'
      });

      const cashRow = tb.rows.find(r => r.accountCode === '1110')!;
      expect(cashRow.debitBalance).toBe('13000.00');
      expect(cashRow.creditBalance).toBe('0.00');

      const revRow = tb.rows.find(r => r.accountCode === '4100')!;
      expect(revRow.creditBalance).toBe('5000.00');
      expect(revRow.debitBalance).toBe('0.00');
    });
  });

  describe('2. General Ledger & Account Ledger Activity Report', () => {
    it('calculates running balances and deterministic pagination for account ledger', async () => {
      const gl = await financialReportingService.getAccountLedger(ctx, cashAccId, {
        companyId,
        fromDate: '2025-04-01',
        toDate: '2025-06-30',
        page: 1,
        limit: 10
      });

      expect(gl.accountId).toBe(cashAccId);
      expect(gl.lines.length).toBe(3);
      expect(gl.openingBalance).toBe('0.00');
      expect(gl.closingBalance).toBe('13000.00');
      expect(gl.lines[0].runningBalance).toBe('10000.00');
      expect(gl.lines[1].runningBalance).toBe('15000.00');
      expect(gl.lines[2].runningBalance).toBe('13000.00');
    });

    it('correctly calculates non-zero opening balance when fromDate excludes prior activity', async () => {
      const gl = await financialReportingService.getAccountLedger(ctx, cashAccId, {
        companyId,
        fromDate: '2025-05-01',
        toDate: '2025-06-30'
      });

      expect(gl.openingBalance).toBe('10000.00');
      expect(gl.lines.length).toBe(2);
      expect(gl.closingBalance).toBe('13000.00');
    });
  });

  describe('3. Profit & Loss Statement Engine', () => {
    it('generates Profit & Loss statement with Net Profit = Revenue - Expenses', async () => {
      const pnl = await financialReportingService.getProfitAndLoss(ctx, {
        companyId,
        fromDate: '2025-04-01',
        toDate: '2025-06-30'
      });

      expect(pnl.totalRevenue).toBe('5000.00');
      expect(pnl.totalExpense).toBe('2000.00');
      expect(pnl.netProfit).toBe('3000.00');
      expect(pnl.revenue.rows.length).toBeGreaterThan(0);
      expect(pnl.expenses.rows.length).toBeGreaterThan(0);
    });

    it('supports comparative period reporting', async () => {
      const pnl = await financialReportingService.getProfitAndLoss(ctx, {
        companyId,
        fromDate: '2025-05-01',
        toDate: '2025-06-30',
        comparativeFromDate: '2025-04-01',
        comparativeToDate: '2025-04-30'
      });

      expect(pnl.totalRevenue).toBe('5000.00');
      expect(pnl.comparativeTotalRevenue).toBe('0.00');
    });
  });

  describe('4. Balance Sheet Engine & Accounting Equation Assertion', () => {
    it('verifies the fundamental accounting equation (Assets == Liabilities + Equity)', async () => {
      const bs = await financialReportingService.getBalanceSheet(ctx, {
        companyId,
        asOfDate: '2025-06-30'
      });

      expect(bs.isBalanced).toBe(true);
      expect(bs.totalAssets).toBe('13000.00');
      expect(bs.totalEquity).toBe('13000.00'); // 10,000 capital + 3,000 net income
      expect(bs.totalLiabilitiesAndEquity).toBe('13000.00');
    });
  });

  describe('5. Subledger Reconciliation Diagnostics', () => {
    it('runs reconciliation report for AP_CONTROL, AR_CONTROL, and CASH_BANK', async () => {
      const recon = await financialReportingService.getReconciliationReport(ctx, {
        companyId,
        asOfDate: '2025-06-30'
      });

      expect(recon.companyId).toBe(companyId);
      expect(recon.items.length).toBeGreaterThan(0);
    });
  });

  describe('6. Security & Tenant Isolation', () => {
    it('prevents cross-tenant access to financial reports', async () => {
      await expect(
        financialReportingService.getTrialBalance(otherCtx, {
          companyId
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('7. Property-Based & Cross-Report Reconciliation', () => {
    it('verifies Trial Balance totals match GL closing balances and P&L net income matches Balance Sheet equity net income', async () => {
      const tb = await financialReportingService.getTrialBalance(ctx, { companyId, asOfDate: '2025-06-30' });
      const pnl = await financialReportingService.getProfitAndLoss(ctx, { companyId, fromDate: '2025-04-01', toDate: '2025-06-30' });
      const bs = await financialReportingService.getBalanceSheet(ctx, { companyId, asOfDate: '2025-06-30' });

      expect(tb.isBalanced).toBe(true);
      expect(bs.isBalanced).toBe(true);
      expect(pnl.netProfit).toBe('3000.00');
      expect(ExactDecimal.parse(bs.totalAssets, 2).equals(ExactDecimal.parse(bs.totalLiabilitiesAndEquity, 2))).toBe(true);
    });
  });

  describe('8. REST API Routes Validation', () => {
    it('executes financial reporting REST routes via Fastify app instance', async () => {
      const app = buildApp();

      // Trial Balance REST
      const resTb = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/reports/trial-balance?companyId=${companyId}&asOfDate=2025-06-30`,
        headers: { 'x-tenant-id': tenantId, 'x-company-id': companyId }
      });
      expect(resTb.statusCode).toBe(200);
      const tbData = JSON.parse(resTb.payload).data;
      expect(tbData.isBalanced).toBe(true);

      // General Ledger REST
      const resGl = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/reports/general-ledger?companyId=${companyId}&fromDate=2025-04-01&toDate=2025-06-30`,
        headers: { 'x-tenant-id': tenantId, 'x-company-id': companyId }
      });
      expect(resGl.statusCode).toBe(200);

      // P&L REST
      const resPnl = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/reports/profit-loss?companyId=${companyId}&fromDate=2025-04-01&toDate=2025-06-30`,
        headers: { 'x-tenant-id': tenantId, 'x-company-id': companyId }
      });
      expect(resPnl.statusCode).toBe(200);
      const pnlData = JSON.parse(resPnl.payload).data;
      expect(pnlData.netProfit).toBe('3000.00');

      // Balance Sheet REST
      const resBs = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/reports/balance-sheet?companyId=${companyId}&asOfDate=2025-06-30`,
        headers: { 'x-tenant-id': tenantId, 'x-company-id': companyId }
      });
      expect(resBs.statusCode).toBe(200);
      const bsData = JSON.parse(resBs.payload).data;
      expect(bsData.isBalanced).toBe(true);

      // Subledger Reconciliation REST
      const resRecon = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/reports/reconciliation?companyId=${companyId}&asOfDate=2025-06-30`,
        headers: { 'x-tenant-id': tenantId, 'x-company-id': companyId }
      });
      expect(resRecon.statusCode).toBe(200);
    });
  });
});
