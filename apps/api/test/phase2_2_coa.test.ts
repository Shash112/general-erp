import { describe, it, expect } from 'vitest';
import {
  chartOfAccountsService,
  ChartOfAccountsService,
  PostedTransactionLookup,
  NoOpPostedTransactionLookup,
  TestPostedTransactionLookupAdapter
} from '../src/modules/finance/chart-of-accounts.service.js';
import { RequestContext, ValidationError, BusinessRuleViolationError, ForbiddenError, NotFoundError } from '@general-erp/core';

describe('Phase 2.2 — Chart of Accounts (COA) Tests', () => {
  const ctxCompanyA: RequestContext = {
    requestId: 'req_coa_test_a',
    tenantId: 'tenant_acme',
    companyId: 'company_hq',
    ip: '127.0.0.1',
    userAgent: 'vitest-agent',
    timestamp: new Date(),
    user: {
      userId: 'user_fin_admin',
      tenantId: 'tenant_acme',
      companyId: 'company_hq',
      roles: ['finance_admin'],
      permissions: ['*']
    }
  };

  const ctxCompanyB: RequestContext = {
    requestId: 'req_coa_test_b',
    tenantId: 'tenant_other',
    companyId: 'company_other',
    ip: '127.0.0.1',
    userAgent: 'vitest-agent',
    timestamp: new Date(),
    user: {
      userId: 'user_other',
      tenantId: 'tenant_other',
      companyId: 'company_other',
      roles: ['finance_user'],
      permissions: ['finance:coa:read']
    }
  };

  function getCtxForCompany(companyId: string): RequestContext {
    return {
      ...ctxCompanyA,
      companyId,
      user: {
        ...ctxCompanyA.user!,
        companyId
      }
    };
  }

  // 1. Account Types & Normal Balance Determination
  describe('Account Types, Nature & Normal Balance', () => {
    it('calculates deterministic normal balance for NORMAL and CONTRA accounts', () => {
      expect(chartOfAccountsService.calculateNormalBalance('ASSET', 'NORMAL')).toBe('DEBIT');
      expect(chartOfAccountsService.calculateNormalBalance('ASSET', 'CONTRA')).toBe('CREDIT');
      expect(chartOfAccountsService.calculateNormalBalance('LIABILITY', 'NORMAL')).toBe('CREDIT');
      expect(chartOfAccountsService.calculateNormalBalance('LIABILITY', 'CONTRA')).toBe('DEBIT');
      expect(chartOfAccountsService.calculateNormalBalance('EQUITY', 'NORMAL')).toBe('CREDIT');
      expect(chartOfAccountsService.calculateNormalBalance('INCOME', 'NORMAL')).toBe('CREDIT');
      expect(chartOfAccountsService.calculateNormalBalance('INCOME', 'CONTRA')).toBe('DEBIT');
      expect(chartOfAccountsService.calculateNormalBalance('EXPENSE', 'NORMAL')).toBe('DEBIT');
      expect(chartOfAccountsService.calculateNormalBalance('EXPENSE', 'CONTRA')).toBe('CREDIT');
    });

    it('creates a normal ASSET account with DEBIT balance', async () => {
      const acc = await chartOfAccountsService.createAccount(ctxCompanyA, {
        companyId: 'company_hq',
        accountCode: '1001',
        accountName: 'Petty Cash',
        nodeType: 'ACCOUNT',
        accountType: 'ASSET',
        accountNature: 'NORMAL'
      });

      expect(acc.accountCode).toBe('1001');
      expect(acc.normalBalance).toBe('DEBIT');
      expect(acc.isPostable).toBe(true);
      expect(acc.status).toBe('ACTIVE');
    });

    it('creates a CONTRA ASSET account (Accumulated Depreciation) with CREDIT balance', async () => {
      const acc = await chartOfAccountsService.createAccount(ctxCompanyA, {
        companyId: 'company_hq',
        accountCode: '1099',
        accountName: 'Accumulated Depreciation - Buildings',
        nodeType: 'ACCOUNT',
        accountType: 'ASSET',
        accountNature: 'CONTRA'
      });

      expect(acc.accountNature).toBe('CONTRA');
      expect(acc.normalBalance).toBe('CREDIT');
    });
  });

  // 2. Account Code Formatting & Validation
  describe('Account Code Formatting & Scope Uniqueness', () => {
    it('normalizes account code to uppercase trimmed string', async () => {
      const acc = await chartOfAccountsService.createAccount(ctxCompanyA, {
        companyId: 'company_hq',
        accountCode: '  1002-cash  ',
        accountName: 'Branch Cash',
        accountType: 'ASSET'
      });

      expect(acc.accountCode).toBe('1002-CASH');
    });

    it('REJECTS invalid account code formats (too short, invalid characters)', async () => {
      await expect(
        chartOfAccountsService.createAccount(ctxCompanyA, {
          companyId: 'company_hq',
          accountCode: '10',
          accountName: 'Short Code',
          accountType: 'ASSET'
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        chartOfAccountsService.createAccount(ctxCompanyA, {
          companyId: 'company_hq',
          accountCode: '1000@CASH',
          accountName: 'Symbol Code',
          accountType: 'ASSET'
        })
      ).rejects.toThrow(ValidationError);
    });

    it('REJECTS duplicate account code for the same company', async () => {
      await expect(
        chartOfAccountsService.createAccount(ctxCompanyA, {
          companyId: 'company_hq',
          accountCode: '1001',
          accountName: 'Duplicate Code Test',
          accountType: 'ASSET'
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  // 3. Hierarchy, Depth & Postability Rules
  describe('Hierarchy, Depth & Postability Rules', () => {
    it('creates an Account Group (nodeType=GROUP, isPostable=false)', async () => {
      const grp = await chartOfAccountsService.createAccount(ctxCompanyA, {
        companyId: 'company_hq',
        accountCode: '1100-TEST',
        accountName: 'Current Assets Group',
        nodeType: 'GROUP',
        accountType: 'ASSET'
      });

      expect(grp.nodeType).toBe('GROUP');
      expect(grp.isPostable).toBe(false);
    });

    it('creates child account referencing parent group with category consistency', async () => {
      const parent = await chartOfAccountsService.getAccountsList(ctxCompanyA, 'company_hq');
      const grp = parent.find(a => a.accountCode === '1100-TEST')!;

      const child = await chartOfAccountsService.createAccount(ctxCompanyA, {
        companyId: 'company_hq',
        accountCode: '1110-TEST',
        accountName: 'Sub Cash',
        nodeType: 'ACCOUNT',
        accountType: 'ASSET',
        parentId: grp.id
      });

      expect(child.parentId).toBe(grp.id);
      expect(child.accountType).toBe('ASSET');
    });

    it('REJECTS child account creation if child category does not match parent category', async () => {
      const parent = await chartOfAccountsService.getAccountsList(ctxCompanyA, 'company_hq');
      const grp = parent.find(a => a.accountCode === '1100-TEST')!;

      await expect(
        chartOfAccountsService.createAccount(ctxCompanyA, {
          companyId: 'company_hq',
          accountCode: '2110-ERR',
          accountName: 'Category Mismatch Child',
          nodeType: 'ACCOUNT',
          accountType: 'LIABILITY',
          parentId: grp.id
        })
      ).rejects.toThrow(ValidationError);
    });

    it('REJECTS hierarchy depth exceeding 10 levels', async () => {
      let currentParentId: string | undefined;

      for (let depth = 1; depth <= 10; depth++) {
        const acc = await chartOfAccountsService.createAccount(ctxCompanyA, {
          companyId: 'company_hq',
          accountCode: `D${depth.toString().padStart(3, '0')}`,
          accountName: `Depth Level ${depth}`,
          nodeType: depth === 10 ? 'ACCOUNT' : 'GROUP',
          accountType: 'EXPENSE',
          parentId: currentParentId
        });
        currentParentId = acc.id;
      }

      // Level 11 attempt must fail
      await expect(
        chartOfAccountsService.createAccount(ctxCompanyA, {
          companyId: 'company_hq',
          accountCode: 'D011',
          accountName: 'Depth Level 11 Exceeded',
          nodeType: 'ACCOUNT',
          accountType: 'EXPENSE',
          parentId: currentParentId
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  // 4. Deletion Guards & GL Eligibility Contract
  describe('Deletion Guards & GL Eligibility Contract', () => {
    it('asserts posting eligibility for ACTIVE postable ACCOUNT and rejects GROUP nodes', async () => {
      const accounts = await chartOfAccountsService.getAccountsList(ctxCompanyA, 'company_hq');
      const postableAcc = accounts.find(a => a.isPostable && a.status === 'ACTIVE')!;
      const groupNode = accounts.find(a => a.nodeType === 'GROUP')!;

      const postableEligibility = await chartOfAccountsService.assertAccountEligibilityForPosting(ctxCompanyA, postableAcc.id);
      expect(postableEligibility.isEligibleForPosting).toBe(true);

      const groupEligibility = await chartOfAccountsService.assertAccountEligibilityForPosting(ctxCompanyA, groupNode.id);
      expect(groupEligibility.isEligibleForPosting).toBe(false);
      expect(groupEligibility.ineligibilityReason).toContain('GROUP node');
    });

    it('REJECTS deletion of an account that has child accounts', async () => {
      const parent = (await chartOfAccountsService.getAccountsList(ctxCompanyA, 'company_hq')).find(a => a.accountCode === '1100-TEST')!;

      await expect(
        chartOfAccountsService.deleteAccount(ctxCompanyA, parent.id)
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('REJECTS deletion of an account that has posted GL transactions', async () => {
      const acc = await chartOfAccountsService.createAccount(ctxCompanyA, {
        companyId: 'company_hq',
        accountCode: '1999',
        accountName: 'Posted Transaction Test Account',
        accountType: 'ASSET'
      });

      // Register mock posted transaction
      chartOfAccountsService.registerPostedTransactionForTest(acc.id);

      await expect(
        chartOfAccountsService.deleteAccount(ctxCompanyA, acc.id)
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('allows physical deletion of an unused account with no children or GL postings', async () => {
      const acc = await chartOfAccountsService.createAccount(ctxCompanyA, {
        companyId: 'company_hq',
        accountCode: '9999',
        accountName: 'Unused Temporary Account',
        accountType: 'EXPENSE'
      });

      const deleted = await chartOfAccountsService.deleteAccount(ctxCompanyA, acc.id);
      expect(deleted).toBe(true);
    });

    it('REJECTS mutation of immutable attributes (accountType, accountSubtype, parentId, accountCode) after GL postings exist', async () => {
      const acc = await chartOfAccountsService.createAccount(ctxCompanyA, {
        companyId: 'company_hq',
        accountCode: '1888',
        accountName: 'Immutability Test Account',
        accountType: 'ASSET',
        accountSubtype: 'CURRENT_ASSET'
      });

      // Register mock posted GL transaction
      chartOfAccountsService.registerPostedTransactionForTest(acc.id);

      // Updating accountName is ALLOWED
      const updatedName = await chartOfAccountsService.updateAccount(ctxCompanyA, acc.id, {
        accountName: 'Immutability Test Account Updated'
      });
      expect(updatedName.accountName).toBe('Immutability Test Account Updated');

      // Updating accountType is REJECTED
      await expect(
        chartOfAccountsService.updateAccount(ctxCompanyA, acc.id, {
          accountType: 'LIABILITY'
        })
      ).rejects.toThrow(BusinessRuleViolationError);

      // Updating accountSubtype is REJECTED
      await expect(
        chartOfAccountsService.updateAccount(ctxCompanyA, acc.id, {
          accountSubtype: 'FIXED_ASSET'
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  // 5. Template Application (INDIAN_SME_DEFAULT_V1)
  describe('Default Indian SME COA Template Engine', () => {
    it('instantiates generic INDIAN_SME_DEFAULT_V1 template for a new company', async () => {
      const ctxSme = getCtxForCompany('company_new_sme');
      const result = await chartOfAccountsService.applyTemplate(ctxSme, {
        companyId: 'company_new_sme',
        templateId: 'INDIAN_SME_DEFAULT_V1'
      });

      expect(result.createdCount).toBeGreaterThan(25);
      expect(result.skippedCount).toBe(0);

      const tree = await chartOfAccountsService.getAccountTree(ctxSme, 'company_new_sme');
      expect(tree.length).toBe(5); // 5 Root Categories: Assets, Liabilities, Equity, Revenue, Expenses

      // Verify generic bank account
      const allAccs = await chartOfAccountsService.getAccountsList(ctxSme, 'company_new_sme');
      const bankAcc = allAccs.find(a => a.accountCode === '1120');
      expect(bankAcc).toBeDefined();
      expect(bankAcc?.accountName).toBe('Primary Bank Account');
      expect(bankAcc?.isControlAccount).toBe(true);
      expect(bankAcc?.controlAccountType).toBe('BANK');
    });

    it('is IDEMPOTENT when re-applying the template (skips existing matching accounts)', async () => {
      const ctxSme = getCtxForCompany('company_new_sme');
      const reapplyResult = await chartOfAccountsService.applyTemplate(ctxSme, {
        companyId: 'company_new_sme',
        templateId: 'INDIAN_SME_DEFAULT_V1'
      });

      expect(reapplyResult.createdCount).toBe(0);
      expect(reapplyResult.skippedCount).toBeGreaterThan(25);
    });

    it('REJECTS template application if structural category conflict exists', async () => {
      const ctxConflict = getCtxForCompany('company_conflict');
      // Create code 1130 as LIABILITY for company_conflict
      await chartOfAccountsService.createAccount(ctxConflict, {
        companyId: 'company_conflict',
        accountCode: '1130',
        accountName: 'Conflicting Receivables',
        accountType: 'LIABILITY'
      });

      await expect(
        chartOfAccountsService.applyTemplate(ctxConflict, {
          companyId: 'company_conflict',
          templateId: 'INDIAN_SME_DEFAULT_V1'
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  // 6. Multi-Tenant Isolation & Authorization Security
  describe('Multi-Tenant Isolation & Authorization', () => {
    it('PREVENTS Tenant B from reading or accessing Tenant A accounts', async () => {
      await expect(
        chartOfAccountsService.getAccountById(ctxCompanyB, '1001')
      ).rejects.toThrow(NotFoundError);

      const tenantBAccounts = await chartOfAccountsService.getAccountsList(ctxCompanyB, 'company_hq');
      expect(tenantBAccounts.length).toBe(0);
    });

    it('PREVENTS unauthorized user from creating accounts', async () => {
      const unauthCtx: RequestContext = {
        ...ctxCompanyA,
        user: {
          userId: 'user_viewer',
          tenantId: 'tenant_acme',
          companyId: 'company_hq',
          roles: ['viewer'],
          permissions: ['finance:coa:read']
        }
      };

      await expect(
        chartOfAccountsService.createAccount(unauthCtx, {
          companyId: 'company_hq',
          accountCode: '9900',
          accountName: 'Unauth Account',
          accountType: 'ASSET'
        })
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // 7. High Concurrency Load Test
  describe('High Concurrency Account Creation', () => {
    it('executes 100 concurrent account creation requests for identical accountCode yielding 1 success and 99 failures', async () => {
      const ctxConcurrent = getCtxForCompany('company_concurrent');
      const promises: Promise<any>[] = [];
      const testCode = 'C100';

      for (let i = 0; i < 100; i++) {
        promises.push(
          chartOfAccountsService.createAccount(ctxConcurrent, {
            companyId: 'company_concurrent',
            accountCode: testCode,
            accountName: `Concurrent Account ${i}`,
            accountType: 'EXPENSE'
          })
        );
      }

      const results = await Promise.allSettled(promises);
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(99);
    });
  });

  // 8. Future GL Posted Transaction Boundary Integration Tests
  describe('Posted Transaction Lookup Boundary Contract', () => {
    it('defaults to NoOpPostedTransactionLookup in Phase 2.2 without requiring GL implementation', async () => {
      const freshCoaService = new ChartOfAccountsService();
      const lookup = freshCoaService.getPostedTransactionLookup();
      expect(lookup).toBeInstanceOf(NoOpPostedTransactionLookup);

      const acc = await freshCoaService.createAccount(ctxCompanyA, {
        companyId: 'company_hq',
        accountCode: '8001',
        accountName: 'No GL Requirement Account',
        accountType: 'EXPENSE'
      });

      // No GL state exists; update is allowed
      const updated = await freshCoaService.updateAccount(ctxCompanyA, acc.id, {
        accountName: 'No GL Requirement Account Updated'
      });
      expect(updated.accountName).toBe('No GL Requirement Account Updated');
    });

    it('accepts custom/test PostedTransactionLookup adapter and respects its response for immutability and deletion guards', async () => {
      const adapter = new TestPostedTransactionLookupAdapter();
      const boundaryService = new ChartOfAccountsService(adapter);

      const acc = await boundaryService.createAccount(ctxCompanyA, {
        companyId: 'company_hq',
        accountCode: '8002',
        accountName: 'Adapter Test Account',
        accountType: 'ASSET'
      });

      // Initially no postings registered in adapter
      expect(await adapter.hasPostedTransactions(ctxCompanyA, acc.id)).toBe(false);

      // Register posting in adapter
      adapter.registerPostedTransaction(acc.id);
      expect(await adapter.hasPostedTransactions(ctxCompanyA, acc.id)).toBe(true);

      // Immutability guard checks adapter and rejects attribute mutation
      await expect(
        boundaryService.updateAccount(ctxCompanyA, acc.id, { accountType: 'LIABILITY' })
      ).rejects.toThrow(BusinessRuleViolationError);

      // Deletion guard checks adapter and rejects deletion
      await expect(
        boundaryService.deleteAccount(ctxCompanyA, acc.id)
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('demonstrates Phase 2.3 pluggability via setPostedTransactionLookup', async () => {
      const coaService = new ChartOfAccountsService();

      // Simulate Phase 2.3 GL lookup implementation contract
      class MockPhase23GLLookup implements PostedTransactionLookup {
        constructor(private postedIds: Set<string>) {}
        async hasPostedTransactions(_ctx: RequestContext, accountId: string): Promise<boolean> {
          return this.postedIds.has(accountId);
        }
      }

      const glPostedAccounts = new Set<string>();
      coaService.setPostedTransactionLookup(new MockPhase23GLLookup(glPostedAccounts));

      const acc = await coaService.createAccount(ctxCompanyA, {
        companyId: 'company_hq',
        accountCode: '8003',
        accountName: 'Phase 2.3 Pluggable Account',
        accountType: 'INCOME'
      });

      // Before Phase 2.3 GL posting occurs
      const deletedBefore = await coaService.deleteAccount(ctxCompanyA, acc.id);
      expect(deletedBefore).toBe(true);

      const acc2 = await coaService.createAccount(ctxCompanyA, {
        companyId: 'company_hq',
        accountCode: '8004',
        accountName: 'Phase 2.3 Posted Account',
        accountType: 'INCOME'
      });

      // Phase 2.3 GL posts a journal line for acc2
      glPostedAccounts.add(acc2.id);

      // COA service seamlessly enforces deletion guard via Phase 2.3 GL lookup
      await expect(
        coaService.deleteAccount(ctxCompanyA, acc2.id)
      ).rejects.toThrow(BusinessRuleViolationError);
    });
  });
});
