import crypto from 'crypto';
import {
  RequestContext,
  ValidationError,
  ForbiddenError,
  NotFoundError,
  ConflictError
} from '@general-erp/core';
import { auditService } from '../../platform/audit/audit.service.js';
import { numberingEngine } from '../../platform/numbering/numbering.service.js';
import { notificationEngine } from '../../platform/notifications/notification.service.js';
import { QuotationConversionContract, quotationService } from './quotation.service.js';
import { customerService } from '../commercial/customer.service.js';
import {
  getDb,
  salesOrders,
  salesOrderLines,
  salesQuotations,
  customers,
  arOpenItems,
  arReceipts,
  eq,
  and,
  ilike,
  or,
  sql,
  inArray
} from '@general-erp/database';

export interface SalesOrderLineDTO {
  id: string;
  orderId: string;
  quotationLineId: string;
  tenantId: string;
  companyId: string;
  lineNumber: number;
  productId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  description: string | null;
  uom: string;
  orderedQuantity: string;
  deliveredQuantity: string;
  invoicedQuantity: string;
  cancelledQuantity: string;
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
  pricingSource: string;
  pricingRuleId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SalesOrderDTO {
  id: string;
  tenantId: string;
  companyId: string;
  orderNumber: string;
  quotationId: string;
  quotationNumber: string;
  revisionNumber: number;
  conversionContractId: string;
  customerId: string;
  orderDate: string;
  currency: string;
  exchangeRate: string;
  salesRepresentativeId: string | null;
  billingAddressId: string;
  shippingAddressId: string;
  billingAddressSnapshot: Record<string, any>;
  shippingAddressSnapshot: Record<string, any>;
  contactId: string | null;
  contactSnapshot: Record<string, any> | null;
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
  notes: string | null;
  termsAndConditions: string | null;
  subtotalAmount: string;
  headerDiscountAmount: string;
  discountAmount: string;
  taxableAmount: string;
  taxAmount: string;
  totalAmount: string;
  totalAmountBase: string;
  creditOverrideBy: string | null;
  creditOverrideReason: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
  lines: SalesOrderLineDTO[];
}

export interface ListSalesOrdersParams {
  companyId: string;
  status?: string | undefined;
  customerId?: string | undefined;
  search?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

export class SalesOrderService {
  private memoryStore = new Map<string, SalesOrderDTO>();
  private idempotencyStore = new Map<string, SalesOrderDTO>();

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
   * Converts an accepted QuotationConversionContract into a Sales Order atomically.
   */
  public async createFromContract(
    ctx: RequestContext,
    contract: QuotationConversionContract,
    idempotencyKey?: string
  ): Promise<SalesOrderDTO> {
    this.checkPermission(ctx, 'sales:order:create');

    // 1. HTTP Request-level Idempotency Check
    if (idempotencyKey) {
      const cacheKey = `${ctx.tenantId}:${ctx.companyId}:${idempotencyKey}`;
      const cached = this.idempotencyStore.get(cacheKey);
      if (cached) return cached;
    }

    // 2. Validate Tenant and Company Scope
    if (contract.tenantId !== ctx.tenantId || contract.companyId !== ctx.companyId) {
      throw new ValidationError('Cross-tenant or cross-company contract consumption is strictly prohibited.');
    }

    // 3. Validate Contract Payload Hash Digest
    const payloadLines = contract.lines.map(l => ({
      quotationLineId: l.quotationLineId,
      lineNumber: l.lineNumber,
      productId: l.productId,
      productCodeSnapshot: l.productCodeSnapshot,
      productNameSnapshot: l.productNameSnapshot,
      description: l.description || null,
      uom: l.uom,
      quantity: l.quantity,
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
      pricingSource: l.pricingSource,
      pricingRuleId: l.pricingRuleId || null
    }));

    const rawDigest = JSON.stringify({
      quotationNumber: contract.quotationNumber,
      revisionNumber: contract.revisionNumber,
      customerId: contract.customerId,
      totalAmount: contract.totalAmount,
      lines: payloadLines
    });
    const calculatedHash = crypto.createHash('sha256').update(rawDigest).digest('hex');

    if (calculatedHash !== contract.contractHash) {
      throw new ValidationError('Invalid QuotationConversionContract: Payload SHA-256 hash digest mismatch.');
    }

    const userId = ctx.user?.userId || (ctx as any).userId || '00000000-0000-0000-0000-000000000000';
    const db = getDb();

    if (!db) {
      for (const ord of this.memoryStore.values()) {
        if (ord.tenantId === ctx.tenantId && ord.companyId === ctx.companyId && ord.conversionContractId === contract.contractId) {
          throw new ConflictError(
            `CONVERSION_CONTRACT_ALREADY_CONSUMED: Conversion contract '${contract.contractId}' has already been consumed into a Sales Order.`
          );
        }
      }

      const quotation = await quotationService.getQuotation(ctx, contract.quotationId);
      if (quotation.status === 'CONVERTED') {
        throw new ConflictError(
          `CONVERSION_CONTRACT_ALREADY_CONSUMED: Conversion contract '${contract.contractId}' has already been consumed into a Sales Order.`
        );
      }
      if (quotation.status !== 'ACCEPTED') {
        throw new ValidationError(
          `Cannot consume conversion contract for quotation in state '${quotation.status}'. Quotation must be ACCEPTED.`
        );
      }
      if (quotation.conversionContractId !== contract.contractId) {
        throw new ValidationError(
          `Quotation conversion_contract_id mismatch. Stored: '${quotation.conversionContractId}', Supplied: '${contract.contractId}'.`
        );
      }
      if (
        quotation.revisionNumber !== contract.revisionNumber ||
        quotation.quotationNumber !== contract.quotationNumber
      ) {
        throw new ValidationError('Quotation revision or number mismatch against conversion contract payload.');
      }

      const yearStr = new Date().getFullYear().toString();
      numberingEngine.configureSequence(ctx.tenantId, ctx.companyId, {
        documentType: 'SALES_ORDER',
        prefix: 'SO',
        fiscalYear: yearStr,
        currentSequence: 0,
        paddingDigits: 4,
        resetOnFiscalYear: true
      });
      const orderNumber = numberingEngine.generateNextNumber(ctx.tenantId, ctx.companyId, 'SALES_ORDER', yearStr);
      const todayStr = new Date().toISOString().split('T')[0]!;
      const orderId = crypto.randomUUID();

      const insertedLines: SalesOrderLineDTO[] = contract.lines.map(line => ({
        id: crypto.randomUUID(),
        orderId,
        quotationLineId: line.quotationLineId,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        lineNumber: line.lineNumber,
        productId: line.productId,
        productCodeSnapshot: line.productCodeSnapshot,
        productNameSnapshot: line.productNameSnapshot,
        description: line.description || null,
        uom: line.uom,
        orderedQuantity: line.quantity,
        deliveredQuantity: '0.0000',
        invoicedQuantity: '0.0000',
        cancelledQuantity: '0.0000',
        unitPrice: line.unitPrice,
        discountPercent: line.discountPercent,
        discountAmount: line.discountAmount,
        allocatedHeaderDiscountAmount: line.allocatedHeaderDiscountAmount,
        grossAmount: line.grossAmount,
        taxableAmount: line.taxableAmount,
        hsnSac: line.hsnSac,
        cgstRate: line.cgstRate,
        cgstAmount: line.cgstAmount,
        sgstRate: line.sgstRate,
        sgstAmount: line.sgstAmount,
        igstRate: line.igstRate,
        igstAmount: line.igstAmount,
        taxAmount: line.taxAmount,
        lineTotal: line.lineTotal,
        pricingSource: line.pricingSource,
        pricingRuleId: line.pricingRuleId || null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      }));

      const orderDTO: SalesOrderDTO = {
        id: orderId,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        orderNumber,
        quotationId: contract.quotationId,
        quotationNumber: contract.quotationNumber,
        revisionNumber: contract.revisionNumber,
        conversionContractId: contract.contractId,
        customerId: contract.customerId,
        orderDate: todayStr,
        currency: contract.currency,
        exchangeRate: contract.exchangeRate,
        salesRepresentativeId: contract.salesRepresentativeId,
        billingAddressId: contract.billingAddressId,
        shippingAddressId: contract.shippingAddressId,
        billingAddressSnapshot: contract.billingAddressSnapshot,
        shippingAddressSnapshot: contract.shippingAddressSnapshot,
        contactId: contract.contactId,
        contactSnapshot: contract.contactSnapshot,
        status: 'DRAFT',
        notes: null,
        termsAndConditions: contract.termsAndConditions,
        subtotalAmount: contract.subtotalAmount,
        headerDiscountAmount: contract.headerDiscountAmount,
        discountAmount: contract.discountAmount,
        taxableAmount: contract.taxableAmount,
        taxAmount: contract.taxAmount,
        totalAmount: contract.totalAmount,
        totalAmountBase: contract.totalAmountBase,
        creditOverrideBy: null,
        creditOverrideReason: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: userId,
        updatedBy: userId,
        lines: insertedLines
      };

      quotation.status = 'CONVERTED';
      this.memoryStore.set(`${ctx.tenantId}:${ctx.companyId}:${orderId}`, orderDTO);

      await auditService.logEvent(ctx, {
        module: 'sales',
        entityName: 'SalesOrder',
        entityId: orderId,
        action: 'CREATE_FROM_CONTRACT',
        newValues: {
          orderNumber,
          quotationNumber: contract.quotationNumber,
          conversionContractId: contract.contractId,
          totalAmount: contract.totalAmount
        }
      });

      if (idempotencyKey) {
        const cacheKey = `${ctx.tenantId}:${ctx.companyId}:${idempotencyKey}`;
        this.idempotencyStore.set(cacheKey, orderDTO);
      }

      return orderDTO;
    }

    // 4. Atomic PostgreSQL Transaction
    const resultOrder = await db.transaction(async (tx) => {
      // 4a. Lock Quotation Row FOR UPDATE
      const [quotationRow] = await tx
        .select()
        .from(salesQuotations)
        .where(
          and(
            eq(salesQuotations.id, contract.quotationId),
            eq(salesQuotations.tenantId, ctx.tenantId),
            eq(salesQuotations.companyId, ctx.companyId)
          )
        )
        .for('update');

      if (!quotationRow) {
        throw new NotFoundError(`Quotation '${contract.quotationId}' not found.`);
      }

      if (quotationRow.status === 'CONVERTED') {
        throw new ConflictError(
          `CONVERSION_CONTRACT_ALREADY_CONSUMED: Conversion contract '${contract.contractId}' has already been consumed into a Sales Order.`
        );
      }

      if (quotationRow.status !== 'ACCEPTED') {
        throw new ValidationError(
          `Cannot consume conversion contract for quotation in state '${quotationRow.status}'. Quotation must be ACCEPTED.`
        );
      }

      if (quotationRow.conversionContractId !== contract.contractId) {
        throw new ValidationError(
          `Quotation conversion_contract_id mismatch. Stored: '${quotationRow.conversionContractId}', Supplied: '${contract.contractId}'.`
        );
      }

      if (
        quotationRow.revisionNumber !== contract.revisionNumber ||
        quotationRow.quotationNumber !== contract.quotationNumber
      ) {
        throw new ValidationError('Quotation revision or number mismatch against conversion contract payload.');
      }

      // 4b. Contract Consumption Idempotency Guard (Check prior sales orders)
      const [existingOrder] = await tx
        .select({ id: salesOrders.id })
        .from(salesOrders)
        .where(
          and(
            eq(salesOrders.tenantId, ctx.tenantId),
            eq(salesOrders.companyId, ctx.companyId),
            eq(salesOrders.conversionContractId, contract.contractId)
          )
        );

      if (existingOrder) {
        throw new ConflictError(
          `CONVERSION_CONTRACT_ALREADY_CONSUMED: Conversion contract '${contract.contractId}' has already been consumed into a Sales Order.`
        );
      }

      // 4c. Generate Sales Order Number
      const yearStr = new Date().getFullYear().toString();
      numberingEngine.configureSequence(ctx.tenantId, ctx.companyId, {
        documentType: 'SALES_ORDER',
        prefix: 'SO',
        fiscalYear: yearStr,
        currentSequence: 0,
        paddingDigits: 4,
        resetOnFiscalYear: true
      });
      const orderNumber = numberingEngine.generateNextNumber(ctx.tenantId, ctx.companyId, 'SALES_ORDER', yearStr);
      const todayStr = new Date().toISOString().split('T')[0]!;

      const orderId = crypto.randomUUID();

      // 4d. Insert Sales Order Header (Verbatim commercial fields)
      await tx.insert(salesOrders).values({
        id: orderId,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        orderNumber,
        quotationId: contract.quotationId,
        quotationNumber: contract.quotationNumber,
        revisionNumber: contract.revisionNumber,
        conversionContractId: contract.contractId,
        customerId: contract.customerId,
        orderDate: todayStr,
        currency: contract.currency,
        exchangeRate: contract.exchangeRate,
        salesRepresentativeId: contract.salesRepresentativeId,
        billingAddressId: contract.billingAddressId,
        shippingAddressId: contract.shippingAddressId,
        billingAddressSnapshot: contract.billingAddressSnapshot,
        shippingAddressSnapshot: contract.shippingAddressSnapshot,
        contactId: contract.contactId,
        contactSnapshot: contract.contactSnapshot,
        status: 'DRAFT',
        termsAndConditions: contract.termsAndConditions,
        subtotalAmount: contract.subtotalAmount,
        headerDiscountAmount: contract.headerDiscountAmount,
        discountAmount: contract.discountAmount,
        taxableAmount: contract.taxableAmount,
        taxAmount: contract.taxAmount,
        totalAmount: contract.totalAmount,
        totalAmountBase: contract.totalAmountBase,
        version: 1,
        createdBy: userId,
        updatedBy: userId
      });

      // 4e. Insert Sales Order Lines (Verbatim commercial copy including grossAmount)
      const insertedLines: SalesOrderLineDTO[] = [];
      for (const line of contract.lines) {
        const lineId = crypto.randomUUID();
        await tx.insert(salesOrderLines).values({
          id: lineId,
          orderId,
          quotationLineId: line.quotationLineId,
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          lineNumber: line.lineNumber,
          productId: line.productId,
          productCodeSnapshot: line.productCodeSnapshot,
          productNameSnapshot: line.productNameSnapshot,
          description: line.description || null,
          uom: line.uom,
          orderedQuantity: line.quantity,
          deliveredQuantity: '0.0000',
          invoicedQuantity: '0.0000',
          cancelledQuantity: '0.0000',
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
          discountAmount: line.discountAmount,
          allocatedHeaderDiscountAmount: line.allocatedHeaderDiscountAmount,
          grossAmount: line.grossAmount, // Copy verbatim from contract line! ZERO calculation!
          taxableAmount: line.taxableAmount,
          hsnSac: line.hsnSac,
          cgstRate: line.cgstRate,
          cgstAmount: line.cgstAmount,
          sgstRate: line.sgstRate,
          sgstAmount: line.sgstAmount,
          igstRate: line.igstRate,
          igstAmount: line.igstAmount,
          taxAmount: line.taxAmount,
          lineTotal: line.lineTotal,
          pricingSource: line.pricingSource,
          pricingRuleId: line.pricingRuleId || null,
          version: 1
        });

        insertedLines.push({
          id: lineId,
          orderId,
          quotationLineId: line.quotationLineId,
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          lineNumber: line.lineNumber,
          productId: line.productId,
          productCodeSnapshot: line.productCodeSnapshot,
          productNameSnapshot: line.productNameSnapshot,
          description: line.description || null,
          uom: line.uom,
          orderedQuantity: line.quantity,
          deliveredQuantity: '0.0000',
          invoicedQuantity: '0.0000',
          cancelledQuantity: '0.0000',
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
          discountAmount: line.discountAmount,
          allocatedHeaderDiscountAmount: line.allocatedHeaderDiscountAmount,
          grossAmount: line.grossAmount,
          taxableAmount: line.taxableAmount,
          hsnSac: line.hsnSac,
          cgstRate: line.cgstRate,
          cgstAmount: line.cgstAmount,
          sgstRate: line.sgstRate,
          sgstAmount: line.sgstAmount,
          igstRate: line.igstRate,
          igstAmount: line.igstAmount,
          taxAmount: line.taxAmount,
          lineTotal: line.lineTotal,
          pricingSource: line.pricingSource,
          pricingRuleId: line.pricingRuleId || null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }

      // 4f. Update Quotation Status ACCEPTED -> CONVERTED
      await tx
        .update(salesQuotations)
        .set({
          status: 'CONVERTED',
          updatedAt: new Date()
        })
        .where(eq(salesQuotations.id, contract.quotationId));

      const orderDTO: SalesOrderDTO = {
        id: orderId,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        orderNumber,
        quotationId: contract.quotationId,
        quotationNumber: contract.quotationNumber,
        revisionNumber: contract.revisionNumber,
        conversionContractId: contract.contractId,
        customerId: contract.customerId,
        orderDate: todayStr,
        currency: contract.currency,
        exchangeRate: contract.exchangeRate,
        salesRepresentativeId: contract.salesRepresentativeId,
        billingAddressId: contract.billingAddressId,
        shippingAddressId: contract.shippingAddressId,
        billingAddressSnapshot: contract.billingAddressSnapshot,
        shippingAddressSnapshot: contract.shippingAddressSnapshot,
        contactId: contract.contactId,
        contactSnapshot: contract.contactSnapshot,
        status: 'DRAFT',
        notes: null,
        termsAndConditions: contract.termsAndConditions,
        subtotalAmount: contract.subtotalAmount,
        headerDiscountAmount: contract.headerDiscountAmount,
        discountAmount: contract.discountAmount,
        taxableAmount: contract.taxableAmount,
        taxAmount: contract.taxAmount,
        totalAmount: contract.totalAmount,
        totalAmountBase: contract.totalAmountBase,
        creditOverrideBy: null,
        creditOverrideReason: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: userId,
        updatedBy: userId,
        lines: insertedLines
      };

      return orderDTO;
    });

    // Audit Event Recording
    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesOrder',
      entityId: resultOrder.id,
      action: 'CREATE_FROM_CONTRACT',
      newValues: {
        orderNumber: resultOrder.orderNumber,
        quotationNumber: resultOrder.quotationNumber,
        conversionContractId: resultOrder.conversionContractId,
        totalAmount: resultOrder.totalAmount
      }
    });

    if (idempotencyKey) {
      const cacheKey = `${ctx.tenantId}:${ctx.companyId}:${idempotencyKey}`;
      this.idempotencyStore.set(cacheKey, resultOrder);
    }

    return resultOrder;
  }

