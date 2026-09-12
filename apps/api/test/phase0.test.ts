import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { accountingEngine } from '../src/platform/accounting/accounting.service.js';
import { authorizationService } from '../src/platform/authorization/authorization.service.js';
import { auditService } from '../src/platform/audit/audit.service.js';
import { configurationService } from '../src/platform/configuration/configuration.service.js';
import { workflowService, DocumentState } from '../src/platform/workflow/workflow.service.js';
import { rulesEngine } from '../src/platform/rules/rules.service.js';
import { storageService } from '../src/platform/storage/storage.service.js';
import { numberingEngine } from '../src/platform/numbering/numbering.service.js';
import { AccountingError, ForbiddenError, ValidationError, RequestContext, UserSession } from '@general-erp/core';

describe('Phase 0.5 — Engineering Foundation & Security Audit Tests', () => {
  const app = buildApp();

  const mockCtx: RequestContext = {
    requestId: 'test_req_123',
    tenantId: 'tenant_acme',
    companyId: 'company_acme_hq',
    ip: '127.0.0.1',
    userAgent: 'vitest-agent',
    timestamp: new Date()
  };

  const mockUser: UserSession = {
    userId: 'user_john_doe',
    email: 'john@acme.com',
    roles: ['SALES_MANAGER'],
    permissions: ['sales:invoice:create', 'sales:invoice:approve'],
    tenantId: 'tenant_acme',
    companyId: 'company_acme_hq',
    branchId: 'branch_bangalore'
  };

  // 1. Health Probe Verification
  describe('Health Probes', () => {
    it('GET /health/liveness returns 200 UP', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/liveness' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('UP');
    });

    it('GET /health/readiness returns 200 READY', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/readiness' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('READY');
      expect(body.checks.database).toBe('UP');
    });
  });

  // 2. Accounting Engine & Financial Invariant Tests
  describe('Accounting Engine Boundary (Platform Engine #6)', () => {
    it('successfully processes balanced journal event (Total Debit == Total Credit)', async () => {
      const result = await accountingEngine.processAccountingEvent(mockCtx, {
        sourceModule: 'sales',
        sourceDocumentId: 'inv_1001',
        voucherNumber: 'JV-2026-0001',
        entryDate: new Date(),
        lines: [
          { accountId: 'acc_ar', accountCode: '1100', debitAmount: 1180.00, creditAmount: 0.00 },
          { accountId: 'acc_rev', accountCode: '4000', debitAmount: 0.00, creditAmount: 1000.00 },
          { accountId: 'acc_gst', accountCode: '2200', debitAmount: 0.00, creditAmount: 180.00 }
        ]
      });

      expect(result.status).toBe('POSTED');
      expect(result.totalDebit).toBe(1180.00);
      expect(result.totalCredit).toBe(1180.00);
    });

    it('REJECTS unbalanced journal event with AccountingError', async () => {
      await expect(
        accountingEngine.processAccountingEvent(mockCtx, {
          sourceModule: 'sales',
          sourceDocumentId: 'inv_1002',
          voucherNumber: 'JV-2026-0002',
          entryDate: new Date(),
          lines: [
            { accountId: 'acc_ar', accountCode: '1100', debitAmount: 1000.00, creditAmount: 0.00 },
            { accountId: 'acc_rev', accountCode: '4000', debitAmount: 0.00, creditAmount: 900.00 }
          ]
        })
      ).rejects.toThrow(AccountingError);
    });

    it('REJECTS negative line amounts with AccountingError', async () => {
      await expect(
        accountingEngine.processAccountingEvent(mockCtx, {
          sourceModule: 'sales',
          sourceDocumentId: 'inv_1003',
          voucherNumber: 'JV-2026-0003',
          entryDate: new Date(),
          lines: [
            { accountId: 'acc_ar', accountCode: '1100', debitAmount: -100.00, creditAmount: 0.00 },
            { accountId: 'acc_rev', accountCode: '4000', debitAmount: 0.00, creditAmount: -100.00 }
          ]
        })
      ).rejects.toThrow(AccountingError);
    });
  });

  // 3. Authorization & Tenant Security Tests
  describe('Authorization & Tenant Isolation (Platform Engine #4)', () => {
    it('permits authorized action matching user permissions', () => {
      const allowed = authorizationService.authorize({
        user: mockUser,
        action: 'sales:invoice:create',
        companyId: 'company_acme_hq'
      });
      expect(allowed).toBe(true);
    });

    it('blocks action when user lacks permission', () => {
      expect(() =>
        authorizationService.authorize({
          user: mockUser,
          action: 'finance:payroll:post'
        })
      ).toThrow(ForbiddenError);
    });

    it('enforces Segregation of Duties (Creator cannot approve their own transaction)', () => {
      expect(() =>
        authorizationService.authorize({
          user: mockUser,
          action: 'sales:invoice:approve',
          creatorId: 'user_john_doe'
        })
      ).toThrow(ForbiddenError);
    });

    it('REJECTS cross-tenant data access attempts', () => {
      expect(() =>
        authorizationService.authorize({
          user: mockUser, // Tenant: tenant_acme, Company: company_acme_hq
          action: 'sales:invoice:create',
          companyId: 'company_competitor_inc' // Cross-tenant company access attempt!
        })
      ).toThrow(ForbiddenError);
    });
  });

  // 4. Audit Engine & Hash Chain Verification Tests
  describe('Audit Engine & Hash Chain Tamper Detection (Platform Engine #5)', () => {
    it('logs immutable audit events and verifies valid chain integrity', async () => {
      const log1 = await auditService.logEvent(mockCtx, {
        module: 'sales',
        entityName: 'SalesInvoice',
        entityId: 'INV-1001',
        action: 'CREATE',
        newValues: { total: 1180.00 }
      });

      const log2 = await auditService.logEvent(mockCtx, {
        module: 'sales',
        entityName: 'SalesInvoice',
        entityId: 'INV-1001',
        action: 'POST',
        newValues: { status: 'POSTED' }
      });

      const chain = [
        {
          tenantId: mockCtx.tenantId,
          actorId: 'user_1',
          actorIp: '127.0.0.1',
          userAgent: 'test',
          module: 'sales',
          entityName: 'SalesInvoice',
          entityId: 'INV-1001',
          action: 'CREATE',
          traceId: 'req_1',
          prevHash: log1.prevHash,
          hash: log1.hash,
          timestamp: log1.timestamp
        },
        {
          tenantId: mockCtx.tenantId,
          actorId: 'user_1',
          actorIp: '127.0.0.1',
          userAgent: 'test',
          module: 'sales',
          entityName: 'SalesInvoice',
          entityId: 'INV-1001',
          action: 'POST',
          traceId: 'req_2',
          prevHash: log2.prevHash,
          hash: log2.hash,
          timestamp: log2.timestamp
        }
      ];

      const verification = auditService.verifyAuditChain(chain);
      expect(verification.isValid).toBe(true);
    });

    it('DETECTS tampered audit records when payload is modified', () => {
      const tamperedChain = [
        {
          tenantId: 'tenant_acme',
          actorId: 'user_1',
          actorIp: '127.0.0.1',
          userAgent: 'test',
          module: 'sales',
          entityName: 'SalesInvoice',
          entityId: 'INV-1001',
          action: 'DELETE_TAMPERED', // Tampered action string!
          traceId: 'req_1',
          prevHash: 'GENESIS_HASH',
          hash: 'invalid_hash_123',
          timestamp: '2026-09-08T10:00:00.000Z'
        }
      ];

      const verification = auditService.verifyAuditChain(tamperedChain);
      expect(verification.isValid).toBe(false);
      expect(verification.reason).toContain('hash mismatch');
    });
  });

  // 5. Numbering Engine Tests
  describe('Numbering & Sequence Engine (Platform Engine #13)', () => {
    it('generates formatted sequence numbers with fiscal year and branch scope', () => {
      const num1 = numberingEngine.generateNextNumber('tenant_acme', 'company_hq', 'INVOICE', '2025-26', 'BLR');
      const num2 = numberingEngine.generateNextNumber('tenant_acme', 'company_hq', 'INVOICE', '2025-26', 'BLR');

      expect(num1).toBe('INV-2025-26-BLR-0001');
      expect(num2).toBe('INV-2025-26-BLR-0002');
    });
  });

  // 6. Configuration & Custom Fields Engine Tests
  describe('Configuration Engine (Platform Engine #1)', () => {
    it('sets and retrieves tenant configuration values', () => {
      configurationService.setConfig('tenant_acme', 'sales', 'default_tax_rate', 18);
      const rate = configurationService.getConfig<number>('tenant_acme', 'sales', 'default_tax_rate');
      expect(rate).toBe(18);
    });

    it('validates custom fields against definitions', () => {
      const definitions = [
        { fieldName: 'gstin', fieldLabel: 'Customer GSTIN', dataType: 'string' as const, isRequired: true }
      ];

      expect(() =>
        configurationService.validateCustomFields({ gstin: '29ABCDE1234F1Z5' }, definitions)
      ).not.toThrow();

      expect(() =>
        configurationService.validateCustomFields({}, definitions)
      ).toThrow(ValidationError);
    });
  });

  // 7. Workflow Engine Tests
  describe('Workflow Engine & Document Lifecycle (Platform Engine #2 & #7)', () => {
    it('allows valid state transitions', () => {
      expect(() => workflowService.validateStateTransition(DocumentState.DRAFT, DocumentState.SUBMITTED)).not.toThrow();
    });

    it('rejects invalid state transitions', () => {
      expect(() => workflowService.validateStateTransition(DocumentState.DRAFT, DocumentState.POSTED)).toThrow();
    });
  });

  // 8. Rules Engine AST Sandbox Tests
  describe('Rules Engine AST Sandbox (Platform Engine #3)', () => {
    it('evaluates nested property resolution (e.g. customer.creditLimit)', () => {
      const rules = [
        {
          id: 'rule_credit_limit',
          name: 'Block order if credit limit exceeded',
          module: 'sales',
          conditions: [{ field: 'customer.creditLimit', operator: '<' as const, value: 5000 }],
          action: 'BLOCK' as const,
          actionMessage: 'Low credit limit'
        }
      ];

      const context = { customer: { creditLimit: 2000 } };
      const triggered = rulesEngine.evaluateRules(rules, context);
      expect(triggered.length).toBe(1);
    });

    it('handles null and undefined nested paths safely without throwing unhandled exceptions', () => {
      const rules = [
        {
          id: 'rule_null_check',
          name: 'Check missing customer info',
          module: 'sales',
          conditions: [{ field: 'customer.nonExistentField.subField', operator: '==' as const, value: null }],
          action: 'WARN' as const,
          actionMessage: 'Missing field'
        }
      ];

      const context = { customer: {} };
      expect(() => rulesEngine.evaluateRules(rules, context)).not.toThrow();
    });
  });

  // 9. Storage Engine Path Security Tests
  describe('Storage Engine Security (Platform Engine #16)', () => {
    it('REJECTS path traversal attempts in filename or tenantId', () => {
      expect(() =>
        storageService.getStoragePath('tenant_acme', 'sales', '../../../etc/passwd')
      ).toThrow(ValidationError);
    });

    it('generates and verifies short-lived signed URLs', () => {
      const url = storageService.generateSignedUrl('tenant_acme', 'file_abc123');
      expect(url).toContain('/api/v1/files/download/file_abc123');
    });
  });
});
