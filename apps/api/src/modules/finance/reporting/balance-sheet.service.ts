import { RequestContext, ExactDecimal } from '@general-erp/core';
import { chartOfAccountsService } from '../chart-of-accounts.service.js';
import { journalDraftService } from '../journal-draft.service.js';
import { JournalEntryDTO, JournalLineDTO } from '../journal-model.js';
import { BalanceSheetFilterInput, BalanceSheetReportDTO, FinancialReportSectionDTO, FinancialReportRowDTO } from './financial-reporting-model.js';
import { FinancialReportingValidator } from './financial-reporting-validator.js';
import type pg from 'pg';

export class BalanceSheetService {
  private dbPool?: pg.Pool | undefined;

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
  }

  public getDbPool(): pg.Pool | undefined {
    return this.dbPool;
  }

  private async fetchAsOfBalances(ctx: RequestContext, companyId: string, asOfDate: string): Promise<Map<string, ExactDecimal>> {
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
            AND je.accounting_date <= $3::date
          GROUP BY jl.account_id
        `;

        const res = await client.query(query, [ctx.tenantId, companyId, asOfDate]);
        await client.query('COMMIT');

        for (const row of res.rows) {
          const deb = ExactDecimal.parse(String(row.total_debit || '0.00'), 2);
          const cred = ExactDecimal.parse(String(row.total_credit || '0.00'), 2);
          // Net = Debit - Credit
          totalsMap.set(row.account_id, deb.sub(cred));
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
            journal.accountingDate <= asOfDate
          ) {
            const lines = linesStore?.get(storeKey) || journal.lines || [];
            for (const l of lines) {
              const cur = totalsMap.get(l.accountId) || ExactDecimal.ZERO;
              const deb = ExactDecimal.parse(l.debitAmount, 2);
              const cred = ExactDecimal.parse(l.creditAmount, 2);
              totalsMap.set(l.accountId, cur.add(deb.sub(cred)));
            }
          }
        }
      }
    }

    return totalsMap;
  }

  public async getBalanceSheet(ctx: RequestContext, filter: BalanceSheetFilterInput): Promise<BalanceSheetReportDTO> {
    const companyId = FinancialReportingValidator.validateCompanyContext(ctx, filter.companyId);
    const asOfDate = FinancialReportingValidator.validateDateString(filter.asOfDate, 'asOfDate') || new Date().toISOString().substring(0, 10);

    const coaList = await chartOfAccountsService.getAccountsList(ctx, companyId);
    const assetAccounts = coaList.filter(a => a.accountType === 'ASSET' && a.isPostable);
    const liabilityAccounts = coaList.filter(a => a.accountType === 'LIABILITY' && a.isPostable);
    const equityAccounts = coaList.filter(a => a.accountType === 'EQUITY' && a.isPostable);
    const pnlAccounts = coaList.filter(a => (a.accountType === 'INCOME' || a.accountType === 'EXPENSE') && a.isPostable);

    // Fetch primary asOfDate net balances
    const currentBalances = await this.fetchAsOfBalances(ctx, companyId, asOfDate);

    // Fetch optional comparative asOfDate net balances
    let comparativeBalances: Map<string, ExactDecimal> | undefined;
    if (filter.comparativeAsOfDate) {
      comparativeBalances = await this.fetchAsOfBalances(ctx, companyId, filter.comparativeAsOfDate);
    }

    // 1. Build Assets Section
    const assetRows: FinancialReportRowDTO[] = [];
    let totalAssets = ExactDecimal.ZERO;
    let comparativeTotalAssets = ExactDecimal.ZERO;

    for (const acc of assetAccounts) {
      const netDeb = currentBalances.get(acc.id) || ExactDecimal.ZERO; // Net Asset = Debit - Credit
      const compNetDeb = comparativeBalances ? (comparativeBalances.get(acc.id) || ExactDecimal.ZERO) : undefined;

      totalAssets = totalAssets.add(netDeb);
      if (compNetDeb) comparativeTotalAssets = comparativeTotalAssets.add(compNetDeb);

      assetRows.push({
        accountId: acc.id,
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        currentAmount: netDeb.toString(),
        ...(compNetDeb !== undefined ? { comparativeAmount: compNetDeb.toString() } : {})
      });
    }

    // 2. Build Liabilities Section
    const liabilityRows: FinancialReportRowDTO[] = [];
    let totalLiabilities = ExactDecimal.ZERO;
    let comparativeTotalLiabilities = ExactDecimal.ZERO;

    for (const acc of liabilityAccounts) {
      const netDeb = currentBalances.get(acc.id) || ExactDecimal.ZERO;
      const netCred = ExactDecimal.ZERO.sub(netDeb); // Net Liability = Credit - Debit
      const compNetDeb = comparativeBalances ? (comparativeBalances.get(acc.id) || ExactDecimal.ZERO) : undefined;
      const compNetCred = compNetDeb !== undefined ? ExactDecimal.ZERO.sub(compNetDeb) : undefined;

      totalLiabilities = totalLiabilities.add(netCred);
      if (compNetCred) comparativeTotalLiabilities = comparativeTotalLiabilities.add(compNetCred);

      liabilityRows.push({
        accountId: acc.id,
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        currentAmount: netCred.toString(),
        ...(compNetCred !== undefined ? { comparativeAmount: compNetCred.toString() } : {})
      });
    }

    // 3. Build Equity Section (including unclosed mid-year P&L net income)
    const equityRows: FinancialReportRowDTO[] = [];
    let totalEquity = ExactDecimal.ZERO;
    let comparativeTotalEquity = ExactDecimal.ZERO;

    for (const acc of equityAccounts) {
      const netDeb = currentBalances.get(acc.id) || ExactDecimal.ZERO;
      let netCred = ExactDecimal.ZERO.sub(netDeb); // Net Equity = Credit - Debit
      const compNetDeb = comparativeBalances ? (comparativeBalances.get(acc.id) || ExactDecimal.ZERO) : undefined;
      let compNetCred = compNetDeb !== undefined ? ExactDecimal.ZERO.sub(compNetDeb) : undefined;

      totalEquity = totalEquity.add(netCred);
      if (compNetCred) comparativeTotalEquity = comparativeTotalEquity.add(compNetCred);

      equityRows.push({
        accountId: acc.id,
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        currentAmount: netCred.toString(),
        ...(compNetCred !== undefined ? { comparativeAmount: compNetCred.toString() } : {})
      });
    }

    // Unclosed Period Net Income Calculation for Equity
    let unclosedNetIncome = ExactDecimal.ZERO;
    let compUnclosedNetIncome = ExactDecimal.ZERO;

    for (const acc of pnlAccounts) {
      const netDeb = currentBalances.get(acc.id) || ExactDecimal.ZERO;
      const netCred = ExactDecimal.ZERO.sub(netDeb);
      unclosedNetIncome = unclosedNetIncome.add(netCred);

      if (comparativeBalances) {
        const compNetDeb = comparativeBalances.get(acc.id) || ExactDecimal.ZERO;
        const compNetCred = ExactDecimal.ZERO.sub(compNetDeb);
        compUnclosedNetIncome = compUnclosedNetIncome.add(compNetCred);
      }
    }

    if (!unclosedNetIncome.isZero()) {
      totalEquity = totalEquity.add(unclosedNetIncome);
      equityRows.push({
        accountName: 'Current Period Net Income (Unclosed)',
        currentAmount: unclosedNetIncome.toString(),
        isSubtotal: true,
        ...(filter.comparativeAsOfDate ? { comparativeAmount: compUnclosedNetIncome.toString() } : {})
      });
    }

    if (filter.comparativeAsOfDate && !compUnclosedNetIncome.isZero()) {
      comparativeTotalEquity = comparativeTotalEquity.add(compUnclosedNetIncome);
    }

    const totalLiabilitiesAndEquity = totalLiabilities.add(totalEquity);
    const comparativeTotalLiabilitiesAndEquity = filter.comparativeAsOfDate ? comparativeTotalLiabilities.add(comparativeTotalEquity) : undefined;

    const isBalanced = totalAssets.equals(totalLiabilitiesAndEquity);

    const assetSection: FinancialReportSectionDTO = {
      title: 'Current & Non-Current Assets',
      sectionTotal: totalAssets.toString(),
      ...(filter.comparativeAsOfDate ? { comparativeSectionTotal: comparativeTotalAssets.toString() } : {}),
      rows: assetRows.sort((a, b) => (a.accountCode || '').localeCompare(b.accountCode || ''))
    };

    const liabilitySection: FinancialReportSectionDTO = {
      title: 'Current & Non-Current Liabilities',
      sectionTotal: totalLiabilities.toString(),
      ...(filter.comparativeAsOfDate ? { comparativeSectionTotal: comparativeTotalLiabilities.toString() } : {}),
      rows: liabilityRows.sort((a, b) => (a.accountCode || '').localeCompare(b.accountCode || ''))
    };

    const equitySection: FinancialReportSectionDTO = {
      title: 'Owners Equity & Retained Earnings',
      sectionTotal: totalEquity.toString(),
      ...(filter.comparativeAsOfDate ? { comparativeSectionTotal: comparativeTotalEquity.toString() } : {}),
      rows: equityRows
    };

    return {
      tenantId: ctx.tenantId!,
      companyId,
      asOfDate,
      ...(filter.comparativeAsOfDate ? { comparativeAsOfDate: filter.comparativeAsOfDate } : {}),
      assets: assetSection,
      liabilities: liabilitySection,
      equity: equitySection,
      totalAssets: totalAssets.toString(),
      totalLiabilities: totalLiabilities.toString(),
      totalEquity: totalEquity.toString(),
      totalLiabilitiesAndEquity: totalLiabilitiesAndEquity.toString(),
      isBalanced,
      ...(filter.comparativeAsOfDate ? {
        comparativeTotalAssets: comparativeTotalAssets.toString(),
        comparativeTotalLiabilitiesAndEquity: comparativeTotalLiabilitiesAndEquity!.toString()
      } : {}),
      generatedAt: new Date()
    };
  }
}

export const balanceSheetService = new BalanceSheetService();
