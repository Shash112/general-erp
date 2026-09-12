import { FastifyInstance, FastifyRequest } from 'fastify';
import { RequestContext, ValidationError, ForbiddenError, ExactDecimal } from '@general-erp/core';
import { taxEngineService } from '../modules/finance/tax-engine.service.js';
import { taxCalculationService } from '../modules/finance/tax-calculation.service.js';
import { accountingCoreService, PostTaxAccountingEventInput, ReverseAccountingEventInput } from '../modules/finance/accounting-core.service.js';

function getRequestContext(req: FastifyRequest): RequestContext {
  const tenantId = (req.headers['x-tenant-id'] as string) || 'tenant_default';
  const companyId = (req.headers['x-company-id'] as string) || 'company_default';

  const userId = req.headers['x-user-id'] as string | undefined;
  const roles = (req.headers['x-user-roles'] as string)?.split(',') || ['tax_user'];
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

export async function taxRoutes(fastify: FastifyInstance) {

  const validateCompanyScope = (ctx: RequestContext, companyId?: string) => {
    if (companyId && ctx.companyId && companyId !== ctx.companyId && ctx.companyId !== 'company_default') {
      throw new ForbiddenError(`Company scope mismatch: Request context company '${ctx.companyId}' cannot access requested company '${companyId}'.`);
    }
  };

  // 1. Resolve HSN/SAC
  fastify.post('/api/v1/finance/tax/hsn-sac/resolve', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as { companyId?: string; code: string; type?: 'HSN' | 'SAC' };

    if (!body || !body.code) {
      throw new ValidationError('HSN/SAC code is required.');
    }

    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const result = await taxEngineService.resolveHSNSAC(ctx, body.code, body.type);
    return reply.send({ data: result });
  });

  // 2. Resolve Tax Category
  fastify.post('/api/v1/finance/tax/categories/resolve', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as { companyId?: string; taxCategoryId?: string; code?: string };

    if (!body || (!body.taxCategoryId && !body.code)) {
      throw new ValidationError('Either taxCategoryId or code must be provided.');
    }

    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const identifier = body.taxCategoryId || body.code!;
    const result = await taxEngineService.resolveTaxCategory(ctx, identifier);

    return reply.send({ data: result });
  });

  // 3. Resolve Effective Tax Rates
  fastify.post('/api/v1/finance/tax/rates/resolve', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as { companyId?: string; taxCategoryId: string; transactionDate: string };

    if (!body || !body.taxCategoryId || !body.transactionDate) {
      throw new ValidationError('taxCategoryId and transactionDate are required.');
    }

    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const rates = await taxEngineService.resolveTaxRates(ctx, body.taxCategoryId, body.transactionDate);
    return reply.send({ data: rates });
  });

  // 4. Resolve Tax Rules
  fastify.post('/api/v1/finance/tax/rules/resolve', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as {
      companyId?: string;
      transactionDate: string;
      taxCategoryId?: string;
      hsnSacCodeId?: string;
      supplyType?: string;
    };

    if (!body || !body.transactionDate) {
      throw new ValidationError('transactionDate is required.');
    }

    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const rules = await taxEngineService.resolveTaxRules(ctx, {
      transactionDate: body.transactionDate,
      ...(body.taxCategoryId ? { taxCategoryId: body.taxCategoryId } : {}),
      ...(body.hsnSacCodeId ? { hsnSacCodeId: body.hsnSacCodeId } : {}),
      ...(body.supplyType ? { supplyType: body.supplyType } : {})
    });

    return reply.send({ data: rules });
  });

  // 5. Resolve Tax Matrix
  fastify.post('/api/v1/finance/tax/matrix/resolve', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as {
      companyId?: string;
      transactionDate: string;
      taxCategoryId?: string;
      hsnSacCode?: string;
      hsnSacType?: 'HSN' | 'SAC';
      supplyType?: string;
    };

    if (!body || !body.transactionDate) {
      throw new ValidationError('transactionDate is required.');
    }

    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const matrix = await taxEngineService.resolveTaxMatrix(ctx, {
      companyId,
      transactionDate: body.transactionDate,
      ...(body.taxCategoryId ? { taxCategoryId: body.taxCategoryId } : {}),
      ...(body.hsnSacCode ? { hsnSacCode: body.hsnSacCode } : {}),
      ...(body.hsnSacType ? { hsnSacType: body.hsnSacType } : {}),
      ...(body.supplyType ? { supplyType: body.supplyType } : {})
    });

    return reply.send({ data: matrix });
  });

  // 6. Resolve Place of Supply
  fastify.post('/api/v1/finance/tax/pos/resolve', async (req, reply) => {
    const body = req.body as {
      supplierStateCode: string;
      recipientStateCode: string;
      placeOfSupplyStateCode?: string;
      isSez?: boolean;
      isDeemedExport?: boolean;
      isImport?: boolean;
    };

    if (!body || !body.supplierStateCode || !body.recipientStateCode) {
      throw new ValidationError('supplierStateCode and recipientStateCode are required.');
    }

    const posResult = taxEngineService.resolvePlaceOfSupply(body);
    return reply.send({ data: posResult });
  });

  // 7. Resolve Tax Treatment
  fastify.post('/api/v1/finance/tax/treatment/resolve', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as {
      companyId?: string;
      transactionDate: string;
      taxCategoryId?: string;
      hsnSacCode?: string;
      hsnSacType?: 'HSN' | 'SAC';
      supplierStateCode: string;
      recipientStateCode: string;
      placeOfSupplyStateCode?: string;
      isSez?: boolean;
      isDeemedExport?: boolean;
      isImport?: boolean;
      isRcm?: boolean;
    };

    if (!body || !body.transactionDate || !body.supplierStateCode || !body.recipientStateCode) {
      throw new ValidationError('transactionDate, supplierStateCode, and recipientStateCode are required.');
    }

    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const treatment = await taxEngineService.resolveTaxTreatment(ctx, {
      ...body,
      companyId
    });

    return reply.send({ data: treatment });
  });

  // 8. Calculate Tax
  fastify.post('/api/v1/finance/tax/calculate', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as {
      amount: string;
      calculationMode: 'EXCLUSIVE' | 'INCLUSIVE';
      treatment: any;
    };

    if (!body || !body.amount || !body.calculationMode || !body.treatment) {
      throw new ValidationError('amount, calculationMode, and treatment are required.');
    }

    if (body.calculationMode !== 'EXCLUSIVE' && body.calculationMode !== 'INCLUSIVE') {
      throw new ValidationError(`Invalid calculationMode '${body.calculationMode}'. Must be 'EXCLUSIVE' or 'INCLUSIVE'.`);
    }

    ExactDecimal.validateScale(body.amount, 2);
    const parsedDec = ExactDecimal.parse(body.amount, 2);
    if (parsedDec.isNegative()) {
      throw new ValidationError('Tax calculation amount cannot be negative.');
    }

    const calcResult = taxCalculationService.calculateTax(ctx, {
      amount: body.amount,
      calculationMode: body.calculationMode,
      treatment: body.treatment
    });

    return reply.send({ data: calcResult });
  });

  // 9. Process Tax Accounting Event
  fastify.post('/api/v1/finance/tax/accounting/events', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as PostTaxAccountingEventInput;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || body.idempotencyKey;

    if (!body || !body.taxCalculation || !body.direction || !body.baseAccountId || !body.offsetAccountId) {
      throw new ValidationError('taxCalculation, direction, baseAccountId, and offsetAccountId are required.');
    }

    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const input: PostTaxAccountingEventInput = {
      ...body,
      companyId,
      ...(idempotencyKey ? { idempotencyKey } : {})
    };

    const journalEntry = await accountingCoreService.processTaxAccountingEvent(ctx, input);
    return reply.status(201).send({ data: journalEntry });
  });

  // 10. Reverse Tax Accounting Event
  fastify.post('/api/v1/finance/tax/accounting/reverse', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as ReverseAccountingEventInput;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || body.idempotencyKey;

    if (!body || !body.originalJournalId || !body.reason) {
      throw new ValidationError('originalJournalId and reason are required.');
    }

    const input: ReverseAccountingEventInput = {
      ...body,
      ...(idempotencyKey ? { idempotencyKey } : {})
    };

    const reversedEntry = await accountingCoreService.reverseAccountingEvent(ctx, input);
    return reply.send({ data: reversedEntry });
  });
}
