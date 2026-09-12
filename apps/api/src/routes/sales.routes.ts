import { FastifyInstance, FastifyRequest } from 'fastify';
import { RequestContext, ValidationError, ForbiddenError } from '@general-erp/core';
import { quotationService } from '../modules/sales/quotation.service.js';

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

export async function salesRoutes(fastify: FastifyInstance) {

  // Create Draft Quotation
  fastify.post('/api/v1/sales/quotations', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as any;
    if (!body) throw new ValidationError('Request body is required.');

    const companyId = body.companyId || ctx.companyId;
    validateCompanyScope(ctx, companyId);

    const quotation = await quotationService.createDraftQuotation(ctx, { ...body, companyId });
    return reply.status(201).send({ data: quotation });
  });

  // List Quotations
  fastify.get('/api/v1/sales/quotations', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      status?: string;
      search?: string;
      customerId?: string;
    };

    const companyId = query.companyId || ctx.companyId;
    validateCompanyScope(ctx, companyId);

    const listParams: { status?: string; search?: string; customerId?: string } = {};
    if (query.status) listParams.status = query.status;
    if (query.search) listParams.search = query.search;
    if (query.customerId) listParams.customerId = query.customerId;

    const quotations = await quotationService.listQuotations(ctx, companyId, listParams);

    return reply.send({ data: quotations });
  });

  // Get Quotation By ID
  fastify.get('/api/v1/sales/quotations/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const quotation = await quotationService.getQuotation(ctx, id);
    validateCompanyScope(ctx, quotation.companyId);

    return reply.send({ data: quotation });
  });

  // Update Draft Quotation
  fastify.put('/api/v1/sales/quotations/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = req.body as any;
    if (!body) throw new ValidationError('Request body is required.');

    const updated = await quotationService.updateDraftQuotation(ctx, id, body);
    return reply.send({ data: updated });
  });

  // Submit Quotation For Approval
  fastify.post('/api/v1/sales/quotations/:id/submit', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const result = await quotationService.submitForApproval(ctx, id);
    return reply.send({ data: result });
  });

  // Approve Quotation
  fastify.post('/api/v1/sales/quotations/:id/approve', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const result = await quotationService.approveQuotation(ctx, id);
    return reply.send({ data: result });
  });

  // Reject Quotation
  fastify.post('/api/v1/sales/quotations/:id/reject', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = req.body as { rejectionReason?: string };
    if (!body || !body.rejectionReason) throw new ValidationError('rejectionReason is required.');

    const result = await quotationService.rejectQuotation(ctx, id, body.rejectionReason);
    return reply.send({ data: result });
  });

  // Send Quotation (Freezes Snapshots)
  fastify.post('/api/v1/sales/quotations/:id/send', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const result = await quotationService.sendQuotation(ctx, id);
    return reply.send({ data: result });
  });

  // Accept Quotation
  fastify.post('/api/v1/sales/quotations/:id/accept', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const result = await quotationService.acceptQuotation(ctx, id);
    return reply.send({ data: result });
  });

  // Cancel Quotation
  fastify.post('/api/v1/sales/quotations/:id/cancel', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = req.body as { cancellationReason?: string } | undefined;

    const result = await quotationService.cancelQuotation(ctx, id, body?.cancellationReason);
    return reply.send({ data: result });
  });

  // Create Revision (SENT/REJECTED -> REVISED, creates Rev N+1 in DRAFT)
  fastify.post('/api/v1/sales/quotations/:id/revision', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const result = await quotationService.createRevision(ctx, id);
    return reply.status(201).send({ data: result });
  });

  // Issue Conversion Contract (Phase 3.1 Contract Envelope)
  fastify.post('/api/v1/sales/quotations/:id/convert-contract', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    const contract = await quotationService.issueConversionContract(ctx, id, idempotencyKey);
    return reply.send({ data: contract });
  });

}
