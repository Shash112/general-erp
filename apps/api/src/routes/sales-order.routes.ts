import { FastifyInstance, FastifyRequest } from 'fastify';
import { RequestContext, ValidationError, ForbiddenError } from '@general-erp/core';
import { salesOrderService } from '../modules/sales/sales-order.service.js';

function getRequestContext(req: FastifyRequest): RequestContext {
  const tenantId = (req.headers['x-tenant-id'] as string) || 'tenant_default';
  const companyId = (req.headers['x-company-id'] as string) || 'company_default';

  const userId = req.headers['x-user-id'] as string || 'user_sales_rep';
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
    throw new ForbiddenError(`Company scope mismatch: Context company '${ctx.companyId}' cannot access requested company '${companyId}'.`);
  }
}

export async function salesOrderRoutes(fastify: FastifyInstance) {
  // Convert QuotationConversionContract to Sales Order
  fastify.post('/api/v1/sales/orders/from-contract', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as any;
    if (!body || !body.contract) {
      throw new ValidationError('Request body with contract object is required.');
    }

    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
    validateCompanyScope(ctx, body.contract.companyId);

    const order = await salesOrderService.createFromContract(ctx, body.contract, idempotencyKey);
    return reply.status(201).send({ data: order });
  });

  // List Sales Orders
  fastify.get('/api/v1/sales/orders', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      status?: string;
      customerId?: string;
      search?: string;
      page?: string;
      limit?: string;
    };

    const companyId = query.companyId || ctx.companyId;
    validateCompanyScope(ctx, companyId);

    const result = await salesOrderService.listOrders(ctx, {
      companyId,
      status: query.status,
      customerId: query.customerId,
      search: query.search,
      page: query.page ? parseInt(query.page, 10) : 1,
      limit: query.limit ? parseInt(query.limit, 10) : 50
    });

    return reply.send(result);
  });

  // Get Sales Order By ID
  fastify.get('/api/v1/sales/orders/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const order = await salesOrderService.getOrderById(ctx, id);
    validateCompanyScope(ctx, order.companyId);

    return reply.send({ data: order });
  });

  // Confirm Sales Order
  fastify.post('/api/v1/sales/orders/:id/confirm', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};

    const confirmed = await salesOrderService.confirmOrder(ctx, id, body.creditOverrideReason);
    return reply.send({ data: confirmed });
  });

  // Cancel Sales Order
  fastify.post('/api/v1/sales/orders/:id/cancel', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};

    const cancelled = await salesOrderService.cancelOrder(ctx, id, body.cancellationReason);
    return reply.send({ data: cancelled });
  });
}
