import {
  RequestContext,
  ExactDecimal,
  ValidationError,
  NotFoundError,
  BusinessRuleViolationError
} from '@general-erp/core';
import { authorizationService } from '../../platform/authorization/authorization.service.js';
import { auditService } from '../../platform/audit/audit.service.js';
import { numberingEngine } from '../../platform/numbering/numbering.service.js';
import {
  getDb,
  procurementRfqs,
  procurementRfqLines,
  procurementRfqSuppliers,
  procurementSupplierQuotations,
  procurementSupplierQuotationLines,
  procurementQuotationComparisons,
  procurementQuotationComparisonLines,
  companies,
  eq,
  and,
  ProcurementRfq,
  ProcurementRfqLine,
  ProcurementRfqSupplier,
  ProcurementSupplierQuotation,
  ProcurementSupplierQuotationLine,
  ProcurementQuotationComparison,
  ProcurementQuotationComparisonLine
} from '@general-erp/database';

// In-Memory Fallback Stores for Sourcing (for non-DB integration/unit testing)
const inMemoryRfqs: ProcurementRfq[] = [];
const inMemoryRfqLines: ProcurementRfqLine[] = [];
const inMemoryRfqSuppliers: ProcurementRfqSupplier[] = [];
const inMemoryQuotations: ProcurementSupplierQuotation[] = [];
const inMemoryQuotationLines: ProcurementSupplierQuotationLine[] = [];
const inMemoryComparisons: ProcurementQuotationComparison[] = [];
const inMemoryComparisonLines: ProcurementQuotationComparisonLine[] = [];

// ============================================================================
// Interfaces
// ============================================================================

export interface CreateRfqLineInput {
  purchaseRequestLineId?: string | null;
  productId?: string | null;
  description: string;
  specification?: string | null;
  requestedQuantity: string;
  uom: string;
  targetDate?: string | null;
  notes?: string | null;
}

export interface CreateRfqInput {
  companyId: string;
  branchId?: string | null;
  departmentId?: string | null;
  purchaseRequestId?: string | null;
  rfqDate?: string;
  responseDueDate: string;
  title: string;
  purpose?: string | null;
  instructions?: string | null;
  terms?: string | null;
  currency?: string;
  notes?: string | null;
  invitedSupplierIds?: string[];
  lines: CreateRfqLineInput[];
}

export interface CreateSupplierQuotationLineInput {
  rfqLineId?: string | null;
  productId?: string | null;
  description: string;
  quotedQuantity: string;
  uom: string;
  unitPrice: string;
  discount?: string;
  tax?: string;
  deliveryDate?: string | null;
  leadTimeDays?: number | null;
  specification?: string | null;
  notes?: string | null;
}

export interface CreateSupplierQuotationInput {
  companyId: string;
  supplierId: string;
  rfqId?: string | null;
  supplierQuoteNumber: string;
  quotationDate?: string;
  validUntil: string;
  currency?: string;
  exchangeRate?: string;
  paymentTerms?: string | null;
  deliveryTerms?: string | null;
  warrantyTerms?: string | null;
  shippingTerms?: string | null;
  notes?: string | null;
  lines: CreateSupplierQuotationLineInput[];
}

export interface AwardQuotationInput {
  comparisonId: string;
  awardedSupplierId: string;
  awardedLineIds: { rfqLineId: string; supplierQuotationLineId: string; awardQuantity: string }[];
  evaluationNotes?: string;
}

export class SourcingService {
  // ==========================================================================
  // RFQ DOMAIN METHODS
  // ==========================================================================

