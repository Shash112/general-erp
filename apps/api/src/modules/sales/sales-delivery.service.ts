import crypto from 'crypto';
import {
  RequestContext,
  ValidationError,
  ForbiddenError,
  NotFoundError
} from '@general-erp/core';
import { auditService } from '../../platform/audit/audit.service.js';
import { numberingEngine } from '../../platform/numbering/numbering.service.js';
import { notificationEngine } from '../../platform/notifications/notification.service.js';
import { salesOrderService } from './sales-order.service.js';
import {
  getDb,
  salesDeliveries,
  salesDeliveryLines,
  salesOrders,
  salesOrderLines,
  eq,
  and,
  ilike,
  or,
  sql,
  inArray
} from '@general-erp/database';

export interface SalesDeliveryLineDTO {
  id: string;
  deliveryId: string;
  salesOrderLineId: string;
  tenantId: string;
  companyId: string;
  lineNumber: number;
  productId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  description: string | null;
  uom: string;
  orderedQuantitySnapshot: string;
  previouslyDeliveredQuantitySnapshot: string;
  deliveryQuantity: string;
  rejectedQuantity: string;
  remainingQuantitySnapshot: string;
  notes: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SalesDeliveryDTO {
  id: string;
  tenantId: string;
  companyId: string;
  branchId: string | null;
  deliveryNumber: string;
  salesOrderId: string;
  salesOrderNumber: string;
  customerId: string;
  deliveryDate: string;
  shippingAddressId: string;
  shippingAddressSnapshot: Record<string, any>;
  contactId: string | null;
  contactSnapshot: Record<string, any> | null;
  warehouseReference: string | null;
  transporterName: string | null;
  vehicleNumber: string | null;
  lrNumber: string | null;
  lrDate: string | null;
  notes: string | null;
  status: 'DRAFT' | 'PICKED' | 'PACKED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';
  pickedAt: Date | null;
  pickedBy: string | null;
  packedAt: Date | null;
  packedBy: string | null;
  dispatchedAt: Date | null;
  dispatchedBy: string | null;
  deliveredAt: Date | null;
  deliveredBy: string | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
  lines: SalesDeliveryLineDTO[];
}

export interface CreateSalesDeliveryLineInput {
  salesOrderLineId: string;
  deliveryQuantity: string;
  rejectedQuantity?: string | undefined;
  notes?: string | undefined;
}

export interface CreateSalesDeliveryInput {
  companyId: string;
  salesOrderId: string;
  deliveryDate: string;
  branchId?: string | undefined;
  warehouseReference?: string | undefined;
  transporterName?: string | undefined;
  vehicleNumber?: string | undefined;
  lrNumber?: string | undefined;
  lrDate?: string | undefined;
  notes?: string | undefined;
  lines: CreateSalesDeliveryLineInput[];
}

export interface UpdateSalesDeliveryInput {
  deliveryDate?: string | undefined;
  warehouseReference?: string | undefined;
  transporterName?: string | undefined;
  vehicleNumber?: string | undefined;
  lrNumber?: string | undefined;
  lrDate?: string | undefined;
  notes?: string | undefined;
  lines?: CreateSalesDeliveryLineInput[] | undefined;
}

export interface ListSalesDeliveriesParams {
  companyId: string;
  status?: string | undefined;
  customerId?: string | undefined;
  salesOrderId?: string | undefined;
  search?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

export interface OrderFulfillmentLineSummary {
  salesOrderLineId: string;
  lineNumber: number;
  productId: string;
  productCode: string;
  productName: string;
  uom: string;
  orderedQuantity: string;
  deliveredQuantity: string;
  cancelledQuantity: string;
  remainingQuantity: string;
  fulfillmentPercent: string;
}

export interface OrderFulfillmentSummaryDTO {
  salesOrderId: string;
  salesOrderNumber: string;
  status: string;
  totalLines: number;
  fullyDeliveredLines: number;
  partiallyDeliveredLines: number;
  undeliveredLines: number;
  overallFulfillmentPercent: string;
  lines: OrderFulfillmentLineSummary[];
}

export class SalesDeliveryService {
  private memoryStore = new Map<string, SalesDeliveryDTO>();
  private idempotencyStore = new Map<string, SalesDeliveryDTO>();

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
   * Creates a Sales Delivery against a confirmed Sales Order.
   */
  public async createDelivery(
    ctx: RequestContext,
    input: CreateSalesDeliveryInput,
    idempotencyKey?: string
  ): Promise<SalesDeliveryDTO> {
    this.checkPermission(ctx, 'sales:delivery:create');

    // 1. HTTP Request-level Idempotency Check
    if (idempotencyKey) {
      const cacheKey = `${ctx.tenantId}:${input.companyId}:${idempotencyKey}`;
      const cached = this.idempotencyStore.get(cacheKey);
      if (cached) return cached;
    }

    if (!input.lines || input.lines.length === 0) {
      throw new ValidationError('Delivery must contain at least one delivery line.');
    }

    const userId = ctx.user?.userId || (ctx as any).userId || '00000000-0000-0000-0000-000000000000';
    const db = getDb();

    // In-memory Fallback Execution (Unit Testing Mode)
    if (!db) {
      const order = await salesOrderService.getOrderById(ctx, input.salesOrderId);
      if (order.status !== 'CONFIRMED' && order.status !== 'COMPLETED') {
        throw new ValidationError(
          `Cannot create Sales Delivery for order in status '${order.status}'. Order must be CONFIRMED or COMPLETED.`
        );
      }

      // Calculate existing active delivery line totals in memory
      const existingDeliveredQtyMap = new Map<string, number>();
      for (const del of this.memoryStore.values()) {
        if (
          del.tenantId === ctx.tenantId &&
          del.companyId === input.companyId &&
          del.salesOrderId === input.salesOrderId &&
          del.status !== 'CANCELLED'
        ) {
          for (const line of del.lines) {
            const current = existingDeliveredQtyMap.get(line.salesOrderLineId) || 0;
            existingDeliveredQtyMap.get(line.salesOrderLineId);
            existingDeliveredQtyMap.set(line.salesOrderLineId, current + parseFloat(line.deliveryQuantity));
          }
        }
      }

      const deliveryId = crypto.randomUUID();
      const yearStr = new Date().getFullYear().toString();
      numberingEngine.configureSequence(ctx.tenantId, input.companyId, {
        documentType: 'SALES_DELIVERY',
        prefix: 'DEL',
        fiscalYear: yearStr,
        currentSequence: 0,
        paddingDigits: 4,
        resetOnFiscalYear: true
      });
      const deliveryNumber = numberingEngine.generateNextNumber(ctx.tenantId, input.companyId, 'SALES_DELIVERY', yearStr);

      const createdLines: SalesDeliveryLineDTO[] = [];
      let lineNumCounter = 1;

      for (const item of input.lines) {
        const orderLine = order.lines.find(l => l.id === item.salesOrderLineId);
        if (!orderLine) {
          throw new NotFoundError(`Sales Order Line '${item.salesOrderLineId}' not found on order '${order.id}'.`);
        }

        const qtyRequested = parseFloat(item.deliveryQuantity);
        if (isNaN(qtyRequested) || qtyRequested <= 0) {
          throw new ValidationError(`Delivery quantity for product '${orderLine.productCodeSnapshot}' must be greater than zero.`);
        }

        const orderedQty = parseFloat(orderLine.orderedQuantity);
        const cancelledQty = parseFloat(orderLine.cancelledQuantity || '0');
        const prevDeliveredQty = existingDeliveredQtyMap.get(orderLine.id) || parseFloat(orderLine.deliveredQuantity || '0');
        const maxDeliverable = orderedQty - cancelledQty - prevDeliveredQty;

        if (qtyRequested > maxDeliverable + 0.0001) {
          throw new ValidationError(
            `OVER_DELIVERY_EXCEEDED: Requested delivery quantity (${qtyRequested}) for product '${orderLine.productCodeSnapshot}' exceeds remaining deliverable quantity (${maxDeliverable.toFixed(4)}).`
          );
        }

        const rejectedQty = item.rejectedQuantity ? parseFloat(item.rejectedQuantity) : 0;
        const remainingAfter = Math.max(0, maxDeliverable - qtyRequested);

        const lineDto: SalesDeliveryLineDTO = {
          id: crypto.randomUUID(),
          deliveryId,
          salesOrderLineId: orderLine.id,
          tenantId: ctx.tenantId,
          companyId: input.companyId,
          lineNumber: lineNumCounter++,
          productId: orderLine.productId,
          productCodeSnapshot: orderLine.productCodeSnapshot,
          productNameSnapshot: orderLine.productNameSnapshot,
          description: orderLine.description || null,
          uom: orderLine.uom,
          orderedQuantitySnapshot: orderLine.orderedQuantity,
          previouslyDeliveredQuantitySnapshot: prevDeliveredQty.toFixed(4),
          deliveryQuantity: qtyRequested.toFixed(4),
          rejectedQuantity: rejectedQty.toFixed(4),
          remainingQuantitySnapshot: remainingAfter.toFixed(4),
          notes: item.notes || null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        createdLines.push(lineDto);

        // Update in-memory order line delivered quantity
        orderLine.deliveredQuantity = (prevDeliveredQty + qtyRequested).toFixed(4);
      }

      const deliveryDto: SalesDeliveryDTO = {
        id: deliveryId,
        tenantId: ctx.tenantId,
        companyId: input.companyId,
        branchId: input.branchId || null,
        deliveryNumber,
        salesOrderId: order.id,
        salesOrderNumber: order.orderNumber,
        customerId: order.customerId,
        deliveryDate: input.deliveryDate,
        shippingAddressId: order.shippingAddressId,
        shippingAddressSnapshot: order.shippingAddressSnapshot,
        contactId: order.contactId,
        contactSnapshot: order.contactSnapshot,
        warehouseReference: input.warehouseReference || null,
        transporterName: input.transporterName || null,
        vehicleNumber: input.vehicleNumber || null,
        lrNumber: input.lrNumber || null,
        lrDate: input.lrDate || null,
        notes: input.notes || null,
        status: 'DRAFT',
        pickedAt: null,
        pickedBy: null,
        packedAt: null,
        packedBy: null,
        dispatchedAt: null,
        dispatchedBy: null,
        deliveredAt: null,
        deliveredBy: null,
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

      this.memoryStore.set(`${ctx.tenantId}:${input.companyId}:${deliveryId}`, deliveryDto);

      await auditService.logEvent(ctx, {
        module: 'sales',
        entityName: 'SalesDelivery',
        entityId: deliveryId,
        action: 'CREATE',
        newValues: {
          deliveryNumber,
          salesOrderNumber: order.orderNumber,
          status: 'DRAFT',
          lineCount: createdLines.length
        }
      });

      if (idempotencyKey) {
        const cacheKey = `${ctx.tenantId}:${input.companyId}:${idempotencyKey}`;
        this.idempotencyStore.set(cacheKey, deliveryDto);
      }

      return deliveryDto;
    }

    // 2. PostgreSQL Transaction with Row Locking
    const resultDelivery = await db.transaction(async (tx) => {
      // 2a. Lock Sales Order FOR UPDATE
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
        throw new ValidationError(
          `Cannot create Sales Delivery for order in status '${orderRow.status}'. Order must be CONFIRMED or COMPLETED.`
        );
      }

      // 2b. Lock Sales Order Lines FOR UPDATE
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

      // 2c. Query cumulative delivered quantity for each order line across existing non-cancelled deliveries
      const lineIds = dbOrderLines.map(l => l.id);
      const existingDeliveryLines = lineIds.length > 0
        ? await tx
            .select({
              salesOrderLineId: salesDeliveryLines.salesOrderLineId,
              totalDelivered: sql<string>`COALESCE(SUM(${salesDeliveryLines.deliveryQuantity}), 0)`
            })
            .from(salesDeliveryLines)
            .innerJoin(salesDeliveries, eq(salesDeliveryLines.deliveryId, salesDeliveries.id))
            .where(
              and(
                eq(salesDeliveries.tenantId, ctx.tenantId),
                eq(salesDeliveries.companyId, input.companyId),
                eq(salesDeliveries.salesOrderId, input.salesOrderId),
                inArray(salesDeliveryLines.salesOrderLineId, lineIds),
                sql`${salesDeliveries.status} != 'CANCELLED'`
              )
            )
            .groupBy(salesDeliveryLines.salesOrderLineId)
        : [];

      const existingDeliveredQtyMap = new Map<string, number>();
      for (const row of existingDeliveryLines) {
        existingDeliveredQtyMap.set(row.salesOrderLineId, parseFloat(row.totalDelivered || '0'));
      }

      // Generate Delivery Number
      const yearStr = new Date().getFullYear().toString();
      numberingEngine.configureSequence(ctx.tenantId, input.companyId, {
        documentType: 'SALES_DELIVERY',
        prefix: 'DEL',
        fiscalYear: yearStr,
        currentSequence: 0,
        paddingDigits: 4,
        resetOnFiscalYear: true
      });
      const deliveryNumber = numberingEngine.generateNextNumber(ctx.tenantId, input.companyId, 'SALES_DELIVERY', yearStr);
      const deliveryId = crypto.randomUUID();

      // Insert Sales Delivery Header
      await tx.insert(salesDeliveries).values({
        id: deliveryId,
        tenantId: ctx.tenantId,
        companyId: input.companyId,
        branchId: input.branchId || null,
        deliveryNumber,
        salesOrderId: orderRow.id,
        salesOrderNumber: orderRow.orderNumber,
        customerId: orderRow.customerId,
        deliveryDate: input.deliveryDate,
        shippingAddressId: orderRow.shippingAddressId,
        shippingAddressSnapshot: orderRow.shippingAddressSnapshot,
        contactId: orderRow.contactId,
        contactSnapshot: orderRow.contactSnapshot,
        warehouseReference: input.warehouseReference || null,
        transporterName: input.transporterName || null,
        vehicleNumber: input.vehicleNumber || null,
        lrNumber: input.lrNumber || null,
        lrDate: input.lrDate || null,
        notes: input.notes || null,
        status: 'DRAFT',
        version: 1,
        createdBy: userId,
        updatedBy: userId
      });

      const insertedLines: SalesDeliveryLineDTO[] = [];
      let lineNumCounter = 1;

      for (const item of input.lines) {
        const orderLine = dbOrderLines.find(l => l.id === item.salesOrderLineId);
        if (!orderLine) {
          throw new NotFoundError(`Sales Order Line '${item.salesOrderLineId}' not found on order '${orderRow.id}'.`);
        }

        const qtyRequested = parseFloat(item.deliveryQuantity);
        if (isNaN(qtyRequested) || qtyRequested <= 0) {
          throw new ValidationError(`Delivery quantity for product '${orderLine.productCodeSnapshot}' must be greater than zero.`);
        }

        const orderedQty = parseFloat(orderLine.orderedQuantity);
        const cancelledQty = parseFloat(orderLine.cancelledQuantity || '0');
        const prevDeliveredQty = existingDeliveredQtyMap.get(orderLine.id) || 0;
        const maxDeliverable = orderedQty - cancelledQty - prevDeliveredQty;

        if (qtyRequested > maxDeliverable + 0.0001) {
          throw new ValidationError(
            `OVER_DELIVERY_EXCEEDED: Requested delivery quantity (${qtyRequested}) for product '${orderLine.productCodeSnapshot}' exceeds remaining deliverable quantity (${maxDeliverable.toFixed(4)}).`
          );
        }

        const rejectedQty = item.rejectedQuantity ? parseFloat(item.rejectedQuantity) : 0;
        const newTotalDelivered = prevDeliveredQty + qtyRequested;
        const remainingAfter = Math.max(0, maxDeliverable - qtyRequested);
        const lineId = crypto.randomUUID();

        await tx.insert(salesDeliveryLines).values({
          id: lineId,
          deliveryId,
          salesOrderLineId: orderLine.id,
          tenantId: ctx.tenantId,
          companyId: input.companyId,
          lineNumber: lineNumCounter++,
          productId: orderLine.productId,
          productCodeSnapshot: orderLine.productCodeSnapshot,
          productNameSnapshot: orderLine.productNameSnapshot,
          description: orderLine.description || null,
          uom: orderLine.uom,
          orderedQuantitySnapshot: orderLine.orderedQuantity,
          previouslyDeliveredQuantitySnapshot: prevDeliveredQty.toFixed(4),
          deliveryQuantity: qtyRequested.toFixed(4),
          rejectedQuantity: rejectedQty.toFixed(4),
          remainingQuantitySnapshot: remainingAfter.toFixed(4),
          notes: item.notes || null,
          version: 1
        });

        // Atomically update sales_order_lines deliveredQuantity
        await tx
          .update(salesOrderLines)
          .set({
            deliveredQuantity: newTotalDelivered.toFixed(4),
            updatedAt: new Date()
          })
          .where(eq(salesOrderLines.id, orderLine.id));

        insertedLines.push({
          id: lineId,
          deliveryId,
          salesOrderLineId: orderLine.id,
          tenantId: ctx.tenantId,
          companyId: input.companyId,
          lineNumber: lineNumCounter - 1,
          productId: orderLine.productId,
          productCodeSnapshot: orderLine.productCodeSnapshot,
          productNameSnapshot: orderLine.productNameSnapshot,
          description: orderLine.description || null,
          uom: orderLine.uom,
          orderedQuantitySnapshot: orderLine.orderedQuantity,
          previouslyDeliveredQuantitySnapshot: prevDeliveredQty.toFixed(4),
          deliveryQuantity: qtyRequested.toFixed(4),
          rejectedQuantity: rejectedQty.toFixed(4),
          remainingQuantitySnapshot: remainingAfter.toFixed(4),
          notes: item.notes || null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }

      const deliveryDto: SalesDeliveryDTO = {
        id: deliveryId,
        tenantId: ctx.tenantId,
        companyId: input.companyId,
        branchId: input.branchId || null,
        deliveryNumber,
        salesOrderId: orderRow.id,
        salesOrderNumber: orderRow.orderNumber,
        customerId: orderRow.customerId,
        deliveryDate: input.deliveryDate,
        shippingAddressId: orderRow.shippingAddressId,
        shippingAddressSnapshot: (orderRow.shippingAddressSnapshot as unknown) as Record<string, any>,
        contactId: orderRow.contactId,
        contactSnapshot: (orderRow.contactSnapshot as unknown) as Record<string, any> | null,
        warehouseReference: input.warehouseReference || null,
        transporterName: input.transporterName || null,
        vehicleNumber: input.vehicleNumber || null,
        lrNumber: input.lrNumber || null,
        lrDate: input.lrDate || null,
        notes: input.notes || null,
        status: 'DRAFT',
        pickedAt: null,
        pickedBy: null,
        packedAt: null,
        packedBy: null,
        dispatchedAt: null,
        dispatchedBy: null,
        deliveredAt: null,
        deliveredBy: null,
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

      return deliveryDto;
    });

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesDelivery',
      entityId: resultDelivery.id,
      action: 'CREATE',
      newValues: {
        deliveryNumber: resultDelivery.deliveryNumber,
        salesOrderNumber: resultDelivery.salesOrderNumber,
        status: 'DRAFT',
        lineCount: resultDelivery.lines.length
      }
    });

    if (idempotencyKey) {
      const cacheKey = `${ctx.tenantId}:${input.companyId}:${idempotencyKey}`;
      this.idempotencyStore.set(cacheKey, resultDelivery);
    }

    return resultDelivery;
  }

  /**
   * Retrieves a Sales Delivery by ID.
   */
  public async getDeliveryById(ctx: RequestContext, deliveryId: string): Promise<SalesDeliveryDTO> {
    this.checkPermission(ctx, 'sales:delivery:read');

    const db = getDb();
    if (!db) {
      for (const del of this.memoryStore.values()) {
        if (del.id === deliveryId && del.tenantId === ctx.tenantId) {
          return del;
        }
      }
      throw new NotFoundError(`Sales Delivery '${deliveryId}' not found.`);
    }

    const [header] = await db
      .select()
      .from(salesDeliveries)
      .where(and(eq(salesDeliveries.id, deliveryId), eq(salesDeliveries.tenantId, ctx.tenantId)));

    if (!header) {
      throw new NotFoundError(`Sales Delivery '${deliveryId}' not found.`);
    }

    const dbLines = await db
      .select()
      .from(salesDeliveryLines)
      .where(eq(salesDeliveryLines.deliveryId, deliveryId));

    const lines: SalesDeliveryLineDTO[] = dbLines.map(l => ({
      id: l.id,
      deliveryId: l.deliveryId,
      salesOrderLineId: l.salesOrderLineId,
      tenantId: l.tenantId,
      companyId: l.companyId,
      lineNumber: l.lineNumber,
      productId: l.productId,
      productCodeSnapshot: l.productCodeSnapshot,
      productNameSnapshot: l.productNameSnapshot,
      description: l.description,
      uom: l.uom,
      orderedQuantitySnapshot: l.orderedQuantitySnapshot,
      previouslyDeliveredQuantitySnapshot: l.previouslyDeliveredQuantitySnapshot,
      deliveryQuantity: l.deliveryQuantity,
      rejectedQuantity: l.rejectedQuantity,
      remainingQuantitySnapshot: l.remainingQuantitySnapshot,
      notes: l.notes,
      version: l.version,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt
    }));

    return {
      id: header.id,
      tenantId: header.tenantId,
      companyId: header.companyId,
      branchId: header.branchId,
      deliveryNumber: header.deliveryNumber,
      salesOrderId: header.salesOrderId,
      salesOrderNumber: header.salesOrderNumber,
      customerId: header.customerId,
      deliveryDate: header.deliveryDate,
      shippingAddressId: header.shippingAddressId,
      shippingAddressSnapshot: (header.shippingAddressSnapshot as unknown) as Record<string, any>,
      contactId: header.contactId,
      contactSnapshot: (header.contactSnapshot as unknown) as Record<string, any> | null,
      warehouseReference: header.warehouseReference,
      transporterName: header.transporterName,
      vehicleNumber: header.vehicleNumber,
      lrNumber: header.lrNumber,
      lrDate: header.lrDate,
      notes: header.notes,
      status: header.status as any,
      pickedAt: header.pickedAt,
      pickedBy: header.pickedBy,
      packedAt: header.packedAt,
      packedBy: header.packedBy,
      dispatchedAt: header.dispatchedAt,
      dispatchedBy: header.dispatchedBy,
      deliveredAt: header.deliveredAt,
      deliveredBy: header.deliveredBy,
      cancelledAt: header.cancelledAt,
      cancelledBy: header.cancelledBy,
      cancellationReason: header.cancellationReason,
      version: header.version,
      createdAt: header.createdAt,
      updatedAt: header.updatedAt,
      createdBy: header.createdBy,
      updatedBy: header.updatedBy,
      lines
    };
  }

  /**
   * Lists Sales Deliveries with filtering and pagination.
   */
  public async listDeliveries(
    ctx: RequestContext,
    params: ListSalesDeliveriesParams
  ): Promise<{ data: SalesDeliveryDTO[]; total: number; page: number; limit: number }> {
    this.checkPermission(ctx, 'sales:delivery:read');
    const page = params.page && params.page > 0 ? params.page : 1;
    const limit = params.limit && params.limit > 0 ? params.limit : 50;

    const db = getDb();
    if (!db) {
      let filtered = Array.from(this.memoryStore.values()).filter(
        d => d.tenantId === ctx.tenantId && d.companyId === params.companyId
      );
      if (params.status) filtered = filtered.filter(d => d.status === params.status);
      if (params.customerId) filtered = filtered.filter(d => d.customerId === params.customerId);
      if (params.salesOrderId) filtered = filtered.filter(d => d.salesOrderId === params.salesOrderId);
      if (params.search) {
        const s = params.search.toLowerCase();
        filtered = filtered.filter(
          d =>
            d.deliveryNumber.toLowerCase().includes(s) ||
            d.salesOrderNumber.toLowerCase().includes(s) ||
            (d.transporterName && d.transporterName.toLowerCase().includes(s)) ||
            (d.lrNumber && d.lrNumber.toLowerCase().includes(s))
        );
      }

      const total = filtered.length;
      const start = (page - 1) * limit;
      const data = filtered.slice(start, start + limit);
      return { data, total, page, limit };
    }

    const conditions = [
      eq(salesDeliveries.tenantId, ctx.tenantId),
      eq(salesDeliveries.companyId, params.companyId)
    ];

    if (params.status) conditions.push(eq(salesDeliveries.status, params.status));
    if (params.customerId) conditions.push(eq(salesDeliveries.customerId, params.customerId));
    if (params.salesOrderId) conditions.push(eq(salesDeliveries.salesOrderId, params.salesOrderId));
    if (params.search) {
      const term = `%${params.search}%`;
      conditions.push(
        or(
          ilike(salesDeliveries.deliveryNumber, term),
          ilike(salesDeliveries.salesOrderNumber, term),
          ilike(salesDeliveries.transporterName, term),
          ilike(salesDeliveries.lrNumber, term)
        )!
      );
    }

    const whereClause = and(...conditions);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(salesDeliveries)
      .where(whereClause);

    const total = Number(countResult?.count || 0);

    const rows = await db
      .select()
      .from(salesDeliveries)
      .where(whereClause)
      .limit(limit)
      .offset((page - 1) * limit);

    const data: SalesDeliveryDTO[] = [];
    for (const r of rows) {
      const lines = await db
        .select()
        .from(salesDeliveryLines)
        .where(eq(salesDeliveryLines.deliveryId, r.id));

      data.push({
        id: r.id,
        tenantId: r.tenantId,
        companyId: r.companyId,
        branchId: r.branchId,
        deliveryNumber: r.deliveryNumber,
        salesOrderId: r.salesOrderId,
        salesOrderNumber: r.salesOrderNumber,
        customerId: r.customerId,
        deliveryDate: r.deliveryDate,
        shippingAddressId: r.shippingAddressId,
        shippingAddressSnapshot: (r.shippingAddressSnapshot as unknown) as Record<string, any>,
        contactId: r.contactId,
        contactSnapshot: (r.contactSnapshot as unknown) as Record<string, any> | null,
        warehouseReference: r.warehouseReference,
        transporterName: r.transporterName,
        vehicleNumber: r.vehicleNumber,
        lrNumber: r.lrNumber,
        lrDate: r.lrDate,
        notes: r.notes,
        status: r.status as any,
        pickedAt: r.pickedAt,
        pickedBy: r.pickedBy,
        packedAt: r.packedAt,
        packedBy: r.packedBy,
        dispatchedAt: r.dispatchedAt,
        dispatchedBy: r.dispatchedBy,
        deliveredAt: r.deliveredAt,
        deliveredBy: r.deliveredBy,
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
          deliveryId: l.deliveryId,
          salesOrderLineId: l.salesOrderLineId,
          tenantId: l.tenantId,
          companyId: l.companyId,
          lineNumber: l.lineNumber,
          productId: l.productId,
          productCodeSnapshot: l.productCodeSnapshot,
          productNameSnapshot: l.productNameSnapshot,
          description: l.description,
          uom: l.uom,
          orderedQuantitySnapshot: l.orderedQuantitySnapshot,
          previouslyDeliveredQuantitySnapshot: l.previouslyDeliveredQuantitySnapshot,
          deliveryQuantity: l.deliveryQuantity,
          rejectedQuantity: l.rejectedQuantity,
          remainingQuantitySnapshot: l.remainingQuantitySnapshot,
          notes: l.notes,
          version: l.version,
          createdAt: l.createdAt,
          updatedAt: l.updatedAt
        }))
      });
    }

