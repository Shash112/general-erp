import { RequestContext } from '@general-erp/core';
import { PostedTransactionLookup } from './chart-of-accounts.service.js';
import { journalDraftService } from './journal-draft.service.js';
import { JournalEntryDTO, JournalLineDTO } from './journal-model.js';
import type pg from 'pg';

export class GLPostedTransactionLookupAdapter implements PostedTransactionLookup {
  private dbPool?: pg.Pool | undefined;

  constructor(pool?: pg.Pool) {
    this.dbPool = pool;
  }

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
  }

  public async hasPostedTransactions(ctx: RequestContext, accountId: string): Promise<boolean> {
    if (!ctx.tenantId || !ctx.companyId || !accountId) {
      return false;
    }

    if (this.dbPool) {
      const res = await this.dbPool.query(
        `SELECT COUNT(*)::int as count
         FROM journal_lines jl
         JOIN journal_entries je ON jl.journal_entry_id = je.id
         WHERE jl.tenant_id = $1 AND jl.company_id = $2 AND jl.account_id = $3
           AND je.status = 'POSTED'`,
        [ctx.tenantId, ctx.companyId, accountId]
      );
      return Number(res.rows[0]?.count || 0) > 0;
    } else {
      // In-memory fallback for test environment
      const store = (journalDraftService as any).journalsStore as Map<string, JournalEntryDTO> | undefined;
      const linesStore = (journalDraftService as any).linesStore as Map<string, JournalLineDTO[]> | undefined;
      if (!store) return false;

      for (const [storeKey, journal] of store.entries()) {
        if (
          journal.tenantId === ctx.tenantId &&
          journal.companyId === ctx.companyId &&
          journal.status === 'POSTED'
        ) {
          const lines = linesStore?.get(storeKey) || journal.lines || [];
          if (lines.some(l => l.accountId === accountId)) {
            return true;
          }
        }
      }
      return false;
    }
  }
}

export const glPostedTransactionLookupAdapter = new GLPostedTransactionLookupAdapter();
