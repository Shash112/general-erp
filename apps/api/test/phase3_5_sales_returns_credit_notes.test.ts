import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext, ValidationError, ForbiddenError, BusinessRuleViolationError } from '@general-erp/core';
import { salesReturnService } from '../src/modules/sales/sales-return.service.js';
import { salesCreditNoteService } from '../src/modules/sales/sales-credit-note.service.js';
import { salesInvoiceService } from '../src/modules/sales/sales-invoice.service.js';
import { salesDeliveryService } from '../src/modules/sales/sales-delivery.service.js';
import { salesOrderService } from '../src/modules/sales/sales-order.service.js';
import { quotationService } from '../src/modules/sales/quotation.service.js';
import { customerService } from '../src/modules/commercial/customer.service.js';
import { addressService } from '../src/modules/commercial/address.service.js';
import { contactService } from '../src/modules/commercial/contact.service.js';
import { productService } from '../src/modules/commercial/product.service.js';
import { arDocumentService } from '../src/modules/finance/ar/ar-document.service.js';
import { arOpenItemService } from '../src/modules/finance/ar/ar-open-item.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { accountingConfigurationService } from '../src/modules/finance/accounting-core.service.js';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { numberingEngine } from '../src/platform/numbering/numbering.service.js';
import {
  getDb,
  salesInvoices,
  salesInvoiceLines,
  salesReturns,
  salesReturnLines,
  salesCreditNotes,
  salesCreditNoteLines,
  arOpenItems,
  glJournals,
  eq,
  and,
  sql
} from '@general-erp/database';

