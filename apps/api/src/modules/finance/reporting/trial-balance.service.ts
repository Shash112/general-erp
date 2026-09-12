import { RequestContext, ExactDecimal } from '@general-erp/core';
import { chartOfAccountsService } from '../chart-of-accounts.service.js';
import { journalDraftService } from '../journal-draft.service.js';
import { JournalEntryDTO, JournalLineDTO } from '../journal-model.js';
import { TrialBalanceFilterInput, TrialBalanceReportDTO, TrialBalanceRowDTO } from './financial-reporting-model.js';
import { FinancialReportingValidator } from './financial-reporting-validator.js';
import type pg from 'pg';

export class TrialBalanceService {
  private dbPool?: pg.Pool | undefined;

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
  }

  public getDbPool(): pg.Pool | undefined {
    return this.dbPool;
  }

  public async getTrialBalance(ctx: RequestContext, filter: TrialBalanceFilterInput): Promise<TrialBalanceReportDTO> {
    const companyId = FinancialReportingValidator.validateCompanyContext(ctx, filter.companyId);
    const asOfDate = FinancialReportingValidator.validateDateString(filter.asOfDate, 'asOfDate') || new Date().toISOString().substring(0, 10);

    const coaList = await chartOfAccountsService.getAccountsList(ctx, companyId, { isPostable: true });

    // Net debit/credit totals per account ID
    const debitTotalsMap = new Map<string, ExactDecimal>();
    const creditTotalsMap = new Map<string, ExactDecimal>();

    for (const acc of coaList) {
      debitTotalsMap.set(acc.id, ExactDecimal.ZERO);
      creditTotalsMap.set(acc.id, ExactDecimal.ZERO);
    }

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
          const accId = row.account_id;
          if (debitTotalsMap.has(accId)) {
            debitTotalsMap.set(accId, ExactDecimal.parse(String(row.total_debit || '0.00'), 2));
            creditTotalsMap.set(accId, ExactDecimal.parse(String(row.total_credit || '0.00'), 2));
          }
        }
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      // In-memory fallback for vitest environment
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
              if (debitTotalsMap.has(l.accountId)) {
                const curDebit = debitTotalsMap.get(l.accountId)!;
                const curCredit = creditTotalsMap.get(l.accountId)!;
                debitTotalsMap.set(l.accountId, curDebit.add(ExactDecimal.parse(l.debitAmount, 2)));
                creditTotalsMap.set(l.accountId, curCredit.add(ExactDecimal.parse(l.creditAmount, 2)));
              }
            }
          }
        }
      }
    }

    const rows: TrialBalanceRowDTO[] = [];
    let grandTotalDebit = ExactDecimal.ZERO;
    let grandTotalCredit = ExactDecimal.ZERO;

    for (const acc of coaList) {
      const debitTotal = debitTotalsMap.get(acc.id) || ExactDecimal.ZERO;
      const creditTotal = creditTotalsMap.get(acc.id) || ExactDecimal.ZERO;

      if (!filter.includeZeroBalances && debitTotal.isZero() && creditTotal.isZero()) {
        continue;
      }

      grandTotalDebit = grandTotalDebit.add(debitTotal);
      grandTotalCredit = grandTotalCredit.add(creditTotal);

      // Debit/Credit presentation balance based on Normal Balance
      let debitBalance = '0.00';
      let creditBalance = '0.00';

      const diff = debitTotal.sub(creditTotal);
      if (acc.normalBalance === 'DEBIT') {
        if (diff.isPositive()) {
          debitBalance = diff.toString();
        } else if (diff.isNegative()) {
          creditBalance = ExactDecimal.ZERO.sub(diff).toString();
        }
      } else {
        const credDiff = creditTotal.sub(debitTotal);
        if (credDiff.isPositive()) {
          creditBalance = credDiff.toString();
        } else if (credDiff.isNegative()) {
          debitBalance = ExactDecimal.ZERO.sub(credDiff).toString();
        }
      }

      rows.push({
        accountId: acc.id,
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        accountType: acc.accountType,
        normalBalance: acc.normalBalance,
        debitTotal: debitTotal.toString(),
        creditTotal: creditTotal.toString(),
        debitBalance,
        creditBalance,
        netBalance: diff.toString()
      });
    }

    const isBalanced = grandTotalDebit.equals(grandTotalCredit);

    return {
      tenantId: ctx.tenantId!,
      companyId,
      asOfDate,
      totalDebit: grandTotalDebit.toString(),
      totalCredit: grandTotalCredit.toString(),
      isBalanced,
      rows: rows.sort((a, b) => a.accountCode.localeCompare(b.accountCode)),
      generatedAt: new Date()
    };
  }
}

export const trialBalanceService = new TrialBalanceService();
