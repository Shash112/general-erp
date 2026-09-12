import {
  RequestContext,
  ExactDecimal,
} from '@general-erp/core';
import {
  getDb,
  goodsReceipts,
  goodsReceiptLines,
  purchaseOrders,
  purchaseOrderLines,
  suppliers,
  GoodsReceiptLine,
  PurchaseOrderLine,
  eq,
  and,
} from '@general-erp/database';
import { numberingEngine } from '../../platform/numbering/numbering.service.js';
import { auditService } from '../../platform/audit/audit.service.js';
import { authorizationService } from '../../platform/authorization/authorization.service.js';
import { purchaseOrderService } from './purchase-order.service.js';

export interface CreateGrnLineInput {
  purchaseOrderLineId: string;
  productId?: string;
  descriptionSnapshot?: string;
  productCodeSnapshot?: string;
  uom: string;
  receivedQuantity: string;
  acceptedQuantity?: string;
  rejectedQuantity?: string;
  inspectionRequired?: boolean;
  rejectionReason?: string;
  batchReference?: string;
  serialReference?: string;
  notes?: string;
}

export interface CreateGrnInput {
  companyId: string;
  branchId?: string;
  purchaseOrderId: string;
  supplierId?: string;
  receiptDate: string; // YYYY-MM-DD
  warehouseId?: string;
  receivingLocationId?: string;
  supplierDeliveryNoteNumber?: string;
  supplierDeliveryNoteDate?: string;
  transporter?: string;
  vehicleNumber?: string;
  lrNumber?: string;
  receivedBy?: string;
  notes?: string;
  lines: CreateGrnLineInput[];
}

export interface InspectGrnLineInput {
  lineId: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  rejectionReason?: string;
}

export interface InspectGrnInput {
  lines: InspectGrnLineInput[];
  notes?: string;
}

// In-Memory Fallback Stores for Goods Receipts
const memoryReceipts = new Map<string, any>();
const memoryReceiptLines = new Map<string, any[]>();

export class GoodsReceiptService {
  public clearMemoryStores(): void {
    memoryReceipts.clear();
    memoryReceiptLines.clear();
  }

