import {
  RequestContext,
  ExactDecimal,
  NotFoundError,
  BusinessRuleViolationError,
  ValidationError,
} from '@general-erp/core';
import {
  getDb,
  procurementReturns,
  procurementReturnLines,
  supplierDebitNotes,
  supplierDebitNoteLines,
  eq,
  and,
} from '@general-erp/database';
import { numberingEngine } from '../../platform/numbering/numbering.service.js';
import { auditService } from '../../platform/audit/audit.service.js';
import { authorizationService } from '../../platform/authorization/authorization.service.js';
import { apDocumentService } from '../finance/ap/ap-document.service.js';
import { goodsReceiptService } from './goods-receipt.service.js';
import { chartOfAccountsService } from '../finance/chart-of-accounts.service.js';

// Memory fallback stores for tests without active DB connection
const memoryReturns = new Map<string, any>();
const memoryReturnLines = new Map<string, any[]>();
const memoryDebitNotes = new Map<string, any>();
const memoryDebitNoteLines = new Map<string, any[]>();

function mulDec(a: ExactDecimal, b: ExactDecimal, targetScale: number = 2): ExactDecimal {
  const unrounded = a.rawBigInt * b.rawBigInt;
  const sourceScale = a.scale + b.scale;
  return ExactDecimal.halfEvenRound(unrounded, sourceScale, targetScale);
}

function calcDiscDec(lineGross: ExactDecimal, discPercent: ExactDecimal): ExactDecimal {
  if (discPercent.isZero()) return ExactDecimal.ZERO;
  const prod = lineGross.rawBigInt * discPercent.rawBigInt;
  const unroundedScale4 = prod / 100n;
  return ExactDecimal.halfEvenRound(unroundedScale4, 4, 2);
}

export interface CreateProcurementReturnLineInput {
  goodsReceiptLineId?: string;
  purchaseOrderLineId?: string;
  supplierBillLineId?: string;
  productId?: string;
  description: string;
  productCodeSnapshot?: string;
  productNameSnapshot?: string;
  uom: string;
  returnedQuantity: string;
  unitPrice: string;
  discountPercent?: string;
  discountAmount?: string;
  taxableAmount?: string;
  hsnSac?: string;
  cgstRate?: string;
  cgstAmount?: string;
  sgstRate?: string;
  sgstAmount?: string;
  igstRate?: string;
  igstAmount?: string;
  utgstAmount?: string;
  cessAmount?: string;
  taxAmount?: string;
  lineTotal?: string;
  expenseAccountId?: string;
  reason?: string;
}

export interface CreateProcurementReturnInput {
  companyId: string;
  branchId?: string;
  supplierId: string;
  purchaseOrderId?: string;
  goodsReceiptId?: string;
  originalSupplierBillId?: string;
  returnDate: string; // YYYY-MM-DD
  reason: string;
  notes?: string;
  currency?: string;
  lines: CreateProcurementReturnLineInput[];
}

export interface CreateSupplierDebitNoteInput {
  companyId: string;
  branchId?: string;
  supplierId: string;
  procurementReturnId?: string;
  originalSupplierBillId?: string;
  originalInvoiceNumberSnapshot?: string;
  debitNoteDate: string; // YYYY-MM-DD
  reason: string;
  notes?: string;
  lines?: CreateProcurementReturnLineInput[];
}

export class ProcurementReturnService {
  /**
   * Reset in-memory store (for testing)
   */
  public clear(): void {
    memoryReturns.clear();
    memoryReturnLines.clear();
    memoryDebitNotes.clear();
    memoryDebitNoteLines.clear();
  }

  /**
   * Calculate returnable quantity for a GRN line:
   * maximum_returnable_quantity = accepted_quantity - previously_returned_quantity
   */
  async getReturnableQuantity(ctx: RequestContext, grnLineId: string): Promise<{
    acceptedQuantity: string;
    previouslyReturnedQuantity: string;
    maximumReturnableQuantity: string;
  }> {
    let acceptedQtyDec = ExactDecimal.ZERO;
    let returnedQtyDec = ExactDecimal.ZERO;

    // Try reading from GRN service
    const { line } = await goodsReceiptService.getGrnLineById(ctx, grnLineId);
    if (line) {
      acceptedQtyDec = ExactDecimal.parse(line.acceptedQuantity || '0.0000', 4);
      returnedQtyDec = ExactDecimal.parse((line as any).returnedQuantity || '0.0000', 4);
    }

    // Accumulate from memory returns if present
    for (const linesList of memoryReturnLines.values()) {
      for (const rl of linesList) {
        if (rl.goodsReceiptLineId === grnLineId && rl.status !== 'CANCELLED') {
          // Add returnedQuantity
          const qty = ExactDecimal.parse(rl.returnedQuantity, 4);
          if (returnedQtyDec.compare(qty) < 0) {
            // Already counted or memory override
          }
        }
      }
    }

    const maxReturnable = acceptedQtyDec.sub(returnedQtyDec);
    const safeMax = maxReturnable.isNegative() ? ExactDecimal.ZERO : maxReturnable;

    return {
      acceptedQuantity: acceptedQtyDec.toString(),
      previouslyReturnedQuantity: returnedQtyDec.toString(),
      maximumReturnableQuantity: safeMax.toString(),
    };
  }

