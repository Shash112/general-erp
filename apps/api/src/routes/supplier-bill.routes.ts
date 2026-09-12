import { FastifyInstance, FastifyRequest } from 'fastify';
import { RequestContext, ForbiddenError } from '@general-erp/core';
import { supplierBillService } from '../modules/procurement/supplier-bill.service.js';

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

export async function supplierBillRoutes(fastify: FastifyInstance) {
  // Create draft Supplier Bill
  fastify.post('/api/v1/procurement/supplier-bills', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = (req.body as any) || {};
    if (!body.companyId) body.companyId = ctx.companyId;
    validateCompanyScope(ctx, body.companyId);

    const result = await supplierBillService.createSupplierBill(ctx, body);
    return reply.status(201).send({ data: result });
  });

  // List Supplier Bills
  fastify.get('/api/v1/procurement/supplier-bills', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = (req.query as any) || {};
    const companyId = query.companyId || ctx.companyId;
    validateCompanyScope(ctx, companyId);

    const list = await supplierBillService.listSupplierBills(ctx, companyId, {
      supplierId: query.supplierId,
      status: query.status,
      matchStatus: query.matchStatus,
    });
    return reply.send({ data: list });
  });

  // Get Supplier Bill Details
  fastify.get('/api/v1/procurement/supplier-bills/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const result = await supplierBillService.getSupplierBillById(ctx, id);
    if (!result || !result.bill) {
      return reply.status(404).send({ error: `Supplier Bill '${id}' not found.` });
    }
    validateCompanyScope(ctx, result.bill.companyId);
    return reply.send({ data: result });
  });

  // Execute Three-Way Match on Supplier Bill
  fastify.post('/api/v1/procurement/supplier-bills/:id/match', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};
    const result = await supplierBillService.performThreeWayMatch(ctx, id, {
      priceTolerancePercent: body.priceTolerancePercent,
      quantityTolerancePercent: body.quantityTolerancePercent,
      amountToleranceAbsolute: body.amountToleranceAbsolute,
    });
    return reply.send({ data: result });
  });

  // Override Match Exceptions
  fastify.post('/api/v1/procurement/supplier-bills/:id/override-match', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};
    const result = await supplierBillService.overrideMatchExceptions(ctx, id, { reason: body.reason });
    return reply.send({ data: result });
  });

  // Approve Supplier Bill
  fastify.post('/api/v1/procurement/supplier-bills/:id/approve', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const result = await supplierBillService.approveSupplierBill(ctx, id);
    return reply.send({ data: result });
  });

  // Post Supplier Bill (Atomic AP & GL Posting)
  fastify.post('/api/v1/procurement/supplier-bills/:id/post', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};
    const idempotencyKey = (req.headers['idempotency-key'] as string) || body.idempotencyKey;
    const result = await supplierBillService.postSupplierBill(ctx, id, { idempotencyKey });
    return reply.send({ data: result });
  });

  // Cancel Supplier Bill
  fastify.post('/api/v1/procurement/supplier-bills/:id/cancel', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};
    const result = await supplierBillService.cancelSupplierBill(ctx, id, body.reason);
    return reply.send({ data: result });
  });
}
