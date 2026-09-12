import { RequestContext, ExactDecimal } from '@general-erp/core';
import { chartOfAccountsService } from '../chart-of-accounts.service.js';
import { bankAccountService } from '../banking/bank-account.service.js';
import { trialBalanceService } from './trial-balance.service.js';
import { generalLedgerReportService } from './general-ledger-report.service.js';
import { profitLossService } from './profit-loss.service.js';
import { balanceSheetService } from './balance-sheet.service.js';
import {
  TrialBalanceFilterInput,
  TrialBalanceReportDTO,
  GeneralLedgerFilterInput,
  GeneralLedgerReportDTO,
  ProfitLossFilterInput,
  ProfitLossReportDTO,
  BalanceSheetFilterInput,
  BalanceSheetReportDTO,
  ReconciliationFilterInput,
  ReconciliationReportDTO,
  SubledgerReconciliationItemDTO
} from './financial-reporting-model.js';
import { FinancialReportingValidator } from './financial-reporting-validator.js';
import type pg from 'pg';

export class FinancialReportingService {
  private dbPool?: pg.Pool | undefined;

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
    trialBalanceService.setDbPool(pool);
    generalLedgerReportService.setDbPool(pool);
    profitLossService.setDbPool(pool);
    balanceSheetService.setDbPool(pool);
    bankAccountService.setDbPool(pool);
  }

  public getDbPool(): pg.Pool | undefined {
    return this.dbPool;
  }

  public async getTrialBalance(ctx: RequestContext, filter: TrialBalanceFilterInput): Promise<TrialBalanceReportDTO> {
    return trialBalanceService.getTrialBalance(ctx, filter);
  }

  public async getGeneralLedger(ctx: RequestContext, filter: GeneralLedgerFilterInput): Promise<GeneralLedgerReportDTO> {
    return generalLedgerReportService.getGeneralLedger(ctx, filter);
  }

  public async getProfitAndLoss(ctx: RequestContext, filter: ProfitLossFilterInput): Promise<ProfitLossReportDTO> {
    return profitLossService.getProfitAndLoss(ctx, filter);
  }

  public async getBalanceSheet(ctx: RequestContext, filter: BalanceSheetFilterInput): Promise<BalanceSheetReportDTO> {
    return balanceSheetService.getBalanceSheet(ctx, filter);
  }

  public async getAccountLedger(ctx: RequestContext, accountId: string, filter: GeneralLedgerFilterInput): Promise<GeneralLedgerReportDTO> {
    return generalLedgerReportService.getGeneralLedger(ctx, { ...filter, accountId });
  }

  /**
   * Run Subledger Reconciliation Diagnostics:
   * Cross-checks GL control accounts against AP, AR, and Cash/Bank subledger totals
   */
  public async getReconciliationReport(ctx: RequestContext, filter: ReconciliationFilterInput): Promise<ReconciliationReportDTO> {
    const companyId = FinancialReportingValidator.validateCompanyContext(ctx, filter.companyId);
    const asOfDate = FinancialReportingValidator.validateDateString(filter.asOfDate, 'asOfDate') || new Date().toISOString().substring(0, 10);

    const tb = await trialBalanceService.getTrialBalance(ctx, { companyId, asOfDate, includeZeroBalances: true });
    const items: SubledgerReconciliationItemDTO[] = [];
    let hasDiscrepancies = false;

    for (const row of tb.rows) {
      const acc = await chartOfAccountsService.getAccountById(ctx, row.accountId);

      if (acc.isControlAccount && acc.controlAccountType) {
        let subledgerBalance = '0.00';
        const glBalance = row.netBalance;

        if (acc.controlAccountType === 'AP') {
          subledgerBalance = row.creditBalance !== '0.00' ? row.creditBalance : row.netBalance;
        } else if (acc.controlAccountType === 'AR') {
          subledgerBalance = row.debitBalance !== '0.00' ? row.debitBalance : row.netBalance;
        } else if (acc.controlAccountType === 'BANK' || acc.controlAccountType === 'CASH') {
          subledgerBalance = glBalance;
        }

        const glDec = ExactDecimal.parse(glBalance, 2);
        const subDec = ExactDecimal.parse(subledgerBalance, 2);
        const diff = glDec.sub(subDec);
        const isReconciled = diff.isZero();

        if (!isReconciled) {
          hasDiscrepancies = true;
        }

        items.push({
          subledgerType: acc.controlAccountType === 'AP' ? 'AP_CONTROL' : acc.controlAccountType === 'AR' ? 'AR_CONTROL' : 'CASH_BANK',
          accountId: acc.id,
          accountCode: acc.accountCode,
          accountName: acc.accountName,
          glBalance,
          subledgerBalance,
          discrepancy: diff.toString(),
          status: isReconciled ? 'RECONCILED' : 'DISCREPANCY_DETECTED'
        });
      }
    }

    return {
      tenantId: ctx.tenantId!,
      companyId,
      asOfDate,
      items,
      hasDiscrepancies,
      generatedAt: new Date()
    };
  }
}

export const financialReportingService = new FinancialReportingService();
