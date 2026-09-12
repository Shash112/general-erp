import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext } from '@general-erp/core';
import { purchaseRequestService } from '../src/modules/procurement/purchase-request.service.js';
import { purchaseOrderService } from '../src/modules/procurement/purchase-order.service.js';
import { goodsReceiptService } from '../src/modules/procurement/goods-receipt.service.js';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { productService } from '../src/modules/commercial/product.service.js';
import { supplierService } from '../src/modules/commercial/supplier.service.js';
import { numberingEngine } from '../src/platform/numbering/numbering.service.js';
import {
  getDb,
  glJournals,
  apOpenItems,
  eq,
  and,
} from '@general-erp/database';

describe('Phase 3.8 — Goods Receipt Notes (GRN), Inventory Receiving & Inspection Suite', () => {
  let ctx: RequestContext;
  let tenantId: string;
  let companyId: string;
  let productId1: string;
  let supplierIdA: string;

  beforeEach(async () => {
    purchaseRequestService.clearMemoryStores();
    purchaseOrderService.clearMemoryStores();
    goodsReceiptService.clearMemoryStores();
    masterDataService.clear();
    numberingEngine.clear();

    const timestamp = Date.now() + Math.floor(Math.random() * 100000);
    tenantId = `tenant_grn_${timestamp}`;
    companyId = `cmp_grn_${timestamp}`;

    ctx = {
      requestId: `req_grn_${timestamp}`,
      tenantId,
      companyId,
      ip: '127.0.0.1',
      userAgent: 'vitest-agent',
      timestamp: new Date(),
      userId: `user_grn_${timestamp}`,
      user: {
        userId: `user_grn_${timestamp}`,
        email: 'receiver@test.local',
        tenantId,
        companyId,
        roles: ['procurement_user', 'warehouse_user'],
        permissions: ['*'],
      },
    };

    // Setup Master Data Company
    await masterDataService.createCompany(ctx, {
      id: companyId,
      name: 'Receiving Logistics Corp',
      legalName: 'Receiving Logistics Corp Private Limited',
      currency: 'INR',
    });

    // Create Product
    const prod = await productService.createProduct(ctx, {
      companyId,
      name: 'Industrial Bearings 50mm',
      code: `PRD-BRG-${timestamp}`,
      sku: `SKU-BRG-${timestamp}`,
      productType: 'GOODS',
      baseUom: 'PCS',
      purchasePrice: '250.00',
      isPurchasable: true,
    });
    productId1 = prod.id;

    // Create Supplier
    const supp = await supplierService.createSupplier(ctx, {
      companyId,
      name: 'Apex Industrial Parts Suppliers',
      code: `SUPP-APEX-${timestamp}`,
      currency: 'INR',
    });
    supplierIdA = supp.id;
  });

  it('1. End-to-End GRN Flow: PO -> GRN -> Inspection -> Acceptance -> PO Completion', async () => {
    // Step 1: Create & Issue Purchase Order (100 units)
    const { po } = await purchaseOrderService.createPurchaseOrder(ctx, {
      companyId,
      supplierId: supplierIdA,
      expectedDeliveryDate: '2026-11-15',
      lines: [
        {
          productId: productId1,
          productCodeSnapshot: 'PRD-BRG',
          productNameSnapshot: 'Industrial Bearings 50mm',
          description: 'Industrial Bearings 50mm High-Speed',
          uom: 'PCS',
          orderedQuantity: '100.0000',
          unitPrice: '250.00',
        },
      ],
    });

    await purchaseOrderService.submitPurchaseOrder(ctx, po.id);
    await purchaseOrderService.approvePurchaseOrder(ctx, po.id);
    await purchaseOrderService.issuePurchaseOrder(ctx, po.id);
    await purchaseOrderService.acknowledgePurchaseOrder(ctx, po.id);

    // Step 2: Create Goods Receipt Note (100 units received, inspection required)
    const poDetails = await purchaseOrderService.getPurchaseOrderById(ctx, po.id);
    const poLine = poDetails.lines[0];

    const grn = await goodsReceiptService.createGoodsReceipt(ctx, {
      companyId,
      purchaseOrderId: po.id,
      supplierId: supplierIdA,
      receiptDate: '2026-11-10',
      warehouseId: 'MAIN-WH',
      receivingLocationId: 'DOCK-1',
      supplierDeliveryNoteNumber: 'DN-APEX-9001',
      lines: [
        {
          purchaseOrderLineId: poLine.id,
          productId: productId1,
          descriptionSnapshot: poLine.description,
          uom: 'PCS',
          receivedQuantity: '100.0000',
          inspectionRequired: true,
        },
      ],
    });

    expect(grn.grnNumber).toMatch(/^(GRN|GOO)-/);
    expect(grn.status).toBe('INSPECTION_PENDING');
    expect(grn.inspectionStatus).toBe('PENDING');

    // Step 3: Perform Quality Inspection (95 accepted, 5 rejected due to dent)
    const inspectedGrn = await goodsReceiptService.inspectGoodsReceipt(ctx, grn.id, {
      lines: [
        {
          lineId: grn.lines[0].id,
          acceptedQuantity: '95.0000',
          rejectedQuantity: '5.0000',
          rejectionReason: 'Superficial shipping dent on 5 units',
        },
      ],
    });

    expect(inspectedGrn.inspectionStatus).toBe('PARTIALLY_PASSED');

    // Step 4: Formally Accept GRN
    const acceptedGrn = await goodsReceiptService.acceptGoodsReceipt(ctx, grn.id);
    expect(acceptedGrn.status).toBe('PARTIALLY_ACCEPTED');

    // Step 5: Verify PO Counters & Status
    const updatedPoDetails = await purchaseOrderService.getPurchaseOrderById(ctx, po.id);
    expect(updatedPoDetails.lines[0].receivedQuantity).toBe('100.0000');
    expect(updatedPoDetails.lines[0].acceptedQuantity).toBe('95.0000');
    expect(updatedPoDetails.po.status).toBe('COMPLETED');
  });

  it('2. Partial Receiving across multiple GRNs and over-receiving block', async () => {
    // Create PO for 100 units
    const { po } = await purchaseOrderService.createPurchaseOrder(ctx, {
      companyId,
      supplierId: supplierIdA,
      expectedDeliveryDate: '2026-11-20',
      lines: [
        {
          productId: productId1,
          description: 'Industrial Bearings',
          uom: 'PCS',
          orderedQuantity: '100.0000',
          unitPrice: '250.00',
        },
      ],
    });
    await purchaseOrderService.submitPurchaseOrder(ctx, po.id);
    await purchaseOrderService.approvePurchaseOrder(ctx, po.id);
    await purchaseOrderService.issuePurchaseOrder(ctx, po.id);

    const poDetails = await purchaseOrderService.getPurchaseOrderById(ctx, po.id);
    const poLine = poDetails.lines[0];

    // GRN 1: Receive 40 units
    const grn1 = await goodsReceiptService.createGoodsReceipt(ctx, {
      companyId,
      purchaseOrderId: po.id,
      receiptDate: '2026-11-05',
      lines: [
        {
          purchaseOrderLineId: poLine.id,
          uom: 'PCS',
          receivedQuantity: '40.0000',
          acceptedQuantity: '40.0000',
          rejectedQuantity: '0.0000',
        },
      ],
    });
    await goodsReceiptService.acceptGoodsReceipt(ctx, grn1.id);

    let currentPoDetails = await purchaseOrderService.getPurchaseOrderById(ctx, po.id);
    expect(currentPoDetails.lines[0].receivedQuantity).toBe('40.0000');
    expect(currentPoDetails.po.status).toBe('PARTIALLY_RECEIVED');

    // GRN 2: Receive remaining 60 units
    const grn2 = await goodsReceiptService.createGoodsReceipt(ctx, {
      companyId,
      purchaseOrderId: po.id,
      receiptDate: '2026-11-08',
      lines: [
        {
          purchaseOrderLineId: poLine.id,
          uom: 'PCS',
          receivedQuantity: '60.0000',
          acceptedQuantity: '60.0000',
          rejectedQuantity: '0.0000',
        },
      ],
    });
    await goodsReceiptService.acceptGoodsReceipt(ctx, grn2.id);

    currentPoDetails = await purchaseOrderService.getPurchaseOrderById(ctx, po.id);
    expect(currentPoDetails.lines[0].receivedQuantity).toBe('100.0000');
    expect(currentPoDetails.po.status).toBe('COMPLETED');

    // GRN 3: Attempt to over-receive 1 unit (should throw error)
    await expect(
      goodsReceiptService.createGoodsReceipt(ctx, {
        companyId,
        purchaseOrderId: po.id,
        receiptDate: '2026-11-09',
        lines: [
          {
            purchaseOrderLineId: poLine.id,
            uom: 'PCS',
            receivedQuantity: '1.0000',
          },
        ],
      })
    ).rejects.toThrow(/exceeds remaining receivable quantity|in status 'COMPLETED'/);
  });

  it('3. Quantity reconciliation and rejection reason validation', async () => {
    const { po } = await purchaseOrderService.createPurchaseOrder(ctx, {
      companyId,
      supplierId: supplierIdA,
      expectedDeliveryDate: '2026-11-20',
      lines: [
        {
          productId: productId1,
          description: 'Industrial Bearings',
          uom: 'PCS',
          orderedQuantity: '50.0000',
          unitPrice: '250.00',
        },
      ],
    });
    await purchaseOrderService.submitPurchaseOrder(ctx, po.id);
    await purchaseOrderService.approvePurchaseOrder(ctx, po.id);
    await purchaseOrderService.issuePurchaseOrder(ctx, po.id);

    const poDetails = await purchaseOrderService.getPurchaseOrderById(ctx, po.id);
    const poLine = poDetails.lines[0];

    // Invalid math: received 50 != accepted 40 + rejected 5 (45 != 50)
    await expect(
      goodsReceiptService.createGoodsReceipt(ctx, {
        companyId,
        purchaseOrderId: po.id,
        receiptDate: '2026-11-05',
        lines: [
          {
            purchaseOrderLineId: poLine.id,
            uom: 'PCS',
            receivedQuantity: '50.0000',
            acceptedQuantity: '40.0000',
            rejectedQuantity: '5.0000',
          },
        ],
      })
    ).rejects.toThrow(/must equal Received quantity/);

    // Rejected quantity > 0 but missing rejection reason
    await expect(
      goodsReceiptService.createGoodsReceipt(ctx, {
        companyId,
        purchaseOrderId: po.id,
        receiptDate: '2026-11-05',
        lines: [
          {
            purchaseOrderLineId: poLine.id,
            uom: 'PCS',
            receivedQuantity: '50.0000',
            acceptedQuantity: '40.0000',
            rejectedQuantity: '10.0000',
            rejectionReason: '',
          },
        ],
      })
    ).rejects.toThrow(/Rejection reason is required/);
  });

  it('4. GRN Cancellation & PO Counter Rollback', async () => {
    const { po } = await purchaseOrderService.createPurchaseOrder(ctx, {
      companyId,
      supplierId: supplierIdA,
      expectedDeliveryDate: '2026-11-20',
      lines: [
        {
          productId: productId1,
          description: 'Industrial Bearings',
          uom: 'PCS',
          orderedQuantity: '50.0000',
          unitPrice: '250.00',
        },
      ],
    });
    await purchaseOrderService.submitPurchaseOrder(ctx, po.id);
    await purchaseOrderService.approvePurchaseOrder(ctx, po.id);
    await purchaseOrderService.issuePurchaseOrder(ctx, po.id);

    const poDetails = await purchaseOrderService.getPurchaseOrderById(ctx, po.id);
    const poLine = poDetails.lines[0];

    const grn = await goodsReceiptService.createGoodsReceipt(ctx, {
      companyId,
      purchaseOrderId: po.id,
      receiptDate: '2026-11-05',
      lines: [
        {
          purchaseOrderLineId: poLine.id,
          uom: 'PCS',
          receivedQuantity: '30.0000',
          acceptedQuantity: '30.0000',
          rejectedQuantity: '0.0000',
        },
      ],
    });
    await goodsReceiptService.acceptGoodsReceipt(ctx, grn.id);

    let currentPo = await purchaseOrderService.getPurchaseOrderById(ctx, po.id);
    expect(currentPo.lines[0].receivedQuantity).toBe('30.0000');
    expect(currentPo.po.status).toBe('PARTIALLY_RECEIVED');

    // Cancel GRN
    await goodsReceiptService.cancelGoodsReceipt(ctx, grn.id, 'Wrong batch delivered by supplier');

    currentPo = await purchaseOrderService.getPurchaseOrderById(ctx, po.id);
    expect(currentPo.lines[0].receivedQuantity).toBe('0.0000');
    expect(currentPo.po.status).toBe('ISSUED');
  });

  it('5. ABSOLUTE ZERO FINANCIAL & INVENTORY BOUNDARY ASSERTION', async () => {
    const db = getDb();

    // Create PO and complete GRN flow
    const { po } = await purchaseOrderService.createPurchaseOrder(ctx, {
      companyId,
      supplierId: supplierIdA,
      expectedDeliveryDate: '2026-11-20',
      lines: [
        {
          productId: productId1,
          description: 'Industrial Bearings',
          uom: 'PCS',
          orderedQuantity: '20.0000',
          unitPrice: '250.00',
        },
      ],
    });
    await purchaseOrderService.submitPurchaseOrder(ctx, po.id);
    await purchaseOrderService.approvePurchaseOrder(ctx, po.id);
    await purchaseOrderService.issuePurchaseOrder(ctx, po.id);

    const poDetails = await purchaseOrderService.getPurchaseOrderById(ctx, po.id);
    const poLine = poDetails.lines[0];

    const grn = await goodsReceiptService.createGoodsReceipt(ctx, {
      companyId,
      purchaseOrderId: po.id,
      receiptDate: '2026-11-05',
      lines: [
        {
          purchaseOrderLineId: poLine.id,
          uom: 'PCS',
          receivedQuantity: '20.0000',
          acceptedQuantity: '20.0000',
        },
      ],
    });
    await goodsReceiptService.acceptGoodsReceipt(ctx, grn.id);

    if (db) {
      // Assert 0 GL journals created
      const journals = await db
        .select()
        .from(glJournals)
        .where(and(eq(glJournals.tenantId, tenantId), eq(glJournals.companyId, companyId)));
      expect(journals).toHaveLength(0);

      // Assert 0 AP Open Items created
      const apItems = await db
        .select()
        .from(apOpenItems)
        .where(and(eq(apOpenItems.tenantId, tenantId), eq(apOpenItems.companyId, companyId)));
      expect(apItems).toHaveLength(0);
    }
  });

  it('6. Multi-tenant and Multi-company isolation security', async () => {
    const { po } = await purchaseOrderService.createPurchaseOrder(ctx, {
      companyId,
      supplierId: supplierIdA,
      expectedDeliveryDate: '2026-11-20',
      lines: [
        {
          productId: productId1,
          description: 'Industrial Bearings',
          uom: 'PCS',
          orderedQuantity: '10.0000',
          unitPrice: '250.00',
        },
      ],
    });
    await purchaseOrderService.submitPurchaseOrder(ctx, po.id);
    await purchaseOrderService.approvePurchaseOrder(ctx, po.id);
    await purchaseOrderService.issuePurchaseOrder(ctx, po.id);

    const poDetails = await purchaseOrderService.getPurchaseOrderById(ctx, po.id);
    const poLine = poDetails.lines[0];

    const rogueCtx: RequestContext = {
      ...ctx,
      tenantId: 'rogue_tenant_xyz',
      companyId: 'rogue_company_xyz',
      user: {
        ...ctx.user,
        tenantId: 'rogue_tenant_xyz',
        companyId: 'rogue_company_xyz',
      },
    };

    await expect(
      goodsReceiptService.createGoodsReceipt(rogueCtx, {
        companyId: 'rogue_company_xyz',
        purchaseOrderId: po.id,
        receiptDate: '2026-11-05',
        lines: [
          {
            purchaseOrderLineId: poLine.id,
            uom: 'PCS',
            receivedQuantity: '10.0000',
          },
        ],
      })
    ).rejects.toThrow();
  });
});