  /**
   * Confirms a DRAFT Sales Order after evaluating real-time Customer Credit Exposure under pessimistic lock.
   */
  public async confirmOrder(
    ctx: RequestContext,
    orderId: string,
    creditOverrideReason?: string
  ): Promise<SalesOrderDTO> {
    this.checkPermission(ctx, 'sales:order:confirm');

    const db = getDb();
    if (!db) {
      const order = await this.getOrderById(ctx, orderId);
      if (order.status !== 'DRAFT') {
        throw new ValidationError(`Cannot confirm Sales Order in state '${order.status}'. Order must be DRAFT.`);
      }

      const customer = await customerService.getCustomer(ctx, order.customerId);

      let arOutstanding = 0;
      let unappliedReceipts = 0;
      let openConfirmedOrders = 0;

      for (const ord of this.memoryStore.values()) {
        if (
          ord.tenantId === ctx.tenantId &&
          ord.companyId === ctx.companyId &&
          ord.customerId === order.customerId &&
          ord.status === 'CONFIRMED'
        ) {
          openConfirmedOrders += parseFloat(ord.totalAmountBase || '0');
        }
      }

      const currentOrderBase = parseFloat(order.totalAmountBase);
      const totalExposure = arOutstanding - unappliedReceipts + openConfirmedOrders + currentOrderBase;
      const creditLimit = parseFloat(customer.creditLimit || '0.00');

      let creditOverrideBy: string | null = null;
      let overrideReason: string | null = null;

      if (creditLimit > 0 && totalExposure > creditLimit) {
        const permissions = ctx.user?.permissions || (ctx as any).permissions || [];
        const roles = ctx.user?.roles || (ctx as any).roles || [];
        const hasOverridePerm =
          permissions.includes('sales:order:override_credit') || roles.includes('admin') || permissions.includes('*');

        if (!hasOverridePerm || !creditOverrideReason || creditOverrideReason.trim().length === 0) {
          throw new ValidationError(
            `CREDIT_LIMIT_EXCEEDED: Total credit exposure (${totalExposure.toFixed(
              2
            )}) exceeds customer credit limit (${creditLimit.toFixed(
              2
            )}). Requires 'sales:order:override_credit' permission and a mandatory creditOverrideReason.`
          );
        }
        creditOverrideBy = ctx.user?.userId || (ctx as any).userId || 'system';
        overrideReason = creditOverrideReason;
      }

      order.status = 'CONFIRMED';
      order.creditOverrideBy = creditOverrideBy;
      order.creditOverrideReason = overrideReason;
      order.updatedAt = new Date();
      this.memoryStore.set(`${ctx.tenantId}:${ctx.companyId}:${orderId}`, order);

      await auditService.logEvent(ctx, {
        module: 'sales',
        entityName: 'SalesOrder',
        entityId: order.id,
        action: 'CONFIRM',
        newValues: {
          orderNumber: order.orderNumber,
          status: 'CONFIRMED',
          creditOverrideBy: order.creditOverrideBy,
          creditOverrideReason: order.creditOverrideReason
        }
      });

      await notificationEngine.sendNotification(ctx, {
        channels: ['IN_APP'],
        recipientId: ctx.user?.userId || 'system',
        title: `Sales Order Confirmed: ${order.orderNumber}`,
        body: `Sales Order ${order.orderNumber} for customer ${order.customerId} has been confirmed.`,
        data: { orderId: order.id, orderNumber: order.orderNumber }
      });

      return order;
    }

    const userId = ctx.user?.userId || '00000000-0000-0000-0000-000000000000';

    const confirmedOrder = await db.transaction(async (tx) => {
      // 1. Fetch & Lock Order Header
      const [orderRow] = await tx
        .select()
        .from(salesOrders)
        .where(
          and(
            eq(salesOrders.id, orderId),
            eq(salesOrders.tenantId, ctx.tenantId),
            eq(salesOrders.companyId, ctx.companyId)
          )
        );

      if (!orderRow) {
        throw new NotFoundError(`Sales Order '${orderId}' not found.`);
      }

      if (orderRow.status !== 'DRAFT') {
        throw new ValidationError(`Cannot confirm Sales Order in state '${orderRow.status}'. Order must be DRAFT.`);
      }

      // 2. Lock Customer Row FOR UPDATE (Explicit Tenant & Company Isolation)
      const [customerRow] = await tx
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.id, orderRow.customerId),
            eq(customers.tenantId, ctx.tenantId),
            eq(customers.companyId, ctx.companyId)
          )
        )
        .for('update');

