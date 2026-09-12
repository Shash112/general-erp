import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext, BusinessRuleViolationError, NotFoundError, ConflictError } from '@general-erp/core';
import { glEngine } from '../src/modules/finance/gl-engine.js';
import { journalDraftService } from '../src/modules/finance/journal-draft.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { numberingEngine } from '../src/platform/numbering/numbering.service.js';
import { idempotencyService } from '../src/platform/idempotency/idempotency.service.js';

describe('Phase 2.3.7 — Append-Only Single-Reversal Engine', () => {
  const ctx: RequestContext = {
    tenantId: 'tenant_rev_test',
    companyId: 'company_rev_test',
    user: { userId: 'user_fin_poster', roles: ['FINANCE_POSTER'], permissions: ['*'] },
    traceId: 'trace_rev_1'
  };

  let acc1Id: string;
  let acc2Id: string;
  let postedJournalId: string;

  beforeEach(async () => {
    // Reset stores
    journalDraftService.clear();
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    numberingEngine.clear();
    idempotencyService.clear();

    // Create Fiscal Year & Periods (createFiscalYear creates open periods by default)
    await fiscalPeriodService.createFiscalYear(ctx, {
      name: 'FY 2026-27',
      companyId: ctx.companyId,
      startDate: new Date('2026-04-01T00:00:00Z'),
      endDate: new Date('2027-03-31T23:59:59Z'),
      periodsCount: 12
    });

    // Create COA Accounts
    const acc1 = await chartOfAccountsService.createAccount(ctx, {
      companyId: ctx.companyId,
      accountCode: '1001',
      accountName: 'Bank Account',
      accountType: 'ASSET',
      nodeType: 'ACCOUNT',
      currency: 'INR'
    });
    acc1Id = acc1.id;

    const acc2 = await chartOfAccountsService.createAccount(ctx, {
      companyId: ctx.companyId,
      accountCode: '4001',
      accountName: 'Sales Revenue',
      accountType: 'INCOME',
      nodeType: 'ACCOUNT',
      currency: 'INR'
    });
    acc2Id = acc2.id;

    // Create & Post a sample original journal
    const draft = await journalDraftService.createDraft(ctx, {
      companyId: ctx.companyId,
      accountingDate: '2026-04-15',
      sourceModule: 'SALES',
      sourceDocumentType: 'INVOICE',
      sourceDocumentId: 'INV-REV-001',
      currency: 'INR',
      narration: 'Original sales entry',
      lines: [
        { lineSequence: 1, accountId: acc1Id, debitAmount: '1000.00', creditAmount: '0.00' },
        { lineSequence: 2, accountId: acc2Id, debitAmount: '0.00', creditAmount: '1000.00' }
      ]
    });

    const posted = await glEngine.postJournal(ctx, { journalEntryId: draft.id });
    postedJournalId = posted.id!;
  });

  it('1. Reverses a POSTED journal and creates a new reversal entry with swapped debit/credit lines', async () => {
    const reversal = await glEngine.reverseJournal(ctx, {
      originalJournalId: postedJournalId,
      reason: 'Incorrect customer billing amount'
    });

    expect(reversal.id).toBeDefined();
    expect(reversal.id).not.toEqual(postedJournalId);
    expect(reversal.status).toEqual('POSTED');
    expect(reversal.sourceModule).toEqual('MANUAL');
    expect(reversal.sourceDocumentType).toEqual('REVERSAL');
    expect(reversal.originalJournalId).toEqual(postedJournalId);
    expect(reversal.narration).toContain('Reversal of voucher');
    expect(reversal.narration).toContain('Incorrect customer billing amount');

    // Debit/Credit line swapping check
    expect(reversal.lines).toHaveLength(2);
    const line1 = reversal.lines.find(l => l.lineSequence === 1)!;
    const line2 = reversal.lines.find(l => l.lineSequence === 2)!;

    expect(line1.debitAmount).toEqual('0.00');
    expect(line1.creditAmount).toEqual('1000.00');

    expect(line2.debitAmount).toEqual('1000.00');
    expect(line2.creditAmount).toEqual('0.00');
  });

  it('2. Preserves immutability of original posted journal', async () => {
    const origBefore = await journalDraftService.getDraftById(ctx, postedJournalId);

    await glEngine.reverseJournal(ctx, {
      originalJournalId: postedJournalId,
      reason: 'Billing adjustment'
    });

    const origAfter = await journalDraftService.getDraftById(ctx, postedJournalId);

    expect(origAfter.status).toEqual('POSTED');
    expect(origAfter.version).toEqual(origBefore.version);
    expect(origAfter.originalJournalId).toBeFalsy();
    expect(origAfter.lines[0]!.debitAmount).toEqual(origBefore.lines[0]!.debitAmount);
    expect(origAfter.lines[1]!.creditAmount).toEqual(origBefore.lines[1]!.creditAmount);
  });

  it('3. Prohibits reversal of a reversal journal (one-level reversal graph rule)', async () => {
    const reversal1 = await glEngine.reverseJournal(ctx, {
      originalJournalId: postedJournalId,
      reason: 'First reversal'
    });

    await expect(
      glEngine.reverseJournal(ctx, {
        originalJournalId: reversal1.id!,
        reason: 'Attempting to reverse reversal'
      })
    ).rejects.toThrow(BusinessRuleViolationError);
  });

  it('4. Prohibits duplicate reversal of the same original journal', async () => {
    await glEngine.reverseJournal(ctx, {
      originalJournalId: postedJournalId,
      reason: 'First reversal attempt'
    });

    await expect(
      glEngine.reverseJournal(ctx, {
        originalJournalId: postedJournalId,
        reason: 'Second reversal attempt'
      })
    ).rejects.toThrow(BusinessRuleViolationError);
  });

  it('5. Rejects reversal of DRAFT or CANCELLED journals', async () => {
    const draft = await journalDraftService.createDraft(ctx, {
      companyId: ctx.companyId,
      accountingDate: '2026-04-16',
      lines: [
        { lineSequence: 1, accountId: acc1Id, debitAmount: '500.00', creditAmount: '0.00' },
        { lineSequence: 2, accountId: acc2Id, debitAmount: '0.00', creditAmount: '500.00' }
      ]
    });

    await expect(
      glEngine.reverseJournal(ctx, {
        originalJournalId: draft.id,
        reason: 'Attempting to reverse draft'
      })
    ).rejects.toThrow(BusinessRuleViolationError);

    await journalDraftService.cancelDraft(ctx, draft.id);

    await expect(
      glEngine.reverseJournal(ctx, {
        originalJournalId: draft.id,
        reason: 'Attempting to reverse cancelled draft'
      })
    ).rejects.toThrow(BusinessRuleViolationError);
  });

  it('6. Rejects reversal of non-existent journal ID', async () => {
    await expect(
      glEngine.reverseJournal(ctx, {
        originalJournalId: 'je_non_existent_9999',
        reason: 'Non-existent journal'
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('7. Supports request idempotency key for reversal operations', async () => {
    const key = 'rev_idem_key_001';

    const res1 = await glEngine.reverseJournal(ctx, {
      originalJournalId: postedJournalId,
      reason: 'Idempotent reversal',
      idempotencyKey: key
    });

    const res2 = await glEngine.reverseJournal(ctx, {
      originalJournalId: postedJournalId,
      reason: 'Idempotent reversal',
      idempotencyKey: key
    });

    expect(res2.id).toEqual(res1.id);
    expect(res2.voucherNumber).toEqual(res1.voucherNumber);
  });

  it('8. Enforces tenant and company boundary isolation on reversals', async () => {
    const otherCtx: RequestContext = {
      tenantId: 'tenant_other',
      companyId: 'company_other',
      user: { userId: 'user_other', roles: ['FINANCE_POSTER'], permissions: ['*'] }
    };

    await expect(
      glEngine.reverseJournal(otherCtx, {
        originalJournalId: postedJournalId,
        reason: 'Cross-tenant reversal attempt'
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('9. 100 concurrent reversal requests for the same journal create exactly 1 reversal entry', async () => {
    const promises = Array.from({ length: 100 }, async (_, i) => {
      try {
        const res = await glEngine.reverseJournal(ctx, {
          originalJournalId: postedJournalId,
          reason: `Concurrent reversal request ${i}`
        });
        return { status: 'fulfilled', value: res };
      } catch (err) {
        return { status: 'rejected', reason: err };
      }
    });

    const results = await Promise.all(promises);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(99);

    for (const r of rejected) {
      const err = (r as any).reason;
      expect(err instanceof BusinessRuleViolationError || err instanceof ConflictError).toBe(true);
    }
  });
});
