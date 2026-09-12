import crypto from 'crypto';
import {
  RequestContext,
  ExactDecimal,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  BusinessRuleViolationError
} from '@general-erp/core';
import { logger } from '../../config/logger.js';
import { authorizationService } from '../../platform/authorization/authorization.service.js';
import { auditService } from '../../platform/audit/audit.service.js';
import { numberingEngine } from '../../platform/numbering/numbering.service.js';
import { salesInvoiceService } from './sales-invoice.service.js';
import {
  getDb,
  salesReturns,
  salesReturnLines,
  salesInvoices,
  salesInvoiceLines,
  eq,
  and,
  sql,
  or,
  ilike
} from '@general-erp/database';

export interface CreateSalesReturnLineInput {
  originalInvoiceLineId: string;
  returnQuantity: string;
  reason?: string | null;
}

export interface CreateSalesReturnInput {
  companyId: string;
  originalSalesInvoiceId: string;
  returnDate?: string;
  reason: string;
  notes?: string | null;
  lines?: CreateSalesReturnLineInput[];
}

export interface SalesReturnLineDTO {
  id: string;
  returnId: string;
  originalInvoiceLineId: string;
  originalDeliveryLineId?: string | null;
  tenantId: string;
  companyId: string;
  lineNumber: number;
  productId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  description?: string | null;
  uom: string;
  originalInvoicedQuantity: string;
  previouslyReturnedQuantity: string;
  returnQuantity: string;
  unitPrice: string;
  discountPercent: string;
  discountAmount: string;
  grossAmount: string;
  taxableAmount: string;
  hsnSac: string;
  cgstRate: string;
  cgstAmount: string;
  sgstRate: string;
  sgstAmount: string;
  igstRate: string;
  igstAmount: string;
  taxAmount: string;
  lineTotal: string;
  reason?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SalesReturnDTO {
  id: string;
  tenantId: string;
  companyId: string;
  returnNumber: string;
  customerId: string;
  originalSalesInvoiceId: string;
  originalSalesDeliveryId?: string | null;
  returnDate: string;
  reason: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CREDIT_NOTE_CREATED' | 'CANCELLED';
  notes?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  cancelledBy?: string | null;
  cancelledAt?: Date | null;
  cancellationReason?: string | null;
  lines: SalesReturnLineDTO[];
}

export interface ReturnableQuantityItemDTO {
  originalInvoiceLineId: string;
  productId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  uom: string;
  originalInvoicedQuantity: string;
  previouslyReturnedQuantity: string;
  remainingReturnableQuantity: string;
  unitPrice: string;
  discountPercent: string;
  hsnSac: string;
  taxableAmount: string;
  taxAmount: string;
  lineTotal: string;
}

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

function proRataTax(origTax: ExactDecimal, retQty: ExactDecimal, origQty: ExactDecimal): ExactDecimal {
  if (origQty.isZero() || retQty.isZero() || origTax.isZero()) return ExactDecimal.ZERO;
  const unrounded = (origTax.rawBigInt * retQty.rawBigInt) / origQty.rawBigInt;
  return ExactDecimal.halfEvenRound(unrounded, 2, 2);
}

function isGt(a: ExactDecimal, b: ExactDecimal): boolean {
  return a.compare(b) > 0;
}

export class SalesReturnService {
  private memoryStore = new Map<string, SalesReturnDTO>();
  private idempotencyStore = new Map<string, SalesReturnDTO>();
  private inFlightLocks = new Map<string, Promise<void>>();

  public clearMemoryStores(): void {
    this.memoryStore.clear();
    this.idempotencyStore.clear();
    this.inFlightLocks.clear();
  }

  private checkPermission(ctx: RequestContext, action: string): void {
    if (ctx.user) {
      const isWildcard = ctx.user.permissions.some(p => p === '*' || p === action || p.startsWith('sales:'));
      if (!isWildcard) {
        authorizationService.authorize({ user: ctx.user, action, companyId: ctx.companyId });
      }
    }
  }

