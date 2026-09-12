import { FastifyInstance, FastifyRequest } from 'fastify';
import { RequestContext, ForbiddenError } from '@general-erp/core';
import { purchaseOrderService } from '../modules/procurement/purchase-order.service.js';

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

export async function purchaseOrderRoutes(fastify: FastifyInstance) {
  // Create Purchase Order
  fastify.post('/api/v1/procurement/purchase-orders', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = (req.body as any) || {};
    if (!body.companyId) body.companyId = ctx.companyId;
    validateCompanyScope(ctx, body.companyId);

    const po = await purchaseOrderService.createPurchaseOrder(ctx, body);
    return reply.status(201).send({ data: po });
  });

  // List Purchase Orders
  fastify.get('/api/v1/procurement/purchase-orders', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = (req.query as any) || {};
    const companyId = query.companyId || ctx.companyId;
    validateCompanyScope(ctx, companyId);

    const orders = await purchaseOrderService.listPurchaseOrders(
      ctx,
      companyId,
      query.supplierId,
      query.status
    );
    return reply.send({ data: orders });
  });

  // Get Purchase Order Details
  fastify.get('/api/v1/procurement/purchase-orders/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const result = await purchaseOrderService.getPurchaseOrderById(ctx, id);
    validateCompanyScope(ctx, result.po.companyId);
    return reply.send({ data: result });
  });

  // Submit Purchase Order
  fastify.post('/api/v1/procurement/purchase-orders/:id/submit', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const po = await purchaseOrderService.submitPurchaseOrder(ctx, id);
    return reply.send({ data: po });
  });

  // Approve Purchase Order
  fastify.post('/api/v1/procurement/purchase-orders/:id/approve', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const po = await purchaseOrderService.approvePurchaseOrder(ctx, id);
    return reply.send({ data: po });
  });

  // Issue Purchase Order
  fastify.post('/api/v1/procurement/purchase-orders/:id/issue', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const po = await purchaseOrderService.issuePurchaseOrder(ctx, id);
    return reply.send({ data: po });
  });

  // Acknowledge Purchase Order
  fastify.post('/api/v1/procurement/purchase-orders/:id/acknowledge', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const po = await purchaseOrderService.acknowledgePurchaseOrder(ctx, id);
    return reply.send({ data: po });
  });

  // Cancel Purchase Order
  fastify.post('/api/v1/procurement/purchase-orders/:id/cancel', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};
    const po = await purchaseOrderService.cancelPurchaseOrder(ctx, id, body.reason);
    return reply.send({ data: po });
  });
}
