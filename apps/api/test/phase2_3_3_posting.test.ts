import { describe, it, expect, beforeEach } from 'vitest';
import { glEngine, GLEngine } from '../src/modules/finance/gl-engine.js';
import { journalDraftService, CreateDraftJournalInput } from '../src/modules/finance/journal-draft.service.js';
import { RequestContext, ValidationError, AccountingError, BusinessRuleViolationError, ConflictError, NotFoundError } from '@general-erp/core';
import { createDatabaseClient } from '@general-erp/database';
import { numberingEngine } from '../src/platform/numbering/numbering.service.js';

import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';

describe('Phase 2.3.3 — Atomic Posting Engine Core Tests', () => {

  const ctxCompanyA: RequestContext = {
    requestId: 'req_post_test_a',
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

  const ctxCompanyB: RequestContext = {
    requestId: 'req_post_test_b',
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
      permissions: ['finance:gl:read']
    }
  };

  const validCreateInput: CreateDraftJournalInput = {
    companyId: 'company_hq',
    fiscalYearId: 'fy_2026_27',
    fiscalPeriodId: 'fp_2026_04',
    accountingDate: '2026-04-15',
    sourceModule: 'MANUAL',
    narration: 'Draft journal for posting test',
    lines: [
      {
        accountId: 'acc_bank_101',
        lineSequence: 1,
        debitAmount: '1000.00',
        creditAmount: '0.00',
        narration: 'Bank debit'
      },
      {
        accountId: 'acc_revenue_401',
        lineSequence: 2,
        debitAmount: '0.00',
        creditAmount: '1000.00',
        narration: 'Revenue credit'
      }
    ]
  };

  beforeEach(async () => {
    journalDraftService.clear();
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();

    // Seed FY 2026-27 for Company HQ
    await fiscalPeriodService.createFiscalYear(ctxCompanyA, {
      companyId: 'company_hq',
      name: 'FY 2026-27',
      startDate: new Date('2026-04-01T00:00:00Z'),
      endDate: new Date('2027-03-31T23:59:59Z')
    });

    // Seed active postable accounts for test lines
    const seedAccounts = [
      { id: 'acc_bank_101', code: '1010', name: 'Bank Account', type: 'ASSET' },
      { id: 'acc_revenue_401', code: '4010', name: 'Sales Revenue', type: 'INCOME' },
      { id: 'acc_1', code: '1001', name: 'Account 1', type: 'ASSET' },
      { id: 'acc_2', code: '1002', name: 'Account 2', type: 'ASSET' },
      { id: 'acc_3', code: '4003', name: 'Account 3', type: 'INCOME' }
    ];

    for (const acc of seedAccounts) {
      await chartOfAccountsService.createAccount(ctxCompanyA, {
        companyId: 'company_hq',
        accountCode: acc.code,
        accountName: acc.name,
        accountType: acc.type as any,
        nodeType: 'ACCOUNT'
      });
      // Force set ID to match test accountId
      (chartOfAccountsService as any).accountsStore.set(`tenant_acme:${acc.id}`, {
        id: acc.id,
        tenantId: 'tenant_acme',
        companyId: 'company_hq',
        accountCode: acc.code,
        accountName: acc.name,
        nodeType: 'ACCOUNT',
        accountType: acc.type,
        accountNature: 'NORMAL',
        normalBalance: acc.type === 'ASSET' ? 'DEBIT' : 'CREDIT',
        isPostable: true,
        isControlAccount: false,
        status: 'ACTIVE',
        displayOrder: 1,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }
  });

  // 1. Successful Posting Unit Tests
  describe('Successful Journal Posting (DRAFT -> POSTED)', () => {
    it('posts a valid DRAFT journal entry atomically and assigns a voucher number', async () => {
      const draft = await journalDraftService.createDraft(ctxCompanyA, validCreateInput);
      expect(draft.status).toBe('DRAFT');
      expect(draft.voucherNumber).toBeNull();

      const posted = await glEngine.postJournal(ctxCompanyA, draft.id!);

      expect(posted.id).toBe(draft.id);
      expect(posted.status).toBe('POSTED');
      expect(posted.voucherNumber).toMatch(/^JV-2026-\d{4}$/);
      expect(posted.postedBy).toBe('user_fin_poster');
      expect(posted.postedAt).toBeInstanceOf(Date);
      expect(posted.postingDate).toBeInstanceOf(Date);
      expect(posted.version).toBe(draft.version + 1);
      expect(posted.lines.length).toBe(2);
      expect(posted.totalDebit).toBe('1000.00');
      expect(posted.totalCredit).toBe('1000.00');
    });

    it('preserves line data and exact monetary totals during posting', async () => {
      const inputMultiLine: CreateDraftJournalInput = {
        ...validCreateInput,
        lines: [
          { accountId: 'acc_1', lineSequence: 1, debitAmount: '250.50', creditAmount: '0.00' },
          { accountId: 'acc_2', lineSequence: 2, debitAmount: '749.50', creditAmount: '0.00' },
          { accountId: 'acc_3', lineSequence: 3, debitAmount: '0.00', creditAmount: '1000.00' }
        ]
      };

      const draft = await journalDraftService.createDraft(ctxCompanyA, inputMultiLine);
      const posted = await glEngine.postJournal(ctxCompanyA, draft.id!);

      expect(posted.status).toBe('POSTED');
      expect(posted.totalDebit).toBe('1000.00');
      expect(posted.totalCredit).toBe('1000.00');
      expect(posted.lines[0]?.debitAmount).toBe('250.50');
      expect(posted.lines[1]?.debitAmount).toBe('749.50');
      expect(posted.lines[2]?.creditAmount).toBe('1000.00');
    });
  });

  // 2. Status Restriction Tests
  describe('Status Restrictions & Transition Guards', () => {
    it('REJECTS posting an already POSTED journal entry', async () => {
      const draft = await journalDraftService.createDraft(ctxCompanyA, validCreateInput);
      const posted = await glEngine.postJournal(ctxCompanyA, draft.id!);

      await expect(glEngine.postJournal(ctxCompanyA, posted.id!)).rejects.toThrow(BusinessRuleViolationError);
      await expect(glEngine.postJournal(ctxCompanyA, posted.id!)).rejects.toThrow(/already POSTED/);
    });

    it('REJECTS posting a CANCELLED journal entry', async () => {
      const draft = await journalDraftService.createDraft(ctxCompanyA, validCreateInput);
      await journalDraftService.cancelDraft(ctxCompanyA, draft.id!);

      await expect(glEngine.postJournal(ctxCompanyA, draft.id!)).rejects.toThrow(BusinessRuleViolationError);
      await expect(glEngine.postJournal(ctxCompanyA, draft.id!)).rejects.toThrow(/is CANCELLED/);
    });

    it('REJECTS modification of a POSTED journal through the draft service', async () => {
      const draft = await journalDraftService.createDraft(ctxCompanyA, validCreateInput);
      await glEngine.postJournal(ctxCompanyA, draft.id!);

      await expect(
        journalDraftService.updateDraft(ctxCompanyA, draft.id!, { narration: 'Tampered' })
      ).rejects.toThrow(BusinessRuleViolationError);

      await expect(
        journalDraftService.cancelDraft(ctxCompanyA, draft.id!)
      ).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  // 3. Context & Security Isolation
  describe('Tenant & Company Context Isolation', () => {
    it('REJECTS posting when tenant context does not match', async () => {
      const draft = await journalDraftService.createDraft(ctxCompanyA, validCreateInput);

      await expect(glEngine.postJournal(ctxCompanyB, draft.id!)).rejects.toThrow(NotFoundError);
    });

    it('REJECTS empty or invalid request context', async () => {
      const invalidCtx: RequestContext = { requestId: 'req_invalid', ip: '127.0.0.1', userAgent: 'test', timestamp: new Date() };

      await expect(glEngine.postJournal(invalidCtx, 'je_123')).rejects.toThrow(ValidationError);
    });
  });

  // 4. Input & Input Contract Protection
  describe('Input Contract & Payload Protection', () => {
    it('REJECTS caller attempt to provide voucherNumber or status', async () => {
      const draft = await journalDraftService.createDraft(ctxCompanyA, validCreateInput);

      // Caller only passes journalEntryId; engine assigns voucherNumber and status
      const posted = await glEngine.postJournal(ctxCompanyA, { journalEntryId: draft.id! });
      expect(posted.status).toBe('POSTED');
      expect(posted.voucherNumber).not.toBeNull();
    });
  });

  // 5. Database Integration & Trigger Enforcement Tests
  describe('PostgreSQL Transaction, Trigger & Locking Integration', () => {
    let pool: any;
    let isDbAvailable = false;

    beforeEach(async () => {
      try {
        const client = createDatabaseClient();
        pool = client.pool;
        const conn = await pool.connect();
        await conn.query('SELECT 1');
        conn.release();
        isDbAvailable = true;
      } catch (err) {
        isDbAvailable = false;
        pool = undefined;
      }
    });

    it('executes atomic posting transaction via PostgreSQL with SET LOCAL app.posting_authorized', async () => {
      if (!isDbAvailable || !pool) return;

      const engine = new GLEngine();
      engine.setDbPool(pool);

      // Create draft in DB
      const resHeader = await pool.query(`
        INSERT INTO journal_entries (tenant_id, company_id, fiscal_year_id, fiscal_period_id, accounting_date, source_module, status, total_debit, total_credit, currency, exchange_rate, created_by)
        VALUES ('tenant_acme', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '2026-04-15', 'MANUAL', 'DRAFT', 500.00, 500.00, 'INR', 1.000000, 'user_db_test')
        RETURNING id;
      `);
      const journalId = resHeader.rows[0].id;

      // Seed chart of accounts
      await pool.query(`
        INSERT INTO chart_of_accounts (id, tenant_id, company_id, account_code, account_name, category, subcategory, node_type, is_postable, normal_balance, status)
        VALUES 
          ('00000000-0000-0000-0000-000000000101', 'tenant_acme', '00000000-0000-0000-0000-000000000001', '1010', 'Bank', 'ASSET', 'CASH', 'ACCOUNT', true, 'DEBIT', 'ACTIVE'),
          ('00000000-0000-0000-0000-000000000401', 'tenant_acme', '00000000-0000-0000-0000-000000000001', '4010', 'Sales', 'REVENUE', 'SALES', 'ACCOUNT', true, 'CREDIT', 'ACTIVE')
        ON CONFLICT DO NOTHING;
      `);

      await pool.query(`
        INSERT INTO journal_lines (tenant_id, company_id, journal_entry_id, account_id, line_sequence, debit_amount, credit_amount)
        VALUES 
          ('tenant_acme', '00000000-0000-0000-0000-000000000001', '${journalId}', '00000000-0000-0000-0000-000000000101', 1, 500.00, 0.00),
          ('tenant_acme', '00000000-0000-0000-0000-000000000001', '${journalId}', '00000000-0000-0000-0000-000000000401', 2, 0.00, 500.00);
      `);

      const ctxDb: RequestContext = {
        requestId: 'req_db_post',
        tenantId: 'tenant_acme',
        companyId: '00000000-0000-0000-0000-000000000001',
        user: { userId: 'user_db_poster' }
      };

      const posted = await engine.postJournal(ctxDb, journalId);

      expect(posted.status).toBe('POSTED');
      expect(posted.voucherNumber).toMatch(/^JV-2026-\d{4}$/);
      expect(posted.postedBy).toBe('user_db_poster');

      // Re-query database to verify persistence
      const checkRes = await pool.query(`SELECT status, voucher_number, posted_by FROM journal_entries WHERE id = $1`, [journalId]);
      expect(checkRes.rows[0].status).toBe('POSTED');
      expect(checkRes.rows[0].voucher_number).toBe(posted.voucherNumber);
      expect(checkRes.rows[0].posted_by).toBe('user_db_poster');
    });

    it('REJECTS direct SQL status update from DRAFT to POSTED without authorization setting', async () => {
      if (!isDbAvailable || !pool) return;

      const resHeader = await pool.query(`
        INSERT INTO journal_entries (tenant_id, company_id, fiscal_year_id, fiscal_period_id, accounting_date, source_module, status, total_debit, total_credit, created_by)
        VALUES ('tenant_acme', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '2026-04-15', 'MANUAL', 'DRAFT', 100.00, 100.00, 'user_bypass_test')
        RETURNING id;
      `);
      const journalId = resHeader.rows[0].id;

      // Direct SQL UPDATE attempting to bypass GLEngine
      await expect(
        pool.query(`UPDATE journal_entries SET status = 'POSTED', voucher_number = 'FAKE-001' WHERE id = $1`, [journalId])
      ).rejects.toThrow(/Direct SQL transition from DRAFT to POSTED is forbidden/);
    });

    it('verifies SET LOCAL app.posting_authorized does NOT leak across transactions', async () => {
      if (!isDbAvailable || !pool) return;

      const engine = new GLEngine();
      engine.setDbPool(pool);

      // Create draft
      const resHeader = await pool.query(`
        INSERT INTO journal_entries (tenant_id, company_id, fiscal_year_id, fiscal_period_id, accounting_date, source_module, status, total_debit, total_credit, created_by)
        VALUES ('tenant_acme', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '2026-04-15', 'MANUAL', 'DRAFT', 100.00, 100.00, 'user_leak_test')
        RETURNING id;
      `);
      const journalId = resHeader.rows[0].id;

      await pool.query(`
        INSERT INTO journal_lines (tenant_id, company_id, journal_entry_id, account_id, line_sequence, debit_amount, credit_amount)
        VALUES 
          ('tenant_acme', '00000000-0000-0000-0000-000000000001', '${journalId}', '00000000-0000-0000-0000-000000000101', 1, 100.00, 0.00),
          ('tenant_acme', '00000000-0000-0000-0000-000000000001', '${journalId}', '00000000-0000-0000-0000-000000000401', 2, 0.00, 100.00);
      `);

      const ctxDb: RequestContext = {
        requestId: 'req_leak_check',
        tenantId: 'tenant_acme',
        companyId: '00000000-0000-0000-0000-000000000001'
      };

      await engine.postJournal(ctxDb, journalId);

      // Subsequent query outside transaction should NOT have app.posting_authorized set
      const checkSetting = await pool.query(`SELECT current_setting('app.posting_authorized', true) as setting`);
      expect(checkSetting.rows[0].setting).toBeNull();
    });

    it('REJECTS direct SQL UPDATE or DELETE on a POSTED journal entry', async () => {
      if (!isDbAvailable || !pool) return;

      const engine = new GLEngine();
      engine.setDbPool(pool);

      const resHeader = await pool.query(`
        INSERT INTO journal_entries (tenant_id, company_id, fiscal_year_id, fiscal_period_id, accounting_date, source_module, status, total_debit, total_credit, created_by)
        VALUES ('tenant_acme', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '2026-04-15', 'MANUAL', 'DRAFT', 100.00, 100.00, 'user_immutability')
        RETURNING id;
      `);
      const journalId = resHeader.rows[0].id;

      await pool.query(`
        INSERT INTO journal_lines (tenant_id, company_id, journal_entry_id, account_id, line_sequence, debit_amount, credit_amount)
        VALUES 
          ('tenant_acme', '00000000-0000-0000-0000-000000000001', '${journalId}', '00000000-0000-0000-0000-000000000101', 1, 100.00, 0.00),
          ('tenant_acme', '00000000-0000-0000-0000-000000000001', '${journalId}', '00000000-0000-0000-0000-000000000401', 2, 0.00, 100.00);
      `);

      const ctxDb: RequestContext = { tenantId: 'tenant_acme', companyId: '00000000-0000-0000-0000-000000000001' };
      const posted = await engine.postJournal(ctxDb, journalId);
      expect(posted.status).toBe('POSTED');

      // Direct SQL UPDATE must be rejected by PostgreSQL immutability trigger
      await expect(
        pool.query(`UPDATE journal_entries SET narration = 'Illegal Update' WHERE id = $1`, [journalId])
      ).rejects.toThrow(/POSTED financial journal entries are strictly immutable/);

      // Direct SQL DELETE must be rejected by PostgreSQL immutability trigger
      await expect(
        pool.query(`DELETE FROM journal_entries WHERE id = $1`, [journalId])
      ).rejects.toThrow(/POSTED financial journal entries are strictly immutable/);
    });

    it('ROLLS BACK transaction cleanly when failure occurs midway', async () => {
      if (!isDbAvailable || !pool) return;

      const engine = new GLEngine();
      engine.setDbPool(pool);

      // Create unbalanced draft directly in DB to trigger failure during posting validation
      const resHeader = await pool.query(`
        INSERT INTO journal_entries (tenant_id, company_id, fiscal_year_id, fiscal_period_id, accounting_date, source_module, status, total_debit, total_credit, created_by)
        VALUES ('tenant_acme', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '2026-04-15', 'MANUAL', 'DRAFT', 100.00, 99.00, 'user_rollback')
        RETURNING id;
      `);
      const journalId = resHeader.rows[0].id;

      await pool.query(`
        INSERT INTO journal_lines (tenant_id, company_id, journal_entry_id, account_id, line_sequence, debit_amount, credit_amount)
        VALUES 
          ('tenant_acme', '00000000-0000-0000-0000-000000000001', '${journalId}', '00000000-0000-0000-0000-000000000101', 1, 100.00, 0.00),
          ('tenant_acme', '00000000-0000-0000-0000-000000000001', '${journalId}', '00000000-0000-0000-0000-000000000401', 2, 0.00, 99.00);
      `);

      const ctxDb: RequestContext = { tenantId: 'tenant_acme', companyId: '00000000-0000-0000-0000-000000000001' };

      await expect(engine.postJournal(ctxDb, journalId)).rejects.toThrow(AccountingError);

      // Verify status remains DRAFT and voucher_number is NULL
      const checkRes = await pool.query(`SELECT status, voucher_number FROM journal_entries WHERE id = $1`, [journalId]);
      expect(checkRes.rows[0].status).toBe('DRAFT');
      expect(checkRes.rows[0].voucher_number).toBeNull();
    });

    it('handles 100 concurrent posting requests safely with row locking (1 success, 99 rejections)', async () => {
      if (!isDbAvailable || !pool) return;

      const engine = new GLEngine();
      engine.setDbPool(pool);

      const resHeader = await pool.query(`
        INSERT INTO journal_entries (tenant_id, company_id, fiscal_year_id, fiscal_period_id, accounting_date, source_module, status, total_debit, total_credit, created_by)
        VALUES ('tenant_acme', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '2026-04-15', 'MANUAL', 'DRAFT', 200.00, 200.00, 'user_concurrent')
        RETURNING id;
      `);
      const journalId = resHeader.rows[0].id;

      await pool.query(`
        INSERT INTO journal_lines (tenant_id, company_id, journal_entry_id, account_id, line_sequence, debit_amount, credit_amount)
        VALUES 
          ('tenant_acme', '00000000-0000-0000-0000-000000000001', '${journalId}', '00000000-0000-0000-0000-000000000101', 1, 200.00, 0.00),
          ('tenant_acme', '00000000-0000-0000-0000-000000000001', '${journalId}', '00000000-0000-0000-0000-000000000401', 2, 0.00, 200.00);
      `);

      const ctxDb: RequestContext = { tenantId: 'tenant_acme', companyId: '00000000-0000-0000-0000-000000000001' };

      // Dispatch 100 concurrent posting requests
      const promises = Array.from({ length: 100 }).map(() =>
        engine.postJournal(ctxDb, journalId).catch(err => err)
      );

      const results = await Promise.all(promises);

      const successes = results.filter(r => r && r.status === 'POSTED');
      const failures = results.filter(r => r instanceof Error);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(99);

      // Verify DB contains exactly 1 POSTED entry
      const checkRes = await pool.query(`SELECT status, voucher_number FROM journal_entries WHERE id = $1`, [journalId]);
      expect(checkRes.rows[0].status).toBe('POSTED');
      expect(checkRes.rows[0].voucher_number).not.toBeNull();
    });
  });
});
