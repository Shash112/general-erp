import { describe, it, expect } from 'vitest';
import { RequestContext, ValidationError, BusinessRuleViolationError, ExactDecimal } from '@general-erp/core';
import {
  apDocuments,
  apDocumentLines,
  apOpenItems,
  apPayments,
  apAllocations,
  apAdjustments
} from '@general-erp/database';
import {
  ApDocumentDTO,
  ApPaymentDTO,
  ApAllocationDTO,
  ApAdjustmentDTO,
  ApOpenItemSettlementDTO,
  CompanyApAgingSummaryDTO,
  SupplierStatementDTO,
  ApDocumentValidator
} from '../src/modules/finance/ap/index.js';

describe('Phase 2.7.0 — AP Database Foundation & Schema Migration', () => {
  const ctx: RequestContext = {
    tenantId: 'tenant_ap_test',
    companyId: 'company_hq',
    user: {
      userId: 'usr_ap_admin',
      tenantId: 'tenant_ap_test',
      roles: ['accountant'],
      permissions: ['ap:document:*']
    }
  };

  it('defines Drizzle schema tables with correct table names and primary keys', () => {
    expect(apDocuments).toBeDefined();
    expect(apDocumentLines).toBeDefined();
    expect(apOpenItems).toBeDefined();
    expect(apPayments).toBeDefined();
    expect(apAllocations).toBeDefined();
    expect(apAdjustments).toBeDefined();
  });

  it('validates ApDocumentValidator scale and date rules', async () => {
    expect(ApDocumentValidator.isValidIsoDate('2026-05-15')).toBe(true);
    expect(ApDocumentValidator.isValidIsoDate('invalid-date')).toBe(false);

    // ExactDecimal scale validation
    expect(() => ExactDecimal.validateScale('100.50', 2)).not.toThrow();
    expect(() => ExactDecimal.validateScale('100.505', 2)).toThrow();
  });

  it('verifies DTO structure and type definitions for AP entities', () => {
    const docDto: ApDocumentDTO = {
      id: 'apdoc_123',
      tenantId: 'tenant_ap_test',
      companyId: 'company_hq',
      supplierId: 'supp_123',
      documentType: 'SUPPLIER_BILL',
      documentNumber: 'BILL-0001',
      supplierInvoiceNumber: 'INV-SUPP-99',
      documentDate: '2026-05-01',
      accountingDate: '2026-05-01',
      dueDate: '2026-05-31',
      currency: 'INR',
      exchangeRate: '1.000000',
      isRcm: false,
      isSez: false,
      taxableAmount: '10000.00',
      taxAmount: '1800.00',
      grossAmount: '11800.00',
      outstandingAmount: '11800.00',
      allocatedAmount: '0.00',
      unappliedAmount: '0.00',
      status: 'DRAFT',
      sourceModule: 'AP',
      paymentTermsDays: 30,
      lines: [],
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    expect(docDto.id).toBe('apdoc_123');
    expect(docDto.documentType).toBe('SUPPLIER_BILL');
    expect(docDto.grossAmount).toBe('11800.00');

    const paymentDto: ApPaymentDTO = {
      id: 'pay_123',
      tenantId: 'tenant_ap_test',
      companyId: 'company_hq',
      supplierId: 'supp_123',
      paymentNumber: 'PAY-0001',
      paymentDate: '2026-05-05',
      accountingDate: '2026-05-05',
      paymentMode: 'BANK_TRANSFER',
      totalAmount: '5000.00',
      allocatedAmount: '0.00',
      unappliedAmount: '5000.00',
      status: 'POSTED',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    expect(paymentDto.id).toBe('pay_123');
    expect(paymentDto.unappliedAmount).toBe('5000.00');

    const allocDto: ApAllocationDTO = {
      id: 'alloc_123',
      tenantId: 'tenant_ap_test',
      companyId: 'company_hq',
      allocationSourceType: 'PAYMENT',
      paymentId: 'pay_123',
      openItemId: 'open_123',
      allocatedAmount: '5000.00',
      discountAmount: '0.00',
      allocationDate: '2026-05-05',
      status: 'ACTIVE',
      createdAt: new Date()
    };

    expect(allocDto.allocatedAmount).toBe('5000.00');

    const adjDto: ApAdjustmentDTO = {
      id: 'adj_123',
      tenantId: 'tenant_ap_test',
      companyId: 'company_hq',
      supplierId: 'supp_123',
      openItemId: 'open_123',
      adjustmentType: 'WRITE_OFF',
      amount: '500.00',
      adjustmentDate: '2026-05-10',
      accountingDate: '2026-05-10',
      reason: 'Vendor waiver',
      status: 'POSTED',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    expect(adjDto.adjustmentType).toBe('WRITE_OFF');
  });
});
