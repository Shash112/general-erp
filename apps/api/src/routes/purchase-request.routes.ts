import { FastifyInstance, FastifyRequest } from 'fastify';
import { RequestContext, ForbiddenError } from '@general-erp/core';
import { purchaseRequestService, ListPurchaseRequestsFilter } from '../modules/procurement/purchase-request.service.js';

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

export async function purchaseRequestRoutes(fastify: FastifyInstance) {
  // Create Purchase Request
  fastify.post('/api/v1/procurement/requests', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = (req.body as any) || {};
    if (!body.companyId) body.companyId = ctx.companyId;
    validateCompanyScope(ctx, body.companyId);

    const pr = await purchaseRequestService.createPurchaseRequest(ctx, body);
    return reply.status(201).send({ data: pr });
  });

  // List Purchase Requests
  fastify.get('/api/v1/procurement/requests', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      status?: string;
      departmentId?: string;
      requesterUserId?: string;
      priority?: string;
      fromDate?: string;
      toDate?: string;
      search?: string;
      page?: string;
      limit?: string;
    };

    const companyId = query.companyId || ctx.companyId;
    validateCompanyScope(ctx, companyId);

    const filter: ListPurchaseRequestsFilter = {
      companyId,
      page: query.page ? parseInt(query.page, 10) : 1,
      limit: query.limit ? parseInt(query.limit, 10) : 20,
    };
    if (query.status) filter.status = query.status;
    if (query.departmentId) filter.departmentId = query.departmentId;
    if (query.requesterUserId) filter.requesterUserId = query.requesterUserId;
    if (query.priority) filter.priority = query.priority;
    if (query.fromDate) filter.fromDate = query.fromDate;
    if (query.toDate) filter.toDate = query.toDate;
    if (query.search) filter.search = query.search;

    const result = await purchaseRequestService.listPurchaseRequests(ctx, filter);
    return reply.send({ data: result.items, total: result.total, page: filter.page, limit: filter.limit });
  });

  // Get Purchase Request By ID
  fastify.get('/api/v1/procurement/requests/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const pr = await purchaseRequestService.getPurchaseRequestById(ctx, id);
    validateCompanyScope(ctx, pr.companyId);

    return reply.send({ data: pr });
  });

  // Update Draft Purchase Request
  fastify.put('/api/v1/procurement/requests/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};

    const pr = await purchaseRequestService.updatePurchaseRequest(ctx, id, body);
    return reply.send({ data: pr });
  });

  // Submit Purchase Request
  fastify.post('/api/v1/procurement/requests/:id/submit', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const pr = await purchaseRequestService.submitPurchaseRequest(ctx, id);
    return reply.send({ data: pr });
  });

  // Approve Purchase Request
  fastify.post('/api/v1/procurement/requests/:id/approve', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const pr = await purchaseRequestService.approvePurchaseRequest(ctx, id);
    return reply.send({ data: pr });
  });

  // Reject Purchase Request
  fastify.post('/api/v1/procurement/requests/:id/reject', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};

    const pr = await purchaseRequestService.rejectPurchaseRequest(ctx, id, body.rejectionReason || body.reason);
    return reply.send({ data: pr });
  });

  // Cancel Purchase Request
  fastify.post('/api/v1/procurement/requests/:id/cancel', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};

    const pr = await purchaseRequestService.cancelPurchaseRequest(ctx, id, body.cancellationReason || body.reason);
    return reply.send({ data: pr });
  });
}