    return { data, total, page, limit };
  }

  /**
   * Updates a DRAFT Sales Delivery.
   */
  public async updateDraftDelivery(
    ctx: RequestContext,
    deliveryId: string,
    input: UpdateSalesDeliveryInput
  ): Promise<SalesDeliveryDTO> {
    this.checkPermission(ctx, 'sales:delivery:update');

    const delivery = await this.getDeliveryById(ctx, deliveryId);
    if (delivery.status !== 'DRAFT') {
      throw new ValidationError(`Cannot update Sales Delivery in status '${delivery.status}'. Delivery must be DRAFT.`);
    }

    if (input.deliveryDate) delivery.deliveryDate = input.deliveryDate;
    if (input.warehouseReference !== undefined) delivery.warehouseReference = input.warehouseReference;
    if (input.transporterName !== undefined) delivery.transporterName = input.transporterName;
    if (input.vehicleNumber !== undefined) delivery.vehicleNumber = input.vehicleNumber;
    if (input.lrNumber !== undefined) delivery.lrNumber = input.lrNumber;
    if (input.lrDate !== undefined) delivery.lrDate = input.lrDate;
    if (input.notes !== undefined) delivery.notes = input.notes;

    delivery.updatedAt = new Date();
    const db = getDb();
    if (!db) {
      this.memoryStore.set(`${ctx.tenantId}:${delivery.companyId}:${deliveryId}`, delivery);
      return delivery;
    }

    await db
      .update(salesDeliveries)
      .set({
        deliveryDate: delivery.deliveryDate,
        warehouseReference: delivery.warehouseReference,
        transporterName: delivery.transporterName,
        vehicleNumber: delivery.vehicleNumber,
        lrNumber: delivery.lrNumber,
        lrDate: delivery.lrDate,
        notes: delivery.notes,
        updatedAt: new Date()
      })
      .where(eq(salesDeliveries.id, deliveryId));

    return delivery;
  }

