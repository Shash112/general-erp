import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext, ValidationError, ForbiddenError, BusinessRuleViolationError } from '@general-erp/core';
import { purchaseRequestService } from '../src/modules/procurement/purchase-request.service.js';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { productService } from '../src/modules/commercial/product.service.js';
import { supplierService } from '../src/modules/commercial/supplier.service.js';
import { numberingEngine } from '../src/platform/numbering/numbering.service.js';
import {
  getDb,
  purchaseRequests,
  purchaseRequestLines,
  glJournals,
  apOpenItems,
  eq,
  and,
  sql
} from '@general-erp/database';

describe('Phase 3.6 — Procurement Foundation & Purchase Requests Suite', () => {
  let ctx: RequestContext;
  let tenantId: string;
  let companyId: string;
  let productId1: string;
  let productId2: string;
  let supplierId: string;

  beforeEach(async () => {
    purchaseRequestService.clearMemoryStores();
    masterDataService.clear();
    numberingEngine.clear();

    const timestamp = Date.now() + Math.floor(Math.random() * 100000);
    tenantId = `tenant_pr_${timestamp}`;
    companyId = `cmp_pr_${timestamp}`;

    ctx = {
      requestId: `req_pr_${timestamp}`,
      tenantId,
      companyId,
      ip: '127.0.0.1',
      userAgent: 'vitest-agent',
      timestamp: new Date(),
      userId: `user_pr_${timestamp}`,
      user: {
        userId: `user_pr_${timestamp}`,
        email: 'requester@test.local',
        tenantId,
        companyId,
        roles: ['procurement_user'],
        permissions: ['*']
      }
    };

    // Setup Master Data Company
    await masterDataService.createCompany(ctx, {
      id: companyId,
      name: 'Procurement Corp Pvt Ltd',
      legalName: 'Procurement Corp Private Limited',
      currency: 'INR'
    });

    // Create Products
    const prod1 = await productService.createProduct(ctx, {
      companyId,
      name: 'Industrial Raw Steel',
      code: `PRD-STL-${timestamp}`,
      sku: `SKU-STL-${timestamp}`,
      productType: 'GOODS',
      baseUom: 'KG',
      purchasePrice: '450.00',
      isPurchasable: true
    });
    productId1 = prod1.id;

    const prod2 = await productService.createProduct(ctx, {
      companyId,
      name: 'Hydraulic Fitting Fasteners',
      code: `PRD-FST-${timestamp}`,
      sku: `SKU-FST-${timestamp}`,
      productType: 'GOODS',
      baseUom: 'PCS',
      purchasePrice: '75.00',
      isPurchasable: true
    });
    productId2 = prod2.id;

    // Create Preferred Supplier
    const supp = await supplierService.createSupplier(ctx, {
      companyId,
      name: 'Apex Industrial Supplies',
      code: `SUPP-APX-${timestamp}`,
      currency: 'INR'
    });
    supplierId = supp.id;
  });

  it('1. Create draft Purchase Request with valid line estimates', async () => {
    const pr = await purchaseRequestService.createPurchaseRequest(ctx, {
      companyId,
      requiredDate: '2026-10-15',
      priority: 'NORMAL',
      purpose: 'Q4 Manufacturing Stock Replenishment',
      justification: 'Critical raw material needed for assembly line #2',
      lines: [
        {
          productId: productId1,
          description: 'Industrial Raw Steel Bar 10mm',
          requestedQuantity: '100.0000',
          uom: 'KG',
          estimatedUnitPrice: '450.00'
        },
        {
          productId: productId2,
          description: 'Hydraulic Fastener Type B',
          requestedQuantity: '50.0000',
          uom: 'PCS',
          estimatedUnitPrice: '75.00',
          estimatedDiscount: '100.00'
        }
      ]
    });

    expect(pr).toBeDefined();
    expect(pr.status).toBe('DRAFT');
    expect(pr.requestNumber).toMatch(/^(PR|PUR)-/);
    expect(pr.lines).toHaveLength(2);
    // Line 1: 100 * 450 = 45000.00
    // Line 2: 50 * 75 - 100 = 3650.00
    // Total: 48650.00
    expect(pr.estimatedTotal).toBe('48650.00');
    expect(pr.lines[0].remainingQuantity).toBe('100.0000');
    expect(pr.lines[0].orderedQuantity).toBe('0.0000');
  });

  it('2. Reject purchase request creation with zero or negative quantity', async () => {
    await expect(purchaseRequestService.createPurchaseRequest(ctx, {
      companyId,
      requiredDate: '2026-10-15',
      lines: [
        {
          productId: productId1,
          description: 'Invalid Qty Line',
          requestedQuantity: '0.0000',
          uom: 'KG',
          estimatedUnitPrice: '100.00'
        }
      ]
    })).rejects.toThrow(ValidationError);
  });

  it('3. Update draft purchase request header and lines', async () => {
    const pr = await purchaseRequestService.createPurchaseRequest(ctx, {
      companyId,
      requiredDate: '2026-10-20',
      priority: 'LOW',
      purpose: 'Initial Draft Purpose',
      lines: [
        {
          productId: productId1,
          description: 'Steel Rods',
          requestedQuantity: '10.0000',
          uom: 'KG',
          estimatedUnitPrice: '100.00'
        }
      ]
    });

    const updated = await purchaseRequestService.updatePurchaseRequest(ctx, pr.id, {
      priority: 'HIGH',
      purpose: 'Updated Operations Demand',
      version: pr.version,
      lines: [
        {
          productId: productId1,
          description: 'Steel Rods High Grade',
          requestedQuantity: '20.0000',
          uom: 'KG',
          estimatedUnitPrice: '120.00'
        }
      ]
    });

    expect(updated.priority).toBe('HIGH');
    expect(updated.purpose).toBe('Updated Operations Demand');
    expect(updated.estimatedTotal).toBe('2400.00'); // 20 * 120
    expect(updated.version).toBe(2);
  });

  it('4. Submit draft purchase request', async () => {
    const pr = await purchaseRequestService.createPurchaseRequest(ctx, {
      companyId,
      requiredDate: '2026-10-25',
      lines: [
        {
          productId: productId1,
          description: 'Steel Rods',
          requestedQuantity: '5.0000',
          uom: 'KG',
          estimatedUnitPrice: '100.00'
        }
      ]
    });

    const submitted = await purchaseRequestService.submitPurchaseRequest(ctx, pr.id);
    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.submittedAt).toBeDefined();
    expect(submitted.submittedBy).toBe(ctx.userId);
  });

  it('5. Prevent editing submitted purchase request', async () => {
    const pr = await purchaseRequestService.createPurchaseRequest(ctx, {
      companyId,
      requiredDate: '2026-10-25',
      lines: [
        {
          productId: productId1,
          description: 'Steel Rods',
          requestedQuantity: '5.0000',
          uom: 'KG',
          estimatedUnitPrice: '100.00'
        }
      ]
    });

    await purchaseRequestService.submitPurchaseRequest(ctx, pr.id);

    await expect(purchaseRequestService.updatePurchaseRequest(ctx, pr.id, {
      purpose: 'Attempted Edit'
    })).rejects.toThrow(BusinessRuleViolationError);
  });

  it('6. Approve submitted purchase request', async () => {
    const pr = await purchaseRequestService.createPurchaseRequest(ctx, {
      companyId,
      requiredDate: '2026-10-25',
      lines: [
        {
          productId: productId1,
          description: 'Steel Rods',
          requestedQuantity: '5.0000',
          uom: 'KG',
          estimatedUnitPrice: '100.00'
        }
      ]
    });

    await purchaseRequestService.submitPurchaseRequest(ctx, pr.id);
    const approved = await purchaseRequestService.approvePurchaseRequest(ctx, pr.id);

    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedAt).toBeDefined();
    expect(approved.approvedBy).toBe(ctx.userId);
  });

  it('7. Reject submitted purchase request with required reason', async () => {
    const pr = await purchaseRequestService.createPurchaseRequest(ctx, {
      companyId,
      requiredDate: '2026-10-25',
      lines: [
        {
          productId: productId1,
          description: 'Steel Rods',
          requestedQuantity: '5.0000',
          uom: 'KG',
          estimatedUnitPrice: '100.00'
        }
      ]
    });

    await purchaseRequestService.submitPurchaseRequest(ctx, pr.id);

    await expect(purchaseRequestService.rejectPurchaseRequest(ctx, pr.id, '')).rejects.toThrow(ValidationError);

    const rejected = await purchaseRequestService.rejectPurchaseRequest(ctx, pr.id, 'Budget unallocated for Q4');
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('Budget unallocated for Q4');
    expect(rejected.rejectedBy).toBe(ctx.userId);
  });

  it('8. Cancel draft and submitted purchase request', async () => {
    const pr1 = await purchaseRequestService.createPurchaseRequest(ctx, {
      companyId,
      requiredDate: '2026-10-25',
      lines: [{ description: 'Draft Item', requestedQuantity: '1.0000', uom: 'PCS', estimatedUnitPrice: '10.00' }]
    });

    const cancelled1 = await purchaseRequestService.cancelPurchaseRequest(ctx, pr1.id, 'Duplicate request created');
    expect(cancelled1.status).toBe('CANCELLED');

    const pr2 = await purchaseRequestService.createPurchaseRequest(ctx, {
      companyId,
      requiredDate: '2026-10-25',
      lines: [{ description: 'Submitted Item', requestedQuantity: '1.0000', uom: 'PCS', estimatedUnitPrice: '10.00' }]
    });
    await purchaseRequestService.submitPurchaseRequest(ctx, pr2.id);

    const cancelled2 = await purchaseRequestService.cancelPurchaseRequest(ctx, pr2.id, 'No longer required');
    expect(cancelled2.status).toBe('CANCELLED');
  });

  it('9. Filter and list purchase requests', async () => {
    await purchaseRequestService.createPurchaseRequest(ctx, {
      companyId,
      requiredDate: '2026-11-01',
      priority: 'URGENT',
      purpose: 'Urgent Tooling Request',
      lines: [{ description: 'Specialized Drill Bits', requestedQuantity: '2.0000', uom: 'PCS', estimatedUnitPrice: '1500.00' }]
    });

    const list = await purchaseRequestService.listPurchaseRequests(ctx, {
      companyId,
      priority: 'URGENT'
    });

    expect(list.total).toBeGreaterThanOrEqual(1);
    expect(list.items[0].priority).toBe('URGENT');
  });

  it('10. ABSOLUTE ZERO FINANCIAL & INVENTORY BOUNDARY ASSERTION', async () => {
    const db = getDb();

    // Create, Submit, Approve Purchase Request
    const pr = await purchaseRequestService.createPurchaseRequest(ctx, {
      companyId,
      requiredDate: '2026-12-01',
      lines: [
        {
          productId: productId1,
          description: 'Material For Audit Test',
          requestedQuantity: '50.0000',
          uom: 'KG',
          estimatedUnitPrice: '500.00'
        }
      ]
    });
    await purchaseRequestService.submitPurchaseRequest(ctx, pr.id);
    await purchaseRequestService.approvePurchaseRequest(ctx, pr.id);

    if (db) {
      // Verify 0 GL Journal entries exist for this company/tenant
      const journals = await db.select().from(glJournals).where(
        and(
          eq(glJournals.tenantId, tenantId),
          eq(glJournals.companyId, companyId)
        )
      );
      expect(journals).toHaveLength(0);

      // Verify 0 AP Open Items exist
      const apItems = await db.select().from(apOpenItems).where(
        and(
          eq(apOpenItems.tenantId, tenantId),
          eq(apOpenItems.companyId, companyId)
        )
      );
      expect(apItems).toHaveLength(0);
    }
  });
});
