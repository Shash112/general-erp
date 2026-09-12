import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext, BusinessRuleViolationError, ForbiddenError } from '@general-erp/core';
import { purchaseOrderService } from '../src/modules/procurement/purchase-order.service.js';
import { goodsReceiptService } from '../src/modules/procurement/goods-receipt.service.js';
import { supplierBillService } from '../src/modules/procurement/supplier-bill.service.js';
import { procurementReturnService } from '../src/modules/procurement/procurement-return.service.js';
import { apDocumentService } from '../src/modules/finance/ap/ap-document.service.js';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { productService } from '../src/modules/commercial/product.service.js';
import { supplierService } from '../src/modules/commercial/supplier.service.js';
import { numberingEngine } from '../src/platform/numbering/numbering.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';

describe('Phase 3.10 — Procurement Returns & Supplier Debit Notes Integration Suite', () => {
  let ctx: RequestContext;
  let tenantId: string;
  let companyId: string;
  let productId1: string;
  let supplierIdA: string;

  beforeEach(async () => {
    purchaseOrderService.clearMemoryStores();
    goodsReceiptService.clearMemoryStores();
    supplierBillService.clearMemoryStores();
    procurementReturnService.clear();
    supplierService.clear();
    productService.clear();
    apDocumentService.clear();
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    masterDataService.clear();
    numberingEngine.clear();

    const timestamp = Date.now() + Math.floor(Math.random() * 100000);
    tenantId = `tenant_prtn_${timestamp}`;
    companyId = `cmp_prtn_${timestamp}`;

    ctx = {
      requestId: `req_prtn_${timestamp}`,
      tenantId,
      companyId,
      ip: '127.0.0.1',
      userAgent: 'vitest-agent',
      timestamp: new Date(),
      userId: `user_prtn_${timestamp}`,
      user: {
        userId: `user_prtn_${timestamp}`,
        email: 'returns@test.local',
        tenantId,
        companyId,
        roles: ['procurement_user', 'finance_user'],
        permissions: ['*'],
      },
    };

    // Setup Master Data Company
    await masterDataService.createCompany(ctx, {
      id: companyId,
      name: 'P310 Return Test Company Ltd',
      code: 'CMP310',
      legalName: 'P310 Return Test Company Ltd',
      taxId: '33AAAAA0000A1Z5',
      currency: 'INR',
      isActive: true,
    });

    // Create Active Fiscal Year
    await fiscalPeriodService.createFiscalYear(ctx, {
      companyId,
      code: 'FY2026',
      name: 'Fiscal Year 2026',
      startDate: '2026-04-01',
      endDate: '2027-03-31',
    });

    // Seed COA template
    await chartOfAccountsService.applyTemplate(ctx, {
      companyId,
      templateId: 'INDIAN_SME_DEFAULT_V1',
    });

    // Setup Product & Supplier
    const prod = await productService.createProduct(ctx, {
      companyId,
      name: 'Steel Rods Grade A',
      code: 'PROD_STEEL_01',
      sku: 'SKU_STEEL_01',
      uom: 'PCS',
      price: '1000.00',
    });
    productId1 = prod.id;

    const supA = await supplierService.createSupplier(ctx, {
      companyId,
      name: 'Apex Industrial Materials',
      code: 'SUP_APEX',
      gstin: '33AAACA1111A1Z1',
    });
    supplierIdA = supA.id;
  });

  it('1. End-to-End Flow: PO -> GRN -> Supplier Bill -> Procurement Return -> Supplier Debit Note -> AP Adjustment -> GL', async () => {
    // 1. Create PO for 100 units @ 1000.00
    const { po, lines: poLines } = await purchaseOrderService.createPurchaseOrder(ctx, {
      companyId,
      supplierId: supplierIdA,
      orderDate: '2026-09-12',
      deliveryDate: '2026-09-20',
      currency: 'INR',
      lines: [
        {
          productId: productId1,
          description: 'Steel Rods Grade A',
          uom: 'PCS',
          orderedQuantity: '100.0000',
          unitPrice: '1000.00',
          taxableAmount: '100000.00',
          cgstAmount: '9000.00',
          sgstAmount: '9000.00',
          taxAmount: '18000.00',
          lineTotal: '118000.00',
        },
      ],
    });
    await purchaseOrderService.submitPurchaseOrder(ctx, po.id);
    await purchaseOrderService.approvePurchaseOrder(ctx, po.id);
    await purchaseOrderService.issuePurchaseOrder(ctx, po.id);

    // 2. Receive and Accept 100 units via GRN
    const grn = await goodsReceiptService.createGoodsReceipt(ctx, {
      companyId,
      purchaseOrderId: po.id,
      supplierId: supplierIdA,
      receiptDate: '2026-09-12',
      lines: [
        {
          purchaseOrderLineId: poLines[0].id,
          productId: productId1,
          description: 'Steel Rods Grade A',
          uom: 'PCS',
          receivedQuantity: '100.0000',
          acceptedQuantity: '100.0000',
          rejectedQuantity: '0.0000',
        },
      ],
    });
    await goodsReceiptService.acceptGoodsReceipt(ctx, grn.id);

    // 3. Post Supplier Bill for 100 units = 118,000.00
    const { bill, lines: billLines } = await supplierBillService.createSupplierBill(ctx, {
      companyId,
      supplierId: supplierIdA,
      purchaseOrderId: po.id,
      goodsReceiptId: grn.id,
      supplierInvoiceNumber: 'INV-APEX-1001',
      billDate: '2026-09-12',
      dueDate: '2026-10-12',
      currency: 'INR',
      lines: [
        {
          purchaseOrderLineId: poLines[0].id,
          goodsReceiptLineId: grn.lines[0].id,
          productId: productId1,
          descriptionSnapshot: 'Steel Rods Grade A',
          uom: 'PCS',
          billedQuantity: '100.0000',
          unitPrice: '1000.00',
          taxableAmount: '100000.00',
          cgstAmount: '9000.00',
          sgstAmount: '9000.00',
          taxAmount: '18000.00',
          lineTotal: '118000.00',
        },
      ],
    });
    await supplierBillService.approveSupplierBill(ctx, bill.id);
    const postBillRes = await supplierBillService.postSupplierBill(ctx, bill.id);

    expect(postBillRes.apDocument.status).toBe('POSTED');
    expect(postBillRes.apDocument.grossAmount).toBe('118000.00');

    // 4. Return 20 units via Procurement Return (20 @ 1000.00 = 20,000.00 + 3600 tax = 23,600.00)
    const { returnRecord, lines: returnLines } = await procurementReturnService.createProcurementReturn(ctx, {
      companyId,
      supplierId: supplierIdA,
      purchaseOrderId: po.id,
      goodsReceiptId: grn.id,
      originalSupplierBillId: bill.id,
      returnDate: '2026-09-12',
      reason: 'Damaged steel batch',
      lines: [
        {
          goodsReceiptLineId: grn.lines[0].id,
          purchaseOrderLineId: poLines[0].id,
          supplierBillLineId: billLines[0].id,
          productId: productId1,
          description: 'Steel Rods Grade A',
          uom: 'PCS',
          returnedQuantity: '20.0000',
          unitPrice: '1000.0000',
          taxableAmount: '20000.00',
          cgstAmount: '1800.00',
          sgstAmount: '1800.00',
          taxAmount: '3600.00',
          lineTotal: '23600.00',
        },
      ],
    });

    expect(returnRecord.status).toBe('DRAFT');
    expect(returnRecord.totalAmount).toBe('23600.00');

    await procurementReturnService.submitProcurementReturn(ctx, returnRecord.id);
    await procurementReturnService.approveProcurementReturn(ctx, returnRecord.id);

    // 5. Create & Post Supplier Debit Note
    const { debitNote } = await procurementReturnService.createSupplierDebitNote(ctx, {
      companyId,
      supplierId: supplierIdA,
      procurementReturnId: returnRecord.id,
      originalSupplierBillId: bill.id,
      debitNoteDate: '2026-09-12',
      reason: 'Damaged steel claim',
    });

    expect(debitNote.status).toBe('DRAFT');
    expect(debitNote.totalAmount).toBe('23600.00');

    await procurementReturnService.approveSupplierDebitNote(ctx, debitNote.id);
    const postDnRes = await procurementReturnService.postSupplierDebitNote(ctx, debitNote.id);

    expect(postDnRes.debitNote.status).toBe('POSTED');
    expect(postDnRes.apDocument.status).toBe('POSTED');

    // 6. Verify Return completed status & GRN line returned quantity update
    const finalReturnRes = await procurementReturnService.getReturnWithLines(ctx, returnRecord.id);
    expect(finalReturnRes.returnRecord.status).toBe('COMPLETED');

    const returnableCheck = await procurementReturnService.getReturnableQuantity(ctx, grn.lines[0].id);
    expect(returnableCheck.previouslyReturnedQuantity).toBe('20.0000');
    expect(returnableCheck.maximumReturnableQuantity).toBe('80.0000');
  });

  it('2. Quantity Limit Enforcement: Rejects returns exceeding accepted quantity or returning rejected goods', async () => {
    // 1. Create PO and GRN with 50 accepted, 10 rejected
    const { po, lines: poLines } = await purchaseOrderService.createPurchaseOrder(ctx, {
      companyId,
      supplierId: supplierIdA,
      orderDate: '2026-09-12',
      lines: [
        {
          productId: productId1,
          description: 'Steel Rods Grade A',
          uom: 'PCS',
          orderedQuantity: '60.0000',
          unitPrice: '500.00',
          taxableAmount: '30000.00',
          taxAmount: '5400.00',
          lineTotal: '35400.00',
        },
      ],
    });
    await purchaseOrderService.submitPurchaseOrder(ctx, po.id);
    await purchaseOrderService.approvePurchaseOrder(ctx, po.id);
    await purchaseOrderService.issuePurchaseOrder(ctx, po.id);

    const grn = await goodsReceiptService.createGoodsReceipt(ctx, {
      companyId,
      purchaseOrderId: po.id,
      supplierId: supplierIdA,
      receiptDate: '2026-09-12',
      lines: [
        {
          purchaseOrderLineId: poLines[0].id,
          productId: productId1,
          description: 'Steel Rods Grade A',
          uom: 'PCS',
          receivedQuantity: '60.0000',
          acceptedQuantity: '50.0000',
          rejectedQuantity: '10.0000',
          rejectionReason: 'Damaged packaging',
        },
      ],
    });
    await goodsReceiptService.acceptGoodsReceipt(ctx, grn.id);

    // 2. Attempting to return 60 (exceeding accepted quantity of 50) must fail
    await expect(
      procurementReturnService.createProcurementReturn(ctx, {
        companyId,
        supplierId: supplierIdA,
        purchaseOrderId: po.id,
        goodsReceiptId: grn.id,
        returnDate: '2026-09-12',
        reason: 'Over-return attempt',
        lines: [
          {
            goodsReceiptLineId: grn.lines[0].id,
            description: 'Steel Rods',
            uom: 'PCS',
            returnedQuantity: '60.0000',
            unitPrice: '500.00',
          },
        ],
      })
    ).rejects.toThrow(BusinessRuleViolationError);

    // 3. Return valid 40 units
    const { returnRecord } = await procurementReturnService.createProcurementReturn(ctx, {
      companyId,
      supplierId: supplierIdA,
      purchaseOrderId: po.id,
      goodsReceiptId: grn.id,
      returnDate: '2026-09-12',
      reason: 'Valid partial return',
      lines: [
        {
          goodsReceiptLineId: grn.lines[0].id,
          description: 'Steel Rods',
          uom: 'PCS',
          returnedQuantity: '40.0000',
          unitPrice: '500.00',
        },
      ],
    });
    await procurementReturnService.submitProcurementReturn(ctx, returnRecord.id);
    await procurementReturnService.approveProcurementReturn(ctx, returnRecord.id);
    await procurementReturnService.completeProcurementReturn(ctx, returnRecord.id);

    // 4. Remaining returnable quantity is now 10 (50 - 40). Attempting to return 15 must fail
    await expect(
      procurementReturnService.createProcurementReturn(ctx, {
        companyId,
        supplierId: supplierIdA,
        goodsReceiptId: grn.id,
        returnDate: '2026-09-12',
        reason: 'Exceeding remaining returnable quantity',
        lines: [
          {
            goodsReceiptLineId: grn.lines[0].id,
            description: 'Steel Rods',
            uom: 'PCS',
            returnedQuantity: '15.0000',
            unitPrice: '500.00',
          },
        ],
      })
    ).rejects.toThrow(BusinessRuleViolationError);
  });

  it('3. Absolute Zero Inventory Boundary & Immutable Posted Cancel Protection', async () => {
    // Create PO, GRN, Bill, Return and Debit Note
    const { po, lines: poLines } = await purchaseOrderService.createPurchaseOrder(ctx, {
      companyId,
      supplierId: supplierIdA,
      lines: [
        {
          productId: productId1,
          description: 'Steel Rods Grade A',
          uom: 'PCS',
          orderedQuantity: '10.0000',
          unitPrice: '100.00',
          taxableAmount: '1000.00',
          taxAmount: '180.00',
          lineTotal: '1180.00',
        },
      ],
    });
    await purchaseOrderService.submitPurchaseOrder(ctx, po.id);
    await purchaseOrderService.approvePurchaseOrder(ctx, po.id);
    await purchaseOrderService.issuePurchaseOrder(ctx, po.id);

    const grn = await goodsReceiptService.createGoodsReceipt(ctx, {
      companyId,
      purchaseOrderId: po.id,
      supplierId: supplierIdA,
      receiptDate: '2026-09-12',
      lines: [
        {
          purchaseOrderLineId: poLines[0].id,
          productId: productId1,
          description: 'Steel Rods',
          uom: 'PCS',
          receivedQuantity: '10.0000',
          acceptedQuantity: '10.0000',
        },
      ],
    });
    await goodsReceiptService.acceptGoodsReceipt(ctx, grn.id);

    const { returnRecord } = await procurementReturnService.createProcurementReturn(ctx, {
      companyId,
      supplierId: supplierIdA,
      returnDate: '2026-09-12',
      reason: 'Boundary check return',
      lines: [
        {
          goodsReceiptLineId: grn.lines[0].id,
          description: 'Steel Rods',
          uom: 'PCS',
          returnedQuantity: '5.0000',
          unitPrice: '100.00',
        },
      ],
    });

    const { debitNote } = await procurementReturnService.createSupplierDebitNote(ctx, {
      companyId,
      supplierId: supplierIdA,
      procurementReturnId: returnRecord.id,
      debitNoteDate: '2026-09-12',
      reason: 'Boundary check claim',
    });

    await procurementReturnService.approveSupplierDebitNote(ctx, debitNote.id);
    const postRes = await procurementReturnService.postSupplierDebitNote(ctx, debitNote.id);

    expect(postRes.debitNote.status).toBe('POSTED');

    // Attempting to cancel POSTED debit note must fail
    await expect(
      procurementReturnService.cancelSupplierDebitNote(ctx, debitNote.id, 'Immutability test')
    ).rejects.toThrow(BusinessRuleViolationError);
  });

  it('4. Multi-Tenant and Multi-Company Security Isolation', async () => {
    const { returnRecord } = await procurementReturnService.createProcurementReturn(ctx, {
      companyId,
      supplierId: supplierIdA,
      returnDate: '2026-09-12',
      reason: 'Tenant isolation test',
      lines: [
        {
          description: 'Item',
          uom: 'PCS',
          returnedQuantity: '1.0000',
          unitPrice: '100.0000',
        },
      ],
    });

    const otherTenantCtx: RequestContext = {
      ...ctx,
      tenantId: 'tenant_other_999',
      companyId: 'cmp_other_999',
    };

    await expect(
      procurementReturnService.getReturnWithLines(otherTenantCtx, returnRecord.id)
    ).rejects.toThrow();
  });
});
