import { describe, it, expect } from 'vitest';
import { RequestContext } from '@general-erp/core';
import { trialBalanceService } from '../src/modules/finance/reporting/trial-balance.service.js';
import { generalLedgerReportService } from '../src/modules/finance/reporting/general-ledger-report.service.js';
import { profitLossService } from '../src/modules/finance/reporting/profit-loss.service.js';
import { balanceSheetService } from '../src/modules/finance/reporting/balance-sheet.service.js';
import { financialReportingService } from '../src/modules/finance/reporting/financial-reporting.service.js';
import { arAgingService } from '../src/modules/finance/ar/index.js';
import { apAgingService } from '../src/modules/finance/ap/index.js';

describe('Phase 2.11 — Performance Benchmark & Workload Measurement', () => {
  const ctx: RequestContext = {
    tenantId: 'tenant_phase211_bench',
    userId: 'usr_bench_admin',
    roles: ['FINANCE_ADMIN'],
    permissions: ['*']
  };
  const companyId = 'comp_phase211_bench';

  it('measures execution duration and performance sanity across Phase 2 reporting queries', async () => {
    const measurements: Record<string, { durationMs: number; status: string }> = {};

    // 1. Benchmark Trial Balance
    const startTB = performance.now();
    await trialBalanceService.getTrialBalance(ctx, { companyId, asOfDate: '2027-03-31' });
    const endTB = performance.now();
    measurements['TrialBalance'] = { durationMs: Number((endTB - startTB).toFixed(2)), status: 'PASS' };

    // 2. Benchmark General Ledger First Page
    const startGL1 = performance.now();
    await generalLedgerReportService.getGeneralLedger(ctx, { companyId, page: 1, limit: 50 });
    const endGL1 = performance.now();
    measurements['GeneralLedger_Page1'] = { durationMs: Number((endGL1 - startGL1).toFixed(2)), status: 'PASS' };

    // 3. Benchmark Profit & Loss Statement
    const startPL = performance.now();
    await profitLossService.getProfitAndLoss(ctx, { companyId, fromDate: '2026-04-01', toDate: '2027-03-31' });
    const endPL = performance.now();
    measurements['ProfitLoss'] = { durationMs: Number((endPL - startPL).toFixed(2)), status: 'PASS' };

    // 4. Benchmark Balance Sheet
    const startBS = performance.now();
    await balanceSheetService.getBalanceSheet(ctx, { companyId, asOfDate: '2027-03-31' });
    const endBS = performance.now();
    measurements['BalanceSheet'] = { durationMs: Number((endBS - startBS).toFixed(2)), status: 'PASS' };

    // 5. Benchmark AR Aging Report
    const startARAging = performance.now();
    await arAgingService.getCompanyAging(ctx, companyId);
    const endARAging = performance.now();
    measurements['ArAging'] = { durationMs: Number((endARAging - startARAging).toFixed(2)), status: 'PASS' };

    // 6. Benchmark AP Aging Report
    const startAPAging = performance.now();
    await apAgingService.getCompanyAging(ctx, companyId);
    const endAPAging = performance.now();
    measurements['ApAging'] = { durationMs: Number((endAPAging - startAPAging).toFixed(2)), status: 'PASS' };

    // 7. Benchmark Subledger Reconciliation Diagnostic
    const startRecon = performance.now();
    await financialReportingService.getReconciliationReport(ctx, { companyId, asOfDate: '2027-03-31' });
    const endRecon = performance.now();
    measurements['ReconciliationDiagnostic'] = { durationMs: Number((endRecon - startRecon).toFixed(2)), status: 'PASS' };

    // Output performance table
    console.log('\n=================== PHASE 2.11 PERFORMANCE BENCHMARK ===================');
    console.table(measurements);
    console.log('=======================================================================\n');

    // Assert that all reporting queries executed within acceptable sub-second bounds
    Object.values(measurements).forEach(m => {
      expect(m.durationMs).toBeLessThan(1000);
    });
  });
});
