import { describe, it, expect } from 'vitest';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { notificationEngine } from '../src/platform/notifications/notification.service.js';
import { RequestContext, ValidationError, NotFoundError } from '@general-erp/core';

describe('Phase 1 — Platform Engines Tests', () => {
  const ctx: RequestContext = {
    requestId: 'req_p1_test',
    tenantId: 'tenant_phase1_demo',
    companyId: 'company_phase1_demo',
    ip: '127.0.0.1',
    userAgent: 'vitest-agent',
    timestamp: new Date()
  };

  // 1. Master Data Engine Tests (Platform Engine #8)
  describe('Master Data Engine (Platform Engine #8)', () => {
    it('creates and retrieves company', async () => {
      const company = await masterDataService.createCompany(ctx, {
        id: 'cmp_acme_corp',
        name: 'ACME Corp India',
        legalName: 'ACME Private Limited',
        gstin: '29ABCDE1234F1Z5',
        pan: 'ABCDE1234F',
        currency: 'INR'
      });

      expect(company.id).toBe('cmp_acme_corp');
      expect(company.name).toBe('ACME Corp India');

      const retrieved = await masterDataService.getCompany(ctx, 'cmp_acme_corp');
      expect(retrieved.legalName).toBe('ACME Private Limited');
    });

    it('rejects company creation with missing required fields', async () => {
      await expect(
        masterDataService.createCompany(ctx, { name: '', legalName: '', currency: 'INR' })
      ).rejects.toThrow(ValidationError);
    });

    it('creates branch under valid company', async () => {
      const branch = await masterDataService.createBranch(ctx, {
        companyId: 'cmp_acme_corp',
        name: 'Bangalore Branch',
        code: 'BLR',
        stateCode: '29'
      });

      expect(branch.code).toBe('BLR');
    });

    it('creates customer with valid GSTIN format validation', async () => {
      const customer = await masterDataService.createCustomer(ctx, {
        companyId: 'cmp_acme_corp',
        name: 'Infosys Technologies',
        code: 'CUST-001',
        gstin: '29AAACI4178L1ZB',
        creditLimit: 500000.00
      });

      expect(customer.code).toBe('CUST-001');
    });

    it('REJECTS customer creation with invalid GSTIN string', async () => {
      await expect(
        masterDataService.createCustomer(ctx, {
          companyId: 'cmp_acme_corp',
          name: 'Invalid GSTIN Corp',
          code: 'CUST-BAD',
          gstin: 'INVALID_GSTIN_123',
          creditLimit: 1000.00
        })
      ).rejects.toThrow(ValidationError);
    });

    it('creates product with price checks', async () => {
      const product = await masterDataService.createProduct(ctx, {
        companyId: 'cmp_acme_corp',
        name: 'ERP Enterprise License',
        code: 'PROD-LIC-01',
        sku: 'SKU-ERP-01',
        uom: 'NOS',
        purchasePrice: 1000.00,
        sellingPrice: 2500.00
      });

      expect(product.sku).toBe('SKU-ERP-01');
    });

    it('REJECTS product creation with negative pricing', async () => {
      await expect(
        masterDataService.createProduct(ctx, {
          companyId: 'cmp_acme_corp',
          name: 'Bad Product',
          code: 'PROD-BAD',
          sku: 'SKU-BAD',
          uom: 'NOS',
          purchasePrice: -100.00,
          sellingPrice: 500.00
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  // 2. Notification Engine Tests (Platform Engine #12)
  describe('Notification Engine (Platform Engine #12)', () => {
    it('dispatches in-app and email notifications', async () => {
      const results = await notificationEngine.sendNotification(ctx, {
        recipientId: 'user_sales_mgr',
        recipientEmail: 'mgr@acme.com',
        channels: ['IN_APP', 'EMAIL'],
        title: 'New Purchase Approval Pending',
        body: 'PO #1002 requires your approval.'
      });

      expect(results.length).toBe(2);
      expect(results[0]?.status).toBe('DELIVERED');
      expect(results[1]?.status).toBe('DELIVERED');

      const inApp = notificationEngine.getInAppNotifications(ctx.tenantId, 'user_sales_mgr');
      expect(inApp.length).toBeGreaterThan(0);
      expect(inApp[0]?.title).toBe('New Purchase Approval Pending');
    });

    it('handles failure gracefully when email recipient is missing', async () => {
      const results = await notificationEngine.sendNotification(ctx, {
        recipientId: 'user_no_email',
        channels: ['EMAIL'],
        title: 'Missing Email Test',
        body: 'Test body'
      });

      expect(results[0]?.status).toBe('FAILED');
    });
  });
});
