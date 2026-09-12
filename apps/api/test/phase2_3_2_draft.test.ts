import { describe, it, expect, beforeEach } from 'vitest';
import { journalDraftService, CreateDraftJournalInput } from '../src/modules/finance/journal-draft.service.js';
import { RequestContext, ValidationError, AccountingError, BusinessRuleViolationError, ConflictError, NotFoundError } from '@general-erp/core';
import { numberingEngine } from '../src/platform/numbering/numbering.service.js';

describe('Phase 2.3.2 — Draft Journal Lifecycle Tests', () => {
  const ctxCompanyA: RequestContext = {
    requestId: 'req_draft_test_a',
    tenantId: 'tenant_acme',
    companyId: 'company_hq',
    ip: '127.0.0.1',
    userAgent: 'vitest-agent',
    timestamp: new Date(),
    user: {
      userId: 'user_fin_drafter',
      email: 'drafter@acme.com',
      tenantId: 'tenant_acme',
      companyId: 'company_hq',
      roles: ['finance_user'],
      permissions: ['finance:gl:create', 'finance:gl:update', 'finance:gl:cancel']
    }
  };

  const ctxCompanyB: RequestContext = {
    requestId: 'req_draft_test_b',
    tenantId: 'tenant_other',
    companyId: 'company_other',
    ip: '127.0.0.1',
    userAgent: 'vitest-agent',
    timestamp: new Date(),
    user: {
      userId: 'user_other',
      email: 'user@other.com',
      tenantId: 'tenant_other',
      companyId: 'company_other',
      roles: ['finance_user'],
      permissions: ['finance:gl:read']
    }
  };

  const sampleCreateInput: CreateDraftJournalInput = {
    companyId: 'company_hq',
    fiscalYearId: 'fy_2026_27',
    fiscalPeriodId: 'fp_2026_04',
    accountingDate: '2026-04-15',
    sourceModule: 'MANUAL',
    narration: 'Initial draft manual journal for testing',
    lines: [
      {
        accountId: 'acc_cash_101',
        lineSequence: 1,
        debitAmount: '500.00',
        creditAmount: '0.00',
        narration: 'Cash debit'
      },
      {
        accountId: 'acc_sales_401',
        lineSequence: 2,
        debitAmount: '0.00',
        creditAmount: '500.00',
        narration: 'Sales credit'
      }
    ]
  };

  beforeEach(() => {
    journalDraftService.clear();
  });

  // 1. Create Draft Tests
  describe('Create Draft Journal', () => {
    it('creates a valid draft journal entry with status DRAFT and voucherNumber NULL', async () => {
      const created = await journalDraftService.createDraft(ctxCompanyA, sampleCreateInput);

      expect(created.id).toBeDefined();
      expect(created.status).toBe('DRAFT');
      expect(created.voucherNumber).toBeNull(); // Voucher number MUST be NULL for DRAFT
      expect(created.totalDebit).toBe('500.00');
      expect(created.totalCredit).toBe('500.00');
      expect(created.lines.length).toBe(2);
      expect(created.version).toBe(1);

      // Verify draft retrieval
      const fetched = await journalDraftService.getDraftById(ctxCompanyA, created.id!);
      expect(fetched.id).toBe(created.id);
      expect(fetched.status).toBe('DRAFT');
      expect(fetched.voucherNumber).toBeNull();
    });

    it('rejects unbalanced draft creation throwing AccountingError', async () => {
      const unbalancedInput: CreateDraftJournalInput = {
        ...sampleCreateInput,
        lines: [
          {
            accountId: 'acc_cash_101',
            lineSequence: 1,
            debitAmount: '500.00',
            creditAmount: '0.00'
          },
          {
            accountId: 'acc_sales_401',
            lineSequence: 2,
            debitAmount: '0.00',
            creditAmount: '499.99'
          }
        ]
      };

      await expect(journalDraftService.createDraft(ctxCompanyA, unbalancedInput)).rejects.toThrow(AccountingError);
    });

    it('rejects draft line with monetary scale > 2 without silent rounding', async () => {
      const invalidScaleInput: CreateDraftJournalInput = {
        ...sampleCreateInput,
        lines: [
          {
            accountId: 'acc_cash_101',
            lineSequence: 1,
            debitAmount: '500.001',
            creditAmount: '0.00'
          },
          {
            accountId: 'acc_sales_401',
            lineSequence: 2,
            debitAmount: '0.00',
            creditAmount: '500.001'
          }
        ]
      };

      await expect(journalDraftService.createDraft(ctxCompanyA, invalidScaleInput)).rejects.toThrow(ValidationError);
    });

    it('rejects zero-value lines', async () => {
      const zeroLineInput: CreateDraftJournalInput = {
        ...sampleCreateInput,
        lines: [
          {
            accountId: 'acc_cash_101',
            lineSequence: 1,
            debitAmount: '0.00',
            creditAmount: '0.00'
          }
        ]
      };

      await expect(journalDraftService.createDraft(ctxCompanyA, zeroLineInput)).rejects.toThrow(ValidationError);
    });

    it('rejects negative line amounts', async () => {
      const negativeInput: CreateDraftJournalInput = {
        ...sampleCreateInput,
        lines: [
          {
            accountId: 'acc_cash_101',
            lineSequence: 1,
            debitAmount: '-500.00',
            creditAmount: '0.00'
          },
          {
            accountId: 'acc_sales_401',
            lineSequence: 2,
            debitAmount: '0.00',
            creditAmount: '-500.00'
          }
        ]
      };

      await expect(journalDraftService.createDraft(ctxCompanyA, negativeInput)).rejects.toThrow(ValidationError);
    });
  });

  // 2. Update Draft Tests
  describe('Update Draft Journal', () => {
    it('updates a draft journal entry atomically and increments version', async () => {
      const created = await journalDraftService.createDraft(ctxCompanyA, sampleCreateInput);

      const updated = await journalDraftService.updateDraft(ctxCompanyA, created.id!, {
        narration: 'Updated narration for draft journal',
        lines: [
          {
            accountId: 'acc_cash_101',
            lineSequence: 1,
            debitAmount: '750.25',
            creditAmount: '0.00'
          },
          {
            accountId: 'acc_sales_401',
            lineSequence: 2,
            debitAmount: '0.00',
            creditAmount: '750.25'
          }
        ]
      });

      expect(updated.id).toBe(created.id);
      expect(updated.version).toBe(2);
      expect(updated.totalDebit).toBe('750.25');
      expect(updated.totalCredit).toBe('750.25');
      expect(updated.narration).toBe('Updated narration for draft journal');

      const fetched = await journalDraftService.getDraftById(ctxCompanyA, created.id!);
      expect(fetched.totalDebit).toBe('750.25');
      expect(fetched.version).toBe(2);
    });

    it('rejects update when expectedVersion does not match current version (optimistic locking)', async () => {
      const created = await journalDraftService.createDraft(ctxCompanyA, sampleCreateInput);

      await expect(
        journalDraftService.updateDraft(ctxCompanyA, created.id!, {
          expectedVersion: 99,
          narration: 'Conflicting update attempt'
        })
      ).rejects.toThrow(ConflictError);
    });

    it('defends against mass assignment of protected system fields', async () => {
      const created = await journalDraftService.createDraft(ctxCompanyA, sampleCreateInput);

      // Attempt to pollute protected fields via update input cast
      const updatePayload: any = {
        id: 'je_hacked_id',
        tenantId: 'tenant_hacked',
        companyId: 'company_hacked',
        status: 'POSTED',
        voucherNumber: 'JV-HACKED-9999',
        createdBy: 'hacker',
        postedBy: 'hacker',
        postedAt: new Date(),
        narration: 'Legitimate narration update'
      };

      const updated = await journalDraftService.updateDraft(ctxCompanyA, created.id!, updatePayload);

      expect(updated.id).toBe(created.id);
      expect(updated.tenantId).toBe('tenant_acme');
      expect(updated.companyId).toBe('company_hq');
      expect(updated.status).toBe('DRAFT');
      expect(updated.voucherNumber).toBeNull();
      expect(updated.createdBy).toBe('user_fin_drafter');
      expect(updated.postedBy).toBeNull();
      expect(updated.postedAt).toBeNull();
    });
  });

  // 3. Draft Cancellation Tests
  describe('Cancel Draft Journal', () => {
    it('cancels a draft journal entry (DRAFT -> CANCELLED)', async () => {
      const created = await journalDraftService.createDraft(ctxCompanyA, sampleCreateInput);

      const cancelled = await journalDraftService.cancelDraft(ctxCompanyA, created.id!);

      expect(cancelled.id).toBe(created.id);
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.voucherNumber).toBeNull();
      expect(cancelled.version).toBe(2);

      const fetched = await journalDraftService.getDraftById(ctxCompanyA, created.id!);
      expect(fetched.status).toBe('CANCELLED');
    });

    it('rejects update on CANCELLED journal entry', async () => {
      const created = await journalDraftService.createDraft(ctxCompanyA, sampleCreateInput);
      await journalDraftService.cancelDraft(ctxCompanyA, created.id!);

      await expect(
        journalDraftService.updateDraft(ctxCompanyA, created.id!, {
          narration: 'Attempting to update cancelled draft'
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('rejects cancellation of an already CANCELLED journal entry', async () => {
      const created = await journalDraftService.createDraft(ctxCompanyA, sampleCreateInput);
      await journalDraftService.cancelDraft(ctxCompanyA, created.id!);

      await expect(journalDraftService.cancelDraft(ctxCompanyA, created.id!)).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  // 4. Tenant & Company Ownership Isolation Tests
  describe('Tenant & Company Ownership Isolation', () => {
    it('prevents Tenant B from reading Tenant A draft journal', async () => {
      const created = await journalDraftService.createDraft(ctxCompanyA, sampleCreateInput);

      await expect(journalDraftService.getDraftById(ctxCompanyB, created.id!)).rejects.toThrow(NotFoundError);
    });

    it('prevents Tenant B from updating Tenant A draft journal', async () => {
      const created = await journalDraftService.createDraft(ctxCompanyA, sampleCreateInput);

      await expect(
        journalDraftService.updateDraft(ctxCompanyB, created.id!, {
          narration: 'Tenant B attempt to modify Tenant A'
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('prevents Tenant B from cancelling Tenant A draft journal', async () => {
      const created = await journalDraftService.createDraft(ctxCompanyA, sampleCreateInput);

      await expect(journalDraftService.cancelDraft(ctxCompanyB, created.id!)).rejects.toThrow(NotFoundError);
    });
  });

  // 5. NumberingEngine Sequence Preservation Regression Test
  describe('NumberingEngine Sequence Preservation', () => {
    it('verifies draft creation, update, and cancellation do NOT consume voucher numbers', async () => {
      const seq1 = numberingEngine.generateNextNumber('tenant_acme', 'company_hq', 'JOURNAL_VOUCHER', '2025-26', 'HQ');

      const created = await journalDraftService.createDraft(ctxCompanyA, sampleCreateInput);
      expect(created.voucherNumber).toBeNull();

      await journalDraftService.updateDraft(ctxCompanyA, created.id!, {
        narration: 'Updated without sequence consumption'
      });

      await journalDraftService.cancelDraft(ctxCompanyA, created.id!);

      const seq2 = numberingEngine.generateNextNumber('tenant_acme', 'company_hq', 'JOURNAL_VOUCHER', '2025-26', 'HQ');

      // Proves that draft lifecycle performed zero sequence increments!
      expect(seq2).toBe(seq1.replace(/0001$/, '0002'));
    });
  });

});
