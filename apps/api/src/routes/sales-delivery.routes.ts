import { FastifyInstance, FastifyRequest } from 'fastify';
import { RequestContext, ValidationError, ForbiddenError } from '@general-erp/core';
import { salesDeliveryService } from '../modules/sales/sales-delivery.service.js';

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

export async function salesDeliveryRoutes(fastify: FastifyInstance) {
  // Create Sales Delivery
  fastify.post('/api/v1/sales/deliveries', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = (req.body as any) || {};
    if (!body.companyId) body.companyId = ctx.companyId;
    validateCompanyScope(ctx, body.companyId);

    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
    const delivery = await salesDeliveryService.createDelivery(ctx, body, idempotencyKey);
    return reply.status(201).send({ data: delivery });
  });

  // List Sales Deliveries
  fastify.get('/api/v1/sales/deliveries', async (req, reply) => {
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

    const result = await salesDeliveryService.listDeliveries(ctx, {
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

  // Get Sales Delivery By ID
  fastify.get('/api/v1/sales/deliveries/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const delivery = await salesDeliveryService.getDeliveryById(ctx, id);
    validateCompanyScope(ctx, delivery.companyId);

    return reply.send({ data: delivery });
  });

  // Update Draft Sales Delivery
  fastify.put('/api/v1/sales/deliveries/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};

    const updated = await salesDeliveryService.updateDraftDelivery(ctx, id, body);
    return reply.send({ data: updated });
  });

  // Pick Delivery
  fastify.post('/api/v1/sales/deliveries/:id/pick', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const picked = await salesDeliveryService.pickDelivery(ctx, id);
    return reply.send({ data: picked });
  });

  // Pack Delivery
  fastify.post('/api/v1/sales/deliveries/:id/pack', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const packed = await salesDeliveryService.packDelivery(ctx, id);
    return reply.send({ data: packed });
  });

  // Dispatch Delivery
  fastify.post('/api/v1/sales/deliveries/:id/dispatch', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const dispatched = await salesDeliveryService.dispatchDelivery(ctx, id);
    return reply.send({ data: dispatched });
  });

  // Mark Delivered
  fastify.post('/api/v1/sales/deliveries/:id/deliver', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const delivered = await salesDeliveryService.markDelivered(ctx, id);
    return reply.send({ data: delivered });
  });

  // Cancel Delivery
  fastify.post('/api/v1/sales/deliveries/:id/cancel', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};
    if (!body.reason) {
      throw new ValidationError('Cancellation reason is required.');
    }

    const cancelled = await salesDeliveryService.cancelDelivery(ctx, id, body.reason);
    return reply.send({ data: cancelled });
  });

  // Get Order Fulfillment Summary
  fastify.get('/api/v1/sales/orders/:orderId/fulfillment', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { orderId } = req.params as { orderId: string };

    const summary = await salesDeliveryService.getOrderFulfillment(ctx, orderId);
    return reply.send({ data: summary });
  });
}
