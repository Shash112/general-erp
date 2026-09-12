import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { accountingCoreService, accountingConfigurationService, AccountingEventInput } from '../src/modules/finance/accounting-core.service.js';
import { journalDraftService } from '../src/modules/finance/journal-draft.service.js';
import { glEngine } from '../src/modules/finance/gl-engine.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { RequestContext, ValidationError, BusinessRuleViolationError, AccountingError } from '@general-erp/core';

describe('Phase 2.4 — Accounting Core Posting, Reversals & Invariants Tests', () => {
  let app: ReturnType<typeof buildApp>;
  let accBankId: string;
  let accSalesId: string;
  let accArId: string;

  const ctx: RequestContext = {
    requestId: 'req_phase2_4_test',
    tenantId: 'tenant_acme',
    companyId: 'company_hq',
    ip: '127.0.0.1',
    userAgent: 'vitest-agent',
    timestamp: new Date(),
    user: {
      userId: 'user_fin_admin',
      email: 'admin@acme.com',
      tenantId: 'tenant_acme',
      companyId: 'company_hq',
      roles: ['finance_admin'],
      permissions: ['*']
    }
  };

  const ctxTenantB: RequestContext = {
    requestId: 'req_tenant_b_test',
    tenantId: 'tenant_other',
    companyId: 'company_other',
    ip: '127.0.0.1',
    userAgent: 'vitest-agent',
    timestamp: new Date(),
    user: {
      userId: 'user_tenant_b',
      email: 'user@other.com',
      tenantId: 'tenant_other',
      companyId: 'company_other',
      roles: ['finance_user'],
      permissions: ['*']
    }
  };

  beforeEach(async () => {
    app = buildApp();
    journalDraftService.clear();
    chartOfAccountsService.clear();
    fiscalPeriodService.clear();
    accountingConfigurationService.clear();

    // Setup fiscal year for Tenant A
    await fiscalPeriodService.createFiscalYear(ctx, {
      companyId: 'company_hq',
      name: 'FY 2026-27',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2027-03-31')
    });

    // Create COA Accounts for Tenant A
    const accBank = await chartOfAccountsService.createAccount(ctx, {
      companyId: 'company_hq',
      accountCode: '1010',
      accountName: 'Bank Account',
      nodeType: 'ACCOUNT',
      accountType: 'ASSET'
    });
    accBankId = accBank.id;

    const accSales = await chartOfAccountsService.createAccount(ctx, {
      companyId: 'company_hq',
      accountCode: '4010',
      accountName: 'Sales Revenue',
      nodeType: 'ACCOUNT',
      accountType: 'INCOME'
    });
    accSalesId = accSales.id;

    const accAr = await chartOfAccountsService.createAccount(ctx, {
      companyId: 'company_hq',
      accountCode: '1100',
      accountName: 'Accounts Receivable',
      nodeType: 'ACCOUNT',
      accountType: 'ASSET',
      isControlAccount: true,
      controlAccountType: 'AR'
    });
    accArId = accAr.id;
  });

  // 1. Accounting Event Processing & Account Resolution
  describe('Accounting Event Processing & Account Resolution', () => {
    it('processes a valid accounting event via accountId and posts through GLEngine', async () => {
      const event: AccountingEventInput = {
        eventType: 'SALES_INVOICE',
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'INV-1001',
        narration: 'Test sales invoice posting',
        lines: [
          { accountId: accArId, lineSequence: 1, debitAmount: '1200.00', creditAmount: '0.00' },
          { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '1200.00' }
        ]
      };

      const posted = await accountingCoreService.processAccountingEvent(ctx, event);

      expect(posted.id).toBeDefined();
      expect(posted.status).toBe('POSTED');
      expect(posted.voucherNumber).toMatch(/^JV-/);
      expect(posted.totalDebit).toBe('1200.00');
      expect(posted.totalCredit).toBe('1200.00');
      expect(posted.lines.length).toBe(2);
    });

    it('resolves accounts via accountCode when accountId is omitted', async () => {
      const event: AccountingEventInput = {
        eventType: 'SALES_INVOICE',
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'INV-1002',
        lines: [
          { accountCode: '1100', lineSequence: 1, debitAmount: '500.00', creditAmount: '0.00' },
          { accountCode: '4010', lineSequence: 2, debitAmount: '0.00', creditAmount: '500.00' }
        ]
      };

      const posted = await accountingCoreService.processAccountingEvent(ctx, event);
      expect(posted.status).toBe('POSTED');
      expect(posted.lines[0].accountId).toBe(accArId);
      expect(posted.lines[1].accountId).toBe(accSalesId);
    });

    it('resolves accounts via configurable lineRole mappings when accountId and accountCode are omitted', async () => {
      // Set configurable account mappings
      await accountingConfigurationService.setMapping(ctx, {
        companyId: 'company_hq',
        eventType: 'SALES_INVOICE',
        lineRole: 'DEBIT_AR',
        accountId: accArId
      });
      await accountingConfigurationService.setMapping(ctx, {
        companyId: 'company_hq',
        eventType: 'SALES_INVOICE',
        lineRole: 'CREDIT_REVENUE',
        accountId: accSalesId
      });

      const event: AccountingEventInput = {
        eventType: 'SALES_INVOICE',
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'INV-1003',
        lines: [
          { lineRole: 'DEBIT_AR', lineSequence: 1, debitAmount: '750.00', creditAmount: '0.00' },
          { lineRole: 'CREDIT_REVENUE', lineSequence: 2, debitAmount: '0.00', creditAmount: '750.00' }
        ]
      };

      const posted = await accountingCoreService.processAccountingEvent(ctx, event);
      expect(posted.status).toBe('POSTED');
      expect(posted.lines[0].accountId).toBe(accArId);
      expect(posted.lines[1].accountId).toBe(accSalesId);
    });

    it('rejects accounting event when account resolution fails', async () => {
      const event: AccountingEventInput = {
        eventType: 'SALES_INVOICE',
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'INV-UNRESOLVED',
        lines: [
          { accountCode: '9999_NON_EXISTENT', lineSequence: 1, debitAmount: '100.00', creditAmount: '0.00' },
          { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '100.00' }
        ]
      };

      await expect(accountingCoreService.processAccountingEvent(ctx, event)).rejects.toThrow(AccountingError);
    });
  });

  // 2. Strict Financial Invariants Enforcement
  describe('Financial Invariants Enforcement', () => {
    it('rejects unbalanced accounting events (Debit != Credit)', async () => {
      const unbalancedEvent: AccountingEventInput = {
        eventType: 'SALES_INVOICE',
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'INV-UNBALANCED',
        lines: [
          { accountId: accArId, lineSequence: 1, debitAmount: '1000.00', creditAmount: '0.00' },
          { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '999.99' }
        ]
      };

      await expect(accountingCoreService.processAccountingEvent(ctx, unbalancedEvent)).rejects.toThrow(AccountingError);
    });

    it('rejects line amounts exceeding maximum monetary scale of 2 decimal places', async () => {
      const invalidScaleEvent: AccountingEventInput = {
        eventType: 'SALES_INVOICE',
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'INV-SCALE-ERR',
        lines: [
          { accountId: accArId, lineSequence: 1, debitAmount: '100.001', creditAmount: '0.00' },
          { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '100.001' }
        ]
      };

      await expect(accountingCoreService.processAccountingEvent(ctx, invalidScaleEvent)).rejects.toThrow(ValidationError);
    });

    it('rejects line violating Debit/Credit XOR invariant (both debit and credit positive)', async () => {
      const xorViolationEvent: AccountingEventInput = {
        eventType: 'SALES_INVOICE',
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'INV-XOR-ERR',
        lines: [
          { accountId: accArId, lineSequence: 1, debitAmount: '100.00', creditAmount: '50.00' },
          { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '50.00' }
        ]
      };

      await expect(accountingCoreService.processAccountingEvent(ctx, xorViolationEvent)).rejects.toThrow(ValidationError);
    });

    it('rejects negative debit or credit amounts', async () => {
      const negativeEvent: AccountingEventInput = {
        eventType: 'SALES_INVOICE',
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'INV-NEG-ERR',
        lines: [
          { accountId: accArId, lineSequence: 1, debitAmount: '-100.00', creditAmount: '0.00' },
          { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '-100.00' }
        ]
      };

      await expect(accountingCoreService.processAccountingEvent(ctx, negativeEvent)).rejects.toThrow(ValidationError);
    });

    it('rejects non-INR currency in Phase 2.4 single-currency scope', async () => {
      const nonInrEvent: AccountingEventInput = {
        eventType: 'SALES_INVOICE',
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'INV-USD-ERR',
        currency: 'USD',
        lines: [
          { accountId: accArId, lineSequence: 1, debitAmount: '100.00', creditAmount: '0.00' },
          { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '100.00' }
        ]
      };

      await expect(accountingCoreService.processAccountingEvent(ctx, nonInrEvent)).rejects.toThrow(ValidationError);
    });
  });

  // 3. Idempotency & Source Document Duplicate Prevention
  describe('Idempotency & Source Document Duplicate Prevention', () => {
    it('returns previously stored result for duplicate request with identical idempotencyKey', async () => {
      const event: AccountingEventInput = {
        eventType: 'SALES_INVOICE',
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'INV-IDEM-01',
        idempotencyKey: 'idem_key_sales_1001',
        lines: [
          { accountId: accArId, lineSequence: 1, debitAmount: '350.00', creditAmount: '0.00' },
          { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '350.00' }
        ]
      };

      const res1 = await accountingCoreService.processAccountingEvent(ctx, event);
      const res2 = await accountingCoreService.processAccountingEvent(ctx, event);

      expect(res1.id).toBe(res2.id);
      expect(res1.voucherNumber).toBe(res2.voucherNumber);
    });

    it('rejects second posting for identical source document id with different request key', async () => {
      const event1: AccountingEventInput = {
        eventType: 'SALES_INVOICE',
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'INV-SRC-DUP',
        idempotencyKey: 'key_request_1',
        lines: [
          { accountId: accArId, lineSequence: 1, debitAmount: '400.00', creditAmount: '0.00' },
          { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '400.00' }
        ]
      };

      const event2: AccountingEventInput = {
        ...event1,
        idempotencyKey: 'key_request_2'
      };

      await accountingCoreService.processAccountingEvent(ctx, event1);

      await expect(accountingCoreService.processAccountingEvent(ctx, event2)).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  // 4. Append-Only Reversal Orchestration
  describe('Append-Only Reversal Orchestration', () => {
    it('reverses an accounting event via append-only reversal journal', async () => {
      const event: AccountingEventInput = {
        eventType: 'SALES_INVOICE',
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'INV-REV-01',
        lines: [
          { accountId: accArId, lineSequence: 1, debitAmount: '800.00', creditAmount: '0.00' },
          { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '800.00' }
        ]
      };

      const posted = await accountingCoreService.processAccountingEvent(ctx, event);

      const reversal = await accountingCoreService.reverseAccountingEvent(ctx, {
        originalJournalId: posted.id!,
        reason: 'Customer cancelled sales order'
      });

      expect(reversal.id).toBeDefined();
      expect(reversal.status).toBe('POSTED');
      expect(reversal.originalJournalId).toBe(posted.id);
      expect(reversal.lines[0].debitAmount).toBe('0.00');
      expect(reversal.lines[0].creditAmount).toBe('800.00');

      // Original journal remains POSTED and unchanged
      const originalFetched = await glEngine.getJournalById(ctx, posted.id!);
      expect(originalFetched.status).toBe('POSTED');
    });

    it('rejects attempt to reverse a reversal journal (J2 -> J3 graph boundary)', async () => {
      const event: AccountingEventInput = {
        eventType: 'SALES_INVOICE',
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'INV-REV-GRAPH',
        lines: [
          { accountId: accArId, lineSequence: 1, debitAmount: '200.00', creditAmount: '0.00' },
          { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '200.00' }
        ]
      };

      const posted = await accountingCoreService.processAccountingEvent(ctx, event);
      const reversal = await accountingCoreService.reverseAccountingEvent(ctx, {
        originalJournalId: posted.id!,
        reason: 'Initial reversal'
      });

      await expect(
        accountingCoreService.reverseAccountingEvent(ctx, {
          originalJournalId: reversal.id!,
          reason: 'Attempting to reverse reversal journal'
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  // 5. Fastify REST API Routes (/api/v1/finance/accounting/*)
  describe('Fastify REST API Routes', () => {
    it('processes accounting events and manages mappings via Fastify HTTP routes', async () => {
      // 1. Post Mapping via API
      const mapRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/accounting/mappings',
        headers: {
          'x-tenant-id': 'tenant_acme',
          'x-company-id': 'company_hq'
        },
        payload: {
          companyId: 'company_hq',
          eventType: 'PURCHASE_INVOICE',
          lineRole: 'DEBIT_EXPENSE',
          accountId: accSalesId
        }
      });
      expect(mapRes.statusCode).toBe(201);

      // 2. Process Event via API
      const eventRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/accounting/events',
        headers: {
          'x-tenant-id': 'tenant_acme',
          'x-company-id': 'company_hq',
          'x-user-id': 'user_api_poster',
          'x-user-permissions': '*'
        },
        payload: {
          eventType: 'SALES_INVOICE',
          companyId: 'company_hq',
          accountingDate: '2026-04-15',
          sourceModule: 'SALES',
          sourceDocumentId: 'INV-API-01',
          lines: [
            { accountId: accArId, lineSequence: 1, debitAmount: '600.00', creditAmount: '0.00' },
            { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '600.00' }
          ]
        }
      });
      expect(eventRes.statusCode).toBe(201);
      const postedData = JSON.parse(eventRes.payload).data;
      expect(postedData.status).toBe('POSTED');

      // 3. Reverse Event via API
      const revRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/accounting/reverse',
        headers: {
          'x-tenant-id': 'tenant_acme',
          'x-company-id': 'company_hq',
          'x-user-id': 'user_api_reverser',
          'x-user-permissions': '*'
        },
        payload: {
          originalJournalId: postedData.id,
          reason: 'API reversal request'
        }
      });
      expect(revRes.statusCode).toBe(200);
      expect(JSON.parse(revRes.payload).data.originalJournalId).toBe(postedData.id);
    });
  });

  // 6. Concurrency & High-Load Testing
  describe('Concurrency & High-Load Testing', () => {
    it('executes 100 concurrent identical events, producing exactly 1 posted journal', async () => {
      const event: AccountingEventInput = {
        eventType: 'SALES_INVOICE',
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'INV-CONCURRENCY-SAME',
        idempotencyKey: 'key_concurrency_same',
        lines: [
          { accountId: accArId, lineSequence: 1, debitAmount: '999.00', creditAmount: '0.00' },
          { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '999.00' }
        ]
      };

      const requests = Array.from({ length: 100 }, () =>
        accountingCoreService.processAccountingEvent(ctx, event)
      );

      const results = await Promise.allSettled(requests);
      const fulfilled = results.filter(r => r.status === 'fulfilled');

      expect(fulfilled.length).toBe(100);
      const journalIds = new Set(fulfilled.map(r => (r as PromiseFulfilledResult<any>).value.id));
      expect(journalIds.size).toBe(1); // All returned the EXACT same posted journal!
    });

    it('executes 100 concurrent independent events, producing 100 posted journals with unique voucher numbers', async () => {
      const requests = Array.from({ length: 100 }, (_, i) =>
        accountingCoreService.processAccountingEvent(ctx, {
          eventType: 'SALES_INVOICE',
          companyId: 'company_hq',
          accountingDate: '2026-04-15',
          sourceModule: 'SALES',
          sourceDocumentId: `INV-CONCUR-IND-${i + 1}`,
          lines: [
            { accountId: accArId, lineSequence: 1, debitAmount: '10.00', creditAmount: '0.00' },
            { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '10.00' }
          ]
        })
      );

      const results = await Promise.allSettled(requests);
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      expect(fulfilled.length).toBe(100);

      const voucherNumbers = new Set(fulfilled.map(r => (r as PromiseFulfilledResult<any>).value.voucherNumber));
      expect(voucherNumbers.size).toBe(100); // 100 distinct vouchers allocated!
    });
  });

  // 7. Randomized Stress & Invariant Verification Test
  describe('Randomized Invariant Stress Test', () => {
    it('executes 200 randomized accounting event attempts verifying financial invariants', async () => {
      let successCount = 0;
      let rejectedCount = 0;

      for (let i = 0; i < 200; i++) {
        const isBalanced = i % 2 === 0; // 50% balanced, 50% unbalanced
        const isScaleValid = i % 3 !== 0; // 66% valid scale, 34% scale > 2
        const isXorValid = i % 5 !== 0; // 80% valid XOR

        const debitAmount = isScaleValid ? `${(100 + i).toFixed(2)}` : `${(100 + i).toFixed(3)}`;
        const creditAmount = isBalanced
          ? debitAmount
          : `${(100 + i + 1).toFixed(2)}`;

        const event: AccountingEventInput = {
          eventType: 'RANDOM_STRESS',
          companyId: 'company_hq',
          accountingDate: '2026-04-15',
          sourceModule: 'STRESS',
          sourceDocumentId: `INV-STRESS-${i + 1}`,
          lines: [
            {
              accountId: accArId,
              lineSequence: 1,
              debitAmount,
              creditAmount: isXorValid ? '0.00' : '10.00'
            },
            {
              accountId: accSalesId,
              lineSequence: 2,
              debitAmount: '0.00',
              creditAmount
            }
          ]
        };

        try {
          const posted = await accountingCoreService.processAccountingEvent(ctx, event);
          expect(posted.status).toBe('POSTED');
          successCount++;
        } catch (err) {
          expect(err).toBeDefined();
          rejectedCount++;
        }
      }

      expect(successCount + rejectedCount).toBe(200);
      expect(successCount).toBeGreaterThan(0);
      expect(rejectedCount).toBeGreaterThan(0);
    });
  });

  // 8. Tenant & Company Security Isolation
  describe('Tenant & Company Security Isolation', () => {
    it('prevents Tenant B from using Tenant A accounts in accounting event', async () => {
      const event: AccountingEventInput = {
        eventType: 'SALES_INVOICE',
        companyId: 'company_other',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'INV-CROSS-TENANT',
        lines: [
          { accountId: accArId, lineSequence: 1, debitAmount: '100.00', creditAmount: '0.00' },
          { accountId: accSalesId, lineSequence: 2, debitAmount: '0.00', creditAmount: '100.00' }
        ]
      };

      await expect(accountingCoreService.processAccountingEvent(ctxTenantB, event)).rejects.toThrow();
    });
  });
});
