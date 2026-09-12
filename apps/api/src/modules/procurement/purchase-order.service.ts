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
  purchaseOrders,
  purchaseOrderLines,
  purchaseRequestLines,
  companies,
  suppliers,
  eq,
  and,
  PurchaseOrder,
  PurchaseOrderLine
} from '@general-erp/database';
import { purchaseRequestService } from './purchase-request.service.js';

// In-Memory Fallback Stores for Purchase Orders (for non-DB unit/integration tests)
const inMemoryOrders: PurchaseOrder[] = [];
const inMemoryOrderLines: PurchaseOrderLine[] = [];

// ============================================================================
// Interfaces
// ============================================================================

export interface CreatePurchaseOrderLineInput {
  purchaseRequestLineId?: string | null;
  rfqLineId?: string | null;
  supplierQuotationLineId?: string | null;
  productId?: string | null;
  productCodeSnapshot?: string | null;
  productNameSnapshot?: string | null;
  description: string;
  uom: string;
  orderedQuantity: string;
  unitPrice: string;
  discount?: string;
  taxRate?: string;
  expectedDeliveryDate?: string | null;
  notes?: string | null;
}

export interface CreatePurchaseOrderInput {
  companyId: string;
  branchId?: string | null;
  supplierId: string;
  purchaseRequestId?: string | null;
  rfqId?: string | null;
  supplierQuotationId?: string | null;
  comparisonId?: string | null;
  poDate?: string;
  expectedDeliveryDate: string;
  currency?: string;
  exchangeRate?: string;
  paymentTerms?: string | null;
  deliveryTerms?: string | null;
  shippingTerms?: string | null;
  warrantyTerms?: string | null;
  billingAddress?: string | null;
  shippingLocation?: string | null;
  notes?: string | null;
  termsAndConditions?: string | null;
  lines: CreatePurchaseOrderLineInput[];
}

export interface UpdatePurchaseOrderInput {
  branchId?: string | null;
  expectedDeliveryDate?: string;
  paymentTerms?: string | null;
  deliveryTerms?: string | null;
  shippingTerms?: string | null;
  warrantyTerms?: string | null;
  billingAddress?: string | null;
  shippingLocation?: string | null;
  notes?: string | null;
  termsAndConditions?: string | null;
  version?: number;
  lines?: CreatePurchaseOrderLineInput[];
}

export class PurchaseOrderService {
  public clearMemoryStores(): void {
    inMemoryOrders.length = 0;
    inMemoryOrderLines.length = 0;
  }
  // ==========================================================================
  // CREATE PO
  // ==========================================================================

