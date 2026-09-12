import { describe, it, expect } from 'vitest';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { RequestContext, ValidationError, BusinessRuleViolationError, ForbiddenError, NotFoundError } from '@general-erp/core';

describe('Phase 2.1 — Fiscal Years & Accounting Periods Tests', () => {
  const ctxCompanyA: RequestContext = {
    requestId: 'req_fiscal_test_a',
    tenantId: 'tenant_acme',
    companyId: 'company_hq',
    ip: '127.0.0.1',
    userAgent: 'vitest-agent',
    timestamp: new Date(),
    user: {
      userId: 'user_fin_mgr',
      tenantId: 'tenant_acme',
      companyId: 'company_hq',
      roles: ['finance_manager'],
      permissions: ['*']
    }
  };

  const ctxCompanyB: RequestContext = {
    requestId: 'req_fiscal_test_b',
    tenantId: 'tenant_other',
    companyId: 'company_other',
    ip: '127.0.0.1',
    userAgent: 'vitest-agent',
    timestamp: new Date(),
    user: {
      userId: 'user_other',
      tenantId: 'tenant_other',
      companyId: 'company_other',
      roles: ['finance_user'],
      permissions: ['finance:period:view']
    }
  };

  // 1. Fiscal Year & Period Creation Tests
  describe('Fiscal Year Creation & Auto-Generation', () => {
    it('creates a standard 12-month Indian Fiscal Year (April-March)', async () => {
      const result = await fiscalPeriodService.createFiscalYear(ctxCompanyA, {
        companyId: 'company_hq',
        name: 'FY 2026-27',
        startDate: new Date('2026-04-01T00:00:00Z'),
        endDate: new Date('2027-03-31T23:59:59Z')
      });

      expect(result.fiscalYear.name).toBe('FY 2026-27');
      expect(result.fiscalYear.status).toBe('DRAFT');
      expect(result.periods.length).toBe(12);
      expect(result.periods[0]?.name).toBe('APR-2026');
      expect(result.periods[11]?.name).toBe('MAR-2027');
    });

    it('creates Fiscal Year with optional Adjustment Period #13', async () => {
      const result = await fiscalPeriodService.createFiscalYear(ctxCompanyA, {
        companyId: 'company_hq',
        name: 'FY 2027-28',
        startDate: new Date('2027-04-01T00:00:00Z'),
        endDate: new Date('2028-03-31T23:59:59Z'),
        includeAdjustmentPeriod: true
      });

      expect(result.periods.length).toBe(13);

      const period13 = result.periods[12];
      expect(period13?.periodNumber).toBe(13);
      expect(period13?.periodType).toBe('ADJUSTMENT');
      expect(period13?.name).toBe('ADJ-2028');
    });

    it('REJECTS fiscal year creation with invalid date ordering (startDate >= endDate)', async () => {
      await expect(
        fiscalPeriodService.createFiscalYear(ctxCompanyA, {
          companyId: 'company_hq',
          name: 'FY Invalid Dates',
          startDate: new Date('2028-04-01T00:00:00Z'),
          endDate: new Date('2027-04-01T00:00:00Z')
        })
      ).rejects.toThrow(ValidationError);
    });

    it('REJECTS creation of overlapping fiscal years for the same company', async () => {
      await expect(
        fiscalPeriodService.createFiscalYear(ctxCompanyA, {
          companyId: 'company_hq',
          name: 'FY Overlap',
          startDate: new Date('2026-06-01T00:00:00Z'),
          endDate: new Date('2027-05-31T23:59:59Z')
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  // 2. Period Resolution & Validation Tests
  describe('Period Resolution & Closed Period Validation', () => {
    it('resolves specific date to exact FiscalYear and FiscalPeriod', async () => {
      const targetDate = new Date('2026-07-15T12:00:00Z');
      const resolved = await fiscalPeriodService.resolvePeriod(ctxCompanyA, 'company_hq', targetDate);

      expect(resolved.fiscalYear.name).toBe('FY 2026-27');
      expect(resolved.fiscalPeriod.periodNumber).toBe(4); // April=1, May=2, June=3, July=4
      expect(resolved.fiscalPeriod.name).toBe('JUL-2026');
    });

    it('asserts open period status for active period', async () => {
      const resolved = await fiscalPeriodService.resolvePeriod(ctxCompanyA, 'company_hq', new Date('2026-04-10T00:00:00Z'));
      const isOpen = await fiscalPeriodService.assertPeriodOpen(ctxCompanyA, resolved.fiscalPeriod.id);

      expect(isOpen).toBe(true);
    });

    it('REJECTS period assertion when period is CLOSED', async () => {
      const resolved = await fiscalPeriodService.resolvePeriod(ctxCompanyA, 'company_hq', new Date('2026-05-10T00:00:00Z'));
      await fiscalPeriodService.closePeriod(ctxCompanyA, resolved.fiscalPeriod.id);

      await expect(
        fiscalPeriodService.assertPeriodOpen(ctxCompanyA, resolved.fiscalPeriod.id)
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('reopens closed period with explicit justification reason', async () => {
      const resolved = await fiscalPeriodService.resolvePeriod(ctxCompanyA, 'company_hq', new Date('2026-05-10T00:00:00Z'));
      const reopened = await fiscalPeriodService.reopenPeriod(ctxCompanyA, resolved.fiscalPeriod.id, 'Audit adjustment for statutory compliance');

      expect(reopened.status).toBe('OPEN');
      expect(reopened.isClosed).toBe(false);

      const isOpenNow = await fiscalPeriodService.assertPeriodOpen(ctxCompanyA, resolved.fiscalPeriod.id);
      expect(isOpenNow).toBe(true);
    });

    it('REJECTS period reopening when explicit reason is missing', async () => {
      const resolved = await fiscalPeriodService.resolvePeriod(ctxCompanyA, 'company_hq', new Date('2026-05-10T00:00:00Z'));
      await fiscalPeriodService.closePeriod(ctxCompanyA, resolved.fiscalPeriod.id);

      await expect(
        fiscalPeriodService.reopenPeriod(ctxCompanyA, resolved.fiscalPeriod.id, '')
      ).rejects.toThrow(ValidationError);
    });

    it('resolves March 31 to Period 12 (MAR) and NOT Period 13 (ADJUSTMENT)', async () => {
      const march31Date = new Date('2028-03-31T23:00:00Z');
      const resolved = await fiscalPeriodService.resolvePeriod(ctxCompanyA, 'company_hq', march31Date);

      expect(resolved.fiscalYear.name).toBe('FY 2027-28');
      expect(resolved.fiscalPeriod.periodNumber).toBe(12);
      expect(resolved.fiscalPeriod.periodType).toBe('STANDARD');
      expect(resolved.fiscalPeriod.name).toBe('MAR-2028');
    });

    it('REJECTS fiscal year closing when child periods are still OPEN', async () => {
      const fyYears = await fiscalPeriodService.getFiscalYears(ctxCompanyA, 'company_hq');
      const fy = fyYears.find(f => f.name === 'FY 2026-27');
      expect(fy).toBeDefined();

      await expect(
        fiscalPeriodService.closeFiscalYear(ctxCompanyA, fy!.id)
      ).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  // 3. Multi-Tenant Isolation & Authorization Security
  describe('Multi-Tenant Isolation & Authorization', () => {
    it('PREVENTS tenant B from accessing or resolving tenant A fiscal periods', async () => {
      await expect(
        fiscalPeriodService.resolvePeriod(ctxCompanyB, 'company_hq', new Date('2026-07-15T12:00:00Z'))
      ).rejects.toThrow(NotFoundError);
    });

    it('PREVENTS unauthorized user from closing period', async () => {
      const resolved = await fiscalPeriodService.resolvePeriod(ctxCompanyA, 'company_hq', new Date('2026-08-10T00:00:00Z'));
      const unauthCtx: RequestContext = {
        ...ctxCompanyA,
        user: {
          userId: 'user_read_only',
          tenantId: 'tenant_acme',
          companyId: 'company_hq',
          roles: ['viewer'],
          permissions: ['finance:period:view']
        }
      };

      await expect(
        fiscalPeriodService.closePeriod(unauthCtx, resolved.fiscalPeriod.id)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // 4. High Concurrency Load Test
  describe('High Concurrency Period Resolution', () => {
    it('executes 100 concurrent period resolutions cleanly', async () => {
      const promises: Promise<any>[] = [];
      const testDate = new Date('2026-10-20T00:00:00Z');

      for (let i = 0; i < 100; i++) {
        promises.push(fiscalPeriodService.resolvePeriod(ctxCompanyA, 'company_hq', testDate));
      }

      const results = await Promise.all(promises);
      expect(results.length).toBe(100);
      expect(results[0]?.fiscalPeriod.name).toBe('OCT-2026');
    });
  });
});