  /**
   * Create a new Goods Receipt Note (GRN) against an active Purchase Order
   */
  async createGoodsReceipt(ctx: RequestContext, input: CreateGrnInput) {
    // 1. Authorization check
    if (ctx.user) {
      authorizationService.authorize({
        user: ctx.user,
        action: 'procurement:grn:create',
        companyId: input.companyId,
      });
    }

    // 2. Fetch PO & Lines via purchaseOrderService
    const poResult = await purchaseOrderService.getPurchaseOrderById(ctx, input.purchaseOrderId);
    if (!poResult || !poResult.po) {
      throw new Error(`Purchase Order '${input.purchaseOrderId}' not found or inaccessible.`);
    }

    const { po, lines: existingPoLines } = poResult;

    if (!['ISSUED', 'ACKNOWLEDGED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
      throw new Error(
        `Cannot create GRN for Purchase Order '${po.poNumber}' in status '${po.status}'. Must be ISSUED, ACKNOWLEDGED, or PARTIALLY_RECEIVED.`
      );
    }

    const supplierIdToUse = input.supplierId || po.supplierId;
    if (supplierIdToUse !== po.supplierId) {
      throw new Error(`Supplier does not match the Purchase Order supplier.`);
    }

    const poLineMap = new Map<string, PurchaseOrderLine>();
    for (const line of existingPoLines) {
      poLineMap.set(line.id, line);
    }

    if (!input.lines || input.lines.length === 0) {
      throw new Error(`GRN must contain at least one line item.`);
    }

    // 3. Generate Sequence Number
    const yearStr = input.receiptDate ? input.receiptDate.substring(0, 4) : new Date().getFullYear().toString();
    const grnNumber = numberingEngine.generateNextNumber(
      ctx.tenantId,
      input.companyId,
      'GOODS_RECEIPT_NOTE',
      yearStr
    );

    // 4. Build GRN lines with quantity validation
    let hasInspectionPending = false;
    const preparedLines: any[] = [];

    for (let i = 0; i < input.lines.length; i++) {
      const lineInput = input.lines[i]!;
      const poLine = poLineMap.get(lineInput.purchaseOrderLineId);
      if (!poLine) {
        throw new Error(
          `Purchase Order line '${lineInput.purchaseOrderLineId}' does not belong to PO '${po.poNumber}'.`
        );
      }

      const orderedDec = ExactDecimal.parse(poLine.orderedQuantity, 4);
      const prevReceivedDec = ExactDecimal.parse(poLine.receivedQuantity || '0.0000', 4);
      const recQtyDec = ExactDecimal.parse(lineInput.receivedQuantity, 4);

      if (recQtyDec.rawBigInt <= 0n) {
        throw new Error(`Line ${i + 1}: Received quantity must be greater than zero.`);
      }

      const remainingReceivableDec = ExactDecimal.sub(orderedDec, prevReceivedDec);
      if (recQtyDec.rawBigInt > remainingReceivableDec.rawBigInt) {
        throw new Error(
          `Line ${i + 1} (${poLine.description}): Received quantity (${recQtyDec.toString()}) exceeds remaining receivable quantity (${remainingReceivableDec.toString()}).`
        );
      }

      const inspRequired = lineInput.inspectionRequired ?? false;
      let accQtyDec: ExactDecimal;
      let rejQtyDec: ExactDecimal;

      if (inspRequired) {
        hasInspectionPending = true;
        accQtyDec = ExactDecimal.fromBigInt(0n, 4);
        rejQtyDec = ExactDecimal.fromBigInt(0n, 4);
      } else {
        rejQtyDec = lineInput.rejectedQuantity
          ? ExactDecimal.parse(lineInput.rejectedQuantity, 4)
          : ExactDecimal.fromBigInt(0n, 4);
        accQtyDec = lineInput.acceptedQuantity
          ? ExactDecimal.parse(lineInput.acceptedQuantity, 4)
          : ExactDecimal.sub(recQtyDec, rejQtyDec);

        if (ExactDecimal.add(accQtyDec, rejQtyDec).rawBigInt !== recQtyDec.rawBigInt) {
          throw new Error(
            `Line ${i + 1}: Accepted quantity (${accQtyDec.toString()}) + Rejected quantity (${rejQtyDec.toString()}) must equal Received quantity (${recQtyDec.toString()}).`
          );
        }

        if (rejQtyDec.rawBigInt > 0n && (!lineInput.rejectionReason || !lineInput.rejectionReason.trim())) {
          throw new Error(`Line ${i + 1}: Rejection reason is required when rejected quantity is greater than zero.`);
        }
      }

      preparedLines.push({
        id: `grn_line_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 5)}`,
        lineNumber: i + 1,
        purchaseOrderLineId: poLine.id,
        productId: lineInput.productId || poLine.productId,
        descriptionSnapshot: lineInput.descriptionSnapshot || poLine.description,
        productCodeSnapshot: lineInput.productCodeSnapshot || poLine.productCodeSnapshot,
        uom: lineInput.uom || poLine.uom,
        orderedQuantity: orderedDec.toString(),
        previouslyReceivedQuantity: prevReceivedDec.toString(),
        receivedQuantity: recQtyDec.toString(),
        acceptedQuantity: accQtyDec.toString(),
        rejectedQuantity: rejQtyDec.toString(),
        remainingQuantity: ExactDecimal.sub(remainingReceivableDec, recQtyDec).toString(),
        inspectionRequired: inspRequired,
        rejectionReason: lineInput.rejectionReason || null,
        batchReference: lineInput.batchReference || null,
        serialReference: lineInput.serialReference || null,
        notes: lineInput.notes || null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const grnStatus = hasInspectionPending ? 'INSPECTION_PENDING' : 'RECEIVED';
    const inspStatus = hasInspectionPending ? 'PENDING' : 'NOT_REQUIRED';
    const grnId = `grn_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
    const actorId = ctx.user?.userId || 'system';

    const grnEntity = {
      id: grnId,
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      branchId: input.branchId || null,
      grnNumber,
      purchaseOrderId: po.id,
      supplierId: supplierIdToUse,
      receiptDate: input.receiptDate,
      receivedAt: new Date(),
      warehouseId: input.warehouseId || null,
      receivingLocationId: input.receivingLocationId || null,
      supplierDeliveryNoteNumber: input.supplierDeliveryNoteNumber || null,
      supplierDeliveryNoteDate: input.supplierDeliveryNoteDate || null,
      transporter: input.transporter || null,
      vehicleNumber: input.vehicleNumber || null,
      lrNumber: input.lrNumber || null,
      status: grnStatus,
      inspectionStatus: inspStatus,
      receivedBy: input.receivedBy || ctx.user?.email || actorId,
      notes: input.notes || null,
      version: 1,
      submittedAt: null as Date | null,
      submittedBy: null as string | null,
      inspectedAt: null as Date | null,
      inspectedBy: null as string | null,
      acceptedAt: null as Date | null,
      acceptedBy: null as string | null,
      cancelledAt: null as Date | null,
      cancelledBy: null as string | null,
      cancellationReason: null as string | null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: actorId,
      updatedBy: actorId,
    };

    let newGrn = grnEntity;
    let insertedLines = preparedLines;

    const db = getDb();
    if (db) {
      const [insertedGrn] = await db
        .insert(goodsReceipts)
        .values({ ...grnEntity })
        .returning();
      if (insertedGrn) newGrn = insertedGrn;

      insertedLines = await db
        .insert(goodsReceiptLines)
        .values(
          preparedLines.map((line) => ({
            ...line,
            goodsReceiptId: newGrn.id,
          }))
        )
        .returning();
    } else {
      memoryReceipts.set(grnId, newGrn);
      memoryReceiptLines.set(
        grnId,
        preparedLines.map((line) => ({ ...line, goodsReceiptId: grnId }))
      );
    }

    // Audit log
    await auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'GoodsReceiptNote',
      entityId: newGrn.id,
      action: 'CREATE',
      newValues: {
        grnNumber: newGrn.grnNumber,
        poNumber: po.poNumber,
        supplierId: newGrn.supplierId,
        status: newGrn.status,
      },
    });

    return { ...newGrn, lines: insertedLines };
  }

  /**
   * Perform Quality Inspection on a GRN
   */
  async inspectGoodsReceipt(ctx: RequestContext, grnId: string, input: InspectGrnInput) {
    const db = getDb();
    let grn: any = null;
    let existingLines: any[] = [];

    if (db) {
      const [dbGrn] = await db
        .select()
        .from(goodsReceipts)
        .where(and(eq(goodsReceipts.id, grnId), eq(goodsReceipts.tenantId, ctx.tenantId)));
      grn = dbGrn;
      if (grn) {
        existingLines = await db
          .select()
          .from(goodsReceiptLines)
          .where(eq(goodsReceiptLines.goodsReceiptId, grn.id));
      }
    } else {
      grn = memoryReceipts.get(grnId);
      if (grn) existingLines = memoryReceiptLines.get(grnId) || [];
    }

    if (!grn) {
      throw new Error(`Goods Receipt Note '${grnId}' not found.`);
    }

    if (ctx.user) {
      authorizationService.authorize({
        user: ctx.user,
        action: 'procurement:grn:inspect',
        companyId: grn.companyId,
      });
    }

    if (!['DRAFT', 'RECEIVED', 'INSPECTION_PENDING'].includes(grn.status)) {
      throw new Error(`Cannot inspect GRN '${grn.grnNumber}' in status '${grn.status}'.`);
    }

    const lineMap = new Map<string, any>();
    for (const l of existingLines) {
      lineMap.set(l.id, l);
    }

    let totalAccepted = 0n;
    let totalRejected = 0n;

    for (const item of input.lines) {
      const line = lineMap.get(item.lineId);
      if (!line) {
        throw new Error(`GRN line '${item.lineId}' not found on GRN '${grn.grnNumber}'.`);
      }

      const recQtyDec = ExactDecimal.parse(line.receivedQuantity, 4);
      const accQtyDec = ExactDecimal.parse(item.acceptedQuantity, 4);
      const rejQtyDec = ExactDecimal.parse(item.rejectedQuantity, 4);

      if (ExactDecimal.add(accQtyDec, rejQtyDec).rawBigInt !== recQtyDec.rawBigInt) {
        throw new Error(
          `Line ${line.lineNumber}: Accepted quantity (${accQtyDec.toString()}) + Rejected quantity (${rejQtyDec.toString()}) must equal Received quantity (${recQtyDec.toString()}).`
        );
      }

      if (rejQtyDec.rawBigInt > 0n && (!item.rejectionReason || !item.rejectionReason.trim())) {
        throw new Error(`Line ${line.lineNumber}: Rejection reason required when rejected quantity > 0.`);
      }

      totalAccepted += accQtyDec.rawBigInt;
      totalRejected += rejQtyDec.rawBigInt;

      line.acceptedQuantity = accQtyDec.toString();
      line.rejectedQuantity = rejQtyDec.toString();
      line.rejectionReason = item.rejectionReason || null;
      line.inspectionRequired = false;
      line.updatedAt = new Date();

      if (db) {
        await db
          .update(goodsReceiptLines)
          .set({
            acceptedQuantity: accQtyDec.toString(),
            rejectedQuantity: rejQtyDec.toString(),
            rejectionReason: item.rejectionReason || null,
            inspectionRequired: false,
            updatedAt: new Date(),
          })
          .where(eq(goodsReceiptLines.id, line.id));
      }
    }

    let overallInspStatus = 'PASSED';
    if (totalAccepted === 0n && totalRejected > 0n) {
      overallInspStatus = 'FAILED';
    } else if (totalAccepted > 0n && totalRejected > 0n) {
      overallInspStatus = 'PARTIALLY_PASSED';
    }

    const actorId = ctx.user?.userId || 'system';
    const newStatus = overallInspStatus === 'FAILED' ? 'REJECTED' : 'INSPECTION_PENDING';
    const newVersion = grn.version + 1;

    let updatedGrn = {
      ...grn,
      inspectionStatus: overallInspStatus,
      status: newStatus,
      inspectedAt: new Date(),
      inspectedBy: actorId,
      version: newVersion,
      updatedAt: new Date(),
      updatedBy: actorId,
    };

    if (db) {
      const [res] = await db
        .update(goodsReceipts)
        .set({
          inspectionStatus: overallInspStatus,
          status: newStatus,
          inspectedAt: new Date(),
          inspectedBy: actorId,
          version: newVersion,
          updatedAt: new Date(),
          updatedBy: actorId,
        })
        .where(and(eq(goodsReceipts.id, grn.id), eq(goodsReceipts.version, grn.version)))
        .returning();
      if (res) updatedGrn = res;
    } else {
      memoryReceipts.set(grnId, updatedGrn);
    }

    await auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'GoodsReceiptNote',
      entityId: grn.id,
      action: 'INSPECT',
      newValues: {
        grnNumber: grn.grnNumber,
        inspectionStatus: overallInspStatus,
      },
    });

    return { ...updatedGrn, lines: existingLines };
  }

  /**
   * Formally Accept Goods Receipt Note (updates PO line received & accepted counters)
   */
  async acceptGoodsReceipt(ctx: RequestContext, grnId: string) {
    const db = getDb();
    let grn: any = null;
    let grnLines: any[] = [];

    if (db) {
      const [dbGrn] = await db
        .select()
        .from(goodsReceipts)
        .where(and(eq(goodsReceipts.id, grnId), eq(goodsReceipts.tenantId, ctx.tenantId)));
      grn = dbGrn;
      if (grn) {
        grnLines = await db
          .select()
          .from(goodsReceiptLines)
          .where(eq(goodsReceiptLines.goodsReceiptId, grn.id));
      }
    } else {
      grn = memoryReceipts.get(grnId);
      if (grn) grnLines = memoryReceiptLines.get(grnId) || [];
    }

    if (!grn) {
      throw new Error(`Goods Receipt Note '${grnId}' not found.`);
    }

    if (ctx.user) {
      authorizationService.authorize({
        user: ctx.user,
        action: 'procurement:grn:accept',
        companyId: grn.companyId,
      });
    }

    if (['ACCEPTED', 'CANCELLED', 'REJECTED'].includes(grn.status)) {
      throw new Error(`GRN '${grn.grnNumber}' is already in terminal status '${grn.status}'.`);
    }

    const poResult = await purchaseOrderService.getPurchaseOrderById(ctx, grn.purchaseOrderId);
    const po = poResult?.po;
    const poLines = poResult?.lines || [];

    let allPoLinesFullyReceived = true;

    for (const poLine of poLines) {
      const matchingGrnLine = grnLines.find((gl: GoodsReceiptLine) => gl.purchaseOrderLineId === poLine.id);
      let newReceived = ExactDecimal.parse(poLine.receivedQuantity || '0.0000', 4);
      let newAccepted = ExactDecimal.parse(poLine.acceptedQuantity || '0.0000', 4);

      if (matchingGrnLine) {
        newReceived = ExactDecimal.add(newReceived, ExactDecimal.parse(matchingGrnLine.receivedQuantity, 4));
        newAccepted = ExactDecimal.add(newAccepted, ExactDecimal.parse(matchingGrnLine.acceptedQuantity, 4));

        poLine.receivedQuantity = newReceived.toString();
        poLine.acceptedQuantity = newAccepted.toString();

        if (db) {
          await db
            .update(purchaseOrderLines)
            .set({
              receivedQuantity: newReceived.toString(),
              acceptedQuantity: newAccepted.toString(),
              updatedAt: new Date(),
            })
            .where(eq(purchaseOrderLines.id, poLine.id));
        }
      }

      const ordered = ExactDecimal.parse(poLine.orderedQuantity, 4);
      if (newReceived.rawBigInt < ordered.rawBigInt) {
        allPoLinesFullyReceived = false;
      }
    }

    const finalGrnStatus = grn.inspectionStatus === 'PARTIALLY_PASSED' ? 'PARTIALLY_ACCEPTED' : 'ACCEPTED';
    const actorId = ctx.user?.userId || 'system';
    const newVersion = grn.version + 1;

    let acceptedGrn = {
      ...grn,
      status: finalGrnStatus,
      acceptedAt: new Date(),
      acceptedBy: actorId,
      version: newVersion,
      updatedAt: new Date(),
      updatedBy: actorId,
    };

    if (db) {
      const [res] = await db
        .update(goodsReceipts)
        .set({
          status: finalGrnStatus,
          acceptedAt: new Date(),
          acceptedBy: actorId,
          version: newVersion,
          updatedAt: new Date(),
          updatedBy: actorId,
        })
        .where(and(eq(goodsReceipts.id, grn.id), eq(goodsReceipts.version, grn.version)))
        .returning();
      if (res) acceptedGrn = res;
    } else {
      memoryReceipts.set(grnId, acceptedGrn);
    }

    // Update PO status to PARTIALLY_RECEIVED or COMPLETED
    if (po) {
      const newPoStatus = allPoLinesFullyReceived ? 'COMPLETED' : 'PARTIALLY_RECEIVED';
      po.status = newPoStatus;
      if (db) {
        await db
          .update(purchaseOrders)
          .set({
            status: newPoStatus,
            updatedAt: new Date(),
          })
          .where(eq(purchaseOrders.id, po.id));
      }
    }

    await auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'GoodsReceiptNote',
      entityId: grn.id,
      action: 'ACCEPT',
      newValues: {
        grnNumber: grn.grnNumber,
        status: finalGrnStatus,
        poNumber: po?.poNumber,
      },
    });

    return { ...acceptedGrn, lines: grnLines };
  }

  /**
   * Reject Goods Receipt Note
   */
  async rejectGoodsReceipt(ctx: RequestContext, grnId: string, reason?: string) {
    const db = getDb();
    let grn: any = null;

    if (db) {
      const [dbGrn] = await db
        .select()
        .from(goodsReceipts)
        .where(and(eq(goodsReceipts.id, grnId), eq(goodsReceipts.tenantId, ctx.tenantId)));
      grn = dbGrn;
    } else {
      grn = memoryReceipts.get(grnId);
    }

    if (!grn) {
      throw new Error(`Goods Receipt Note '${grnId}' not found.`);
    }

    if (ctx.user) {
      authorizationService.authorize({
        user: ctx.user,
        action: 'procurement:grn:reject',
        companyId: grn.companyId,
      });
    }

    if (['ACCEPTED', 'CANCELLED', 'REJECTED'].includes(grn.status)) {
      throw new Error(`Cannot reject GRN '${grn.grnNumber}' in status '${grn.status}'.`);
    }

    const actorId = ctx.user?.userId || 'system';
    const newVersion = grn.version + 1;
    const newNotes = reason ? `${grn.notes || ''}\nRejection Reason: ${reason}` : grn.notes;

    let rejectedGrn = {
      ...grn,
      status: 'REJECTED',
      inspectionStatus: 'FAILED',
      notes: newNotes,
      version: newVersion,
      updatedAt: new Date(),
      updatedBy: actorId,
    };

    if (db) {
      const [res] = await db
        .update(goodsReceipts)
        .set({
          status: 'REJECTED',
          inspectionStatus: 'FAILED',
          notes: newNotes,
          version: newVersion,
          updatedAt: new Date(),
          updatedBy: actorId,
        })
        .where(and(eq(goodsReceipts.id, grn.id), eq(goodsReceipts.version, grn.version)))
        .returning();
      if (res) rejectedGrn = res;
    } else {
      memoryReceipts.set(grnId, rejectedGrn);
    }

    await auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'GoodsReceiptNote',
      entityId: grn.id,
      action: 'REJECT',
      newValues: {
        grnNumber: grn.grnNumber,
        status: 'REJECTED',
        reason,
      },
    });

    return rejectedGrn;
  }

  /**
   * Cancel Goods Receipt Note & Revert PO counters if previously accepted
   */
  async cancelGoodsReceipt(ctx: RequestContext, grnId: string, reason?: string) {
    const db = getDb();
    let grn: any = null;
    let grnLines: any[] = [];

    if (db) {
      const [dbGrn] = await db
        .select()
        .from(goodsReceipts)
        .where(and(eq(goodsReceipts.id, grnId), eq(goodsReceipts.tenantId, ctx.tenantId)));
      grn = dbGrn;
      if (grn) {
        grnLines = await db
          .select()
          .from(goodsReceiptLines)
          .where(eq(goodsReceiptLines.goodsReceiptId, grn.id));
      }
    } else {
      grn = memoryReceipts.get(grnId);
      if (grn) grnLines = memoryReceiptLines.get(grnId) || [];
    }

    if (!grn) {
      throw new Error(`Goods Receipt Note '${grnId}' not found.`);
    }

    if (ctx.user) {
      authorizationService.authorize({
        user: ctx.user,
        action: 'procurement:grn:cancel',
        companyId: grn.companyId,
      });
    }

    if (grn.status === 'CANCELLED') {
      throw new Error(`GRN '${grn.grnNumber}' is already cancelled.`);
    }

    const wasAccepted = ['ACCEPTED', 'PARTIALLY_ACCEPTED'].includes(grn.status);

    if (wasAccepted) {
      const poResult = await purchaseOrderService.getPurchaseOrderById(ctx, grn.purchaseOrderId);
      const po = poResult?.po;
      const poLines = poResult?.lines || [];

      let totalReceivedOnPo = 0n;

      for (const poLine of poLines) {
        const matchingGrnLine = grnLines.find((gl: GoodsReceiptLine) => gl.purchaseOrderLineId === poLine.id);
        let currReceived = ExactDecimal.parse(poLine.receivedQuantity || '0.0000', 4);
        let currAccepted = ExactDecimal.parse(poLine.acceptedQuantity || '0.0000', 4);

        if (matchingGrnLine) {
          currReceived = ExactDecimal.sub(currReceived, ExactDecimal.parse(matchingGrnLine.receivedQuantity, 4));
          currAccepted = ExactDecimal.sub(currAccepted, ExactDecimal.parse(matchingGrnLine.acceptedQuantity, 4));

          poLine.receivedQuantity = currReceived.rawBigInt < 0n ? '0.0000' : currReceived.toString();
          poLine.acceptedQuantity = currAccepted.rawBigInt < 0n ? '0.0000' : currAccepted.toString();

          if (db) {
            await db
              .update(purchaseOrderLines)
              .set({
                receivedQuantity: currReceived.rawBigInt < 0n ? '0.0000' : currReceived.toString(),
                acceptedQuantity: currAccepted.rawBigInt < 0n ? '0.0000' : currAccepted.toString(),
                updatedAt: new Date(),
              })
              .where(eq(purchaseOrderLines.id, poLine.id));
          }
        }

        totalReceivedOnPo += currReceived.rawBigInt < 0n ? 0n : currReceived.rawBigInt;
      }

      // Re-evaluate PO status
      const newPoStatus = totalReceivedOnPo > 0n ? 'PARTIALLY_RECEIVED' : 'ISSUED';
      if (po) po.status = newPoStatus;
      if (db) {
        await db
          .update(purchaseOrders)
          .set({
            status: newPoStatus,
            updatedAt: new Date(),
          })
          .where(eq(purchaseOrders.id, grn.purchaseOrderId));
      }
    }

    const actorId = ctx.user?.userId || 'system';
    const newVersion = grn.version + 1;

    let cancelledGrn = {
      ...grn,
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelledBy: actorId,
      cancellationReason: reason || null,
      version: newVersion,
      updatedAt: new Date(),
      updatedBy: actorId,
    };

    if (db) {
      const [res] = await db
        .update(goodsReceipts)
        .set({
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledBy: actorId,
          cancellationReason: reason || null,
          version: newVersion,
          updatedAt: new Date(),
          updatedBy: actorId,
        })
        .where(and(eq(goodsReceipts.id, grn.id), eq(goodsReceipts.version, grn.version)))
        .returning();
      if (res) cancelledGrn = res;
    } else {
      memoryReceipts.set(grnId, cancelledGrn);
    }

    await auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'GoodsReceiptNote',
      entityId: grn.id,
      action: 'CANCEL',
      newValues: {
        grnNumber: grn.grnNumber,
        status: 'CANCELLED',
        cancellationReason: reason,
      },
    });

    return cancelledGrn;
  }

  /**
   * Get GRN details by ID
   */
  async getGoodsReceiptById(ctx: RequestContext, grnId: string) {
    const db = getDb();
    let grn: any = null;
    let lines: any[] = [];
    let poNumber: string | undefined;
    let supplierName: string | undefined;
    let supplierCode: string | undefined;

    if (db) {
      const [dbGrn] = await db
        .select()
        .from(goodsReceipts)
        .where(and(eq(goodsReceipts.id, grnId), eq(goodsReceipts.tenantId, ctx.tenantId)));
      grn = dbGrn;
      if (grn) {
        lines = await db
          .select()
          .from(goodsReceiptLines)
          .where(eq(goodsReceiptLines.goodsReceiptId, grn.id));

        const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, grn.purchaseOrderId));
        poNumber = po?.poNumber;

        const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, grn.supplierId));
        supplierName = supplier?.name;
        supplierCode = supplier?.code;
      }
    } else {
      grn = memoryReceipts.get(grnId);
      if (grn) lines = memoryReceiptLines.get(grnId) || [];
    }

    if (!grn) return null;

    return {
      ...grn,
      purchaseOrderNumber: poNumber,
      supplierName,
      supplierCode,
      lines,
    };
  }

  /**
   * List GRNs with filtering
   */
  async listGoodsReceipts(ctx: RequestContext, filters: { companyId: string; status?: string; purchaseOrderId?: string }) {
    const db = getDb();
    if (db) {
      const conditions = [
        eq(goodsReceipts.tenantId, ctx.tenantId),
        eq(goodsReceipts.companyId, filters.companyId),
      ];

      if (filters.status) {
        conditions.push(eq(goodsReceipts.status, filters.status));
      }
      if (filters.purchaseOrderId) {
        conditions.push(eq(goodsReceipts.purchaseOrderId, filters.purchaseOrderId));
      }

      return db
        .select()
        .from(goodsReceipts)
        .where(and(...conditions));
    }

    return Array.from(memoryReceipts.values()).filter(
      (g) =>
        g.tenantId === ctx.tenantId &&
        g.companyId === filters.companyId &&
        (!filters.status || g.status === filters.status) &&
        (!filters.purchaseOrderId || g.purchaseOrderId === filters.purchaseOrderId)
    );
  }

  /**
   * Get GRNs for a Purchase Order
   */
  async getGoodsReceiptsForPo(ctx: RequestContext, purchaseOrderId: string) {
    const db = getDb();
    if (db) {
      return db
        .select()
        .from(goodsReceipts)
        .where(and(eq(goodsReceipts.tenantId, ctx.tenantId), eq(goodsReceipts.purchaseOrderId, purchaseOrderId)));
    }
    return Array.from(memoryReceipts.values()).filter(
      (g) => g.tenantId === ctx.tenantId && g.purchaseOrderId === purchaseOrderId
    );
  }

  /**
   * Get remaining receivable quantities line-by-line for a Purchase Order
   */
  async getPoReceivableQuantities(ctx: RequestContext, purchaseOrderId: string) {
    const poResult = await purchaseOrderService.getPurchaseOrderById(ctx, purchaseOrderId);
    if (!poResult || !poResult.po) {
      throw new Error(`Purchase Order '${purchaseOrderId}' not found.`);
    }

    const { lines } = poResult;

    return lines.map((l: PurchaseOrderLine) => {
      const orderedDec = ExactDecimal.parse(l.orderedQuantity, 4);
      const receivedDec = ExactDecimal.parse(l.receivedQuantity || '0.0000', 4);
      const acceptedDec = ExactDecimal.parse(l.acceptedQuantity || '0.0000', 4);
      const remainingDec = ExactDecimal.sub(orderedDec, receivedDec);

      return {
        purchaseOrderLineId: l.id,
        productId: l.productId,
        productCodeSnapshot: l.productCodeSnapshot,
        productNameSnapshot: l.productNameSnapshot,
        description: l.description,
        uom: l.uom,
        orderedQuantity: orderedDec.toString(),
        receivedQuantity: receivedDec.toString(),
        acceptedQuantity: acceptedDec.toString(),
        remainingReceivableQuantity: remainingDec.rawBigInt < 0n ? '0.0000' : remainingDec.toString(),
      };
    });
  }

  /**
   * Get GRN Line by ID
   */
  async getGrnLineById(_ctx: RequestContext, lineId: string): Promise<{ line: any | null }> {
    const db = getDb();
    if (db) {
      try {
        const [l] = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.id, lineId));
        if (l) return { line: l };
      } catch {
        // Fallback
      }
    }
    for (const linesList of memoryReceiptLines.values()) {
      const found = linesList.find((l) => l.id === lineId);
      if (found) return { line: found };
    }
    return { line: null };
  }

  /**
   * Add returned quantity to GRN line
   */
  async addReturnedQuantityToGrnLine(_ctx: RequestContext, lineId: string, qtyStr: string): Promise<void> {
    const db = getDb();
    if (db) {
      try {
        const [l] = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.id, lineId));
        if (l) {
          const curReturned = ExactDecimal.parse((l as any).returnedQuantity || '0.0000', 4);
          const addQty = ExactDecimal.parse(qtyStr, 4);
          const newReturned = curReturned.add(addQty).toString();
          await db.update(goodsReceiptLines).set({ returnedQuantity: newReturned } as any).where(eq(goodsReceiptLines.id, lineId));
        }
      } catch {
        // Ignore fallback
      }
    }
    for (const linesList of memoryReceiptLines.values()) {
      const found = linesList.find((l) => l.id === lineId);
      if (found) {
        const curReturned = ExactDecimal.parse((found as any).returnedQuantity || '0.0000', 4);
        const addQty = ExactDecimal.parse(qtyStr, 4);
        (found as any).returnedQuantity = curReturned.add(addQty).toString();
      }
    }
  }
}

export const goodsReceiptService = new GoodsReceiptService();
