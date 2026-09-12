import { describe, it, expect, beforeEach } from 'vitest';
import { glEngine } from '../src/modules/finance/gl-engine.js';
import { journalDraftService, CreateDraftJournalInput } from '../src/modules/finance/journal-draft.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { numberingEngine } from '../src/platform/numbering/numbering.service.js';
import { idempotencyService } from '../src/platform/idempotency/idempotency.service.js';
import { RequestContext, ValidationError, NotFoundError, BusinessRuleViolationError, ConflictError } from '@general-erp/core';

describe('Phase 2.3.6 — Dual-Layer Idempotency & Source Contract Tests', () => {

  const ctxCompanyA: RequestContext = {
    requestId: 'req_p236_test_a',
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
    requestId: 'req_p236_test_a2',
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
    requestId: 'req_p236_test_b',
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
    idempotencyService.clear();

    // Configure Fiscal Year 2026 for Company HQ (April 1, 2026 to March 31, 2027)
    await fiscalPeriodService.createFiscalYear(ctxCompanyA, {
      companyId: 'company_hq',
      name: 'FY 2026-27',
      startDate: new Date('2026-04-01T00:00:00Z'),
      endDate: new Date('2027-03-31T23:59:59Z'),
      includeAdjustmentPeriod: true
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

  const buildValidDraftInput = (
    companyId = 'company_hq',
    sourceModule = 'MANUAL',
    sourceDocumentType: string | null = null,
    sourceDocumentId: string | null = null
  ): CreateDraftJournalInput => ({
    companyId,
    fiscalYearId: 'fy_dummy',
    fiscalPeriodId: 'fp_dummy',
    accountingDate: '2026-05-15',
    sourceModule,
    sourceDocumentType,
    sourceDocumentId,
    currency: 'INR',
    exchangeRate: '1.000000',
    narration: 'Test Journal for Dual-Layer Idempotency',
    lines: [
      {
        accountId: accBank?.id || 'acc_bank',
        lineSequence: 1,
        debitAmount: '2500.00',
        creditAmount: '0.00'
      },
      {
        accountId: accSales?.id || 'acc_sales',
        lineSequence: 2,
        debitAmount: '0.00',
        creditAmount: '2500.00'
      }
    ]
  });

  // --------------------------------------------------------------------------
  // 1. LAYER 1 — REQUEST IDEMPOTENCY
  // --------------------------------------------------------------------------

  it('1. First request with idempotencyKey succeeds and returns POSTED journal', async () => {
    const draft = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput());
    const posted = await glEngine.postJournal(ctxCompanyA, {
      journalEntryId: draft.id!,
      idempotencyKey: 'ik_req_001'
    });

    expect(posted.status).toBe('POSTED');
    expect(posted.voucherNumber).toBe('JV-2026-0001');
  });

  it('2. Same idempotencyKey with same payload returns cached result without second posting or new voucher', async () => {
    const draft = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput());
    const posted1 = await glEngine.postJournal(ctxCompanyA, {
      journalEntryId: draft.id!,
      idempotencyKey: 'ik_req_002'
    });

    expect(posted1.voucherNumber).toBe('JV-2026-0001');

    // Second request with exact same key & payload
    const posted2 = await glEngine.postJournal(ctxCompanyA, {
      journalEntryId: draft.id!,
      idempotencyKey: 'ik_req_002'
    });

    expect(posted2).toEqual(posted1);
    expect(posted2.voucherNumber).toBe('JV-2026-0001');
  });

  it('3. Same idempotencyKey with DIFFERENT request payload throws IDEMPOTENCY_KEY_REUSE_CONFLICT', async () => {
    const draft1 = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput());
    const draft2 = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput());

    await glEngine.postJournal(ctxCompanyA, {
      journalEntryId: draft1.id!,
      idempotencyKey: 'ik_req_reuse'
    });

    // Attempting to use ik_req_reuse for draft2 (different payload)
    await expect(
      glEngine.postJournal(ctxCompanyA, {
        journalEntryId: draft2.id!,
        idempotencyKey: 'ik_req_reuse'
      })
    ).rejects.toThrow(ConflictError);
  });

  it('4. Request idempotency key scope is tenant-isolated', async () => {
    const accBankB = await chartOfAccountsService.createAccount(ctxCompanyB, {
      companyId: 'company_other',
      accountCode: '1010',
      accountName: 'Bank B',
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

    const draftA = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput());
    const draftB = await journalDraftService.createDraft(ctxCompanyB, {
      ...buildValidDraftInput('company_other'),
      lines: [
        { accountId: accBankB.id, lineSequence: 1, debitAmount: '100.00', creditAmount: '0.00' },
        { accountId: accSalesB.id, lineSequence: 2, debitAmount: '0.00', creditAmount: '100.00' }
      ]
    });

    const postedA = await glEngine.postJournal(ctxCompanyA, { journalEntryId: draftA.id!, idempotencyKey: 'shared_key_100' });
    const postedB = await glEngine.postJournal(ctxCompanyB, { journalEntryId: draftB.id!, idempotencyKey: 'shared_key_100' });

    expect(postedA.voucherNumber).toBe('JV-2026-0001');
    expect(postedB.voucherNumber).toBe('JV-2026-0001');
  });

  it('5. Request idempotency key scope is company-isolated', async () => {
    const accBankA2 = await chartOfAccountsService.createAccount(ctxCompanyA2, {
      companyId: 'company_branch',
      accountCode: '1010',
      accountName: 'Branch Bank',
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

    const postedHQ = await glEngine.postJournal(ctxCompanyA, { journalEntryId: draftHQ.id!, idempotencyKey: 'company_key_10' });
    const postedBranch = await glEngine.postJournal(ctxCompanyA2, { journalEntryId: draftBranch.id!, idempotencyKey: 'company_key_10' });

    expect(postedHQ.voucherNumber).toBe('JV-2026-0001');
    expect(postedBranch.voucherNumber).toBe('JV-2026-0001');
  });

  it('6. 100 concurrent requests with the SAME idempotencyKey result in 1 execution and 100 identical cached responses', async () => {
    const draft = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput());

    const promises = Array.from({ length: 100 }, () =>
      glEngine.postJournal(ctxCompanyA, { journalEntryId: draft.id!, idempotencyKey: 'concurrent_ik_100' })
    );

    const results = await Promise.all(promises);
    expect(results).toHaveLength(100);

    const vouchers = results.map(r => r.voucherNumber);
    expect(new Set(vouchers).size).toBe(1);
    expect(vouchers[0]).toBe('JV-2026-0001');
  });

  // --------------------------------------------------------------------------
  // 2. LAYER 2 — BUSINESS SOURCE DOCUMENT IDEMPOTENCY
  // --------------------------------------------------------------------------

  it('7. Posting source document for the first time succeeds', async () => {
    const draft = await journalDraftService.createDraft(
      ctxCompanyA,
      buildValidDraftInput('company_hq', 'SALES', 'INVOICE', 'INV-2026-001')
    );
    const posted = await glEngine.postJournal(ctxCompanyA, draft.id!);

    expect(posted.status).toBe('POSTED');
    expect(posted.voucherNumber).toBe('JV-2026-0001');
  });

  it('8. Duplicate posting of the SAME source document (different draft, different request key) throws SOURCE_DOCUMENT_ALREADY_POSTED', async () => {
    const draft1 = await journalDraftService.createDraft(
      ctxCompanyA,
      buildValidDraftInput('company_hq', 'SALES', 'INVOICE', 'INV-2026-001')
    );
    await glEngine.postJournal(ctxCompanyA, { journalEntryId: draft1.id!, idempotencyKey: 'key_inv_1' });

    // Second draft entry referencing the SAME source document
    const draft2 = await journalDraftService.createDraft(
      ctxCompanyA,
      buildValidDraftInput('company_hq', 'SALES', 'INVOICE', 'INV-2026-001')
    );

    await expect(
      glEngine.postJournal(ctxCompanyA, { journalEntryId: draft2.id!, idempotencyKey: 'key_inv_2' })
    ).rejects.toThrow(BusinessRuleViolationError);
  });

  it('9. Layer 2 Business Source Document uniqueness check consumes 0 additional voucher numbers', async () => {
    const draft1 = await journalDraftService.createDraft(
      ctxCompanyA,
      buildValidDraftInput('company_hq', 'SALES', 'INVOICE', 'INV-2026-001')
    );
    await glEngine.postJournal(ctxCompanyA, draft1.id!); // Voucher JV-2026-0001

    const draft2 = await journalDraftService.createDraft(
      ctxCompanyA,
      buildValidDraftInput('company_hq', 'SALES', 'INVOICE', 'INV-2026-001')
    );
    await expect(glEngine.postJournal(ctxCompanyA, draft2.id!)).rejects.toThrow();

    // Next valid distinct source document posting receives JV-2026-0002 (no gap)
    const draft3 = await journalDraftService.createDraft(
      ctxCompanyA,
      buildValidDraftInput('company_hq', 'SALES', 'INVOICE', 'INV-2026-002')
    );
    const posted3 = await glEngine.postJournal(ctxCompanyA, draft3.id!);
    expect(posted3.voucherNumber).toBe('JV-2026-0002');
  });

  it('10. Source document uniqueness is tenant-isolated', async () => {
    const accBankB = await chartOfAccountsService.createAccount(ctxCompanyB, {
      companyId: 'company_other',
      accountCode: '1010',
      accountName: 'Bank B',
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

    const draftA = await journalDraftService.createDraft(
      ctxCompanyA,
      buildValidDraftInput('company_hq', 'SALES', 'INVOICE', 'INV-SHARED-001')
    );
    const draftB = await journalDraftService.createDraft(ctxCompanyB, {
      ...buildValidDraftInput('company_other', 'SALES', 'INVOICE', 'INV-SHARED-001'),
      lines: [
        { accountId: accBankB.id, lineSequence: 1, debitAmount: '100.00', creditAmount: '0.00' },
        { accountId: accSalesB.id, lineSequence: 2, debitAmount: '0.00', creditAmount: '100.00' }
      ]
    });

    const postedA = await glEngine.postJournal(ctxCompanyA, draftA.id!);
    const postedB = await glEngine.postJournal(ctxCompanyB, draftB.id!);

    expect(postedA.voucherNumber).toBe('JV-2026-0001');
    expect(postedB.voucherNumber).toBe('JV-2026-0001');
  });

  it('11. Source document uniqueness is company-isolated', async () => {
    const accBankA2 = await chartOfAccountsService.createAccount(ctxCompanyA2, {
      companyId: 'company_branch',
      accountCode: '1010',
      accountName: 'Branch Bank',
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

    const draftHQ = await journalDraftService.createDraft(
      ctxCompanyA,
      buildValidDraftInput('company_hq', 'PROCUREMENT', 'PO', 'PO-2026-888')
    );
    const draftBranch = await journalDraftService.createDraft(ctxCompanyA2, {
      ...buildValidDraftInput('company_branch', 'PROCUREMENT', 'PO', 'PO-2026-888'),
      lines: [
        { accountId: accBankA2.id, lineSequence: 1, debitAmount: '200.00', creditAmount: '0.00' },
        { accountId: accSalesA2.id, lineSequence: 2, debitAmount: '0.00', creditAmount: '200.00' }
      ]
    });

    const postedHQ = await glEngine.postJournal(ctxCompanyA, draftHQ.id!);
    const postedBranch = await glEngine.postJournal(ctxCompanyA2, draftBranch.id!);

    expect(postedHQ.voucherNumber).toBe('JV-2026-0001');
    expect(postedBranch.voucherNumber).toBe('JV-2026-0001');
  });

  it('12. Different source documents can post independently', async () => {
    const draft1 = await journalDraftService.createDraft(
      ctxCompanyA,
      buildValidDraftInput('company_hq', 'SALES', 'INVOICE', 'INV-100')
    );
    const draft2 = await journalDraftService.createDraft(
      ctxCompanyA,
      buildValidDraftInput('company_hq', 'SALES', 'INVOICE', 'INV-200')
    );
    const draft3 = await journalDraftService.createDraft(
      ctxCompanyA,
      buildValidDraftInput('company_hq', 'PAYROLL', 'RUN', 'PAY-2026-05')
    );

    const posted1 = await glEngine.postJournal(ctxCompanyA, draft1.id!);
    const posted2 = await glEngine.postJournal(ctxCompanyA, draft2.id!);
    const posted3 = await glEngine.postJournal(ctxCompanyA, draft3.id!);

    expect(posted1.voucherNumber).toBe('JV-2026-0001');
    expect(posted2.voucherNumber).toBe('JV-2026-0002');
    expect(posted3.voucherNumber).toBe('JV-2026-0003');
  });

  // --------------------------------------------------------------------------
  // 3. TRANSACTION ROLLBACK & FAILURE SEMANTICS
  // --------------------------------------------------------------------------

  it('13. Failed posting transaction does NOT permanently claim idempotency key or source document', async () => {
    // Input for closed period (will fail during fiscal period validation)
    const failDraftInput = buildValidDraftInput('company_hq', 'SALES', 'INVOICE', 'INV-FAIL-01');
    failDraftInput.accountingDate = '2020-01-01'; // Closed period date

    const draft = await journalDraftService.createDraft(ctxCompanyA, failDraftInput);

    await expect(
      glEngine.postJournal(ctxCompanyA, { journalEntryId: draft.id!, idempotencyKey: 'ik_fail_key' })
    ).rejects.toThrow();

    // Verify key was NOT stored as completed
    const record = await idempotencyService.getRecord(ctxCompanyA, 'ik_fail_key');
    expect(record).toBeUndefined();

    // Correct accounting date and retry posting
    const updatedDraft = await journalDraftService.updateDraft(ctxCompanyA, draft.id!, {
      accountingDate: '2026-05-15'
    });

    const retriedPosted = await glEngine.postJournal(ctxCompanyA, {
      journalEntryId: updatedDraft.id!,
      idempotencyKey: 'ik_fail_key'
    });

    expect(retriedPosted.status).toBe('POSTED');
    expect(retriedPosted.voucherNumber).toBe('JV-2026-0001');
  });

  // --------------------------------------------------------------------------
  // 4. CONCURRENCY & STRESS TESTS
  // --------------------------------------------------------------------------

  it('14. 100 concurrent requests with DIFFERENT request keys targeting the SAME source document result in 1 success and 99 rejections', async () => {
    // Create 100 independent draft entries with the SAME source document ID
    const drafts = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        journalDraftService.createDraft(
          ctxCompanyA,
          buildValidDraftInput('company_hq', 'EXPENSE', 'CLAIM', 'EXP-2026-SAME')
        )
      )
    );

    const attempts = drafts.map(async (d, i) => {
      try {
        const val = await glEngine.postJournal(ctxCompanyA, { journalEntryId: d.id!, idempotencyKey: `ik_unique_key_${i}` });
        return { status: 'fulfilled' as const, value: val };
      } catch (err) {
        return { status: 'rejected' as const, reason: err };
      }
    });

    const results = await Promise.all(attempts);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(99);

    const successfulPost = (fulfilled[0] as any).value;
    expect(successfulPost.status).toBe('POSTED');
    expect(successfulPost.voucherNumber).toBe('JV-2026-0001');
  });

  it('15. Stress test: Mixed concurrent postings with duplicate keys, duplicate sources, and unique sources', async () => {
    const draftUnique1 = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput('company_hq', 'SALES', 'INV', 'INV-STRESS-1'));
    const draftUnique2 = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput('company_hq', 'SALES', 'INV', 'INV-STRESS-2'));
    const draftDupSource = await journalDraftService.createDraft(ctxCompanyA, buildValidDraftInput('company_hq', 'SALES', 'INV', 'INV-STRESS-1'));

    const postSafe = async (input: any) => {
      try {
        const val = await glEngine.postJournal(ctxCompanyA, input);
        return { status: 'fulfilled' as const, value: val };
      } catch (err) {
        return { status: 'rejected' as const, reason: err };
      }
    };

    const p0 = postSafe({ journalEntryId: draftUnique1.id!, idempotencyKey: 'ik_stress_1' });
    const p1 = postSafe({ journalEntryId: draftUnique1.id!, idempotencyKey: 'ik_stress_1' });
    const p2 = postSafe({ journalEntryId: draftUnique2.id!, idempotencyKey: 'ik_stress_2' });
    const p3 = postSafe({ journalEntryId: draftDupSource.id!, idempotencyKey: 'ik_stress_3' });

    const results = await Promise.all([p0, p1, p2, p3]);

    expect(results[0]!.status).toBe('fulfilled');
    expect(results[1]!.status).toBe('fulfilled');
    expect(results[2]!.status).toBe('fulfilled');
    expect(results[3]!.status).toBe('rejected'); // Layer 2 rejection

    const val0 = (results[0] as any).value;
    const val1 = (results[1] as any).value;

    expect(val0).toEqual(val1);
  });

  // --------------------------------------------------------------------------
  // 5. POSTED IMMUTABILITY & SECURITY
  // --------------------------------------------------------------------------

  it('16. Posted source metadata is immutable and protected against update mutation', async () => {
    const draft = await journalDraftService.createDraft(
      ctxCompanyA,
      buildValidDraftInput('company_hq', 'SALES', 'INVOICE', 'INV-PROTECTED-001')
    );
    const posted = await glEngine.postJournal(ctxCompanyA, draft.id!);

    expect(posted.status).toBe('POSTED');

    await expect(
      journalDraftService.updateDraft(ctxCompanyA, draft.id!, {
        sourceDocumentId: 'INV-MUTATED-999'
      })
    ).rejects.toThrow(BusinessRuleViolationError);
  });

});
