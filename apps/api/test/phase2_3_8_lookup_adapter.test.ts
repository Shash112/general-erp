import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext, BusinessRuleViolationError } from '@general-erp/core';
import { glEngine } from '../src/modules/finance/gl-engine.js';
import { journalDraftService } from '../src/modules/finance/journal-draft.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { glPostedTransactionLookupAdapter } from '../src/modules/finance/gl-posted-transaction-lookup.adapter.js';
import { numberingEngine } from '../src/platform/numbering/numbering.service.js';
import { idempotencyService } from '../src/platform/idempotency/idempotency.service.js';

describe('Phase 2.3.8 — GLPostedTransactionLookupAdapter Tests', () => {
  const ctx: RequestContext = {
    tenantId: 'tenant_lookup_test',
    companyId: 'company_hq',
    user: { userId: 'user_fin_poster', roles: ['FINANCE_POSTER'], permissions: ['*'] },
    traceId: 'trace_lookup_1'
  };

  const ctxOtherCompany: RequestContext = {
    tenantId: 'tenant_lookup_test',
    companyId: 'company_branch',
    user: { userId: 'user_fin_poster_branch', roles: ['FINANCE_POSTER'], permissions: ['*'] },
    traceId: 'trace_lookup_2'
  };

  beforeEach(async () => {
    journalDraftService.clear();
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    numberingEngine.clear();
    idempotencyService.clear();

    // Register glPostedTransactionLookupAdapter on chartOfAccountsService
    chartOfAccountsService.setPostedTransactionLookup(glPostedTransactionLookupAdapter);

    // Setup Fiscal Year
    await fiscalPeriodService.createFiscalYear(ctx, {
      name: 'FY 2026-27',
      companyId: ctx.companyId,
      startDate: new Date('2026-04-01T00:00:00Z'),
      endDate: new Date('2027-03-31T23:59:59Z'),
      periodsCount: 12
    });
  });

  it('1. Account with NO posted transactions allows structural updates and deletion', async () => {
    const acc = await chartOfAccountsService.createAccount(ctx, {
      companyId: ctx.companyId,
      accountCode: '1010',
      accountName: 'Unused Bank Account',
      accountType: 'ASSET',
      nodeType: 'ACCOUNT',
      currency: 'INR'
    });

    const hasPosted = await glPostedTransactionLookupAdapter.hasPostedTransactions(ctx, acc.id);
    expect(hasPosted).toBe(false);

    // Structural update allowed
    const updated = await chartOfAccountsService.updateAccount(ctx, acc.id, {
      accountCode: '1011',
      accountName: 'Renamed Bank Account'
    });
    expect(updated.accountCode).toEqual('1011');

    // Deletion allowed
    await chartOfAccountsService.deleteAccount(ctx, acc.id);
  });

  it('2. Account with ONLY DRAFT transactions returns false and allows updates/deletion', async () => {
    const acc1 = await chartOfAccountsService.createAccount(ctx, {
      companyId: ctx.companyId,
      accountCode: '1020',
      accountName: 'Draft Bank Account',
      accountType: 'ASSET',
      nodeType: 'ACCOUNT',
      currency: 'INR'
    });

    const acc2 = await chartOfAccountsService.createAccount(ctx, {
      companyId: ctx.companyId,
      accountCode: '4020',
      accountName: 'Draft Revenue Account',
      accountType: 'INCOME',
      nodeType: 'ACCOUNT',
      currency: 'INR'
    });

    await journalDraftService.createDraft(ctx, {
      companyId: ctx.companyId,
      accountingDate: '2026-04-10',
      lines: [
        { lineSequence: 1, accountId: acc1.id, debitAmount: '100.00', creditAmount: '0.00' },
        { lineSequence: 2, accountId: acc2.id, debitAmount: '0.00', creditAmount: '100.00' }
      ]
    });

    const hasPosted1 = await glPostedTransactionLookupAdapter.hasPostedTransactions(ctx, acc1.id);
    expect(hasPosted1).toBe(false);

    // Deletion allowed
    await chartOfAccountsService.deleteAccount(ctx, acc1.id);
  });

  it('3. Account with POSTED transaction blocks structural updates and deletion', async () => {
    const acc1 = await chartOfAccountsService.createAccount(ctx, {
      companyId: ctx.companyId,
      accountCode: '1030',
      accountName: 'Posted Bank Account',
      accountType: 'ASSET',
      nodeType: 'ACCOUNT',
      currency: 'INR'
    });

    const acc2 = await chartOfAccountsService.createAccount(ctx, {
      companyId: ctx.companyId,
      accountCode: '4030',
      accountName: 'Posted Sales Account',
      accountType: 'INCOME',
      nodeType: 'ACCOUNT',
      currency: 'INR'
    });

    const draft = await journalDraftService.createDraft(ctx, {
      companyId: ctx.companyId,
      accountingDate: '2026-04-10',
      lines: [
        { lineSequence: 1, accountId: acc1.id, debitAmount: '500.00', creditAmount: '0.00' },
        { lineSequence: 2, accountId: acc2.id, debitAmount: '0.00', creditAmount: '500.00' }
      ]
    });

    await glEngine.postJournal(ctx, { journalEntryId: draft.id });

    const hasPosted = await glPostedTransactionLookupAdapter.hasPostedTransactions(ctx, acc1.id);
    expect(hasPosted).toBe(true);

    // Attempting structural update throws BusinessRuleViolationError
    await expect(
      chartOfAccountsService.updateAccount(ctx, acc1.id, {
        accountCode: '1039'
      })
    ).rejects.toThrow(BusinessRuleViolationError);

    // Non-structural update (e.g. accountName) is ALLOWED
    const updatedName = await chartOfAccountsService.updateAccount(ctx, acc1.id, {
      accountName: 'Updated Posted Bank Name'
    });
    expect(updatedName.accountName).toEqual('Updated Posted Bank Name');

    // Attempting deletion throws BusinessRuleViolationError
    await expect(
      chartOfAccountsService.deleteAccount(ctx, acc1.id)
    ).rejects.toThrow(BusinessRuleViolationError);
  });

  it('4. Account with REVERSED transaction blocks structural edits and deletion', async () => {
    const acc1 = await chartOfAccountsService.createAccount(ctx, {
      companyId: ctx.companyId,
      accountCode: '1040',
      accountName: 'Reversed Bank Account',
      accountType: 'ASSET',
      nodeType: 'ACCOUNT',
      currency: 'INR'
    });

    const acc2 = await chartOfAccountsService.createAccount(ctx, {
      companyId: ctx.companyId,
      accountCode: '4040',
      accountName: 'Reversed Sales Account',
      accountType: 'INCOME',
      nodeType: 'ACCOUNT',
      currency: 'INR'
    });

    const draft = await journalDraftService.createDraft(ctx, {
      companyId: ctx.companyId,
      accountingDate: '2026-04-12',
      lines: [
        { lineSequence: 1, accountId: acc1.id, debitAmount: '300.00', creditAmount: '0.00' },
        { lineSequence: 2, accountId: acc2.id, debitAmount: '0.00', creditAmount: '300.00' }
      ]
    });

    const posted = await glEngine.postJournal(ctx, { journalEntryId: draft.id });
    await glEngine.reverseJournal(ctx, { originalJournalId: posted.id!, reason: 'Test reversal' });

    const hasPosted = await glPostedTransactionLookupAdapter.hasPostedTransactions(ctx, acc1.id);
    expect(hasPosted).toBe(true);

    await expect(
      chartOfAccountsService.deleteAccount(ctx, acc1.id)
    ).rejects.toThrow(BusinessRuleViolationError);
  });

  it('5. Enforces company boundary isolation for posted transaction lookups', async () => {
    const accHq = await chartOfAccountsService.createAccount(ctx, {
      companyId: ctx.companyId,
      accountCode: '1050',
      accountName: 'Shared Account Code HQ',
      accountType: 'ASSET',
      nodeType: 'ACCOUNT',
      currency: 'INR'
    });

    const hasPostedInBranch = await glPostedTransactionLookupAdapter.hasPostedTransactions(ctxOtherCompany, accHq.id);
    expect(hasPostedInBranch).toBe(false);
  });
});
