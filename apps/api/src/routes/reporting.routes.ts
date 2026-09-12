import { FastifyInstance, FastifyRequest } from 'fastify';
import { financialReportingService } from '../modules/finance/reporting/financial-reporting.service.js';
import { RequestContext } from '@general-erp/core';
import { authorizationService } from '../platform/authorization/authorization.service.js';

function getRequestContext(req: FastifyRequest): RequestContext {
  const tenantId = (req.headers['x-tenant-id'] as string) || 'tenant_default';
  const companyId = (req.headers['x-company-id'] as string) || 'company_default';
  
  return {
    requestId: req.id || `req_${Date.now()}`,
    tenantId,
    companyId,
    ip: req.ip || '127.0.0.1',
    userAgent: req.headers['user-agent'] || 'unknown',
    timestamp: new Date()
  };
}

function authorizeReportAccess(ctx: RequestContext, action: string, companyId: string): void {
  if (ctx.user) {
    const isWildcard = ctx.user.permissions.some(p => p === '*' || p === action || p.startsWith('finance:report:'));
    if (!isWildcard) {
      authorizationService.authorize({ user: ctx.user, action, companyId });
    }
  }
}

export async function reportingRoutes(fastify: FastifyInstance) {
  // Trial Balance Report
  fastify.get('/api/v1/finance/reports/trial-balance', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      branchId?: string;
      asOfDate?: string;
      fromDate?: string;
      toDate?: string;
      fiscalYearId?: string;
      fiscalPeriodId?: string;
      includeZeroBalances?: string | boolean;
    };
    const companyId = query.companyId || ctx.companyId!;
    authorizeReportAccess(ctx, 'finance:report:trial-balance', companyId);

    const report = await financialReportingService.getTrialBalance(ctx, {
      companyId,
      branchId: query.branchId,
      asOfDate: query.asOfDate,
      fromDate: query.fromDate,
      toDate: query.toDate,
      fiscalYearId: query.fiscalYearId,
      fiscalPeriodId: query.fiscalPeriodId,
      includeZeroBalances: query.includeZeroBalances === 'true' || query.includeZeroBalances === true
    });

    return reply.send({ data: report });
  });

  // General Ledger Report
  fastify.get('/api/v1/finance/reports/general-ledger', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      accountId?: string;
      branchId?: string;
      fromDate?: string;
      toDate?: string;
      page?: string | number;
      limit?: string | number;
    };
    const companyId = query.companyId || ctx.companyId!;
    authorizeReportAccess(ctx, 'finance:report:general-ledger', companyId);

    const report = await financialReportingService.getGeneralLedger(ctx, {
      companyId,
      accountId: query.accountId,
      branchId: query.branchId,
      fromDate: query.fromDate,
      toDate: query.toDate,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 50
    });

    return reply.send({ data: report });
  });

  // Profit & Loss Report
  fastify.get('/api/v1/finance/reports/profit-loss', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      fromDate?: string;
      toDate?: string;
      comparativeFromDate?: string;
      comparativeToDate?: string;
    };
    const companyId = query.companyId || ctx.companyId!;
    authorizeReportAccess(ctx, 'finance:report:profit-loss', companyId);

    const fromDate = query.fromDate || new Date(new Date().getFullYear(), 0, 1).toISOString().substring(0, 10);
    const toDate = query.toDate || new Date().toISOString().substring(0, 10);

    const report = await financialReportingService.getProfitAndLoss(ctx, {
      companyId,
      fromDate,
      toDate,
      comparativeFromDate: query.comparativeFromDate,
      comparativeToDate: query.comparativeToDate
    });

    return reply.send({ data: report });
  });

  // Balance Sheet Report
  fastify.get('/api/v1/finance/reports/balance-sheet', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      asOfDate?: string;
      comparativeAsOfDate?: string;
    };
    const companyId = query.companyId || ctx.companyId!;
    authorizeReportAccess(ctx, 'finance:report:balance-sheet', companyId);

    const asOfDate = query.asOfDate || new Date().toISOString().substring(0, 10);

    const report = await financialReportingService.getBalanceSheet(ctx, {
      companyId,
      asOfDate,
      comparativeAsOfDate: query.comparativeAsOfDate
    });

    return reply.send({ data: report });
  });

  // Account Activity / Ledger Report for Specific Account
  fastify.get('/api/v1/finance/reports/accounts/:accountId/ledger', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { accountId } = req.params as { accountId: string };
    const query = req.query as {
      companyId?: string;
      fromDate?: string;
      toDate?: string;
      page?: string | number;
      limit?: string | number;
    };
    const companyId = query.companyId || ctx.companyId!;
    authorizeReportAccess(ctx, 'finance:report:account-ledger', companyId);

    const report = await financialReportingService.getAccountLedger(ctx, accountId, {
      companyId,
      fromDate: query.fromDate,
      toDate: query.toDate,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 50
    });

    return reply.send({ data: report });
  });

  // Subledger Reconciliation Report
  fastify.get('/api/v1/finance/reports/reconciliation', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      asOfDate?: string;
    };
    const companyId = query.companyId || ctx.companyId!;
    authorizeReportAccess(ctx, 'finance:report:reconciliation', companyId);

    const report = await financialReportingService.getReconciliationReport(ctx, {
      companyId,
      asOfDate: query.asOfDate
    });

    return reply.send({ data: report });
  });
}
