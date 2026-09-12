import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext } from '@general-erp/core';
import { purchaseOrderService } from '../src/modules/procurement/purchase-order.service.js';
import { goodsReceiptService } from '../src/modules/procurement/goods-receipt.service.js';
import { supplierBillService } from '../src/modules/procurement/supplier-bill.service.js';
import { apDocumentService } from '../src/modules/finance/ap/ap-document.service.js';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { productService } from '../src/modules/commercial/product.service.js';
import { supplierService } from '../src/modules/commercial/supplier.service.js';
import { numberingEngine } from '../src/platform/numbering/numbering.service.js';

import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';

import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';

describe('Phase 3.9 — Supplier Billing, AP Integration & Three-Way Matching Suite', () => {
  let ctx: RequestContext;
  let tenantId: string;
  let companyId: string;
  let productId1: string;
  let supplierIdA: string;
  let supplierIdB: string;

  beforeEach(async () => {
    purchaseOrderService.clearMemoryStores();
    goodsReceiptService.clearMemoryStores();
    supplierBillService.clearMemoryStores();
    supplierService.clear();
    productService.clear();
    apDocumentService.clear();
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    masterDataService.clear();
    numberingEngine.clear();

    const timestamp = Date.now() + Math.floor(Math.random() * 100000);
    tenantId = `tenant_sb_${timestamp}`;
    companyId = `cmp_sb_${timestamp}`;

    ctx = {
      requestId: `req_sb_${timestamp}`,
      tenantId,
      companyId,
      ip: '127.0.0.1',
      userAgent: 'vitest-agent',
      timestamp: new Date(),
      userId: `user_sb_${timestamp}`,
      user: {
        userId: `user_sb_${timestamp}`,
        email: 'billing@test.local',
        tenantId,
        companyId,
        roles: ['procurement_user', 'finance_user'],
        permissions: ['*'],
      },
    };

    // Setup Master Data Company
    await masterDataService.createCompany(ctx, {
      id: companyId,
      name: 'Supplier Billing Corp',
      legalName: 'Supplier Billing Corp Private Limited',
      currency: 'INR',
    });

    // Provision Fiscal Year for AP/GL posting
    await fiscalPeriodService.createFiscalYear(ctx, {
      companyId,
      yearName: 'FY 2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });

    // Provision Chart of Accounts
    await chartOfAccountsService.applyTemplate(ctx, {
      companyId,
      templateId: 'INDIAN_SME_DEFAULT_V1',
    });

    // Create Product
    const prod = await productService.createProduct(ctx, {
      companyId,
      name: 'Precision Steel Valves 2-Inch',
      code: `PRD-VALVE-${timestamp}`,
      sku: `SKU-VALVE-${timestamp}`,
      productType: 'GOODS',
      baseUom: 'PCS',
      purchasePrice: '500.00',
      isPurchasable: true,
    });
    productId1 = prod.id;

    // Create Supplier A
    const suppA = await supplierService.createSupplier(ctx, {
      companyId,
      name: 'Apex Industrial Valves Supplier',
      code: `SUPP-APEX-${timestamp}`,
      currency: 'INR',
    });
    supplierIdA = suppA.id;

    // Create Supplier B
    const suppB = await supplierService.createSupplier(ctx, {
      companyId,
      name: 'Bharat Steel Tools Corp',
      code: `SUPP-BHARAT-${timestamp}`,
      currency: 'INR',
    });
    supplierIdB = suppB.id;
  });

  it('1. End-to-End Flow: PO -> GRN -> Supplier Bill -> 3-Way Match -> Approve -> Post (AP + GL)', async () => {
    // Step 1: Create & Issue PO (100 units @ ₹500 = ₹50,000)
    const { po, lines: poLines } = await purchaseOrderService.createPurchaseOrder(ctx, {
      companyId,
      supplierId: supplierIdA,
      expectedDeliveryDate: '2026-12-01',
      lines: [
        {
          productId: productId1,
          description: 'Precision Steel Valves 2-Inch',
          uom: 'PCS',
          orderedQuantity: '100.0000',
          unitPrice: '500.00',
        },
      ],
    });
    await purchaseOrderService.submitPurchaseOrder(ctx, po.id);
    await purchaseOrderService.approvePurchaseOrder(ctx, po.id);
    await purchaseOrderService.issuePurchaseOrder(ctx, po.id);

    // Step 2: Create & Accept GRN (100 units received & accepted)
    const grnResult = await goodsReceiptService.createGoodsReceipt(ctx, {
      companyId,
      purchaseOrderId: po.id,
      supplierId: supplierIdA,
      receiptDate: '2026-11-20',
      receivedBy: 'Warehouse Manager',
      lines: [
        {
          purchaseOrderLineId: poLines[0]!.id,
          productId: productId1,
          descriptionSnapshot: 'Precision Steel Valves 2-Inch',
          uom: 'PCS',
          receivedQuantity: '100.0000',
          acceptedQuantity: '100.0000',
          inspectionRequired: false,
        },
      ],
    });
    await goodsReceiptService.acceptGoodsReceipt(ctx, grnResult.id);

    // Step 3: Create Supplier Bill matching accepted GRN (100 units @ ₹500)
    const { bill, lines: billLines } = await supplierBillService.createSupplierBill(ctx, {
      companyId,
      supplierInvoiceNumber: 'INV-APEX-9001',
      supplierInvoiceDate: '2026-11-22',
      supplierId: supplierIdA,
      purchaseOrderId: po.id,
      primaryGrnId: grnResult.id,
      billDate: '2026-11-23',
      dueDate: '2026-12-23',
      lines: [
        {
          purchaseOrderLineId: poLines[0]!.id,
          goodsReceiptLineId: grnResult.lines[0]!.id,
          productId: productId1,
          descriptionSnapshot: 'Precision Steel Valves 2-Inch',
          uom: 'PCS',
          billedQuantity: '100.0000',
          unitPrice: '500.00',
          discount: '0.00',
          cgstAmount: '4500.00', // 9% CGST
          sgstAmount: '4500.00', // 9% SGST
        },
      ],
    });

    expect(bill.status).toBe('DRAFT');
    expect(bill.matchStatus).toBe('UNMATCHED');
    expect(bill.subtotal).toBe('50000.00');
    expect(bill.taxAmount).toBe('9000.00');
    expect(bill.grandTotal).toBe('59000.00');

    // Step 4: Perform Three-Way Match
    const matchResult = await supplierBillService.performThreeWayMatch(ctx, bill.id);
    expect(matchResult.matched).toBe(true);
    expect(matchResult.matchStatus).toBe('MATCHED');
    expect(matchResult.exceptions).toHaveLength(0);

    // Step 5: Approve Supplier Bill
    const approvedBill = await supplierBillService.approveSupplierBill(ctx, bill.id);
    expect(approvedBill.status).toBe('APPROVED');

    // Step 6: Post Supplier Bill to AP & GL
    const postResult = await supplierBillService.postSupplierBill(ctx, bill.id);
    expect(postResult.bill.status).toBe('POSTED');
    expect(postResult.bill.apDocumentId).toBeDefined();
    expect(postResult.bill.journalEntryId).toBeDefined();
    expect(postResult.apDocument.grossAmount).toBe('59000.00');
    expect(postResult.apDocument.status).toBe('POSTED');

    // Step 7: Verify Idempotent Re-Posting
    const rePostResult = await supplierBillService.postSupplierBill(ctx, bill.id);
    expect(rePostResult.bill.status).toBe('POSTED');
    expect(rePostResult.bill.apDocumentId).toBe(postResult.bill.apDocumentId);
  });

  it('2. Price Variance Match Exception & Authorized Exception Override', async () => {
    // Step 1: Create PO @ ₹100/unit
    const { po, lines: poLines } = await purchaseOrderService.createPurchaseOrder(ctx, {
      companyId,
      supplierId: supplierIdA,
      expectedDeliveryDate: '2026-12-01',
      lines: [
        {
          productId: productId1,
          description: 'Precision Steel Valves 2-Inch',
          uom: 'PCS',
          orderedQuantity: '50.0000',
          unitPrice: '100.00',
        },
      ],
    });
    await purchaseOrderService.submitPurchaseOrder(ctx, po.id);
    await purchaseOrderService.approvePurchaseOrder(ctx, po.id);
    await purchaseOrderService.issuePurchaseOrder(ctx, po.id);

    // Step 2: Create Supplier Bill @ ₹105/unit (5% higher price)
    const { bill, lines: billLines } = await supplierBillService.createSupplierBill(ctx, {
      companyId,
      supplierInvoiceNumber: 'INV-APEX-VARIANCE-01',
      supplierInvoiceDate: '2026-11-22',
      supplierId: supplierIdA,
      purchaseOrderId: po.id,
      billDate: '2026-11-23',
      dueDate: '2026-12-23',
      lines: [
        {
          purchaseOrderLineId: poLines[0]!.id,
          productId: productId1,
          descriptionSnapshot: 'Precision Steel Valves 2-Inch',
          uom: 'PCS',
          billedQuantity: '50.0000',
          unitPrice: '105.00', // ₹105 vs agreed ₹100
        },
      ],
    });

    // Step 3: Run Match with 0% tolerance -> Should trigger PRICE_VARIANCE exception
    const matchResult = await supplierBillService.performThreeWayMatch(ctx, bill.id, { priceTolerancePercent: 0.0 });
    expect(matchResult.matched).toBe(false);
    expect(matchResult.matchStatus).toBe('EXCEPTION');
    expect(matchResult.exceptions).toHaveLength(1);
    expect(matchResult.exceptions[0].exceptionType).toBe('PRICE_VARIANCE');

    // Step 4: Attempting to Approve un-overridden exception bill must fail
    await expect(supplierBillService.approveSupplierBill(ctx, bill.id)).rejects.toThrow(
      /unresolved match exceptions/
    );

    // Step 5: Authorize Override with mandatory reason
    const overrideResult = await supplierBillService.overrideMatchExceptions(ctx, bill.id, {
      reason: 'Approved price increase due to raw material surcharge agreed by VP Procurement.',
    });
    expect(overrideResult.matchStatus).toBe('RESOLVED');
    expect(overrideResult.status).toBe('MATCHED');

    // Step 6: Bill can now be approved & posted cleanly
    await supplierBillService.approveSupplierBill(ctx, bill.id);
    const postResult = await supplierBillService.postSupplierBill(ctx, bill.id);
    expect(postResult.bill.status).toBe('POSTED');
  });

  it('3. Quantity Variance Exception when Billed Quantity exceeds Accepted Receipt', async () => {
    // Step 1: Create PO for 100 units
    const { po, lines: poLines } = await purchaseOrderService.createPurchaseOrder(ctx, {
      companyId,
      supplierId: supplierIdA,
      expectedDeliveryDate: '2026-12-01',
      lines: [
        {
          productId: productId1,
          description: 'Precision Steel Valves 2-Inch',
          uom: 'PCS',
          orderedQuantity: '100.0000',
          unitPrice: '200.00',
        },
      ],
    });
    await purchaseOrderService.submitPurchaseOrder(ctx, po.id);
    await purchaseOrderService.approvePurchaseOrder(ctx, po.id);
    await purchaseOrderService.issuePurchaseOrder(ctx, po.id);

    // Step 2: GRN accepts 90 units (10 rejected)
    const grnResult = await goodsReceiptService.createGoodsReceipt(ctx, {
      companyId,
      purchaseOrderId: po.id,
      supplierId: supplierIdA,
      receiptDate: '2026-11-20',
      receivedBy: 'Inspector Johny',
      lines: [
        {
          purchaseOrderLineId: poLines[0]!.id,
          productId: productId1,
          descriptionSnapshot: 'Precision Steel Valves 2-Inch',
          uom: 'PCS',
          receivedQuantity: '100.0000',
          acceptedQuantity: '90.0000',
          rejectedQuantity: '10.0000',
          inspectionRequired: false,
          rejectionReason: '10 units damaged in transit',
        },
      ],
    });
    await goodsReceiptService.acceptGoodsReceipt(ctx, grnResult.id);

    // Step 3: Supplier bills full 100 units
    const { bill } = await supplierBillService.createSupplierBill(ctx, {
      companyId,
      supplierInvoiceNumber: 'INV-APEX-OVERBILL-100',
      supplierInvoiceDate: '2026-11-22',
      supplierId: supplierIdA,
      purchaseOrderId: po.id,
      primaryGrnId: grnResult.id,
      billDate: '2026-11-23',
      dueDate: '2026-12-23',
      lines: [
        {
          purchaseOrderLineId: poLines[0]!.id,
          goodsReceiptLineId: grnResult.lines[0]!.id,
          productId: productId1,
          descriptionSnapshot: 'Precision Steel Valves 2-Inch',
          uom: 'PCS',
          billedQuantity: '100.0000', // Billed 100 vs Accepted 90
          unitPrice: '200.00',
        },
      ],
    });

    // Step 4: Run Match -> Must trigger QUANTITY_VARIANCE exception
    const matchRes = await supplierBillService.performThreeWayMatch(ctx, bill.id, { quantityTolerancePercent: 0.0 });
    expect(matchRes.matched).toBe(false);
    expect(matchRes.exceptions[0].exceptionType).toBe('QUANTITY_VARIANCE');
    expect(matchRes.exceptions[0].expectedValue).toContain('90.0000');
    expect(matchRes.exceptions[0].actualValue).toContain('100.0000');
  });

  it('4. Duplicate Supplier Invoice Protection Scope Check', async () => {
    // Step 1: Create initial Supplier Bill with Invoice # 'INV-DUPLICATE-001' for Supplier A
    await supplierBillService.createSupplierBill(ctx, {
      companyId,
      supplierInvoiceNumber: 'INV-DUPLICATE-001',
      supplierInvoiceDate: '2026-11-22',
      supplierId: supplierIdA,
      billDate: '2026-11-23',
      dueDate: '2026-12-23',
      lines: [
        {
          descriptionSnapshot: 'Precision Steel Valves 2-Inch',
          uom: 'PCS',
          billedQuantity: '10.0000',
          unitPrice: '100.00',
        },
      ],
    });

    // Step 2: Attempting to create duplicate invoice number 'INV-DUPLICATE-001' for Supplier A MUST fail
    await expect(
      supplierBillService.createSupplierBill(ctx, {
        companyId,
        supplierInvoiceNumber: 'INV-DUPLICATE-001',
        supplierInvoiceDate: '2026-11-22',
        supplierId: supplierIdA,
        billDate: '2026-11-23',
        dueDate: '2026-12-23',
        lines: [
          {
            descriptionSnapshot: 'Precision Steel Valves 2-Inch',
            uom: 'PCS',
            billedQuantity: '10.0000',
            unitPrice: '100.00',
          },
        ],
      })
    ).rejects.toThrow(/already been billed for this supplier/);

    // Step 3: Different Supplier B using identical invoice number 'INV-DUPLICATE-001' MUST succeed
    const suppBBill = await supplierBillService.createSupplierBill(ctx, {
      companyId,
      supplierInvoiceNumber: 'INV-DUPLICATE-001',
      supplierInvoiceDate: '2026-11-22',
      supplierId: supplierIdB,
      billDate: '2026-11-23',
      dueDate: '2026-12-23',
      lines: [
        {
          descriptionSnapshot: 'Precision Steel Valves 2-Inch',
          uom: 'PCS',
          billedQuantity: '10.0000',
          unitPrice: '100.00',
        },
      ],
    });
    expect(suppBBill.bill.supplierId).toBe(supplierIdB);
  });

  it('5. Zero Inventory Side Effects & Immutable Cancel Protection', async () => {
    // Step 1: Create Bill
    const { bill } = await supplierBillService.createSupplierBill(ctx, {
      companyId,
      supplierInvoiceNumber: 'INV-IMMUTABLE-01',
      supplierInvoiceDate: '2026-11-22',
      supplierId: supplierIdA,
      billDate: '2026-11-23',
      dueDate: '2026-12-23',
      lines: [
        {
          descriptionSnapshot: 'Precision Steel Valves 2-Inch',
          uom: 'PCS',
          billedQuantity: '5.0000',
          unitPrice: '100.00',
        },
      ],
    });

    // Step 2: Match, Approve, Post
    await supplierBillService.performThreeWayMatch(ctx, bill.id);
    await supplierBillService.approveSupplierBill(ctx, bill.id);
    await supplierBillService.postSupplierBill(ctx, bill.id);

    // Step 3: Attempting to cancel POSTED bill must fail
    await expect(supplierBillService.cancelSupplierBill(ctx, bill.id, 'Wrong bill')).rejects.toThrow(
      /Cannot cancel POSTED Supplier Bill/
    );
  });
});
