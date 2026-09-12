import crypto from 'crypto';
import {
  RequestContext,
  ValidationError,
  ForbiddenError,
  NotFoundError,
  BusinessRuleViolationError
} from '@general-erp/core';
import { auditService } from '../../platform/audit/audit.service.js';
import { numberingEngine } from '../../platform/numbering/numbering.service.js';
import { notificationEngine } from '../../platform/notifications/notification.service.js';
import { salesOrderService } from './sales-order.service.js';
import { salesDeliveryService } from './sales-delivery.service.js';
import { arDocumentService } from '../finance/ar/ar-document.service.js';
import {
  getDb,
  salesInvoices,
  salesInvoiceLines,
  salesOrders,
  salesOrderLines,
  salesDeliveries,
  eq,
  and,
  ilike,
  or,
  sql
} from '@general-erp/database';

export interface SalesInvoiceLineDTO {
  id: string;
  invoiceId: string;
  salesOrderLineId: string | null;
  salesDeliveryLineId: string | null;
  tenantId: string;
  companyId: string;
  lineNumber: number;
  productId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  description: string | null;
  uom: string;
  invoicedQuantity: string;
  unitPrice: string;
  discountPercent: string;
  discountAmount: string;
  allocatedHeaderDiscountAmount: string;
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

export interface SalesInvoiceDTO {
  id: string;
  tenantId: string;
  companyId: string;
  branchId: string | null;
  invoiceNumber: string;
  salesOrderId: string | null;
  salesOrderNumber: string | null;
  salesDeliveryId: string | null;
  salesDeliveryNumber: string | null;
  customerId: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  exchangeRate: string;
  billingAddressId: string;
  billingAddressSnapshot: Record<string, any>;
  shippingAddressId: string;
  shippingAddressSnapshot: Record<string, any>;
  contactId: string | null;
  contactSnapshot: Record<string, any> | null;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'POSTED' | 'PARTIALLY_SETTLED' | 'SETTLED' | 'CANCELLED' | 'REVERSED';
  notes: string | null;
  termsAndConditions: string | null;
  subtotalAmount: string;
  headerDiscountAmount: string;
  discountAmount: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  taxAmount: string;
  totalAmount: string;
  totalAmountBase: string;
  arDocumentId: string | null;
  arOpenItemId: string | null;
  journalEntryId: string | null;
  postedAt: Date | null;
  postedBy: string | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
  lines: SalesInvoiceLineDTO[];
}

export interface CreateInvoiceFromOrderInput {
  companyId: string;
  salesOrderId: string;
  salesDeliveryId?: string | undefined;
  invoiceDate?: string | undefined;
  dueDate?: string | undefined;
  lines?: Array<{
    salesOrderLineId: string;
    invoicedQuantity: string;
  }> | undefined;
}

export interface ListSalesInvoicesParams {
  companyId: string;
  status?: string | undefined;
  customerId?: string | undefined;
  salesOrderId?: string | undefined;
  search?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

export class SalesInvoiceService {
  private memoryStore = new Map<string, SalesInvoiceDTO>();
  private idempotencyStore = new Map<string, SalesInvoiceDTO>();

  public clearMemoryStores(): void {
    this.memoryStore.clear();
    this.idempotencyStore.clear();
  }

  private checkPermission(ctx: RequestContext, perm: string): void {
    const permissions = ctx.user?.permissions || (ctx as any).permissions || [];
    const roles = ctx.user?.roles || (ctx as any).roles || [];
    if (!permissions.includes(perm) && !roles.includes('admin') && !permissions.includes('*')) {
      throw new ForbiddenError(`Missing required permission '${perm}'`);
    }
  }

