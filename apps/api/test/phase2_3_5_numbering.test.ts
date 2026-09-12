import { describe, it, expect, beforeEach } from 'vitest';
import { glEngine } from '../src/modules/finance/gl-engine.js';
import { journalDraftService, CreateDraftJournalInput } from '../src/modules/finance/journal-draft.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { numberingEngine } from '../src/platform/numbering/numbering.service.js';
import { RequestContext, ValidationError, NotFoundError, BusinessRuleViolationError, ConflictError } from '@general-erp/core';
import { createDatabaseClient } from '@general-erp/database';

describe('Phase 2.3.5 — Numbering Engine Integration Tests', () => {

  const ctxCompanyA: RequestContext = {
    requestId: 'req_p235_test_a',
    tenantId: 'tenant_acme',
    companyId: 'company_hq',
    ip: '127.0.0.1',
    userAgent: 'vitest-agent',
    timestamp: new Date(),
    user: {
      userId: 'user_fin_poster',
      email: 'poster@acme.com',
      tenantId: 'tenant_acme',
      companyId: 'company_hq',
      roles: ['finance_manager'],
      permissions: ['*']
    }
  };

  const ctxCompanyA2: RequestContext = {
    requestId: 'req_p235_test_a2',
    tenantId: 'tenant_acme',
    companyId: 'company_branch',
    ip: '127.0.0.1',
    userAgent: 'vitest-agent',
    timestamp: new Date(),
    user: {
      userId: 'user_fin_poster_a2',
      email: 'poster2@acme.com',
      tenantId: 'tenant_acme',
      companyId: 'company_branch',
      roles: ['finance_manager'],
      permissions: ['*']
    }
  };

  const ctxCompanyB: RequestContext = {
    requestId: 'req_p235_test_b',
    tenantId: 'tenant_other',
    companyId: 'company_other',
    ip: '127.0.0.1',
    userAgent: 'vitest-agent',
    timestamp: new Date(),
    user: {
      userId: 'user_other',
      email: 'user@other.com',
      tenantId: 'tenant_other',
      companyId: 'company_other',
      roles: ['finance_user'],
      permissions: ['*']
    }
  };

  let accBank: any;
  let accSales: any;

  beforeEach(async () => {
    journalDraftService.clear();
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    numberingEngine.clear();

    // Configure Fiscal Year 2026 for Company HQ (April 1, 2026 to March 31, 2027)
    await fiscalPeriodService.createFiscalYear(ctxCompanyA, {
      companyId: 'company_hq',
      name: 'FY 2026-27',
      startDate: new Date('2026-04-01T00:00:00Z'),
      endDate: new Date('2027-03-31T23:59:59Z'),
      includeAdjustmentPeriod: true
    });

    // Configure Fiscal Year 2025 for Company HQ (April 1, 2025 to March 31, 2026)
    await fiscalPeriodService.createFiscalYear(ctxCompanyA, {
      companyId: 'company_hq',
      name: 'FY 2025-26',
      startDate: new Date('2025-04-01T00:00:00Z'),
      endDate: new Date('2026-03-31T23:59:59Z'),
      includeAdjustmentPeriod: false
    });

    // Configure Fiscal Year for Company Branch
    await fiscalPeriodService.createFiscalYear(ctxCompanyA2, {
      companyId: 'company_branch',
      name: 'FY 2026-27',
      startDate: new Date('2026-04-01T00:00:00Z'),
      endDate: new Date('2027-03-31T23:59:59Z'),
      includeAdjustmentPeriod: true
    });

    // Configure Fiscal Year for Tenant B Company Other
    await fiscalPeriodService.createFiscalYear(ctxCompanyB, {
      companyId: 'company_other',
      name: 'FY 2026-27',
      startDate: new Date('2026-04-01T00:00:00Z'),
      endDate: new Date('2027-03-31T23:59:59Z'),
      includeAdjustmentPeriod: true
    });

    // Seed Active Postable Accounts for Company HQ
    accBank = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId: 'company_hq',
      accountCode: '1010',
      accountName: 'Bank Account',
      accountType: 'ASSET',
      nodeType: 'ACCOUNT'
    });

    accSales = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId: 'company_hq',
      accountCode: '4010',
      accountName: 'Sales Revenue',
      accountType: 'INCOME',
      nodeType: 'ACCOUNT'
    });
  });

  const buildValidDraftInput = (companyId = 'company_hq', acctDate = '2026-05-15'): CreateDraftJournalInput => ({
    companyId,
    fiscalYearId: 'fy_dummy',
    fiscalPeriodId: 'fp_dummy',
    accountingDate: acctDate,
    sourceModule: 'MANUAL',
    currency: 'INR',
    exchangeRate: '1.000000',
    narration: 'Test Journal for Numbering Engine',
    lines: [
      {
        accountId: accBank?.id || 'acc_bank',
        lineSequence: 1,
        debitAmount: '5000.00',
        creditAmount: '0.00'
      },
      {
        accountId: accSales?.id || 'acc_sales',
        lineSequence: 2,
        debitAmount: '0.00',
        creditAmount: '5000.00'
      }
    ]
  });

  // --------------------------------------------------------------------------
  // 1. BASIC DRAFT LIFECYCLE NUMBERING INVARIANTS
  // --------------------------------------------------------------------------

  it('1. createDraft does NOT allocate or consume voucher numbers', async () => {
    const draft = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput());
    expect(draft.status).toBe('DRAFT');
    expect(draft.voucherNumber).toBeNull();
  });

  it('2. updateDraft does NOT allocate or consume voucher numbers', async () => {
    const draft = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput());
    expect(draft.voucherNumber).toBeNull();

    const updated = await journalDraftService.updateDraft(ctxCompanyA, draft.id!, {
      narration: 'Updated narration without numbering impact'
    });
    expect(updated.status).toBe('DRAFT');
    expect(updated.voucherNumber).toBeNull();
  });

  it('3. cancelDraft does NOT allocate or consume voucher numbers', async () => {
    const draft = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput());
    expect(draft.voucherNumber).toBeNull();

    const cancelled = await journalDraftService.cancelDraft(ctxCompanyA, draft.id!);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.voucherNumber).toBeNull();
  });

  it('4. Draft creation, update, and cancellation leave sequence counter at 0', async () => {
    const draft1 = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput());
    await journalDraftService.updateDraft(ctxCompanyA, draft1.id!, { narration: 'Modified 1' });

    const draft2 = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput());
    await journalDraftService.cancelDraft(ctxCompanyA, draft2.id!);

    // Now post draft1 -> sequence allocated should be 1 ('JV-2026-0001')
    const posted = await glEngine.postJournal(ctxCompanyA, draft1.id!);
    expect(posted.status).toBe('POSTED');
    expect(posted.voucherNumber).toBe('JV-2026-0001');
  });

  // --------------------------------------------------------------------------
  // 2. SUCCESSFUL POSTING & SEQUENTIAL ALLOCATION
  // --------------------------------------------------------------------------

  it('5. Successful posting allocates voucher number transactionally (JV-2026-0001, 0002, 0003)', async () => {
    const draft1 = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput());
    const draft2 = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput());
    const draft3 = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput());

    const posted1 = await glEngine.postJournal(ctxCompanyA, draft1.id!);
    const posted2 = await glEngine.postJournal(ctxCompanyA, draft2.id!);
    const posted3 = await glEngine.postJournal(ctxCompanyA, draft3.id!);

    expect(posted1.voucherNumber).toBe('JV-2026-0001');
    expect(posted2.voucherNumber).toBe('JV-2026-0002');
    expect(posted3.voucherNumber).toBe('JV-2026-0003');
  });

  it('6. Allocated voucher number is persisted on returned posted DTO', async () => {
    const draft = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput());
    const posted = await glEngine.postJournal(ctxCompanyA, draft.id!);

    expect(posted.voucherNumber).toBe('JV-2026-0001');
    expect(posted.status).toBe('POSTED');
    expect(posted.postedBy).toBe('user_fin_poster');
    expect(posted.postedAt).toBeInstanceOf(Date);
  });

  // --------------------------------------------------------------------------
  // 3. FAILURE AND ROLLBACK INVARIANT
  // --------------------------------------------------------------------------

  it('7. Failed posting due to closed period does NOT permanently consume sequence counter', async () => {
    // Attempt posting for closed period date (outside FY 2026-27 or in closed FY)
    const closedDateInput = buildValidDraftInput('company_hq', '2020-01-01'); // No open period
    const draft = await journalDraftService.createDraft(ctxCompanyA, closedDateInput);

    await expect(glEngine.postJournal(ctxCompanyA, draft.id!)).rejects.toThrow();

    // Draft remains DRAFT and voucher is null
    const retrievedDraft = await journalDraftService.getDraftById(ctxCompanyA, draft.id!);
    expect(retrievedDraft.status).toBe('DRAFT');
    expect(retrievedDraft.voucherNumber).toBeNull();

    // Valid posting should receive JV-2026-0001 (sequence did not skip to 0002)
    const validDraft = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput());
    const posted = await glEngine.postJournal(ctxCompanyA, validDraft.id!);
    expect(posted.voucherNumber).toBe('JV-2026-0001');
  });

  // --------------------------------------------------------------------------
  // 4. CONCURRENCY TESTS
  // --------------------------------------------------------------------------

  it('8. 100 concurrent successful postings yield 100 unique non-colliding vouchers', async () => {
    const count = 100;
    const drafts = await Promise.all(
      Array.from({ length: count }, () => journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput()))
    );

    const postPromises = drafts.map(d => glEngine.postJournal(ctxCompanyA, d.id!));
    const results = await Promise.all(postPromises);

    expect(results).toHaveLength(count);

    const vouchers = results.map(r => r.voucherNumber);
    const uniqueVouchers = new Set(vouchers);

    expect(uniqueVouchers.size).toBe(count);
    expect(vouchers).toContain('JV-2026-0001');
    expect(vouchers).toContain('JV-2026-0100');
  });

  it('9. Concurrent postings of the SAME draft result in exactly 1 success and 9 rejections', async () => {
    const draft = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput());

    const attempts = Array.from({ length: 10 }, () => glEngine.postJournal(ctxCompanyA, draft.id!));
    const results = await Promise.allSettled(attempts);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(9);

    const successfulPost = (fulfilled[0] as PromiseFulfilledResult<any>).value;
    expect(successfulPost.status).toBe('POSTED');
    expect(successfulPost.voucherNumber).toBe('JV-2026-0001');
  });

  // --------------------------------------------------------------------------
  // 5. TENANT, COMPANY, FISCAL YEAR & BRANCH ISOLATION
  // --------------------------------------------------------------------------

  it('10. Multi-tenant isolation: Tenant A and Tenant B numbering sequences operate independently', async () => {
    // Setup Account for Tenant B
    const accBankB = await chartOfAccountsService.createAccount(ctxCompanyB, {
      companyId: 'company_other',
      accountCode: '1010',
      accountName: 'Bank Account B',
      accountType: 'ASSET',
      nodeType: 'ACCOUNT'
    });
    const accSalesB = await chartOfAccountsService.createAccount(ctxCompanyB, {
      companyId: 'company_other',
      accountCode: '4010',
      accountName: 'Sales B',
      accountType: 'INCOME',
      nodeType: 'ACCOUNT'
    });

    const draftInputB: CreateDraftJournalInput = {
      companyId: 'company_other',
      fiscalYearId: 'fy_b',
      fiscalPeriodId: 'fp_b',
      accountingDate: '2026-05-15',
      currency: 'INR',
      exchangeRate: '1.000000',
      lines: [
        { accountId: accBankB.id, lineSequence: 1, debitAmount: '100.00', creditAmount: '0.00' },
        { accountId: accSalesB.id, lineSequence: 2, debitAmount: '0.00', creditAmount: '100.00' }
      ]
    };

    const draftA = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput());
    const draftB = await journalDraftService.createDraft(ctxCompanyB, draftInputB);

    const postedA = await glEngine.postJournal(ctxCompanyA, draftA.id!);
    const postedB = await glEngine.postJournal(ctxCompanyB, draftB.id!);

    expect(postedA.voucherNumber).toBe('JV-2026-0001');
    expect(postedB.voucherNumber).toBe('JV-2026-0001'); // Tenant B independent sequence
  });

  it('11. Multi-company isolation: Company HQ and Company Branch numbering sequences operate independently', async () => {
    const accBankA2 = await chartOfAccountsService.createAccount(ctxCompanyA2, {
      companyId: 'company_branch',
      accountCode: '1010',
      accountName: 'Branch Bank Account',
      accountType: 'ASSET',
      nodeType: 'ACCOUNT'
    });
    const accSalesA2 = await chartOfAccountsService.createAccount(ctxCompanyA2, {
      companyId: 'company_branch',
      accountCode: '4010',
      accountName: 'Branch Sales',
      accountType: 'INCOME',
      nodeType: 'ACCOUNT'
    });

    const draftHQ = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput('company_hq'));
    const draftBranch = await journalDraftService.createDraft(ctxCompanyA2, {
      ...buildValidDraftInput('company_branch'),
      lines: [
        { accountId: accBankA2.id, lineSequence: 1, debitAmount: '200.00', creditAmount: '0.00' },
        { accountId: accSalesA2.id, lineSequence: 2, debitAmount: '0.00', creditAmount: '200.00' }
      ]
    });

    const postedHQ = await glEngine.postJournal(ctxCompanyA, draftHQ.id!);
    const postedBranch = await glEngine.postJournal(ctxCompanyA2, draftBranch.id!);

    expect(postedHQ.voucherNumber).toBe('JV-2026-0001');
    expect(postedBranch.voucherNumber).toBe('JV-2026-0001'); // Company Branch independent sequence
  });

  it('12. Fiscal year sequence isolation: 2025 and 2026 use independent sequences', async () => {
    const draft2025 = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput('company_hq', '2025-06-15'));
    const draft2026 = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput('company_hq', '2026-06-15'));

    const posted2025 = await glEngine.postJournal(ctxCompanyA, draft2025.id!);
    const posted2026 = await glEngine.postJournal(ctxCompanyA, draft2026.id!);

    expect(posted2025.voucherNumber).toBe('JV-2025-0001');
    expect(posted2026.voucherNumber).toBe('JV-2026-0001');
  });

  it('13. Branch context isolation: BLR and MUM branches receive distinct sequence numbers', async () => {
    const draftBlrInput = buildValidDraftInput();
    draftBlrInput.lines[0]!.branchId = 'BLR';

    const draftMumInput = buildValidDraftInput();
    draftMumInput.lines[0]!.branchId = 'MUM';

    const draftBlr = await journalDraftService.createDraft(ctxCompanyA, draftBlrInput);
    const draftMum = await journalDraftService.createDraft(ctxCompanyA, draftMumInput);

    const postedBlr = await glEngine.postJournal(ctxCompanyA, draftBlr.id!);
    const postedMum = await glEngine.postJournal(ctxCompanyA, draftMum.id!);

    expect(postedBlr.voucherNumber).toBe('JV-2026-BLR-0001');
    expect(postedMum.voucherNumber).toBe('JV-2026-MUM-0001');
  });

  // --------------------------------------------------------------------------
  // 6. POSTED IMMUTABILITY & SECURITY BOUNDARIES
  // --------------------------------------------------------------------------

  it('14. Posted entry voucher number is strictly immutable and cannot be updated', async () => {
    const draft = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput());
    const posted = await glEngine.postJournal(ctxCompanyA, draft.id!);

    expect(posted.voucherNumber).toBe('JV-2026-0001');

    await expect(
      journalDraftService.updateDraft(ctxCompanyA, draft.id!, { narration: 'Illegal Update' })
    ).rejects.toThrow(BusinessRuleViolationError);
  });

  it('15. Posted entry cannot be cancelled', async () => {
    const draft = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput());
    const posted = await glEngine.postJournal(ctxCompanyA, draft.id!);

    expect(posted.voucherNumber).toBe('JV-2026-0001');

    await expect(
      journalDraftService.cancelDraft(ctxCompanyA, draft.id!)
    ).rejects.toThrow(BusinessRuleViolationError);
  });

  it('16. Client cannot post another tenant or company draft to hijack numbering sequence', async () => {
    const draftB = await journalDraftService.createDraft(ctxCompanyB, {
      companyId: 'company_other',
      fiscalYearId: 'fy_b',
      fiscalPeriodId: 'fp_b',
      accountingDate: '2026-05-15',
      lines: [
        { accountId: 'acc_dummy1', lineSequence: 1, debitAmount: '100.00', creditAmount: '0.00' },
        { accountId: 'acc_dummy2', lineSequence: 2, debitAmount: '0.00', creditAmount: '100.00' }
      ]
    });

    // Tenant A attempts to post Tenant B's draft
    await expect(glEngine.postJournal(ctxCompanyA, draftB.id!)).rejects.toThrow(NotFoundError);
  });

});
