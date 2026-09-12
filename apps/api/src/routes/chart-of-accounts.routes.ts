import { FastifyInstance, FastifyRequest } from 'fastify';
import { chartOfAccountsService, CanonicalAccountType, AccountNodeType, AccountNature, ControlAccountType, AccountStatus } from '../modules/finance/chart-of-accounts.service.js';
import { RequestContext } from '@general-erp/core';

function getRequestContext(req: FastifyRequest): RequestContext {
  const tenantId = (req.headers['x-tenant-id'] as string) || 'tenant_default';
  const companyId = (req.headers['x-company-id'] as string) || 'company_default';
  
  return {
    requestId: req.id || `req_${Date.now()}`,
    tenantId,
    companyId,
    ip: req.ip || '127.0.0.1',
    userAgent: req.headers['user-agent'] || 'unknown',
    timestamp: new Date()
  };
}

export async function chartOfAccountsRoutes(fastify: FastifyInstance) {
  // Get Account Tree
  fastify.get('/api/v1/finance/coa/tree', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as { companyId?: string };
    const companyId = query.companyId || ctx.companyId!;

    const tree = await chartOfAccountsService.getAccountTree(ctx, companyId);
    return reply.send({ data: tree });
  });

  // Get Accounts List
  fastify.get('/api/v1/finance/coa/accounts', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as { companyId?: string; accountType?: CanonicalAccountType; isPostable?: string; status?: AccountStatus };
    const companyId = query.companyId || ctx.companyId!;
    const isPostable = query.isPostable !== undefined ? query.isPostable === 'true' : undefined;

    const accounts = await chartOfAccountsService.getAccountsList(ctx, companyId, {
      ...(query.accountType !== undefined ? { accountType: query.accountType } : {}),
      ...(isPostable !== undefined ? { isPostable } : {}),
      ...(query.status !== undefined ? { status: query.status } : {})
    });

    return reply.send({ data: accounts });
  });

  // Get Account By ID
  fastify.get('/api/v1/finance/coa/accounts/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const account = await chartOfAccountsService.getAccountById(ctx, id);
    return reply.send({ data: account });
  });

  // Create Account
  fastify.post('/api/v1/finance/coa/accounts', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as {
      companyId?: string;
      accountCode: string;
      accountName: string;
      nodeType?: AccountNodeType;
      accountType: CanonicalAccountType;
      accountSubtype?: string;
      accountNature?: AccountNature;
      parentId?: string;
      isControlAccount?: boolean;
      controlAccountType?: ControlAccountType;
      currency?: string;
      displayOrder?: number;
    };

    const created = await chartOfAccountsService.createAccount(ctx, {
      companyId: body.companyId || ctx.companyId!,
      accountCode: body.accountCode,
      accountName: body.accountName,
      ...(body.nodeType !== undefined ? { nodeType: body.nodeType } : {}),
      accountType: body.accountType,
      ...(body.accountSubtype !== undefined ? { accountSubtype: body.accountSubtype } : {}),
      ...(body.accountNature !== undefined ? { accountNature: body.accountNature } : {}),
      ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
      ...(body.isControlAccount !== undefined ? { isControlAccount: body.isControlAccount } : {}),
      ...(body.controlAccountType !== undefined ? { controlAccountType: body.controlAccountType } : {}),
      ...(body.currency !== undefined ? { currency: body.currency } : {}),
      ...(body.displayOrder !== undefined ? { displayOrder: body.displayOrder } : {})
    });

    return reply.status(201).send({ data: created });
  });

  // Update Account
  fastify.patch('/api/v1/finance/coa/accounts/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = req.body as {
      accountName?: string;
      accountSubtype?: string;
      displayOrder?: number;
      status?: AccountStatus;
    };

    const updated = await chartOfAccountsService.updateAccount(ctx, id, body);
    return reply.send({ data: updated });
  });

  // Activate Account
  fastify.post('/api/v1/finance/coa/accounts/:id/activate', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const activated = await chartOfAccountsService.activateAccount(ctx, id);
    return reply.send({ data: activated });
  });

  // Deactivate Account
  fastify.post('/api/v1/finance/coa/accounts/:id/deactivate', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const deactivated = await chartOfAccountsService.deactivateAccount(ctx, id);
    return reply.send({ data: deactivated });
  });

  // Delete Account
  fastify.delete('/api/v1/finance/coa/accounts/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    await chartOfAccountsService.deleteAccount(ctx, id);
    return reply.send({ success: true });
  });

  // Apply Template
  fastify.post('/api/v1/finance/coa/templates/apply', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as { companyId?: string; templateId: string };

    const result = await chartOfAccountsService.applyTemplate(ctx, {
      companyId: body.companyId || ctx.companyId!,
      templateId: body.templateId
    });

    return reply.send({ data: result });
  });
}