  /**
   * Transition: DRAFT -> PICKED
   */
  public async pickDelivery(ctx: RequestContext, deliveryId: string): Promise<SalesDeliveryDTO> {
    this.checkPermission(ctx, 'sales:delivery:pick');
    const delivery = await this.getDeliveryById(ctx, deliveryId);
    if (delivery.status !== 'DRAFT') {
      throw new ValidationError(`Cannot transition to PICKED from state '${delivery.status}'. Delivery must be DRAFT.`);
    }

    const userId = ctx.user?.userId || '00000000-0000-0000-0000-000000000000';
    delivery.status = 'PICKED';
    delivery.pickedAt = new Date();
    delivery.pickedBy = userId;
    delivery.updatedAt = new Date();

    const db = getDb();
    if (!db) {
      this.memoryStore.set(`${ctx.tenantId}:${delivery.companyId}:${deliveryId}`, delivery);
    } else {
      await db
        .update(salesDeliveries)
        .set({
          status: 'PICKED',
          pickedAt: delivery.pickedAt,
          pickedBy: delivery.pickedBy,
          updatedAt: new Date()
        })
        .where(eq(salesDeliveries.id, deliveryId));
    }

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesDelivery',
      entityId: deliveryId,
      action: 'PICK',
      newValues: { status: 'PICKED', pickedBy: userId }
    });