  /**
   * Calculates remaining returnable quantities and amounts for all lines on a posted sales invoice
   */
  public async getReturnableQuantities(
    ctx: RequestContext,
    invoiceId: string
  ): Promise<ReturnableQuantityItemDTO[]> {
    this.checkPermission(ctx, 'sales:return:read');

    const invoice = await salesInvoiceService.getInvoiceById(ctx, invoiceId);
    if (invoice.status !== 'POSTED' && invoice.status !== 'PARTIALLY_SETTLED' && invoice.status !== 'SETTLED') {
      throw new ValidationError(`Cannot fetch returnable quantities for invoice '${invoice.invoiceNumber}'. Invoice status is '${invoice.status}'. Invoice must be POSTED.`);
    }

    // Accumulate previously returned quantities across non-cancelled returns for this invoice
    const returnedMap = new Map<string, ExactDecimal>();
    for (const invLine of invoice.lines) {
      returnedMap.set(invLine.id, ExactDecimal.parse('0.0000', 4));
    }

    const allReturns = await this.listReturns(ctx, invoice.companyId, { invoiceId });
    for (const ret of allReturns) {
      if (ret.status !== 'CANCELLED') {
        for (const line of ret.lines) {
          const current = returnedMap.get(line.originalInvoiceLineId) || ExactDecimal.parse('0.0000', 4);
          const retQtyDec = ExactDecimal.parse(line.returnQuantity, 4);
          returnedMap.set(line.originalInvoiceLineId, current.add(retQtyDec));
        }
      }
    }

    const result: ReturnableQuantityItemDTO[] = [];
    for (const invLine of invoice.lines) {
      const origQtyDec = ExactDecimal.parse(invLine.invoicedQuantity, 4);
      const prevRetDec = returnedMap.get(invLine.id) || ExactDecimal.parse('0.0000', 4);
      const remQtyDec = origQtyDec.sub(prevRetDec);
      const remQtyStr = remQtyDec.isNegative() ? '0.0000' : remQtyDec.toString();

      result.push({
        originalInvoiceLineId: invLine.id,
        productId: invLine.productId,
        productCodeSnapshot: invLine.productCodeSnapshot,
        productNameSnapshot: invLine.productNameSnapshot,
        uom: invLine.uom,
        originalInvoicedQuantity: invLine.invoicedQuantity,
        previouslyReturnedQuantity: prevRetDec.toString(),
        remainingReturnableQuantity: remQtyStr,
        unitPrice: invLine.unitPrice,
        discountPercent: invLine.discountPercent,
        hsnSac: invLine.hsnSac,
        taxableAmount: invLine.taxableAmount,
        taxAmount: invLine.taxAmount,
        lineTotal: invLine.lineTotal
      });
    }

    return result;
  }