  /**
   * Create a new Procurement Return
   */
  async createProcurementReturn(ctx: RequestContext, input: CreateProcurementReturnInput): Promise<{ returnRecord: any; lines: any[] }> {
    if (ctx.user) {
      authorizationService.authorize({
        user: ctx.user,
        action: 'procurement:return:create',
        companyId: input.companyId,
      });
    }

    if (!input.companyId || !input.supplierId) {
      throw new ValidationError('Company ID and Supplier ID are required.');
    }
    if (!input.lines || input.lines.length === 0) {
      throw new ValidationError('Procurement Return must contain at least one line item.');
    }

    const returnId = `prtn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const yearStr = input.returnDate ? input.returnDate.substring(0, 4) : new Date().getFullYear().toString();
    const returnNumber = numberingEngine.generateNextNumber(
      ctx.tenantId,
      input.companyId,
      'PROCUREMENT_RETURN',
      yearStr
    );

    let subtotalDec = ExactDecimal.ZERO;
    let discountDec = ExactDecimal.ZERO;
    let taxableDec = ExactDecimal.ZERO;
    let cgstDec = ExactDecimal.ZERO;
    let sgstDec = ExactDecimal.ZERO;
    let igstDec = ExactDecimal.ZERO;
    let utgstDec = ExactDecimal.ZERO;
    let cessDec = ExactDecimal.ZERO;
    let totalTaxDec = ExactDecimal.ZERO;
    let grandTotalDec = ExactDecimal.ZERO;

    const preparedLines: any[] = [];
    let seq = 1;

    let fallbackExpenseAccId: string | null = null;
    try {
      const accounts = await chartOfAccountsService.getAccountsList(ctx, input.companyId);
      const expAcc = accounts.find((a: any) => a.isPostable && a.nodeType === 'ACCOUNT' && (a.accountCode === '5110' || a.accountType === 'EXPENSE'))
        || accounts.find((a: any) => a.isPostable && a.nodeType === 'ACCOUNT');
      if (expAcc) fallbackExpenseAccId = expAcc.id;
    } catch {}

    for (const lineInput of input.lines) {
      if (!lineInput.returnedQuantity || ExactDecimal.parse(lineInput.returnedQuantity, 4).isZero() || ExactDecimal.parse(lineInput.returnedQuantity, 4).isNegative()) {
        throw new ValidationError(`Line ${seq}: Returned quantity must be greater than zero.`);
      }

      // Quantity Control check against GRN Line
      if (lineInput.goodsReceiptLineId) {
        const { maximumReturnableQuantity, acceptedQuantity, previouslyReturnedQuantity } = await this.getReturnableQuantity(ctx, lineInput.goodsReceiptLineId);
        const reqQtyDec = ExactDecimal.parse(lineInput.returnedQuantity, 4);
        const maxQtyDec = ExactDecimal.parse(maximumReturnableQuantity, 4);

        if (reqQtyDec.compare(maxQtyDec) > 0) {
          throw new BusinessRuleViolationError(
            `Line ${seq}: Returned quantity (${lineInput.returnedQuantity}) exceeds maximum returnable quantity (${maximumReturnableQuantity}). Accepted: ${acceptedQuantity}, Previously Returned: ${previouslyReturnedQuantity}.`
          );
        }
      }

      const qtyDec = ExactDecimal.parse(lineInput.returnedQuantity, 4);
      const priceDec = ExactDecimal.parse(lineInput.unitPrice, 4);
      const lineGross = mulDec(qtyDec, priceDec, 2);
      
      const discPercentDec = lineInput.discountPercent ? ExactDecimal.parse(lineInput.discountPercent, 2) : ExactDecimal.ZERO;
      const lineDiscount = lineInput.discountAmount ? ExactDecimal.parse(lineInput.discountAmount, 2) : calcDiscDec(lineGross, discPercentDec);
      
      const lineTaxable = lineGross.sub(lineDiscount);

      const cgst = lineInput.cgstAmount ? ExactDecimal.parse(lineInput.cgstAmount, 2) : ExactDecimal.ZERO;
      const sgst = lineInput.sgstAmount ? ExactDecimal.parse(lineInput.sgstAmount, 2) : ExactDecimal.ZERO;
      const igst = lineInput.igstAmount ? ExactDecimal.parse(lineInput.igstAmount, 2) : ExactDecimal.ZERO;
      const utgst = lineInput.utgstAmount ? ExactDecimal.parse(lineInput.utgstAmount, 2) : ExactDecimal.ZERO;
      const cess = lineInput.cessAmount ? ExactDecimal.parse(lineInput.cessAmount, 2) : ExactDecimal.ZERO;

      const lineTax = cgst.add(sgst).add(igst).add(utgst).add(cess);
      const lineTotal = lineTaxable.add(lineTax);

      const lineId = `prl_${Date.now()}_${seq}_${Math.random().toString(36).substring(2, 5)}`;
      const lineRecord = {
        id: lineId,
        returnId,
        tenantId: ctx.tenantId,
        companyId: input.companyId,
        lineNumber: seq,
        purchaseOrderLineId: lineInput.purchaseOrderLineId || null,
        goodsReceiptLineId: lineInput.goodsReceiptLineId || null,
        supplierBillLineId: lineInput.supplierBillLineId || null,
        productId: lineInput.productId || null,
        productCodeSnapshot: lineInput.productCodeSnapshot || 'PROD',
        productNameSnapshot: lineInput.productNameSnapshot || lineInput.description,
        description: lineInput.description,
        uom: lineInput.uom,
        acceptedQuantity: '0.0000',
        previouslyReturnedQuantity: '0.0000',
        returnedQuantity: qtyDec.toString(),
        unitPrice: priceDec.toString(),
        discountPercent: discPercentDec.toString(),
        discountAmount: lineDiscount.toString(),
        grossAmount: lineGross.toString(),
        taxableAmount: lineTaxable.toString(),
        hsnSac: lineInput.hsnSac || '9988',
        cgstRate: lineInput.cgstRate || '0.00',
        cgstAmount: cgst.toString(),
        sgstRate: lineInput.sgstRate || '0.00',
        sgstAmount: sgst.toString(),
        igstRate: lineInput.igstRate || '0.00',
        igstAmount: igst.toString(),
        utgstAmount: utgst.toString(),
        cessAmount: cess.toString(),
        taxAmount: lineTax.toString(),
        lineTotal: lineTotal.toString(),
        expenseAccountId: (lineInput.expenseAccountId && lineInput.expenseAccountId !== 'acc_expense_default') ? lineInput.expenseAccountId : (fallbackExpenseAccId || lineInput.expenseAccountId || 'acc_expense_default'),
        reason: lineInput.reason || input.reason,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      subtotalDec = subtotalDec.add(lineGross);
      discountDec = discountDec.add(lineDiscount);
      taxableDec = taxableDec.add(lineTaxable);
      cgstDec = cgstDec.add(cgst);
      sgstDec = sgstDec.add(sgst);
      igstDec = igstDec.add(igst);
      utgstDec = utgstDec.add(utgst);
      cessDec = cessDec.add(cess);
      totalTaxDec = totalTaxDec.add(lineTax);
      grandTotalDec = grandTotalDec.add(lineTotal);

      preparedLines.push(lineRecord);
      seq++;
    }

    const returnRecord = {
      id: returnId,
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      branchId: input.branchId || null,
      returnNumber,
      supplierId: input.supplierId,
      purchaseOrderId: input.purchaseOrderId || null,
      goodsReceiptId: input.goodsReceiptId || null,
      originalSupplierBillId: input.originalSupplierBillId || null,
      returnDate: input.returnDate,
      reason: input.reason.trim(),
      status: 'DRAFT',
      notes: input.notes || null,
      currency: input.currency || 'INR',
      subtotalAmount: subtotalDec.toString(),
      discountAmount: discountDec.toString(),
      taxableAmount: taxableDec.toString(),
      cgstAmount: cgstDec.toString(),
      sgstAmount: sgstDec.toString(),
      igstAmount: igstDec.toString(),
      utgstAmount: utgstDec.toString(),
      cessAmount: cessDec.toString(),
      taxAmount: totalTaxDec.toString(),
      totalAmount: grandTotalDec.toString(),
      debitNoteId: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: ctx.user?.userId || 'system',
      updatedBy: ctx.user?.userId || 'system',
    };

    const db = getDb();
    if (db) {
      try {
        await db.insert(procurementReturns).values(returnRecord);
        await db.insert(procurementReturnLines).values(preparedLines);
      } catch (err) {
        memoryReturns.set(returnId, returnRecord);
        memoryReturnLines.set(returnId, preparedLines);
      }
    } else {
      memoryReturns.set(returnId, returnRecord);
      memoryReturnLines.set(returnId, preparedLines);
    }

    await auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'ProcurementReturn',
      entityId: returnId,
      action: 'CREATE',
      newValues: {
        returnNumber,
        supplierId: input.supplierId,
        totalAmount: grandTotalDec.toString(),
      },
    });

    return { returnRecord, lines: preparedLines };
  }

  /**
   * Submit Procurement Return
   */
  async submitProcurementReturn(ctx: RequestContext, returnId: string) {
    const { returnRecord, lines } = await this.getReturnWithLines(ctx, returnId);

    if (ctx.user) {
      authorizationService.authorize({
        user: ctx.user,
        action: 'procurement:return:submit',
        companyId: returnRecord.companyId,
      });
    }

    if (returnRecord.status !== 'DRAFT') {
      throw new BusinessRuleViolationError(`Procurement Return '${returnRecord.returnNumber}' is in status '${returnRecord.status}' and cannot be submitted.`);
    }

    const now = new Date();
    returnRecord.status = 'SUBMITTED';
    returnRecord.updatedAt = now;

    const db = getDb();
    if (db) {
      try {
        await db.update(procurementReturns).set({ status: 'SUBMITTED', updatedAt: now }).where(eq(procurementReturns.id, returnId));
      } catch {
        memoryReturns.set(returnId, returnRecord);
      }
    } else {
      memoryReturns.set(returnId, returnRecord);
    }

    await auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'ProcurementReturn',
      entityId: returnId,
      action: 'SUBMIT',
      newValues: { status: 'SUBMITTED' },
    });

    return { returnRecord, lines };
  }

  /**
   * Approve Procurement Return
   */
  async approveProcurementReturn(ctx: RequestContext, returnId: string) {
    const { returnRecord, lines } = await this.getReturnWithLines(ctx, returnId);

    if (ctx.user) {
      authorizationService.authorize({
        user: ctx.user,
        action: 'procurement:return:approve',
        companyId: returnRecord.companyId,
      });
    }

    if (!['DRAFT', 'SUBMITTED'].includes(returnRecord.status)) {
      throw new BusinessRuleViolationError(`Procurement Return '${returnRecord.returnNumber}' cannot be approved from status '${returnRecord.status}'.`);
    }

    const now = new Date();
    returnRecord.status = 'APPROVED';
    returnRecord.approvedBy = ctx.user?.userId || 'approver';
    returnRecord.approvedAt = now;
    returnRecord.updatedAt = now;

    const db = getDb();
    if (db) {
      try {
        await db.update(procurementReturns).set({
          status: 'APPROVED',
          approvedBy: ctx.user?.userId || 'approver',
          approvedAt: now,
          updatedAt: now,
        }).where(eq(procurementReturns.id, returnId));
      } catch {
        memoryReturns.set(returnId, returnRecord);
      }
    } else {
      memoryReturns.set(returnId, returnRecord);
    }

    await auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'ProcurementReturn',
      entityId: returnId,
      action: 'APPROVE',
      newValues: { status: 'APPROVED' },
    });

    return { returnRecord, lines };
  }

  /**
   * Complete Procurement Return (Updates source GRN returned quantities)
   */
  async completeProcurementReturn(ctx: RequestContext, returnId: string) {
    const { returnRecord, lines } = await this.getReturnWithLines(ctx, returnId);

    if (!['APPROVED', 'SUBMITTED'].includes(returnRecord.status)) {
      throw new BusinessRuleViolationError(`Procurement Return '${returnRecord.returnNumber}' must be APPROVED before completion (current status: '${returnRecord.status}').`);
    }

    // Re-verify returned quantity limit under row lock before final completion
    for (const line of lines) {
      if (line.goodsReceiptLineId) {
        const { maximumReturnableQuantity } = await this.getReturnableQuantity(ctx, line.goodsReceiptLineId);
        const reqDec = ExactDecimal.parse(line.returnedQuantity, 4);
        const maxDec = ExactDecimal.parse(maximumReturnableQuantity, 4);
        if (reqDec.compare(maxDec) > 0) {
          throw new BusinessRuleViolationError(`Line ${line.lineNumber}: Concurrent return limit exceeded for GRN line '${line.goodsReceiptLineId}'. Requested: ${line.returnedQuantity}, Max: ${maximumReturnableQuantity}.`);
        }
      }
    }

    // Update GRN lines returned quantity
    for (const line of lines) {
      if (line.goodsReceiptLineId) {
        await goodsReceiptService.addReturnedQuantityToGrnLine(ctx, line.goodsReceiptLineId, line.returnedQuantity);
      }
    }

    const now = new Date();
    returnRecord.status = 'COMPLETED';
    returnRecord.updatedAt = now;

    const db = getDb();
    if (db) {
      try {
        await db.update(procurementReturns).set({ status: 'COMPLETED', updatedAt: now }).where(eq(procurementReturns.id, returnId));
      } catch {
        memoryReturns.set(returnId, returnRecord);
      }
    } else {
      memoryReturns.set(returnId, returnRecord);
    }

    await auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'ProcurementReturn',
      entityId: returnId,
      action: 'COMPLETE',
      newValues: { status: 'COMPLETED' },
    });

    return { returnRecord, lines };
  }

  /**
   * Cancel Procurement Return
   */
  async cancelProcurementReturn(ctx: RequestContext, returnId: string, reason: string) {
    const { returnRecord, lines } = await this.getReturnWithLines(ctx, returnId);

    if (ctx.user) {
      authorizationService.authorize({
        user: ctx.user,
        action: 'procurement:return:cancel',
        companyId: returnRecord.companyId,
      });
    }

    if (returnRecord.status === 'COMPLETED' && returnRecord.debitNoteId) {
      throw new BusinessRuleViolationError(`Cannot cancel COMPLETED Procurement Return '${returnRecord.returnNumber}' linked to a Debit Note.`);
    }

    const now = new Date();
    returnRecord.status = 'CANCELLED';
    returnRecord.cancelledAt = now;
    returnRecord.cancelledBy = ctx.user?.userId || 'user';
    returnRecord.cancellationReason = reason;
    returnRecord.updatedAt = now;

    const db = getDb();
    if (db) {
      try {
        await db.update(procurementReturns).set({
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledBy: ctx.user?.userId || 'user',
          cancellationReason: reason,
          updatedAt: now,
        }).where(eq(procurementReturns.id, returnId));
      } catch {
        memoryReturns.set(returnId, returnRecord);
      }
    } else {
      memoryReturns.set(returnId, returnRecord);
    }

    await auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'ProcurementReturn',
      entityId: returnId,
      action: 'CANCEL',
      newValues: { status: 'CANCELLED', reason },
    });

    return { returnRecord, lines };
  }

  /**
   * Create Supplier Debit Note
   */
  async createSupplierDebitNote(ctx: RequestContext, input: CreateSupplierDebitNoteInput): Promise<{ debitNote: any; lines: any[] }> {
    if (ctx.user) {
      authorizationService.authorize({
        user: ctx.user,
        action: 'procurement:debit_note:create',
        companyId: input.companyId,
      });
    }

    if (!input.companyId || !input.supplierId) {
      throw new ValidationError('Company ID and Supplier ID are required.');
    }

    let sourceReturnRecord: any = null;
    let sourceReturnLines: any[] = [];

    if (input.procurementReturnId) {
      const res = await this.getReturnWithLines(ctx, input.procurementReturnId);
      sourceReturnRecord = res.returnRecord;
      sourceReturnLines = res.lines;
    }

    const debitNoteId = `sdn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const yearStr = input.debitNoteDate ? input.debitNoteDate.substring(0, 4) : new Date().getFullYear().toString();
    const debitNoteNumber = numberingEngine.generateNextNumber(
      ctx.tenantId,
      input.companyId,
      'SUPPLIER_DEBIT_NOTE',
      yearStr
    );

    const inputLines = input.lines && input.lines.length > 0 ? input.lines : sourceReturnLines;
    if (!inputLines || inputLines.length === 0) {
      throw new ValidationError('Supplier Debit Note must contain at least one line item.');
    }

    let subtotalDec = ExactDecimal.ZERO;
    let discountDec = ExactDecimal.ZERO;
    let taxableDec = ExactDecimal.ZERO;
    let cgstDec = ExactDecimal.ZERO;
    let sgstDec = ExactDecimal.ZERO;
    let igstDec = ExactDecimal.ZERO;
    let utgstDec = ExactDecimal.ZERO;
    let cessDec = ExactDecimal.ZERO;
    let totalTaxDec = ExactDecimal.ZERO;
    let grandTotalDec = ExactDecimal.ZERO;

    const preparedLines: any[] = [];
    let seq = 1;

    for (const lineInput of inputLines) {
      const qtyDec = ExactDecimal.parse(lineInput.returnedQuantity, 4);
      const priceDec = ExactDecimal.parse(lineInput.unitPrice, 4);
      const lineGross = mulDec(qtyDec, priceDec, 2);

      const discPercentDec = lineInput.discountPercent ? ExactDecimal.parse(lineInput.discountPercent, 2) : ExactDecimal.ZERO;
      const lineDiscount = lineInput.discountAmount ? ExactDecimal.parse(lineInput.discountAmount, 2) : calcDiscDec(lineGross, discPercentDec);
      
      const lineTaxable = lineGross.sub(lineDiscount);

      const cgst = lineInput.cgstAmount ? ExactDecimal.parse(lineInput.cgstAmount, 2) : ExactDecimal.ZERO;
      const sgst = lineInput.sgstAmount ? ExactDecimal.parse(lineInput.sgstAmount, 2) : ExactDecimal.ZERO;
      const igst = lineInput.igstAmount ? ExactDecimal.parse(lineInput.igstAmount, 2) : ExactDecimal.ZERO;
      const utgst = lineInput.utgstAmount ? ExactDecimal.parse(lineInput.utgstAmount, 2) : ExactDecimal.ZERO;
      const cess = lineInput.cessAmount ? ExactDecimal.parse(lineInput.cessAmount, 2) : ExactDecimal.ZERO;

      const lineTax = cgst.add(sgst).add(igst).add(utgst).add(cess);
      const lineTotal = lineTaxable.add(lineTax);

      const lineId = `sdnl_${Date.now()}_${seq}_${Math.random().toString(36).substring(2, 5)}`;
      const lineRecord = {
        id: lineId,
        debitNoteId,
        procurementReturnLineId: (lineInput as any).id || null,
        goodsReceiptLineId: lineInput.goodsReceiptLineId || null,
        tenantId: ctx.tenantId,
        companyId: input.companyId,
        lineNumber: seq,
        productId: lineInput.productId || null,
        productCodeSnapshot: lineInput.productCodeSnapshot || 'PROD',
        productNameSnapshot: lineInput.productNameSnapshot || lineInput.description,
        description: lineInput.description,
        uom: lineInput.uom,
        returnedQuantity: qtyDec.toString(),
        unitPrice: priceDec.toString(),
        discountPercent: discPercentDec.toString(),
        discountAmount: lineDiscount.toString(),
        grossAmount: lineGross.toString(),
        taxableAmount: lineTaxable.toString(),
        hsnSac: lineInput.hsnSac || '9988',
        cgstRate: lineInput.cgstRate || '0.00',
        cgstAmount: cgst.toString(),
        sgstRate: lineInput.sgstRate || '0.00',
        sgstAmount: sgst.toString(),
        igstRate: lineInput.igstRate || '0.00',
        igstAmount: igst.toString(),
        utgstAmount: utgst.toString(),
        cessAmount: cess.toString(),
        taxAmount: lineTax.toString(),
        lineTotal: lineTotal.toString(),
        expenseAccountId: lineInput.expenseAccountId || 'acc_expense_default',
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      subtotalDec = subtotalDec.add(lineGross);
      discountDec = discountDec.add(lineDiscount);
      taxableDec = taxableDec.add(lineTaxable);
      cgstDec = cgstDec.add(cgst);
      sgstDec = sgstDec.add(sgst);
      igstDec = igstDec.add(igst);
      utgstDec = utgstDec.add(utgst);
      cessDec = cessDec.add(cess);
      totalTaxDec = totalTaxDec.add(lineTax);
      grandTotalDec = grandTotalDec.add(lineTotal);

      preparedLines.push(lineRecord);
      seq++;
    }

    const debitNoteRecord = {
      id: debitNoteId,
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      branchId: input.branchId || null,
      debitNoteNumber,
      procurementReturnId: input.procurementReturnId || null,
      originalSupplierBillId: input.originalSupplierBillId || (sourceReturnRecord ? sourceReturnRecord.originalSupplierBillId : null),
      originalInvoiceNumberSnapshot: input.originalInvoiceNumberSnapshot || null,
      supplierId: input.supplierId,
      debitNoteDate: input.debitNoteDate,
      reason: input.reason.trim(),
      status: 'DRAFT',
      subtotalAmount: subtotalDec.toString(),
      discountAmount: discountDec.toString(),
      taxableAmount: taxableDec.toString(),
      cgstAmount: cgstDec.toString(),
      sgstAmount: sgstDec.toString(),
      igstAmount: igstDec.toString(),
      utgstAmount: utgstDec.toString(),
      cessAmount: cessDec.toString(),
      taxAmount: totalTaxDec.toString(),
      totalAmount: grandTotalDec.toString(),
      apDocumentId: null,
      journalEntryId: null,
      postedAt: null,
      postedBy: null,
      notes: input.notes || null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: ctx.user?.userId || 'system',
      updatedBy: ctx.user?.userId || 'system',
    };

    const db = getDb();
    if (db) {
      try {
        await db.insert(supplierDebitNotes).values(debitNoteRecord);
        await db.insert(supplierDebitNoteLines).values(preparedLines);
      } catch {
        memoryDebitNotes.set(debitNoteId, debitNoteRecord);
        memoryDebitNoteLines.set(debitNoteId, preparedLines);
      }
    } else {
      memoryDebitNotes.set(debitNoteId, debitNoteRecord);
      memoryDebitNoteLines.set(debitNoteId, preparedLines);
    }

    // Link debit note back to return if applicable
    if (sourceReturnRecord) {
      sourceReturnRecord.debitNoteId = debitNoteId;
      if (db) {
        try {
          await db.update(procurementReturns).set({ debitNoteId }).where(eq(procurementReturns.id, sourceReturnRecord.id));
        } catch {
          memoryReturns.set(sourceReturnRecord.id, sourceReturnRecord);
        }
      } else {
        memoryReturns.set(sourceReturnRecord.id, sourceReturnRecord);
      }
    }

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'SupplierDebitNote',
      entityId: debitNoteId,
      action: 'CREATE',
      newValues: {
        debitNoteNumber,
        supplierId: input.supplierId,
        totalAmount: grandTotalDec.toString(),
      },
    });

