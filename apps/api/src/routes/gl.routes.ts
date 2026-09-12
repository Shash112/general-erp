import { FastifyInstance, FastifyRequest } from 'fastify';
import { journalDraftService, CreateDraftJournalInput, UpdateDraftJournalInput } from '../modules/finance/journal-draft.service.js';
import { glEngine, PostJournalInput, ReverseJournalInput } from '../modules/finance/gl-engine.js';
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

export async function glRoutes(fastify: FastifyInstance) {
  // 1. Create Draft Journal Entry
  fastify.post('/api/v1/finance/gl/drafts', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as CreateDraftJournalInput;

    const input: CreateDraftJournalInput = {
      ...body,
      companyId: body.companyId || ctx.companyId!
    };

    const draft = await journalDraftService.createDraft(ctx, input);
    return reply.status(201).send({ data: draft });
  });

  // 2. Get Draft Journal Entry By ID
  fastify.get('/api/v1/finance/gl/drafts/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const draft = await journalDraftService.getDraftById(ctx, id);
    return reply.send({ data: draft });
  });

  // 3. Update Draft Journal Entry
  fastify.patch('/api/v1/finance/gl/drafts/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = req.body as UpdateDraftJournalInput;

    const updated = await journalDraftService.updateDraft(ctx, id, body);
    return reply.send({ data: updated });
  });

  // 4. Cancel Draft Journal Entry
  fastify.post('/api/v1/finance/gl/drafts/:id/cancel', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const cancelled = await journalDraftService.cancelDraft(ctx, id);
    return reply.send({ data: cancelled });
  });

  // 5. Post Journal Entry
  fastify.post('/api/v1/finance/gl/post', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as PostJournalInput;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || body.idempotencyKey;

    const posted = await glEngine.postJournal(ctx, {
      journalEntryId: body.journalEntryId,
      idempotencyKey
    });

    return reply.send({ data: posted });
  });

  // 6. Reverse Journal Entry
  fastify.post('/api/v1/finance/gl/reverse', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as ReverseJournalInput;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || body.idempotencyKey;

    const reversed = await glEngine.reverseJournal(ctx, {
      originalJournalId: body.originalJournalId,
      reason: body.reason,
      reversalAccountingDate: body.reversalAccountingDate,
      idempotencyKey
    });

    return reply.send({ data: reversed });
  });

  // 7. Get Journal Entry By ID (Draft or Posted)
  fastify.get('/api/v1/finance/gl/entries/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const entry = await glEngine.getJournalById(ctx, id);
    return reply.send({ data: entry });
  });

  // 8. Get Ledger View
  fastify.get('/api/v1/finance/gl/ledger', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as { companyId?: string; accountId?: string; startDate?: string; endDate?: string; includeInactive?: string };

    const ledger = await glEngine.getLedgerView(ctx, {
      companyId: query.companyId || ctx.companyId!,
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.startDate ? { startDate: query.startDate } : {}),
      ...(query.endDate ? { endDate: query.endDate } : {}),
      includeInactive: query.includeInactive === 'true'
    });

    return reply.send({ data: ledger });
  });

  // 9. Get Trial Balance
  fastify.get('/api/v1/finance/gl/trial-balance', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as { companyId?: string; asOfDate?: string; includeInactive?: string };

    const tb = await glEngine.getTrialBalance(ctx, {
      companyId: query.companyId || ctx.companyId!,
      ...(query.asOfDate ? { asOfDate: query.asOfDate } : {}),
      includeInactive: query.includeInactive === 'true'
    });

    return reply.send({ data: tb });
  });
}
