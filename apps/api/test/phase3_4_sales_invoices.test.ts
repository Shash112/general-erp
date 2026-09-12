import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { RequestContext, ValidationError, ForbiddenError, BusinessRuleViolationError } from '@general-erp/core';
import { salesInvoiceService } from '../src/modules/sales/sales-invoice.service.js';
import { salesDeliveryService } from '../src/modules/sales/sales-delivery.service.js';
import { salesOrderService } from '../src/modules/sales/sales-order.service.js';
import { quotationService } from '../src/modules/sales/quotation.service.js';
import { customerService } from '../src/modules/commercial/customer.service.js';
import { addressService } from '../src/modules/commercial/address.service.js';
import { contactService } from '../src/modules/commercial/contact.service.js';
import { productService } from '../src/modules/commercial/product.service.js';
import { arDocumentService } from '../src/modules/finance/ar/ar-document.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { accountingConfigurationService } from '../src/modules/finance/accounting-core.service.js';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { numberingEngine } from '../src/platform/numbering/numbering.service.js';
import { getDb, salesInvoices, salesInvoiceLines, salesOrders, arOpenItems, glJournals, eq, and, sql } from '@general-erp/database';

describe('Phase 3.4 — Sales Invoicing, AR & Accounting Domain & Suite', () => {
  let ctx: RequestContext;
  let tenantId: string;
  let companyId: string;
  let customerId: string;
  let billingAddrId: string;
  let shippingAddrId: string;
  let contactId: string;
  let productId1: string;

  beforeEach(async () => {
    salesInvoiceService.clearMemoryStores();
    salesDeliveryService.clearMemoryStores();
    salesOrderService.clearMemoryStores();
    quotationService.clearMemoryStores();
    arDocumentService.clear();
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    accountingConfigurationService.clear();
    masterDataService.clear();
    numberingEngine.clear();

    const timestamp = Date.now() + Math.floor(Math.random() * 100000);
    tenantId = `tenant_inv_${timestamp}`;
    companyId = `cmp_${timestamp}`;

    ctx = {
      requestId: `req_inv_${timestamp}`,
      tenantId,
      companyId,
      ip: '127.0.0.1',
      userAgent: 'vitest-agent',
      timestamp: new Date(),
      user: {
        userId: `user_inv_${timestamp}`,
        email: `user_${timestamp}@test.com`,
        tenantId,
        companyId,
        roles: ['admin', 'sales_rep', 'accountant'],
        permissions: [
          'sales:quotation:create',
          'sales:quotation:approve',
          'sales:quotation:convert',
          'sales:order:create',
          'sales:order:read',
          'sales:order:confirm',
          'sales:delivery:create',
          'sales:delivery:read',
          'sales:delivery:dispatch',
          'sales:delivery:deliver',
          'sales:invoice:create',
          'sales:invoice:read',
          'sales:invoice:post',
          'sales:invoice:cancel',
          'ar:document:create',
          'ar:document:read',
          'ar:document:post',
          'finance:gl:post',
          'finance:gl:create',
          'finance:coa:admin',
          'finance:coa:create',
          'finance:fiscal_year:create'
        ]
      }
    };

    // Provision company in masterDataService
    await masterDataService.createCompany(ctx, {
      id: companyId,
      name: `Test Company ${timestamp}`,
      legalName: `Test Company ${timestamp}`,
      currency: 'INR'
    });

    // Provision Fiscal Year for AccountingCore GL posting
    await fiscalPeriodService.createFiscalYear(ctx, {
      companyId,
      yearName: 'FY 2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31'
    });

    // Provision Chart of Accounts for AccountingCore GL account resolution
    await chartOfAccountsService.applyTemplate(ctx, {
      companyId,
      templateId: 'INDIAN_SME_DEFAULT_V1'
    });

    const accounts = await chartOfAccountsService.getAccountsList(ctx, companyId);
    const arAcc = accounts.find(a => a.accountCode === '1130')!;
    const salesAcc = accounts.find(a => a.accountCode === '4100')!;
    const cgstAcc = accounts.find(a => a.accountCode === '2120')!;
    const sgstAcc = accounts.find(a => a.accountCode === '2121')!;
    const igstAcc = accounts.find(a => a.accountCode === '2122')!;

    const eventTypes = ['AR_INVOICE', 'SALES_INVOICE', 'AR_INVOICE_POSTED'];
    for (const et of eventTypes) {
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'AR_CONTROL', accountId: arAcc.id });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'SALES_REVENUE', accountId: salesAcc.id });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'OUTPUT_CGST', accountId: cgstAcc.id });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'OUTPUT_SGST', accountId: sgstAcc.id });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'OUTPUT_IGST', accountId: igstAcc.id });
    }

    // 1. Setup Master Customer
    const cust = await customerService.createCustomer(ctx, {
      companyId,
      name: `Invoice Customer ${timestamp}`,
      code: `CUST-INV-${timestamp}`,
      legalName: `Invoice Customer ${timestamp}`,
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
      addressLine1: '700 Finance Towers',
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
      addressLine1: '800 Dispatch Park',
      city: 'Bengaluru',
      state: 'Karnataka',
      stateCode: '29',
      postalCode: '560058'
    });
    shippingAddrId = sAddr.id;

    const ctn = await contactService.createContact(ctx, {
      companyId,
      customerId,
      name: 'Billing Admin',
      email: 'billing@customer.local',
      mobile: '9876543210'
    });
    contactId = ctn.id;

    // 3. Setup Product Master
    const p1 = await productService.createProduct(ctx, {
      companyId,
      name: 'Enterprise Server Node',
      code: `PROD-INV-1-${timestamp}`,
      sku: `SKU-INV-1-${timestamp}`,
      baseUom: 'PCS',
      hsnSac: '84713010',
      sellingPrice: '20000.00'
    });
    productId1 = p1.id;
  });

  // Helper to create and confirm a sales order
  async function createConfirmedSalesOrder(qty: string = '5.0000') {
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
          quantity: qty,
          unitPrice: '20000.00',
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
  it('verifies Migration file 014_phase3_sales_invoices.sql exists and contains valid DDL', () => {
    const migrationPath = path.resolve(__dirname, '../../../packages/database/migrations/014_phase3_sales_invoices.sql');
    expect(fs.existsSync(migrationPath)).toBe(true);

    const sqlContent = fs.readFileSync(migrationPath, 'utf-8');
    expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS sales_invoices');
    expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS sales_invoice_lines');
    expect(sqlContent).toContain('chk_sales_invoice_status');
    expect(sqlContent).toContain('chk_sales_invoice_line_qty_pos');
    expect(sqlContent).toContain('uq_sales_invoice_tenant_company_num');
  });

  // ============================================================================
  // 2. INVOICE CREATION & COMMERCIAL COPY TESTS
  // ============================================================================
  it('creates a Sales Invoice in DRAFT status from a confirmed Sales Order', async () => {
    const order = await createConfirmedSalesOrder('5.0000');

    const invoice = await salesInvoiceService.createFromOrder(ctx, {
      companyId,
      salesOrderId: order.id,
      invoiceDate: '2026-09-12',
      dueDate: '2026-10-12',
      lines: [
        {
          salesOrderLineId: order.lines[0]!.id,
          invoicedQuantity: '5.0000'
        }
      ]
    });

    expect(invoice.id).toBeDefined();
    expect(invoice.invoiceNumber).toMatch(/^INV-/);
    expect(invoice.salesOrderId).toBe(order.id);
    expect(invoice.status).toBe('DRAFT');
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines[0]!.invoicedQuantity).toBe('5.0000');
    expect(invoice.totalAmount).toBe('118000.00'); // 5 * 20,000 = 100,000 + 18% GST (18,000) = 118,000
  });

  it('rejects over-invoicing when requested quantity exceeds remaining order quantity', async () => {
    const order = await createConfirmedSalesOrder('5.0000');

    await expect(
      salesInvoiceService.createFromOrder(ctx, {
        companyId,
        salesOrderId: order.id,
        lines: [
          {
            salesOrderLineId: order.lines[0]!.id,
            invoicedQuantity: '6.0000' // Order qty = 5.0
          }
        ]
      })
    ).rejects.toThrow(/OVER_INVOICING_EXCEEDED/);
  });

  // ============================================================================
  // 3. FINANCIAL POSTING & AR / ACCOUNTING CORE INTEGRATION TESTS
  // ============================================================================
  it('posts a Sales Invoice, generating AR Document, AR Open Item, and GL Journal Entry', async () => {
    const order = await createConfirmedSalesOrder('5.0000');
    const invoice = await salesInvoiceService.createFromOrder(ctx, {
      companyId,
      salesOrderId: order.id,
      lines: [{ salesOrderLineId: order.lines[0]!.id, invoicedQuantity: '5.0000' }]
    });

    expect(invoice.status).toBe('DRAFT');

    const postedInvoice = await salesInvoiceService.postInvoice(ctx, invoice.id);

    expect(postedInvoice.status).toBe('POSTED');
    expect(postedInvoice.postedAt).toBeDefined();
    expect(postedInvoice.arDocumentId).toBeDefined();
    expect(postedInvoice.journalEntryId).toBeDefined();
  });

  it('prohibits editing or cancelling a POSTED invoice enforcing financial immutability', async () => {
    const order = await createConfirmedSalesOrder('5.0000');
    const invoice = await salesInvoiceService.createFromOrder(ctx, {
      companyId,
      salesOrderId: order.id,
      lines: [{ salesOrderLineId: order.lines[0]!.id, invoicedQuantity: '5.0000' }]
    });

    await salesInvoiceService.postInvoice(ctx, invoice.id);

    // Attempting to cancel POSTED invoice must throw BusinessRuleViolationError
    await expect(
      salesInvoiceService.cancelInvoice(ctx, invoice.id, 'Tried to cancel posted invoice')
    ).rejects.toThrow(/Cannot cancel a POSTED Sales Invoice. Posted financial records are immutable/);
  });

  // ============================================================================
  // 4. ORDER STATE MACHINE TRANSITION EXECUTION (CONFIRMED -> COMPLETED)
  // ============================================================================
  it('executes sales order status CONFIRMED -> COMPLETED when all lines are fully delivered and fully invoiced', async () => {
    const order = await createConfirmedSalesOrder('4.0000');

    // 1. Deliver full order quantity (4.0000)
    const delivery = await salesDeliveryService.createDelivery(ctx, {
      companyId,
      salesOrderId: order.id,
      deliveryDate: '2026-09-12',
      lines: [{ salesOrderLineId: order.lines[0]!.id, deliveryQuantity: '4.0000' }]
    });
    await salesDeliveryService.dispatchDelivery(ctx, delivery.id);
    await salesDeliveryService.markDelivered(ctx, delivery.id);

    // Order status should still be CONFIRMED prior to invoicing
    const orderMid = await salesOrderService.getOrderById(ctx, order.id);
    expect(orderMid.status).toBe('CONFIRMED');

    // 2. Invoice full order quantity (4.0000) and post invoice
    const invoice = await salesInvoiceService.createFromOrder(ctx, {
      companyId,
      salesOrderId: order.id,
      lines: [{ salesOrderLineId: order.lines[0]!.id, invoicedQuantity: '4.0000' }]
    });
    await salesInvoiceService.postInvoice(ctx, invoice.id);

    // Order status must transition to COMPLETED atomically!
    const orderFinal = await salesOrderService.getOrderById(ctx, order.id);
    expect(orderFinal.status).toBe('COMPLETED');
  });

  // ============================================================================
  // 5. DUAL-LAYER IDEMPOTENCY TESTS
  // ============================================================================
  it('returns cached invoice payload when re-posting with the same idempotency key', async () => {
    const order = await createConfirmedSalesOrder('5.0000');
    const idempotencyKey = `idem_inv_${Date.now()}`;

    const inv1 = await salesInvoiceService.createFromOrder(
      ctx,
      {
        companyId,
        salesOrderId: order.id,
        lines: [{ salesOrderLineId: order.lines[0]!.id, invoicedQuantity: '5.0000' }]
      },
      idempotencyKey
    );

    const inv2 = await salesInvoiceService.createFromOrder(
      ctx,
      {
        companyId,
        salesOrderId: order.id,
        lines: [{ salesOrderLineId: order.lines[0]!.id, invoicedQuantity: '5.0000' }]
      },
      idempotencyKey
    );

    expect(inv1.id).toBe(inv2.id);
    expect(inv1.invoiceNumber).toBe(inv2.invoiceNumber);
  });
});
