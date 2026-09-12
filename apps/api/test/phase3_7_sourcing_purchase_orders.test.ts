import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext, ValidationError, BusinessRuleViolationError } from '@general-erp/core';
import { purchaseRequestService } from '../src/modules/procurement/purchase-request.service.js';
import { sourcingService } from '../src/modules/procurement/sourcing.service.js';
import { purchaseOrderService } from '../src/modules/procurement/purchase-order.service.js';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { productService } from '../src/modules/commercial/product.service.js';
import { supplierService } from '../src/modules/commercial/supplier.service.js';
import { numberingEngine } from '../src/platform/numbering/numbering.service.js';
import {
  getDb,
  glJournals,
  apOpenItems,
  eq,
  and
} from '@general-erp/database';

describe('Phase 3.7 — Sourcing, RFQs, Supplier Quotations & Purchase Orders Suite', () => {
  let ctx: RequestContext;
  let tenantId: string;
  let companyId: string;
  let productId1: string;
  let productId2: string;
  let supplierIdA: string;
  let supplierIdB: string;

  beforeEach(async () => {
    purchaseRequestService.clearMemoryStores();
    masterDataService.clear();
    numberingEngine.clear();

    const timestamp = Date.now() + Math.floor(Math.random() * 100000);
    tenantId = `tenant_po_${timestamp}`;
    companyId = `cmp_po_${timestamp}`;

    ctx = {
      requestId: `req_po_${timestamp}`,
      tenantId,
      companyId,
      ip: '127.0.0.1',
      userAgent: 'vitest-agent',
      timestamp: new Date(),
      userId: `user_po_${timestamp}`,
      user: {
        userId: `user_po_${timestamp}`,
        email: 'buyer@test.local',
        tenantId,
        companyId,
        roles: ['procurement_user'],
        permissions: ['*']
      }
    };

    // Setup Master Data Company
    await masterDataService.createCompany(ctx, {
      id: companyId,
      name: 'Industrial Sourcing Corp',
      legalName: 'Industrial Sourcing Corp Private Limited',
      currency: 'INR'
    });

    // Create Products
    const prod1 = await productService.createProduct(ctx, {
      companyId,
      name: 'High-Grade Steel Alloy Rods 10mm',
      code: `PRD-STL-${timestamp}`,
      sku: `SKU-STL-${timestamp}`,
      productType: 'GOODS',
      baseUom: 'PCS',
      purchasePrice: '500.00',
      isPurchasable: true
    });
    productId1 = prod1.id;

    const prod2 = await productService.createProduct(ctx, {
      companyId,
      name: 'Precision Hydraulic Valves',
      code: `PRD-VLV-${timestamp}`,
      sku: `SKU-VLV-${timestamp}`,
      productType: 'GOODS',
      baseUom: 'PCS',
      purchasePrice: '1200.00',
      isPurchasable: true
    });
    productId2 = prod2.id;

    // Create Suppliers
    const suppA = await supplierService.createSupplier(ctx, {
      companyId,
      name: 'Alpha Metal Suppliers Ltd',
      code: `SUPP-ALPHA-${timestamp}`,
      currency: 'INR'
    });
    supplierIdA = suppA.id;

    const suppB = await supplierService.createSupplier(ctx, {
      companyId,
      name: 'Beta Engineering Works',
      code: `SUPP-BETA-${timestamp}`,
      currency: 'INR'
    });
    supplierIdB = suppB.id;
  });

  it('1. Complete Sourcing Flow: PR -> RFQ -> Supplier Quotes -> Comparison -> Award -> PO', async () => {
    // Step 1: Create & Approve Purchase Request
    const pr = await purchaseRequestService.createPurchaseRequest(ctx, {
      companyId,
      requiredDate: '2026-10-20',
      priority: 'HIGH',
      purpose: 'Q4 Assembly Sourcing',
      lines: [
        {
          productId: productId1,
          description: 'Steel Alloy Rod 10mm',
          requestedQuantity: '100.0000',
          uom: 'PCS',
          estimatedUnitPrice: '500.00'
        }
      ]
    });
    await purchaseRequestService.submitPurchaseRequest(ctx, pr.id);
    await purchaseRequestService.approvePurchaseRequest(ctx, pr.id);

    // Step 2: Create & Publish RFQ
    const { rfq, lines: rfqLines } = await sourcingService.createRfq(ctx, {
      companyId,
      purchaseRequestId: pr.id,
      responseDueDate: '2026-10-05',
      title: 'RFQ for Q4 Assembly Rods',
      invitedSupplierIds: [supplierIdA, supplierIdB],
      lines: [
        {
          purchaseRequestLineId: pr.lines[0].id,
          productId: productId1,
          description: 'Steel Alloy Rod 10mm',
          requestedQuantity: '100.0000',
          uom: 'PCS'
        }
      ]
    });
    expect(rfq.status).toBe('DRAFT');

    const publishedRfq = await sourcingService.publishRfq(ctx, rfq.id);
    expect(publishedRfq.status).toBe('PUBLISHED');

    // Step 3: Log Supplier Quotations
    const quoteA = await sourcingService.createSupplierQuotation(ctx, {
      companyId,
      supplierId: supplierIdA,
      rfqId: rfq.id,
      supplierQuoteNumber: 'SQ-ALPHA-991',
      validUntil: '2026-10-30',
      lines: [
        {
          rfqLineId: rfqLines[0].id,
          productId: productId1,
          description: 'Steel Alloy Rod 10mm',
          quotedQuantity: '100.0000',
          uom: 'PCS',
          unitPrice: '480.00',
          tax: '0.00',
          leadTimeDays: 5
        }
      ]
    });
    expect(quoteA.quotation.subtotal).toBe('48000.00');

    const quoteB = await sourcingService.createSupplierQuotation(ctx, {
      companyId,
      supplierId: supplierIdB,
      rfqId: rfq.id,
      supplierQuoteNumber: 'SQ-BETA-771',
      validUntil: '2026-10-30',
      lines: [
        {
          rfqLineId: rfqLines[0].id,
          productId: productId1,
          description: 'Steel Alloy Rod 10mm',
          quotedQuantity: '100.0000',
          uom: 'PCS',
          unitPrice: '465.00',
          tax: '0.00',
          leadTimeDays: 7
        }
      ]
    });
    expect(quoteB.quotation.subtotal).toBe('46500.00');

    // Step 4: Build Comparison & Award Supplier B
    const comp = await sourcingService.buildComparison(ctx, rfq.id);
    expect(comp.comparison.status).toBe('EVALUATED');

    const awarded = await sourcingService.awardQuotation(ctx, {
      comparisonId: comp.comparison.id,
      awardedSupplierId: supplierIdB,
      awardedLineIds: [
        {
          rfqLineId: rfqLines[0].id,
          supplierQuotationLineId: quoteB.lines[0].id,
          awardQuantity: '100.0000'
        }
      ]
    });
    expect(awarded.comparison.status).toBe('AWARDED');

    // Step 5: Create PO from Awarded Quotation
    const poResult = await purchaseOrderService.createPurchaseOrder(ctx, {
      companyId,
      supplierId: supplierIdB,
      purchaseRequestId: pr.id,
      rfqId: rfq.id,
      supplierQuotationId: quoteB.quotation.id,
      comparisonId: comp.comparison.id,
      expectedDeliveryDate: '2026-10-12',
      lines: [
        {
          purchaseRequestLineId: pr.lines[0].id,
          rfqLineId: rfqLines[0].id,
          supplierQuotationLineId: quoteB.lines[0].id,
          productId: productId1,
          productCodeSnapshot: `PRD-STL`,
          productNameSnapshot: 'Steel Alloy Rod 10mm',
          description: 'Steel Alloy Rod 10mm',
          uom: 'PCS',
          orderedQuantity: '100.0000',
          unitPrice: '465.00',
          taxRate: '18.00'
        }
      ]
    });

    const { po } = poResult;
    expect(po.status).toBe('DRAFT');
    expect(po.poNumber).toMatch(/^(PO|PUR)-/);
    // Taxable: 100 * 465 = 46500.00, Tax 18% = 8370.00, Grand Total = 54870.00
    expect(po.taxableAmount).toBe('46500.00');
    expect(po.tax).toBe('8370.00');
    expect(po.grandTotal).toBe('54870.00');

    // Step 6: PO Lifecycle (Submit -> Approve -> Issue -> Acknowledge)
    const submittedPo = await purchaseOrderService.submitPurchaseOrder(ctx, po.id);
    expect(submittedPo.status).toBe('SUBMITTED');

    const approvedPo = await purchaseOrderService.approvePurchaseOrder(ctx, po.id);
    expect(approvedPo.status).toBe('APPROVED');

    const issuedPo = await purchaseOrderService.issuePurchaseOrder(ctx, po.id);
    expect(issuedPo.status).toBe('ISSUED');

    const ackPo = await purchaseOrderService.acknowledgePurchaseOrder(ctx, po.id);
    expect(ackPo.status).toBe('ACKNOWLEDGED');
  });

  it('2. Direct PR to PO creation and PR remaining quantity tracking', async () => {
    const pr = await purchaseRequestService.createPurchaseRequest(ctx, {
      companyId,
      requiredDate: '2026-10-25',
      lines: [
        {
          productId: productId2,
          description: 'Precision Hydraulic Valve Type A',
          requestedQuantity: '50.0000',
          uom: 'PCS',
          estimatedUnitPrice: '1200.00'
        }
      ]
    });
    await purchaseRequestService.submitPurchaseRequest(ctx, pr.id);
    await purchaseRequestService.approvePurchaseRequest(ctx, pr.id);

    // Create partial PO 1 (30 units)
    await purchaseOrderService.createPurchaseOrder(ctx, {
      companyId,
      supplierId: supplierIdA,
      purchaseRequestId: pr.id,
      expectedDeliveryDate: '2026-10-15',
      lines: [
        {
          purchaseRequestLineId: pr.lines[0].id,
          productId: productId2,
          description: 'Precision Hydraulic Valve Type A',
          uom: 'PCS',
          orderedQuantity: '30.0000',
          unitPrice: '1150.00'
        }
      ]
    });

    const updatedPr = await purchaseRequestService.getPurchaseRequestById(ctx, pr.id);
    expect(updatedPr.lines[0].orderedQuantity).toBe('30.0000');
    expect(updatedPr.lines[0].remainingQuantity).toBe('20.0000');
  });

  it('3. Reject PO creation if ordered quantity exceeds PR remaining quantity', async () => {
    const pr = await purchaseRequestService.createPurchaseRequest(ctx, {
      companyId,
      requiredDate: '2026-10-25',
      lines: [
        {
          productId: productId2,
          description: 'Precision Hydraulic Valve Type A',
          requestedQuantity: '10.0000',
          uom: 'PCS',
          estimatedUnitPrice: '1200.00'
        }
      ]
    });
    await purchaseRequestService.submitPurchaseRequest(ctx, pr.id);
    await purchaseRequestService.approvePurchaseRequest(ctx, pr.id);

    await expect(purchaseOrderService.createPurchaseOrder(ctx, {
      companyId,
      supplierId: supplierIdA,
      purchaseRequestId: pr.id,
      expectedDeliveryDate: '2026-10-15',
      lines: [
        {
          purchaseRequestLineId: pr.lines[0].id,
          productId: productId2,
          description: 'Precision Hydraulic Valve Type A',
          uom: 'PCS',
          orderedQuantity: '15.0000', // Exceeds 10 requested
          unitPrice: '1150.00'
        }
      ]
    })).rejects.toThrow(BusinessRuleViolationError);
  });

  it('4. Cancel PO and verify PR quantity reservation restoration', async () => {
    const pr = await purchaseRequestService.createPurchaseRequest(ctx, {
      companyId,
      requiredDate: '2026-10-25',
      lines: [
        {
          productId: productId1,
          description: 'Steel Rods',
          requestedQuantity: '20.0000',
          uom: 'PCS',
          estimatedUnitPrice: '500.00'
        }
      ]
    });
    await purchaseRequestService.submitPurchaseRequest(ctx, pr.id);
    await purchaseRequestService.approvePurchaseRequest(ctx, pr.id);

    const { po } = await purchaseOrderService.createPurchaseOrder(ctx, {
      companyId,
      supplierId: supplierIdA,
      purchaseRequestId: pr.id,
      expectedDeliveryDate: '2026-10-15',
      lines: [
        {
          purchaseRequestLineId: pr.lines[0].id,
          productId: productId1,
          description: 'Steel Rods',
          uom: 'PCS',
          orderedQuantity: '15.0000',
          unitPrice: '500.00'
        }
      ]
    });

    const prMid = await purchaseRequestService.getPurchaseRequestById(ctx, pr.id);
    expect(prMid.lines[0].orderedQuantity).toBe('15.0000');
    expect(prMid.lines[0].remainingQuantity).toBe('5.0000');

    // Cancel PO
    await purchaseOrderService.cancelPurchaseOrder(ctx, po.id, 'Supplier unable to meet delivery schedule');

    const prRestored = await purchaseRequestService.getPurchaseRequestById(ctx, pr.id);
    expect(prRestored.lines[0].orderedQuantity).toBe('0.0000');
    expect(prRestored.lines[0].remainingQuantity).toBe('20.0000');
  });

  it('5. ABSOLUTE ZERO FINANCIAL & INVENTORY BOUNDARY ASSERTION', async () => {
    const db = getDb();

    // Perform complete Sourcing & PO flow
    const pr = await purchaseRequestService.createPurchaseRequest(ctx, {
      companyId,
      requiredDate: '2026-12-01',
      lines: [{ productId: productId1, description: 'Steel', requestedQuantity: '10.0000', uom: 'PCS', estimatedUnitPrice: '500.00' }]
    });
    await purchaseRequestService.submitPurchaseRequest(ctx, pr.id);
    await purchaseRequestService.approvePurchaseRequest(ctx, pr.id);

    const { rfq, lines: rfqLines } = await sourcingService.createRfq(ctx, {
      companyId,
      purchaseRequestId: pr.id,
      responseDueDate: '2026-11-01',
      title: 'Zero Boundary RFQ',
      lines: [{ purchaseRequestLineId: pr.lines[0].id, description: 'Steel', requestedQuantity: '10.0000', uom: 'PCS' }]
    });
    await sourcingService.publishRfq(ctx, rfq.id);

    const quote = await sourcingService.createSupplierQuotation(ctx, {
      companyId,
      supplierId: supplierIdA,
      rfqId: rfq.id,
      supplierQuoteNumber: 'SQ-AUDIT-001',
      validUntil: '2026-11-15',
      lines: [{ rfqLineId: rfqLines[0].id, description: 'Steel', quotedQuantity: '10.0000', uom: 'PCS', unitPrice: '490.00' }]
    });

    const comp = await sourcingService.buildComparison(ctx, rfq.id);
    await sourcingService.awardQuotation(ctx, {
      comparisonId: comp.comparison.id,
      awardedSupplierId: supplierIdA,
      awardedLineIds: [{ rfqLineId: rfqLines[0].id, supplierQuotationLineId: quote.lines[0].id, awardQuantity: '10.0000' }]
    });

    const { po } = await purchaseOrderService.createPurchaseOrder(ctx, {
      companyId,
      supplierId: supplierIdA,
      rfqId: rfq.id,
      supplierQuotationId: quote.quotation.id,
      comparisonId: comp.comparison.id,
      expectedDeliveryDate: '2026-11-10',
      lines: [{ rfqLineId: rfqLines[0].id, supplierQuotationLineId: quote.lines[0].id, description: 'Steel', uom: 'PCS', orderedQuantity: '10.0000', unitPrice: '490.00' }]
    });

    await purchaseOrderService.submitPurchaseOrder(ctx, po.id);
    await purchaseOrderService.approvePurchaseOrder(ctx, po.id);
    await purchaseOrderService.issuePurchaseOrder(ctx, po.id);
    await purchaseOrderService.acknowledgePurchaseOrder(ctx, po.id);

    if (db) {
      // Assert 0 GL journals created
      const journals = await db.select().from(glJournals).where(
        and(eq(glJournals.tenantId, tenantId), eq(glJournals.companyId, companyId))
      );
      expect(journals).toHaveLength(0);

      // Assert 0 AP Open Items created
      const apItems = await db.select().from(apOpenItems).where(
        and(eq(apOpenItems.tenantId, tenantId), eq(apOpenItems.companyId, companyId))
      );
      expect(apItems).toHaveLength(0);
    }
  });
});
