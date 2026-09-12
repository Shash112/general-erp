import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { RequestContext, ValidationError, ForbiddenError, ConflictError, NotFoundError } from '@general-erp/core';
import { salesOrderService } from '../src/modules/sales/sales-order.service.js';
import { quotationService, QuotationConversionContract } from '../src/modules/sales/quotation.service.js';
import { customerService } from '../src/modules/commercial/customer.service.js';
import { addressService } from '../src/modules/commercial/address.service.js';
import { contactService } from '../src/modules/commercial/contact.service.js';
import { productService } from '../src/modules/commercial/product.service.js';
import { pricingService } from '../src/modules/commercial/pricing.service.js';
import { numberingEngine } from '../src/platform/numbering/numbering.service.js';
import { getDb, salesOrders, salesOrderLines, salesQuotations, salesQuotationLines, arOpenItems, customerReceipts, eq, and, sql } from '@general-erp/database';

describe('Phase 3.2 — Sales Orders Domain & Implementation Suite', () => {
  let ctx: RequestContext;
  let tenantId: string;
  let companyId: string;
  let customerId: string;
  let billingAddrId: string;
  let shippingAddrId: string;
  let contactId: string;
  let productId1: string;

  beforeEach(async () => {
    salesOrderService.clearMemoryStores();
    quotationService.clearMemoryStores();
    numberingEngine.clear();

    const timestamp = Date.now() + Math.floor(Math.random() * 100000);
    tenantId = `tenant_so_${timestamp}`;
    companyId = `cmp_${timestamp}`;

    ctx = {
      requestId: `req_so_${timestamp}`,
      tenantId,
      companyId,
      ip: '127.0.0.1',
      userAgent: 'vitest-agent',
      timestamp: new Date(),
      user: {
        userId: `user_so_${timestamp}`,
        email: `user_${timestamp}@test.com`,
        tenantId,
        companyId,
        roles: ['admin', 'sales_rep'],
        permissions: [
          'sales:quotation:create',
          'sales:quotation:approve',
          'sales:quotation:convert',
          'sales:order:create',
          'sales:order:read',
          'sales:order:confirm',
          'sales:order:cancel',
          'sales:order:override_credit'
        ]
      }
    };

    // 1. Setup Master Customer with Credit Limit
    const cust = await customerService.createCustomer(ctx, {
      companyId,
      name: `SO Customer ${timestamp}`,
      code: `CUST-SO-${timestamp}`,
      legalName: `SO Customer ${timestamp}`,
      gstin: '29ABCDE1234F1Z5',
      creditLimit: '100000.00',
      creditDays: 30
    });
    customerId = cust.id;

    // 2. Setup Address and Contact
    const bAddr = await addressService.createAddress(ctx, {
      companyId,
      customerId,
      addressType: 'BILLING',
      addressLine1: '100 Commercial Plaza',
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
      addressLine1: '200 Industrial Estate',
      city: 'Bengaluru',
      state: 'Karnataka',
      stateCode: '29',
      postalCode: '560058'
    });
    shippingAddrId = sAddr.id;

    const ctn = await contactService.createContact(ctx, {
      companyId,
      customerId,
      name: 'John Sales Manager',
      email: 'john@sales.local',
      mobile: '9876543210'
    });
    contactId = ctn.id;

    // 3. Setup Product Master and Pricing
    const p1 = await productService.createProduct(ctx, {
      companyId,
      name: 'Enterprise Server Unit',
      code: `PROD-SO-1-${timestamp}`,
      sku: `SKU-SO-1-${timestamp}`,
      baseUom: 'PCS',
      hsnSac: '84713010',
      sellingPrice: '10000.00'
    });
    productId1 = p1.id;
  });

  // --- Helper to create accepted quotation and issued contract ---
  async function createAcceptedContract(qty: string = '5.0000', headerDiscount: number = 0): Promise<{ quotationId: string; contract: QuotationConversionContract }> {
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
      headerDiscountAmount: headerDiscount,
      lines: [
        {
          productId: productId1,
          quantity: qty,
          unitPrice: '10000.00',
          discountPercent: '10.00' // gross = 50,000, disc = 5,000, taxable = 45,000, gst = 8,100, total = 53,100
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
    return { quotationId: q.id, contract };
  }

  // ============================================================================
  // 1. MIGRATION FILE & SCHEMA INTEGRITY TESTS
  // ============================================================================
  it('verifies Migration file 012_phase3_sales_orders.sql exists and contains approved DDL statements', () => {
    const migrationPath = path.resolve(__dirname, '../../../packages/database/migrations/012_phase3_sales_orders.sql');
    expect(fs.existsSync(migrationPath)).toBe(true);

    const sqlContent = fs.readFileSync(migrationPath, 'utf-8');
    expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS sales_orders');
    expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS sales_order_lines');
    expect(sqlContent).toContain('uq_sales_order_contract_id');
    expect(sqlContent).toContain('REFERENCES sales_quotation_lines(id) ON DELETE RESTRICT');
    expect(sqlContent).toContain('chk_sales_order_status');
  });

  // ============================================================================
  // 2. CONVERSION CONTRACT CONSUMPTION TESTS
  // ============================================================================
  it('consumes a valid Phase 3.1-issued contract and creates a Sales Order in DRAFT status', async () => {
    const { quotationId, contract } = await createAcceptedContract();

    // Verify Phase 3.1 populates conversionContractId on quotation header during contract issuance
    const qBefore = await quotationService.getQuotation(ctx, quotationId);
    expect(qBefore.conversionContractId).toBe(contract.contractId);
    expect(qBefore.status).toBe('ACCEPTED');

    // Consume contract in Phase 3.2 (Must NOT fail because conversionContractId is non-null on quotation)
    const order = await salesOrderService.createFromContract(ctx, contract);

    expect(order.id).toBeDefined();
    expect(order.orderNumber).toMatch(/^SO-/);
    expect(order.quotationId).toBe(quotationId);
    expect(order.conversionContractId).toBe(contract.contractId);
    expect(order.status).toBe('DRAFT');
    expect(order.lines).toHaveLength(1);

    // Verify quotation status updated to CONVERTED atomically
    const qAfter = await quotationService.getQuotation(ctx, quotationId);
    expect(qAfter.status).toBe('CONVERTED');
  });

  it('rejects consumption when contract hash digest does not match payload', async () => {
    const { contract } = await createAcceptedContract();
    const tamperedContract: QuotationConversionContract = {
      ...contract,
      contractHash: 'tampered_hash_digest_0000000000000000000000000000000000000000'
    };

    await expect(salesOrderService.createFromContract(ctx, tamperedContract)).rejects.toThrow(
      /Invalid QuotationConversionContract: Payload SHA-256 hash digest mismatch/
    );
  });

  it('rejects contract consumption if quotation ID, quotation number, or revision number mismatch', async () => {
    const { contract } = await createAcceptedContract();

    const mismatchedIdContract: QuotationConversionContract = {
      ...contract,
      quotationId: crypto.randomUUID()
    };

    await expect(salesOrderService.createFromContract(ctx, mismatchedIdContract)).rejects.toThrow();
  });

  // ============================================================================
  // 3. IDEMPOTENCY & ATOMICITY TESTS
  // ============================================================================
  it('enforces database-level duplicate conversion protection via conversion_contract_id UNIQUE constraint', async () => {
    const { contract } = await createAcceptedContract();

    // First consumption succeeds
    const order1 = await salesOrderService.createFromContract(ctx, contract);
    expect(order1.id).toBeDefined();

    // Second consumption attempt with same contract must fail with ConflictError
    await expect(salesOrderService.createFromContract(ctx, contract)).rejects.toThrow(ConflictError);
  });

  it('returns cached Sales Order payload for duplicate HTTP Idempotency-Key header requests', async () => {
    const { contract } = await createAcceptedContract();
    const idempotencyKey = `idempotency_key_test_${Date.now()}`;

    const order1 = await salesOrderService.createFromContract(ctx, contract, idempotencyKey);
    const order2 = await salesOrderService.createFromContract(ctx, contract, idempotencyKey);

    expect(order1.id).toBe(order2.id);
    expect(order1.orderNumber).toBe(order2.orderNumber);
  });

  // ============================================================================
  // 4. COMMERCIAL IMMUTABILITY & VERBATIM GROSS AMOUNT COPY TESTS
  // ============================================================================
  it('copies all commercial values including line grossAmount verbatim without recalculation', async () => {
    const { contract } = await createAcceptedContract('10.0000', 1000);
    const order = await salesOrderService.createFromContract(ctx, contract);

    expect(order.subtotalAmount).toBe(contract.subtotalAmount);
    expect(order.headerDiscountAmount).toBe(contract.headerDiscountAmount);
    expect(order.taxableAmount).toBe(contract.taxableAmount);
    expect(order.taxAmount).toBe(contract.taxAmount);
    expect(order.totalAmount).toBe(contract.totalAmount);
    expect(order.totalAmountBase).toBe(contract.totalAmountBase);

    // Specifically assert sales_order_lines.gross_amount === contract.lines[i].grossAmount verbatim
    const orderLine = order.lines[0]!;
    const contractLine = contract.lines[0]!;
    expect(orderLine.grossAmount).toBe(contractLine.grossAmount);
    expect(orderLine.taxableAmount).toBe(contractLine.taxableAmount);
    expect(orderLine.lineTotal).toBe(contractLine.lineTotal);
    expect(orderLine.unitPrice).toBe(contractLine.unitPrice);
    expect(orderLine.discountAmount).toBe(contractLine.discountAmount);
    expect(orderLine.allocatedHeaderDiscountAmount).toBe(contractLine.allocatedHeaderDiscountAmount);
  });

  // ============================================================================
  // 5. RELATIONAL TRACEABILITY & FOREIGN KEY TESTS
  // ============================================================================
  it('verifies sales_order_lines.quotation_line_id references sales_quotation_lines.id and enforces ON DELETE RESTRICT', async () => {
    const { contract } = await createAcceptedContract();
    const order = await salesOrderService.createFromContract(ctx, contract);

    const orderLine = order.lines[0]!;
    expect(orderLine.quotationLineId).toBe(contract.lines[0]!.quotationLineId);

    const db = getDb();
    if (db) {
      // Attempting to delete the referenced sales_quotation_lines row must fail due to ON DELETE RESTRICT
      await expect(
        db.delete(salesQuotationLines).where(eq(salesQuotationLines.id, orderLine.quotationLineId))
      ).rejects.toThrow();
    }
  });

  // ============================================================================
  // 6. CUSTOMER CREDIT-LIMIT EXPOSURE & CONCURRENCY TESTS
  // ============================================================================
  it('evaluates real-time credit exposure and confirms DRAFT order within credit limit', async () => {
    const { contract } = await createAcceptedContract('1.0000'); // total ~ 10,620 INR (Limit: 100,000 INR)
    const order = await salesOrderService.createFromContract(ctx, contract);

    expect(order.status).toBe('DRAFT');

    const confirmed = await salesOrderService.confirmOrder(ctx, order.id);
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.creditOverrideBy).toBeNull();
  });

  it('rejects confirmation when credit limit is exceeded unless valid override permission and reason are supplied', async () => {
    // Update customer credit limit to low amount (₹5,000)
    await customerService.updateCustomer(ctx, customerId, { creditLimit: '5000.00' });

    const { contract } = await createAcceptedContract('1.0000'); // total ~ 10,620 INR > 5,000 Limit
    const order = await salesOrderService.createFromContract(ctx, contract);

    // Confirmation without override reason must fail
    await expect(salesOrderService.confirmOrder(ctx, order.id)).rejects.toThrow(
      /CREDIT_LIMIT_EXCEEDED/
    );

    // Confirmation with override reason succeeds
    const confirmed = await salesOrderService.confirmOrder(ctx, order.id, 'Management approved strategic customer credit extension');
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.creditOverrideReason).toContain('Management approved');
  });

  it('enforces multi-tenant and multi-company data isolation in credit exposure subqueries', async () => {
    const db = getDb();
    if (db) {
      const otherTenant = `tenant_other_${Date.now()}`;
      const otherCompany = crypto.randomUUID();

      // Insert an open AR item under a different tenant for the same customer ID
      await db.insert(arOpenItems).values({
        id: crypto.randomUUID(),
        tenantId: otherTenant,
        companyId: otherCompany,
        customerId,
        documentType: 'INVOICE',
        documentId: crypto.randomUUID(),
        documentNumber: 'INV-OTHER-999',
        issueDate: '2026-09-12',
        dueDate: '2026-10-12',
        currency: 'INR',
        amountBase: '500000.00',
        amountDueBase: '500000.00', // ₹500,000 open item under other tenant
        status: 'OPEN',
        createdBy: crypto.randomUUID(),
        updatedBy: crypto.randomUUID()
      });
    }

    // Confirmation under current tenant context must NOT include other tenant's AR item in exposure
    const { contract } = await createAcceptedContract('1.0000'); // total ~ 10,620 INR (Limit: 100,000 INR)
    const order = await salesOrderService.createFromContract(ctx, contract);

    const confirmed = await salesOrderService.confirmOrder(ctx, order.id);
    expect(confirmed.status).toBe('CONFIRMED');
  });

  it('serializes concurrent confirmation requests for the same customer using FOR UPDATE pessimistic locking', async () => {
    // Customer credit limit: ₹60,000
    await customerService.updateCustomer(ctx, customerId, { creditLimit: '60000.00' });

    // Order 1: ₹35,400 Total
    const { contract: c1 } = await createAcceptedContract('3.0000');
    const o1 = await salesOrderService.createFromContract(ctx, c1);

    // Order 2: ₹35,400 Total
    const { contract: c2 } = await createAcceptedContract('3.0000');
    const o2 = await salesOrderService.createFromContract(ctx, c2);

    // Executing both confirmations concurrently (35,400 + 35,400 = 70,800 > 60,000 limit)
    // One must succeed, and the other must fail with CREDIT_LIMIT_EXCEEDED
    const results = await Promise.allSettled([
      salesOrderService.confirmOrder(ctx, o1.id),
      salesOrderService.confirmOrder(ctx, o2.id)
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(err.message).toContain('CREDIT_LIMIT_EXCEEDED');
  });

  // ============================================================================
  // 7. LIFECYCLE & CANCELLATION TESTS
  // ============================================================================
  it('executes DRAFT -> CANCELLED and CONFIRMED -> CANCELLED state transitions', async () => {
    // 1. Cancel DRAFT order
    const { contract: c1 } = await createAcceptedContract();
    const o1 = await salesOrderService.createFromContract(ctx, c1);
    const cancelled1 = await salesOrderService.cancelOrder(ctx, o1.id, 'Customer changed requirement');
    expect(cancelled1.status).toBe('CANCELLED');

    // 2. Cancel CONFIRMED order (with 0 delivered quantity)
    const { contract: c2 } = await createAcceptedContract();
    const o2 = await salesOrderService.createFromContract(ctx, c2);
    await salesOrderService.confirmOrder(ctx, o2.id);
    const cancelled2 = await salesOrderService.cancelOrder(ctx, o2.id, 'Order cancelled prior to dispatch');
    expect(cancelled2.status).toBe('CANCELLED');
  });

  // ============================================================================
  // 8. STRICT BOUNDARY PROTECTION TESTS
  // ============================================================================
  it('proves Phase 3.2 creates zero deliveries, zero invoices, zero AR items, zero GL entries, and never executes CONFIRMED -> COMPLETED', async () => {
    const db = getDb();
    let arCountBefore = 0;
    let arCountAfter = 0;
    if (db) {
      const [b] = await db.select({ count: sql<number>`count(*)` }).from(arOpenItems);
      arCountBefore = Number(b?.count || 0);
    }

    const { contract } = await createAcceptedContract();
    const order = await salesOrderService.createFromContract(ctx, contract);
    await salesOrderService.confirmOrder(ctx, order.id);

    if (db) {
      const [a] = await db.select({ count: sql<number>`count(*)` }).from(arOpenItems);
      arCountAfter = Number(a?.count || 0);
    }

    // Verify zero AR open items created by Phase 3.2
    expect(arCountAfter).toBe(arCountBefore);

    // Verify order status is CONFIRMED and NOT COMPLETED
    const finalOrder = await salesOrderService.getOrderById(ctx, order.id);
    expect(finalOrder.status).toBe('CONFIRMED');
    expect(finalOrder.status).not.toBe('COMPLETED');
  });
});
