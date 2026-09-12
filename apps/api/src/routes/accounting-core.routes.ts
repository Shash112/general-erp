import { FastifyInstance, FastifyRequest } from 'fastify';
import {
  accountingCoreService,
  accountingConfigurationService,
  AccountingEventInput,
  ReverseAccountingEventInput,
  AccountingMappingInput
} from '../modules/finance/accounting-core.service.js';
import { RequestContext } from '@general-erp/core';

function getRequestContext(req: FastifyRequest): RequestContext {
  const tenantId = (req.headers['x-tenant-id'] as string) || 'tenant_default';
  const companyId = (req.headers['x-company-id'] as string) || 'company_default';

  const userId = req.headers['x-user-id'] as string | undefined;
  const roles = (req.headers['x-user-roles'] as string)?.split(',') || ['finance_user'];
  const permissions = (req.headers['x-user-permissions'] as string)?.split(',') || ['*'];

  return {
    requestId: req.id || `req_${Date.now()}`,
    tenantId,
    companyId,
    ip: req.ip || '127.0.0.1',
    userAgent: req.headers['user-agent'] || 'unknown',
    timestamp: new Date(),
    ...(userId ? {
      user: {
        userId,
        email: `${userId}@system.local`,
        tenantId,
        companyId,
        roles,
        permissions
      }
    } : {})
  };
}

export async function accountingCoreRoutes(fastify: FastifyInstance) {
  // 1. Process Accounting Event
  fastify.post('/api/v1/finance/accounting/events', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as AccountingEventInput;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || body.idempotencyKey;

    const input: AccountingEventInput = {
      ...body,
      companyId: body.companyId || ctx.companyId!,
      ...(idempotencyKey ? { idempotencyKey } : {})
    };

    const posted = await accountingCoreService.processAccountingEvent(ctx, input);
    return reply.status(201).send({ data: posted });
  });

  // 2. Reverse Accounting Event
  fastify.post('/api/v1/finance/accounting/reverse', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as ReverseAccountingEventInput;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || body.idempotencyKey;

    const input: ReverseAccountingEventInput = {
      ...body,
      ...(idempotencyKey ? { idempotencyKey } : {})
    };

    const reversed = await accountingCoreService.reverseAccountingEvent(ctx, input);
    return reply.send({ data: reversed });
  });

  // 3. Set Configurable Accounting Mapping
  fastify.post('/api/v1/finance/accounting/mappings', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as AccountingMappingInput;

    const mapping = await accountingConfigurationService.setMapping(ctx, {
      companyId: body.companyId || ctx.companyId!,
      eventType: body.eventType,
      lineRole: body.lineRole,
      accountId: body.accountId
    });

    return reply.status(201).send({ data: mapping });
  });

  // 4. Get Configurable Accounting Mapping
  fastify.get('/api/v1/finance/accounting/mappings', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as { companyId?: string; eventType: string; lineRole: string };

    const mapping = await accountingConfigurationService.getMapping(
      ctx,
      query.companyId || ctx.companyId!,
      query.eventType,
      query.lineRole
    );

    return reply.send({ data: mapping });
  });
}
