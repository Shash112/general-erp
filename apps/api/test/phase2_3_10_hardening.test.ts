import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { journalDraftService } from '../src/modules/finance/journal-draft.service.js';
import { glEngine } from '../src/modules/finance/gl-engine.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { RequestContext, ValidationError, BusinessRuleViolationError } from '@general-erp/core';

describe('Phase 2.3.10 — REST API & Final Hardening Tests', () => {
  let app: ReturnType<typeof buildApp>;
  let accBankId: string;
  let accSalesId: string;

  const ctx: RequestContext = {
    requestId: 'req_hardening_test',
    tenantId: 'tenant_acme',
    companyId: 'company_hq',
    ip: '127.0.0.1',
    userAgent: 'vitest-agent',
    timestamp: new Date(),
    user: {
      userId: 'user_fin_admin',
      email: 'admin@acme.com',
      tenantId: 'tenant_acme',
      companyId: 'company_hq',
      roles: ['finance_admin'],
      permissions: ['*']
    }
  };

  beforeEach(async () => {
    app = buildApp();
    journalDraftService.clear();
    chartOfAccountsService.clear();
    fiscalPeriodService.clear();

    // Setup fiscal period & accounts
    await fiscalPeriodService.createFiscalYear(ctx, {
      companyId: 'company_hq',
      name: 'FY 2026-27',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2027-03-31')
    });

    const accBank = await chartOfAccountsService.createAccount(ctx, {
      companyId: 'company_hq',
      accountCode: '1010',
      accountName: 'Bank Account',
      nodeType: 'ACCOUNT',
      accountType: 'ASSET'
    });
    accBankId = accBank.id;

    const accSales = await chartOfAccountsService.createAccount(ctx, {
      companyId: 'company_hq',
      accountCode: '4010',
      accountName: 'Sales Revenue',
      nodeType: 'ACCOUNT',
      accountType: 'INCOME'
    });
    accSalesId = accSales.id;
  });

  // 1. Fastify REST API Route Testing
  describe('Fastify REST API Routes (/api/v1/finance/gl/*)', () => {
    it('creates draft, updates, posts, reverses, and queries via Fastify HTTP endpoints', async () => {
      // 1. Create Draft Journal
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/gl/drafts',
        headers: {
          'x-tenant-id': 'tenant_acme',
          'x-company-id': 'company_hq',
          'x-user-id': 'user_fin_admin',
          'x-user-permissions': '*'
        },
        payload: {
          companyId: 'company_hq',
          fiscalYearId: 'fy_2026_27',
          fiscalPeriodId: 'fp_2026_04',
          accountingDate: '2026-04-15',
          narration: 'Fastify API draft test',
          lines: [
            { accountId: accBankId, lineSequence: 1, debitAmount: '1000.00', creditAmount: '0.00' },
            { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '1000.00' }
          ]
        }
      });

      expect(createRes.statusCode).toBe(201);
      const draftData = JSON.parse(createRes.payload).data;
      expect(draftData.id).toBeDefined();
      expect(draftData.status).toBe('DRAFT');
      expect(draftData.totalDebit).toBe('1000.00');

      const draftId = draftData.id;

      // 2. Get Draft By ID
      const getDraftRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/gl/drafts/${draftId}`,
        headers: {
          'x-tenant-id': 'tenant_acme',
          'x-company-id': 'company_hq'
        }
      });
      expect(getDraftRes.statusCode).toBe(200);
      expect(JSON.parse(getDraftRes.payload).data.id).toBe(draftId);

      // 3. Update Draft
      const updateRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/finance/gl/drafts/${draftId}`,
        headers: {
          'x-tenant-id': 'tenant_acme',
          'x-company-id': 'company_hq'
        },
        payload: {
          narration: 'Updated narration via API'
        }
      });
      expect(updateRes.statusCode).toBe(200);
      expect(JSON.parse(updateRes.payload).data.narration).toBe('Updated narration via API');

      // 4. Post Journal Entry
      const postRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/gl/post',
        headers: {
          'x-tenant-id': 'tenant_acme',
          'x-company-id': 'company_hq',
          'x-user-id': 'user_poster',
          'x-user-permissions': '*'
        },
        payload: {
          journalEntryId: draftId
        }
      });
      expect(postRes.statusCode).toBe(200);
      const postedData = JSON.parse(postRes.payload).data;
      expect(postedData.status).toBe('POSTED');
      expect(postedData.voucherNumber).toMatch(/^JV-/);

      // 5. Get Ledger View
      const ledgerRes = await app.inject({
        method: 'GET',
        url: '/api/v1/finance/gl/ledger?companyId=company_hq',
        headers: {
          'x-tenant-id': 'tenant_acme',
          'x-company-id': 'company_hq'
        }
      });
      expect(ledgerRes.statusCode).toBe(200);
      const ledgerData = JSON.parse(ledgerRes.payload).data;
      expect(ledgerData.entries.length).toBe(2);
      expect(ledgerData.totalDebit).toBe('1000.00');

      // 6. Get Trial Balance
      const tbRes = await app.inject({
        method: 'GET',
        url: '/api/v1/finance/gl/trial-balance?companyId=company_hq',
        headers: {
          'x-tenant-id': 'tenant_acme',
          'x-company-id': 'company_hq'
        }
      });
      expect(tbRes.statusCode).toBe(200);
      const tbData = JSON.parse(tbRes.payload).data;
      expect(tbData.summary.isBalanced).toBe(true);

      // 7. Reverse Journal Entry
      const reverseRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/gl/reverse',
        headers: {
          'x-tenant-id': 'tenant_acme',
          'x-company-id': 'company_hq',
          'x-user-id': 'user_reverser',
          'x-user-permissions': '*'
        },
        payload: {
          originalJournalId: draftId,
          reason: 'API reversal test'
        }
      });
      expect(reverseRes.statusCode).toBe(200);
      const revData = JSON.parse(reverseRes.payload).data;
      expect(revData.status).toBe('POSTED');
      expect(revData.originalJournalId).toBe(draftId);
    });

    it('cancels a draft entry via POST /api/v1/finance/gl/drafts/:id/cancel', async () => {
      const draft = await journalDraftService.createDraft(ctx, {
        companyId: 'company_hq',
        fiscalYearId: 'fy_2026_27',
        fiscalPeriodId: 'fp_2026_04',
        accountingDate: '2026-04-15',
        lines: [
          { accountId: accBankId, lineSequence: 1, debitAmount: '250.00', creditAmount: '0.00' },
          { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '250.00' }
        ]
      });

      const cancelRes = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/gl/drafts/${draft.id}/cancel`,
        headers: {
          'x-tenant-id': 'tenant_acme',
          'x-company-id': 'company_hq'
        }
      });

      expect(cancelRes.statusCode).toBe(200);
      expect(JSON.parse(cancelRes.payload).data.status).toBe('CANCELLED');
    });
  });

  // 2. Strict Input Scale Validation
  describe('Input Scale Validation', () => {
    it('rejects journal creation with scale > 2 (e.g. 500.001)', async () => {
      await expect(
        journalDraftService.createDraft(ctx, {
          companyId: 'company_hq',
          fiscalYearId: 'fy_2026_27',
          fiscalPeriodId: 'fp_2026_04',
          accountingDate: '2026-04-15',
          lines: [
            { accountId: accBankId, lineSequence: 1, debitAmount: '500.001', creditAmount: '0.00' },
            { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '500.001' }
          ]
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  // 3. Historical Inactive Accounts Reporting
  describe('Historical Inactive Accounts Reporting', () => {
    it('includes inactive account in GL ledger and trial balance if it has historical posted transactions', async () => {
      // 1. Post entry with account 1010 & 4010
      const draft = await journalDraftService.createDraft(ctx, {
        companyId: 'company_hq',
        fiscalYearId: 'fy_2026_27',
        fiscalPeriodId: 'fp_2026_04',
        accountingDate: '2026-04-15',
        lines: [
          { accountId: accBankId, lineSequence: 1, debitAmount: '500.00', creditAmount: '0.00' },
          { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '500.00' }
        ]
      });
      await glEngine.postJournal(ctx, draft.id!);

      // 2. Deactivate account 1010
      await chartOfAccountsService.deactivateAccount(ctx, accBankId);
      const deactivatedAcc = await chartOfAccountsService.getAccountById(ctx, accBankId);
      expect(deactivatedAcc.status).toBe('INACTIVE');

      // 3. Query Trial Balance with includeInactive: true
      const tb = await glEngine.getTrialBalance(ctx, { companyId: 'company_hq', includeInactive: true });
      const row1010 = tb.rows.find(r => r.accountId === accBankId);
      expect(row1010).toBeDefined();
      expect(row1010?.status).toBe('INACTIVE');
      expect(row1010?.totalDebit).toBe('500.00');

      // 4. Query Ledger View for account 1010
      const ledger = await glEngine.getLedgerView(ctx, { companyId: 'company_hq', accountId: accBankId });
      expect(ledger.entries.length).toBe(1);
      expect(ledger.entries[0].debitAmount).toBe('500.00');
    });
  });

  // 4. High-Concurrency Reversals (100 Concurrent Requests)
  describe('High-Concurrency Reversals', () => {
    it('executes 100 concurrent reversal requests for the same posted journal, producing exactly 1 reversal', async () => {
      const draft = await journalDraftService.createDraft(ctx, {
        companyId: 'company_hq',
        fiscalYearId: 'fy_2026_27',
        fiscalPeriodId: 'fp_2026_04',
        accountingDate: '2026-04-15',
        lines: [
          { accountId: accBankId, lineSequence: 1, debitAmount: '300.00', creditAmount: '0.00' },
          { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '300.00' }
        ]
      });
      const posted = await glEngine.postJournal(ctx, draft.id!);

      const requests = Array.from({ length: 100 }, (_, i) =>
        glEngine.reverseJournal(ctx, {
          originalJournalId: posted.id!,
          reason: `Concurrent reversal attempt ${i + 1}`,
          idempotencyKey: `idem_rev_attempt_${i + 1}`
        })
      );

      const results = await Promise.allSettled(requests);
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(99);
    });
  });

  // 5. Reversal Graph Constraint
  describe('Reversal Graph Constraint', () => {
    it('rejects attempt to reverse a reversal journal (J2 -> J3)', async () => {
      const draft = await journalDraftService.createDraft(ctx, {
        companyId: 'company_hq',
        fiscalYearId: 'fy_2026_27',
        fiscalPeriodId: 'fp_2026_04',
        accountingDate: '2026-04-15',
        lines: [
          { accountId: accBankId, lineSequence: 1, debitAmount: '400.00', creditAmount: '0.00' },
          { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '400.00' }
        ]
      });
      const posted = await glEngine.postJournal(ctx, draft.id!);
      const reversed = await glEngine.reverseJournal(ctx, {
        originalJournalId: posted.id!,
        reason: 'Initial reversal'
      });

      await expect(
        glEngine.reverseJournal(ctx, {
          originalJournalId: reversed.id!,
          reason: 'Attempting to reverse the reversal journal'
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  // 6. Period-Close Race Protection
  describe('Period-Close Race Protection', () => {
    it('rejects posting into a closed fiscal period', async () => {
      const targetDate = new Date('2026-07-15');
      const { fiscalPeriod } = await fiscalPeriodService.resolvePeriod(ctx, 'company_hq', targetDate);
      await fiscalPeriodService.closePeriod(ctx, fiscalPeriod.id);

      const draft = await journalDraftService.createDraft(ctx, {
        companyId: 'company_hq',
        fiscalYearId: 'fy_2026_27',
        fiscalPeriodId: fiscalPeriod.id,
        accountingDate: '2026-07-15',
        lines: [
          { accountId: accBankId, lineSequence: 1, debitAmount: '150.00', creditAmount: '0.00' },
          { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '150.00' }
        ]
      });

      await expect(glEngine.postJournal(ctx, draft.id!)).rejects.toThrow(BusinessRuleViolationError);
    });
  });
});
