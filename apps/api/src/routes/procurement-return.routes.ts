import { FastifyInstance, FastifyRequest } from 'fastify';
import { RequestContext, ForbiddenError } from '@general-erp/core';
import { procurementReturnService } from '../modules/procurement/procurement-return.service.js';

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

export async function procurementReturnRoutes(fastify: FastifyInstance) {
  // Create Procurement Return
  fastify.post('/api/v1/procurement/returns', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = (req.body as any) || {};
    if (!body.companyId) body.companyId = ctx.companyId;
    validateCompanyScope(ctx, body.companyId);

    const result = await procurementReturnService.createProcurementReturn(ctx, body);
    return reply.status(201).send({ data: result });
  });

  // List Procurement Returns
  fastify.get('/api/v1/procurement/returns', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = (req.query as any) || {};
    const companyId = query.companyId || ctx.companyId;
    validateCompanyScope(ctx, companyId);

    const list = await procurementReturnService.listProcurementReturns(ctx, companyId, {
      status: query.status,
      supplierId: query.supplierId,
    });
    return reply.send({ data: list });
  });

  // Get Returnable Quantity helper
  fastify.get('/api/v1/procurement/returns/returnable-quantities', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = (req.query as any) || {};
    const { goodsReceiptLineId } = query;
    if (!goodsReceiptLineId) {
      return reply.status(400).send({ error: 'goodsReceiptLineId query param is required.' });
    }
    const result = await procurementReturnService.getReturnableQuantity(ctx, goodsReceiptLineId);
    return reply.send({ data: result });
  });

  // Get Procurement Return Details
  fastify.get('/api/v1/procurement/returns/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const result = await procurementReturnService.getReturnWithLines(ctx, id);
    validateCompanyScope(ctx, result.returnRecord.companyId);
    return reply.send({ data: result });
  });

  // Submit Procurement Return
  fastify.post('/api/v1/procurement/returns/:id/submit', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const result = await procurementReturnService.submitProcurementReturn(ctx, id);
    return reply.send({ data: result });
  });

  // Approve Procurement Return
  fastify.post('/api/v1/procurement/returns/:id/approve', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const result = await procurementReturnService.approveProcurementReturn(ctx, id);
    return reply.send({ data: result });
  });

  // Complete Procurement Return
  fastify.post('/api/v1/procurement/returns/:id/complete', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const result = await procurementReturnService.completeProcurementReturn(ctx, id);
    return reply.send({ data: result });
  });

  // Cancel Procurement Return
  fastify.post('/api/v1/procurement/returns/:id/cancel', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};
    const result = await procurementReturnService.cancelProcurementReturn(ctx, id, body.reason || 'Cancelled');
    return reply.send({ data: result });
  });

  // --- Supplier Debit Notes ---

  // Create Supplier Debit Note
  fastify.post('/api/v1/procurement/debit-notes', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = (req.body as any) || {};
    if (!body.companyId) body.companyId = ctx.companyId;
    validateCompanyScope(ctx, body.companyId);

    const result = await procurementReturnService.createSupplierDebitNote(ctx, body);
    return reply.status(201).send({ data: result });
  });

  // List Supplier Debit Notes
  fastify.get('/api/v1/procurement/debit-notes', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = (req.query as any) || {};
    const companyId = query.companyId || ctx.companyId;
    validateCompanyScope(ctx, companyId);

    const list = await procurementReturnService.listSupplierDebitNotes(ctx, companyId, {
      status: query.status,
      supplierId: query.supplierId,
    });
    return reply.send({ data: list });
  });

  // Get Supplier Debit Note Details
  fastify.get('/api/v1/procurement/debit-notes/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const result = await procurementReturnService.getDebitNoteWithLines(ctx, id);
    validateCompanyScope(ctx, result.debitNote.companyId);
    return reply.send({ data: result });
  });

  // Approve Supplier Debit Note
  fastify.post('/api/v1/procurement/debit-notes/:id/approve', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const result = await procurementReturnService.approveSupplierDebitNote(ctx, id);
    return reply.send({ data: result });
  });

  // Post Supplier Debit Note
  fastify.post('/api/v1/procurement/debit-notes/:id/post', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};
    const idempotencyKey = (req.headers['idempotency-key'] as string) || body.idempotencyKey;
    const result = await procurementReturnService.postSupplierDebitNote(ctx, id, { idempotencyKey });
    return reply.send({ data: result });
  });

  // Cancel Supplier Debit Note
  fastify.post('/api/v1/procurement/debit-notes/:id/cancel', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};
    const result = await procurementReturnService.cancelSupplierDebitNote(ctx, id, body.reason || 'Cancelled');
    return reply.send({ data: result });
  });
}
