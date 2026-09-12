import { FastifyInstance, FastifyRequest } from 'fastify';
import { RequestContext, ValidationError, ForbiddenError } from '@general-erp/core';
import {
  apDocumentService,
  apPaymentService,
  apAllocationService,
  apAdjustmentService,
  apSettlementService,
  apHistoricalSettlementService,
  apReconciliationService,
  apAgingService,
  apStatementService,
  CreateApDocumentInput,
  UpdateApDocumentInput,
  PostApDocumentInput,
  CreateApPaymentInput,
  UpdateApPaymentInput,
  PostApPaymentInput,
  CreateApAllocationInput,
  ApAllocationFilterInput,
  ReverseApAllocationInput,
  CreateApAdjustmentInput,
  PostApAdjustmentInput,
  ReverseApAdjustmentInput
} from '../modules/finance/ap/index.js';

function getRequestContext(req: FastifyRequest): RequestContext {
  const tenantId = (req.headers['x-tenant-id'] as string) || 'tenant_default';
  const companyId = (req.headers['x-company-id'] as string) || 'company_default';

  const userId = req.headers['x-user-id'] as string | undefined;
  const roles = (req.headers['x-user-roles'] as string)?.split(',') || ['ap_user'];
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

export async function apRoutes(fastify: FastifyInstance) {

  // ==========================================
  // 1. AP DOCUMENTS
  // ==========================================

  // Create Draft AP Document
  fastify.post('/api/v1/finance/ap/documents', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as CreateApDocumentInput;
    if (!body) {
      throw new ValidationError('Request body is required.');
    }

    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const input: CreateApDocumentInput = {
      ...body,
      companyId,
      accountingDate: body.accountingDate || body.documentDate
    };

    const doc = await apDocumentService.createDraft(ctx, input);
    return reply.status(201).send({ data: doc });
  });

  // Get AP Document by ID
  fastify.get('/api/v1/finance/ap/documents/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const doc = await apDocumentService.getDocument(ctx, id);
    validateCompanyScope(ctx, doc.companyId);

    return reply.send({ data: doc });
  });

  // Update Draft AP Document
  fastify.patch('/api/v1/finance/ap/documents/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = req.body as UpdateApDocumentInput;
    if (!body) {
      throw new ValidationError('Request body is required.');
    }

    const updated = await apDocumentService.updateDraft(ctx, id, body);
    return reply.send({ data: updated });
  });

  // List AP Documents
  fastify.get('/api/v1/finance/ap/documents', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      supplierId?: string;
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

    const docs = await apDocumentService.listDocuments(ctx, companyId, {
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.documentType ? { documentType: query.documentType as any } : {}),
      ...(query.status ? { status: query.status as any } : {}),
      ...(query.fromDate ? { fromDate: query.fromDate } : {}),
      ...(query.toDate ? { toDate: query.toDate } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {})
    });

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

  // Post Draft AP Document
  fastify.post('/api/v1/finance/ap/documents/:id/post', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as PostApDocumentInput;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || body.idempotencyKey;

    const postInput: PostApDocumentInput = {
      ...body,
      ...(idempotencyKey ? { idempotencyKey } : {})
    };

    const posted = await apDocumentService.postDocument(ctx, id, postInput);
    return reply.send({ data: posted });
  });

  // Reverse Posted AP Document
  fastify.post('/api/v1/finance/ap/documents/:id/reverse', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as { reason?: string; reversalDate?: string };
    const reason = body.reason || 'Reversed via API';

    const reversed = await apDocumentService.reverseDocument(ctx, id, reason, body.reversalDate);
    return reply.send({ data: reversed });
  });

  // Cancel Draft AP Document
  fastify.post('/api/v1/finance/ap/documents/:id/cancel', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as { reason?: string };

    const reason = body.reason || 'Cancelled via API';
    const cancelled = await apDocumentService.cancelDocument(ctx, id, reason);
    return reply.send({ data: cancelled });
  });

  // ==========================================
  // 2. AP PAYMENTS
  // ==========================================

  // Create Draft AP Payment
  fastify.post('/api/v1/finance/ap/payments', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as CreateApPaymentInput;
    if (!body) {
      throw new ValidationError('Request body is required.');
    }

    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const bodyAny = body as any;
    const input: CreateApPaymentInput = {
      ...body,
      companyId,
      accountingDate: body.accountingDate || body.paymentDate,
      totalAmount: body.totalAmount || bodyAny.amount,
      bankAccountId: body.bankAccountId || bodyAny.disbursementAccountId
    };

    const payment = await apPaymentService.createDraft(ctx, input);
    return reply.status(201).send({ data: payment });
  });

  // Get AP Payment by ID
  fastify.get('/api/v1/finance/ap/payments/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const payment = await apPaymentService.getPayment(ctx, id);
    validateCompanyScope(ctx, payment.companyId);

    return reply.send({ data: payment });
  });

  // Update Draft AP Payment
  fastify.patch('/api/v1/finance/ap/payments/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = req.body as UpdateApPaymentInput;
    if (!body) {
      throw new ValidationError('Request body is required.');
    }

    const updated = await apPaymentService.updateDraft(ctx, id, body);
    return reply.send({ data: updated });
  });

  // List AP Payments
  fastify.get('/api/v1/finance/ap/payments', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      supplierId?: string;
      paymentType?: string;
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

    const payments = await apPaymentService.listPayments(ctx, companyId, {
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.paymentType ? { paymentType: query.paymentType as any } : {}),
      ...(query.status ? { status: query.status as any } : {}),
      ...(query.fromDate ? { fromDate: query.fromDate } : {}),
      ...(query.toDate ? { toDate: query.toDate } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {})
    });

    const startIndex = (page - 1) * limit;
    const paginated = payments.slice(startIndex, startIndex + limit);

    return reply.send({
      data: paginated,
      meta: {
        page,
        limit,
        total: payments.length
      }
    });
  });

  // Post Draft AP Payment
  fastify.post('/api/v1/finance/ap/payments/:id/post', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as PostApPaymentInput;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || body.idempotencyKey;

    const postInput: PostApPaymentInput = {
      ...body,
      ...(idempotencyKey ? { idempotencyKey } : {})
    };

    const posted = await apPaymentService.postPayment(ctx, id, postInput);
    return reply.send({ data: posted });
  });

  // Reverse Posted AP Payment
  fastify.post('/api/v1/finance/ap/payments/:id/reverse', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as { reason?: string; reversalDate?: string };
    const reason = body.reason || 'Reversed via API';

    const reversed = await apPaymentService.reversePayment(ctx, id, reason, body.reversalDate);
    return reply.send({ data: reversed });
  });

  // ==========================================
  // 3. AP ALLOCATIONS
  // ==========================================

  // Create AP Allocation
  fastify.post('/api/v1/finance/ap/allocations', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as CreateApAllocationInput;
    if (!body) {
      throw new ValidationError('Request body is required.');
    }

    const companyId = (body as any).companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const idempotencyKey = (req.headers['idempotency-key'] as string) || (body as any).idempotencyKey;

    const bodyAny = body as any;
    const allocationSourceType = body.allocationSourceType || bodyAny.sourceType || 'PAYMENT';
    const openItemId = body.openItemId || bodyAny.targetOpenItemId;
    const paymentId = body.paymentId || (allocationSourceType === 'PAYMENT' ? bodyAny.sourceId : undefined);
    const creditNoteId = body.creditNoteId || (allocationSourceType === 'CREDIT_NOTE' ? bodyAny.sourceId : undefined);

    const input: CreateApAllocationInput = {
      ...body,
      allocationSourceType,
      openItemId,
      ...(paymentId ? { paymentId } : {}),
      ...(creditNoteId ? { creditNoteId } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {})
    };

    const allocation = await apAllocationService.allocate(ctx, input);
    return reply.status(201).send({ data: allocation });
  });

  // Get AP Allocation by ID
  fastify.get('/api/v1/finance/ap/allocations/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const allocation = await apAllocationService.getAllocation(ctx, id);
    validateCompanyScope(ctx, allocation.companyId);

    return reply.send({ data: allocation });
  });

  // List AP Allocations
  fastify.get('/api/v1/finance/ap/allocations', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      supplierId?: string;
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
    const filters: ApAllocationFilterInput = {
      ...(openItemId ? { openItemId } : {}),
      ...(query.status ? { status: query.status as any } : {}),
      ...(query.sourceType ? { allocationSourceType: query.sourceType as any } : {}),
      ...(query.sourceType === 'PAYMENT' && query.sourceId ? { paymentId: query.sourceId } : {}),
      ...(query.sourceType === 'CREDIT_NOTE' && query.sourceId ? { creditNoteId: query.sourceId } : {})
    };

    const allocations = await apAllocationService.listAllocations(ctx, companyId, filters);

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

  // Reverse AP Allocation
  fastify.post('/api/v1/finance/ap/allocations/:id/reverse', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as { reason?: string };

    const idempotencyKey = (req.headers['idempotency-key'] as string);

    const input: ReverseApAllocationInput = {
      allocationId: id,
      reason: body.reason || 'Reversed via API',
      ...(idempotencyKey ? { idempotencyKey } : {})
    };

    const reversed = await apAllocationService.reverseAllocation(ctx, input);
    return reply.send({ data: reversed });
  });

  // ==========================================
  // 4. AP ADJUSTMENTS
  // ==========================================

  // Create Draft AP Adjustment
  fastify.post('/api/v1/finance/ap/adjustments', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as CreateApAdjustmentInput;
    if (!body) {
      throw new ValidationError('Request body is required.');
    }

    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    let supplierId = body.supplierId;
    if (!supplierId && body.openItemId) {
      const openItem = await apDocumentService.getOpenItem(ctx, body.openItemId);
      supplierId = openItem.supplierId;
    }

    const input: CreateApAdjustmentInput = {
      ...body,
      companyId,
      supplierId: supplierId!
    };

    const adjustment = await apAdjustmentService.createDraftAdjustment(ctx, input);
    return reply.status(201).send({ data: adjustment });
  });

  // Get AP Adjustment by ID
  fastify.get('/api/v1/finance/ap/adjustments/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const adjustment = await apAdjustmentService.getAdjustment(ctx, id);
    validateCompanyScope(ctx, adjustment.companyId);

    return reply.send({ data: adjustment });
  });

  // List AP Adjustments
  fastify.get('/api/v1/finance/ap/adjustments', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      supplierId?: string;
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

    const adjustments = await apAdjustmentService.listAdjustments(ctx, companyId, {
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
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

  // Post Draft AP Adjustment
  fastify.post('/api/v1/finance/ap/adjustments/:id/post', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as PostApAdjustmentInput;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || body.idempotencyKey;

    const postInput: PostApAdjustmentInput = {
      ...body,
      ...(idempotencyKey ? { idempotencyKey } : {})
    };

    const posted = await apAdjustmentService.postAdjustment(ctx, id, postInput);
    return reply.send({ data: posted });
  });

  // Reverse Posted AP Adjustment
  fastify.post('/api/v1/finance/ap/adjustments/:id/reverse', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as ReverseApAdjustmentInput;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || body.idempotencyKey;

    const bodyAny = body as any;
    const reverseInput: ReverseApAdjustmentInput = {
      reason: body.reason || 'Reversed via API',
      ...(body.reversalAccountingDate || bodyAny.reversalDate ? { reversalAccountingDate: body.reversalAccountingDate || bodyAny.reversalDate } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {})
    };

    const reversed = await apAdjustmentService.reverseAdjustment(ctx, id, reverseInput);
    return reply.send({ data: reversed });
  });

  // Cancel Draft AP Adjustment
  fastify.post('/api/v1/finance/ap/adjustments/:id/cancel', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const cancelled = await apAdjustmentService.cancelAdjustment(ctx, id);
    return reply.send({ data: cancelled });
  });

  // ==========================================
  // 5. AP SETTLEMENT & RECONCILIATION
  // ==========================================

  // Get Open Item Settlement Details
  fastify.get('/api/v1/finance/ap/settlement/open-items/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const query = req.query as { mode?: 'LIVE' | 'HISTORICAL'; asOfDate?: string };

    if (query.mode === 'HISTORICAL' || query.asOfDate) {
      const asOfDate = query.asOfDate || new Date().toISOString().split('T')[0]!;
      const settlement = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, id, asOfDate);
      return reply.send({ data: settlement });
    }

    const settlement = await apSettlementService.getOpenItemSettlement(ctx, id);
    return reply.send({ data: settlement });
  });

  // Get Source Utilization Details
  fastify.get('/api/v1/finance/ap/settlement/sources/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const query = req.query as { sourceType?: 'PAYMENT' | 'CREDIT_NOTE'; mode?: 'LIVE' | 'HISTORICAL'; asOfDate?: string };

    const sourceType = query.sourceType || 'PAYMENT';

    if (query.mode === 'HISTORICAL' || query.asOfDate) {
      const asOfDate = query.asOfDate || new Date().toISOString().split('T')[0]!;
      const utilization = await apHistoricalSettlementService.getHistoricalSourceUtilization(ctx, sourceType, id, asOfDate);
      return reply.send({ data: utilization });
    }

    const utilization = await apSettlementService.getSourceUtilization(ctx, sourceType, id);
    return reply.send({ data: utilization });
  });

  // Get Supplier Settlement Summary
  fastify.get('/api/v1/finance/ap/settlement/suppliers/:supplierId', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { supplierId } = req.params as { supplierId: string };
    const query = req.query as { companyId?: string; mode?: 'LIVE' | 'HISTORICAL'; asOfDate?: string };

    const companyId = query.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const effectiveCtx = { ...ctx, companyId };

    if (query.mode === 'HISTORICAL' || query.asOfDate) {
      const asOfDate = query.asOfDate || new Date().toISOString().split('T')[0]!;
      const summary = await apHistoricalSettlementService.getHistoricalSupplierSettlementSummary(effectiveCtx, supplierId, asOfDate);
      return reply.send({ data: summary });
    }

    const summary = await apSettlementService.getSupplierSettlementSummary(effectiveCtx, supplierId);
    return reply.send({ data: summary });
  });

  // Reconcile Company AP Position (POST & GET)
  const handleReconciliation = async (req: FastifyRequest, reply: any) => {
    const ctx = getRequestContext(req);
    const body = (req.body || {}) as { companyId?: string; asOfDate?: string; mode?: string };
    const query = (req.query || {}) as { companyId?: string; asOfDate?: string; mode?: string };

    const companyId = body.companyId || query.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const asOfDate = body.asOfDate || query.asOfDate;
    const reconciliation = await apReconciliationService.reconcileCompanyAP(ctx, companyId, asOfDate);
    return reply.send({ data: reconciliation });
  };

  fastify.post('/api/v1/finance/ap/reconciliation', handleReconciliation);
  fastify.get('/api/v1/finance/ap/reconciliation', handleReconciliation);

  // ==========================================
  // 6. AP AGING
  // ==========================================

  // Company-Level AP Aging Summary
  fastify.get('/api/v1/finance/ap/aging', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as { companyId?: string; asOfDate?: string };

    const companyId = query.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const companyAging = await apAgingService.getCompanyAging(ctx, companyId, query.asOfDate);
    return reply.send({ data: companyAging });
  });

  // Open Item AP Aging Detail
  fastify.get('/api/v1/finance/ap/aging/open-items', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as { openItemId?: string; asOfDate?: string };

    if (!query.openItemId) {
      throw new ValidationError('openItemId query parameter is required.');
    }

    const openItemAging = await apAgingService.getOpenItemAging(ctx, query.openItemId, query.asOfDate);
    return reply.send({ data: openItemAging });
  });

  // Supplier-Level AP Aging Summary
  fastify.get('/api/v1/finance/ap/aging/suppliers/:supplierId', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { supplierId } = req.params as { supplierId: string };
    const query = req.query as { companyId?: string; asOfDate?: string };

    const companyId = query.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const supplierAging = await apAgingService.getSupplierAging(ctx, companyId, supplierId, query.asOfDate);
    return reply.send({ data: supplierAging });
  });

  // ==========================================
  // 7. SUPPLIER ACCOUNT STATEMENTS
  // ==========================================

  // Get Supplier Account Statement
  fastify.get('/api/v1/finance/ap/statements/suppliers/:supplierId', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { supplierId } = req.params as { supplierId: string };
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

    const statement = await apStatementService.getSupplierStatement(ctx, companyId, {
      supplierId,
      fromDate,
      toDate,
      ...(query.branchId ? { branchId: query.branchId } : {})
    });
    return reply.send({ data: statement });
  });
}
