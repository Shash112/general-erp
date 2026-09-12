import { FastifyInstance, FastifyRequest } from 'fastify';
import { RequestContext, ValidationError, ForbiddenError } from '@general-erp/core';
import { salesInvoiceService } from '../modules/sales/sales-invoice.service.js';

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

export async function salesInvoiceRoutes(fastify: FastifyInstance) {
  // Create Sales Invoice from Order
  fastify.post('/api/v1/sales/invoices/from-order', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = (req.body as any) || {};
    if (!body.companyId) body.companyId = ctx.companyId;
    validateCompanyScope(ctx, body.companyId);

    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
    const invoice = await salesInvoiceService.createFromOrder(ctx, body, idempotencyKey);
    return reply.status(201).send({ data: invoice });
  });

  // List Sales Invoices
  fastify.get('/api/v1/sales/invoices', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      status?: string;
      customerId?: string;
      salesOrderId?: string;
      search?: string;
      page?: string;
      limit?: string;
    };

    const companyId = query.companyId || ctx.companyId;
    validateCompanyScope(ctx, companyId);

    const result = await salesInvoiceService.listInvoices(ctx, {
      companyId,
      status: query.status,
      customerId: query.customerId,
      salesOrderId: query.salesOrderId,
      search: query.search,
      page: query.page ? parseInt(query.page, 10) : 1,
      limit: query.limit ? parseInt(query.limit, 10) : 50
    });

    return reply.send(result);
  });

  // Get Sales Invoice By ID
  fastify.get('/api/v1/sales/invoices/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const invoice = await salesInvoiceService.getInvoiceById(ctx, id);
    validateCompanyScope(ctx, invoice.companyId);

    return reply.send({ data: invoice });
  });

  // Post Sales Invoice
  fastify.post('/api/v1/sales/invoices/:id/post', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    const posted = await salesInvoiceService.postInvoice(ctx, id, idempotencyKey);
    return reply.send({ data: posted });
  });

  // Cancel Sales Invoice
  fastify.post('/api/v1/sales/invoices/:id/cancel', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};
    if (!body.reason) {
      throw new ValidationError('Cancellation reason is required.');
    }

    const cancelled = await salesInvoiceService.cancelInvoice(ctx, id, body.reason);
    return reply.send({ data: cancelled });
  });
}
