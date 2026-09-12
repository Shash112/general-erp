import { RequestContext, ExactDecimal } from '@general-erp/core';
import { chartOfAccountsService } from '../chart-of-accounts.service.js';
import { journalDraftService } from '../journal-draft.service.js';
import { JournalEntryDTO, JournalLineDTO } from '../journal-model.js';
import { GeneralLedgerFilterInput, GeneralLedgerReportDTO, GeneralLedgerLineDTO } from './financial-reporting-model.js';
import { FinancialReportingValidator } from './financial-reporting-validator.js';
import type pg from 'pg';

export class GeneralLedgerReportService {
  private dbPool?: pg.Pool | undefined;

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
  }

  public getDbPool(): pg.Pool | undefined {
    return this.dbPool;
  }

  public async getGeneralLedger(ctx: RequestContext, filter: GeneralLedgerFilterInput): Promise<GeneralLedgerReportDTO> {
    const companyId = FinancialReportingValidator.validateCompanyContext(ctx, filter.companyId);
    const { fromDate, toDate } = FinancialReportingValidator.validateDateRange(filter.fromDate, filter.toDate);
    const { page, limit } = FinancialReportingValidator.validatePagination(filter.page, filter.limit);

    // Fetch account details if accountId filter is provided
    let accountCode = '';
    let accountName = '';
    let normalBalance: 'DEBIT' | 'CREDIT' = 'DEBIT';

    if (filter.accountId) {
      try {
        const acc = await chartOfAccountsService.getAccountById(ctx, filter.accountId);
        accountCode = acc.accountCode;
        accountName = acc.accountName;
        normalBalance = acc.normalBalance;
      } catch {
        // Account not found or deleted
      }
    }

    let allLines: GeneralLedgerLineDTO[] = [];
    let openingBalance = ExactDecimal.ZERO;

    if (this.dbPool) {
      const client = await this.dbPool.connect();
      try {
        await client.query('BEGIN READ ONLY');
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');

        // 1. Calculate Opening Balance prior to fromDate
        if (fromDate && filter.accountId) {
          const obQuery = `
            SELECT SUM(jl.base_debit_amount) as total_debit,
                   SUM(jl.base_credit_amount) as total_credit
            FROM journal_lines jl
            JOIN journal_entries je ON jl.journal_entry_id = je.id
            WHERE jl.tenant_id = $1 AND jl.company_id = $2
              AND jl.account_id = $3
              AND je.status = 'POSTED'
              AND je.accounting_date < $4::date
          `;
          const obRes = await client.query(obQuery, [ctx.tenantId, companyId, filter.accountId, fromDate]);
          const dSum = ExactDecimal.parse(String(obRes.rows[0]?.total_debit || '0.00'), 2);
          const cSum = ExactDecimal.parse(String(obRes.rows[0]?.total_credit || '0.00'), 2);
          openingBalance = normalBalance === 'DEBIT' ? dSum.sub(cSum) : cSum.sub(dSum);
        }

        // 2. Fetch Activity Journal Lines
        let query = `
          SELECT jl.id as line_id,
                 jl.journal_entry_id,
                 jl.account_id,
                 coa.account_code,
                 coa.account_name,
                 jl.line_sequence,
                 jl.base_debit_amount,
                 jl.base_credit_amount,
                 jl.narration as line_narration,
                 je.voucher_number,
                 je.accounting_date,
                 je.source_module,
                 je.source_document_type,
                 je.source_document_id,
                 je.narration as journal_narration
          FROM journal_lines jl
          JOIN journal_entries je ON jl.journal_entry_id = je.id
          JOIN chart_of_accounts coa ON jl.account_id = coa.id
          WHERE jl.tenant_id = $1 AND jl.company_id = $2
            AND je.status = 'POSTED'
        `;

        const queryParams: any[] = [ctx.tenantId, companyId];
        let paramIdx = 3;

        if (filter.accountId) {
          query += ` AND jl.account_id = $${paramIdx++}`;
          queryParams.push(filter.accountId);
        }
        if (fromDate) {
          query += ` AND je.accounting_date >= $${paramIdx++}::date`;
          queryParams.push(fromDate);
        }
        if (toDate) {
          query += ` AND je.accounting_date <= $${paramIdx++}::date`;
          queryParams.push(toDate);
        }

        // Deterministic Sort Order
        query += ` ORDER BY je.accounting_date ASC, je.voucher_number ASC NULLS LAST, je.id ASC, jl.line_sequence ASC`;

        const res = await client.query(query, queryParams);
        await client.query('COMMIT');

        let currentRunning = openingBalance;

        for (const row of res.rows) {
          const deb = ExactDecimal.parse(String(row.base_debit_amount || '0.00'), 2);
          const cred = ExactDecimal.parse(String(row.base_credit_amount || '0.00'), 2);

          if (normalBalance === 'DEBIT') {
            currentRunning = currentRunning.add(deb).sub(cred);
          } else {
            currentRunning = currentRunning.add(cred).sub(deb);
          }

          allLines.push({
            journalEntryId: row.journal_entry_id,
            voucherNumber: row.voucher_number || null,
            accountingDate: typeof row.accounting_date === 'string' ? row.accounting_date.substring(0, 10) : new Date(row.accounting_date).toISOString().substring(0, 10),
            sourceModule: row.source_module,
            sourceDocumentType: row.source_document_type || null,
            sourceDocumentId: row.source_document_id || null,
            accountId: row.account_id,
            accountCode: row.account_code,
            accountName: row.account_name,
            narration: row.line_narration || row.journal_narration || null,
            debitAmount: deb.toString(),
            creditAmount: cred.toString(),
            runningBalance: currentRunning.toString(),
            lineSequence: Number(row.line_sequence)
          });
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

      const matchedJournals: Array<{ journal: JournalEntryDTO; line: JournalLineDTO }> = [];

      if (store) {
        for (const [storeKey, journal] of store.entries()) {
          if (
            journal.tenantId === ctx.tenantId &&
            journal.companyId === companyId &&
            journal.status === 'POSTED'
          ) {
            const lines = linesStore?.get(storeKey) || journal.lines || [];
            for (const l of lines) {
              if (!filter.accountId || l.accountId === filter.accountId) {
                // Opening balance check
                if (fromDate && journal.accountingDate < fromDate && filter.accountId && l.accountId === filter.accountId) {
                  const d = ExactDecimal.parse(l.debitAmount, 2);
                  const c = ExactDecimal.parse(l.creditAmount, 2);
                  openingBalance = normalBalance === 'DEBIT' ? openingBalance.add(d).sub(c) : openingBalance.add(c).sub(d);
                } else if ((!fromDate || journal.accountingDate >= fromDate) && (!toDate || journal.accountingDate <= toDate)) {
                  matchedJournals.push({ journal, line: l });
                }
              }
            }
          }
        }
      }

      // Deterministic sort: accountingDate, voucherNumber, id, lineSequence
      matchedJournals.sort((a, b) => {
        if (a.journal.accountingDate !== b.journal.accountingDate) {
          return a.journal.accountingDate.localeCompare(b.journal.accountingDate);
        }
        const vA = a.journal.voucherNumber || a.journal.id || '';
        const vB = b.journal.voucherNumber || b.journal.id || '';
        if (vA !== vB) return vA.localeCompare(vB);
        return a.line.lineSequence - b.line.lineSequence;
      });

      let currentRunning = openingBalance;

      for (const item of matchedJournals) {
        const deb = ExactDecimal.parse(item.line.debitAmount, 2);
        const cred = ExactDecimal.parse(item.line.creditAmount, 2);

        if (normalBalance === 'DEBIT') {
          currentRunning = currentRunning.add(deb).sub(cred);
        } else {
          currentRunning = currentRunning.add(cred).sub(deb);
        }

        allLines.push({
          journalEntryId: item.journal.id || '',
          voucherNumber: item.journal.voucherNumber || null,
          accountingDate: item.journal.accountingDate,
          sourceModule: item.journal.sourceModule,
          sourceDocumentType: item.journal.sourceDocumentType || null,
          sourceDocumentId: item.journal.sourceDocumentId || null,
          accountId: item.line.accountId,
          accountCode: accountCode || item.line.accountId,
          accountName: accountName || 'GL Account',
          narration: item.line.narration || item.journal.narration || null,
          debitAmount: deb.toString(),
          creditAmount: cred.toString(),
          runningBalance: currentRunning.toString(),
          lineSequence: item.line.lineSequence
        });
      }
    }

    // Totals & Pagination Slicing
    let totalDebit = ExactDecimal.ZERO;
    let totalCredit = ExactDecimal.ZERO;

    for (const line of allLines) {
      totalDebit = totalDebit.add(ExactDecimal.parse(line.debitAmount, 2));
      totalCredit = totalCredit.add(ExactDecimal.parse(line.creditAmount, 2));
    }

    const totalCount = allLines.length;
    const totalPages = Math.ceil(totalCount / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paginatedLines = allLines.slice(startIndex, startIndex + limit);
    const closingBalance = allLines.length > 0 ? allLines[allLines.length - 1]!.runningBalance : openingBalance.toString();

    return {
      tenantId: ctx.tenantId!,
      companyId,
      accountId: filter.accountId,
      fromDate,
      toDate,
      openingBalance: openingBalance.toString(),
      closingBalance,
      totalDebit: totalDebit.toString(),
      totalCredit: totalCredit.toString(),
      lines: paginatedLines,
      meta: {
        totalCount,
        page,
        limit,
        totalPages
      },
      generatedAt: new Date()
    };
  }
}

export const generalLedgerReportService = new GeneralLedgerReportService();