  /**
   * Creates a Sales Invoice from a confirmed Sales Order and/or Sales Delivery.
   */
  public async createFromOrder(
    ctx: RequestContext,
    input: CreateInvoiceFromOrderInput,
    idempotencyKey?: string
  ): Promise<SalesInvoiceDTO> {
    this.checkPermission(ctx, 'sales:invoice:create');

    if (idempotencyKey) {
      const cacheKey = `${ctx.tenantId}:${input.companyId}:${idempotencyKey}`;
      const cached = this.idempotencyStore.get(cacheKey);
      if (cached) return cached;
    }

    const userId = ctx.user?.userId || (ctx as any).userId || '00000000-0000-0000-0000-000000000000';
    const db = getDb();
    const invoiceDateStr = input.invoiceDate || new Date().toISOString().split('T')[0]!;
    const dueDateObj = new Date();
    dueDateObj.setDate(dueDateObj.getDate() + 30);
    const dueDateStr = input.dueDate || dueDateObj.toISOString().split('T')[0]!;

    if (!db) {
      const order = await salesOrderService.getOrderById(ctx, input.salesOrderId);
      if (order.status !== 'CONFIRMED' && order.status !== 'COMPLETED') {
        throw new ValidationError(`Cannot create Sales Invoice for order in status '${order.status}'. Order must be CONFIRMED.`);
      }

      let deliveryNum: string | null = null;
      if (input.salesDeliveryId) {
        const del = await salesDeliveryService.getDeliveryById(ctx, input.salesDeliveryId);
        deliveryNum = del.deliveryNumber;
      }

      const invoiceId = crypto.randomUUID();
      const yearStr = new Date().getFullYear().toString();
      numberingEngine.configureSequence(ctx.tenantId, input.companyId, {
        documentType: 'SALES_INVOICE',
        prefix: 'INV',
        fiscalYear: yearStr,
        currentSequence: 0,
        paddingDigits: 4,
        resetOnFiscalYear: true
      });
      const invoiceNumber = numberingEngine.generateNextNumber(ctx.tenantId, input.companyId, 'SALES_INVOICE', yearStr);

      const createdLines: SalesInvoiceLineDTO[] = [];
      let subtotal = 0;
      let totalTaxable = 0;
      let totalCgst = 0;
      let totalSgst = 0;
      let totalIgst = 0;
      let totalTax = 0;
      let totalGross = 0;

      let lineNumCounter = 1;
      for (const orderLine of order.lines) {
        let invQty = parseFloat(orderLine.orderedQuantity);
        if (input.lines && input.lines.length > 0) {
          const userLine = input.lines.find(l => l.salesOrderLineId === orderLine.id);
          if (userLine) {
            invQty = parseFloat(userLine.invoicedQuantity);
          } else {
            continue;
          }
        }

        if (invQty <= 0) continue;

        const prevInvoiced = parseFloat(orderLine.invoicedQuantity || '0');
        const maxInvoicable = parseFloat(orderLine.orderedQuantity) - parseFloat(orderLine.cancelledQuantity || '0') - prevInvoiced;
        if (invQty > maxInvoicable + 0.0001) {
          throw new ValidationError(
            `OVER_INVOICING_EXCEEDED: Invoiced quantity (${invQty}) for product '${orderLine.productCodeSnapshot}' exceeds remaining deliverable quantity (${maxInvoicable.toFixed(4)}).`
          );
        }

        const unitPriceNum = parseFloat(orderLine.unitPrice);
        const lineGrossNum = invQty * unitPriceNum;
        const discPercent = parseFloat(orderLine.discountPercent || '0');
        const lineDiscNum = (lineGrossNum * discPercent) / 100.0;
        const lineTaxableNum = lineGrossNum - lineDiscNum;

        const cgstRate = parseFloat(orderLine.cgstRate || '0');
        const sgstRate = parseFloat(orderLine.sgstRate || '0');
        const igstRate = parseFloat(orderLine.igstRate || '0');

        const lineCgstNum = (lineTaxableNum * cgstRate) / 100.0;
        const lineSgstNum = (lineTaxableNum * sgstRate) / 100.0;
        const lineIgstNum = (lineTaxableNum * igstRate) / 100.0;
        const lineTaxNum = lineCgstNum + lineSgstNum + lineIgstNum;
        const lineTotalNum = lineTaxableNum + lineTaxNum;

        subtotal += lineGrossNum;
        totalTaxable += lineTaxableNum;
        totalCgst += lineCgstNum;
        totalSgst += lineSgstNum;
        totalIgst += lineIgstNum;
        totalTax += lineTaxNum;
        totalGross += lineTotalNum;

        const lineDto: SalesInvoiceLineDTO = {
          id: crypto.randomUUID(),
          invoiceId,
          salesOrderLineId: orderLine.id,
          salesDeliveryLineId: null,
          tenantId: ctx.tenantId,
          companyId: input.companyId,
          lineNumber: lineNumCounter++,
          productId: orderLine.productId,
          productCodeSnapshot: orderLine.productCodeSnapshot,
          productNameSnapshot: orderLine.productNameSnapshot,
          description: orderLine.description || null,
          uom: orderLine.uom,
          invoicedQuantity: invQty.toFixed(4),
          unitPrice: orderLine.unitPrice,
          discountPercent: orderLine.discountPercent,
          discountAmount: lineDiscNum.toFixed(2),
          allocatedHeaderDiscountAmount: '0.00',
          grossAmount: lineGrossNum.toFixed(2),
          taxableAmount: lineTaxableNum.toFixed(2),
          hsnSac: orderLine.hsnSac,
          cgstRate: orderLine.cgstRate,
          cgstAmount: lineCgstNum.toFixed(2),
          sgstRate: orderLine.sgstRate,
          sgstAmount: lineSgstNum.toFixed(2),
          igstRate: orderLine.igstRate,
          igstAmount: lineIgstNum.toFixed(2),
          taxAmount: lineTaxNum.toFixed(2),
          lineTotal: lineTotalNum.toFixed(2),
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        createdLines.push(lineDto);

        orderLine.invoicedQuantity = (prevInvoiced + invQty).toFixed(4);
      }

      const invoiceDto: SalesInvoiceDTO = {
        id: invoiceId,
        tenantId: ctx.tenantId,
        companyId: input.companyId,
        branchId: null,
        invoiceNumber,
        salesOrderId: order.id,
        salesOrderNumber: order.orderNumber,
        salesDeliveryId: input.salesDeliveryId || null,
        salesDeliveryNumber: deliveryNum,
        customerId: order.customerId,
        invoiceDate: invoiceDateStr,
        dueDate: dueDateStr,
        currency: order.currency,
        exchangeRate: order.exchangeRate,
        billingAddressId: order.billingAddressId,
        billingAddressSnapshot: order.billingAddressSnapshot,
        shippingAddressId: order.shippingAddressId,
        shippingAddressSnapshot: order.shippingAddressSnapshot,
        contactId: order.contactId,
        contactSnapshot: order.contactSnapshot,
        status: 'DRAFT',
        notes: null,
        termsAndConditions: order.termsAndConditions,
        subtotalAmount: subtotal.toFixed(2),
        headerDiscountAmount: '0.00',
        discountAmount: (subtotal - totalTaxable).toFixed(2),
        taxableAmount: totalTaxable.toFixed(2),
        cgstAmount: totalCgst.toFixed(2),
        sgstAmount: totalSgst.toFixed(2),
        igstAmount: totalIgst.toFixed(2),
        taxAmount: totalTax.toFixed(2),
        totalAmount: totalGross.toFixed(2),
        totalAmountBase: totalGross.toFixed(2),
        arDocumentId: null,
        arOpenItemId: null,
        journalEntryId: null,
        postedAt: null,
        postedBy: null,
        cancelledAt: null,
        cancelledBy: null,
        cancellationReason: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: userId,
        updatedBy: userId,
        lines: createdLines
      };

      this.memoryStore.set(`${ctx.tenantId}:${input.companyId}:${invoiceId}`, invoiceDto);

      await auditService.logEvent(ctx, {
        module: 'sales',
        entityName: 'SalesInvoice',
        entityId: invoiceId,
        action: 'CREATE',
        newValues: {
          invoiceNumber,
          salesOrderNumber: order.orderNumber,
          totalAmount: totalGross.toFixed(2),
          status: 'DRAFT'
        }
      });

      if (idempotencyKey) {
        const cacheKey = `${ctx.tenantId}:${input.companyId}:${idempotencyKey}`;
        this.idempotencyStore.set(cacheKey, invoiceDto);
      }

      return invoiceDto;
    }

    // DB Transaction Execution
    const resultInvoice = await db.transaction(async (tx) => {
      const [orderRow] = await tx
        .select()
        .from(salesOrders)
        .where(
          and(
            eq(salesOrders.id, input.salesOrderId),
            eq(salesOrders.tenantId, ctx.tenantId),
            eq(salesOrders.companyId, input.companyId)
          )
        )
        .for('update');

      if (!orderRow) {
        throw new NotFoundError(`Sales Order '${input.salesOrderId}' not found.`);
      }

      if (orderRow.status !== 'CONFIRMED' && orderRow.status !== 'COMPLETED') {
        throw new ValidationError(`Cannot create Sales Invoice for order in status '${orderRow.status}'. Order must be CONFIRMED.`);
      }

      const dbOrderLines = await tx
        .select()
        .from(salesOrderLines)
        .where(
          and(
            eq(salesOrderLines.orderId, input.salesOrderId),
            eq(salesOrderLines.tenantId, ctx.tenantId),
            eq(salesOrderLines.companyId, input.companyId)
          )
        )
        .for('update');

      let deliveryNum: string | null = null;
      if (input.salesDeliveryId) {
        const [delRow] = await tx
          .select()
          .from(salesDeliveries)
          .where(eq(salesDeliveries.id, input.salesDeliveryId));
        if (delRow) deliveryNum = delRow.deliveryNumber;
      }

      const yearStr = new Date().getFullYear().toString();
      numberingEngine.configureSequence(ctx.tenantId, input.companyId, {
        documentType: 'SALES_INVOICE',
        prefix: 'INV',
        fiscalYear: yearStr,
        currentSequence: 0,
        paddingDigits: 4,
        resetOnFiscalYear: true
      });
      const invoiceNumber = numberingEngine.generateNextNumber(ctx.tenantId, input.companyId, 'SALES_INVOICE', yearStr);
      const invoiceId = crypto.randomUUID();

      let subtotal = 0;
      let totalTaxable = 0;
      let totalCgst = 0;
      let totalSgst = 0;
      let totalIgst = 0;
      let totalTax = 0;
      let totalGross = 0;

      const insertedLines: SalesInvoiceLineDTO[] = [];
      let lineNumCounter = 1;

      for (const orderLine of dbOrderLines) {
        let invQty = parseFloat(orderLine.orderedQuantity);
        if (input.lines && input.lines.length > 0) {
          const userLine = input.lines.find(l => l.salesOrderLineId === orderLine.id);
          if (userLine) {
            invQty = parseFloat(userLine.invoicedQuantity);
          } else {
            continue;
          }
        }

        if (invQty <= 0) continue;

        const prevInvoiced = parseFloat(orderLine.invoicedQuantity || '0');
        const maxInvoicable = parseFloat(orderLine.orderedQuantity) - parseFloat(orderLine.cancelledQuantity || '0') - prevInvoiced;
        if (invQty > maxInvoicable + 0.0001) {
          throw new ValidationError(
            `OVER_INVOICING_EXCEEDED: Invoiced quantity (${invQty}) for product '${orderLine.productCodeSnapshot}' exceeds remaining deliverable quantity (${maxInvoicable.toFixed(4)}).`
          );
        }

        const unitPriceNum = parseFloat(orderLine.unitPrice);
        const lineGrossNum = invQty * unitPriceNum;
        const discPercent = parseFloat(orderLine.discountPercent || '0');
        const lineDiscNum = (lineGrossNum * discPercent) / 100.0;
        const lineTaxableNum = lineGrossNum - lineDiscNum;

        const cgstRate = parseFloat(orderLine.cgstRate || '0');
        const sgstRate = parseFloat(orderLine.sgstRate || '0');
        const igstRate = parseFloat(orderLine.igstRate || '0');

        const lineCgstNum = (lineTaxableNum * cgstRate) / 100.0;
        const lineSgstNum = (lineTaxableNum * sgstRate) / 100.0;
        const lineIgstNum = (lineTaxableNum * igstRate) / 100.0;
        const lineTaxNum = lineCgstNum + lineSgstNum + lineIgstNum;
        const lineTotalNum = lineTaxableNum + lineTaxNum;

        subtotal += lineGrossNum;
        totalTaxable += lineTaxableNum;
        totalCgst += lineCgstNum;
        totalSgst += lineSgstNum;
        totalIgst += lineIgstNum;
        totalTax += lineTaxNum;
        totalGross += lineTotalNum;

        const lineId = crypto.randomUUID();
        await tx.insert(salesInvoiceLines).values({
          id: lineId,
          invoiceId,
          salesOrderLineId: orderLine.id,
          salesDeliveryLineId: null,
          tenantId: ctx.tenantId,
          companyId: input.companyId,
          lineNumber: lineNumCounter++,
          productId: orderLine.productId,
          productCodeSnapshot: orderLine.productCodeSnapshot,
          productNameSnapshot: orderLine.productNameSnapshot,
          description: orderLine.description || null,
          uom: orderLine.uom,
          invoicedQuantity: invQty.toFixed(4),
          unitPrice: orderLine.unitPrice,
          discountPercent: orderLine.discountPercent,
          discountAmount: lineDiscNum.toFixed(2),
          allocatedHeaderDiscountAmount: '0.00',
          grossAmount: lineGrossNum.toFixed(2),
          taxableAmount: lineTaxableNum.toFixed(2),
          hsnSac: orderLine.hsnSac,
          cgstRate: orderLine.cgstRate,
          cgstAmount: lineCgstNum.toFixed(2),
          sgstRate: orderLine.sgstRate,
          sgstAmount: lineSgstNum.toFixed(2),
          igstRate: orderLine.igstRate,
          igstAmount: lineIgstNum.toFixed(2),
          taxAmount: lineTaxNum.toFixed(2),
          lineTotal: lineTotalNum.toFixed(2),
          version: 1
        });

        // Update sales_order_lines invoicedQuantity
        await tx
          .update(salesOrderLines)
          .set({
            invoicedQuantity: (prevInvoiced + invQty).toFixed(4),
            updatedAt: new Date()
          })
          .where(eq(salesOrderLines.id, orderLine.id));

        insertedLines.push({
          id: lineId,
          invoiceId,
          salesOrderLineId: orderLine.id,
          salesDeliveryLineId: null,
          tenantId: ctx.tenantId,
          companyId: input.companyId,
          lineNumber: lineNumCounter - 1,
          productId: orderLine.productId,
          productCodeSnapshot: orderLine.productCodeSnapshot,
          productNameSnapshot: orderLine.productNameSnapshot,
          description: orderLine.description || null,
          uom: orderLine.uom,
          invoicedQuantity: invQty.toFixed(4),
          unitPrice: orderLine.unitPrice,
          discountPercent: orderLine.discountPercent,
          discountAmount: lineDiscNum.toFixed(2),
          allocatedHeaderDiscountAmount: '0.00',
          grossAmount: lineGrossNum.toFixed(2),
          taxableAmount: lineTaxableNum.toFixed(2),
          hsnSac: orderLine.hsnSac,
          cgstRate: orderLine.cgstRate,
          cgstAmount: lineCgstNum.toFixed(2),
          sgstRate: orderLine.sgstRate,
          sgstAmount: lineSgstNum.toFixed(2),
          igstRate: orderLine.igstRate,
          igstAmount: lineIgstNum.toFixed(2),
          taxAmount: lineTaxNum.toFixed(2),
          lineTotal: lineTotalNum.toFixed(2),
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }

      await tx.insert(salesInvoices).values({
        id: invoiceId,
        tenantId: ctx.tenantId,
        companyId: input.companyId,
        invoiceNumber,
        salesOrderId: orderRow.id,
        salesOrderNumber: orderRow.orderNumber,
        salesDeliveryId: input.salesDeliveryId || null,
        salesDeliveryNumber: deliveryNum,
        customerId: orderRow.customerId,
        invoiceDate: invoiceDateStr,
        dueDate: dueDateStr,
        currency: orderRow.currency,
        exchangeRate: orderRow.exchangeRate,
        billingAddressId: orderRow.billingAddressId,
        billingAddressSnapshot: orderRow.billingAddressSnapshot,
        shippingAddressId: orderRow.shippingAddressId,
        shippingAddressSnapshot: orderRow.shippingAddressSnapshot,
        contactId: orderRow.contactId,
        contactSnapshot: orderRow.contactSnapshot,
        status: 'DRAFT',
        termsAndConditions: orderRow.termsAndConditions,
        subtotalAmount: subtotal.toFixed(2),
        headerDiscountAmount: '0.00',
        discountAmount: (subtotal - totalTaxable).toFixed(2),
        taxableAmount: totalTaxable.toFixed(2),
        cgstAmount: totalCgst.toFixed(2),
        sgstAmount: totalSgst.toFixed(2),
        igstAmount: totalIgst.toFixed(2),
        taxAmount: totalTax.toFixed(2),
        totalAmount: totalGross.toFixed(2),
        totalAmountBase: totalGross.toFixed(2),
        version: 1,
        createdBy: userId,
        updatedBy: userId
      });

      const invoiceDto: SalesInvoiceDTO = {
        id: invoiceId,
        tenantId: ctx.tenantId,
        companyId: input.companyId,
        branchId: null,
        invoiceNumber,
        salesOrderId: orderRow.id,
        salesOrderNumber: orderRow.orderNumber,
        salesDeliveryId: input.salesDeliveryId || null,
        salesDeliveryNumber: deliveryNum,
        customerId: orderRow.customerId,
        invoiceDate: invoiceDateStr,
        dueDate: dueDateStr,
        currency: orderRow.currency,
        exchangeRate: orderRow.exchangeRate,
        billingAddressId: orderRow.billingAddressId,
        billingAddressSnapshot: (orderRow.billingAddressSnapshot as unknown) as Record<string, any>,
        shippingAddressId: orderRow.shippingAddressId,
        shippingAddressSnapshot: (orderRow.shippingAddressSnapshot as unknown) as Record<string, any>,
        contactId: orderRow.contactId,
        contactSnapshot: (orderRow.contactSnapshot as unknown) as Record<string, any> | null,
        status: 'DRAFT',
        notes: null,
        termsAndConditions: orderRow.termsAndConditions,
        subtotalAmount: subtotal.toFixed(2),
        headerDiscountAmount: '0.00',
        discountAmount: (subtotal - totalTaxable).toFixed(2),
        taxableAmount: totalTaxable.toFixed(2),
        cgstAmount: totalCgst.toFixed(2),
        sgstAmount: totalSgst.toFixed(2),
        igstAmount: totalIgst.toFixed(2),
        taxAmount: totalTax.toFixed(2),
        totalAmount: totalGross.toFixed(2),
        totalAmountBase: totalGross.toFixed(2),
        arDocumentId: null,
        arOpenItemId: null,
        journalEntryId: null,
        postedAt: null,
        postedBy: null,
        cancelledAt: null,
        cancelledBy: null,
        cancellationReason: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: userId,
        updatedBy: userId,
        lines: insertedLines
      };

      return invoiceDto;
    });

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesInvoice',
      entityId: resultInvoice.id,
      action: 'CREATE',
      newValues: {
        invoiceNumber: resultInvoice.invoiceNumber,
        salesOrderNumber: resultInvoice.salesOrderNumber,
        totalAmount: resultInvoice.totalAmount,
        status: 'DRAFT'
      }
    });

    if (idempotencyKey) {
      const cacheKey = `${ctx.tenantId}:${input.companyId}:${idempotencyKey}`;
      this.idempotencyStore.set(cacheKey, resultInvoice);
    }

    return resultInvoice;
  }

  /**
   * Retrieves a Sales Invoice by ID.
   */
  public async getInvoiceById(ctx: RequestContext, invoiceId: string): Promise<SalesInvoiceDTO> {
    this.checkPermission(ctx, 'sales:invoice:read');

    const db = getDb();
    if (!db) {
      for (const inv of this.memoryStore.values()) {
        if (inv.id === invoiceId && inv.tenantId === ctx.tenantId) {
          return inv;
        }
      }
      throw new NotFoundError(`Sales Invoice '${invoiceId}' not found.`);
    }

    const [header] = await db
      .select()
      .from(salesInvoices)
      .where(and(eq(salesInvoices.id, invoiceId), eq(salesInvoices.tenantId, ctx.tenantId)));

    if (!header) {
      throw new NotFoundError(`Sales Invoice '${invoiceId}' not found.`);
    }

    const dbLines = await db
      .select()
      .from(salesInvoiceLines)
      .where(eq(salesInvoiceLines.invoiceId, invoiceId));

    return {
      id: header.id,
      tenantId: header.tenantId,
      companyId: header.companyId,
      branchId: header.branchId,
      invoiceNumber: header.invoiceNumber,
      salesOrderId: header.salesOrderId,
      salesOrderNumber: header.salesOrderNumber,
      salesDeliveryId: header.salesDeliveryId,
      salesDeliveryNumber: header.salesDeliveryNumber,
      customerId: header.customerId,
      invoiceDate: header.invoiceDate,
      dueDate: header.dueDate,
      currency: header.currency,
      exchangeRate: header.exchangeRate,
      billingAddressId: header.billingAddressId,
      billingAddressSnapshot: (header.billingAddressSnapshot as unknown) as Record<string, any>,
      shippingAddressId: header.shippingAddressId,
      shippingAddressSnapshot: (header.shippingAddressSnapshot as unknown) as Record<string, any>,
      contactId: header.contactId,
      contactSnapshot: (header.contactSnapshot as unknown) as Record<string, any> | null,
      status: header.status as any,
      notes: header.notes,
      termsAndConditions: header.termsAndConditions,
      subtotalAmount: header.subtotalAmount,
      headerDiscountAmount: header.headerDiscountAmount,
      discountAmount: header.discountAmount,
      taxableAmount: header.taxableAmount,
      cgstAmount: header.cgstAmount,
      sgstAmount: header.sgstAmount,
      igstAmount: header.igstAmount,
      taxAmount: header.taxAmount,
      totalAmount: header.totalAmount,
      totalAmountBase: header.totalAmountBase,
      arDocumentId: header.arDocumentId,
      arOpenItemId: header.arOpenItemId,
      journalEntryId: header.journalEntryId,
      postedAt: header.postedAt,
      postedBy: header.postedBy,
      cancelledAt: header.cancelledAt,
      cancelledBy: header.cancelledBy,
      cancellationReason: header.cancellationReason,
      version: header.version,
      createdAt: header.createdAt,
      updatedAt: header.updatedAt,
      createdBy: header.createdBy,
      updatedBy: header.updatedBy,
      lines: dbLines.map(l => ({
        id: l.id,
        invoiceId: l.invoiceId,
        salesOrderLineId: l.salesOrderLineId,
        salesDeliveryLineId: l.salesDeliveryLineId,
        tenantId: l.tenantId,
        companyId: l.companyId,
        lineNumber: l.lineNumber,
        productId: l.productId,
        productCodeSnapshot: l.productCodeSnapshot,
        productNameSnapshot: l.productNameSnapshot,
        description: l.description,
        uom: l.uom,
        invoicedQuantity: l.invoicedQuantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
        discountAmount: l.discountAmount,
        allocatedHeaderDiscountAmount: l.allocatedHeaderDiscountAmount,
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
  }

  /**
   * Lists Sales Invoices with filtering and pagination.
   */
  public async listInvoices(
    ctx: RequestContext,
    params: ListSalesInvoicesParams
  ): Promise<{ data: SalesInvoiceDTO[]; total: number; page: number; limit: number }> {
    this.checkPermission(ctx, 'sales:invoice:read');
    const page = params.page && params.page > 0 ? params.page : 1;
    const limit = params.limit && params.limit > 0 ? params.limit : 50;

    const db = getDb();
    if (!db) {
      let filtered = Array.from(this.memoryStore.values()).filter(
        i => i.tenantId === ctx.tenantId && i.companyId === params.companyId
      );
      if (params.status) filtered = filtered.filter(i => i.status === params.status);
      if (params.customerId) filtered = filtered.filter(i => i.customerId === params.customerId);
      if (params.salesOrderId) filtered = filtered.filter(i => i.salesOrderId === params.salesOrderId);
      if (params.search) {
        const s = params.search.toLowerCase();
        filtered = filtered.filter(
          i =>
            i.invoiceNumber.toLowerCase().includes(s) ||
            (i.salesOrderNumber && i.salesOrderNumber.toLowerCase().includes(s))
        );
      }

      const total = filtered.length;
      const start = (page - 1) * limit;
      const data = filtered.slice(start, start + limit);
      return { data, total, page, limit };
    }

    const conditions = [
      eq(salesInvoices.tenantId, ctx.tenantId),
      eq(salesInvoices.companyId, params.companyId)
    ];

    if (params.status) conditions.push(eq(salesInvoices.status, params.status));
    if (params.customerId) conditions.push(eq(salesInvoices.customerId, params.customerId));
    if (params.salesOrderId) conditions.push(eq(salesInvoices.salesOrderId, params.salesOrderId));
    if (params.search) {
      const term = `%${params.search}%`;
      conditions.push(
        or(
          ilike(salesInvoices.invoiceNumber, term),
          ilike(salesInvoices.salesOrderNumber, term)
        )!
      );
    }

    const whereClause = and(...conditions);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(salesInvoices)
      .where(whereClause);

    const total = Number(countResult?.count || 0);

    const rows = await db
      .select()
      .from(salesInvoices)
      .where(whereClause)
      .limit(limit)
      .offset((page - 1) * limit);

    const data: SalesInvoiceDTO[] = [];
    for (const r of rows) {
      const lines = await db
        .select()
        .from(salesInvoiceLines)
        .where(eq(salesInvoiceLines.invoiceId, r.id));

      data.push({
        id: r.id,
        tenantId: r.tenantId,
        companyId: r.companyId,
        branchId: r.branchId,
        invoiceNumber: r.invoiceNumber,
        salesOrderId: r.salesOrderId,
        salesOrderNumber: r.salesOrderNumber,
        salesDeliveryId: r.salesDeliveryId,
        salesDeliveryNumber: r.salesDeliveryNumber,
        customerId: r.customerId,
        invoiceDate: r.invoiceDate,
        dueDate: r.dueDate,
        currency: r.currency,
        exchangeRate: r.exchangeRate,
        billingAddressId: r.billingAddressId,
        billingAddressSnapshot: (r.billingAddressSnapshot as unknown) as Record<string, any>,
        shippingAddressId: r.shippingAddressId,
        shippingAddressSnapshot: (r.shippingAddressSnapshot as unknown) as Record<string, any>,
        contactId: r.contactId,
        contactSnapshot: (r.contactSnapshot as unknown) as Record<string, any> | null,
        status: r.status as any,
        notes: r.notes,
        termsAndConditions: r.termsAndConditions,
        subtotalAmount: r.subtotalAmount,
        headerDiscountAmount: r.headerDiscountAmount,
        discountAmount: r.discountAmount,
        taxableAmount: r.taxableAmount,
        cgstAmount: r.cgstAmount,
        sgstAmount: r.sgstAmount,
        igstAmount: r.igstAmount,
        taxAmount: r.taxAmount,
        totalAmount: r.totalAmount,
        totalAmountBase: r.totalAmountBase,
        arDocumentId: r.arDocumentId,
        arOpenItemId: r.arOpenItemId,
        journalEntryId: r.journalEntryId,
        postedAt: r.postedAt,
        postedBy: r.postedBy,
        cancelledAt: r.cancelledAt,
        cancelledBy: r.cancelledBy,
        cancellationReason: r.cancellationReason,
        version: r.version,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        createdBy: r.createdBy,
        updatedBy: r.updatedBy,
        lines: lines.map(l => ({
          id: l.id,
          invoiceId: l.invoiceId,
          salesOrderLineId: l.salesOrderLineId,
          salesDeliveryLineId: l.salesDeliveryLineId,
          tenantId: l.tenantId,
          companyId: l.companyId,
          lineNumber: l.lineNumber,
          productId: l.productId,
          productCodeSnapshot: l.productCodeSnapshot,
          productNameSnapshot: l.productNameSnapshot,
          description: l.description,
          uom: l.uom,
          invoicedQuantity: l.invoicedQuantity,
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent,
          discountAmount: l.discountAmount,
          allocatedHeaderDiscountAmount: l.allocatedHeaderDiscountAmount,
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
      });
    }

    return { data, total, page, limit };
  }

  /**
   * Posts a Sales Invoice (DRAFT/APPROVED -> POSTED) and triggers Accounts Receivable & AccountingCore Posting.
   * Also executes sales order state transition CONFIRMED -> COMPLETED when all order lines are fully delivered and fully invoiced!
   */
  public async postInvoice(
    ctx: RequestContext,
    invoiceId: string,
    idempotencyKey?: string
  ): Promise<SalesInvoiceDTO> {
    this.checkPermission(ctx, 'sales:invoice:post');

    const invoice = await this.getInvoiceById(ctx, invoiceId);

    // Idempotent re-post check
    if (invoice.status === 'POSTED' || invoice.status === 'SETTLED' || invoice.status === 'PARTIALLY_SETTLED') {
      return invoice;
    }

    if (invoice.status === 'CANCELLED' || invoice.status === 'REVERSED') {
      throw new BusinessRuleViolationError(`Cannot post Sales Invoice in state '${invoice.status}'.`);
    }

    const userId = ctx.user?.userId || (ctx as any).userId || '00000000-0000-0000-0000-000000000000';

    // 1. Post AR Document via AR Subledger Service
    const arDocInput = {
      companyId: invoice.companyId,
      customerId: invoice.customerId,
      documentType: 'INVOICE' as const,
      documentNumber: invoice.invoiceNumber,
      documentDate: invoice.invoiceDate,
      accountingDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      currency: invoice.currency,
      exchangeRate: invoice.exchangeRate,
      taxability: 'TAXABLE' as const,
      sourceModule: 'SALES_INVOICE',
      sourceDocumentId: invoice.id,
      lines: invoice.lines.map(l => ({
        productId: l.productId,
        description: `${l.productNameSnapshot} (${l.productCodeSnapshot})`,
        hsnSac: l.hsnSac || undefined,
        quantity: parseFloat(l.invoicedQuantity).toFixed(2),
        unitPrice: parseFloat(l.unitPrice).toFixed(2),
        taxableAmount: parseFloat(l.taxableAmount).toFixed(2),
        cgstAmount: parseFloat(l.cgstAmount).toFixed(2),
        sgstAmount: parseFloat(l.sgstAmount).toFixed(2),
        igstAmount: parseFloat(l.igstAmount).toFixed(2),
        taxAmount: parseFloat(l.taxAmount).toFixed(2),
        grossAmount: parseFloat(l.lineTotal || l.grossAmount).toFixed(2)
      }))
    };

    const draftArDoc = await arDocumentService.createDraft(ctx, arDocInput);
    const postedArDoc = await arDocumentService.postDocument(ctx, draftArDoc.id, { idempotencyKey });

    const openItems = await arDocumentService.getOpenItems(ctx, invoice.companyId, { customerId: invoice.customerId });
    const matchingOpenItem = openItems.find(oi => oi.arDocumentId === postedArDoc.id);

    invoice.status = 'POSTED';
    invoice.postedAt = new Date();
    invoice.postedBy = userId;
    invoice.arDocumentId = postedArDoc.id;
    invoice.arOpenItemId = matchingOpenItem?.id || null;
    invoice.journalEntryId = postedArDoc.journalEntryId || null;
    invoice.updatedAt = new Date();

    const db = getDb();
    if (!db) {
      this.memoryStore.set(`${ctx.tenantId}:${invoice.companyId}:${invoiceId}`, invoice);

      // Check sales order completion in memory
      if (invoice.salesOrderId) {
        const order = await salesOrderService.getOrderById(ctx, invoice.salesOrderId);
        let allFullyFulfilled = true;
        for (const ol of order.lines) {
          const ordered = parseFloat(ol.orderedQuantity);
          const cancelled = parseFloat(ol.cancelledQuantity || '0');
          const delivered = parseFloat(ol.deliveredQuantity || '0');
          const invoiced = parseFloat(ol.invoicedQuantity || '0');
          const netRequired = Math.max(0, ordered - cancelled);

          if (delivered < netRequired || invoiced < netRequired) {
            allFullyFulfilled = false;
            break;
          }
        }

        if (allFullyFulfilled) {
          order.status = 'COMPLETED';
          order.updatedAt = new Date();
        }
      }
    } else {
      await db.transaction(async (tx) => {
        await tx
          .update(salesInvoices)
          .set({
            status: 'POSTED',
            postedAt: invoice.postedAt,
            postedBy: invoice.postedBy,
            arDocumentId: invoice.arDocumentId,
            arOpenItemId: invoice.arOpenItemId,
            journalEntryId: invoice.journalEntryId,
            updatedAt: new Date()
          })
          .where(eq(salesInvoices.id, invoiceId));

        // Check Sales Order completion status under row lock
        if (invoice.salesOrderId) {
          const [orderRow] = await tx
            .select()
            .from(salesOrders)
            .where(
              and(
                eq(salesOrders.id, invoice.salesOrderId),
                eq(salesOrders.tenantId, ctx.tenantId),
                eq(salesOrders.companyId, invoice.companyId)
              )
            )
            .for('update');

          if (orderRow) {
            const dbOrderLines = await tx
              .select()
              .from(salesOrderLines)
              .where(eq(salesOrderLines.orderId, orderRow.id));

            let allFullyFulfilled = true;
            for (const ol of dbOrderLines) {
              const ordered = parseFloat(ol.orderedQuantity);
              const cancelled = parseFloat(ol.cancelledQuantity || '0');
              const delivered = parseFloat(ol.deliveredQuantity || '0');
              const invoiced = parseFloat(ol.invoicedQuantity || '0');
              const netRequired = Math.max(0, ordered - cancelled);

              if (delivered < netRequired || invoiced < netRequired) {
                allFullyFulfilled = false;
                break;
              }
            }

            if (allFullyFulfilled) {
              await tx
                .update(salesOrders)
                .set({
                  status: 'COMPLETED',
                  updatedAt: new Date()
                })
                .where(eq(salesOrders.id, orderRow.id));
            }
          }
        }
      });
    }

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesInvoice',
      entityId: invoiceId,
      action: 'POST',
      newValues: {
        status: 'POSTED',
        invoiceNumber: invoice.invoiceNumber,
        arDocumentId: invoice.arDocumentId,
        journalEntryId: invoice.journalEntryId
      }
    });

    await notificationEngine.sendNotification(ctx, {
      channels: ['IN_APP'],
      recipientId: userId,
      title: `Sales Invoice Posted: ${invoice.invoiceNumber}`,
      body: `Sales Invoice ${invoice.invoiceNumber} for amount ${invoice.totalAmount} has been posted. AR Open Item and Journal entry generated.`,
      data: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber }
    });

    return invoice;
  }

  /**
   * Cancels a DRAFT Sales Invoice. (Posted invoices are immutable and cannot be cancelled directly).
   */
  public async cancelInvoice(ctx: RequestContext, invoiceId: string, reason: string): Promise<SalesInvoiceDTO> {
    this.checkPermission(ctx, 'sales:invoice:cancel');
    if (!reason || reason.trim().length === 0) {
      throw new ValidationError('Cancellation reason is required when cancelling a Sales Invoice.');
    }

    const invoice = await this.getInvoiceById(ctx, invoiceId);
    if (invoice.status === 'POSTED' || invoice.status === 'SETTLED' || invoice.status === 'PARTIALLY_SETTLED') {
      throw new BusinessRuleViolationError('Cannot cancel a POSTED Sales Invoice. Posted financial records are immutable.');
    }
    if (invoice.status === 'CANCELLED') return invoice;

    const userId = ctx.user?.userId || '00000000-0000-0000-0000-000000000000';
    const db = getDb();

    if (!db) {
      if (invoice.salesOrderId) {
        const order = await salesOrderService.getOrderById(ctx, invoice.salesOrderId);
        for (const line of invoice.lines) {
          if (line.salesOrderLineId) {
            const orderLine = order.lines.find(l => l.id === line.salesOrderLineId);
            if (orderLine) {
              const currentInv = parseFloat(orderLine.invoicedQuantity || '0');
              const rel = parseFloat(line.invoicedQuantity);
              orderLine.invoicedQuantity = Math.max(0, currentInv - rel).toFixed(4);
            }
          }
        }
      }

      invoice.status = 'CANCELLED';
      invoice.cancelledAt = new Date();
      invoice.cancelledBy = userId;
      invoice.cancellationReason = reason;
      invoice.updatedAt = new Date();

      this.memoryStore.set(`${ctx.tenantId}:${invoice.companyId}:${invoiceId}`, invoice);
    } else {
      await db.transaction(async (tx) => {
        if (invoice.salesOrderId) {
          const dbOrderLines = await tx
            .select()
            .from(salesOrderLines)
            .where(eq(salesOrderLines.orderId, invoice.salesOrderId))
            .for('update');

          for (const line of invoice.lines) {
            if (line.salesOrderLineId) {
              const orderLine = dbOrderLines.find(l => l.id === line.salesOrderLineId);
              if (orderLine) {
                const currentInv = parseFloat(orderLine.invoicedQuantity || '0');
                const rel = parseFloat(line.invoicedQuantity);
                await tx
                  .update(salesOrderLines)
                  .set({
                    invoicedQuantity: Math.max(0, currentInv - rel).toFixed(4),
                    updatedAt: new Date()
                  })
                  .where(eq(salesOrderLines.id, orderLine.id));
              }
            }
          }
        }

        await tx
          .update(salesInvoices)
          .set({
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancelledBy: userId,
            cancellationReason: reason,
            updatedAt: new Date()
          })
          .where(eq(salesInvoices.id, invoiceId));
      });

      invoice.status = 'CANCELLED';
      invoice.cancelledAt = new Date();
      invoice.cancelledBy = userId;
      invoice.cancellationReason = reason;
      invoice.updatedAt = new Date();
    }

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesInvoice',
      entityId: invoiceId,
      action: 'CANCEL',
      newValues: { status: 'CANCELLED', cancellationReason: reason }
    });

    return invoice;
  }
}

export const salesInvoiceService = new SalesInvoiceService();