  public async createPurchaseOrder(
    ctx: RequestContext,
    input: CreatePurchaseOrderInput
  ): Promise<{ po: PurchaseOrder; lines: PurchaseOrderLine[] }> {
    if (ctx.user) {
      authorizationService.authorize({ user: ctx.user, action: 'procurement:po:create', companyId: input.companyId });
    }

    if (!input.supplierId) {
      throw new ValidationError('Supplier ID is required');
    }
    if (!input.lines || input.lines.length === 0) {
      throw new ValidationError('Purchase Order must contain at least one line item');
    }

    const poDate = input.poDate || new Date().toISOString().substring(0, 10);
    if (input.expectedDeliveryDate < poDate) {
      throw new ValidationError('Expected delivery date cannot be earlier than PO date');
    }

    // Exact decimal financial calculations
    let subtotalAcc = ExactDecimal.parse('0.00', 2);
    let discountAcc = ExactDecimal.parse('0.00', 2);
    let taxableAcc = ExactDecimal.parse('0.00', 2);
    let taxAcc = ExactDecimal.parse('0.00', 2);

    const poId = `po_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const lineEntities: PurchaseOrderLine[] = [];

    for (const [idx, l] of input.lines.entries()) {
      const qty = ExactDecimal.parse(l.orderedQuantity, 4);
      const unitPrice = ExactDecimal.parse(l.unitPrice, 2);
      if (qty.isNegative() || qty.isZero()) {
        throw new ValidationError(`Line ${idx + 1}: ordered quantity must be positive`);
      }
      if (unitPrice.isNegative()) {
        throw new ValidationError(`Line ${idx + 1}: unit price cannot be negative`);
      }

      const discAmount = l.discount ? ExactDecimal.parse(l.discount, 2) : ExactDecimal.parse('0.00', 2);
      const grossLine = ExactDecimal.halfEvenRound(qty.rawBigInt * unitPrice.rawBigInt, 6, 2);
      const taxable = grossLine.sub(discAmount);

      const taxRate = l.taxRate ? ExactDecimal.parse(l.taxRate, 2) : ExactDecimal.parse('0.00', 2);
      const lineTax = ExactDecimal.halfEvenRound(taxable.rawBigInt * taxRate.rawBigInt, 6, 2);
      const lineTotal = taxable.add(lineTax);

      subtotalAcc = subtotalAcc.add(grossLine);
      discountAcc = discountAcc.add(discAmount);
      taxableAcc = taxableAcc.add(taxable);
      taxAcc = taxAcc.add(lineTax);

      lineEntities.push({
        id: `po_line_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 5)}`,
        purchaseOrderId: poId,
        lineNumber: idx + 1,
        purchaseRequestLineId: l.purchaseRequestLineId || null,
        rfqLineId: l.rfqLineId || null,
        supplierQuotationLineId: l.supplierQuotationLineId || null,
        productId: l.productId || null,
        productCodeSnapshot: l.productCodeSnapshot || null,
        productNameSnapshot: l.productNameSnapshot || null,
        description: l.description.trim(),
        uom: l.uom.trim(),
        orderedQuantity: l.orderedQuantity,
        receivedQuantity: '0.0000',
        acceptedQuantity: '0.0000',
        unitPrice: unitPrice.toString(),
        discount: discAmount.toString(),
        discountAmount: discAmount.toString(),
        taxableAmount: taxable.toString(),
        taxRate: taxRate.toString(),
        taxAmount: lineTax.toString(),
        lineTotal: lineTotal.toString(),
        expectedDeliveryDate: l.expectedDeliveryDate || input.expectedDeliveryDate,
        notes: l.notes || null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    const grandTotalVal = taxableAcc.add(taxAcc);

    let poNumber = '';
    try {
      poNumber = numberingEngine.generateNextNumber(
        ctx.tenantId,
        input.companyId,
        'PURCHASE_ORDER',
        new Date().getFullYear().toString()
      );
    } catch {
      const year = new Date().getFullYear();
      const rand = Math.floor(1000 + Math.random() * 9000);
      poNumber = `PO-${year}-${rand}`;
    }

    const poHeader: PurchaseOrder = {
      id: poId,
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      branchId: input.branchId || null,
      poNumber,
      supplierId: input.supplierId,
      purchaseRequestId: input.purchaseRequestId || null,
      rfqId: input.rfqId || null,
      supplierQuotationId: input.supplierQuotationId || null,
      comparisonId: input.comparisonId || null,
      poDate,
      expectedDeliveryDate: input.expectedDeliveryDate,
      currency: input.currency || 'INR',
      exchangeRate: input.exchangeRate || '1.000000',
      paymentTerms: input.paymentTerms || null,
      deliveryTerms: input.deliveryTerms || null,
      shippingTerms: input.shippingTerms || null,
      warrantyTerms: input.warrantyTerms || null,
      billingAddress: input.billingAddress || null,
      shippingLocation: input.shippingLocation || null,
      status: 'DRAFT',
      subtotal: subtotalAcc.toString(),
      discount: discountAcc.toString(),
      taxableAmount: taxableAcc.toString(),
      tax: taxAcc.toString(),
      rounding: '0.00',
      grandTotal: grandTotalVal.toString(),
      notes: input.notes || null,
      termsAndConditions: input.termsAndConditions || null,
      version: 1,
      submittedAt: null,
      submittedBy: null,
      approvedAt: null,
      approvedBy: null,
      issuedAt: null,
      issuedBy: null,
      acknowledgedAt: null,
      acknowledgedBy: null,
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: ctx.user?.userId || 'system',
      updatedBy: ctx.user?.userId || 'system'
    };

    const db = getDb();
    if (db) {
      const [comp] = await db.select().from(companies).where(
        and(eq(companies.id, input.companyId), eq(companies.tenantId, ctx.tenantId))
      );
      if (!comp) {
        throw new NotFoundError(`Company ${input.companyId} not found`);
      }

      const [sup] = await db.select().from(suppliers).where(
        and(eq(suppliers.id, input.supplierId), eq(suppliers.tenantId, ctx.tenantId))
      );
      if (!sup) {
        throw new NotFoundError(`Supplier ${input.supplierId} not found`);
      }

      await db.transaction(async (tx) => {
        // Validate PR line quantities if linked
        for (const line of lineEntities) {
          if (line.purchaseRequestLineId) {
            const [prLine] = await tx.select().from(purchaseRequestLines).where(
              eq(purchaseRequestLines.id, line.purchaseRequestLineId)
            );
            if (prLine) {
              const currentOrdered = ExactDecimal.parse(prLine.orderedQuantity, 4);
              const newQty = ExactDecimal.parse(line.orderedQuantity, 4);
              const requested = ExactDecimal.parse(prLine.requestedQuantity, 4);
              const totalAfter = currentOrdered.add(newQty);

              if (totalAfter.compare(requested) > 0) {
                throw new BusinessRuleViolationError(
                  `Ordered quantity (${totalAfter.toString()}) exceeds PR requested quantity (${requested.toString()})`
                );
              }

              const updatedRemaining = requested.sub(totalAfter);
              await tx.update(purchaseRequestLines)
                .set({
                  orderedQuantity: totalAfter.toString(),
                  remainingQuantity: updatedRemaining.toString(),
                  updatedAt: new Date()
                })
                .where(eq(purchaseRequestLines.id, line.purchaseRequestLineId));
            }
          }
        }

        await tx.insert(purchaseOrders).values(poHeader);
        await tx.insert(purchaseOrderLines).values(lineEntities);
      });
    } else {
      // In-memory fallback
      for (const line of lineEntities) {
        if (line.purchaseRequestLineId) {
          const prResult = await purchaseRequestService.getPurchaseRequestById(ctx, input.purchaseRequestId || '');
          const prLine = prResult.lines.find((l) => l.id === line.purchaseRequestLineId);
          if (prLine) {
            const currentOrdered = ExactDecimal.parse(prLine.orderedQuantity, 4);
            const newQty = ExactDecimal.parse(line.orderedQuantity, 4);
            const requested = ExactDecimal.parse(prLine.requestedQuantity, 4);
            const totalAfter = currentOrdered.add(newQty);

            if (totalAfter.compare(requested) > 0) {
              throw new BusinessRuleViolationError(
                `Ordered quantity (${totalAfter.toString()}) exceeds PR requested quantity (${requested.toString()})`
              );
            }

            prLine.orderedQuantity = totalAfter.toString();
            prLine.remainingQuantity = requested.sub(totalAfter).toString();
          }
        }
      }

      inMemoryOrders.push(poHeader);
      inMemoryOrderLines.push(...lineEntities);
    }

    auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'PurchaseOrder',
      entityId: poId,
      action: 'CREATE',
      newValues: { poNumber, grandTotal: poHeader.grandTotal, status: poHeader.status }
    });

    return { po: poHeader, lines: lineEntities };
  }

  // ==========================================================================
  // LIFECYCLE TRANSITIONS
  // ==========================================================================

  public async submitPurchaseOrder(ctx: RequestContext, id: string): Promise<PurchaseOrder> {
    const { po } = await this.getPurchaseOrderById(ctx, id);
    if (ctx.user) {
      authorizationService.authorize({ user: ctx.user, action: 'procurement:po:submit', companyId: po.companyId });
    }

    if (po.status !== 'DRAFT') {
      throw new BusinessRuleViolationError(`Cannot submit Purchase Order in '${po.status}' status`);
    }

    po.status = 'SUBMITTED';
    po.submittedAt = new Date();
    po.submittedBy = ctx.user?.userId || 'system';
    po.updatedAt = new Date();
    po.version += 1;

    const db = getDb();
    if (db) {
      await db.update(purchaseOrders)
        .set({
          status: 'SUBMITTED',
          submittedAt: po.submittedAt,
          submittedBy: po.submittedBy,
          version: po.version,
          updatedAt: po.updatedAt
        })
        .where(eq(purchaseOrders.id, id));
    }

    auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'PurchaseOrder',
      entityId: id,
      action: 'SUBMIT',
      newValues: { status: 'SUBMITTED' }
    });

    return po;
  }

  public async approvePurchaseOrder(ctx: RequestContext, id: string): Promise<PurchaseOrder> {
    const { po } = await this.getPurchaseOrderById(ctx, id);
    if (ctx.user) {
      authorizationService.authorize({ user: ctx.user, action: 'procurement:po:approve', companyId: po.companyId });
    }

    if (po.status !== 'SUBMITTED') {
      throw new BusinessRuleViolationError(`Cannot approve Purchase Order in '${po.status}' status`);
    }

    po.status = 'APPROVED';
    po.approvedAt = new Date();
    po.approvedBy = ctx.user?.userId || 'system';
    po.updatedAt = new Date();
    po.version += 1;

    const db = getDb();
    if (db) {
      await db.update(purchaseOrders)
        .set({
          status: 'APPROVED',
          approvedAt: po.approvedAt,
          approvedBy: po.approvedBy,
          version: po.version,
          updatedAt: po.updatedAt
        })
        .where(eq(purchaseOrders.id, id));
    }

    auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'PurchaseOrder',
      entityId: id,
      action: 'APPROVE',
      newValues: { status: 'APPROVED' }
    });

    return po;
  }

  public async issuePurchaseOrder(ctx: RequestContext, id: string): Promise<PurchaseOrder> {
    const { po } = await this.getPurchaseOrderById(ctx, id);
    if (ctx.user) {
      authorizationService.authorize({ user: ctx.user, action: 'procurement:po:issue', companyId: po.companyId });
    }

    if (po.status !== 'APPROVED') {
      throw new BusinessRuleViolationError(`Cannot issue Purchase Order in '${po.status}' status`);
    }

    po.status = 'ISSUED';
    po.issuedAt = new Date();
    po.issuedBy = ctx.user?.userId || 'system';
    po.updatedAt = new Date();
    po.version += 1;

    const db = getDb();
    if (db) {
      await db.update(purchaseOrders)
        .set({
          status: 'ISSUED',
          issuedAt: po.issuedAt,
          issuedBy: po.issuedBy,
          version: po.version,
          updatedAt: po.updatedAt
        })
        .where(eq(purchaseOrders.id, id));
    }

    auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'PurchaseOrder',
      entityId: id,
      action: 'ISSUE',
      newValues: { status: 'ISSUED' }
    });

    return po;
  }

  public async acknowledgePurchaseOrder(ctx: RequestContext, id: string): Promise<PurchaseOrder> {
    const { po } = await this.getPurchaseOrderById(ctx, id);
    if (ctx.user) {
      authorizationService.authorize({ user: ctx.user, action: 'procurement:po:acknowledge', companyId: po.companyId });
    }

    if (po.status !== 'ISSUED') {
      throw new BusinessRuleViolationError(`Cannot acknowledge Purchase Order in '${po.status}' status`);
    }

    po.status = 'ACKNOWLEDGED';
    po.acknowledgedAt = new Date();
    po.acknowledgedBy = ctx.user?.userId || 'system';
    po.updatedAt = new Date();
    po.version += 1;

    const db = getDb();
    if (db) {
      await db.update(purchaseOrders)
        .set({
          status: 'ACKNOWLEDGED',
          acknowledgedAt: po.acknowledgedAt,
          acknowledgedBy: po.acknowledgedBy,
          version: po.version,
          updatedAt: po.updatedAt
        })
        .where(eq(purchaseOrders.id, id));
    }

    auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'PurchaseOrder',
      entityId: id,
      action: 'ACKNOWLEDGE',
      newValues: { status: 'ACKNOWLEDGED' }
    });

    return po;
  }

  public async cancelPurchaseOrder(ctx: RequestContext, id: string, reason: string): Promise<PurchaseOrder> {
    const { po, lines } = await this.getPurchaseOrderById(ctx, id);
    if (ctx.user) {
      authorizationService.authorize({ user: ctx.user, action: 'procurement:po:cancel', companyId: po.companyId });
    }

    if (!reason || reason.trim() === '') {
      throw new ValidationError('Cancellation reason is required');
    }

    if (po.status === 'PARTIALLY_RECEIVED' || po.status === 'COMPLETED' || po.status === 'CANCELLED') {
      throw new BusinessRuleViolationError(`Cannot cancel Purchase Order in '${po.status}' status`);
    }

    po.status = 'CANCELLED';
    po.cancelledAt = new Date();
    po.cancelledBy = ctx.user?.userId || 'system';
    po.cancellationReason = reason.trim();
    po.updatedAt = new Date();
    po.version += 1;

    const db = getDb();
    if (db) {
      await db.transaction(async (tx) => {
        for (const line of lines) {
          if (line.purchaseRequestLineId) {
            const [prLine] = await tx.select().from(purchaseRequestLines).where(
              eq(purchaseRequestLines.id, line.purchaseRequestLineId)
            );
            if (prLine) {
              const currentOrdered = ExactDecimal.parse(prLine.orderedQuantity, 4);
              const cancelQty = ExactDecimal.parse(line.orderedQuantity, 4);
              const requested = ExactDecimal.parse(prLine.requestedQuantity, 4);
              const newOrdered = currentOrdered.sub(cancelQty);
              const newRemaining = requested.sub(newOrdered);

              await tx.update(purchaseRequestLines)
                .set({
                  orderedQuantity: newOrdered.toString(),
                  remainingQuantity: newRemaining.toString(),
                  updatedAt: new Date()
                })
                .where(eq(purchaseRequestLines.id, line.purchaseRequestLineId));
            }
          }
        }

        await tx.update(purchaseOrders)
          .set({
            status: 'CANCELLED',
            cancelledAt: po.cancelledAt,
            cancelledBy: po.cancelledBy,
            cancellationReason: po.cancellationReason,
            version: po.version,
            updatedAt: po.updatedAt
          })
          .where(eq(purchaseOrders.id, id));
      });
    } else {
      for (const line of lines) {
        if (line.purchaseRequestLineId && po.purchaseRequestId) {
          const prResult = await purchaseRequestService.getPurchaseRequestById(ctx, po.purchaseRequestId);
          const prLine = prResult.lines.find((l) => l.id === line.purchaseRequestLineId);
          if (prLine) {
            const currentOrdered = ExactDecimal.parse(prLine.orderedQuantity, 4);
            const cancelQty = ExactDecimal.parse(line.orderedQuantity, 4);
            const requested = ExactDecimal.parse(prLine.requestedQuantity, 4);
            const newOrdered = currentOrdered.sub(cancelQty);
            prLine.orderedQuantity = newOrdered.toString();
            prLine.remainingQuantity = requested.sub(newOrdered).toString();
          }
        }
      }
    }

    auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'PurchaseOrder',
      entityId: id,
      action: 'CANCEL',
      newValues: { status: 'CANCELLED', reason }
    });

    return po;
  }

  // ==========================================================================
  // READ METHODS
  // ==========================================================================

  public async getPurchaseOrderById(
    ctx: RequestContext,
    id: string
  ): Promise<{ po: PurchaseOrder; lines: PurchaseOrderLine[] }> {
    const db = getDb();
    if (db) {
      const [po] = await db.select().from(purchaseOrders).where(
        and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, ctx.tenantId))
      );
      if (!po) {
        throw new NotFoundError(`Purchase Order ${id} not found`);
      }
      const lines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id));
      return { po, lines };
    }

    const po = inMemoryOrders.find((p) => p.id === id && p.tenantId === ctx.tenantId);
    if (!po) {
      throw new NotFoundError(`Purchase Order ${id} not found`);
    }
    const lines = inMemoryOrderLines.filter((l) => l.purchaseOrderId === id);
    return { po, lines };
  }

  public async listPurchaseOrders(
    ctx: RequestContext,
    companyId?: string,
    supplierId?: string,
    status?: string
  ): Promise<PurchaseOrder[]> {
    const db = getDb();
    if (db) {
      const conditions = [eq(purchaseOrders.tenantId, ctx.tenantId)];
      if (companyId) conditions.push(eq(purchaseOrders.companyId, companyId));
      if (supplierId) conditions.push(eq(purchaseOrders.supplierId, supplierId));
      if (status) conditions.push(eq(purchaseOrders.status, status));
      return await db.select().from(purchaseOrders).where(and(...conditions));
    }

    return inMemoryOrders.filter((p) => {
      if (p.tenantId !== ctx.tenantId) return false;
      if (companyId && p.companyId !== companyId) return false;
      if (supplierId && p.supplierId !== supplierId) return false;
      if (status && p.status !== status) return false;
      return true;
    });
  }
}

export const purchaseOrderService = new PurchaseOrderService();