      if (!customerRow) {
        throw new NotFoundError(`Customer '${orderRow.customerId}' not found.`);
      }

      // 3. Calculate Real-Time Exposure synchronously under row lock
      // 3a. AR Open Items Outstanding (Tenant, Company, Customer scoped)
      const [arRes] = await tx
        .select({
          total: sql<string>`COALESCE(SUM(amount_due_base), 0)`
        })
        .from(arOpenItems)
        .where(
          and(
            eq(arOpenItems.tenantId, ctx.tenantId),
            eq(arOpenItems.companyId, ctx.companyId),
            eq(arOpenItems.customerId, orderRow.customerId),
            inArray(arOpenItems.status, ['OPEN', 'PARTIALLY_PAID'])
          )
        );
      const arOutstanding = parseFloat(arRes?.total || '0');

      // 3b. Unapplied Customer Receipts (Tenant, Company, Customer scoped)
      const [receiptRes] = await tx
        .select({
          total: sql<string>`COALESCE(SUM(unapplied_amount_base), 0)`
        })
        .from(arReceipts)
        .where(
          and(
            eq(arReceipts.tenantId, ctx.tenantId),
            eq(arReceipts.companyId, ctx.companyId),
            eq(arReceipts.customerId, orderRow.customerId)
          )
        );
      const unappliedReceipts = parseFloat(receiptRes?.total || '0');

