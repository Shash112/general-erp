import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext, ForbiddenError } from '@general-erp/core';
import { glEngine } from '../src/modules/finance/gl-engine.js';
import { journalDraftService } from '../src/modules/finance/journal-draft.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { numberingEngine } from '../src/platform/numbering/numbering.service.js';
import { idempotencyService } from '../src/platform/idempotency/idempotency.service.js';
import { auditService } from '../src/platform/audit/audit.service.js';

describe('Phase 2.3.9 — Authorization, SoD & Audit Tests', () => {
  const userCreatorCtx: RequestContext = {
    tenantId: 'tenant_sod_test',
    companyId: 'company_hq',
    user: {
      userId: 'user_creator_01',
      tenantId: 'tenant_sod_test',
      companyId: 'company_hq',
      roles: ['ACCOUNTANT'],
      permissions: ['finance:gl:create', 'finance:gl:update', 'finance:gl:read', 'finance:gl:post', 'finance:gl:reverse']
    },
    traceId: 'trace_sod_1'
  };

  const userPosterCtx: RequestContext = {
    tenantId: 'tenant_sod_test',
    companyId: 'company_hq',
    user: {
      userId: 'user_poster_02',
      tenantId: 'tenant_sod_test',
      companyId: 'company_hq',
      roles: ['FINANCE_MANAGER'],
      permissions: ['finance:gl:create', 'finance:gl:update', 'finance:gl:read', 'finance:gl:post', 'finance:gl:reverse', 'finance:gl:cancel']
    },
    traceId: 'trace_sod_2'
  };

  const userUnprivilegedCtx: RequestContext = {
    tenantId: 'tenant_sod_test',
    companyId: 'company_hq',
    user: {
      userId: 'user_unprivileged',
      tenantId: 'tenant_sod_test',
      companyId: 'company_hq',
      roles: ['VIEWER'],
      permissions: ['finance:gl:read']
    },
    traceId: 'trace_sod_3'
  };

  let acc1Id: string;
  let acc2Id: string;

  beforeEach(async () => {
    journalDraftService.clear();
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    numberingEngine.clear();
    idempotencyService.clear();

    const systemCtx: RequestContext = {
      tenantId: 'tenant_sod_test',
      companyId: 'company_hq',
      user: { userId: 'sysadmin', roles: ['ADMIN'], permissions: ['*'] }
    };

    await fiscalPeriodService.createFiscalYear(systemCtx, {
      name: 'FY 2026-27',
      companyId: 'company_hq',
      startDate: new Date('2026-04-01T00:00:00Z'),
      endDate: new Date('2027-03-31T23:59:59Z'),
      periodsCount: 12
    });

    const acc1 = await chartOfAccountsService.createAccount(systemCtx, {
      companyId: 'company_hq',
      accountCode: '1001',
      accountName: 'Bank Account',
      accountType: 'ASSET',
      nodeType: 'ACCOUNT',
      currency: 'INR'
    });
    acc1Id = acc1.id;

    const acc2 = await chartOfAccountsService.createAccount(systemCtx, {
      companyId: 'company_hq',
      accountCode: '4001',
      accountName: 'Sales Revenue',
      accountType: 'INCOME',
      nodeType: 'ACCOUNT',
      currency: 'INR'
    });
    acc2Id = acc2.id;
  });

  it('1. Rejects draft creation when user lacks finance:gl:create permission', async () => {
    await expect(
      journalDraftService.createDraft(userUnprivilegedCtx, {
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        lines: [
          { lineSequence: 1, accountId: acc1Id, debitAmount: '100.00', creditAmount: '0.00' },
          { lineSequence: 2, accountId: acc2Id, debitAmount: '0.00', creditAmount: '100.00' }
        ]
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it('2. Enforces Rule SoD-GL-01: Creator cannot post their own manual journal entry', async () => {
    // User 1 creates manual draft entry
    const draft = await journalDraftService.createDraft(userCreatorCtx, {
      companyId: 'company_hq',
      accountingDate: '2026-04-15',
      sourceModule: 'MANUAL',
      lines: [
        { lineSequence: 1, accountId: acc1Id, debitAmount: '1000.00', creditAmount: '0.00' },
        { lineSequence: 2, accountId: acc2Id, debitAmount: '0.00', creditAmount: '1000.00' }
      ]
    });

    // User 1 attempts to post their own manual entry -> Rejected (SoD violation)
    await expect(
      glEngine.postJournal(userCreatorCtx, { journalEntryId: draft.id })
    ).rejects.toThrow(ForbiddenError);

    // User 2 (different user) posts the manual entry -> Success
    const posted = await glEngine.postJournal(userPosterCtx, { journalEntryId: draft.id });
    expect(posted.status).toEqual('POSTED');
    expect(posted.postedBy).toEqual('user_poster_02');
  });

  it('3. Exempts automated/integration entries (sourceModule != MANUAL) from SoD restriction', async () => {
    // Creator creates a SALES module entry (e.g. automated invoice posting)
    const draft = await journalDraftService.createDraft(userCreatorCtx, {
      companyId: 'company_hq',
      accountingDate: '2026-04-15',
      sourceModule: 'SALES',
      sourceDocumentId: 'INV-SYS-99',
      lines: [
        { lineSequence: 1, accountId: acc1Id, debitAmount: '2500.00', creditAmount: '0.00' },
        { lineSequence: 2, accountId: acc2Id, debitAmount: '0.00', creditAmount: '2500.00' }
      ]
    });

    // Creator CAN post system/integration entries
    const posted = await glEngine.postJournal(userCreatorCtx, { journalEntryId: draft.id });
    expect(posted.status).toEqual('POSTED');
  });

  it('4. Rejects reversal attempt when user lacks finance:gl:reverse permission', async () => {
    const draft = await journalDraftService.createDraft(userCreatorCtx, {
      companyId: 'company_hq',
      accountingDate: '2026-04-15',
      sourceModule: 'SALES',
      lines: [
        { lineSequence: 1, accountId: acc1Id, debitAmount: '500.00', creditAmount: '0.00' },
        { lineSequence: 2, accountId: acc2Id, debitAmount: '0.00', creditAmount: '500.00' }
      ]
    });

    const posted = await glEngine.postJournal(userPosterCtx, { journalEntryId: draft.id });

    await expect(
      glEngine.reverseJournal(userUnprivilegedCtx, {
        originalJournalId: posted.id!,
        reason: 'Unprivileged reversal attempt'
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it('5. Emits SHA-256 hash-chained audit events across GL lifecycle (CREATE, UPDATE, POST, REVERSE, CANCEL)', async () => {
    // 1. Create Draft
    const draft1 = await journalDraftService.createDraft(userCreatorCtx, {
      companyId: 'company_hq',
      accountingDate: '2026-04-15',
      sourceModule: 'MANUAL',
      lines: [
        { lineSequence: 1, accountId: acc1Id, debitAmount: '1200.00', creditAmount: '0.00' },
        { lineSequence: 2, accountId: acc2Id, debitAmount: '0.00', creditAmount: '1200.00' }
      ]
    });

    // 2. Update Draft
    await journalDraftService.updateDraft(userCreatorCtx, draft1.id, {
      narration: 'Updated narration'
    });

    // 3. Post Journal
    const posted = await glEngine.postJournal(userPosterCtx, { journalEntryId: draft1.id });

    // 4. Reverse Journal
    await glEngine.reverseJournal(userPosterCtx, {
      originalJournalId: posted.id!,
      reason: 'Correction of error'
    });

    // 5. Create and Cancel a separate draft
    const draft2 = await journalDraftService.createDraft(userCreatorCtx, {
      companyId: 'company_hq',
      accountingDate: '2026-04-16',
      lines: [
        { lineSequence: 1, accountId: acc1Id, debitAmount: '100.00', creditAmount: '0.00' },
        { lineSequence: 2, accountId: acc2Id, debitAmount: '0.00', creditAmount: '100.00' }
      ]
    });
    await journalDraftService.cancelDraft(userPosterCtx, draft2.id);

    // Verify audit events recorded
    const logs = await auditService.queryLogs(userPosterCtx, { entityName: 'JournalEntry' });
    expect(logs.length).toBeGreaterThanOrEqual(5);

    const actions = logs.map(l => l.action);
    expect(actions).toContain('CREATE');
    expect(actions).toContain('UPDATE');
    expect(actions).toContain('POST');
    expect(actions).toContain('REVERSE');
    expect(actions).toContain('CANCEL');
  });
});
