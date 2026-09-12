import { FastifyInstance, FastifyRequest } from 'fastify';
import { fiscalPeriodService } from '../modules/finance/fiscal-period.service.js';
import { RequestContext } from '@general-erp/core';

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

export async function fiscalPeriodRoutes(fastify: FastifyInstance) {
  // Create Fiscal Year & Periods
  fastify.post('/api/v1/finance/fiscal-years', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as { companyId: string; name: string; startDate: string; endDate: string; includeAdjustmentPeriod?: boolean };
    
    const result = await fiscalPeriodService.createFiscalYear(ctx, {
      companyId: body.companyId || ctx.companyId!,
      name: body.name,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
      ...(body.includeAdjustmentPeriod !== undefined ? { includeAdjustmentPeriod: body.includeAdjustmentPeriod } : {})
    });

    return reply.status(201).send({ data: result });
  });

  // List Fiscal Years
  fastify.get('/api/v1/finance/fiscal-years', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as { companyId?: string };
    const companyId = query.companyId || ctx.companyId!;

    const years = await fiscalPeriodService.getFiscalYears(ctx, companyId);
    return reply.send({ data: years });
  });

  // Get Fiscal Year by ID
  fastify.get('/api/v1/finance/fiscal-years/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const query = req.query as { companyId?: string };
    const companyId = query.companyId || ctx.companyId!;

    const years = await fiscalPeriodService.getFiscalYears(ctx, companyId);
    const year = years.find(y => y.id === id);
    if (!year) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `FiscalYear '${id}' not found.` } });
    }
    return reply.send({ data: year });
  });

  // Activate Fiscal Year
  fastify.post('/api/v1/finance/fiscal-years/:id/activate', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const fy = await fiscalPeriodService.activateFiscalYear(ctx, id);
    return reply.send({ data: fy });
  });

  // Validate Fiscal Year Close
  fastify.post('/api/v1/finance/fiscal-years/:id/validate-close', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const validation = await fiscalPeriodService.validateYearClose(ctx, id);
    return reply.send({ data: validation });
  });

  // Close Fiscal Year
  fastify.post('/api/v1/finance/fiscal-years/:id/close', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const fy = await fiscalPeriodService.closeFiscalYear(ctx, id);
    return reply.send({ data: fy });
  });

  // Roll-Forward Fiscal Year to Next Year
  fastify.post('/api/v1/finance/fiscal-years/:id/roll-forward', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as { targetFiscalYearId?: string };

    const result = await fiscalPeriodService.rollForwardFiscalYear(ctx, id, body.targetFiscalYearId);
    return reply.send({ data: result });
  });

  // Get Opening Balances for Fiscal Year
  fastify.get('/api/v1/finance/fiscal-years/:id/opening-balances', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const balances = await fiscalPeriodService.getOpeningBalances(ctx, id);
    return reply.send({ data: balances });
  });

  // List Fiscal Periods for Year or Query
  fastify.get('/api/v1/finance/fiscal-periods', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as { fiscalYearId?: string; companyId?: string };

    if (query.fiscalYearId) {
      const periods = await fiscalPeriodService.getFiscalPeriods(ctx, query.fiscalYearId);
      return reply.send({ data: periods });
    }

    const companyId = query.companyId || ctx.companyId!;
    const years = await fiscalPeriodService.getFiscalYears(ctx, companyId);
    let allPeriods: any[] = [];
    for (const fy of years) {
      const periods = await fiscalPeriodService.getFiscalPeriods(ctx, fy.id);
      allPeriods = allPeriods.concat(periods);
    }
    return reply.send({ data: allPeriods });
  });

  // List Periods for Specific Fiscal Year
  fastify.get('/api/v1/finance/fiscal-years/:id/periods', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const periods = await fiscalPeriodService.getFiscalPeriods(ctx, id);
    return reply.send({ data: periods });
  });

  // Get Fiscal Period by ID
  fastify.get('/api/v1/finance/fiscal-periods/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const query = req.query as { companyId?: string };
    const companyId = query.companyId || ctx.companyId!;
    const years = await fiscalPeriodService.getFiscalYears(ctx, companyId);

    for (const fy of years) {
      const periods = await fiscalPeriodService.getFiscalPeriods(ctx, fy.id);
      const found = periods.find(p => p.id === id);
      if (found) {
        return reply.send({ data: found });
      }
    }

    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `FiscalPeriod '${id}' not found.` } });
  });

  // Validate Period Close
  fastify.post('/api/v1/finance/fiscal-periods/:id/validate-close', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const validation = await fiscalPeriodService.validatePeriodClose(ctx, id);
    return reply.send({ data: validation });
  });

  // Close Accounting Period
  fastify.post('/api/v1/finance/fiscal-periods/:id/close', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const period = await fiscalPeriodService.closePeriod(ctx, id);
    return reply.send({ data: period });
  });

  // Reopen Accounting Period
  fastify.post('/api/v1/finance/fiscal-periods/:id/reopen', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = req.body as { reason: string };

    const period = await fiscalPeriodService.reopenPeriod(ctx, id, body?.reason);
    return reply.send({ data: period });
  });

  // Resolve Period for Company and Date
  fastify.get('/api/v1/finance/fiscal-periods/resolve', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as { companyId?: string; date: string };
    const companyId = query.companyId || ctx.companyId!;

    const result = await fiscalPeriodService.resolvePeriod(ctx, companyId, new Date(query.date));
    return reply.send({ data: result });
  });
}