      // 3c. Existing Confirmed Sales Orders (Tenant, Company, Customer scoped)
      const [confirmedOrdersRes] = await tx
        .select({
          total: sql<string>`COALESCE(SUM(total_amount_base), 0)`
        })
        .from(salesOrders)
        .where(
          and(
            eq(salesOrders.tenantId, ctx.tenantId),
            eq(salesOrders.companyId, ctx.companyId),
            eq(salesOrders.customerId, orderRow.customerId),
            eq(salesOrders.status, 'CONFIRMED')
          )
        );
      const openConfirmedOrders = parseFloat(confirmedOrdersRes?.total || '0');

      // 3d. Current Order Base Value
      const currentOrderBase = parseFloat(orderRow.totalAmountBase);

      // Total Exposure Formula
      const totalExposure = arOutstanding - unappliedReceipts + openConfirmedOrders + currentOrderBase;
      const creditLimit = parseFloat(customerRow.creditLimit || '0.00');

      let creditOverrideBy: string | null = null;
      let overrideReason: string | null = null;

      // 4. Evaluate Credit Limit
      if (creditLimit > 0 && totalExposure > creditLimit) {
        const userPermissions = ctx.user?.permissions || [];
        const userRoles = ctx.user?.roles || [];
        const hasOverridePerm = userPermissions.includes('sales:order:override_credit') || userRoles.includes('admin') || userPermissions.includes('*');

        if (!hasOverridePerm || !creditOverrideReason || creditOverrideReason.trim().length === 0) {
          throw new ValidationError(
            `CREDIT_LIMIT_EXCEEDED: Total credit exposure (${totalExposure.toFixed(
              2
            )}) exceeds customer credit limit (${creditLimit.toFixed(
              2
            )}). Requires 'sales:order:override_credit' permission and a mandatory creditOverrideReason.`
          );
        }
        creditOverrideBy = userId;
        overrideReason = creditOverrideReason;
      }