  /**
   * Creates a draft Sales Return from an existing POSTED Sales Invoice
   */
  public async createReturn(
    ctx: RequestContext,
    input: CreateSalesReturnInput,
    idempotencyKey?: string
  ): Promise<SalesReturnDTO> {
    this.checkPermission(ctx, 'sales:return:create');

    if (idempotencyKey) {
      const cacheKey = `${ctx.tenantId}:${input.companyId}:${idempotencyKey}`;
      const cached = this.idempotencyStore.get(cacheKey);
      if (cached) return cached;
    }

    if (!input.reason || input.reason.trim() === '') {
      throw new ValidationError('Reason is required when creating a Sales Return.');
    }

    const userId = ctx.user?.userId || (ctx as any).userId || '00000000-0000-0000-0000-000000000000';
    const db = getDb();
    const returnDateStr = input.returnDate || new Date().toISOString().split('T')[0]!;

    if (!db) {
      // In-Memory Fallback Mode (Unit Testing)
      const lockKey = `${ctx.tenantId}:${input.companyId}:${input.originalSalesInvoiceId}`;
      while (this.inFlightLocks.has(lockKey)) {
        await this.inFlightLocks.get(lockKey);
      }
      let resolveLock!: () => void;
      const lockPromise = new Promise<void>((res) => { resolveLock = res; });
      this.inFlightLocks.set(lockKey, lockPromise);

      try {
        const invoice = await salesInvoiceService.getInvoiceById(ctx, input.originalSalesInvoiceId);
        if (invoice.status !== 'POSTED' && invoice.status !== 'PARTIALLY_SETTLED' && invoice.status !== 'SETTLED') {
          throw new ValidationError(`Cannot create Sales Return for invoice '${invoice.invoiceNumber}' in status '${invoice.status}'. Invoice must be POSTED.`);
        }

        const returnables = await this.getReturnableQuantities(ctx, invoice.id);
        const returnableMap = new Map(returnables.map(r => [r.originalInvoiceLineId, r]));

        const returnId = crypto.randomUUID();
        const yearStr = new Date().getFullYear().toString();
        numberingEngine.configureSequence(ctx.tenantId, input.companyId, {
          documentType: 'SALES_RETURN',
          prefix: 'SR',
          fiscalYear: yearStr,
          currentSequence: 0,
          paddingDigits: 4,
          resetOnFiscalYear: true
        });
        const returnNumber = numberingEngine.generateNextNumber(ctx.tenantId, input.companyId, 'SALES_RETURN', yearStr);

        const createdLines: SalesReturnLineDTO[] = [];
        let lineNumCounter = 1;

        for (const invLine of invoice.lines) {
          let retQtyStr = '0.0000';
          let lineReason = input.reason;

          if (input.lines && input.lines.length > 0) {
            const userLine = input.lines.find(l => l.originalInvoiceLineId === invLine.id);
            if (userLine) {
              retQtyStr = userLine.returnQuantity;
              if (userLine.reason) lineReason = userLine.reason;
            } else {
              continue;
            }
          } else {
            // Default: Full remaining return
            const item = returnableMap.get(invLine.id);
            retQtyStr = item?.remainingReturnableQuantity || '0.0000';
          }

          const retQtyDec = ExactDecimal.parse(retQtyStr, 4);
          if (retQtyDec.isZero() || retQtyDec.isNegative()) continue;

          const item = returnableMap.get(invLine.id);
          const maxReturnableDec = ExactDecimal.parse(item?.remainingReturnableQuantity || '0.0000', 4);

          if (isGt(retQtyDec, maxReturnableDec)) {
            throw new ValidationError(
              `RETURN_QUANTITY_EXCEEDED: Requested return quantity (${retQtyDec.toString()}) for product '${invLine.productCodeSnapshot}' exceeds remaining returnable quantity (${maxReturnableDec.toString()}).`
            );
          }

          const unitPriceDec = ExactDecimal.parse(invLine.unitPrice, 4);
          const discPercentDec = ExactDecimal.parse(invLine.discountPercent || '0.00', 2);
          const grossDec = mulDec(retQtyDec, unitPriceDec, 2);
          const discDec = calcDiscDec(grossDec, discPercentDec);
          const taxableDec = grossDec.sub(discDec);

          const origInvoicedQtyDec = ExactDecimal.parse(invLine.invoicedQuantity, 4);
          const origCgstDec = ExactDecimal.parse(invLine.cgstAmount, 2);
          const origSgstDec = ExactDecimal.parse(invLine.sgstAmount, 2);
          const origIgstDec = ExactDecimal.parse(invLine.igstAmount, 2);

          const lineCgstDec = proRataTax(origCgstDec, retQtyDec, origInvoicedQtyDec);
          const lineSgstDec = proRataTax(origSgstDec, retQtyDec, origInvoicedQtyDec);
          const lineIgstDec = proRataTax(origIgstDec, retQtyDec, origInvoicedQtyDec);

          const lineTaxDec = lineCgstDec.add(lineSgstDec).add(lineIgstDec);
          const lineTotalDec = taxableDec.add(lineTaxDec);

          const lineDto: SalesReturnLineDTO = {
            id: crypto.randomUUID(),
            returnId,
            originalInvoiceLineId: invLine.id,
            originalDeliveryLineId: invLine.salesDeliveryLineId || null,
            tenantId: ctx.tenantId,
            companyId: input.companyId,
            lineNumber: lineNumCounter++,
            productId: invLine.productId,
            productCodeSnapshot: invLine.productCodeSnapshot,
            productNameSnapshot: invLine.productNameSnapshot,
            description: invLine.description || null,
            uom: invLine.uom,
            originalInvoicedQuantity: invLine.invoicedQuantity,
            previouslyReturnedQuantity: item?.previouslyReturnedQuantity || '0.0000',
            returnQuantity: retQtyDec.toString(),
            unitPrice: invLine.unitPrice,
            discountPercent: invLine.discountPercent,
            discountAmount: discDec.toString(),
            grossAmount: grossDec.toString(),
            taxableAmount: taxableDec.toString(),
            hsnSac: invLine.hsnSac,
            cgstRate: invLine.cgstRate,
            cgstAmount: lineCgstDec.toString(),
            sgstRate: invLine.sgstRate,
            sgstAmount: lineSgstDec.toString(),
            igstRate: invLine.igstRate,
            igstAmount: lineIgstDec.toString(),
            taxAmount: lineTaxDec.toString(),
            lineTotal: lineTotalDec.toString(),
            reason: lineReason,
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date()
          };
          createdLines.push(lineDto);
        }

        if (createdLines.length === 0) {
          throw new ValidationError('Sales Return must contain at least one line item with a positive return quantity.');
        }

        const returnDto: SalesReturnDTO = {
          id: returnId,
          tenantId: ctx.tenantId,
          companyId: input.companyId,
          returnNumber,
          customerId: invoice.customerId,
          originalSalesInvoiceId: invoice.id,
          originalSalesDeliveryId: invoice.salesDeliveryId || null,
          returnDate: returnDateStr,
          reason: input.reason,
          status: 'DRAFT',
          notes: input.notes || null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: userId,
          updatedBy: userId,
          lines: createdLines
        };

        this.memoryStore.set(`${ctx.tenantId}:${input.companyId}:${returnId}`, returnDto);
        if (idempotencyKey) {
          this.idempotencyStore.set(`${ctx.tenantId}:${input.companyId}:${idempotencyKey}`, returnDto);
        }

        await auditService.logEvent(ctx, {
          module: 'sales',
          entityName: 'SalesReturn',
          entityId: returnId,
          action: 'CREATE',
          newValues: { returnNumber, originalInvoiceId: invoice.id, status: 'DRAFT' }
        });

        logger.info({ tenantId: ctx.tenantId, companyId: input.companyId, returnId, returnNumber }, '[SalesReturn] Created DRAFT sales return');
        return returnDto;
      } finally {
        resolveLock();
        this.inFlightLocks.delete(lockKey);
      }
    } else {
      // DB Persistence Mode
      return await db.transaction(async (tx) => {
        const [invoiceRow] = await tx
          .select()
          .from(salesInvoices)
          .where(
            and(
              eq(salesInvoices.id, input.originalSalesInvoiceId),
              eq(salesInvoices.tenantId, ctx.tenantId),
              eq(salesInvoices.companyId, input.companyId)
            )
          )
          .for('update');

        if (!invoiceRow) {
          throw new NotFoundError(`Sales Invoice with ID '${input.originalSalesInvoiceId}' not found.`);
        }

        if (invoiceRow.status !== 'POSTED' && invoiceRow.status !== 'PARTIALLY_SETTLED' && invoiceRow.status !== 'SETTLED') {
          throw new ValidationError(`Cannot create Sales Return for invoice '${invoiceRow.invoiceNumber}' in status '${invoiceRow.status}'. Invoice must be POSTED.`);
        }

        const dbInvoiceLines = await tx
          .select()
          .from(salesInvoiceLines)
          .where(eq(salesInvoiceLines.invoiceId, invoiceRow.id))
          .for('update');

        // Retrieve existing non-cancelled return lines to compute cumulative returned quantities
        const existingReturnLines = await tx
          .select({
            originalInvoiceLineId: salesReturnLines.originalInvoiceLineId,
            returnQuantity: salesReturnLines.returnQuantity
          })
          .from(salesReturnLines)
          .innerJoin(salesReturns, eq(salesReturnLines.returnId, salesReturns.id))
          .where(
            and(
              eq(salesReturns.tenantId, ctx.tenantId),
              eq(salesReturns.companyId, input.companyId),
              eq(salesReturns.originalSalesInvoiceId, invoiceRow.id),
              sql`${salesReturns.status} != 'CANCELLED'`
            )
          );

        const returnedMap = new Map<string, ExactDecimal>();
        for (const l of dbInvoiceLines) {
          returnedMap.set(l.id, ExactDecimal.parse('0.0000', 4));
        }
        for (const er of existingReturnLines) {
          const cur = returnedMap.get(er.originalInvoiceLineId) || ExactDecimal.parse('0.0000', 4);
          returnedMap.set(er.originalInvoiceLineId, cur.add(ExactDecimal.parse(er.returnQuantity, 4)));
        }

        const returnId = crypto.randomUUID();
        const yearStr = new Date().getFullYear().toString();
        numberingEngine.configureSequence(ctx.tenantId, input.companyId, {
          documentType: 'SALES_RETURN',
          prefix: 'SR',
          fiscalYear: yearStr,
          currentSequence: 0,
          paddingDigits: 4,
          resetOnFiscalYear: true
        });
        const returnNumber = numberingEngine.generateNextNumber(ctx.tenantId, input.companyId, 'SALES_RETURN', yearStr);

        const createdLines: SalesReturnLineDTO[] = [];
        let lineNumCounter = 1;

        for (const invLine of dbInvoiceLines) {
          let retQtyStr = '0.0000';
          let lineReason = input.reason;

          if (input.lines && input.lines.length > 0) {
            const userLine = input.lines.find(l => l.originalInvoiceLineId === invLine.id);
            if (userLine) {
              retQtyStr = userLine.returnQuantity;
              if (userLine.reason) lineReason = userLine.reason;
            } else {
              continue;
            }
          } else {
            const origQtyDec = ExactDecimal.parse(invLine.invoicedQuantity, 4);
            const prevRetDec = returnedMap.get(invLine.id) || ExactDecimal.parse('0.0000', 4);
            const remDec = origQtyDec.sub(prevRetDec);
            retQtyStr = remDec.isNegative() ? '0.0000' : remDec.toString();
          }

          const retQtyDec = ExactDecimal.parse(retQtyStr, 4);
          if (retQtyDec.isZero() || retQtyDec.isNegative()) continue;

          const origQtyDec = ExactDecimal.parse(invLine.invoicedQuantity, 4);
          const prevRetDec = returnedMap.get(invLine.id) || ExactDecimal.parse('0.0000', 4);
          const maxReturnableDec = origQtyDec.sub(prevRetDec);

          if (isGt(retQtyDec, maxReturnableDec)) {
            throw new ValidationError(
              `RETURN_QUANTITY_EXCEEDED: Requested return quantity (${retQtyDec.toString()}) for product '${invLine.productCodeSnapshot}' exceeds remaining returnable quantity (${maxReturnableDec.toString()}).`
            );
          }

          const unitPriceDec = ExactDecimal.parse(invLine.unitPrice, 4);
          const discPercentDec = ExactDecimal.parse(invLine.discountPercent || '0.00', 2);
          const grossDec = mulDec(retQtyDec, unitPriceDec, 2);
          const discDec = calcDiscDec(grossDec, discPercentDec);
          const taxableDec = grossDec.sub(discDec);

          const origCgstDec = ExactDecimal.parse(invLine.cgstAmount, 2);
          const origSgstDec = ExactDecimal.parse(invLine.sgstAmount, 2);
          const origIgstDec = ExactDecimal.parse(invLine.igstAmount, 2);

          const lineCgstDec = proRataTax(origCgstDec, retQtyDec, origQtyDec);
          const lineSgstDec = proRataTax(origSgstDec, retQtyDec, origQtyDec);
          const lineIgstDec = proRataTax(origIgstDec, retQtyDec, origQtyDec);

          const lineTaxDec = lineCgstDec.add(lineSgstDec).add(lineIgstDec);
          const lineTotalDec = taxableDec.add(lineTaxDec);

          const lineDto: SalesReturnLineDTO = {
            id: crypto.randomUUID(),
            returnId,
            originalInvoiceLineId: invLine.id,
            originalDeliveryLineId: invLine.salesDeliveryLineId || null,
            tenantId: ctx.tenantId,
            companyId: input.companyId,
            lineNumber: lineNumCounter++,
            productId: invLine.productId,
            productCodeSnapshot: invLine.productCodeSnapshot,
            productNameSnapshot: invLine.productNameSnapshot,
            description: invLine.description || null,
            uom: invLine.uom,
            originalInvoicedQuantity: invLine.invoicedQuantity,
            previouslyReturnedQuantity: prevRetDec.toString(),
            returnQuantity: retQtyDec.toString(),
            unitPrice: invLine.unitPrice,
            discountPercent: invLine.discountPercent,
            discountAmount: discDec.toString(),
            grossAmount: grossDec.toString(),
            taxableAmount: taxableDec.toString(),
            hsnSac: invLine.hsnSac,
            cgstRate: invLine.cgstRate,
            cgstAmount: lineCgstDec.toString(),
            sgstRate: invLine.sgstRate,
            sgstAmount: lineSgstDec.toString(),
            igstRate: invLine.igstRate,
            igstAmount: lineIgstDec.toString(),
            taxAmount: lineTaxDec.toString(),
            lineTotal: lineTotalDec.toString(),
            reason: lineReason,
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date()
          };
          createdLines.push(lineDto);
        }

        if (createdLines.length === 0) {
          throw new ValidationError('Sales Return must contain at least one line item with a positive return quantity.');
        }

        await tx.insert(salesReturns).values({
          id: returnId,
          tenantId: ctx.tenantId,
          companyId: input.companyId,
          returnNumber,
          customerId: invoiceRow.customerId,
          originalSalesInvoiceId: invoiceRow.id,
          originalSalesDeliveryId: invoiceRow.salesDeliveryId || null,
          returnDate: returnDateStr,
          reason: input.reason,
          status: 'DRAFT',
          notes: input.notes || null,
          version: 1,
          createdBy: userId,
          updatedBy: userId
        } as any);

        for (const l of createdLines) {
          await tx.insert(salesReturnLines).values({
            id: l.id,
            returnId: l.returnId,
            originalInvoiceLineId: l.originalInvoiceLineId,
            originalDeliveryLineId: l.originalDeliveryLineId,
            tenantId: l.tenantId,
            companyId: l.companyId,
            lineNumber: l.lineNumber,
            productId: l.productId,
            productCodeSnapshot: l.productCodeSnapshot,
            productNameSnapshot: l.productNameSnapshot,
            description: l.description,
            uom: l.uom,
            originalInvoicedQuantity: l.originalInvoicedQuantity,
            previouslyReturnedQuantity: l.previouslyReturnedQuantity,
            returnQuantity: l.returnQuantity,
            unitPrice: l.unitPrice,
            discountPercent: l.discountPercent,
            discountAmount: l.discountAmount,
            grossAmount: l.grossAmount,
            taxableAmount: l.taxableAmount,
            hsnSac: l.hsnSac,
            cgstRate: l.cgstRate,
            cgstAmount: l.cgstAmount,
            sgstRate: l.sgstRate,
            sgstAmount: l.sgstAmount,
            igstRate: l.igstRate,
            igstAmount: l.igstAmount,
            taxAmount: l.taxAmount,
            lineTotal: l.lineTotal,
            reason: l.reason
          } as any);
        }

        const returnDto: SalesReturnDTO = {
          id: returnId,
          tenantId: ctx.tenantId,
          companyId: input.companyId,
          returnNumber,
          customerId: invoiceRow.customerId,
          originalSalesInvoiceId: invoiceRow.id,
          originalSalesDeliveryId: invoiceRow.salesDeliveryId || null,
          returnDate: returnDateStr,
          reason: input.reason,
          status: 'DRAFT',
          notes: input.notes || null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: userId,
          updatedBy: userId,
          lines: createdLines
        };

        this.memoryStore.set(`${ctx.tenantId}:${input.companyId}:${returnId}`, returnDto);

        await auditService.logEvent(ctx, {
          module: 'sales',
          entityName: 'SalesReturn',
          entityId: returnId,
          action: 'CREATE',
          newValues: { returnNumber, originalInvoiceId: invoiceRow.id, status: 'DRAFT' }
        });

        return returnDto;
      });
    }
  }

