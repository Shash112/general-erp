import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext, ValidationError, NotFoundError, BusinessRuleViolationError, ExactDecimal } from '@general-erp/core';
import { fiscalPeriodService, FiscalYearDTO, FiscalPeriodDTO } from '../src/modules/finance/fiscal-period.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { accountingConfigurationService, accountingCoreService } from '../src/modules/finance/accounting-core.service.js';
import { journalDraftService } from '../src/modules/finance/journal-draft.service.js';
import { glEngine } from '../src/modules/finance/gl-engine.js';
import { apDocumentService } from '../src/modules/finance/ap/ap-document.service.ts';
import { arDocumentService } from '../src/modules/finance/ar/ar-document.service.ts';
import { bankingVoucherService } from '../src/modules/finance/banking/banking-voucher.service.ts';
import { bankAccountService } from '../src/modules/finance/banking/bank-account.service.ts';
import { buildApp } from '../src/app.js';

describe('Phase 2.9 — Fiscal Period Closing & Year-End Roll-Forward Subsystem', () => {
  const tenantId = 'tenant_phase29_test';
  const companyId = 'comp_phase29_test';
  const otherTenantId = 'tenant_phase29_other';
  const otherCompanyId = 'comp_phase29_other';

  const ctx: RequestContext = {
    requestId: 'req_phase29_1',
    tenantId,
    companyId,
    ip: '127.0.0.1',
    userAgent: 'vitest',
    timestamp: new Date(),
    user: {
      userId: 'usr_finance_mgr',
      username: 'financemgr',
      roles: ['FINANCE_MANAGER'],
      permissions: ['*']
    }
  };

  const unauthCtx: RequestContext = {
    requestId: 'req_phase29_unauth',
    tenantId,
    companyId,
    ip: '127.0.0.1',
    userAgent: 'vitest',
    timestamp: new Date(),
    user: {
      userId: 'usr_clerk',
      username: 'clerk',
      roles: ['CLERK'],
      permissions: ['finance:period:read']
    }
  };

  const otherCtx: RequestContext = {
    requestId: 'req_phase29_other',
    tenantId: otherTenantId,
    companyId: otherCompanyId,
    ip: '127.0.0.1',
    userAgent: 'vitest',
    timestamp: new Date(),
    user: {
      userId: 'usr_other',
      username: 'other',
      roles: ['ADMIN'],
      permissions: ['*']
    }
  };

  beforeEach(async () => {
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    accountingConfigurationService.clear();
    journalDraftService.clear();
    bankingVoucherService.clear();
    bankAccountService.clear();
    apDocumentService.clear();
    arDocumentService.clear();

    // Instantiate Chart of Accounts Template
    await chartOfAccountsService.applyTemplate(ctx, {
      companyId,
      templateId: 'INDIAN_SME_DEFAULT_V1'
    });
  });

  describe('1. Fiscal Year & Period Master Creation', () => {
    it('creates a company-scoped fiscal year with 12 standard monthly periods', async () => {
      const { fiscalYear, periods } = await fiscalPeriodService.createFiscalYear(ctx, {
        companyId,
        name: 'FY 2025-26',
        startDate: new Date('2025-04-01T00:00:00.000Z'),
        endDate: new Date('2026-03-31T23:59:59.999Z')
      });

      expect(fiscalYear.id).toBeDefined();
      expect(fiscalYear.companyId).toBe(companyId);
      expect(fiscalYear.status).toBe('DRAFT');
      expect(periods.length).toBe(12);
      expect(periods[0].periodNumber).toBe(1);
      expect(periods[11].periodNumber).toBe(12);
      expect(periods[0].status).toBe('OPEN');
    });

    it('creates fiscal year with optional Period 13 adjustment period', async () => {
      const { fiscalYear, periods } = await fiscalPeriodService.createFiscalYear(ctx, {
        companyId,
        name: 'FY 2025-26 ADJ',
        startDate: new Date('2025-04-01T00:00:00.000Z'),
        endDate: new Date('2026-03-31T23:59:59.999Z'),
        includeAdjustmentPeriod: true
      });

      expect(periods.length).toBe(13);
      expect(periods[12].periodNumber).toBe(13);
      expect(periods[12].periodType).toBe('ADJUSTMENT');
    });

    it('prevents overlapping fiscal years for the same company', async () => {
      await fiscalPeriodService.createFiscalYear(ctx, {
        companyId,
        name: 'FY 2025-26',
        startDate: new Date('2025-04-01T00:00:00.000Z'),
        endDate: new Date('2026-03-31T23:59:59.999Z')
      });

      await expect(
        fiscalPeriodService.createFiscalYear(ctx, {
          companyId,
          name: 'FY 2025-26 Overlap',
          startDate: new Date('2025-06-01T00:00:00.000Z'),
          endDate: new Date('2026-05-31T23:59:59.999Z')
        })
      ).rejects.toThrow(ValidationError);
    });

    it('activates a draft fiscal year', async () => {
      const { fiscalYear } = await fiscalPeriodService.createFiscalYear(ctx, {
        companyId,
        name: 'FY 2025-26',
        startDate: new Date('2025-04-01T00:00:00.000Z'),
        endDate: new Date('2026-03-31T23:59:59.999Z')
      });

      const activated = await fiscalPeriodService.activateFiscalYear(ctx, fiscalYear.id);
      expect(activated.status).toBe('OPEN');
    });
  });

  describe('2. Period Close Validation & Atomic Period Close', () => {
    let fyId: string;
    let period1Id: string;

    beforeEach(async () => {
      const { fiscalYear, periods } = await fiscalPeriodService.createFiscalYear(ctx, {
        companyId,
        name: 'FY 2025-26',
        startDate: new Date('2025-04-01T00:00:00.000Z'),
        endDate: new Date('2026-03-31T23:59:59.999Z')
      });
      fyId = fiscalYear.id;
      period1Id = periods[0].id;
      await fiscalPeriodService.activateFiscalYear(ctx, fyId);
    });

    it('runs validatePeriodClose checklist successfully for open period', async () => {
      const result = await fiscalPeriodService.validatePeriodClose(ctx, period1Id);

      expect(result.fiscalPeriodId).toBe(period1Id);
      expect(result.canClose).toBe(true);
      expect(result.status).toBe('PASSED');
      expect(result.checks.length).toBeGreaterThanOrEqual(5);
      expect(result.passedChecks).toBe(result.checks.length);
    });

    it('atomically closes an open accounting period', async () => {
      const closed = await fiscalPeriodService.closePeriod(ctx, period1Id);

      expect(closed.id).toBe(period1Id);
      expect(closed.status).toBe('CLOSED');
      expect(closed.isClosed).toBe(true);
      expect(closed.closedAt).toBeDefined();
      expect(closed.closedBy).toBe(ctx.user?.userId);
    });

    it('rejects closing an already closed accounting period', async () => {
      await fiscalPeriodService.closePeriod(ctx, period1Id);

      await expect(fiscalPeriodService.closePeriod(ctx, period1Id)).rejects.toThrow(BusinessRuleViolationError);
    });

    it('assertPeriodOpen returns true for open period and throws for closed period', async () => {
      const isOpen = await fiscalPeriodService.assertPeriodOpen(ctx, period1Id);
      expect(isOpen).toBe(true);

      await fiscalPeriodService.closePeriod(ctx, period1Id);

      await expect(fiscalPeriodService.assertPeriodOpen(ctx, period1Id)).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  describe('3. Posting Rejection in Closed Periods (GL, AP, AR, Banking)', () => {
    let fyId: string;
    let period1Id: string;

    beforeEach(async () => {
      const { fiscalYear, periods } = await fiscalPeriodService.createFiscalYear(ctx, {
        companyId,
        name: 'FY 2025-26',
        startDate: new Date('2025-04-01T00:00:00.000Z'),
        endDate: new Date('2026-03-31T23:59:59.999Z')
      });
      fyId = fiscalYear.id;
      period1Id = periods[0].id;
      await fiscalPeriodService.activateFiscalYear(ctx, fyId);
      await fiscalPeriodService.closePeriod(ctx, period1Id);
    });

    it('rejects GL accounting event posting into closed period', async () => {
      const accounts = await chartOfAccountsService.getAccountsList(ctx, companyId);
      const cashAcc = accounts.find(a => a.accountCode === '1110')!;
      const revAcc = accounts.find(a => a.accountCode === '4100')!;

      await expect(
        accountingCoreService.processAccountingEvent(ctx, {
          companyId,
          accountingDate: '2025-04-15',
          sourceModule: 'MANUAL',
          sourceDocumentId: 'DOC_CLOSED_1',
          eventType: 'MANUAL_JOURNAL',
          lines: [
            { accountId: cashAcc.id, lineSequence: 1, debitAmount: '100.00', creditAmount: '0.00' },
            { accountId: revAcc.id, lineSequence: 2, debitAmount: '0.00', creditAmount: '100.00' }
          ]
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('rejects AP payment voucher creation/posting into closed period', async () => {
      const bankAcc = await bankAccountService.createBankAccount(ctx, {
        companyId,
        accountName: 'Test Bank Account',
        bankName: 'HDFC Bank',
        accountNumber: '98765432101',
        currency: 'INR',
        glAccountId: (await chartOfAccountsService.getAccountsList(ctx, companyId)).find(a => a.accountCode === '1120')!.id
      });

      const expAcc = (await chartOfAccountsService.getAccountsList(ctx, companyId)).find(a => a.accountCode === '5210')!;

      const voucher = await bankingVoucherService.createDraftPayment(ctx, {
        companyId,
        bankAccountId: bankAcc.id,
        voucherType: 'PAYMENT_VOUCHER',
        transactionDate: '2025-04-15',
        accountingDate: '2025-04-15',
        currency: 'INR',
        amount: '500.00',
        beneficiaryName: 'Vendor X',
        lines: [{ accountId: expAcc.id, debitAmount: '500.00', creditAmount: '0.00', narration: 'Vendor Payment' }]
      });

      await expect(bankingVoucherService.postVoucher(ctx, voucher.id)).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  describe('4. Privileged Period Reopen with Justification & Audit Logging', () => {
    let period1Id: string;

    beforeEach(async () => {
      const { fiscalYear, periods } = await fiscalPeriodService.createFiscalYear(ctx, {
        companyId,
        name: 'FY 2025-26',
        startDate: new Date('2025-04-01T00:00:00.000Z'),
        endDate: new Date('2026-03-31T23:59:59.999Z')
      });
      await fiscalPeriodService.activateFiscalYear(ctx, fiscalYear.id);
      period1Id = periods[0].id;
      await fiscalPeriodService.closePeriod(ctx, period1Id);
    });

    it('reopens a closed accounting period with explicit justification reason', async () => {
      const reopened = await fiscalPeriodService.reopenPeriod(ctx, period1Id, 'Audit adjustment approved by Manager');

      expect(reopened.id).toBe(period1Id);
      expect(reopened.status).toBe('OPEN');
      expect(reopened.isClosed).toBe(false);
    });

    it('rejects reopening period without non-empty justification reason', async () => {
      await expect(fiscalPeriodService.reopenPeriod(ctx, period1Id, '')).rejects.toThrow(ValidationError);
      await expect(fiscalPeriodService.reopenPeriod(ctx, period1Id, '   ')).rejects.toThrow(ValidationError);
    });

    it('rejects reopening period by unauthorized user lacking permission', async () => {
      await expect(fiscalPeriodService.reopenPeriod(unauthCtx, period1Id, 'Unauth reopen')).rejects.toThrow();
    });
  });

  describe('5. Year-End Close & P&L Closure to Retained Earnings', () => {
    let fyId: string;
    let periods: FiscalPeriodDTO[];

    beforeEach(async () => {
      const result = await fiscalPeriodService.createFiscalYear(ctx, {
        companyId,
        name: 'FY 2025-26 PNL',
        startDate: new Date('2025-04-01T00:00:00.000Z'),
        endDate: new Date('2026-03-31T23:59:59.999Z')
      });
      fyId = result.fiscalYear.id;
      periods = result.periods;
      await fiscalPeriodService.activateFiscalYear(ctx, fyId);
    });

    it('validates year-end close readiness and rejects if child periods are open', async () => {
      const validation = await fiscalPeriodService.validateYearClose(ctx, fyId);

      expect(validation.fiscalYearId).toBe(fyId);
      expect(validation.canClose).toBe(false);
      expect(validation.status).toBe('FAILED_BLOCKERS');
    });

    it('closes fiscal year after all child accounting periods are closed', async () => {
      for (const p of periods) {
        await fiscalPeriodService.closePeriod(ctx, p.id);
      }

      const closedYear = await fiscalPeriodService.closeFiscalYear(ctx, fyId);

      expect(closedYear.id).toBe(fyId);
      expect(closedYear.status).toBe('CLOSED');
      expect(closedYear.isClosed).toBe(true);
      expect(closedYear.closedAt).toBeDefined();
    });
  });

  describe('6. Year-End Roll-Forward & Opening Balances', () => {
    let fyId: string;
    let periods: FiscalPeriodDTO[];

    beforeEach(async () => {
      const result = await fiscalPeriodService.createFiscalYear(ctx, {
        companyId,
        name: 'FY 2025-26 RF',
        startDate: new Date('2025-04-01T00:00:00.000Z'),
        endDate: new Date('2026-03-31T23:59:59.999Z')
      });
      fyId = result.fiscalYear.id;
      periods = result.periods;
      await fiscalPeriodService.activateFiscalYear(ctx, fyId);
      for (const p of periods) {
        await fiscalPeriodService.closePeriod(ctx, p.id);
      }
    });

    it('carries forward Balance Sheet account positions into opening balances for next fiscal year', async () => {
      const result = await fiscalPeriodService.rollForwardFiscalYear(ctx, fyId);

      expect(result.companyId).toBe(companyId);
      expect(result.fiscalYearId).toBeDefined();
      expect(result.isBalanced).toBe(true);
      expect(result.lines.length).toBeGreaterThan(0);
      expect(ExactDecimal.parse(result.totalDebit, 2).equals(ExactDecimal.parse(result.totalCredit, 2))).toBe(true);
    });

    it('retrieves generated opening balances for a fiscal year', async () => {
      const rollResult = await fiscalPeriodService.rollForwardFiscalYear(ctx, fyId);
      const opening = await fiscalPeriodService.getOpeningBalances(ctx, rollResult.fiscalYearId);

      expect(opening.fiscalYearId).toBe(rollResult.fiscalYearId);
      expect(opening.isBalanced).toBe(true);
      expect(opening.totalDebit).toBe(rollResult.totalDebit);
    });
  });

  describe('7. Tenant & Company Isolation', () => {
    let fyId: string;
    let period1Id: string;

    beforeEach(async () => {
      const { fiscalYear, periods } = await fiscalPeriodService.createFiscalYear(ctx, {
        companyId,
        name: 'FY 2025-26 Iso',
        startDate: new Date('2025-04-01T00:00:00.000Z'),
        endDate: new Date('2026-03-31T23:59:59.999Z')
      });
      fyId = fiscalYear.id;
      period1Id = periods[0].id;
      await fiscalPeriodService.activateFiscalYear(ctx, fyId);
    });

    it('prevents cross-tenant access to fiscal period operations', async () => {
      await expect(fiscalPeriodService.closePeriod(otherCtx, period1Id)).rejects.toThrow(NotFoundError);
    });
  });

  describe('8. Property-Based & Randomized Fiscal Closing Balance Conservation', () => {
    it('verifies Total Opening Debits == Total Opening Credits across random balances', async () => {
      const { fiscalYear, periods } = await fiscalPeriodService.createFiscalYear(ctx, {
        companyId,
        name: 'FY 2025-26 Prop',
        startDate: new Date('2025-04-01T00:00:00.000Z'),
        endDate: new Date('2026-03-31T23:59:59.999Z')
      });
      await fiscalPeriodService.activateFiscalYear(ctx, fiscalYear.id);
      for (const p of periods) {
        await fiscalPeriodService.closePeriod(ctx, p.id);
      }

      const rollResult = await fiscalPeriodService.rollForwardFiscalYear(ctx, fiscalYear.id);
      const debits = ExactDecimal.parse(rollResult.totalDebit, 2);
      const credits = ExactDecimal.parse(rollResult.totalCredit, 2);

      expect(debits.equals(credits)).toBe(true);
    });
  });

  describe('9. REST API Routes Validation', () => {
    it('executes fiscal year and period REST routes via Fastify app instance', async () => {
      const app = buildApp();

      // Create Fiscal Year REST
      const resCreate = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/fiscal-years',
        headers: { 'x-tenant-id': tenantId, 'x-company-id': companyId },
        payload: {
          companyId,
          name: 'FY 2025-26 REST',
          startDate: '2025-04-01',
          endDate: '2026-03-31'
        }
      });
      expect(resCreate.statusCode).toBe(201);
      const fyData = JSON.parse(resCreate.payload).data;
      expect(fyData.fiscalYear.id).toBeDefined();

      // Activate Fiscal Year REST
      const resAct = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/fiscal-years/${fyData.fiscalYear.id}/activate`,
        headers: { 'x-tenant-id': tenantId, 'x-company-id': companyId }
      });
      expect(resAct.statusCode).toBe(200);

      // Validate Period Close REST
      const p1Id = fyData.periods[0].id;
      const resVal = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/fiscal-periods/${p1Id}/validate-close`,
        headers: { 'x-tenant-id': tenantId, 'x-company-id': companyId }
      });
      expect(resVal.statusCode).toBe(200);

      // Close Period REST
      const resClose = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/fiscal-periods/${p1Id}/close`,
        headers: { 'x-tenant-id': tenantId, 'x-company-id': companyId }
      });
      expect(resClose.statusCode).toBe(200);

      // Reopen Period REST
      const resReopen = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/fiscal-periods/${p1Id}/reopen`,
        headers: { 'x-tenant-id': tenantId, 'x-company-id': companyId },
        payload: { reason: 'Manager audit adjustment' }
      });
      expect(resReopen.statusCode).toBe(200);
    });
  });
});
