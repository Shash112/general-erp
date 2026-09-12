import { describe, it, expect, beforeEach } from 'vitest';
import { glEngine } from '../src/modules/finance/gl-engine.js';
import { journalDraftService, CreateDraftJournalInput } from '../src/modules/finance/journal-draft.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { RequestContext, ValidationError, NotFoundError, BusinessRuleViolationError } from '@general-erp/core';
import { createDatabaseClient } from '@general-erp/database';

describe('Phase 2.3.4 — Fiscal Period & Chart of Accounts Integration Tests', () => {

  const ctxCompanyA: RequestContext = {
    requestId: 'req_p234_test_a',
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
    requestId: 'req_p234_test_b',
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
  let accInactive: any;
  let groupAssets: any;

  beforeEach(async () => {
    journalDraftService.clear();
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();

    // Setup Fiscal Year 2026-27 & Periods (April 1, 2026 to March 31, 2027)
    await fiscalPeriodService.createFiscalYear(ctxCompanyA, {
      companyId: 'company_hq',
      name: 'FY 2026-27',
      startDate: new Date('2026-04-01T00:00:00Z'),
      endDate: new Date('2027-03-31T23:59:59Z'),
      includeAdjustmentPeriod: true
    });

    // Seed Active Postable Accounts for Company HQ
    accBank = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId: 'company_hq',
      accountCode: '1010',
      accountName: 'HDFC Bank Account',
      accountType: 'ASSET',
      nodeType: 'ACCOUNT'
    });

    accSales = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId: 'company_hq',
      accountCode: '4010',
      accountName: 'Domestic Product Sales',
      accountType: 'INCOME',
      nodeType: 'ACCOUNT'
    });

    // Seed Inactive Account
    accInactive = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId: 'company_hq',
      accountCode: '1090',
      accountName: 'Old Deprecated Account',
      accountType: 'ASSET',
      nodeType: 'ACCOUNT'
    });
    await chartOfAccountsService.deactivateAccount(ctxCompanyA, accInactive.id);

    // Seed GROUP Node (Non-postable)
    groupAssets = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId: 'company_hq',
      accountCode: '1000',
      accountName: 'Current Assets Group',
      accountType: 'ASSET',
      nodeType: 'GROUP'
    });
  });

  // 1. Fiscal Period Integration Unit Tests
  describe('Fiscal Period Validation & Openness Guards', () => {
    it('POSTS successfully when accounting date resolves to an OPEN fiscal period', async () => {
      const draft = await journalDraftService.createDraft(ctxCompanyA, {
        companyId: 'company_hq',
        fiscalYearId: 'fy_2026_27',
        fiscalPeriodId: 'fp_2026_04',
        accountingDate: '2026-04-15',
        sourceModule: 'MANUAL',
        lines: [
          { accountId: accBank.id, lineSequence: 1, debitAmount: '1500.00', creditAmount: '0.00' },
          { accountId: accSales.id, lineSequence: 2, debitAmount: '0.00', creditAmount: '1500.00' }
        ]
      });

      const posted = await glEngine.postJournal(ctxCompanyA, draft.id!);
      expect(posted.status).toBe('POSTED');
      expect(posted.voucherNumber).toMatch(/^JV-2026-\d{4}$/);
    });

    it('REJECTS posting when accounting date falls in a CLOSED fiscal period', async () => {
      const { fiscalPeriod } = await fiscalPeriodService.resolvePeriod(ctxCompanyA, 'company_hq', new Date('2026-04-15'));
      await fiscalPeriodService.closePeriod(ctxCompanyA, fiscalPeriod.id);

      const draft = await journalDraftService.createDraft(ctxCompanyA, {
        companyId: 'company_hq',
        fiscalYearId: 'fy_2026_27',
        fiscalPeriodId: fiscalPeriod.id,
        accountingDate: '2026-04-15',
        sourceModule: 'MANUAL',
        lines: [
          { accountId: accBank.id, lineSequence: 1, debitAmount: '500.00', creditAmount: '0.00' },
          { accountId: accSales.id, lineSequence: 2, debitAmount: '0.00', creditAmount: '500.00' }
        ]
      });

      await expect(glEngine.postJournal(ctxCompanyA, draft.id!)).rejects.toThrow(BusinessRuleViolationError);
      await expect(glEngine.postJournal(ctxCompanyA, draft.id!)).rejects.toThrow(/is CLOSED/);

      // Verify draft status remains unchanged
      const draftCheck = await journalDraftService.getDraftById(ctxCompanyA, draft.id!);
      expect(draftCheck.status).toBe('DRAFT');
    });

    it('REJECTS posting when accounting date does not resolve to any registered fiscal year', async () => {
      const draft = await journalDraftService.createDraft(ctxCompanyA, {
        companyId: 'company_hq',
        fiscalYearId: 'fy_2026_27',
        fiscalPeriodId: 'fp_2026_04',
        accountingDate: '2025-01-01', // Date outside configured FY
        sourceModule: 'MANUAL',
        lines: [
          { accountId: accBank.id, lineSequence: 1, debitAmount: '500.00', creditAmount: '0.00' },
          { accountId: accSales.id, lineSequence: 2, debitAmount: '0.00', creditAmount: '500.00' }
        ]
      });

      await expect(glEngine.postJournal(ctxCompanyA, draft.id!)).rejects.toThrow(NotFoundError);
    });

    it('POSTS successfully to Adjustment Period #13 for year-end entries', async () => {
      const { periods: fiscalPeriods } = await fiscalPeriodService.createFiscalYear(ctxCompanyA, {
        companyId: 'company_hq',
        name: 'FY 2027-28',
        startDate: new Date('2027-04-01T00:00:00Z'),
        endDate: new Date('2028-03-31T23:59:59Z'),
        includeAdjustmentPeriod: true
      });

      const period13 = fiscalPeriods.find(p => p.periodNumber === 13);
      expect(period13).toBeDefined();

      const draft = await journalDraftService.createDraft(ctxCompanyA, {
        companyId: 'company_hq',
        fiscalYearId: period13!.fiscalYearId,
        fiscalPeriodId: period13!.id,
        accountingDate: '2028-03-31',
        sourceModule: 'MANUAL',
        narration: 'Year-end audit adjustment in Period 13',
        lines: [
          { accountId: accBank.id, lineSequence: 1, debitAmount: '200.00', creditAmount: '0.00' },
          { accountId: accSales.id, lineSequence: 2, debitAmount: '0.00', creditAmount: '200.00' }
        ]
      });

      const posted = await glEngine.postJournal(ctxCompanyA, draft.id!);
      expect(posted.status).toBe('POSTED');
    });
  });

  // 2. Chart of Accounts (COA) Line Integration Unit Tests
  describe('Chart of Accounts Line Eligibility & Status Guards', () => {
    it('POSTS successfully when all lines reference ACTIVE postable ACCOUNT nodes', async () => {
      const draft = await journalDraftService.createDraft(ctxCompanyA, {
        companyId: 'company_hq',
        fiscalYearId: 'fy_2026_27',
        fiscalPeriodId: 'fp_2026_04',
        accountingDate: '2026-04-20',
        sourceModule: 'MANUAL',
        lines: [
          { accountId: accBank.id, lineSequence: 1, debitAmount: '300.00', creditAmount: '0.00' },
          { accountId: accSales.id, lineSequence: 2, debitAmount: '0.00', creditAmount: '300.00' }
        ]
      });

      const posted = await glEngine.postJournal(ctxCompanyA, draft.id!);
      expect(posted.status).toBe('POSTED');
    });

    it('REJECTS posting when a journal line references a GROUP node (isPostable = false)', async () => {
      const draft = await journalDraftService.createDraft(ctxCompanyA, {
        companyId: 'company_hq',
        fiscalYearId: 'fy_2026_27',
        fiscalPeriodId: 'fp_2026_04',
        accountingDate: '2026-04-20',
        sourceModule: 'MANUAL',
        lines: [
          { accountId: groupAssets.id, lineSequence: 1, debitAmount: '300.00', creditAmount: '0.00' },
          { accountId: accSales.id, lineSequence: 2, debitAmount: '0.00', creditAmount: '300.00' }
        ]
      });

      await expect(glEngine.postJournal(ctxCompanyA, draft.id!)).rejects.toThrow(BusinessRuleViolationError);
      await expect(glEngine.postJournal(ctxCompanyA, draft.id!)).rejects.toThrow(/GROUP node and cannot receive journal postings/);
    });

    it('REJECTS posting when a journal line references an INACTIVE account', async () => {
      const draft = await journalDraftService.createDraft(ctxCompanyA, {
        companyId: 'company_hq',
        fiscalYearId: 'fy_2026_27',
        fiscalPeriodId: 'fp_2026_04',
        accountingDate: '2026-04-20',
        sourceModule: 'MANUAL',
        lines: [
          { accountId: accBank.id, lineSequence: 1, debitAmount: '300.00', creditAmount: '0.00' },
          { accountId: accInactive.id, lineSequence: 2, debitAmount: '0.00', creditAmount: '300.00' }
        ]
      });

      await expect(glEngine.postJournal(ctxCompanyA, draft.id!)).rejects.toThrow(BusinessRuleViolationError);
      await expect(glEngine.postJournal(ctxCompanyA, draft.id!)).rejects.toThrow(/is not ACTIVE/);
    });

    it('REJECTS posting when a journal line references a non-existent account ID', async () => {
      const draft = await journalDraftService.createDraft(ctxCompanyA, {
        companyId: 'company_hq',
        fiscalYearId: 'fy_2026_27',
        fiscalPeriodId: 'fp_2026_04',
        accountingDate: '2026-04-20',
        sourceModule: 'MANUAL',
        lines: [
          { accountId: accBank.id, lineSequence: 1, debitAmount: '300.00', creditAmount: '0.00' },
          { accountId: 'acc_non_existent_999', lineSequence: 2, debitAmount: '0.00', creditAmount: '300.00' }
        ]
      });

      await expect(glEngine.postJournal(ctxCompanyA, draft.id!)).rejects.toThrow(NotFoundError);
    });
  });

  // 3. Tenant & Company Isolation Tests
  describe('Tenant & Company Context Isolation for Master Data', () => {
    it('REJECTS posting when line account belongs to a different company', async () => {
      const ctxBranchB: RequestContext = {
        ...ctxCompanyA,
        companyId: 'company_branch_b',
        user: { ...ctxCompanyA.user!, companyId: 'company_branch_b' }
      };

      // Seed account for another company under tenant_acme
      const accOtherComp = await chartOfAccountsService.createAccount(ctxBranchB, {
        companyId: 'company_branch_b',
        accountCode: '1011',
        accountName: 'Branch B Bank',
        accountType: 'ASSET',
        nodeType: 'ACCOUNT'
      });

      const draft = await journalDraftService.createDraft(ctxCompanyA, {
        companyId: 'company_hq',
        fiscalYearId: 'fy_2026_27',
        fiscalPeriodId: 'fp_2026_04',
        accountingDate: '2026-04-20',
        sourceModule: 'MANUAL',
        lines: [
          { accountId: accBank.id, lineSequence: 1, debitAmount: '300.00', creditAmount: '0.00' },
          { accountId: accOtherComp.id, lineSequence: 2, debitAmount: '0.00', creditAmount: '300.00' }
        ]
      });

      await expect(glEngine.postJournal(ctxCompanyA, draft.id!)).rejects.toThrow(ValidationError);
      await expect(glEngine.postJournal(ctxCompanyA, draft.id!)).rejects.toThrow(/Company access denied/);
    });

    it('REJECTS posting when line account belongs to a different tenant', async () => {
      // Seed account for another tenant
      const accOtherTenant = await chartOfAccountsService.createAccount(ctxCompanyB, {
        companyId: 'company_other',
        accountCode: '1010',
        accountName: 'Other Tenant Bank',
        accountType: 'ASSET',
        nodeType: 'ACCOUNT'
      });

      const draft = await journalDraftService.createDraft(ctxCompanyA, {
        companyId: 'company_hq',
        fiscalYearId: 'fy_2026_27',
        fiscalPeriodId: 'fp_2026_04',
        accountingDate: '2026-04-20',
        sourceModule: 'MANUAL',
        lines: [
          { accountId: accBank.id, lineSequence: 1, debitAmount: '300.00', creditAmount: '0.00' },
          { accountId: accOtherTenant.id, lineSequence: 2, debitAmount: '0.00', creditAmount: '300.00' }
        ]
      });

      await expect(glEngine.postJournal(ctxCompanyA, draft.id!)).rejects.toThrow(NotFoundError);
    });
  });

  // 4. PostgreSQL Transaction, In-Transaction Master Validation & Race Protection
  describe('PostgreSQL In-Transaction Period Locking & COA Validation', () => {
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

    it('validates Fiscal Period and COA lines inside active PostgreSQL transaction with row locks', async () => {
      if (!isDbAvailable || !pool) return;

      const engine = new GLEngine();
      engine.setDbPool(pool);

      // Seed DB Fiscal Year & Period
      await pool.query(`
        INSERT INTO fiscal_years (id, tenant_id, company_id, name, start_date, end_date, status, is_closed)
        VALUES ('fy_db_2026', 'tenant_acme', '00000000-0000-0000-0000-000000000001', 'FY 2026-27', '2026-04-01', '2027-03-31', 'OPEN', false)
        ON CONFLICT DO NOTHING;
      `);

      await pool.query(`
        INSERT INTO fiscal_periods (id, tenant_id, company_id, fiscal_year_id, period_number, period_type, name, start_date, end_date, status, is_closed)
        VALUES ('fp_db_2026_04', 'tenant_acme', '00000000-0000-0000-0000-000000000001', 'fy_db_2026', 1, 'STANDARD', 'APR-2026', '2026-04-01', '2026-04-30', 'OPEN', false)
        ON CONFLICT DO NOTHING;
      `);

      // Seed DB COA Accounts
      await pool.query(`
        INSERT INTO chart_of_accounts (id, tenant_id, company_id, account_code, account_name, category, subcategory, node_type, is_postable, normal_balance, status)
        VALUES 
          ('00000000-0000-0000-0000-000000000101', 'tenant_acme', '00000000-0000-0000-0000-000000000001', '1010', 'Bank', 'ASSET', 'CASH', 'ACCOUNT', true, 'DEBIT', 'ACTIVE'),
          ('00000000-0000-0000-0000-000000000401', 'tenant_acme', '00000000-0000-0000-0000-000000000001', '4010', 'Sales', 'REVENUE', 'SALES', 'ACCOUNT', true, 'CREDIT', 'ACTIVE')
        ON CONFLICT DO NOTHING;
      `);

      // Seed DB Draft Journal
      const resHeader = await pool.query(`
        INSERT INTO journal_entries (tenant_id, company_id, fiscal_year_id, fiscal_period_id, accounting_date, source_module, status, total_debit, total_credit, currency, exchange_rate, created_by)
        VALUES ('tenant_acme', '00000000-0000-0000-0000-000000000001', 'fy_db_2026', 'fp_db_2026_04', '2026-04-15', 'MANUAL', 'DRAFT', 800.00, 800.00, 'INR', 1.000000, 'user_db_test')
        RETURNING id;
      `);
      const journalId = resHeader.rows[0].id;

      await pool.query(`
        INSERT INTO journal_lines (tenant_id, company_id, journal_entry_id, account_id, line_sequence, debit_amount, credit_amount)
        VALUES 
          ('tenant_acme', '00000000-0000-0000-0000-000000000001', '${journalId}', '00000000-0000-0000-0000-000000000101', 1, 800.00, 0.00),
          ('tenant_acme', '00000000-0000-0000-0000-000000000001', '${journalId}', '00000000-0000-0000-0000-000000000401', 2, 0.00, 800.00);
      `);

      const ctxDb: RequestContext = { tenantId: 'tenant_acme', companyId: '00000000-0000-0000-0000-000000000001' };

      const posted = await engine.postJournal(ctxDb, journalId);

      expect(posted.status).toBe('POSTED');
      expect(posted.voucherNumber).toMatch(/^JV-2026-\d{4}$/);
    });

    it('REJECTS in-transaction posting when PostgreSQL fiscal period status is CLOSED', async () => {
      if (!isDbAvailable || !pool) return;

      const engine = new GLEngine();
      engine.setDbPool(pool);

      await pool.query(`
        INSERT INTO fiscal_years (id, tenant_id, company_id, name, start_date, end_date, status, is_closed)
        VALUES ('fy_db_closed', 'tenant_acme', '00000000-0000-0000-0000-000000000001', 'FY Closed', '2025-04-01', '2026-03-31', 'CLOSED', true)
        ON CONFLICT DO NOTHING;
      `);

      await pool.query(`
        INSERT INTO fiscal_periods (id, tenant_id, company_id, fiscal_year_id, period_number, period_type, name, start_date, end_date, status, is_closed)
        VALUES ('fp_db_closed_12', 'tenant_acme', '00000000-0000-0000-0000-000000000001', 'fy_db_closed', 12, 'STANDARD', 'MAR-2026', '2026-03-01', '2026-03-31', 'CLOSED', true)
        ON CONFLICT DO NOTHING;
      `);

      const resHeader = await pool.query(`
        INSERT INTO journal_entries (tenant_id, company_id, fiscal_year_id, fiscal_period_id, accounting_date, source_module, status, total_debit, total_credit, created_by)
        VALUES ('tenant_acme', '00000000-0000-0000-0000-000000000001', 'fy_db_closed', 'fp_db_closed_12', '2026-03-15', 'MANUAL', 'DRAFT', 100.00, 100.00, 'user_closed_test')
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

      await expect(engine.postJournal(ctxDb, journalId)).rejects.toThrow(BusinessRuleViolationError);
      await expect(engine.postJournal(ctxDb, journalId)).rejects.toThrow(/is CLOSED/);
    });

    it('REJECTS in-transaction posting when a line account is a GROUP node in PostgreSQL', async () => {
      if (!isDbAvailable || !pool) return;

      const engine = new GLEngine();
      engine.setDbPool(pool);

      await pool.query(`
        INSERT INTO chart_of_accounts (id, tenant_id, company_id, account_code, account_name, category, subcategory, node_type, is_postable, normal_balance, status)
        VALUES ('00000000-0000-0000-0000-000000000100', 'tenant_acme', '00000000-0000-0000-0000-000000000001', '1000', 'Assets Group', 'ASSET', 'GROUP', 'GROUP', false, 'DEBIT', 'ACTIVE')
        ON CONFLICT DO NOTHING;
      `);

      const resHeader = await pool.query(`
        INSERT INTO journal_entries (tenant_id, company_id, fiscal_year_id, fiscal_period_id, accounting_date, source_module, status, total_debit, total_credit, created_by)
        VALUES ('tenant_acme', '00000000-0000-0000-0000-000000000001', 'fy_db_2026', 'fp_db_2026_04', '2026-04-15', 'MANUAL', 'DRAFT', 100.00, 100.00, 'user_group_test')
        RETURNING id;
      `);
      const journalId = resHeader.rows[0].id;

      await pool.query(`
        INSERT INTO journal_lines (tenant_id, company_id, journal_entry_id, account_id, line_sequence, debit_amount, credit_amount)
        VALUES 
          ('tenant_acme', '00000000-0000-0000-0000-000000000001', '${journalId}', '00000000-0000-0000-0000-000000000100', 1, 100.00, 0.00),
          ('tenant_acme', '00000000-0000-0000-0000-000000000001', '${journalId}', '00000000-0000-0000-0000-000000000401', 2, 0.00, 100.00);
      `);

      const ctxDb: RequestContext = { tenantId: 'tenant_acme', companyId: '00000000-0000-0000-0000-000000000001' };

      await expect(engine.postJournal(ctxDb, journalId)).rejects.toThrow(BusinessRuleViolationError);
      await expect(engine.postJournal(ctxDb, journalId)).rejects.toThrow(/GROUP node/);
    });

    it('PREVENTS period-closing race condition through PostgreSQL row-level locks (FOR UPDATE OF fp)', async () => {
      if (!isDbAvailable || !pool) return;

      const engine = new GLEngine();
      engine.setDbPool(pool);

      // Create draft
      const resHeader = await pool.query(`
        INSERT INTO journal_entries (tenant_id, company_id, fiscal_year_id, fiscal_period_id, accounting_date, source_module, status, total_debit, total_credit, created_by)
        VALUES ('tenant_acme', '00000000-0000-0000-0000-000000000001', 'fy_db_2026', 'fp_db_2026_04', '2026-04-15', 'MANUAL', 'DRAFT', 100.00, 100.00, 'user_race_test')
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

      // Simulate Tx B: Period Close lock
      const clientB = await pool.connect();
      await clientB.query('BEGIN');
      await clientB.query(`UPDATE fiscal_periods SET status = 'CLOSED', is_closed = true WHERE id = 'fp_db_2026_04'`);

      // Tx A (postJournal) runs concurrently
      const postingPromise = engine.postJournal(ctxDb, journalId);

      // Commit Tx B
      await clientB.query('COMMIT');
      clientB.release();

      // Tx A sees closed status and aborts cleanly
      await expect(postingPromise).rejects.toThrow(BusinessRuleViolationError);
    });
  });
});
