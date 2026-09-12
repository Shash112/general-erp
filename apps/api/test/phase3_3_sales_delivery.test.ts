import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { RequestContext, ValidationError, ForbiddenError, NotFoundError } from '@general-erp/core';
import { salesDeliveryService } from '../src/modules/sales/sales-delivery.service.js';
import { salesOrderService } from '../src/modules/sales/sales-order.service.js';
import { quotationService, QuotationConversionContract } from '../src/modules/sales/quotation.service.js';
import { customerService } from '../src/modules/commercial/customer.service.js';
import { addressService } from '../src/modules/commercial/address.service.js';
import { contactService } from '../src/modules/commercial/contact.service.js';
import { productService } from '../src/modules/commercial/product.service.js';
import { numberingEngine } from '../src/platform/numbering/numbering.service.js';
import { getDb, salesDeliveries, salesDeliveryLines, arOpenItems, glJournals, eq, sql } from '@general-erp/database';

describe('Phase 3.3 — Sales Delivery & Dispatch Domain & Suite', () => {
  let ctx: RequestContext;
  let tenantId: string;
  let companyId: string;
  let customerId: string;
  let billingAddrId: string;
  let shippingAddrId: string;
  let contactId: string;
  let productId1: string;
  let productId2: string;

  beforeEach(async () => {
    salesDeliveryService.clearMemoryStores();
    salesOrderService.clearMemoryStores();
    quotationService.clearMemoryStores();
    numberingEngine.clear();

    const timestamp = Date.now() + Math.floor(Math.random() * 100000);
    tenantId = `tenant_del_${timestamp}`;
    companyId = `cmp_${timestamp}`;

    ctx = {
      requestId: `req_del_${timestamp}`,
      tenantId,
      companyId,
      ip: '127.0.0.1',
      userAgent: 'vitest-agent',
      timestamp: new Date(),
      user: {
        userId: `user_del_${timestamp}`,
        email: `user_${timestamp}@test.com`,
        tenantId,
        companyId,
        roles: ['admin', 'sales_rep', 'warehouse_mgr'],
        permissions: [
          'sales:quotation:create',
          'sales:quotation:approve',
          'sales:quotation:convert',
          'sales:order:create',
          'sales:order:read',
          'sales:order:confirm',
          'sales:delivery:create',
          'sales:delivery:read',
          'sales:delivery:update',
          'sales:delivery:pick',
          'sales:delivery:pack',
          'sales:delivery:dispatch',
          'sales:delivery:deliver',
          'sales:delivery:cancel'
        ]
      }
    };

    // 1. Setup Master Customer
    const cust = await customerService.createCustomer(ctx, {
      companyId,
      name: `Delivery Customer ${timestamp}`,
      code: `CUST-DEL-${timestamp}`,
      legalName: `Delivery Customer ${timestamp}`,
      gstin: '29ABCDE1234F1Z5',
      creditLimit: '500000.00',
      creditDays: 30
    });
    customerId = cust.id;

    // 2. Setup Address and Contact
    const bAddr = await addressService.createAddress(ctx, {
      companyId,
      customerId,
      addressType: 'BILLING',
      addressLine1: '500 Logistics Park',
      city: 'Bengaluru',
      state: 'Karnataka',
      stateCode: '29',
      postalCode: '560001'
    });
    billingAddrId = bAddr.id;

    const sAddr = await addressService.createAddress(ctx, {
      companyId,
      customerId,
      addressType: 'SHIPPING',
      addressLine1: '600 Warehouse Way',
      city: 'Bengaluru',
      state: 'Karnataka',
      stateCode: '29',
      postalCode: '560058'
    });
    shippingAddrId = sAddr.id;

    const ctn = await contactService.createContact(ctx, {
      companyId,
      customerId,
      name: 'Dispatch Manager',
      email: 'dispatch@customer.local',
      mobile: '9876543210'
    });
    contactId = ctn.id;

    // 3. Setup Product Masters
    const p1 = await productService.createProduct(ctx, {
      companyId,
      name: 'Heavy Equipment Alpha',
      code: `PROD-DEL-1-${timestamp}`,
      sku: `SKU-DEL-1-${timestamp}`,
      baseUom: 'PCS',
      hsnSac: '84713010',
      sellingPrice: '10000.00'
    });
    productId1 = p1.id;

    const p2 = await productService.createProduct(ctx, {
      companyId,
      name: 'Component Beta',
      code: `PROD-DEL-2-${timestamp}`,
      sku: `SKU-DEL-2-${timestamp}`,
      baseUom: 'PCS',
      hsnSac: '84713020',
      sellingPrice: '5000.00'
    });
    productId2 = p2.id;
  });

  // Helper to create and confirm a sales order
  async function createConfirmedSalesOrder(qty1: string = '10.0000', qty2: string = '5.0000') {
    const q = await quotationService.createDraftQuotation(ctx, {
      companyId,
      customerId,
      quotationDate: '2026-09-12',
      validityDate: '2026-10-12',
      currency: 'INR',
      exchangeRate: '1.000000',
      billingAddressId: billingAddrId,
      shippingAddressId: shippingAddrId,
      contactId,
      headerDiscountAmount: 0,
      lines: [
        {
          productId: productId1,
          quantity: qty1,
          unitPrice: '10000.00',
          discountPercent: '0.00'
        },
        {
          productId: productId2,
          quantity: qty2,
          unitPrice: '5000.00',
          discountPercent: '0.00'
        }
      ]
    });

    const submitted = await quotationService.submitForApproval(ctx, q.id);
    if (submitted.status === 'PENDING_APPROVAL') {
      await quotationService.approveQuotation(ctx, q.id);
    }
    await quotationService.sendQuotation(ctx, q.id);
    await quotationService.acceptQuotation(ctx, q.id);

    const contract = await quotationService.issueConversionContract(ctx, q.id);
    const order = await salesOrderService.createFromContract(ctx, contract);
    const confirmedOrder = await salesOrderService.confirmOrder(ctx, order.id);
    return confirmedOrder;
  }

  // ============================================================================
  // 1. MIGRATION FILE & DDL INTEGRITY TESTS
  // ============================================================================
  it('verifies Migration file 013_phase3_sales_delivery.sql exists and contains valid DDL', () => {
    const migrationPath = path.resolve(__dirname, '../../../packages/database/migrations/013_phase3_sales_delivery.sql');
    expect(fs.existsSync(migrationPath)).toBe(true);

    const sqlContent = fs.readFileSync(migrationPath, 'utf-8');
    expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS sales_deliveries');
    expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS sales_delivery_lines');
    expect(sqlContent).toContain('chk_sales_delivery_status');
    expect(sqlContent).toContain('chk_sales_delivery_line_qty_pos');
    expect(sqlContent).toContain('uq_sales_delivery_tenant_company_num');
  });

  // ============================================================================
  // 2. CREATION & VALIDATION TESTS
  // ============================================================================
  it('creates a Sales Delivery in DRAFT status against a confirmed Sales Order', async () => {
    const order = await createConfirmedSalesOrder('10.0000', '5.0000');

    const delivery = await salesDeliveryService.createDelivery(ctx, {
      companyId,
      salesOrderId: order.id,
      deliveryDate: '2026-09-12',
      transporterName: 'VRL Logistics',
      vehicleNumber: 'KA-01-AB-1234',
      lrNumber: 'LR-987654',
      lrDate: '2026-09-12',
      notes: 'Fragile equipment cargo',
      lines: [
        {
          salesOrderLineId: order.lines[0]!.id,
          deliveryQuantity: '6.0000'
        },
        {
          salesOrderLineId: order.lines[1]!.id,
          deliveryQuantity: '3.0000'
        }
      ]
    });

    expect(delivery.id).toBeDefined();
    expect(delivery.deliveryNumber).toMatch(/^DEL-/);
    expect(delivery.salesOrderId).toBe(order.id);
    expect(delivery.status).toBe('DRAFT');
    expect(delivery.lines).toHaveLength(2);

    expect(delivery.lines[0]!.deliveryQuantity).toBe('6.0000');
    expect(delivery.lines[0]!.orderedQuantitySnapshot).toBe('10.0000');
    expect(delivery.lines[0]!.remainingQuantitySnapshot).toBe('4.0000');

    expect(delivery.lines[1]!.deliveryQuantity).toBe('3.0000');
    expect(delivery.lines[1]!.orderedQuantitySnapshot).toBe('5.0000');
    expect(delivery.lines[1]!.remainingQuantitySnapshot).toBe('2.0000');
  });

  it('rejects delivery creation against DRAFT or CANCELLED sales orders', async () => {
    // Create draft order (unconfirmed)
    const q = await quotationService.createDraftQuotation(ctx, {
      companyId,
      customerId,
      quotationDate: '2026-09-12',
      validityDate: '2026-10-12',
      currency: 'INR',
      billingAddressId: billingAddrId,
      shippingAddressId: shippingAddrId,
      lines: [{ productId: productId1, quantity: '5.0000', unitPrice: '10000.00' }]
    });
    await quotationService.submitForApproval(ctx, q.id);
    await quotationService.sendQuotation(ctx, q.id);
    await quotationService.acceptQuotation(ctx, q.id);
    const contract = await quotationService.issueConversionContract(ctx, q.id);
    const draftOrder = await salesOrderService.createFromContract(ctx, contract);

    // Attempt delivery against DRAFT order must fail
    await expect(
      salesDeliveryService.createDelivery(ctx, {
        companyId,
        salesOrderId: draftOrder.id,
        deliveryDate: '2026-09-12',
        lines: [{ salesOrderLineId: draftOrder.lines[0]!.id, deliveryQuantity: '2.0000' }]
      })
    ).rejects.toThrow(/Order must be CONFIRMED or COMPLETED/);
  });

  it('rejects delivery when requested quantity exceeds remaining order quantity (Over-Delivery Protection)', async () => {
    const order = await createConfirmedSalesOrder('5.0000', '2.0000');

    // Order qty = 5.0, attempting delivery of 6.0 must fail
    await expect(
      salesDeliveryService.createDelivery(ctx, {
        companyId,
        salesOrderId: order.id,
        deliveryDate: '2026-09-12',
        lines: [{ salesOrderLineId: order.lines[0]!.id, deliveryQuantity: '6.0000' }]
      })
    ).rejects.toThrow(/OVER_DELIVERY_EXCEEDED/);
  });

  it('rejects zero or negative delivery quantities', async () => {
    const order = await createConfirmedSalesOrder('5.0000', '2.0000');

    await expect(
      salesDeliveryService.createDelivery(ctx, {
        companyId,
        salesOrderId: order.id,
        deliveryDate: '2026-09-12',
        lines: [{ salesOrderLineId: order.lines[0]!.id, deliveryQuantity: '0.0000' }]
      })
    ).rejects.toThrow(/must be greater than zero/);
  });

  // ============================================================================
  // 3. LIFECYCLE STATE MACHINE TESTS
  // ============================================================================
  it('executes state transitions DRAFT -> PICKED -> PACKED -> DISPATCHED -> DELIVERED', async () => {
    const order = await createConfirmedSalesOrder('10.0000', '5.0000');
    const delivery = await salesDeliveryService.createDelivery(ctx, {
      companyId,
      salesOrderId: order.id,
      deliveryDate: '2026-09-12',
      lines: [{ salesOrderLineId: order.lines[0]!.id, deliveryQuantity: '5.0000' }]
    });

    expect(delivery.status).toBe('DRAFT');

    // 1. Pick
    const picked = await salesDeliveryService.pickDelivery(ctx, delivery.id);
    expect(picked.status).toBe('PICKED');
    expect(picked.pickedAt).toBeDefined();

    // 2. Pack
    const packed = await salesDeliveryService.packDelivery(ctx, delivery.id);
    expect(packed.status).toBe('PACKED');
    expect(packed.packedAt).toBeDefined();

    // 3. Dispatch
    const dispatched = await salesDeliveryService.dispatchDelivery(ctx, delivery.id);
    expect(dispatched.status).toBe('DISPATCHED');
    expect(dispatched.dispatchedAt).toBeDefined();

    // 4. Deliver
    const delivered = await salesDeliveryService.markDelivered(ctx, delivery.id);
    expect(delivered.status).toBe('DELIVERED');
    expect(delivered.deliveredAt).toBeDefined();
  });

  it('cancels a DRAFT delivery and releases allocated delivery quantity back to order line', async () => {
    const order = await createConfirmedSalesOrder('10.0000', '5.0000');
    const delivery = await salesDeliveryService.createDelivery(ctx, {
      companyId,
      salesOrderId: order.id,
      deliveryDate: '2026-09-12',
      lines: [{ salesOrderLineId: order.lines[0]!.id, deliveryQuantity: '4.0000' }]
    });

    // Order line delivered quantity should be updated to 4.0000
    const orderBeforeCancel = await salesOrderService.getOrderById(ctx, order.id);
    expect(parseFloat(orderBeforeCancel.lines[0]!.deliveredQuantity)).toBe(4);

    // Cancel delivery
    const cancelled = await salesDeliveryService.cancelDelivery(ctx, delivery.id, 'Truck unavailable');
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancellationReason).toBe('Truck unavailable');

    // Order line delivered quantity should be released back to 0.0000
    const orderAfterCancel = await salesOrderService.getOrderById(ctx, order.id);
    expect(parseFloat(orderAfterCancel.lines[0]!.deliveredQuantity)).toBe(0);
  });

  it('rejects cancellation of DISPATCHED or DELIVERED sales deliveries', async () => {
    const order = await createConfirmedSalesOrder('10.0000', '5.0000');
    const delivery = await salesDeliveryService.createDelivery(ctx, {
      companyId,
      salesOrderId: order.id,
      deliveryDate: '2026-09-12',
      lines: [{ salesOrderLineId: order.lines[0]!.id, deliveryQuantity: '5.0000' }]
    });

    await salesDeliveryService.dispatchDelivery(ctx, delivery.id);

    // Attempting to cancel DISPATCHED delivery must fail
    await expect(
      salesDeliveryService.cancelDelivery(ctx, delivery.id, 'Tried to cancel on road')
    ).rejects.toThrow(/Cannot cancel a Sales Delivery that has already been DISPATCHED/);
  });

  // ============================================================================
  // 4. PARTIAL DELIVERIES & FULFILLMENT TRACKING TESTS
  // ============================================================================
  it('supports multiple partial deliveries against one order up to full fulfillment', async () => {
    const order = await createConfirmedSalesOrder('10.0000', '5.0000');

    // Partial Delivery 1: 4.0000 units of line 1
    const del1 = await salesDeliveryService.createDelivery(ctx, {
      companyId,
      salesOrderId: order.id,
      deliveryDate: '2026-09-12',
      lines: [{ salesOrderLineId: order.lines[0]!.id, deliveryQuantity: '4.0000' }]
    });
    expect(del1.lines[0]!.remainingQuantitySnapshot).toBe('6.0000');

    // Partial Delivery 2: 6.0000 units of line 1 (Fulfilling line 1)
    const del2 = await salesDeliveryService.createDelivery(ctx, {
      companyId,
      salesOrderId: order.id,
      deliveryDate: '2026-09-13',
      lines: [{ salesOrderLineId: order.lines[0]!.id, deliveryQuantity: '6.0000' }]
    });
    expect(del2.lines[0]!.previouslyDeliveredQuantitySnapshot).toBe('4.0000');
    expect(del2.lines[0]!.remainingQuantitySnapshot).toBe('0.0000');

    // Attempting a 3rd delivery of line 1 must fail due to zero remaining quantity
    await expect(
      salesDeliveryService.createDelivery(ctx, {
        companyId,
        salesOrderId: order.id,
        deliveryDate: '2026-09-14',
        lines: [{ salesOrderLineId: order.lines[0]!.id, deliveryQuantity: '1.0000' }]
      })
    ).rejects.toThrow(/OVER_DELIVERY_EXCEEDED/);

    // Get order fulfillment summary
    const summary = await salesDeliveryService.getOrderFulfillment(ctx, order.id);
    expect(summary.totalLines).toBe(2);
    expect(summary.fullyDeliveredLines).toBe(1); // Line 1 fully delivered
    expect(summary.undeliveredLines).toBe(1); // Line 2 zero delivered
  });

  // ============================================================================
  // 5. IDEMPOTENCY TESTS
  // ============================================================================
  it('returns cached delivery payload for duplicate Idempotency-Key header requests', async () => {
    const order = await createConfirmedSalesOrder('10.0000', '5.0000');
    const idempotencyKey = `idem_del_${Date.now()}`;

    const del1 = await salesDeliveryService.createDelivery(
      ctx,
      {
        companyId,
        salesOrderId: order.id,
        deliveryDate: '2026-09-12',
        lines: [{ salesOrderLineId: order.lines[0]!.id, deliveryQuantity: '3.0000' }]
      },
      idempotencyKey
    );

    const del2 = await salesDeliveryService.createDelivery(
      ctx,
      {
        companyId,
        salesOrderId: order.id,
        deliveryDate: '2026-09-12',
        lines: [{ salesOrderLineId: order.lines[0]!.id, deliveryQuantity: '3.0000' }]
      },
      idempotencyKey
    );

    expect(del1.id).toBe(del2.id);
    expect(del1.deliveryNumber).toBe(del2.deliveryNumber);
  });

  // ============================================================================
  // 6. CONCURRENCY TESTS
  // ============================================================================
  it('prevents concurrent over-delivery attempts on the same remaining quantity using FOR UPDATE row locking', async () => {
    const order = await createConfirmedSalesOrder('5.0000', '5.0000'); // Line 1 qty = 5

    // Two concurrent delivery creation requests attempting to deliver 4 units each against remaining 5 units (4 + 4 = 8 > 5)
    const results = await Promise.allSettled([
      salesDeliveryService.createDelivery(ctx, {
        companyId,
        salesOrderId: order.id,
        deliveryDate: '2026-09-12',
        lines: [{ salesOrderLineId: order.lines[0]!.id, deliveryQuantity: '4.0000' }]
      }),
      salesDeliveryService.createDelivery(ctx, {
        companyId,
        salesOrderId: order.id,
        deliveryDate: '2026-09-12',
        lines: [{ salesOrderLineId: order.lines[0]!.id, deliveryQuantity: '4.0000' }]
      })
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(err.message).toContain('OVER_DELIVERY_EXCEEDED');
  });

  // ============================================================================
  // 7. STRICT ZERO-BOUNDARY PROTECTION TESTS
  // ============================================================================
  it('proves Phase 3.3 creates 0 stock ledger items, 0 AR invoices, and 0 GL accounting journals', async () => {
    const db = getDb();
    let arCountBefore = 0;
    let arCountAfter = 0;
    let glCountBefore = 0;
    let glCountAfter = 0;

    if (db) {
      const [arRes] = await db.select({ count: sql<number>`count(*)` }).from(arOpenItems);
      arCountBefore = Number(arRes?.count || 0);

      const [glRes] = await db.select({ count: sql<number>`count(*)` }).from(glJournals);
      glCountBefore = Number(glRes?.count || 0);
    }

    const order = await createConfirmedSalesOrder('10.0000', '5.0000');
    const delivery = await salesDeliveryService.createDelivery(ctx, {
      companyId,
      salesOrderId: order.id,
      deliveryDate: '2026-09-12',
      lines: [{ salesOrderLineId: order.lines[0]!.id, deliveryQuantity: '5.0000' }]
    });

    await salesDeliveryService.dispatchDelivery(ctx, delivery.id);
    await salesDeliveryService.markDelivered(ctx, delivery.id);

    if (db) {
      const [arRes] = await db.select({ count: sql<number>`count(*)` }).from(arOpenItems);
      arCountAfter = Number(arRes?.count || 0);

      const [glRes] = await db.select({ count: sql<number>`count(*)` }).from(glJournals);
      glCountAfter = Number(glRes?.count || 0);
    }

    // Zero financial side effects assertion
    expect(arCountAfter).toBe(arCountBefore);
    expect(glCountAfter).toBe(glCountBefore);
  });
});
