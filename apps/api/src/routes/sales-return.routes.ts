import { FastifyInstance, FastifyRequest } from 'fastify';
import { RequestContext, ValidationError, ForbiddenError } from '@general-erp/core';
import { salesReturnService } from '../modules/sales/sales-return.service.js';

function getRequestContext(req: FastifyRequest): RequestContext {
  const tenantId = (req.headers['x-tenant-id'] as string) || 'tenant_default';
  const companyId = (req.headers['x-company-id'] as string) || 'company_default';

  const userId = (req.headers['x-user-id'] as string) || 'user_sales_rep';
  const roles = (req.headers['x-user-roles'] as string)?.split(',') || ['sales_rep'];
  const permissions = (req.headers['x-user-permissions'] as string)?.split(',') || ['*'];

  return {
    requestId: req.id || `req_${Date.now()}`,
    tenantId,
    companyId,
    ip: req.ip || '127.0.0.1',
    userAgent: req.headers['user-agent'] || 'unknown',
    timestamp: new Date(),
    user: {
      userId,
      email: `${userId}@system.local`,
      tenantId,
      companyId,
      roles,
      permissions
    }
  };
}

function validateCompanyScope(ctx: RequestContext, companyId?: string): void {
  if (companyId && ctx.companyId && companyId !== ctx.companyId && ctx.companyId !== 'company_default') {
    throw new ForbiddenError(
      `Company scope mismatch: Context company '${ctx.companyId}' cannot access requested company '${companyId}'.`
    );
  }
}

export async function salesReturnRoutes(fastify: FastifyInstance) {
  // Create Sales Return
  fastify.post('/api/v1/sales/returns', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = (req.body as any) || {};
    if (!body.companyId) body.companyId = ctx.companyId;
    validateCompanyScope(ctx, body.companyId);

    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
    const ret = await salesReturnService.createReturn(ctx, body, idempotencyKey);
    return reply.status(201).send({ data: ret });
  });

  // List Sales Returns
  fastify.get('/api/v1/sales/returns', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      status?: string;
      customerId?: string;
      invoiceId?: string;
      search?: string;
    };

    const companyId = query.companyId || ctx.companyId;
    validateCompanyScope(ctx, companyId);

    const filters: { status?: string; customerId?: string; invoiceId?: string; search?: string } = {};
    if (query.status) filters.status = query.status;
    if (query.customerId) filters.customerId = query.customerId;
    if (query.invoiceId) filters.invoiceId = query.invoiceId;
    if (query.search) filters.search = query.search;

    const result = await salesReturnService.listReturns(ctx, companyId, filters);

    return reply.send({ data: result });
  });

  // Get Returnable Quantities for an Invoice
  fastify.get('/api/v1/sales/invoices/:invoiceId/returnable-quantities', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { invoiceId } = req.params as { invoiceId: string };

    const returnables = await salesReturnService.getReturnableQuantities(ctx, invoiceId);
    return reply.send({ data: returnables });
  });

  // Get Sales Return By ID
  fastify.get('/api/v1/sales/returns/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const ret = await salesReturnService.getReturnById(ctx, id);
    validateCompanyScope(ctx, ret.companyId);

    return reply.send({ data: ret });
  });

  // Submit Sales Return
  fastify.post('/api/v1/sales/returns/:id/submit', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const submitted = await salesReturnService.submitReturn(ctx, id);
    return reply.send({ data: submitted });
  });

  // Approve Sales Return
  fastify.post('/api/v1/sales/returns/:id/approve', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const approved = await salesReturnService.approveReturn(ctx, id);
    return reply.send({ data: approved });
  });

  // Cancel Sales Return
  fastify.post('/api/v1/sales/returns/:id/cancel', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};

    if (!body.reason) {
      throw new ValidationError('Cancellation reason is required.');
    }

    const cancelled = await salesReturnService.cancelReturn(ctx, id, body.reason);
    return reply.send({ data: cancelled });
  });
}
