import { FastifyInstance, FastifyRequest } from 'fastify';
import { RequestContext, ForbiddenError } from '@general-erp/core';
import { goodsReceiptService } from '../modules/procurement/goods-receipt.service.js';

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
      permissions,
    },
  } as RequestContext;
}

function validateCompanyScope(ctx: RequestContext, companyId?: string): void {
  if (companyId && ctx.companyId && companyId !== ctx.companyId && ctx.companyId !== 'company_default') {
    throw new ForbiddenError(
      `Company scope mismatch: Context company '${ctx.companyId}' cannot access requested company '${companyId}'.`
    );
  }
}

export async function goodsReceiptRoutes(fastify: FastifyInstance) {
  // Create Goods Receipt Note (GRN)
  fastify.post('/api/v1/procurement/grns', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = (req.body as any) || {};
    if (!body.companyId) body.companyId = ctx.companyId;
    validateCompanyScope(ctx, body.companyId);

    const grn = await goodsReceiptService.createGoodsReceipt(ctx, body);
    return reply.status(201).send({ data: grn });
  });

  // List GRNs
  fastify.get('/api/v1/procurement/grns', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = (req.query as any) || {};
    const companyId = query.companyId || ctx.companyId;
    validateCompanyScope(ctx, companyId);

    const list = await goodsReceiptService.listGoodsReceipts(ctx, {
      companyId,
      status: query.status,
      purchaseOrderId: query.purchaseOrderId,
    });
    return reply.send({ data: list });
  });

  // Get GRN Details
  fastify.get('/api/v1/procurement/grns/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const result = await goodsReceiptService.getGoodsReceiptById(ctx, id);
    if (!result) {
      return reply.status(404).send({ error: `Goods Receipt Note '${id}' not found.` });
    }
    validateCompanyScope(ctx, result.companyId);
    return reply.send({ data: result });
  });

  // Perform Quality Inspection on GRN
  fastify.post('/api/v1/procurement/grns/:id/inspect', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};
    const result = await goodsReceiptService.inspectGoodsReceipt(ctx, id, body);
    return reply.send({ data: result });
  });

  // Formally Accept GRN
  fastify.post('/api/v1/procurement/grns/:id/accept', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const result = await goodsReceiptService.acceptGoodsReceipt(ctx, id);
    return reply.send({ data: result });
  });

  // Reject GRN
  fastify.post('/api/v1/procurement/grns/:id/reject', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};
    const result = await goodsReceiptService.rejectGoodsReceipt(ctx, id, body.reason);
    return reply.send({ data: result });
  });

  // Cancel GRN
  fastify.post('/api/v1/procurement/grns/:id/cancel', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};
    const result = await goodsReceiptService.cancelGoodsReceipt(ctx, id, body.reason);
    return reply.send({ data: result });
  });

  // Get GRNs for a Purchase Order
  fastify.get('/api/v1/procurement/purchase-orders/:id/grns', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const list = await goodsReceiptService.getGoodsReceiptsForPo(ctx, id);
    return reply.send({ data: list });
  });

  // Get Receivable Quantities for a Purchase Order
  fastify.get('/api/v1/procurement/purchase-orders/:id/receivable-quantities', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const quantities = await goodsReceiptService.getPoReceivableQuantities(ctx, id);
    return reply.send({ data: quantities });
  });
}