      // 5. Update Order Status to CONFIRMED
      await tx
        .update(salesOrders)
        .set({
          status: 'CONFIRMED',
          creditOverrideBy,
          creditOverrideReason: overrideReason,
          updatedAt: new Date()
        })
        .where(eq(salesOrders.id, orderId));

      return this.getOrderByIdInTx(tx, ctx, orderId);
    });

    // Audit Event
    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesOrder',
      entityId: confirmedOrder.id,
      action: 'CONFIRM',
      newValues: {
        orderNumber: confirmedOrder.orderNumber,
        status: 'CONFIRMED',
        creditOverrideBy: confirmedOrder.creditOverrideBy,
        creditOverrideReason: confirmedOrder.creditOverrideReason
      }
    });

    // Notification Event
    await notificationEngine.sendNotification(ctx, {
      channels: ['IN_APP'],
      recipientId: userId,
      title: `Sales Order Confirmed: ${confirmedOrder.orderNumber}`,
      body: `Sales Order ${confirmedOrder.orderNumber} for customer ${confirmedOrder.customerId} has been confirmed.`,
      data: { orderId: confirmedOrder.id, orderNumber: confirmedOrder.orderNumber }
    });

    return confirmedOrder;
  }

  /**
   * Cancels a DRAFT or CONFIRMED Sales Order.
   */
  public async cancelOrder(
    ctx: RequestContext,
    orderId: string,
    cancellationReason?: string
  ): Promise<SalesOrderDTO> {
    this.checkPermission(ctx, 'sales:order:cancel');

    const db = getDb();
    if (!db) {
      const order = await this.getOrderById(ctx, orderId);

      if (order.status !== 'DRAFT' && order.status !== 'CONFIRMED') {
        throw new ValidationError(`Cannot cancel Sales Order in state '${order.status}'. Only DRAFT or CONFIRMED orders can be cancelled.`);
      }

      if (order.status === 'CONFIRMED') {
        const hasDelivered = order.lines.some(l => parseFloat(l.deliveredQuantity) > 0);
        if (hasDelivered) {
          throw new ValidationError(`Cannot cancel Sales Order '${order.orderNumber}' because deliveries have already been recorded.`);
        }
      }

      order.status = 'CANCELLED';
      if (cancellationReason) {
        order.notes = `[CANCELLED]: ${cancellationReason}`;
      }
      order.updatedAt = new Date();
      this.memoryStore.set(`${ctx.tenantId}:${ctx.companyId}:${orderId}`, order);

      await auditService.logEvent(ctx, {
        module: 'sales',
        entityName: 'SalesOrder',
        entityId: order.id,
        action: 'CANCEL',
        newValues: {
          orderNumber: order.orderNumber,
          status: 'CANCELLED',
          cancellationReason: cancellationReason || null
        }
      });

      return order;
    }

    const cancelledOrder = await db.transaction(async (tx) => {
      const order = await this.getOrderByIdInTx(tx, ctx, orderId);

      if (order.status !== 'DRAFT' && order.status !== 'CONFIRMED') {
        throw new ValidationError(`Cannot cancel Sales Order in state '${order.status}'. Only DRAFT or CONFIRMED orders can be cancelled.`);
      }

      // If CONFIRMED, assert delivered_quantity == 0 on all lines
      if (order.status === 'CONFIRMED') {
        const hasDelivered = order.lines.some(l => parseFloat(l.deliveredQuantity) > 0);
        if (hasDelivered) {
          throw new ValidationError(`Cannot cancel Sales Order '${order.orderNumber}' because deliveries have already been recorded.`);
        }
      }

      await tx
        .update(salesOrders)
        .set({
          status: 'CANCELLED',
          notes: cancellationReason ? `[CANCELLED]: ${cancellationReason}` : order.notes,
          updatedAt: new Date()
        })
        .where(eq(salesOrders.id, orderId));

      return this.getOrderByIdInTx(tx, ctx, orderId);
    });

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesOrder',
      entityId: cancelledOrder.id,
      action: 'CANCEL',
      newValues: {
        orderNumber: cancelledOrder.orderNumber,
        status: 'CANCELLED',
        cancellationReason: cancellationReason || null
      }
    });

    return cancelledOrder;
  }

  /**
   * Fetch Sales Order Details by ID with Tenant and Company Context.
   */
  public async getOrderById(ctx: RequestContext, id: string): Promise<SalesOrderDTO> {
    const db = getDb();
    if (!db) {
      const cached = this.memoryStore.get(`${ctx.tenantId}:${ctx.companyId}:${id}`);
      if (!cached) {
        throw new NotFoundError(`Sales Order '${id}' not found.`);
      }
      return cached;
    }
    return this.getOrderByIdInTx(db, ctx, id);
  }

  private async getOrderByIdInTx(tx: any, ctx: RequestContext, id: string): Promise<SalesOrderDTO> {
    const [header] = await tx
      .select()
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, id),
          eq(salesOrders.tenantId, ctx.tenantId),
          eq(salesOrders.companyId, ctx.companyId)
        )
      );

    if (!header) {
      throw new NotFoundError(`Sales Order '${id}' not found.`);
    }

    const lines = await tx
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.orderId, id));

    return {
      id: header.id,
      tenantId: header.tenantId,
      companyId: header.companyId,
      orderNumber: header.orderNumber,
      quotationId: header.quotationId,
      quotationNumber: header.quotationNumber,
      revisionNumber: header.revisionNumber,
      conversionContractId: header.conversionContractId,
      customerId: header.customerId,
      orderDate: header.orderDate,
      currency: header.currency,
      exchangeRate: header.exchangeRate,
      salesRepresentativeId: header.salesRepresentativeId || null,
      billingAddressId: header.billingAddressId,
      shippingAddressId: header.shippingAddressId,
      billingAddressSnapshot: header.billingAddressSnapshot,
      shippingAddressSnapshot: header.shippingAddressSnapshot,
      contactId: header.contactId || null,
      contactSnapshot: header.contactSnapshot || null,
      status: header.status as any,
      notes: header.notes || null,
      termsAndConditions: header.termsAndConditions || null,
      subtotalAmount: header.subtotalAmount,
      headerDiscountAmount: header.headerDiscountAmount,
      discountAmount: header.discountAmount,
      taxableAmount: header.taxableAmount,
      taxAmount: header.taxAmount,
      totalAmount: header.totalAmount,
      totalAmountBase: header.totalAmountBase,
      creditOverrideBy: header.creditOverrideBy || null,
      creditOverrideReason: header.creditOverrideReason || null,
      version: header.version,
      createdAt: header.createdAt,
      updatedAt: header.updatedAt,
      createdBy: header.createdBy,
      updatedBy: header.updatedBy,
      lines: lines.map((l: any) => ({
        id: l.id,
        orderId: l.orderId,
        quotationLineId: l.quotationLineId,
        tenantId: l.tenantId,
        companyId: l.companyId,
        lineNumber: l.lineNumber,
        productId: l.productId,
        productCodeSnapshot: l.productCodeSnapshot,
        productNameSnapshot: l.productNameSnapshot,
        description: l.description || null,
        uom: l.uom,
        orderedQuantity: l.orderedQuantity,
        deliveredQuantity: l.deliveredQuantity,
        invoicedQuantity: l.invoicedQuantity,
        cancelledQuantity: l.cancelledQuantity,
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
        pricingSource: l.pricingSource,
        pricingRuleId: l.pricingRuleId || null,
        version: l.version,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt
      }))
    };
  }

  /**
   * Search and List Sales Orders with tenant and company scope filtering.
   */
  public async listOrders(
    ctx: RequestContext,
    params: ListSalesOrdersParams
  ): Promise<{ data: SalesOrderDTO[]; total: number; page: number; limit: number }> {
    this.checkPermission(ctx, 'sales:order:read');

    const db = getDb();
    if (!db) {
      let list = Array.from(this.memoryStore.values()).filter(
        o => o.tenantId === ctx.tenantId && o.companyId === (params.companyId || ctx.companyId)
      );
      if (params.status) {
        list = list.filter(o => o.status === params.status);
      }
      if (params.customerId) {
        list = list.filter(o => o.customerId === params.customerId);
      }
      if (params.search && params.search.trim().length > 0) {
        const s = params.search.trim().toLowerCase();
        list = list.filter(o => o.orderNumber.toLowerCase().includes(s) || o.quotationNumber.toLowerCase().includes(s));
      }

      const page = params.page && params.page > 0 ? params.page : 1;
      const limit = params.limit && params.limit > 0 ? params.limit : 50;
      const total = list.length;
      const items = list.slice((page - 1) * limit, page * limit);

      return {
        data: items,
        total,
        page,
        limit
      };
    }
    const page = params.page && params.page > 0 ? params.page : 1;
    const limit = params.limit && params.limit > 0 ? params.limit : 50;
    const offset = (page - 1) * limit;

    const conditions = [
      eq(salesOrders.tenantId, ctx.tenantId),
      eq(salesOrders.companyId, params.companyId || ctx.companyId)
    ];

    if (params.status) {
      conditions.push(eq(salesOrders.status, params.status));
    }

    if (params.customerId) {
      conditions.push(eq(salesOrders.customerId, params.customerId));
    }

    if (params.search && params.search.trim().length > 0) {
      const s = params.search.trim();
      conditions.push(
        or(
          ilike(salesOrders.orderNumber, `%${s}%`),
          ilike(salesOrders.quotationNumber, `%${s}%`)
        )!
      );
    }

    const whereClause = and(...conditions);

    const headers = await db
      .select()
      .from(salesOrders)
      .where(whereClause)
      .limit(limit)
      .offset(offset);

    const data: SalesOrderDTO[] = [];
    for (const h of headers) {
      const order = await this.getOrderByIdInTx(db, ctx, h.id);
      data.push(order);
    }

    return {
      data,
      total: data.length,
      page,
      limit
    };
  }
}

export const salesOrderService = new SalesOrderService();