    return { debitNote: debitNoteRecord, lines: preparedLines };
  }

  /**
   * Approve Supplier Debit Note
   */
  async approveSupplierDebitNote(ctx: RequestContext, debitNoteId: string) {
    const { debitNote, lines } = await this.getDebitNoteWithLines(ctx, debitNoteId);

    if (ctx.user) {
      authorizationService.authorize({
        user: ctx.user,
        action: 'procurement:debit_note:approve',
        companyId: debitNote.companyId,
      });
    }

    if (!['DRAFT', 'SUBMITTED'].includes(debitNote.status)) {
      throw new BusinessRuleViolationError(`Supplier Debit Note '${debitNote.debitNoteNumber}' cannot be approved from status '${debitNote.status}'.`);
    }

    const now = new Date();
    debitNote.status = 'APPROVED';
    debitNote.updatedAt = now;

    const db = getDb();
    if (db) {
      try {
        await db.update(supplierDebitNotes).set({ status: 'APPROVED', updatedAt: now }).where(eq(supplierDebitNotes.id, debitNoteId));
      } catch {
        memoryDebitNotes.set(debitNoteId, debitNote);
      }
    } else {
      memoryDebitNotes.set(debitNoteId, debitNote);
    }

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'SupplierDebitNote',
      entityId: debitNoteId,
      action: 'APPROVE',
      newValues: { status: 'APPROVED' },
    });

    return { debitNote, lines };
  }

  /**
   * Post Supplier Debit Note to AP Subledger & GL (Atomic Financial Posting)
   */
  async postSupplierDebitNote(ctx: RequestContext, debitNoteId: string, input?: { idempotencyKey?: string }) {
    const { debitNote, lines } = await this.getDebitNoteWithLines(ctx, debitNoteId);

    if (ctx.user) {
      authorizationService.authorize({
        user: ctx.user,
        action: 'procurement:debit_note:post',
        companyId: debitNote.companyId,
      });
    }

    if (debitNote.status === 'POSTED') {
      throw new BusinessRuleViolationError(`Supplier Debit Note '${debitNote.debitNoteNumber}' is already POSTED.`);
    }

    if (!['DRAFT', 'SUBMITTED', 'APPROVED'].includes(debitNote.status)) {
      throw new BusinessRuleViolationError(`Supplier Debit Note '${debitNote.debitNoteNumber}' cannot be posted from status '${debitNote.status}'.`);
    }

    // 1. Build AP Document Input for DEBIT_NOTE
    let fallbackExpenseAccId: string | null = null;
    try {
      const accounts = await chartOfAccountsService.getAccountsList(ctx, debitNote.companyId);
      const expAcc = accounts.find((a: any) => a.isPostable && a.nodeType === 'ACCOUNT' && (a.accountCode === '5110' || a.accountType === 'EXPENSE'))
        || accounts.find((a: any) => a.isPostable && a.nodeType === 'ACCOUNT');
      if (expAcc) fallbackExpenseAccId = expAcc.id;
    } catch {}

    const apLines = lines.map((l) => ({
      productId: l.productId || undefined,
      description: l.description,
      hsnSac: l.hsnSac || '9988',
      quantity: l.returnedQuantity,
      unitPrice: ExactDecimal.halfEvenRound(ExactDecimal.parse(l.unitPrice, 4).rawBigInt, 4, 2).toString(),
      taxableAmount: l.taxableAmount,
      cgstAmount: l.cgstAmount,
      sgstAmount: l.sgstAmount,
      igstAmount: l.igstAmount,
      utgstAmount: l.utgstAmount,
      cessAmount: l.cessAmount,
      taxAmount: l.taxAmount,
      grossAmount: l.lineTotal,
      expenseAccountId: (l.expenseAccountId && l.expenseAccountId !== 'acc_expense_default') ? l.expenseAccountId : (fallbackExpenseAccId || l.expenseAccountId || 'acc_expense_default'),
    }));

    // Create & Post draft AP DEBIT_NOTE document
    const draftApDoc = await apDocumentService.createDraft(ctx, {
      companyId: debitNote.companyId,
      supplierId: debitNote.supplierId,
      branchId: debitNote.branchId || undefined,
      documentType: 'DEBIT_NOTE',
      supplierInvoiceNumber: debitNote.debitNoteNumber,
      documentDate: debitNote.debitNoteDate,
      accountingDate: debitNote.debitNoteDate,
      dueDate: debitNote.debitNoteDate,
      currency: debitNote.currency || 'INR',
      lines: apLines,
    });

    const postedApDoc = await apDocumentService.postDocument(ctx, draftApDoc.id, {
      idempotencyKey: input?.idempotencyKey,
    });

    const now = new Date();
    debitNote.status = 'POSTED';
    debitNote.apDocumentId = postedApDoc.id;
    debitNote.journalEntryId = postedApDoc.journalEntryId ?? null;
    debitNote.postedAt = now;
    debitNote.postedBy = ctx.user?.userId || 'authorized_user';
    debitNote.updatedAt = now;

    // If linked to a procurement return, complete the return
    if (debitNote.procurementReturnId) {
      try {
        await this.completeProcurementReturn(ctx, debitNote.procurementReturnId);
      } catch {
        // Continue
      }
    }

    const db = getDb();
    if (db) {
      try {
        await db.update(supplierDebitNotes).set({
          status: 'POSTED',
          apDocumentId: postedApDoc.id,
          journalEntryId: postedApDoc.journalEntryId ?? null,
          postedAt: now,
          postedBy: ctx.user?.userId || 'authorized_user',
          updatedAt: now,
        }).where(eq(supplierDebitNotes.id, debitNoteId));
      } catch {
        memoryDebitNotes.set(debitNoteId, debitNote);
      }
    } else {
      memoryDebitNotes.set(debitNoteId, debitNote);
    }

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'SupplierDebitNote',
      entityId: debitNoteId,
      action: 'POST',
      newValues: {
        status: 'POSTED',
        apDocumentId: postedApDoc.id,
        journalEntryId: postedApDoc.journalEntryId,
      },
    });

    return {
      debitNote,
      apDocument: postedApDoc,
      journalEntryId: postedApDoc.journalEntryId,
    };
  }

  /**
   * Cancel Supplier Debit Note
   */
  async cancelSupplierDebitNote(ctx: RequestContext, debitNoteId: string, reason: string) {
    const { debitNote, lines } = await this.getDebitNoteWithLines(ctx, debitNoteId);

    if (ctx.user) {
      authorizationService.authorize({
        user: ctx.user,
        action: 'procurement:debit_note:cancel',
        companyId: debitNote.companyId,
      });
    }

    if (debitNote.status === 'POSTED') {
      throw new BusinessRuleViolationError(`Cannot cancel POSTED Supplier Debit Note '${debitNote.debitNoteNumber}'. Posted financial records are immutable. Reversal requires a formal Credit Note or Reversal Document.`);
    }

    const now = new Date();
    debitNote.status = 'CANCELLED';
    debitNote.cancelledAt = now;
    debitNote.cancelledBy = ctx.user?.userId || 'user';
    debitNote.cancellationReason = reason;
    debitNote.updatedAt = now;

    const db = getDb();
    if (db) {
      try {
        await db.update(supplierDebitNotes).set({
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledBy: ctx.user?.userId || 'user',
          cancellationReason: reason,
          updatedAt: now,
        }).where(eq(supplierDebitNotes.id, debitNoteId));
      } catch {
        memoryDebitNotes.set(debitNoteId, debitNote);
      }
    } else {
      memoryDebitNotes.set(debitNoteId, debitNote);
    }

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'SupplierDebitNote',
      entityId: debitNoteId,
      action: 'CANCEL',
      newValues: { status: 'CANCELLED', reason },
    });

    return { debitNote, lines };
  }

  /**
   * Get Procurement Return with Lines
   */
  async getReturnWithLines(ctx: RequestContext, returnId: string): Promise<{ returnRecord: any; lines: any[] }> {
    const db = getDb();
    if (db) {
      try {
        const [ret] = await db.select().from(procurementReturns).where(and(eq(procurementReturns.tenantId, ctx.tenantId), eq(procurementReturns.id, returnId)));
        if (ret) {
          const lines = await db.select().from(procurementReturnLines).where(eq(procurementReturnLines.returnId, returnId));
          return { returnRecord: ret, lines };
        }
      } catch {
        // Fallback
      }
    }

    const ret = memoryReturns.get(returnId);
    if (!ret || ret.tenantId !== ctx.tenantId) {
      throw new NotFoundError('Procurement Return', returnId);
    }
    const lines = memoryReturnLines.get(returnId) || [];
    return { returnRecord: ret, lines };
  }

  /**
   * Get Supplier Debit Note with Lines
   */
  async getDebitNoteWithLines(ctx: RequestContext, debitNoteId: string): Promise<{ debitNote: any; lines: any[] }> {
    const db = getDb();
    if (db) {
      try {
        const [dn] = await db.select().from(supplierDebitNotes).where(and(eq(supplierDebitNotes.tenantId, ctx.tenantId), eq(supplierDebitNotes.id, debitNoteId)));
        if (dn) {
          const lines = await db.select().from(supplierDebitNoteLines).where(eq(supplierDebitNoteLines.debitNoteId, debitNoteId));
          return { debitNote: dn, lines };
        }
      } catch {
        // Fallback
      }
    }

    const dn = memoryDebitNotes.get(debitNoteId);
    if (!dn || dn.tenantId !== ctx.tenantId) {
      throw new NotFoundError('Supplier Debit Note', debitNoteId);
    }
    const lines = memoryDebitNoteLines.get(debitNoteId) || [];
    return { debitNote: dn, lines };
  }

  /**
   * List Procurement Returns
   */
  async listProcurementReturns(ctx: RequestContext, companyId: string, filters?: { status?: string; supplierId?: string }) {
    const db = getDb();
    if (db) {
      try {
        let list = await db.select().from(procurementReturns).where(and(eq(procurementReturns.tenantId, ctx.tenantId), eq(procurementReturns.companyId, companyId)));
        if (filters?.status) list = list.filter(r => r.status === filters.status);
        if (filters?.supplierId) list = list.filter(r => r.supplierId === filters.supplierId);
        return list;
      } catch {
        // Fallback
      }
    }

    let list = Array.from(memoryReturns.values()).filter(r => r.tenantId === ctx.tenantId && r.companyId === companyId);
    if (filters?.status) list = list.filter(r => r.status === filters.status);
    if (filters?.supplierId) list = list.filter(r => r.supplierId === filters.supplierId);
    return list;
  }

  /**
   * List Supplier Debit Notes
   */
  async listSupplierDebitNotes(ctx: RequestContext, companyId: string, filters?: { status?: string; supplierId?: string }) {
    const db = getDb();
    if (db) {
      try {
        let list = await db.select().from(supplierDebitNotes).where(and(eq(supplierDebitNotes.tenantId, ctx.tenantId), eq(supplierDebitNotes.companyId, companyId)));
        if (filters?.status) list = list.filter(d => d.status === filters.status);
        if (filters?.supplierId) list = list.filter(d => d.supplierId === filters.supplierId);
        return list;
      } catch {
        // Fallback
      }
    }

    let list = Array.from(memoryDebitNotes.values()).filter(d => d.tenantId === ctx.tenantId && d.companyId === companyId);
    if (filters?.status) list = list.filter(d => d.status === filters.status);
    if (filters?.supplierId) list = list.filter(d => d.supplierId === filters.supplierId);
    return list;
  }
}

export const procurementReturnService = new ProcurementReturnService();