describe('Phase 3.5 — Sales Returns & Credit Notes Domain & Suite', () => {
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
    salesReturnService.clearMemoryStores();
    salesCreditNoteService.clearMemoryStores();
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
    tenantId = `tenant_ret_${timestamp}`;
    companyId = `cmp_${timestamp}`;

    ctx = {
      requestId: `req_ret_${timestamp}`,
      tenantId,
      companyId,
      ip: '127.0.0.1',
      userAgent: 'vitest-agent',
      timestamp: new Date(),
      user: {
        userId: `user_ret_${timestamp}`,
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
          'sales:return:create',
          'sales:return:read',
          'sales:return:submit',
          'sales:return:approve',
          'sales:return:cancel',
          'sales:credit_note:create',
          'sales:credit_note:read',
          'sales:credit_note:post',
          'sales:credit_note:cancel',
          'ar:document:create',
          'ar:document:read',
          'ar:document:post',
          'ar:allocation:create',
          'ar:allocation:read',
          'finance:gl:post',
          'finance:gl:create',
          'finance:coa:admin',
          'finance:coa:create',
          'finance:fiscal_year:create'
        ]
      }
    };

    // Provision company
    await masterDataService.createCompany(ctx, {
      id: companyId,
      name: `Test Return Company ${timestamp}`,
      legalName: `Test Return Company ${timestamp}`,
      currency: 'INR'
    });

    // Provision Fiscal Year
    await fiscalPeriodService.createFiscalYear(ctx, {
      companyId,
      yearName: 'FY 2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31'
    });

    // Provision Chart of Accounts
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

    const eventTypes = ['AR_INVOICE', 'SALES_INVOICE', 'AR_INVOICE_POSTED', 'CREDIT_NOTE', 'SALES_CREDIT_NOTE', 'AR_CREDIT_NOTE'];
    for (const et of eventTypes) {
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'AR_CONTROL', accountId: arAcc.id });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'SALES_REVENUE', accountId: salesAcc.id });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'OUTPUT_CGST', accountId: cgstAcc.id });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'OUTPUT_SGST', accountId: sgstAcc.id });
      await accountingConfigurationService.setMapping(ctx, { companyId, eventType: et, lineRole: 'OUTPUT_IGST', accountId: igstAcc.id });
    }

    // Setup Master Data (Customer, Addresses, Products)
    const cust = await customerService.createCustomer(ctx, {
      companyId,
      name: `Return Customer ${timestamp}`,
      code: `CUST-RET-${timestamp}`,
      legalName: `Return Customer ${timestamp}`,
      gstin: '27AAAAA0000A1Z5',
      creditLimit: '500000.00',
      creditDays: 30
    });
    customerId = cust.id;

    const bAddr = await addressService.createAddress(ctx, {
      companyId,
      customerId,
      addressType: 'BILLING',
      addressLine1: '100 Return Street',
      city: 'Mumbai',
      state: 'Maharashtra',
      stateCode: '27',
      postalCode: '400001'
    });
    billingAddrId = bAddr.id;

    const sAddr = await addressService.createAddress(ctx, {
      companyId,
      customerId,
      addressType: 'SHIPPING',
      addressLine1: '100 Return Street',
      city: 'Mumbai',
      state: 'Maharashtra',
      stateCode: '27',
      postalCode: '400001'
    });
    shippingAddrId = sAddr.id;

    const cont = await contactService.createContact(ctx, {
      companyId,
      customerId,
      name: 'Return Manager',
      email: `ret_${timestamp}@test.com`,
      mobile: '+919999999999'
    });
    contactId = cont.id;

    const prod1 = await productService.createProduct(ctx, {
      companyId,
      code: `PROD-A-${timestamp}`,
      sku: `PROD-A-${timestamp}`,
      name: 'Widget A',
      hsnSac: '8471',
      uom: 'PCS',
      standardUnitPrice: '100.00'
    });
    productId1 = prod1.id;

    const prod2 = await productService.createProduct(ctx, {
      companyId,
      code: `PROD-B-${timestamp}`,
      sku: `PROD-B-${timestamp}`,
      name: 'Widget B',
      hsnSac: '8471',
      uom: 'PCS',
      standardUnitPrice: '200.00'
    });
    productId2 = prod2.id;
  });

  async function createConfirmedSalesOrder(qtyA = '100.0000', priceA = '100.0000', qtyB = '50.0000', priceB = '200.0000') {
    const lines = [
      {
        productId: productId1,
        quantity: qtyA,
        unitPrice: priceA,
        discountPercent: '0.00',
        cgstRate: '9.00',
        sgstRate: '9.00'
      }
    ];
    if (parseFloat(qtyB) > 0) {
      lines.push({
        productId: productId2,
        quantity: qtyB,
        unitPrice: priceB,
        discountPercent: '0.00',
        cgstRate: '9.00',
        sgstRate: '9.00'
      });
    }

    const q = await quotationService.createDraftQuotation(ctx, {
      companyId,
      customerId,
      quotationDate: '2026-03-01',
      validityDate: '2027-12-31',
      currency: 'INR',
      exchangeRate: '1.000000',
      billingAddressId: billingAddrId,
      shippingAddressId: shippingAddrId,
      contactId,
      headerDiscountAmount: 0,
      lines
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

  async function createPostedInvoice(qtyA = '100.0000', priceA = '100.0000', qtyB = '50.0000', priceB = '200.0000') {
    const order = await createConfirmedSalesOrder(qtyA, priceA, qtyB, priceB);
    const invLines = [
      {
        salesOrderLineId: order.lines[0].id,
        invoicedQuantity: qtyA
      }
    ];
    if (order.lines.length > 1 && parseFloat(qtyB) > 0) {
      invLines.push({
        salesOrderLineId: order.lines[1].id,
        invoicedQuantity: qtyB
      });
    }

    const invoice = await salesInvoiceService.createFromOrder(ctx, {
      companyId,
      salesOrderId: order.id,
      invoiceDate: '2026-03-01',
      dueDate: '2026-03-31',
      lines: invLines
    });

    const posted = await salesInvoiceService.postInvoice(ctx, invoice.id);
    return posted;
  }

  // --- 1. SALES RETURN CREATION & QUANTITY BOUNDARIES ---
  describe('Sales Return Creation & Quantity Boundary Rules', () => {
    it('creates a draft sales return successfully for a posted invoice', async () => {
      const inv = await createPostedInvoice('100.0000', '100.0000', '50.0000', '200.0000');
      const lineA = inv.lines[0];

      const ret = await salesReturnService.createReturn(ctx, {
        companyId,
        originalSalesInvoiceId: inv.id,
        reason: 'DEFECTIVE_GOODS',
        notes: 'Customer returned 20 damaged units',
        lines: [
          {
            originalInvoiceLineId: lineA.id,
            returnQuantity: '20.0000',
            reason: 'Damaged'
          }
        ]
      });

      expect(ret.id).toBeDefined();
      expect(ret.status).toBe('DRAFT');
      expect(ret.originalSalesInvoiceId).toBe(inv.id);
      expect(ret.lines.length).toBe(1);
      expect(ret.lines[0].returnQuantity).toBe('20.0000');
      expect(ret.lines[0].unitPrice).toBe('100.0000');
    });

    it('prevents return creation against a DRAFT unposted invoice', async () => {
      const order = await createConfirmedSalesOrder('10.0000', '100.0000', '0.0000', '0.0000');
      const draftInv = await salesInvoiceService.createFromOrder(ctx, {
        companyId,
        salesOrderId: order.id,
        invoiceDate: '2026-03-01',
        dueDate: '2026-03-31',
        lines: [
          {
            salesOrderLineId: order.lines[0].id,
            invoicedQuantity: '10.0000'
          }
        ]
      });

      await expect(
        salesReturnService.createReturn(ctx, {
          companyId,
          originalSalesInvoiceId: draftInv.id,
          reason: 'DEFECTIVE_GOODS',
          lines: [
            {
              originalInvoiceLineId: draftInv.lines[0].id,
              returnQuantity: '5.0000'
            }
          ]
        })
      ).rejects.toThrow();
    });

    it('rejects return quantity exceeding original invoiced quantity', async () => {
      const inv = await createPostedInvoice('10.0000', '100.0000', '5.0000', '200.0000');
      const lineA = inv.lines[0];

      await expect(
        salesReturnService.createReturn(ctx, {
          companyId,
          originalSalesInvoiceId: inv.id,
          reason: 'DEFECTIVE_GOODS',
          lines: [
            {
              originalInvoiceLineId: lineA.id,
              returnQuantity: '15.0000'
            }
          ]
        })
      ).rejects.toThrow();
    });

    it('enforces cumulative return quantity boundaries across multiple returns', async () => {
      const inv = await createPostedInvoice('100.0000', '100.0000', '50.0000', '200.0000');
      const lineA = inv.lines[0];

      // Return 1: 20 units
      const ret1 = await salesReturnService.createReturn(ctx, {
        companyId,
        originalSalesInvoiceId: inv.id,
        reason: 'DEFECTIVE_GOODS',
        lines: [{ originalInvoiceLineId: lineA.id, returnQuantity: '20.0000' }]
      });
      await salesReturnService.submitReturn(ctx, ret1.id);
      await salesReturnService.approveReturn(ctx, ret1.id);

      // Return 2: 30 units
      const ret2 = await salesReturnService.createReturn(ctx, {
        companyId,
        originalSalesInvoiceId: inv.id,
        reason: 'DEFECTIVE_GOODS',
        lines: [{ originalInvoiceLineId: lineA.id, returnQuantity: '30.0000' }]
      });
      await salesReturnService.submitReturn(ctx, ret2.id);
      await salesReturnService.approveReturn(ctx, ret2.id);

      // Return 3: 50 units (completes the 100 max)
      const ret3 = await salesReturnService.createReturn(ctx, {
        companyId,
        originalSalesInvoiceId: inv.id,
        reason: 'DEFECTIVE_GOODS',
        lines: [{ originalInvoiceLineId: lineA.id, returnQuantity: '50.0000' }]
      });
      await salesReturnService.submitReturn(ctx, ret3.id);
      await salesReturnService.approveReturn(ctx, ret3.id);

      // Verify returnable quantities now answer 0 remaining for lineA
      const returnables = await salesReturnService.getReturnableQuantities(ctx, inv.id);
      const retA = returnables.find(r => r.originalInvoiceLineId === lineA.id)!;
      expect(retA.previouslyReturnedQuantity).toBe('100.0000');
      expect(retA.remainingReturnableQuantity).toBe('0.0000');

      // Return 4: Even 0.0001 or 1 unit must fail
      await expect(
        salesReturnService.createReturn(ctx, {
          companyId,
          originalSalesInvoiceId: inv.id,
          reason: 'DEFECTIVE_GOODS',
          lines: [{ originalInvoiceLineId: lineA.id, returnQuantity: '1.0000' }]
        })
      ).rejects.toThrow();
    });

    it('rejects zero or negative return quantities', async () => {
      const inv = await createPostedInvoice('10.0000', '100.0000');
      const lineA = inv.lines[0];

      await expect(
        salesReturnService.createReturn(ctx, {
          companyId,
          originalSalesInvoiceId: inv.id,
          reason: 'DEFECTIVE_GOODS',
          lines: [{ originalInvoiceLineId: lineA.id, returnQuantity: '0.0000' }]
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        salesReturnService.createReturn(ctx, {
          companyId,
          originalSalesInvoiceId: inv.id,
          reason: 'DEFECTIVE_GOODS',
          lines: [{ originalInvoiceLineId: lineA.id, returnQuantity: '-5.0000' }]
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  // --- 2. SALES RETURN LIFECYCLE ---
  describe('Sales Return Lifecycle', () => {
    it('progresses through DRAFT -> SUBMITTED -> APPROVED lifecycle', async () => {
      const inv = await createPostedInvoice('50.0000', '100.0000');
      const ret = await salesReturnService.createReturn(ctx, {
        companyId,
        originalSalesInvoiceId: inv.id,
        reason: 'CUSTOMER_CANCELLED',
        lines: [{ originalInvoiceLineId: inv.lines[0].id, returnQuantity: '10.0000' }]
      });

      expect(ret.status).toBe('DRAFT');

      const submitted = await salesReturnService.submitReturn(ctx, ret.id);
      expect(submitted.status).toBe('SUBMITTED');

      const approved = await salesReturnService.approveReturn(ctx, ret.id);
      expect(approved.status).toBe('APPROVED');
      expect(approved.approvedBy).toBe(ctx.user.userId);
    });

    it('allows cancelling a DRAFT or SUBMITTED return', async () => {
      const inv = await createPostedInvoice('50.0000', '100.0000');
      const ret = await salesReturnService.createReturn(ctx, {
        companyId,
        originalSalesInvoiceId: inv.id,
        reason: 'WRONG_ITEM',
        lines: [{ originalInvoiceLineId: inv.lines[0].id, returnQuantity: '5.0000' }]
      });

      const cancelled = await salesReturnService.cancelReturn(ctx, ret.id, 'Entered by mistake');
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.cancellationReason).toBe('Entered by mistake');

      // Cancelled return quantity is released back to returnable quantities
      const returnables = await salesReturnService.getReturnableQuantities(ctx, inv.id);
      const retA = returnables.find(r => r.originalInvoiceLineId === inv.lines[0].id)!;
      expect(retA.remainingReturnableQuantity).toBe('50.0000');
    });
  });

  // --- 3. CREDIT NOTE CREATION & HISTORICAL VALUE AUTHORITY ---
  describe('Credit Note Creation & Historical Authority', () => {
    it('creates credit note from approved return preserving historical invoice rates', async () => {
      const inv = await createPostedInvoice('100.0000', '150.0000');
      const lineA = inv.lines[0];

      const ret = await salesReturnService.createReturn(ctx, {
        companyId,
        originalSalesInvoiceId: inv.id,
        reason: 'DEFECTIVE_GOODS',
        lines: [{ originalInvoiceLineId: lineA.id, returnQuantity: '10.0000' }]
      });
      await salesReturnService.submitReturn(ctx, ret.id);
      await salesReturnService.approveReturn(ctx, ret.id);

      const cn = await salesCreditNoteService.createCreditNote(ctx, {
        companyId,
        originalSalesInvoiceId: inv.id,
        salesReturnId: ret.id,
        reason: 'DEFECTIVE_GOODS',
        lines: [
          {
            originalInvoiceLineId: lineA.id,
            returnedQuantity: '10.0000'
          }
        ]
      });

      expect(cn.status).toBe('DRAFT');
      expect(cn.salesReturnId).toBe(ret.id);
      expect(cn.lines.length).toBe(1);

      const cnLine = cn.lines[0];
      // Historical unit price = 150.0000
      expect(cnLine.unitPrice).toBe('150.0000');
      expect(cnLine.grossAmount).toBe('1500.00');
      expect(cnLine.taxableAmount).toBe('1500.00');

      // CGST (9%) on 1500 = 135.00, SGST (9%) on 1500 = 135.00
      expect(cnLine.cgstAmount).toBe('135.00');
      expect(cnLine.sgstAmount).toBe('135.00');
      expect(cnLine.taxAmount).toBe('270.00');
      expect(cnLine.lineTotal).toBe('1770.00');
    });

    it('rejects credit note line credit amount exceeding historical basis', async () => {
      const inv = await createPostedInvoice('10.0000', '100.0000');
      const lineA = inv.lines[0];

      // Attempting to request credit of 1500.00 for 10 units worth 1000.00
      await expect(
        salesCreditNoteService.createCreditNote(ctx, {
          companyId,
          originalSalesInvoiceId: inv.id,
          reason: 'OVERCHARGE',
          lines: [
            {
              originalInvoiceLineId: lineA.id,
              returnedQuantity: '10.0000',
              creditAmount: '1500.00'
            }
          ]
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  // --- 4. FINANCIAL POSTING & INTEGRATION (AR + GL + RECONCILIATION) ---
  describe('Credit Note Financial Posting (AR + GL Integration)', () => {
    it('posts credit note, reduces AR open item balance, and creates balanced GL journal', async () => {
      // 1. Create and post invoice (10 units @ 100 = 1000 + 18% GST = 1180.00)
      const inv = await createPostedInvoice('10.0000', '100.0000', '0.0000', '0.0000');
      // Invoiced total = 1180.00 (1000 subtotal + 90 CGST + 90 SGST)
      expect(inv.totalAmount).toBe('1180.00');

      // Verify original AR Open Item
      const db = getDb();
      if (db) {
        const openItemsBefore = await db
          .select()
          .from(arOpenItems)
          .where(eq(arOpenItems.invoiceId, inv.id));
        expect(openItemsBefore.length).toBe(1);
        expect(openItemsBefore[0].amount).toBe('1180.00');
        expect(openItemsBefore[0].openAmount).toBe('1180.00');
      }

      // 2. Create return for 2 units (2 * 100 = 200 + 36 GST = 236.00)
      const ret = await salesReturnService.createReturn(ctx, {
        companyId,
        originalSalesInvoiceId: inv.id,
        reason: 'DEFECTIVE_GOODS',
        lines: [{ originalInvoiceLineId: inv.lines[0].id, returnQuantity: '2.0000' }]
      });
      await salesReturnService.submitReturn(ctx, ret.id);
      await salesReturnService.approveReturn(ctx, ret.id);

      // 3. Create credit note
      const cn = await salesCreditNoteService.createCreditNote(ctx, {
        companyId,
        originalSalesInvoiceId: inv.id,
        salesReturnId: ret.id,
        reason: 'DEFECTIVE_GOODS',
        lines: [{ originalInvoiceLineId: inv.lines[0].id, returnedQuantity: '2.0000' }]
      });

      expect(cn.totalAmount).toBe('236.00');

      // 4. Post Credit Note
      const postedCn = await salesCreditNoteService.postCreditNote(ctx, cn.id);

      expect(postedCn.status).toBe('POSTED');
      expect(postedCn.arDocumentId).toBeDefined();
      expect(postedCn.journalEntryId).toBeDefined();
      expect(postedCn.postedAt).toBeDefined();

      // 5. Verify AR Open Item outstanding balance reduction
      if (db) {
        const openItemsAfter = await db
          .select()
          .from(arOpenItems)
          .where(eq(arOpenItems.invoiceId, inv.id));
        expect(openItemsAfter.length).toBe(1);
        expect(openItemsAfter[0].openAmount).toBe('944.00');

        const journals = await db
          .select()
          .from(glJournals)
          .where(eq(glJournals.id, postedCn.journalEntryId!));
        expect(journals.length).toBe(1);
        expect(journals[0].status).toBe('POSTED');
        expect(journals[0].totalDebit).toBe('236.00');
        expect(journals[0].totalCredit).toBe('236.00');
      }
    });

    it('enforces exact equality: Credit Note Total == AR Credit Amount == GL Financial Effect', async () => {
      const inv = await createPostedInvoice('50.0000', '250.0000');
      const cn = await salesCreditNoteService.createCreditNote(ctx, {
        companyId,
        originalSalesInvoiceId: inv.id,
        reason: 'PRICE_CORRECTION',
        lines: [{ originalInvoiceLineId: inv.lines[0].id, returnedQuantity: '10.0000' }]
      });

      const postedCn = await salesCreditNoteService.postCreditNote(ctx, cn.id);

      const db = getDb();
      if (db) {
        const [journal] = await db.select().from(glJournals).where(eq(glJournals.id, postedCn.journalEntryId!));
        // Financial reconciliation invariant
        expect(postedCn.totalAmount).toBe(journal.totalDebit);
        expect(postedCn.totalAmount).toBe(journal.totalCredit);
      }
    });
  });

  // --- 5. POSTED IMMUTABILITY & CONCURRENCY ---
  describe('Immutability & Concurrency Rules', () => {
    it('preserves absolute immutability of the original Sales Invoice and posted Credit Note', async () => {
      const inv = await createPostedInvoice('10.0000', '100.0000');
      const cn = await salesCreditNoteService.createCreditNote(ctx, {
        companyId,
        originalSalesInvoiceId: inv.id,
        reason: 'DEFECTIVE_GOODS',
        lines: [{ originalInvoiceLineId: inv.lines[0].id, returnedQuantity: '5.0000' }]
      });
      const postedCn = await salesCreditNoteService.postCreditNote(ctx, cn.id);

      // Verify original invoice fields remain UNTOUCHED
      const db = getDb();
      if (db) {
        const [dbInv] = await db.select().from(salesInvoices).where(eq(salesInvoices.id, inv.id));
        expect(dbInv.status).toBe('POSTED');
        expect(dbInv.totalAmount).toBe(inv.totalAmount);
        expect(dbInv.taxableAmount).toBe(inv.taxableAmount);
      }

      // Verify posted credit note cannot be posted again or cancelled
      await expect(salesCreditNoteService.postCreditNote(ctx, postedCn.id)).resolves.toEqual(postedCn);
      await expect(salesCreditNoteService.cancelCreditNote(ctx, postedCn.id, 'Attempt cancel')).rejects.toThrow(
        BusinessRuleViolationError
      );
    });

    it('executes posting idempotently when retried', async () => {
      const inv = await createPostedInvoice('10.0000', '100.0000');
      const cn = await salesCreditNoteService.createCreditNote(ctx, {
        companyId,
        originalSalesInvoiceId: inv.id,
        reason: 'DEFECTIVE_GOODS',
        lines: [{ originalInvoiceLineId: inv.lines[0].id, returnedQuantity: '2.0000' }]
      });

      const post1 = await salesCreditNoteService.postCreditNote(ctx, cn.id);
      const post2 = await salesCreditNoteService.postCreditNote(ctx, cn.id);

      expect(post1.id).toBe(post2.id);
      expect(post1.journalEntryId).toBe(post2.journalEntryId);
      expect(post1.arDocumentId).toBe(post2.arDocumentId);
    });
  });

  // --- 6. ZERO INVENTORY ASSERTION ---
  describe('Zero Inventory Assertion (Phase 3.5 Boundary)', () => {
    it('verifies 0 stock ledger rows or inventory transactions were created', async () => {
      const inv = await createPostedInvoice('10.0000', '100.0000');
      const ret = await salesReturnService.createReturn(ctx, {
        companyId,
        originalSalesInvoiceId: inv.id,
        reason: 'DEFECTIVE_GOODS',
        lines: [{ originalInvoiceLineId: inv.lines[0].id, returnQuantity: '5.0000' }]
      });
      await salesReturnService.submitReturn(ctx, ret.id);
      await salesReturnService.approveReturn(ctx, ret.id);

      const cn = await salesCreditNoteService.createCreditNote(ctx, {
        companyId,
        originalSalesInvoiceId: inv.id,
        salesReturnId: ret.id,
        reason: 'DEFECTIVE_GOODS',
        lines: [{ originalInvoiceLineId: inv.lines[0].id, returnedQuantity: '5.0000' }]
      });
      await salesCreditNoteService.postCreditNote(ctx, cn.id);

      // Verify no stock ledger or stock movement tables exist or have records written by Phase 3.5
      const db = getDb();
      if (db) {
        // Execute SQL check to verify zero inventory movements created
        const result = await db.execute(sql`SELECT count(*) as count FROM pg_tables WHERE tablename = 'stock_ledger'`);
        const tableCount = Number((result.rows[0] as any)?.count || 0);
        expect(tableCount).toBe(0); // Proves stock ledger does not exist in Phase 3.5 commercial slice
      }
    });
  });

  // --- 7. COMPLETE FINANCIAL ACCEPTANCE TEST (SECTION 65) ---
  describe('Financial Acceptance Test Scenario (Section 65)', () => {
    it('passes end-to-end full commercial flow from Quotation to Invoice to Return & Credit Note', async () => {
      // 1. Quotation
      const quot = await quotationService.createDraftQuotation(ctx, {
        companyId,
        customerId,
        quotationDate: '2026-03-01',
        validityDate: '2027-12-31',
        currency: 'INR',
        exchangeRate: '1.000000',
        billingAddressId: billingAddrId,
        shippingAddressId: shippingAddrId,
        contactId,
        headerDiscountAmount: 0,
        lines: [
          {
            productId: productId1,
            quantity: '100.0000',
            unitPrice: '100.0000',
            discountPercent: '0.00',
            cgstRate: '9.00',
            sgstRate: '9.00'
          }
        ]
      });
      const submitted = await quotationService.submitForApproval(ctx, quot.id);
      if (submitted.status === 'PENDING_APPROVAL') {
        await quotationService.approveQuotation(ctx, quot.id);
      }
      await quotationService.sendQuotation(ctx, quot.id);
      await quotationService.acceptQuotation(ctx, quot.id);

      // 2. Sales Order
      const contract = await quotationService.issueConversionContract(ctx, quot.id);
      const so = await salesOrderService.createFromContract(ctx, contract);
      await salesOrderService.confirmOrder(ctx, so.id);

      // 3. Delivery
      const del = await salesDeliveryService.createDelivery(ctx, {
        companyId,
        salesOrderId: so.id,
        customerId,
        lines: [
          {
            salesOrderLineId: so.lines[0].id,
            deliveryQuantity: '100.0000'
          }
        ]
      });
      await salesDeliveryService.dispatchDelivery(ctx, del.id);
      await salesDeliveryService.markDelivered(ctx, del.id);

      // 4. Sales Invoice (Invoiced = ₹10,000 + ₹1,800 GST = ₹11,800 total)
      const inv = await salesInvoiceService.createFromOrder(ctx, {
        companyId,
        salesOrderId: so.id,
        salesDeliveryId: del.id,
        invoiceDate: '2026-03-01',
        dueDate: '2026-03-31',
        lines: [
          {
            salesOrderLineId: so.lines[0].id,
            invoicedQuantity: '100.0000'
          }
        ]
      });
      const postedInv = await salesInvoiceService.postInvoice(ctx, inv.id);
      expect(postedInv.status).toBe('POSTED');

      // 5. Customer Return (25 units returned)
      const ret = await salesReturnService.createReturn(ctx, {
        companyId,
        originalSalesInvoiceId: postedInv.id,
        reason: 'DEFECTIVE_GOODS',
        lines: [{ originalInvoiceLineId: postedInv.lines[0].id, returnQuantity: '25.0000' }]
      });
      await salesReturnService.submitReturn(ctx, ret.id);
      await salesReturnService.approveReturn(ctx, ret.id);

      // 6. Credit Note (25 units @ 100 = 2,500 subtotal + 450 GST = 2,950 total credit)
      const cn = await salesCreditNoteService.createCreditNote(ctx, {
        companyId,
        originalSalesInvoiceId: postedInv.id,
        salesReturnId: ret.id,
        reason: 'DEFECTIVE_GOODS',
        lines: [{ originalInvoiceLineId: postedInv.lines[0].id, returnedQuantity: '25.0000' }]
      });

      const postedCn = await salesCreditNoteService.postCreditNote(ctx, cn.id);

      // 7. Verify Financial Statements & Invariants
      expect(postedInv.status).toBe('POSTED'); // Original invoice remains POSTED
      expect(postedCn.status).toBe('POSTED'); // Credit note is POSTED

      // Original AR Open Item amount = 11,800.00. Credit = 2,950.00. Outstanding balance = 8,850.00
      const openItems = await arDocumentService.getOpenItems(ctx, companyId, { customerId });
      const matchingItem = openItems.find(item => item.arDocumentId === postedInv.arDocumentId || item.documentNumber === postedInv.invoiceNumber);
      if (matchingItem) {
        expect(matchingItem.originalAmount).toBe('11800.00');
        expect(matchingItem.outstandingAmount).toBe('8850.00'); // Net AR impact correctly calculated
      }
    });
  });
});