  public async createRfq(
    ctx: RequestContext,
    input: CreateRfqInput
  ): Promise<{ rfq: ProcurementRfq; lines: ProcurementRfqLine[]; suppliers: ProcurementRfqSupplier[] }> {
    if (ctx.user) {
      authorizationService.authorize({ user: ctx.user, action: 'procurement:rfq:create', companyId: input.companyId });
    }

    if (!input.title || input.title.trim() === '') {
      throw new ValidationError('RFQ title is required');
    }

    if (!input.lines || input.lines.length === 0) {
      throw new ValidationError('RFQ must contain at least one line item');
    }

    const rfqDate = input.rfqDate || new Date().toISOString().substring(0, 10);
    if (input.responseDueDate < rfqDate) {
      throw new ValidationError('Response due date cannot be earlier than RFQ date');
    }

    // Validate quantities
    for (const [idx, line] of input.lines.entries()) {
      const qty = ExactDecimal.parse(line.requestedQuantity, 4);
      if (qty.isNegative() || qty.isZero()) {
        throw new ValidationError(`Line ${idx + 1}: requested quantity must be positive`);
      }
      if (!line.description || line.description.trim() === '') {
        throw new ValidationError(`Line ${idx + 1}: description is required`);
      }
      if (!line.uom || line.uom.trim() === '') {
        throw new ValidationError(`Line ${idx + 1}: UOM is required`);
      }
    }

    const id = `rfq_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let rfqNumber = '';
    try {
      rfqNumber = numberingEngine.generateNextNumber(
        ctx.tenantId,
        input.companyId,
        'RFQ',
        new Date().getFullYear().toString()
      );
    } catch {
      const year = new Date().getFullYear();
      const rand = Math.floor(1000 + Math.random() * 9000);
      rfqNumber = `RFQ-${year}-${rand}`;
    }

    const rfqHeader: ProcurementRfq = {
      id,
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      branchId: input.branchId || null,
      departmentId: input.departmentId || null,
      purchaseRequestId: input.purchaseRequestId || null,
      rfqNumber,
      rfqDate,
      responseDueDate: input.responseDueDate,
      title: input.title.trim(),
      purpose: input.purpose || null,
      instructions: input.instructions || null,
      terms: input.terms || null,
      currency: input.currency || 'INR',
      status: 'DRAFT',
      notes: input.notes || null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: ctx.user?.userId || 'system',
      updatedBy: ctx.user?.userId || 'system'
    };

    const rfqLineEntities: ProcurementRfqLine[] = input.lines.map((l, idx) => ({
      id: `rfq_line_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 5)}`,
      rfqId: id,
      lineNumber: idx + 1,
      purchaseRequestLineId: l.purchaseRequestLineId || null,
      productId: l.productId || null,
      description: l.description.trim(),
      specification: l.specification || null,
      requestedQuantity: l.requestedQuantity,
      uom: l.uom.trim(),
      targetDate: l.targetDate || null,
      notes: l.notes || null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    const invitedSuppliers: ProcurementRfqSupplier[] = (input.invitedSupplierIds || []).map((supId) => ({
      id: `rfq_sup_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      rfqId: id,
      supplierId: supId,
      status: 'INVITED',
      invitedAt: new Date(),
      respondedAt: null,
      notes: null
    }));

    const db = getDb();
    if (db) {
      const [comp] = await db.select().from(companies).where(
        and(eq(companies.id, input.companyId), eq(companies.tenantId, ctx.tenantId))
      );
      if (!comp) {
        throw new NotFoundError(`Company ${input.companyId} not found`);
      }

      await db.transaction(async (tx) => {
        await tx.insert(procurementRfqs).values(rfqHeader);
        await tx.insert(procurementRfqLines).values(rfqLineEntities);
        if (invitedSuppliers.length > 0) {
          await tx.insert(procurementRfqSuppliers).values(invitedSuppliers);
        }
      });
    } else {
      inMemoryRfqs.push(rfqHeader);
      inMemoryRfqLines.push(...rfqLineEntities);
      inMemoryRfqSuppliers.push(...invitedSuppliers);
    }

    auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'ProcurementRfq',
      entityId: id,
      action: 'CREATE',
      newValues: { rfqNumber, title: rfqHeader.title, status: rfqHeader.status }
    });

    return { rfq: rfqHeader, lines: rfqLineEntities, suppliers: invitedSuppliers };
  }

  public async publishRfq(ctx: RequestContext, id: string): Promise<ProcurementRfq> {
    const { rfq } = await this.getRfqById(ctx, id);
    if (ctx.user) {
      authorizationService.authorize({ user: ctx.user, action: 'procurement:rfq:publish', companyId: rfq.companyId });
    }

    if (rfq.status !== 'DRAFT') {
      throw new BusinessRuleViolationError(`Cannot publish RFQ in '${rfq.status}' status`);
    }

    rfq.status = 'PUBLISHED';
    rfq.updatedAt = new Date();
    rfq.version += 1;

    const db = getDb();
    if (db) {
      await db.update(procurementRfqs)
        .set({ status: 'PUBLISHED', version: rfq.version, updatedAt: rfq.updatedAt })
        .where(eq(procurementRfqs.id, id));
    }

    auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'ProcurementRfq',
      entityId: id,
      action: 'PUBLISH',
      newValues: { status: 'PUBLISHED' }
    });

    return rfq;
  }

  public async closeRfq(ctx: RequestContext, id: string): Promise<ProcurementRfq> {
    const { rfq } = await this.getRfqById(ctx, id);
    if (ctx.user) {
      authorizationService.authorize({ user: ctx.user, action: 'procurement:rfq:close', companyId: rfq.companyId });
    }

    if (rfq.status !== 'PUBLISHED' && rfq.status !== 'RESPONSE_OPEN') {
      throw new BusinessRuleViolationError(`Cannot close RFQ in '${rfq.status}' status`);
    }

    rfq.status = 'RESPONSE_CLOSED';
    rfq.updatedAt = new Date();
    rfq.version += 1;

    const db = getDb();
    if (db) {
      await db.update(procurementRfqs)
        .set({ status: 'RESPONSE_CLOSED', version: rfq.version, updatedAt: rfq.updatedAt })
        .where(eq(procurementRfqs.id, id));
    }

    auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'ProcurementRfq',
      entityId: id,
      action: 'CLOSE',
      newValues: { status: 'RESPONSE_CLOSED' }
    });

    return rfq;
  }

  public async cancelRfq(ctx: RequestContext, id: string, reason?: string): Promise<ProcurementRfq> {
    const { rfq } = await this.getRfqById(ctx, id);
    if (ctx.user) {
      authorizationService.authorize({ user: ctx.user, action: 'procurement:rfq:cancel', companyId: rfq.companyId });
    }

    if (rfq.status === 'AWARDED' || rfq.status === 'CANCELLED') {
      throw new BusinessRuleViolationError(`Cannot cancel RFQ in '${rfq.status}' status`);
    }

    rfq.status = 'CANCELLED';
    rfq.notes = reason ? `Cancelled: ${reason}` : rfq.notes;
    rfq.updatedAt = new Date();
    rfq.version += 1;

    const db = getDb();
    if (db) {
      await db.update(procurementRfqs)
        .set({ status: 'CANCELLED', notes: rfq.notes, version: rfq.version, updatedAt: rfq.updatedAt })
        .where(eq(procurementRfqs.id, id));
    }

    auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'ProcurementRfq',
      entityId: id,
      action: 'CANCEL',
      newValues: { status: 'CANCELLED', reason }
    });

    return rfq;
  }

  public async getRfqById(
    ctx: RequestContext,
    id: string
  ): Promise<{ rfq: ProcurementRfq; lines: ProcurementRfqLine[]; suppliers: ProcurementRfqSupplier[] }> {
    const db = getDb();
    if (db) {
      const [rfq] = await db.select().from(procurementRfqs).where(
        and(eq(procurementRfqs.id, id), eq(procurementRfqs.tenantId, ctx.tenantId))
      );
      if (!rfq) {
        throw new NotFoundError(`RFQ ${id} not found`);
      }
      const lines = await db.select().from(procurementRfqLines).where(eq(procurementRfqLines.rfqId, id));
      const sups = await db.select().from(procurementRfqSuppliers).where(eq(procurementRfqSuppliers.rfqId, id));
      return { rfq, lines, suppliers: sups };
    }

    const rfq = inMemoryRfqs.find((r) => r.id === id && r.tenantId === ctx.tenantId);
    if (!rfq) {
      throw new NotFoundError(`RFQ ${id} not found`);
    }
    const lines = inMemoryRfqLines.filter((l) => l.rfqId === id);
    const sups = inMemoryRfqSuppliers.filter((s) => s.rfqId === id);
    return { rfq, lines, suppliers: sups };
  }

  public async listRfqs(ctx: RequestContext, companyId?: string, status?: string): Promise<ProcurementRfq[]> {
    const db = getDb();
    if (db) {
      const conditions = [eq(procurementRfqs.tenantId, ctx.tenantId)];
      if (companyId) conditions.push(eq(procurementRfqs.companyId, companyId));
      if (status) conditions.push(eq(procurementRfqs.status, status));
      return await db.select().from(procurementRfqs).where(and(...conditions));
    }

    return inMemoryRfqs.filter((r) => {
      if (r.tenantId !== ctx.tenantId) return false;
      if (companyId && r.companyId !== companyId) return false;
      if (status && r.status !== status) return false;
      return true;
    });
  }

  // ==========================================================================
  // SUPPLIER QUOTATION DOMAIN METHODS
  // ==========================================================================

  public async createSupplierQuotation(
    ctx: RequestContext,
    input: CreateSupplierQuotationInput
  ): Promise<{ quotation: ProcurementSupplierQuotation; lines: ProcurementSupplierQuotationLine[] }> {
    if (ctx.user) {
      authorizationService.authorize({ user: ctx.user, action: 'procurement:quotation:create', companyId: input.companyId });
    }

    if (!input.supplierId) {
      throw new ValidationError('Supplier ID is required');
    }
    if (!input.supplierQuoteNumber || input.supplierQuoteNumber.trim() === '') {
      throw new ValidationError('Supplier quote number is required');
    }
    if (!input.lines || input.lines.length === 0) {
      throw new ValidationError('Supplier quotation must contain at least one line item');
    }

    const quotationDate = input.quotationDate || new Date().toISOString().substring(0, 10);
    if (input.validUntil < quotationDate) {
      throw new ValidationError('Quotation validity date cannot be earlier than quotation date');
    }

    let subtotalAcc = ExactDecimal.parse('0.00', 2);
    let taxAcc = ExactDecimal.parse('0.00', 2);
    let discountAcc = ExactDecimal.parse('0.00', 2);

    const lineEntities: ProcurementSupplierQuotationLine[] = [];
    const sqId = `sq_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    for (const [idx, l] of input.lines.entries()) {
      const qty = ExactDecimal.parse(l.quotedQuantity, 4);
      const unitPrice = ExactDecimal.parse(l.unitPrice, 2);
      if (qty.isNegative() || qty.isZero()) {
        throw new ValidationError(`Line ${idx + 1}: quoted quantity must be positive`);
      }
      if (unitPrice.isNegative()) {
        throw new ValidationError(`Line ${idx + 1}: unit price cannot be negative`);
      }

      const disc = l.discount ? ExactDecimal.parse(l.discount, 2) : ExactDecimal.parse('0.00', 2);
      const grossLine = ExactDecimal.halfEvenRound(qty.rawBigInt * unitPrice.rawBigInt, 6, 2);
      const taxable = grossLine.sub(disc);
      const lineTax = l.tax ? ExactDecimal.parse(l.tax, 2) : ExactDecimal.parse('0.00', 2);
      const lineTotal = taxable.add(lineTax);

      subtotalAcc = subtotalAcc.add(taxable);
      taxAcc = taxAcc.add(lineTax);
      discountAcc = discountAcc.add(disc);

      lineEntities.push({
        id: `sq_line_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 5)}`,
        supplierQuotationId: sqId,
        lineNumber: idx + 1,
        rfqLineId: l.rfqLineId || null,
        productId: l.productId || null,
        description: l.description.trim(),
        quotedQuantity: l.quotedQuantity,
        uom: l.uom.trim(),
        unitPrice: unitPrice.toString(),
        discount: disc.toString(),
        taxableAmount: taxable.toString(),
        tax: lineTax.toString(),
        lineTotal: lineTotal.toString(),
        deliveryDate: l.deliveryDate || null,
        leadTimeDays: l.leadTimeDays || null,
        specification: l.specification || null,
        notes: l.notes || null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    const totalVal = subtotalAcc.add(taxAcc);

    let internalQuoteNumber = '';
    try {
      internalQuoteNumber = numberingEngine.generateNextNumber(
        ctx.tenantId,
        input.companyId,
        'SUPPLIER_QUOTATION',
        new Date().getFullYear().toString()
      );
    } catch {
      const year = new Date().getFullYear();
      const rand = Math.floor(1000 + Math.random() * 9000);
      internalQuoteNumber = `SQ-${year}-${rand}`;
    }

    const quoteHeader: ProcurementSupplierQuotation = {
      id: sqId,
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      supplierId: input.supplierId,
      rfqId: input.rfqId || null,
      supplierQuoteNumber: input.supplierQuoteNumber.trim(),
      internalQuoteNumber,
      quotationDate,
      validUntil: input.validUntil,
      currency: input.currency || 'INR',
      exchangeRate: input.exchangeRate || '1.000000',
      paymentTerms: input.paymentTerms || null,
      deliveryTerms: input.deliveryTerms || null,
      warrantyTerms: input.warrantyTerms || null,
      shippingTerms: input.shippingTerms || null,
      subtotal: subtotalAcc.toString(),
      discount: discountAcc.toString(),
      tax: taxAcc.toString(),
      total: totalVal.toString(),
      status: 'SUBMITTED',
      notes: input.notes || null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: ctx.user?.userId || 'system',
      updatedBy: ctx.user?.userId || 'system'
    };

    const db = getDb();
    if (db) {
      await db.transaction(async (tx) => {
        await tx.insert(procurementSupplierQuotations).values(quoteHeader);
        await tx.insert(procurementSupplierQuotationLines).values(lineEntities);

        if (input.rfqId) {
          await tx.update(procurementRfqs)
            .set({ status: 'RESPONSE_OPEN', updatedAt: new Date() })
            .where(eq(procurementRfqs.id, input.rfqId));
        }
      });
    } else {
      inMemoryQuotations.push(quoteHeader);
      inMemoryQuotationLines.push(...lineEntities);
      if (input.rfqId) {
        const targetRfq = inMemoryRfqs.find((r) => r.id === input.rfqId);
        if (targetRfq && targetRfq.status === 'PUBLISHED') {
          targetRfq.status = 'RESPONSE_OPEN';
        }
      }
    }

    auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'ProcurementSupplierQuotation',
      entityId: sqId,
      action: 'CREATE',
      newValues: { internalQuoteNumber, supplierQuoteNumber: quoteHeader.supplierQuoteNumber, total: quoteHeader.total }
    });

    return { quotation: quoteHeader, lines: lineEntities };
  }

  public async getSupplierQuotationById(
    ctx: RequestContext,
    id: string
  ): Promise<{ quotation: ProcurementSupplierQuotation; lines: ProcurementSupplierQuotationLine[] }> {
    const db = getDb();
    if (db) {
      const [quotation] = await db.select().from(procurementSupplierQuotations).where(
        and(eq(procurementSupplierQuotations.id, id), eq(procurementSupplierQuotations.tenantId, ctx.tenantId))
      );
      if (!quotation) {
        throw new NotFoundError(`Supplier quotation ${id} not found`);
      }
      const lines = await db.select().from(procurementSupplierQuotationLines).where(
        eq(procurementSupplierQuotationLines.supplierQuotationId, id)
      );
      return { quotation, lines };
    }

    const quotation = inMemoryQuotations.find((q) => q.id === id && q.tenantId === ctx.tenantId);
    if (!quotation) {
      throw new NotFoundError(`Supplier quotation ${id} not found`);
    }
    const lines = inMemoryQuotationLines.filter((l) => l.supplierQuotationId === id);
    return { quotation, lines };
  }

  public async listSupplierQuotations(
    ctx: RequestContext,
    companyId?: string,
    rfqId?: string,
    supplierId?: string
  ): Promise<ProcurementSupplierQuotation[]> {
    const db = getDb();
    if (db) {
      const conditions = [eq(procurementSupplierQuotations.tenantId, ctx.tenantId)];
      if (companyId) conditions.push(eq(procurementSupplierQuotations.companyId, companyId));
      if (rfqId) conditions.push(eq(procurementSupplierQuotations.rfqId, rfqId));
      if (supplierId) conditions.push(eq(procurementSupplierQuotations.supplierId, supplierId));
      return await db.select().from(procurementSupplierQuotations).where(and(...conditions));
    }

    return inMemoryQuotations.filter((q) => {
      if (q.tenantId !== ctx.tenantId) return false;
      if (companyId && q.companyId !== companyId) return false;
      if (rfqId && q.rfqId !== rfqId) return false;
      if (supplierId && q.supplierId !== supplierId) return false;
      return true;
    });
  }

  // ==========================================================================
  // QUOTATION COMPARISON & AWARD DOMAIN METHODS
  // ==========================================================================

  public async buildComparison(
    ctx: RequestContext,
    rfqId: string
  ): Promise<{ comparison: ProcurementQuotationComparison; lines: ProcurementQuotationComparisonLine[] }> {
    const { rfq } = await this.getRfqById(ctx, rfqId);
    const quotes = await this.listSupplierQuotations(ctx, rfq.companyId, rfqId);

    if (quotes.length === 0) {
      throw new BusinessRuleViolationError(`No supplier quotations submitted for RFQ ${rfq.rfqNumber}`);
    }

    const compId = `comp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const compHeader: ProcurementQuotationComparison = {
      id: compId,
      tenantId: ctx.tenantId,
      companyId: rfq.companyId,
      rfqId,
      comparisonDate: new Date().toISOString().substring(0, 10),
      status: 'EVALUATED',
      evaluationNotes: null,
      awardedSupplierId: null,
      awardedAt: null,
      awardedBy: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: ctx.user?.userId || 'system',
      updatedBy: ctx.user?.userId || 'system'
    };

    const compLines: ProcurementQuotationComparisonLine[] = [];

    for (const q of quotes) {
      const { lines: qLines } = await this.getSupplierQuotationById(ctx, q.id);
      for (const ql of qLines) {
        if (ql.rfqLineId) {
          compLines.push({
            id: `comp_line_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
            comparisonId: compId,
            rfqLineId: ql.rfqLineId,
            supplierQuotationId: q.id,
            supplierQuotationLineId: ql.id,
            supplierId: q.supplierId,
            quotedUnitPrice: ql.unitPrice,
            quotedQuantity: ql.quotedQuantity,
            quotedLineTotal: ql.lineTotal,
            isAwarded: false,
            awardQuantity: '0.0000',
            rejectionReason: null,
            evaluationNotes: null
          });
        }
      }
    }

    const db = getDb();
    if (db) {
      await db.transaction(async (tx) => {
        await tx.insert(procurementQuotationComparisons).values(compHeader);
        if (compLines.length > 0) {
          await tx.insert(procurementQuotationComparisonLines).values(compLines);
        }
        await tx.update(procurementRfqs)
          .set({ status: 'EVALUATED', updatedAt: new Date() })
          .where(eq(procurementRfqs.id, rfqId));
      });
    } else {
      inMemoryComparisons.push(compHeader);
      inMemoryComparisonLines.push(...compLines);
      rfq.status = 'EVALUATED';
    }

    auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'ProcurementQuotationComparison',
      entityId: compId,
      action: 'CREATE',
      newValues: { rfqId, quotationCount: quotes.length }
    });

    return { comparison: compHeader, lines: compLines };
  }

  public async awardQuotation(
    ctx: RequestContext,
    input: AwardQuotationInput
  ): Promise<{ comparison: ProcurementQuotationComparison; awardedLines: ProcurementQuotationComparisonLine[] }> {
    if (ctx.user) {
      authorizationService.authorize({ user: ctx.user, action: 'procurement:quotation:award', companyId: ctx.companyId });
    }

    const db = getDb();
    let compHeader: ProcurementQuotationComparison | undefined;
    let compLines: ProcurementQuotationComparisonLine[] = [];

    if (db) {
      const [comp] = await db.select().from(procurementQuotationComparisons).where(
        and(eq(procurementQuotationComparisons.id, input.comparisonId), eq(procurementQuotationComparisons.tenantId, ctx.tenantId))
      );
      if (!comp) {
        throw new NotFoundError(`Comparison ${input.comparisonId} not found`);
      }
      compHeader = comp;
      compLines = await db.select().from(procurementQuotationComparisonLines).where(
        eq(procurementQuotationComparisonLines.comparisonId, input.comparisonId)
      );
    } else {
      compHeader = inMemoryComparisons.find((c) => c.id === input.comparisonId && c.tenantId === ctx.tenantId);
      if (!compHeader) {
        throw new NotFoundError(`Comparison ${input.comparisonId} not found`);
      }
      compLines = inMemoryComparisonLines.filter((l) => l.comparisonId === input.comparisonId);
    }

    if (compHeader.status === 'AWARDED') {
      throw new BusinessRuleViolationError(`Comparison ${input.comparisonId} has already been awarded`);
    }

    const awardedLineEntities: ProcurementQuotationComparisonLine[] = [];

    for (const item of input.awardedLineIds) {
      const target = compLines.find(
        (cl) => cl.rfqLineId === item.rfqLineId && cl.supplierQuotationLineId === item.supplierQuotationLineId
      );
      if (target) {
        target.isAwarded = true;
        target.awardQuantity = item.awardQuantity;
        awardedLineEntities.push(target);
      }
    }

    // Default award if lines not explicitly mapped
    if (awardedLineEntities.length === 0) {
      for (const cl of compLines) {
        if (cl.supplierId === input.awardedSupplierId) {
          cl.isAwarded = true;
          cl.awardQuantity = cl.quotedQuantity;
          awardedLineEntities.push(cl);
        }
      }
    }

    if (awardedLineEntities.length === 0) {
      throw new ValidationError('At least one comparison line must be awarded');
    }

    compHeader.status = 'AWARDED';
    compHeader.awardedSupplierId = input.awardedSupplierId;
    compHeader.awardedAt = new Date();
    compHeader.awardedBy = ctx.user?.userId || 'system';
    compHeader.evaluationNotes = input.evaluationNotes || compHeader.evaluationNotes;
    compHeader.updatedAt = new Date();
    compHeader.version += 1;

    if (db) {
      await db.transaction(async (tx) => {
        await tx.update(procurementQuotationComparisons)
          .set({
            status: 'AWARDED',
            awardedSupplierId: input.awardedSupplierId,
            awardedAt: compHeader!.awardedAt,
            awardedBy: compHeader!.awardedBy,
            evaluationNotes: compHeader!.evaluationNotes,
            version: compHeader!.version,
            updatedAt: compHeader!.updatedAt
          })
          .where(eq(procurementQuotationComparisons.id, input.comparisonId));

        for (const al of awardedLineEntities) {
          await tx.update(procurementQuotationComparisonLines)
            .set({ isAwarded: true, awardQuantity: al.awardQuantity })
            .where(eq(procurementQuotationComparisonLines.id, al.id));
        }

        await tx.update(procurementRfqs)
          .set({ status: 'AWARDED', updatedAt: new Date() })
          .where(eq(procurementRfqs.id, compHeader!.rfqId));

        const awardedQuoteIds = Array.from(new Set(awardedLineEntities.map((a) => a.supplierQuotationId)));
        for (const sqId of awardedQuoteIds) {
          await tx.update(procurementSupplierQuotations)
            .set({ status: 'AWARDED', updatedAt: new Date() })
            .where(eq(procurementSupplierQuotations.id, sqId));
        }
      });
    } else {
      const targetRfq = inMemoryRfqs.find((r) => r.id === compHeader!.rfqId);
      if (targetRfq) targetRfq.status = 'AWARDED';
      const awardedQuoteIds = Array.from(new Set(awardedLineEntities.map((a) => a.supplierQuotationId)));
      for (const sqId of awardedQuoteIds) {
        const targetSq = inMemoryQuotations.find((q) => q.id === sqId);
        if (targetSq) targetSq.status = 'AWARDED';
      }
    }

    auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'ProcurementQuotationComparison',
      entityId: input.comparisonId,
      action: 'AWARD',
      newValues: { awardedSupplierId: input.awardedSupplierId, awardedLineCount: awardedLineEntities.length }
    });

    return { comparison: compHeader, awardedLines: awardedLineEntities };
  }

  public async getComparisonById(
    ctx: RequestContext,
    id: string
  ): Promise<{ comparison: ProcurementQuotationComparison; lines: ProcurementQuotationComparisonLine[] }> {
    const db = getDb();
    if (db) {
      const [comp] = await db.select().from(procurementQuotationComparisons).where(
        and(eq(procurementQuotationComparisons.id, id), eq(procurementQuotationComparisons.tenantId, ctx.tenantId))
      );
      if (!comp) {
        throw new NotFoundError(`Comparison ${id} not found`);
      }
      const lines = await db.select().from(procurementQuotationComparisonLines).where(
        eq(procurementQuotationComparisonLines.comparisonId, id)
      );
      return { comparison: comp, lines };
    }

    const comp = inMemoryComparisons.find((c) => c.id === id && c.tenantId === ctx.tenantId);
    if (!comp) {
      throw new NotFoundError(`Comparison ${id} not found`);
    }
    const lines = inMemoryComparisonLines.filter((l) => l.comparisonId === id);
    return { comparison: comp, lines };
  }
}

export const sourcingService = new SourcingService();
