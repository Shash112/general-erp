import { FastifyInstance, FastifyRequest } from 'fastify';
import { RequestContext, ForbiddenError } from '@general-erp/core';
import { sourcingService } from '../modules/procurement/sourcing.service.js';

function getRequestContext(req: FastifyRequest): RequestContext {
  const tenantId = (req.headers['x-tenant-id'] as string) || 'tenant_default';
  const companyId = (req.headers['x-company-id'] as string) || 'company_default';

  const userId = (req.headers['x-user-id'] as string) || 'user_procurement';
  const roles = (req.headers['x-user-roles'] as string)?.split(',') || ['procurement_user'];
  const permissions = (req.headers['x-user-permissions'] as string)?.split(',') || ['*'];

  return {
    requestId: req.id || `req_${Date.now()}`,
    tenantId,
    companyId,
    ip: req.ip || '127.0.0.1',
    userAgent: req.headers['user-agent'] || 'unknown',
    timestamp: new Date(),
    userId,
    user: {
      userId,
      email: `${userId}@system.local`,
      tenantId,
      companyId,
      roles,
      permissions
    }
  } as RequestContext;
}

function validateCompanyScope(ctx: RequestContext, companyId?: string): void {
  if (companyId && ctx.companyId && companyId !== ctx.companyId && ctx.companyId !== 'company_default') {
    throw new ForbiddenError(
      `Company scope mismatch: Context company '${ctx.companyId}' cannot access requested company '${companyId}'.`
    );
  }
}

export async function sourcingRoutes(fastify: FastifyInstance) {
  // RFQ Routes
  fastify.post('/api/v1/procurement/rfqs', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = (req.body as any) || {};
    if (!body.companyId) body.companyId = ctx.companyId;
    validateCompanyScope(ctx, body.companyId);

    const result = await sourcingService.createRfq(ctx, body);
    return reply.status(201).send({ data: result });
  });

  fastify.get('/api/v1/procurement/rfqs', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = (req.query as any) || {};
    const companyId = query.companyId || ctx.companyId;
    validateCompanyScope(ctx, companyId);

    const rfqs = await sourcingService.listRfqs(ctx, companyId, query.status);
    return reply.send({ data: rfqs });
  });

  fastify.get('/api/v1/procurement/rfqs/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const result = await sourcingService.getRfqById(ctx, id);
    validateCompanyScope(ctx, result.rfq.companyId);
    return reply.send({ data: result });
  });

  fastify.post('/api/v1/procurement/rfqs/:id/publish', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const rfq = await sourcingService.publishRfq(ctx, id);
    return reply.send({ data: rfq });
  });

  fastify.post('/api/v1/procurement/rfqs/:id/close', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const rfq = await sourcingService.closeRfq(ctx, id);
    return reply.send({ data: rfq });
  });

  fastify.post('/api/v1/procurement/rfqs/:id/cancel', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};
    const rfq = await sourcingService.cancelRfq(ctx, id, body.reason);
    return reply.send({ data: rfq });
  });

  // Supplier Quotation Routes
  fastify.post('/api/v1/procurement/supplier-quotations', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = (req.body as any) || {};
    if (!body.companyId) body.companyId = ctx.companyId;
    validateCompanyScope(ctx, body.companyId);

    const result = await sourcingService.createSupplierQuotation(ctx, body);
    return reply.status(201).send({ data: result });
  });

  fastify.get('/api/v1/procurement/supplier-quotations', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = (req.query as any) || {};
    const companyId = query.companyId || ctx.companyId;
    validateCompanyScope(ctx, companyId);

    const quotes = await sourcingService.listSupplierQuotations(ctx, companyId, query.rfqId, query.supplierId);
    return reply.send({ data: quotes });
  });

  fastify.get('/api/v1/procurement/supplier-quotations/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const result = await sourcingService.getSupplierQuotationById(ctx, id);
    validateCompanyScope(ctx, result.quotation.companyId);
    return reply.send({ data: result });
  });

  // Comparison & Award Routes
  fastify.post('/api/v1/procurement/rfqs/:rfqId/comparison', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { rfqId } = req.params as { rfqId: string };
    const result = await sourcingService.buildComparison(ctx, rfqId);
    return reply.status(201).send({ data: result });
  });

  fastify.get('/api/v1/procurement/comparisons/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const result = await sourcingService.getComparisonById(ctx, id);
    return reply.send({ data: result });
  });

  fastify.post('/api/v1/procurement/comparisons/:id/award', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};
    const result = await sourcingService.awardQuotation(ctx, {
      comparisonId: id,
      awardedSupplierId: body.awardedSupplierId,
      awardedLineIds: body.awardedLineIds || [],
      evaluationNotes: body.evaluationNotes
    });
    return reply.send({ data: result });
  });
}
