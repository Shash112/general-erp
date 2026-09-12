import { RequestContext, ExactDecimal } from '@general-erp/core';
import { chartOfAccountsService } from '../chart-of-accounts.service.js';
import { journalDraftService } from '../journal-draft.service.js';
import { JournalEntryDTO, JournalLineDTO } from '../journal-model.js';
import { ProfitLossFilterInput, ProfitLossReportDTO, FinancialReportSectionDTO, FinancialReportRowDTO } from './financial-reporting-model.js';
import { FinancialReportingValidator } from './financial-reporting-validator.js';
import type pg from 'pg';

export class ProfitLossService {
  private dbPool?: pg.Pool | undefined;

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
  }

  public getDbPool(): pg.Pool | undefined {
    return this.dbPool;
  }

  private async fetchPeriodNetTotals(ctx: RequestContext, companyId: string, fromDate: string, toDate: string): Promise<Map<string, ExactDecimal>> {
    const totalsMap = new Map<string, ExactDecimal>();

    if (this.dbPool) {
      const client = await this.dbPool.connect();
      try {
        await client.query('BEGIN READ ONLY');
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');

        const query = `
          SELECT jl.account_id,
                 SUM(jl.base_debit_amount) as total_debit,
                 SUM(jl.base_credit_amount) as total_credit
          FROM journal_lines jl
          JOIN journal_entries je ON jl.journal_entry_id = je.id
          WHERE jl.tenant_id = $1 AND jl.company_id = $2
            AND je.status = 'POSTED'
            AND je.accounting_date >= $3::date
            AND je.accounting_date <= $4::date
          GROUP BY jl.account_id
        `;

        const res = await client.query(query, [ctx.tenantId, companyId, fromDate, toDate]);
        await client.query('COMMIT');

        for (const row of res.rows) {
          const deb = ExactDecimal.parse(String(row.total_debit || '0.00'), 2);
          const cred = ExactDecimal.parse(String(row.total_credit || '0.00'), 2);
          // Store net credit minus debit for income, net debit minus credit for expense in post-processing
          totalsMap.set(row.account_id, cred.sub(deb));
        }
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      const store = (journalDraftService as any).journalsStore as Map<string, JournalEntryDTO> | undefined;
      const linesStore = (journalDraftService as any).linesStore as Map<string, JournalLineDTO[]> | undefined;

      if (store) {
        for (const [storeKey, journal] of store.entries()) {
          if (
            journal.tenantId === ctx.tenantId &&
            journal.companyId === companyId &&
            journal.status === 'POSTED' &&
            journal.accountingDate >= fromDate &&
            journal.accountingDate <= toDate
          ) {
            const lines = linesStore?.get(storeKey) || journal.lines || [];
            for (const l of lines) {
              const cur = totalsMap.get(l.accountId) || ExactDecimal.ZERO;
              const deb = ExactDecimal.parse(l.debitAmount, 2);
              const cred = ExactDecimal.parse(l.creditAmount, 2);
              totalsMap.set(l.accountId, cur.add(cred.sub(deb)));
            }
          }
        }
      }
    }

    return totalsMap;
  }

  public async getProfitAndLoss(ctx: RequestContext, filter: ProfitLossFilterInput): Promise<ProfitLossReportDTO> {
    const companyId = FinancialReportingValidator.validateCompanyContext(ctx, filter.companyId);
    if (!filter.fromDate || !filter.toDate) {
      throw new Error('fromDate and toDate are required for Profit & Loss statement.');
    }
    const { fromDate, toDate } = FinancialReportingValidator.validateDateRange(filter.fromDate, filter.toDate);

    const coaList = await chartOfAccountsService.getAccountsList(ctx, companyId);
    const incomeAccounts = coaList.filter(a => a.accountType === 'INCOME' && a.isPostable);
    const expenseAccounts = coaList.filter(a => a.accountType === 'EXPENSE' && a.isPostable);

    // Fetch primary period totals
    const currentTotals = await this.fetchPeriodNetTotals(ctx, companyId, fromDate!, toDate!);

    // Fetch optional comparative period totals
    let comparativeTotals: Map<string, ExactDecimal> | undefined;
    if (filter.comparativeFromDate && filter.comparativeToDate) {
      comparativeTotals = await this.fetchPeriodNetTotals(ctx, companyId, filter.comparativeFromDate, filter.comparativeToDate);
    }

    // Build Revenue Section
    const revenueRows: FinancialReportRowDTO[] = [];
    let totalRevenue = ExactDecimal.ZERO;
    let comparativeTotalRevenue = ExactDecimal.ZERO;

    for (const acc of incomeAccounts) {
      const netCred = currentTotals.get(acc.id) || ExactDecimal.ZERO; // Net Income = Credit - Debit
      const compNetCred = comparativeTotals ? (comparativeTotals.get(acc.id) || ExactDecimal.ZERO) : undefined;

      totalRevenue = totalRevenue.add(netCred);
      if (compNetCred) comparativeTotalRevenue = comparativeTotalRevenue.add(compNetCred);

      revenueRows.push({
        accountId: acc.id,
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        currentAmount: netCred.toString(),
        ...(compNetCred !== undefined ? { comparativeAmount: compNetCred.toString() } : {})
      });
    }

    // Build Expenses Section
    const expenseRows: FinancialReportRowDTO[] = [];
    let totalExpense = ExactDecimal.ZERO;
    let comparativeTotalExpense = ExactDecimal.ZERO;

    for (const acc of expenseAccounts) {
      const netCred = currentTotals.get(acc.id) || ExactDecimal.ZERO;
      const netDeb = ExactDecimal.ZERO.sub(netCred); // Net Expense = Debit - Credit
      const compNetCred = comparativeTotals ? (comparativeTotals.get(acc.id) || ExactDecimal.ZERO) : undefined;
      const compNetDeb = compNetCred !== undefined ? ExactDecimal.ZERO.sub(compNetCred) : undefined;

      totalExpense = totalExpense.add(netDeb);
      if (compNetDeb) comparativeTotalExpense = comparativeTotalExpense.add(compNetDeb);

      expenseRows.push({
        accountId: acc.id,
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        currentAmount: netDeb.toString(),
        ...(compNetDeb !== undefined ? { comparativeAmount: compNetDeb.toString() } : {})
      });
    }

    const netProfit = totalRevenue.sub(totalExpense);
    const comparativeNetProfit = filter.comparativeFromDate ? comparativeTotalRevenue.sub(comparativeTotalExpense) : undefined;

    const revenueSection: FinancialReportSectionDTO = {
      title: 'Operating & Non-Operating Income',
      sectionTotal: totalRevenue.toString(),
      ...(filter.comparativeFromDate ? { comparativeSectionTotal: comparativeTotalRevenue.toString() } : {}),
      rows: revenueRows.sort((a, b) => (a.accountCode || '').localeCompare(b.accountCode || ''))
    };

    const expenseSection: FinancialReportSectionDTO = {
      title: 'Operating & Administrative Expenses',
      sectionTotal: totalExpense.toString(),
      ...(filter.comparativeFromDate ? { comparativeSectionTotal: comparativeTotalExpense.toString() } : {}),
      rows: expenseRows.sort((a, b) => (a.accountCode || '').localeCompare(b.accountCode || ''))
    };

    return {
      tenantId: ctx.tenantId!,
      companyId,
      fromDate: fromDate!,
      toDate: toDate!,
      ...(filter.comparativeFromDate ? { comparativeFromDate: filter.comparativeFromDate, comparativeToDate: filter.comparativeToDate } : {}),
      revenue: revenueSection,
      expenses: expenseSection,
      totalRevenue: totalRevenue.toString(),
      totalExpense: totalExpense.toString(),
      netProfit: netProfit.toString(),
      ...(filter.comparativeFromDate ? {
        comparativeTotalRevenue: comparativeTotalRevenue.toString(),
        comparativeTotalExpense: comparativeTotalExpense.toString(),
        comparativeNetProfit: comparativeNetProfit!.toString()
      } : {}),
      generatedAt: new Date()
    };
  }
}

export const profitLossService = new ProfitLossService();