    return delivery;
  }

  /**
   * Transition: PICKED / DRAFT -> PACKED
   */
  public async packDelivery(ctx: RequestContext, deliveryId: string): Promise<SalesDeliveryDTO> {
    this.checkPermission(ctx, 'sales:delivery:pack');
    const delivery = await this.getDeliveryById(ctx, deliveryId);
    if (delivery.status !== 'DRAFT' && delivery.status !== 'PICKED') {
      throw new ValidationError(`Cannot transition to PACKED from state '${delivery.status}'. Delivery must be DRAFT or PICKED.`);
    }

    const userId = ctx.user?.userId || '00000000-0000-0000-0000-000000000000';
    delivery.status = 'PACKED';
    delivery.packedAt = new Date();
    delivery.packedBy = userId;
    delivery.updatedAt = new Date();

    const db = getDb();
    if (!db) {
      this.memoryStore.set(`${ctx.tenantId}:${delivery.companyId}:${deliveryId}`, delivery);
    } else {
      await db
        .update(salesDeliveries)
        .set({
          status: 'PACKED',
          packedAt: delivery.packedAt,
          packedBy: delivery.packedBy,
          updatedAt: new Date()
        })
        .where(eq(salesDeliveries.id, deliveryId));
    }

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesDelivery',
      entityId: deliveryId,
      action: 'PACK',
      newValues: { status: 'PACKED', packedBy: userId }
    });

    return delivery;
  }

  /**
   * Transition: PACKED / PICKED / DRAFT -> DISPATCHED
   */
  public async dispatchDelivery(ctx: RequestContext, deliveryId: string): Promise<SalesDeliveryDTO> {
    this.checkPermission(ctx, 'sales:delivery:dispatch');
    const delivery = await this.getDeliveryById(ctx, deliveryId);
    if (delivery.status === 'DISPATCHED' || delivery.status === 'DELIVERED' || delivery.status === 'CANCELLED') {
      throw new ValidationError(`Cannot dispatch Sales Delivery in state '${delivery.status}'.`);
    }

    const userId = ctx.user?.userId || '00000000-0000-0000-0000-000000000000';
    delivery.status = 'DISPATCHED';
    delivery.dispatchedAt = new Date();
    delivery.dispatchedBy = userId;
    delivery.updatedAt = new Date();

    const db = getDb();
    if (!db) {
      this.memoryStore.set(`${ctx.tenantId}:${delivery.companyId}:${deliveryId}`, delivery);
    } else {
      await db
        .update(salesDeliveries)
        .set({
          status: 'DISPATCHED',
          dispatchedAt: delivery.dispatchedAt,
          dispatchedBy: delivery.dispatchedBy,
          updatedAt: new Date()
        })
        .where(eq(salesDeliveries.id, deliveryId));
    }

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesDelivery',
      entityId: deliveryId,
      action: 'DISPATCH',
      newValues: { status: 'DISPATCHED', dispatchedBy: userId, deliveryNumber: delivery.deliveryNumber }
    });

    await notificationEngine.sendNotification(ctx, {
      channels: ['IN_APP'],
      recipientId: userId,
      title: `Sales Delivery Dispatched: ${delivery.deliveryNumber}`,
      body: `Delivery ${delivery.deliveryNumber} for Sales Order ${delivery.salesOrderNumber} has been dispatched.`,
      data: { deliveryId: delivery.id, deliveryNumber: delivery.deliveryNumber }
    });

    return delivery;
  }

  /**
   * Transition: DISPATCHED -> DELIVERED
   */
  public async markDelivered(ctx: RequestContext, deliveryId: string): Promise<SalesDeliveryDTO> {
    this.checkPermission(ctx, 'sales:delivery:deliver');
    const delivery = await this.getDeliveryById(ctx, deliveryId);
    if (delivery.status === 'DELIVERED' || delivery.status === 'CANCELLED') {
      throw new ValidationError(`Cannot mark delivery DELIVERED from state '${delivery.status}'.`);
    }

    const userId = ctx.user?.userId || '00000000-0000-0000-0000-000000000000';
    delivery.status = 'DELIVERED';
    delivery.deliveredAt = new Date();
    delivery.deliveredBy = userId;
    delivery.updatedAt = new Date();

    const db = getDb();
    if (!db) {
      this.memoryStore.set(`${ctx.tenantId}:${delivery.companyId}:${deliveryId}`, delivery);
    } else {
      await db
        .update(salesDeliveries)
        .set({
          status: 'DELIVERED',
          deliveredAt: delivery.deliveredAt,
          deliveredBy: delivery.deliveredBy,
          updatedAt: new Date()
        })
        .where(eq(salesDeliveries.id, deliveryId));
    }

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesDelivery',
      entityId: deliveryId,
      action: 'DELIVER',
      newValues: { status: 'DELIVERED', deliveredBy: userId }
    });

    return delivery;
  }

  /**
   * Transition: DRAFT / PICKED / PACKED -> CANCELLED
   */
  public async cancelDelivery(ctx: RequestContext, deliveryId: string, reason: string): Promise<SalesDeliveryDTO> {
    this.checkPermission(ctx, 'sales:delivery:cancel');
    if (!reason || reason.trim().length === 0) {
      throw new ValidationError('Cancellation reason is required when cancelling a Sales Delivery.');
    }

    const delivery = await this.getDeliveryById(ctx, deliveryId);
    if (delivery.status === 'DELIVERED') {
      throw new ValidationError('Cannot cancel a Sales Delivery that has already been DELIVERED.');
    }
    if (delivery.status === 'DISPATCHED') {
      throw new ValidationError('Cannot cancel a Sales Delivery that has already been DISPATCHED.');
    }
    if (delivery.status === 'CANCELLED') {
      return delivery;
    }

    const userId = ctx.user?.userId || '00000000-0000-0000-0000-000000000000';
    const db = getDb();

    if (!db) {
      // Release delivered quantity on order lines in memory
      const order = await salesOrderService.getOrderById(ctx, delivery.salesOrderId);
      for (const line of delivery.lines) {
        const orderLine = order.lines.find(l => l.id === line.salesOrderLineId);
        if (orderLine) {
          const currentDelivered = parseFloat(orderLine.deliveredQuantity || '0');
          const releaseQty = parseFloat(line.deliveryQuantity);
          const newDelivered = Math.max(0, currentDelivered - releaseQty);
          orderLine.deliveredQuantity = newDelivered.toFixed(4);
        }
      }

      delivery.status = 'CANCELLED';
      delivery.cancelledAt = new Date();
      delivery.cancelledBy = userId;
      delivery.cancellationReason = reason;
      delivery.updatedAt = new Date();

      this.memoryStore.set(`${ctx.tenantId}:${delivery.companyId}:${deliveryId}`, delivery);
    } else {
      await db.transaction(async (tx) => {
        // Lock sales_order_lines FOR UPDATE
        const dbOrderLines = await tx
          .select()
          .from(salesOrderLines)
          .where(
            and(
              eq(salesOrderLines.orderId, delivery.salesOrderId),
              eq(salesOrderLines.tenantId, ctx.tenantId),
              eq(salesOrderLines.companyId, delivery.companyId)
            )
          )
          .for('update');

        for (const line of delivery.lines) {
          const orderLine = dbOrderLines.find(l => l.id === line.salesOrderLineId);
          if (orderLine) {
            const currentDelivered = parseFloat(orderLine.deliveredQuantity || '0');
            const releaseQty = parseFloat(line.deliveryQuantity);
            const newDelivered = Math.max(0, currentDelivered - releaseQty);

            await tx
              .update(salesOrderLines)
              .set({
                deliveredQuantity: newDelivered.toFixed(4),
                updatedAt: new Date()
              })
              .where(eq(salesOrderLines.id, orderLine.id));
          }
        }

        await tx
          .update(salesDeliveries)
          .set({
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancelledBy: userId,
            cancellationReason: reason,
            updatedAt: new Date()
          })
          .where(eq(salesDeliveries.id, deliveryId));
      });

      delivery.status = 'CANCELLED';
      delivery.cancelledAt = new Date();
      delivery.cancelledBy = userId;
      delivery.cancellationReason = reason;
      delivery.updatedAt = new Date();
    }

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesDelivery',
      entityId: deliveryId,
      action: 'CANCEL',
      newValues: { status: 'CANCELLED', cancelledBy: userId, cancellationReason: reason }
    });

    return delivery;
  }

  /**
   * Retrieves order fulfillment summary for a given Sales Order.
   */
  public async getOrderFulfillment(ctx: RequestContext, orderId: string): Promise<OrderFulfillmentSummaryDTO> {
    this.checkPermission(ctx, 'sales:delivery:read');

    const order = await salesOrderService.getOrderById(ctx, orderId);

    let totalLines = order.lines.length;
    let fullyDeliveredLines = 0;
    let partiallyDeliveredLines = 0;
    let undeliveredLines = 0;

    const lineSummaries: OrderFulfillmentLineSummary[] = [];

    for (const l of order.lines) {
      const ordered = parseFloat(l.orderedQuantity);
      const delivered = parseFloat(l.deliveredQuantity || '0');
      const cancelled = parseFloat(l.cancelledQuantity || '0');
      const netDeliverable = Math.max(0, ordered - cancelled);
      const remaining = Math.max(0, netDeliverable - delivered);

      let pct = 0;
      if (netDeliverable > 0) {
        pct = Math.min(100, Math.round((delivered / netDeliverable) * 100));
      } else if (delivered >= ordered) {
        pct = 100;
      }

      if (remaining === 0 && netDeliverable > 0) {
        fullyDeliveredLines++;
      } else if (delivered > 0) {
        partiallyDeliveredLines++;
      } else {
        undeliveredLines++;
      }

      lineSummaries.push({
        salesOrderLineId: l.id,
        lineNumber: l.lineNumber,
        productId: l.productId,
        productCode: l.productCodeSnapshot,
        productName: l.productNameSnapshot,
        uom: l.uom,
        orderedQuantity: l.orderedQuantity,
        deliveredQuantity: l.deliveredQuantity || '0.0000',
        cancelledQuantity: l.cancelledQuantity || '0.0000',
        remainingQuantity: remaining.toFixed(4),
        fulfillmentPercent: pct.toString()
      });
    }

    const overallPct = totalLines > 0 ? Math.round((fullyDeliveredLines / totalLines) * 100).toString() : '0';

    return {
      salesOrderId: order.id,
      salesOrderNumber: order.orderNumber,
      status: order.status,
      totalLines,
      fullyDeliveredLines,
      partiallyDeliveredLines,
      undeliveredLines,
      overallFulfillmentPercent: overallPct,
      lines: lineSummaries
    };
  }
}

export const salesDeliveryService = new SalesDeliveryService();
