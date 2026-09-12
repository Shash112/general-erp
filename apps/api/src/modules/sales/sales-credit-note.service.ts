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
import { notificationEngine } from '../../platform/notifications/notification.service.js';
import { numberingEngine } from '../../platform/numbering/numbering.service.js';
import { salesInvoiceService } from './sales-invoice.service.js';
import { salesReturnService } from './sales-return.service.js';
import { arDocumentService } from '../finance/ar/ar-document.service.js';
import { arAllocationService } from '../finance/ar/ar-allocation.service.js';
import {
  getDb,
  salesCreditNotes,
  salesCreditNoteLines,
  salesInvoices,
  salesInvoiceLines,
  salesReturns,
  eq,
  and,
  or,
  ilike
} from '@general-erp/database';

export interface CreateCreditNoteLineInput {
  originalInvoiceLineId: string;
  salesReturnLineId?: string | null;
  returnedQuantity: string;
  creditAmount?: string | null;
}

export interface CreateCreditNoteInput {
  companyId: string;
  originalSalesInvoiceId: string;
  salesReturnId?: string | null;
  creditNoteDate?: string;
  reason: string;
  notes?: string | null;
  lines?: CreateCreditNoteLineInput[];
}

export interface SalesCreditNoteLineDTO {
  id: string;
  creditNoteId: string;
  salesReturnLineId?: string | null;
  originalInvoiceLineId: string;
  tenantId: string;
  companyId: string;
  lineNumber: number;
  productId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  description?: string | null;
  uom: string;
  returnedQuantity: string;
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
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SalesCreditNoteDTO {
  id: string;
  tenantId: string;
  companyId: string;
  creditNoteNumber: string;
  salesReturnId?: string | null;
  originalSalesInvoiceId: string;
  originalInvoiceNumberSnapshot: string;
  customerId: string;
  creditNoteDate: string;
  billingAddressSnapshot: Record<string, any>;
  shippingAddressSnapshot: Record<string, any>;
  contactSnapshot?: Record<string, any> | null;
  reason: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'POSTED' | 'CANCELLED';
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  taxAmount: string;
  totalAmount: string;
  arDocumentId?: string | null;
  arAllocationId?: string | null;
  journalEntryId?: string | null;
  postedAt?: Date | null;
  postedBy?: string | null;
  notes?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
  cancelledBy?: string | null;
  cancelledAt?: Date | null;
  cancellationReason?: string | null;
  lines: SalesCreditNoteLineDTO[];
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

export class SalesCreditNoteService {
  private memoryStore = new Map<string, SalesCreditNoteDTO>();
  private idempotencyStore = new Map<string, SalesCreditNoteDTO>();
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
   * Creates a Sales Credit Note directly or from an approved Sales Return
   */
  public async createCreditNote(
    ctx: RequestContext,
    input: CreateCreditNoteInput,
    idempotencyKey?: string
  ): Promise<SalesCreditNoteDTO> {
    this.checkPermission(ctx, 'sales:credit-note:create');

    if (idempotencyKey) {
      const cacheKey = `${ctx.tenantId}:${input.companyId}:${idempotencyKey}`;
      const cached = this.idempotencyStore.get(cacheKey);
      if (cached) return cached;
    }

    const userId = ctx.user?.userId || (ctx as any).userId || '00000000-0000-0000-0000-000000000000';
    const db = getDb();
    const creditNoteDateStr = input.creditNoteDate || new Date().toISOString().split('T')[0]!;

    if (!db) {
      // In-Memory Fallback Mode
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
          throw new ValidationError(`Cannot create Credit Note for invoice '${invoice.invoiceNumber}' in status '${invoice.status}'. Invoice must be POSTED.`);
        }

        let salesReturn: any = null;
        if (input.salesReturnId) {
          salesReturn = await salesReturnService.getReturnById(ctx, input.salesReturnId);
          if (salesReturn.status !== 'APPROVED' && salesReturn.status !== 'DRAFT' && salesReturn.status !== 'SUBMITTED') {
            throw new ValidationError(`Sales Return '${salesReturn.returnNumber}' is in status '${salesReturn.status}'. Return must be APPROVED or DRAFT.`);
          }
        }

        const returnables = await salesReturnService.getReturnableQuantities(ctx, invoice.id);
        const returnableMap = new Map(returnables.map(r => [r.originalInvoiceLineId, r]));

        const creditNoteId = crypto.randomUUID();
        const yearStr = new Date().getFullYear().toString();
        numberingEngine.configureSequence(ctx.tenantId, input.companyId, {
          documentType: 'SALES_CREDIT_NOTE',
          prefix: 'CN',
          fiscalYear: yearStr,
          currentSequence: 0,
          paddingDigits: 4,
          resetOnFiscalYear: true
        });
        const creditNoteNumber = numberingEngine.generateNextNumber(ctx.tenantId, input.companyId, 'SALES_CREDIT_NOTE', yearStr);

        const createdLines: SalesCreditNoteLineDTO[] = [];
        let subtotalDec = ExactDecimal.ZERO;
        let discDec = ExactDecimal.ZERO;
        let taxableDec = ExactDecimal.ZERO;
        let cgstDec = ExactDecimal.ZERO;
        let sgstDec = ExactDecimal.ZERO;
        let igstDec = ExactDecimal.ZERO;
        let taxDec = ExactDecimal.ZERO;
        let totalDec = ExactDecimal.ZERO;

        let lineNumCounter = 1;

        if (salesReturn) {
          // Construct Credit Note lines verbatim from Sales Return lines
          for (const retLine of salesReturn.lines) {
            const invLine = invoice.lines.find(l => l.id === retLine.originalInvoiceLineId);
            if (!invLine) continue;

            const retQtyDec = ExactDecimal.parse(retLine.returnQuantity, 4);
            const lineGrossDec = ExactDecimal.parse(retLine.grossAmount, 2);
            const lineDiscDec = ExactDecimal.parse(retLine.discountAmount, 2);
            const lineTaxableDec = ExactDecimal.parse(retLine.taxableAmount, 2);
            const lineCgstDec = ExactDecimal.parse(retLine.cgstAmount, 2);
            const lineSgstDec = ExactDecimal.parse(retLine.sgstAmount, 2);
            const lineIgstDec = ExactDecimal.parse(retLine.igstAmount, 2);
            const lineTaxDec = ExactDecimal.parse(retLine.taxAmount, 2);
            const lineTotalDec = ExactDecimal.parse(retLine.lineTotal, 2);

            subtotalDec = subtotalDec.add(lineGrossDec);
            discDec = discDec.add(lineDiscDec);
            taxableDec = taxableDec.add(lineTaxableDec);
            cgstDec = cgstDec.add(lineCgstDec);
            sgstDec = sgstDec.add(lineSgstDec);
            igstDec = igstDec.add(lineIgstDec);
            taxDec = taxDec.add(lineTaxDec);
            totalDec = totalDec.add(lineTotalDec);

            const lineDto: SalesCreditNoteLineDTO = {
              id: crypto.randomUUID(),
              creditNoteId,
              salesReturnLineId: retLine.id,
              originalInvoiceLineId: invLine.id,
              tenantId: ctx.tenantId,
              companyId: input.companyId,
              lineNumber: lineNumCounter++,
              productId: invLine.productId,
              productCodeSnapshot: invLine.productCodeSnapshot,
              productNameSnapshot: invLine.productNameSnapshot,
              description: invLine.description || null,
              uom: invLine.uom,
              returnedQuantity: retQtyDec.toString(),
              unitPrice: invLine.unitPrice,
              discountPercent: invLine.discountPercent,
              discountAmount: lineDiscDec.toString(),
              grossAmount: lineGrossDec.toString(),
              taxableAmount: lineTaxableDec.toString(),
              hsnSac: invLine.hsnSac,
              cgstRate: invLine.cgstRate,
              cgstAmount: lineCgstDec.toString(),
              sgstRate: invLine.sgstRate,
              sgstAmount: lineSgstDec.toString(),
              igstRate: invLine.igstRate,
              igstAmount: lineIgstDec.toString(),
              taxAmount: lineTaxDec.toString(),
              lineTotal: lineTotalDec.toString(),
              version: 1,
              createdAt: new Date(),
              updatedAt: new Date()
            };
            createdLines.push(lineDto);
          }
        } else {
          // Direct Credit Note creation from specified input lines or full returnable lines
          for (const invLine of invoice.lines) {
            let retQtyStr = '0.0000';
            if (input.lines && input.lines.length > 0) {
              const userLine = input.lines.find(l => l.originalInvoiceLineId === invLine.id);
              if (userLine) {
                retQtyStr = userLine.returnedQuantity;
              } else {
                continue;
              }
            } else {
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

            const userLine = input.lines?.find(l => l.originalInvoiceLineId === invLine.id);
            if (userLine?.creditAmount) {
              const requestedCreditDec = ExactDecimal.parse(userLine.creditAmount, 2);
              const maxCreditableDec = ExactDecimal.parse(invLine.lineTotal, 2);
              if (isGt(requestedCreditDec, maxCreditableDec)) {
                throw new BusinessRuleViolationError(
                  `RETURN_VALUE_EXCEEDED: Requested credit amount (${requestedCreditDec.toString()}) for line '${invLine.productCodeSnapshot}' exceeds maximum allowable line total (${maxCreditableDec.toString()}).`
                );
              }
            }

            const unitPriceDec = ExactDecimal.parse(invLine.unitPrice, 4);
            const discPercentDec = ExactDecimal.parse(invLine.discountPercent || '0.00', 2);
            const grossDec = mulDec(retQtyDec, unitPriceDec, 2);
            const lineDiscDec = calcDiscDec(grossDec, discPercentDec);
            const lineTaxableDec = grossDec.sub(lineDiscDec);

            const origInvoicedQtyDec = ExactDecimal.parse(invLine.invoicedQuantity, 4);
            const origCgstDec = ExactDecimal.parse(invLine.cgstAmount, 2);
            const origSgstDec = ExactDecimal.parse(invLine.sgstAmount, 2);
            const origIgstDec = ExactDecimal.parse(invLine.igstAmount, 2);

            const lineCgstDec = proRataTax(origCgstDec, retQtyDec, origInvoicedQtyDec);
            const lineSgstDec = proRataTax(origSgstDec, retQtyDec, origInvoicedQtyDec);
            const lineIgstDec = proRataTax(origIgstDec, retQtyDec, origInvoicedQtyDec);

            const lineTaxDec = lineCgstDec.add(lineSgstDec).add(lineIgstDec);
            const lineTotalDec = lineTaxableDec.add(lineTaxDec);

            subtotalDec = subtotalDec.add(grossDec);
            discDec = discDec.add(lineDiscDec);
            taxableDec = taxableDec.add(lineTaxableDec);
            cgstDec = cgstDec.add(lineCgstDec);
            sgstDec = sgstDec.add(lineSgstDec);
            igstDec = igstDec.add(lineIgstDec);
            taxDec = taxDec.add(lineTaxDec);
            totalDec = totalDec.add(lineTotalDec);

            const lineDto: SalesCreditNoteLineDTO = {
              id: crypto.randomUUID(),
              creditNoteId,
              originalInvoiceLineId: invLine.id,
              tenantId: ctx.tenantId,
              companyId: input.companyId,
              lineNumber: lineNumCounter++,
              productId: invLine.productId,
              productCodeSnapshot: invLine.productCodeSnapshot,
              productNameSnapshot: invLine.productNameSnapshot,
              description: invLine.description || null,
              uom: invLine.uom,
              returnedQuantity: retQtyDec.toString(),
              unitPrice: invLine.unitPrice,
              discountPercent: invLine.discountPercent,
              discountAmount: lineDiscDec.toString(),
              grossAmount: grossDec.toString(),
              taxableAmount: lineTaxableDec.toString(),
              hsnSac: invLine.hsnSac,
              cgstRate: invLine.cgstRate,
              cgstAmount: lineCgstDec.toString(),
              sgstRate: invLine.sgstRate,
              sgstAmount: lineSgstDec.toString(),
              igstRate: invLine.igstRate,
              igstAmount: lineIgstDec.toString(),
              taxAmount: lineTaxDec.toString(),
              lineTotal: lineTotalDec.toString(),
              version: 1,
              createdAt: new Date(),
              updatedAt: new Date()
            };
            createdLines.push(lineDto);
          }
        }

        if (createdLines.length === 0) {
          throw new ValidationError('Sales Credit Note must contain at least one line item with a positive returned quantity.');
        }

        const creditNoteDto: SalesCreditNoteDTO = {
          id: creditNoteId,
          tenantId: ctx.tenantId,
          companyId: input.companyId,
          creditNoteNumber,
          salesReturnId: input.salesReturnId || null,
          originalSalesInvoiceId: invoice.id,
          originalInvoiceNumberSnapshot: invoice.invoiceNumber,
          customerId: invoice.customerId,
          creditNoteDate: creditNoteDateStr,
          billingAddressSnapshot: invoice.billingAddressSnapshot,
          shippingAddressSnapshot: invoice.shippingAddressSnapshot,
          contactSnapshot: invoice.contactSnapshot || null,
          reason: input.reason || (salesReturn ? salesReturn.reason : 'Sales Return Adjustment'),
          status: 'DRAFT',
          subtotalAmount: subtotalDec.toString(),
          discountAmount: discDec.toString(),
          taxableAmount: taxableDec.toString(),
          cgstAmount: cgstDec.toString(),
          sgstAmount: sgstDec.toString(),
          igstAmount: igstDec.toString(),
          taxAmount: taxDec.toString(),
          totalAmount: totalDec.toString(),
          notes: input.notes || null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: userId,
          updatedBy: userId,
          lines: createdLines
        };

        this.memoryStore.set(`${ctx.tenantId}:${input.companyId}:${creditNoteId}`, creditNoteDto);
        if (idempotencyKey) {
          this.idempotencyStore.set(`${ctx.tenantId}:${input.companyId}:${idempotencyKey}`, creditNoteDto);
        }

        await auditService.logEvent(ctx, {
          module: 'sales',
          entityName: 'SalesCreditNote',
          entityId: creditNoteId,
          action: 'CREATE',
          newValues: { creditNoteNumber, originalInvoiceId: invoice.id, totalAmount: creditNoteDto.totalAmount, status: 'DRAFT' }
        });

        logger.info({ tenantId: ctx.tenantId, companyId: input.companyId, creditNoteId, creditNoteNumber }, '[SalesCreditNote] Created DRAFT sales credit note');
        return creditNoteDto;
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
          throw new ValidationError(`Cannot create Credit Note for invoice '${invoiceRow.invoiceNumber}' in status '${invoiceRow.status}'. Invoice must be POSTED.`);
        }

        const dbInvoiceLines = await tx
          .select()
          .from(salesInvoiceLines)
          .where(eq(salesInvoiceLines.invoiceId, invoiceRow.id))
          .for('update');

        const creditNoteId = crypto.randomUUID();
        const yearStr = new Date().getFullYear().toString();
        numberingEngine.configureSequence(ctx.tenantId, input.companyId, {
          documentType: 'SALES_CREDIT_NOTE',
          prefix: 'CN',
          fiscalYear: yearStr,
          currentSequence: 0,
          paddingDigits: 4,
          resetOnFiscalYear: true
        });
        const creditNoteNumber = numberingEngine.generateNextNumber(ctx.tenantId, input.companyId, 'SALES_CREDIT_NOTE', yearStr);

        const createdLines: SalesCreditNoteLineDTO[] = [];
        let subtotalDec = ExactDecimal.ZERO;
        let discDec = ExactDecimal.ZERO;
        let taxableDec = ExactDecimal.ZERO;
        let cgstDec = ExactDecimal.ZERO;
        let sgstDec = ExactDecimal.ZERO;
        let igstDec = ExactDecimal.ZERO;
        let taxDec = ExactDecimal.ZERO;
        let totalDec = ExactDecimal.ZERO;

        let lineNumCounter = 1;

        for (const invLine of dbInvoiceLines) {
          let retQtyStr = '0.0000';
          if (input.lines && input.lines.length > 0) {
            const userLine = input.lines.find(l => l.originalInvoiceLineId === invLine.id);
            if (userLine) {
              retQtyStr = userLine.returnedQuantity;
            } else {
              continue;
            }
          }

          const retQtyDec = ExactDecimal.parse(retQtyStr, 4);
          if (retQtyDec.isZero() || retQtyDec.isNegative()) continue;

          const userLine = input.lines?.find(l => l.originalInvoiceLineId === invLine.id);
          if (userLine?.creditAmount) {
            const requestedCreditDec = ExactDecimal.parse(userLine.creditAmount, 2);
            const maxCreditableDec = ExactDecimal.parse(invLine.lineTotal, 2);
            if (isGt(requestedCreditDec, maxCreditableDec)) {
              throw new BusinessRuleViolationError(
                `RETURN_VALUE_EXCEEDED: Requested credit amount (${requestedCreditDec.toString()}) for line '${invLine.productCodeSnapshot}' exceeds maximum allowable line total (${maxCreditableDec.toString()}).`
              );
            }
          }

          const unitPriceDec = ExactDecimal.parse(invLine.unitPrice, 4);
          const discPercentDec = ExactDecimal.parse(invLine.discountPercent || '0.00', 2);
          const grossDec = mulDec(retQtyDec, unitPriceDec, 2);
          const lineDiscDec = calcDiscDec(grossDec, discPercentDec);
          const lineTaxableDec = grossDec.sub(lineDiscDec);

          const origInvoicedQtyDec = ExactDecimal.parse(invLine.invoicedQuantity, 4);
          const origCgstDec = ExactDecimal.parse(invLine.cgstAmount, 2);
          const origSgstDec = ExactDecimal.parse(invLine.sgstAmount, 2);
          const origIgstDec = ExactDecimal.parse(invLine.igstAmount, 2);

          const lineCgstDec = proRataTax(origCgstDec, retQtyDec, origInvoicedQtyDec);
          const lineSgstDec = proRataTax(origSgstDec, retQtyDec, origInvoicedQtyDec);
          const lineIgstDec = proRataTax(origIgstDec, retQtyDec, origInvoicedQtyDec);

          const lineTaxDec = lineCgstDec.add(lineSgstDec).add(lineIgstDec);
          const lineTotalDec = lineTaxableDec.add(lineTaxDec);

          subtotalDec = subtotalDec.add(grossDec);
          discDec = discDec.add(lineDiscDec);
          taxableDec = taxableDec.add(lineTaxableDec);
          cgstDec = cgstDec.add(lineCgstDec);
          sgstDec = sgstDec.add(lineSgstDec);
          igstDec = igstDec.add(lineIgstDec);
          taxDec = taxDec.add(lineTaxDec);
          totalDec = totalDec.add(lineTotalDec);

          const lineDto: SalesCreditNoteLineDTO = {
            id: crypto.randomUUID(),
            creditNoteId,
            originalInvoiceLineId: invLine.id,
            tenantId: ctx.tenantId,
            companyId: input.companyId,
            lineNumber: lineNumCounter++,
            productId: invLine.productId,
            productCodeSnapshot: invLine.productCodeSnapshot,
            productNameSnapshot: invLine.productNameSnapshot,
            description: invLine.description || null,
            uom: invLine.uom,
            returnedQuantity: retQtyDec.toString(),
            unitPrice: invLine.unitPrice,
            discountPercent: invLine.discountPercent,
            discountAmount: lineDiscDec.toString(),
            grossAmount: grossDec.toString(),
            taxableAmount: lineTaxableDec.toString(),
            hsnSac: invLine.hsnSac,
            cgstRate: invLine.cgstRate,
            cgstAmount: lineCgstDec.toString(),
            sgstRate: invLine.sgstRate,
            sgstAmount: lineSgstDec.toString(),
            igstRate: invLine.igstRate,
            igstAmount: lineIgstDec.toString(),
            taxAmount: lineTaxDec.toString(),
            lineTotal: lineTotalDec.toString(),
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date()
          };
          createdLines.push(lineDto);
        }

        if (createdLines.length === 0) {
          throw new ValidationError('Sales Credit Note must contain at least one line item with a positive returned quantity.');
        }

        await tx.insert(salesCreditNotes).values({
          id: creditNoteId,
          tenantId: ctx.tenantId,
          companyId: input.companyId,
          creditNoteNumber,
          salesReturnId: input.salesReturnId || null,
          originalSalesInvoiceId: invoiceRow.id,
          originalInvoiceNumberSnapshot: invoiceRow.invoiceNumber,
          customerId: invoiceRow.customerId,
          creditNoteDate: creditNoteDateStr,
          billingAddressSnapshot: invoiceRow.billingAddressSnapshot,
          shippingAddressSnapshot: invoiceRow.shippingAddressSnapshot,
          contactSnapshot: invoiceRow.contactSnapshot || null,
          reason: input.reason,
          status: 'DRAFT',
          subtotalAmount: subtotalDec.toString(),
          discountAmount: discDec.toString(),
          taxableAmount: taxableDec.toString(),
          cgstAmount: cgstDec.toString(),
          sgstAmount: sgstDec.toString(),
          igstAmount: igstDec.toString(),
          taxAmount: taxDec.toString(),
          totalAmount: totalDec.toString(),
          notes: input.notes || null,
          version: 1,
          createdBy: userId,
          updatedBy: userId
        } as any);

        for (const l of createdLines) {
          await tx.insert(salesCreditNoteLines).values({
            id: l.id,
            creditNoteId: l.creditNoteId,
            salesReturnLineId: l.salesReturnLineId || null,
            originalInvoiceLineId: l.originalInvoiceLineId,
            tenantId: l.tenantId,
            companyId: l.companyId,
            lineNumber: l.lineNumber,
            productId: l.productId,
            productCodeSnapshot: l.productCodeSnapshot,
            productNameSnapshot: l.productNameSnapshot,
            description: l.description,
            uom: l.uom,
            returnedQuantity: l.returnedQuantity,
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
            lineTotal: l.lineTotal
          } as any);
        }

        const creditNoteDto: SalesCreditNoteDTO = {
          id: creditNoteId,
          tenantId: ctx.tenantId,
          companyId: input.companyId,
          creditNoteNumber,
          salesReturnId: input.salesReturnId || null,
          originalSalesInvoiceId: invoiceRow.id,
          originalInvoiceNumberSnapshot: invoiceRow.invoiceNumber,
          customerId: invoiceRow.customerId,
          creditNoteDate: creditNoteDateStr,
          billingAddressSnapshot: invoiceRow.billingAddressSnapshot as any,
          shippingAddressSnapshot: invoiceRow.shippingAddressSnapshot as any,
          contactSnapshot: invoiceRow.contactSnapshot as any,
          reason: input.reason,
          status: 'DRAFT',
          subtotalAmount: subtotalDec.toString(),
          discountAmount: discDec.toString(),
          taxableAmount: taxableDec.toString(),
          cgstAmount: cgstDec.toString(),
          sgstAmount: sgstDec.toString(),
          igstAmount: igstDec.toString(),
          taxAmount: taxDec.toString(),
          totalAmount: totalDec.toString(),
          notes: input.notes || null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: userId,
          updatedBy: userId,
          lines: createdLines
        };

        this.memoryStore.set(`${ctx.tenantId}:${input.companyId}:${creditNoteId}`, creditNoteDto);

        await auditService.logEvent(ctx, {
          module: 'sales',
          entityName: 'SalesCreditNote',
          entityId: creditNoteId,
          action: 'CREATE',
          newValues: { creditNoteNumber, originalInvoiceId: invoiceRow.id, totalAmount: creditNoteDto.totalAmount, status: 'DRAFT' }
        });

        return creditNoteDto;
      });
    }
  }

  /**
   * Posts a Sales Credit Note, generating AR Credit Document, allocating against AR Open Item, and posting GL entries
   */
  public async postCreditNote(ctx: RequestContext, creditNoteId: string): Promise<SalesCreditNoteDTO> {
    this.checkPermission(ctx, 'sales:credit-note:post');

    const cn = await this.getCreditNoteById(ctx, creditNoteId);
    if (cn.status === 'POSTED') {
      logger.info({ tenantId: ctx.tenantId, creditNoteId }, '[SalesCreditNote] Credit Note is already POSTED — returning idempotent result');
      return cn;
    }

    if (cn.status === 'CANCELLED') {
      throw new BusinessRuleViolationError(`Cannot post Sales Credit Note '${cn.creditNoteNumber}'. Status is CANCELLED.`);
    }

    const userId = ctx.user?.userId || (ctx as any).userId || '00000000-0000-0000-0000-000000000000';
    const db = getDb();

    const formatMoney = (val: string | null | undefined) => {
      if (!val || typeof val !== 'string' || val.trim() === '') return '0.00';
      const dec = ExactDecimal.parse(val, 4);
      return ExactDecimal.halfEvenRound(dec.rawBigInt, 4, 2).toString();
    };

    // 1. Create Draft AR Credit Document
    const arDocInput = {
      companyId: cn.companyId,
      customerId: cn.customerId,
      documentType: 'CREDIT_NOTE' as const,
      documentDate: cn.creditNoteDate,
      accountingDate: cn.creditNoteDate,
      dueDate: cn.creditNoteDate,
      currency: 'INR',
      exchangeRate: '1.000000',
      sourceModule: 'SALES_CREDIT_NOTE',
      sourceDocumentId: cn.id,
      taxableAmount: formatMoney(cn.taxableAmount),
      taxAmount: formatMoney(cn.taxAmount),
      grossAmount: formatMoney(cn.totalAmount),
      lines: cn.lines.map((l, idx) => ({
        lineSequence: idx + 1,
        productId: l.productId,
        description: `Credit Note Reversal: ${l.productNameSnapshot}`,
        hsnSac: l.hsnSac,
        quantity: l.returnedQuantity,
        unitPrice: formatMoney(l.unitPrice),
        taxableAmount: formatMoney(l.taxableAmount),
        cgstAmount: formatMoney(l.cgstAmount),
        sgstAmount: formatMoney(l.sgstAmount),
        igstAmount: formatMoney(l.igstAmount),
        taxAmount: formatMoney(l.taxAmount),
        grossAmount: formatMoney(l.lineTotal)
      }))
    };

    const draftArDoc = await arDocumentService.createDraft(ctx, arDocInput);

    // 2. Post AR Credit Document (generates GL Journal Entry via AccountingCore)
    const postedArDoc = await arDocumentService.postDocument(ctx, draftArDoc.id);

    // 3. Find target AR Open Item for the original Sales Invoice
    const invoice = await salesInvoiceService.getInvoiceById(ctx, cn.originalSalesInvoiceId);
    let targetOpenItemId = invoice.arOpenItemId;

    if (!targetOpenItemId) {
      const openItems = await arDocumentService.getOpenItems(ctx, cn.companyId, { customerId: cn.customerId });
      const matchingOpenItem = openItems.find(item => item.arDocumentId === invoice.arDocumentId || item.documentNumber === invoice.invoiceNumber);
      if (matchingOpenItem) {
        targetOpenItemId = matchingOpenItem.id;
      }
    }

    let allocationId: string | null = null;
    if (targetOpenItemId) {
      // Allocate AR Credit Document against Original Invoice Open Item
      const alloc = await arAllocationService.allocate(ctx, {
        allocationSourceType: 'CREDIT_NOTE',
        creditNoteId: postedArDoc.id,
        openItemId: targetOpenItemId,
        allocatedAmount: formatMoney(cn.totalAmount),
        discountAmount: '0.00',
        allocationDate: cn.creditNoteDate
      });
      allocationId = alloc.id;
    }

    // 4. Update Sales Credit Note state to POSTED
    cn.status = 'POSTED';
    cn.arDocumentId = postedArDoc.id;
    cn.arAllocationId = allocationId;
    cn.journalEntryId = postedArDoc.journalEntryId || null;
    cn.postedAt = new Date();
    cn.postedBy = userId;
    cn.updatedAt = new Date();

    if (!db) {
      this.memoryStore.set(`${ctx.tenantId}:${cn.companyId}:${creditNoteId}`, cn);

      if (cn.salesReturnId) {
        const ret = await salesReturnService.getReturnById(ctx, cn.salesReturnId);
        ret.status = 'CREDIT_NOTE_CREATED';
      }
    } else {
      await db.transaction(async (tx) => {
        await tx
          .update(salesCreditNotes)
          .set({
            status: 'POSTED',
            arDocumentId: cn.arDocumentId || null,
            arAllocationId: cn.arAllocationId || null,
            journalEntryId: cn.journalEntryId || null,
            postedAt: cn.postedAt || null,
            postedBy: cn.postedBy || null,
            updatedAt: new Date()
          })
          .where(eq(salesCreditNotes.id, creditNoteId));

        if (cn.salesReturnId) {
          await tx
            .update(salesReturns)
            .set({ status: 'CREDIT_NOTE_CREATED', updatedAt: new Date() })
            .where(eq(salesReturns.id, cn.salesReturnId));
        }
      });
    }

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesCreditNote',
      entityId: creditNoteId,
      action: 'POST',
      newValues: {
        status: 'POSTED',
        creditNoteNumber: cn.creditNoteNumber,
        arDocumentId: cn.arDocumentId,
        journalEntryId: cn.journalEntryId
      }
    });

    await notificationEngine.sendNotification(ctx, {
      channels: ['IN_APP'],
      recipientId: userId,
      title: `Sales Credit Note Posted: ${cn.creditNoteNumber}`,
      body: `Sales Credit Note ${cn.creditNoteNumber} for amount ₹${cn.totalAmount} has been posted. AR Credit and GL reversal posted.`,
      data: { creditNoteId: cn.id, creditNoteNumber: cn.creditNoteNumber }
    });

    logger.info({ tenantId: ctx.tenantId, companyId: cn.companyId, creditNoteId, creditNoteNumber: cn.creditNoteNumber }, '[SalesCreditNote] POSTED sales credit note successfully');
    return cn;
  }

  /**
   * Cancel a DRAFT Sales Credit Note
   */
  public async cancelCreditNote(ctx: RequestContext, creditNoteId: string, reason: string): Promise<SalesCreditNoteDTO> {
    this.checkPermission(ctx, 'sales:credit-note:cancel');
    if (!reason || reason.trim() === '') {
      throw new ValidationError('Cancellation reason is required when cancelling a Sales Credit Note.');
    }

    const cn = await this.getCreditNoteById(ctx, creditNoteId);
    if (cn.status === 'POSTED') {
      throw new BusinessRuleViolationError('Cannot cancel a POSTED Sales Credit Note. Posted financial records are immutable.');
    }
    if (cn.status === 'CANCELLED') return cn;

    const userId = ctx.user?.userId || (ctx as any).userId || '00000000-0000-0000-0000-000000000000';
    cn.status = 'CANCELLED';
    cn.cancelledBy = userId;
    cn.cancelledAt = new Date();
    cn.cancellationReason = reason;
    cn.updatedAt = new Date();

    const db = getDb();
    if (db) {
      await db
        .update(salesCreditNotes)
        .set({
          status: 'CANCELLED',
          cancelledBy: userId,
          cancelledAt: new Date(),
          cancellationReason: reason,
          updatedAt: new Date()
        })
        .where(eq(salesCreditNotes.id, creditNoteId));
    }
    this.memoryStore.set(`${ctx.tenantId}:${cn.companyId}:${creditNoteId}`, cn);

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesCreditNote',
      entityId: creditNoteId,
      action: 'CANCEL',
      newValues: { status: 'CANCELLED', cancellationReason: reason }
    });

    return cn;
  }

  /**
   * Get Sales Credit Note by ID
   */
  public async getCreditNoteById(ctx: RequestContext, id: string): Promise<SalesCreditNoteDTO> {
    this.checkPermission(ctx, 'sales:credit-note:read');
    const cached = this.memoryStore.get(`${ctx.tenantId}:${ctx.companyId}:${id}`);
    if (cached) return cached;

    const db = getDb();
    if (db) {
      const [cn] = await db
        .select()
        .from(salesCreditNotes)
        .where(and(eq(salesCreditNotes.id, id), eq(salesCreditNotes.tenantId, ctx.tenantId), eq(salesCreditNotes.companyId, ctx.companyId)));

      if (!cn) {
        throw new NotFoundError(`Sales Credit Note with ID '${id}' not found.`);
      }

      const lineRows = await db
        .select()
        .from(salesCreditNoteLines)
        .where(eq(salesCreditNoteLines.creditNoteId, id));

      const dto: SalesCreditNoteDTO = {
        id: cn.id,
        tenantId: cn.tenantId,
        companyId: cn.companyId,
        creditNoteNumber: cn.creditNoteNumber,
        salesReturnId: cn.salesReturnId || null,
        originalSalesInvoiceId: cn.originalSalesInvoiceId,
        originalInvoiceNumberSnapshot: cn.originalInvoiceNumberSnapshot,
        customerId: cn.customerId,
        creditNoteDate: cn.creditNoteDate,
        billingAddressSnapshot: cn.billingAddressSnapshot as any,
        shippingAddressSnapshot: cn.shippingAddressSnapshot as any,
        contactSnapshot: cn.contactSnapshot as any,
        reason: cn.reason,
        status: cn.status as any,
        subtotalAmount: cn.subtotalAmount,
        discountAmount: cn.discountAmount,
        taxableAmount: cn.taxableAmount,
        cgstAmount: cn.cgstAmount,
        sgstAmount: cn.sgstAmount,
        igstAmount: cn.igstAmount,
        taxAmount: cn.taxAmount,
        totalAmount: cn.totalAmount,
        arDocumentId: cn.arDocumentId || null,
        arAllocationId: cn.arAllocationId || null,
        journalEntryId: cn.journalEntryId || null,
        postedAt: cn.postedAt || null,
        postedBy: cn.postedBy || null,
        notes: cn.notes || null,
        version: cn.version,
        createdAt: cn.createdAt,
        updatedAt: cn.updatedAt,
        createdBy: cn.createdBy,
        updatedBy: cn.updatedBy,
        cancelledBy: cn.cancelledBy || null,
        cancelledAt: cn.cancelledAt || null,
        cancellationReason: cn.cancellationReason || null,
        lines: lineRows.map((l: any) => ({
          id: l.id,
          creditNoteId: l.creditNoteId,
          salesReturnLineId: l.salesReturnLineId || null,
          originalInvoiceLineId: l.originalInvoiceLineId,
          tenantId: l.tenantId,
          companyId: l.companyId,
          lineNumber: l.lineNumber,
          productId: l.productId,
          productCodeSnapshot: l.productCodeSnapshot,
          productNameSnapshot: l.productNameSnapshot,
          description: l.description || null,
          uom: l.uom,
          returnedQuantity: l.returnedQuantity,
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
          version: l.version,
          createdAt: l.createdAt,
          updatedAt: l.updatedAt
        }))
      };

      this.memoryStore.set(`${ctx.tenantId}:${ctx.companyId}:${id}`, dto);
      return dto;
    }

    throw new NotFoundError(`Sales Credit Note with ID '${id}' not found.`);
  }

  /**
   * List Sales Credit Notes for a company
   */
  public async listCreditNotes(
    ctx: RequestContext,
    companyId: string,
    query?: { status?: string; search?: string; customerId?: string; invoiceId?: string; returnId?: string }
  ): Promise<SalesCreditNoteDTO[]> {
    this.checkPermission(ctx, 'sales:credit-note:read');
    if (companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match query companyId.');
    }

    const db = getDb();
    if (db) {
      let conds = [eq(salesCreditNotes.tenantId, ctx.tenantId), eq(salesCreditNotes.companyId, companyId)];
      if (query?.status) conds.push(eq(salesCreditNotes.status, query.status));
      if (query?.customerId) conds.push(eq(salesCreditNotes.customerId, query.customerId));
      if (query?.invoiceId) conds.push(eq(salesCreditNotes.originalSalesInvoiceId, query.invoiceId));
      if (query?.returnId) conds.push(eq(salesCreditNotes.salesReturnId, query.returnId));
      if (query?.search) {
        conds.push(or(ilike(salesCreditNotes.creditNoteNumber, `%${query.search}%`), ilike(salesCreditNotes.reason, `%${query.search}%`))!);
      }

      const rows = await db.select().from(salesCreditNotes).where(and(...conds));
      const result: SalesCreditNoteDTO[] = [];
      for (const r of rows) {
        const full = await this.getCreditNoteById(ctx, r.id);
        result.push(full);
      }
      return result;
    }

    return Array.from(this.memoryStore.values()).filter(cn => {
      if (cn.tenantId !== ctx.tenantId || cn.companyId !== companyId) return false;
      if (query?.status && cn.status !== query.status) return false;
      if (query?.customerId && cn.customerId !== query.customerId) return false;
      if (query?.invoiceId && cn.originalSalesInvoiceId !== query.invoiceId) return false;
      if (query?.returnId && cn.salesReturnId !== query.returnId) return false;
      if (query?.search) {
        const s = query.search.toLowerCase();
        if (!cn.creditNoteNumber.toLowerCase().includes(s) && !cn.reason.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }
}

export const salesCreditNoteService = new SalesCreditNoteService();
