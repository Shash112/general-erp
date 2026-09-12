import { FastifyInstance, FastifyRequest } from 'fastify';
import { RequestContext, ValidationError, ForbiddenError } from '@general-erp/core';
import { salesCreditNoteService } from '../modules/sales/sales-credit-note.service.js';

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

export async function salesCreditNoteRoutes(fastify: FastifyInstance) {
  // Create Sales Credit Note
  fastify.post('/api/v1/sales/credit-notes', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = (req.body as any) || {};
    if (!body.companyId) body.companyId = ctx.companyId;
    validateCompanyScope(ctx, body.companyId);

    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
    const creditNote = await salesCreditNoteService.createCreditNote(ctx, body, idempotencyKey);
    return reply.status(201).send({ data: creditNote });
  });

  // List Sales Credit Notes
  fastify.get('/api/v1/sales/credit-notes', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      status?: string;
      customerId?: string;
      invoiceId?: string;
      returnId?: string;
      search?: string;
    };

    const companyId = query.companyId || ctx.companyId;
    validateCompanyScope(ctx, companyId);

    const filters: { status?: string; customerId?: string; invoiceId?: string; returnId?: string; search?: string } = {};
    if (query.status) filters.status = query.status;
    if (query.customerId) filters.customerId = query.customerId;
    if (query.invoiceId) filters.invoiceId = query.invoiceId;
    if (query.returnId) filters.returnId = query.returnId;
    if (query.search) filters.search = query.search;

    const result = await salesCreditNoteService.listCreditNotes(ctx, companyId, filters);

    return reply.send({ data: result });
  });

  // Get Sales Credit Note By ID
  fastify.get('/api/v1/sales/credit-notes/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const creditNote = await salesCreditNoteService.getCreditNoteById(ctx, id);
    validateCompanyScope(ctx, creditNote.companyId);

    return reply.send({ data: creditNote });
  });

  // Post Sales Credit Note
  fastify.post('/api/v1/sales/credit-notes/:id/post', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const posted = await salesCreditNoteService.postCreditNote(ctx, id);
    return reply.send({ data: posted });
  });

  // Cancel Sales Credit Note
  fastify.post('/api/v1/sales/credit-notes/:id/cancel', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};

    if (!body.reason) {
      throw new ValidationError('Cancellation reason is required.');
    }

    const cancelled = await salesCreditNoteService.cancelCreditNote(ctx, id, body.reason);
    return reply.send({ data: cancelled });
  });
}