  /**
   * Submit a DRAFT Sales Return
   */
  public async submitReturn(ctx: RequestContext, returnId: string): Promise<SalesReturnDTO> {
    this.checkPermission(ctx, 'sales:return:submit');
    const ret = await this.getReturnById(ctx, returnId);

    if (ret.status !== 'DRAFT') {
      throw new ValidationError(`Cannot submit Sales Return '${ret.returnNumber}' in state '${ret.status}'. Return must be DRAFT.`);
    }

    ret.status = 'SUBMITTED';
    ret.updatedAt = new Date();

    const db = getDb();
    if (db) {
      await db
        .update(salesReturns)
        .set({ status: 'SUBMITTED', updatedAt: new Date() })
        .where(eq(salesReturns.id, returnId));
    }
    this.memoryStore.set(`${ctx.tenantId}:${ret.companyId}:${returnId}`, ret);

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesReturn',
      entityId: returnId,
      action: 'SUBMIT',
      newValues: { status: 'SUBMITTED' }
    });

    return ret;
  }

  /**
   * Approve a SUBMITTED Sales Return
   */
  public async approveReturn(ctx: RequestContext, returnId: string): Promise<SalesReturnDTO> {
    this.checkPermission(ctx, 'sales:return:approve');
    const ret = await this.getReturnById(ctx, returnId);

    if (ret.status !== 'SUBMITTED' && ret.status !== 'DRAFT') {
      throw new ValidationError(`Cannot approve Sales Return '${ret.returnNumber}' in state '${ret.status}'. Return must be SUBMITTED or DRAFT.`);
    }

    const userId = ctx.user?.userId || (ctx as any).userId || '00000000-0000-0000-0000-000000000000';
    ret.status = 'APPROVED';
    ret.approvedBy = userId;
    ret.approvedAt = new Date();
    ret.updatedAt = new Date();

    const db = getDb();
    if (db) {
      await db
        .update(salesReturns)
        .set({
          status: 'APPROVED',
          approvedBy: userId,
          approvedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(salesReturns.id, returnId));
    }
    this.memoryStore.set(`${ctx.tenantId}:${ret.companyId}:${returnId}`, ret);

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesReturn',
      entityId: returnId,
      action: 'APPROVE',
      newValues: { status: 'APPROVED', approvedBy: userId }
    });

    return ret;
  }

  /**
   * Cancel a DRAFT or SUBMITTED Sales Return
   */
  public async cancelReturn(ctx: RequestContext, returnId: string, reason: string): Promise<SalesReturnDTO> {
    this.checkPermission(ctx, 'sales:return:cancel');
    if (!reason || reason.trim() === '') {
      throw new ValidationError('Cancellation reason is required when cancelling a Sales Return.');
    }

    const ret = await this.getReturnById(ctx, returnId);
    if (ret.status === 'CREDIT_NOTE_CREATED') {
      throw new BusinessRuleViolationError('Cannot cancel a Sales Return that has already generated a Credit Note.');
    }
    if (ret.status === 'CANCELLED') return ret;

    const userId = ctx.user?.userId || (ctx as any).userId || '00000000-0000-0000-0000-000000000000';
    ret.status = 'CANCELLED';
    ret.cancelledBy = userId;
    ret.cancelledAt = new Date();
    ret.cancellationReason = reason;
    ret.updatedAt = new Date();

    const db = getDb();
    if (db) {
      await db
        .update(salesReturns)
        .set({
          status: 'CANCELLED',
          cancelledBy: userId,
          cancelledAt: new Date(),
          cancellationReason: reason,
          updatedAt: new Date()
        })
        .where(eq(salesReturns.id, returnId));
    }
    this.memoryStore.set(`${ctx.tenantId}:${ret.companyId}:${returnId}`, ret);

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesReturn',
      entityId: returnId,
      action: 'CANCEL',
      newValues: { status: 'CANCELLED', cancellationReason: reason }
    });

    return ret;
  }

  /**
   * Get Sales Return by ID
   */
  public async getReturnById(ctx: RequestContext, id: string): Promise<SalesReturnDTO> {
    this.checkPermission(ctx, 'sales:return:read');
    const cached = this.memoryStore.get(`${ctx.tenantId}:${ctx.companyId}:${id}`);
    if (cached) return cached;

    const db = getDb();
    if (db) {
      const [r] = await db
        .select()
        .from(salesReturns)
        .where(and(eq(salesReturns.id, id), eq(salesReturns.tenantId, ctx.tenantId), eq(salesReturns.companyId, ctx.companyId)));

      if (!r) {
        throw new NotFoundError(`Sales Return with ID '${id}' not found.`);
      }

      const lineRows = await db
        .select()
        .from(salesReturnLines)
        .where(eq(salesReturnLines.returnId, id));

      const dto: SalesReturnDTO = {
        id: r.id,
        tenantId: r.tenantId,
        companyId: r.companyId,
        returnNumber: r.returnNumber,
        customerId: r.customerId,
        originalSalesInvoiceId: r.originalSalesInvoiceId,
        originalSalesDeliveryId: r.originalSalesDeliveryId || null,
        returnDate: r.returnDate,
        reason: r.reason,
        status: r.status as any,
        notes: r.notes || null,
        version: r.version,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        createdBy: r.createdBy,
        updatedBy: r.updatedBy,
        approvedBy: r.approvedBy || null,
        approvedAt: r.approvedAt || null,
        cancelledBy: r.cancelledBy || null,
        cancelledAt: r.cancelledAt || null,
        cancellationReason: r.cancellationReason || null,
        lines: lineRows.map((l: any) => ({
          id: l.id,
          returnId: l.returnId,
          originalInvoiceLineId: l.originalInvoiceLineId,
          originalDeliveryLineId: l.originalDeliveryLineId || null,
          tenantId: l.tenantId,
          companyId: l.companyId,
          lineNumber: l.lineNumber,
          productId: l.productId,
          productCodeSnapshot: l.productCodeSnapshot,
          productNameSnapshot: l.productNameSnapshot,
          description: l.description || null,
          uom: l.uom,
          originalInvoicedQuantity: l.originalInvoicedQuantity,
          previouslyReturnedQuantity: l.previouslyReturnedQuantity,
          returnQuantity: l.returnQuantity,
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent,
          discountAmount: l.discountAmount,
          grossAmount: l.grossAmount,
          taxableAmount: l.taxableAmount,
          hsnSac: l.hsnSac,
          cgstRate: l.cgstRate,
          cgstAmount: l.cgstAmount,
          sgstRate: l.sgstRate,
          sgstAmount: l.sgstAmount,
          igstRate: l.igstRate,
          igstAmount: l.igstAmount,
          taxAmount: l.taxAmount,
          lineTotal: l.lineTotal,
          reason: l.reason || null,
          version: l.version,
          createdAt: l.createdAt,
          updatedAt: l.updatedAt
        }))
      };

      this.memoryStore.set(`${ctx.tenantId}:${ctx.companyId}:${id}`, dto);
      return dto;
    }

    throw new NotFoundError(`Sales Return with ID '${id}' not found.`);
  }

  /**
   * List Sales Returns for a company
   */
  public async listReturns(
    ctx: RequestContext,
    companyId: string,
    query?: { status?: string; search?: string; customerId?: string; invoiceId?: string }
  ): Promise<SalesReturnDTO[]> {
    this.checkPermission(ctx, 'sales:return:read');
    if (companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match query companyId.');
    }

    const db = getDb();
    if (db) {
      let conds = [eq(salesReturns.tenantId, ctx.tenantId), eq(salesReturns.companyId, companyId)];
      if (query?.status) conds.push(eq(salesReturns.status, query.status));
      if (query?.customerId) conds.push(eq(salesReturns.customerId, query.customerId));
      if (query?.invoiceId) conds.push(eq(salesReturns.originalSalesInvoiceId, query.invoiceId));
      if (query?.search) {
        conds.push(or(ilike(salesReturns.returnNumber, `%${query.search}%`), ilike(salesReturns.reason, `%${query.search}%`))!);
      }

      const rows = await db.select().from(salesReturns).where(and(...conds));
      const result: SalesReturnDTO[] = [];
      for (const r of rows) {
        const full = await this.getReturnById(ctx, r.id);
        result.push(full);
      }
      return result;
    }

    return Array.from(this.memoryStore.values()).filter(r => {
      if (r.tenantId !== ctx.tenantId || r.companyId !== companyId) return false;
      if (query?.status && r.status !== query.status) return false;
      if (query?.customerId && r.customerId !== query.customerId) return false;
      if (query?.invoiceId && r.originalSalesInvoiceId !== query.invoiceId) return false;
      if (query?.search) {
        const s = query.search.toLowerCase();
        if (!r.returnNumber.toLowerCase().includes(s) && !r.reason.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }
}

export const salesReturnService = new SalesReturnService();
