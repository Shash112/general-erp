import { FastifyInstance, FastifyRequest } from 'fastify';
import { RequestContext, ValidationError, ForbiddenError } from '@general-erp/core';
import {
  arDocumentService,
  arReceiptService,
  arAllocationService,
  arAdjustmentService,
  arSettlementService,
  arAgingService,
  CreateArDocumentInput,
  UpdateArDocumentInput,
  PostArDocumentInput,
  CreateArReceiptInput,
  UpdateArReceiptInput,
  PostArReceiptInput,
  CreateArAllocationInput,
  ArAllocationFilterInput,
  ReverseArAllocationInput,
  CreateArAdjustmentInput,
  PostArAdjustmentInput,
  ReverseArAdjustmentInput
} from '../modules/finance/ar/index.js';

function getRequestContext(req: FastifyRequest): RequestContext {
  const tenantId = (req.headers['x-tenant-id'] as string) || 'tenant_default';
  const companyId = (req.headers['x-company-id'] as string) || 'company_default';

  const userId = req.headers['x-user-id'] as string | undefined;
  const roles = (req.headers['x-user-roles'] as string)?.split(',') || ['ar_user'];
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

function validateCompanyScope(ctx: RequestContext, companyId?: string): void {
  if (companyId && ctx.companyId && companyId !== ctx.companyId && ctx.companyId !== 'company_default') {
    throw new ForbiddenError(`Company scope mismatch: Request context company '${ctx.companyId}' cannot access requested company '${companyId}'.`);
  }
}

export async function arRoutes(fastify: FastifyInstance) {

  // ==========================================
  // 1. AR DOCUMENTS
  // ==========================================

  // Create Draft AR Document
  fastify.post('/api/v1/finance/ar/documents', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as CreateArDocumentInput;
    if (!body) {
      throw new ValidationError('Request body is required.');
    }

    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const input: CreateArDocumentInput = {
      ...body,
      companyId,
      accountingDate: body.accountingDate || body.documentDate
    };

    const doc = await arDocumentService.createDraft(ctx, input);
    return reply.status(201).send({ data: doc });
  });

  // Get AR Document by ID
  fastify.get('/api/v1/finance/ar/documents/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const doc = await arDocumentService.getDocument(ctx, id);
    validateCompanyScope(ctx, doc.companyId);

    return reply.send({ data: doc });
  });

  // Update Draft AR Document
  fastify.patch('/api/v1/finance/ar/documents/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = req.body as UpdateArDocumentInput;
    if (!body) {
      throw new ValidationError('Request body is required.');
    }

    const updated = await arDocumentService.updateDraft(ctx, id, body);
    return reply.send({ data: updated });
  });

  // List AR Documents
  fastify.get('/api/v1/finance/ar/documents', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      customerId?: string;
      documentType?: string;
      status?: string;
      fromDate?: string;
      toDate?: string;
      branchId?: string;
      page?: string;
      limit?: string;
    };

    const companyId = query.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const page = query.page ? parseInt(query.page, 10) : 1;
    const limit = query.limit ? Math.min(parseInt(query.limit, 10), 100) : 50;

    const docs = await arDocumentService.listDocuments(ctx, companyId, {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.documentType ? { documentType: query.documentType as any } : {}),
      ...(query.status ? { status: query.status as any } : {}),
      ...(query.fromDate ? { fromDate: query.fromDate } : {}),
      ...(query.toDate ? { toDate: query.toDate } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {})
    });

    // Pagination slice
    const startIndex = (page - 1) * limit;
    const paginated = docs.slice(startIndex, startIndex + limit);

    return reply.send({
      data: paginated,
      meta: {
        page,
        limit,
        total: docs.length
      }
    });
  });

  // Post Draft AR Document
  fastify.post('/api/v1/finance/ar/documents/:id/post', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as PostArDocumentInput;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || body.idempotencyKey;

    const postInput: PostArDocumentInput = {
      ...body,
      ...(idempotencyKey ? { idempotencyKey } : {})
    };

    const posted = await arDocumentService.postDocument(ctx, id, postInput);
    return reply.send({ data: posted });
  });

  // Cancel Draft AR Document
  fastify.post('/api/v1/finance/ar/documents/:id/cancel', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as { reason?: string };

    const reason = body.reason || 'Cancelled via API';
    const cancelled = await arDocumentService.cancelDocument(ctx, id, reason);
    return reply.send({ data: cancelled });
  });

  // ==========================================
  // 2. AR RECEIPTS
  // ==========================================

  // Create Draft AR Receipt
  fastify.post('/api/v1/finance/ar/receipts', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as CreateArReceiptInput;
    if (!body) {
      throw new ValidationError('Request body is required.');
    }

    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const bodyAny = body as any;
    const input: CreateArReceiptInput = {
      ...body,
      companyId,
      accountingDate: body.accountingDate || body.receiptDate,
      totalAmount: body.totalAmount || bodyAny.amount,
      bankAccountId: body.bankAccountId || bodyAny.depositAccountId
    };

    const receipt = await arReceiptService.createDraft(ctx, input);
    return reply.status(201).send({ data: receipt });
  });

  // Get AR Receipt by ID
  fastify.get('/api/v1/finance/ar/receipts/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const receipt = await arReceiptService.getReceipt(ctx, id);
    validateCompanyScope(ctx, receipt.companyId);

    return reply.send({ data: receipt });
  });

  // Update Draft AR Receipt
  fastify.patch('/api/v1/finance/ar/receipts/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = req.body as UpdateArReceiptInput;
    if (!body) {
      throw new ValidationError('Request body is required.');
    }

    const updated = await arReceiptService.updateDraft(ctx, id, body);
    return reply.send({ data: updated });
  });

  // List AR Receipts
  fastify.get('/api/v1/finance/ar/receipts', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      customerId?: string;
      receiptType?: string;
      status?: string;
      fromDate?: string;
      toDate?: string;
      branchId?: string;
      page?: string;
      limit?: string;
    };

    const companyId = query.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const page = query.page ? parseInt(query.page, 10) : 1;
    const limit = query.limit ? Math.min(parseInt(query.limit, 10), 100) : 50;

    const receipts = await arReceiptService.listReceipts(ctx, companyId, {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.receiptType ? { receiptType: query.receiptType as any } : {}),
      ...(query.status ? { status: query.status as any } : {}),
      ...(query.fromDate ? { fromDate: query.fromDate } : {}),
      ...(query.toDate ? { toDate: query.toDate } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {})
    });

    const startIndex = (page - 1) * limit;
    const paginated = receipts.slice(startIndex, startIndex + limit);

    return reply.send({
      data: paginated,
      meta: {
        page,
        limit,
        total: receipts.length
      }
    });
  });

  // Post Draft AR Receipt
  fastify.post('/api/v1/finance/ar/receipts/:id/post', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as PostArReceiptInput;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || body.idempotencyKey;

    const postInput: PostArReceiptInput = {
      ...body,
      ...(idempotencyKey ? { idempotencyKey } : {})
    };

    const posted = await arReceiptService.postReceipt(ctx, id, postInput);
    return reply.send({ data: posted });
  });

  // Reverse Posted AR Receipt
  fastify.post('/api/v1/finance/ar/receipts/:id/reverse', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as { reason?: string };

    const reason = body.reason || 'Reversed via API';
    const reversed = await arReceiptService.reverseReceipt(ctx, id, reason);
    return reply.send({ data: reversed });
  });

  // ==========================================
  // 3. AR ALLOCATIONS
  // ==========================================

  // Create AR Allocation
  fastify.post('/api/v1/finance/ar/allocations', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as CreateArAllocationInput;
    if (!body) {
      throw new ValidationError('Request body is required.');
    }

    const companyId = (body as any).companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const idempotencyKey = (req.headers['idempotency-key'] as string) || (body as any).idempotencyKey;

    const bodyAny = body as any;
    const allocationSourceType = body.allocationSourceType || bodyAny.sourceType || 'RECEIPT';
    const openItemId = body.openItemId || bodyAny.targetOpenItemId;
    const receiptId = body.receiptId || (allocationSourceType === 'RECEIPT' ? bodyAny.sourceId : undefined);
    const creditNoteId = body.creditNoteId || (allocationSourceType === 'CREDIT_NOTE' ? bodyAny.sourceId : undefined);

    const input: CreateArAllocationInput = {
      ...body,
      allocationSourceType,
      openItemId,
      ...(receiptId ? { receiptId } : {}),
      ...(creditNoteId ? { creditNoteId } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {})
    };

    const allocation = await arAllocationService.allocate(ctx, input);
    return reply.status(201).send({ data: allocation });
  });

  // Get AR Allocation by ID
  fastify.get('/api/v1/finance/ar/allocations/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const allocation = await arAllocationService.getAllocation(ctx, id);
    validateCompanyScope(ctx, allocation.companyId);

    return reply.send({ data: allocation });
  });

  // List AR Allocations
  fastify.get('/api/v1/finance/ar/allocations', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      customerId?: string;
      sourceType?: string;
      sourceId?: string;
      targetOpenItemId?: string;
      openItemId?: string;
      status?: string;
      page?: string;
      limit?: string;
    };

    const companyId = query.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const page = query.page ? parseInt(query.page, 10) : 1;
    const limit = query.limit ? Math.min(parseInt(query.limit, 10), 100) : 50;

    const openItemId = query.openItemId || query.targetOpenItemId;
    const filters: ArAllocationFilterInput = {
      ...(openItemId ? { openItemId } : {}),
      ...(query.status ? { status: query.status as any } : {}),
      ...(query.sourceType ? { allocationSourceType: query.sourceType as any } : {}),
      ...(query.sourceType === 'RECEIPT' && query.sourceId ? { receiptId: query.sourceId } : {}),
      ...(query.sourceType === 'CREDIT_NOTE' && query.sourceId ? { creditNoteId: query.sourceId } : {})
    };

    const allocations = await arAllocationService.listAllocations(ctx, companyId, filters);

    const startIndex = (page - 1) * limit;
    const paginated = allocations.slice(startIndex, startIndex + limit);

    return reply.send({
      data: paginated,
      meta: {
        page,
        limit,
        total: allocations.length
      }
    });
  });

  // Reverse AR Allocation
  fastify.post('/api/v1/finance/ar/allocations/:id/reverse', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as { reason?: string };

    const idempotencyKey = (req.headers['idempotency-key'] as string);

    const input: ReverseArAllocationInput = {
      allocationId: id,
      reason: body.reason || 'Reversed via API',
      ...(idempotencyKey ? { idempotencyKey } : {})
    };

    const reversed = await arAllocationService.reverseAllocation(ctx, input);
    return reply.send({ data: reversed });
  });

  // ==========================================
  // 4. AR ADJUSTMENTS
  // ==========================================

  // Create Draft AR Adjustment
  fastify.post('/api/v1/finance/ar/adjustments', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as CreateArAdjustmentInput;
    if (!body) {
      throw new ValidationError('Request body is required.');
    }

    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    let customerId = body.customerId;
    if (!customerId && body.openItemId) {
      const openItem = await arDocumentService.getOpenItem(ctx, body.openItemId);
      customerId = openItem.customerId;
    }

    const input: CreateArAdjustmentInput = {
      ...body,
      companyId,
      customerId: customerId!
    };

    const adjustment = await arAdjustmentService.createDraftAdjustment(ctx, input);
    return reply.status(201).send({ data: adjustment });
  });

  // Get AR Adjustment by ID
  fastify.get('/api/v1/finance/ar/adjustments/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const adjustment = await arAdjustmentService.getAdjustment(ctx, id);
    validateCompanyScope(ctx, adjustment.companyId);

    return reply.send({ data: adjustment });
  });

  // List AR Adjustments
  fastify.get('/api/v1/finance/ar/adjustments', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      customerId?: string;
      adjustmentType?: string;
      status?: string;
      openItemId?: string;
      page?: string;
      limit?: string;
    };

    const companyId = query.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const page = query.page ? parseInt(query.page, 10) : 1;
    const limit = query.limit ? Math.min(parseInt(query.limit, 10), 100) : 50;

    const adjustments = await arAdjustmentService.listAdjustments(ctx, companyId, {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.adjustmentType ? { adjustmentType: query.adjustmentType as any } : {}),
      ...(query.status ? { status: query.status as any } : {}),
      ...(query.openItemId ? { openItemId: query.openItemId } : {})
    });

    const startIndex = (page - 1) * limit;
    const paginated = adjustments.slice(startIndex, startIndex + limit);

    return reply.send({
      data: paginated,
      meta: {
        page,
        limit,
        total: adjustments.length
      }
    });
  });

  // Post Draft AR Adjustment
  fastify.post('/api/v1/finance/ar/adjustments/:id/post', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as PostArAdjustmentInput;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || body.idempotencyKey;

    const postInput: PostArAdjustmentInput = {
      ...body,
      ...(idempotencyKey ? { idempotencyKey } : {})
    };

    const posted = await arAdjustmentService.postAdjustment(ctx, id, postInput);
    return reply.send({ data: posted });
  });

  // Reverse Posted AR Adjustment
  fastify.post('/api/v1/finance/ar/adjustments/:id/reverse', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as ReverseArAdjustmentInput;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || body.idempotencyKey;

    const reverseInput: ReverseArAdjustmentInput = {
      reason: body.reason || 'Reversed via API',
      ...(body.reversalDate ? { reversalDate: body.reversalDate } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {})
    };

    const reversed = await arAdjustmentService.reverseAdjustment(ctx, id, reverseInput);
    return reply.send({ data: reversed });
  });

  // ==========================================
  // 5. AR SETTLEMENT & RECONCILIATION
  // ==========================================

  // Get Open Item Settlement Details
  fastify.get('/api/v1/finance/ar/settlement/open-items/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const settlement = await arSettlementService.getOpenItemSettlement(ctx, id);
    return reply.send({ data: settlement });
  });

  // Get Source Utilization Details
  fastify.get('/api/v1/finance/ar/settlement/sources/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const query = req.query as { sourceType?: 'RECEIPT' | 'CREDIT_NOTE' };

    const sourceType = query.sourceType || 'RECEIPT';
    const utilization = await arSettlementService.getSourceUtilization(ctx, sourceType, id);

    return reply.send({ data: utilization });
  });

  // Get Customer Settlement Summary
  fastify.get('/api/v1/finance/ar/settlement/customers/:customerId', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { customerId } = req.params as { customerId: string };
    const query = req.query as { companyId?: string };

    const companyId = query.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const summary = await arSettlementService.getCustomerSettlementSummary(ctx, companyId, customerId);
    return reply.send({ data: summary });
  });

  // Reconcile Company AR Position
  fastify.post('/api/v1/finance/ar/reconciliation', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = (req.body || {}) as { companyId?: string; asOfDate?: string };

    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const reconciliation = await arSettlementService.reconcileCompanyAR(ctx, companyId, body.asOfDate);
    return reply.send({ data: reconciliation });
  });

  // ==========================================
  // 6. AR AGING
  // ==========================================

  // Company-Level AR Aging Summary
  fastify.get('/api/v1/finance/ar/aging', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as { companyId?: string; asOfDate?: string };

    const companyId = query.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const companyAging = await arAgingService.getCompanyAging(ctx, companyId, query.asOfDate);
    return reply.send({ data: companyAging });
  });

  // Open Item AR Aging Detail
  fastify.get('/api/v1/finance/ar/aging/open-items', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as { openItemId?: string; asOfDate?: string };

    if (!query.openItemId) {
      throw new ValidationError('openItemId query parameter is required.');
    }

    const openItemAging = await arAgingService.getOpenItemAging(ctx, query.openItemId, query.asOfDate);
    return reply.send({ data: openItemAging });
  });

  // Customer-Level AR Aging Summary
  fastify.get('/api/v1/finance/ar/aging/customers/:customerId', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { customerId } = req.params as { customerId: string };
    const query = req.query as { companyId?: string; asOfDate?: string };

    const companyId = query.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const customerAging = await arAgingService.getCustomerAging(ctx, companyId, customerId, query.asOfDate);
    return reply.send({ data: customerAging });
  });

  // ==========================================
  // 7. CUSTOMER ACCOUNT STATEMENTS
  // ==========================================

  // Get Customer Account Statement
  fastify.get('/api/v1/finance/ar/statements/customers/:customerId', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { customerId } = req.params as { customerId: string };
    const query = req.query as {
      companyId?: string;
      fromDate?: string;
      toDate?: string;
      branchId?: string;
    };

    const companyId = query.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const fromDate = query.fromDate || '2000-01-01';
    const toDate = query.toDate || new Date().toISOString().split('T')[0]!;

    const statement = await arAgingService.getCustomerStatement(ctx, companyId, {
      customerId,
      fromDate,
      toDate,
      ...(query.branchId ? { branchId: query.branchId } : {})
    });
    return reply.send({ data: statement });
  });
}
