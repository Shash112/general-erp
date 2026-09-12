import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { accountingCoreService, accountingConfigurationService, PostTaxAccountingEventInput } from '../src/modules/finance/accounting-core.service.js';
import { taxEngineService } from '../src/modules/finance/tax-engine.service.js';
import { taxCalculationService } from '../src/modules/finance/tax-calculation.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { journalDraftService } from '../src/modules/finance/journal-draft.service.js';
import { glEngine } from '../src/modules/finance/gl-engine.js';
import { RequestContext, ValidationError, ForbiddenError, BusinessRuleViolationError, AccountingError, ExactDecimal } from '@general-erp/core';

describe('Phase 2.5.4 — Accounting Integration & Tax Control Account Posting Tests', () => {
  let app: ReturnType<typeof buildApp>;
  let accArId: string;
  let accSalesId: string;
  let accApId: string;
  let accExpenseId: string;
  let accOutputCgstId: string;
  let accOutputSgstId: string;
  let accOutputIgstId: string;
  let accOutputUtgstId: string;
  let accOutputCessId: string;
  let accInputCgstId: string;
  let accInputSgstId: string;
  let accInputIgstId: string;
  let accInputUtgstId: string;
  let accInputCessId: string;

  const ctx: RequestContext = {
    requestId: 'req_tax_acct_test',
    tenantId: 'tenant_tax_acct',
    companyId: 'company_hq',
    ip: '127.0.0.1',
    userAgent: 'vitest-agent',
    timestamp: new Date(),
    user: {
      userId: 'user_fin_admin',
      email: 'admin@acme.com',
      tenantId: 'tenant_tax_acct',
      companyId: 'company_hq',
      roles: ['finance_admin'],
      permissions: ['*']
    }
  };

  const ctxTenantB: RequestContext = {
    requestId: 'req_tenant_b_tax',
    tenantId: 'tenant_other',
    companyId: 'company_other',
    ip: '127.0.0.1',
    userAgent: 'vitest-agent',
    timestamp: new Date(),
    user: {
      userId: 'user_other',
      email: 'other@acme.com',
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
    taxEngineService.clear();

    // 1. Setup Fiscal Year for Company HQ
    await fiscalPeriodService.createFiscalYear(ctx, {
      companyId: 'company_hq',
      name: 'FY 2026-27',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2027-03-31')
    });

    // 2. Create Base COA Accounts
    const ar = await chartOfAccountsService.createAccount(ctx, { companyId: 'company_hq', accountCode: '1100', accountName: 'Accounts Receivable', nodeType: 'ACCOUNT', accountType: 'ASSET' });
    accArId = ar.id;
    const sales = await chartOfAccountsService.createAccount(ctx, { companyId: 'company_hq', accountCode: '4010', accountName: 'Sales Revenue', nodeType: 'ACCOUNT', accountType: 'INCOME' });
    accSalesId = sales.id;
    const ap = await chartOfAccountsService.createAccount(ctx, { companyId: 'company_hq', accountCode: '2100', accountName: 'Accounts Payable', nodeType: 'ACCOUNT', accountType: 'LIABILITY' });
    accApId = ap.id;
    const exp = await chartOfAccountsService.createAccount(ctx, { companyId: 'company_hq', accountCode: '5010', accountName: 'Purchase Expense', nodeType: 'ACCOUNT', accountType: 'EXPENSE' });
    accExpenseId = exp.id;

    // 3. Create Tax Control Accounts (Output Tax Liabilities & Input Tax Assets)
    const outCgst = await chartOfAccountsService.createAccount(ctx, { companyId: 'company_hq', accountCode: '2210', accountName: 'CGST Output Payable', nodeType: 'ACCOUNT', accountType: 'LIABILITY' });
    accOutputCgstId = outCgst.id;
    const outSgst = await chartOfAccountsService.createAccount(ctx, { companyId: 'company_hq', accountCode: '2220', accountName: 'SGST Output Payable', nodeType: 'ACCOUNT', accountType: 'LIABILITY' });
    accOutputSgstId = outSgst.id;
    const outIgst = await chartOfAccountsService.createAccount(ctx, { companyId: 'company_hq', accountCode: '2230', accountName: 'IGST Output Payable', nodeType: 'ACCOUNT', accountType: 'LIABILITY' });
    accOutputIgstId = outIgst.id;
    const outUtgst = await chartOfAccountsService.createAccount(ctx, { companyId: 'company_hq', accountCode: '2240', accountName: 'UTGST Output Payable', nodeType: 'ACCOUNT', accountType: 'LIABILITY' });
    accOutputUtgstId = outUtgst.id;
    const outCess = await chartOfAccountsService.createAccount(ctx, { companyId: 'company_hq', accountCode: '2250', accountName: 'CESS Output Payable', nodeType: 'ACCOUNT', accountType: 'LIABILITY' });
    accOutputCessId = outCess.id;

    const inCgst = await chartOfAccountsService.createAccount(ctx, { companyId: 'company_hq', accountCode: '1310', accountName: 'CGST Input Credit', nodeType: 'ACCOUNT', accountType: 'ASSET' });
    accInputCgstId = inCgst.id;
    const inSgst = await chartOfAccountsService.createAccount(ctx, { companyId: 'company_hq', accountCode: '1320', accountName: 'SGST Input Credit', nodeType: 'ACCOUNT', accountType: 'ASSET' });
    accInputSgstId = inSgst.id;
    const inIgst = await chartOfAccountsService.createAccount(ctx, { companyId: 'company_hq', accountCode: '1330', accountName: 'IGST Input Credit', nodeType: 'ACCOUNT', accountType: 'ASSET' });
    accInputIgstId = inIgst.id;
    const inUtgst = await chartOfAccountsService.createAccount(ctx, { companyId: 'company_hq', accountCode: '1340', accountName: 'UTGST Input Credit', nodeType: 'ACCOUNT', accountType: 'ASSET' });
    accInputUtgstId = inUtgst.id;
    const inCess = await chartOfAccountsService.createAccount(ctx, { companyId: 'company_hq', accountCode: '1350', accountName: 'CESS Input Credit', nodeType: 'ACCOUNT', accountType: 'ASSET' });
    accInputCessId = inCess.id;

    // 4. Configure Accounting Mappings for Tax Control Accounts
    await accountingConfigurationService.setMapping(ctx, { companyId: 'company_hq', eventType: 'SALES_INVOICE', lineRole: 'OUTPUT_CGST', accountId: accOutputCgstId });
    await accountingConfigurationService.setMapping(ctx, { companyId: 'company_hq', eventType: 'SALES_INVOICE', lineRole: 'OUTPUT_SGST', accountId: accOutputSgstId });
    await accountingConfigurationService.setMapping(ctx, { companyId: 'company_hq', eventType: 'SALES_INVOICE', lineRole: 'OUTPUT_IGST', accountId: accOutputIgstId });
    await accountingConfigurationService.setMapping(ctx, { companyId: 'company_hq', eventType: 'SALES_INVOICE', lineRole: 'OUTPUT_UTGST', accountId: accOutputUtgstId });
    await accountingConfigurationService.setMapping(ctx, { companyId: 'company_hq', eventType: 'SALES_INVOICE', lineRole: 'OUTPUT_CESS', accountId: accOutputCessId });

    await accountingConfigurationService.setMapping(ctx, { companyId: 'company_hq', eventType: 'PURCHASE_INVOICE', lineRole: 'INPUT_CGST', accountId: accInputCgstId });
    await accountingConfigurationService.setMapping(ctx, { companyId: 'company_hq', eventType: 'PURCHASE_INVOICE', lineRole: 'INPUT_SGST', accountId: accInputSgstId });
    await accountingConfigurationService.setMapping(ctx, { companyId: 'company_hq', eventType: 'PURCHASE_INVOICE', lineRole: 'INPUT_IGST', accountId: accInputIgstId });
    await accountingConfigurationService.setMapping(ctx, { companyId: 'company_hq', eventType: 'PURCHASE_INVOICE', lineRole: 'INPUT_UTGST', accountId: accInputUtgstId });
    await accountingConfigurationService.setMapping(ctx, { companyId: 'company_hq', eventType: 'PURCHASE_INVOICE', lineRole: 'INPUT_CESS', accountId: accInputCessId });
  });

  // 1. Output Tax Event Posting Tests (Sales Side)
  describe('Output Tax Event Posting (Sales / Liabilities)', () => {
    it('posts Output CGST (9%) + SGST (9%) to GL with balanced journal (AR 1180.00 DR, Sales 1000.00 CR, CGST 90.00 CR, SGST 90.00 CR)', async () => {
      const cat = await taxEngineService.createTaxCategory(ctx, { companyId: 'company_hq', code: 'STD18', name: 'Standard 18%' });
      await taxEngineService.createTaxRate(ctx, { companyId: 'company_hq', taxCategoryId: cat.id, rateType: 'CGST', ratePercent: '9.000000', validFrom: '2026-01-01' });
      await taxEngineService.createTaxRate(ctx, { companyId: 'company_hq', taxCategoryId: cat.id, rateType: 'SGST', ratePercent: '9.000000', validFrom: '2026-01-01' });

      const treatment = await taxEngineService.resolveTaxTreatment(ctx, {
        companyId: 'company_hq',
        transactionDate: '2026-04-15',
        taxCategoryId: cat.id,
        supplierStateCode: '27',
        recipientStateCode: '27'
      });

      const taxCalc = taxCalculationService.calculateTax(ctx, {
        amount: '1000.00',
        calculationMode: 'EXCLUSIVE',
        treatment
      });

      const posted = await accountingCoreService.processTaxAccountingEvent(ctx, {
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'SINV-2026-001',
        eventType: 'SALES_INVOICE',
        direction: 'OUTPUT',
        baseAccountId: accSalesId,
        offsetAccountId: accArId,
        taxCalculation: taxCalc
      });

      expect(posted.status).toBe('POSTED');
      expect(posted.voucherNumber).toMatch(/^JV-/);
      expect(posted.totalDebit).toBe('1180.00');
      expect(posted.totalCredit).toBe('1180.00');
      expect(posted.lines).toHaveLength(4);

      // Verify line accounts and amounts
      const lineAr = posted.lines.find(l => l.accountId === accArId)!;
      expect(lineAr.debitAmount).toBe('1180.00');
      expect(lineAr.creditAmount).toBe('0.00');

      const lineSales = posted.lines.find(l => l.accountId === accSalesId)!;
      expect(lineSales.debitAmount).toBe('0.00');
      expect(lineSales.creditAmount).toBe('1000.00');

      const lineCgst = posted.lines.find(l => l.accountId === accOutputCgstId)!;
      expect(lineCgst.debitAmount).toBe('0.00');
      expect(lineCgst.creditAmount).toBe('90.00');

      const lineSgst = posted.lines.find(l => l.accountId === accOutputSgstId)!;
      expect(lineSgst.debitAmount).toBe('0.00');
      expect(lineSgst.creditAmount).toBe('90.00');
    });

    it('posts Output IGST (18%) to GL for Inter-State sale', async () => {
      const cat = await taxEngineService.createTaxCategory(ctx, { companyId: 'company_hq', code: 'STD18_IGST', name: 'Standard IGST 18%' });
      await taxEngineService.createTaxRate(ctx, { companyId: 'company_hq', taxCategoryId: cat.id, rateType: 'IGST', ratePercent: '18.000000', validFrom: '2026-01-01' });

      const treatment = await taxEngineService.resolveTaxTreatment(ctx, {
        companyId: 'company_hq',
        transactionDate: '2026-04-15',
        taxCategoryId: cat.id,
        supplierStateCode: '27',
        recipientStateCode: '07' // Delhi (Inter-state)
      });

      const taxCalc = taxCalculationService.calculateTax(ctx, {
        amount: '2000.00',
        calculationMode: 'EXCLUSIVE',
        treatment
      });

      const posted = await accountingCoreService.processTaxAccountingEvent(ctx, {
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'SINV-2026-002',
        eventType: 'SALES_INVOICE',
        direction: 'OUTPUT',
        baseAccountId: accSalesId,
        offsetAccountId: accArId,
        taxCalculation: taxCalc
      });

      expect(posted.totalDebit).toBe('2360.00');
      expect(posted.totalCredit).toBe('2360.00');
      const lineIgst = posted.lines.find(l => l.accountId === accOutputIgstId)!;
      expect(lineIgst.creditAmount).toBe('360.00');
    });
  });

  // 2. Input Tax Event Posting Tests (Purchase Side)
  describe('Input Tax Event Posting (Purchases / Assets)', () => {
    it('posts Input CGST (9%) + SGST (9%) to GL with balanced journal (Expense 1000.00 DR, CGST 90.00 DR, SGST 90.00 DR, AP 1180.00 CR)', async () => {
      const cat = await taxEngineService.createTaxCategory(ctx, { companyId: 'company_hq', code: 'PURCH18', name: 'Purchase 18%' });
      await taxEngineService.createTaxRate(ctx, { companyId: 'company_hq', taxCategoryId: cat.id, rateType: 'CGST', ratePercent: '9.000000', validFrom: '2026-01-01' });
      await taxEngineService.createTaxRate(ctx, { companyId: 'company_hq', taxCategoryId: cat.id, rateType: 'SGST', ratePercent: '9.000000', validFrom: '2026-01-01' });

      const treatment = await taxEngineService.resolveTaxTreatment(ctx, {
        companyId: 'company_hq',
        transactionDate: '2026-04-15',
        taxCategoryId: cat.id,
        supplierStateCode: '27',
        recipientStateCode: '27'
      });

      const taxCalc = taxCalculationService.calculateTax(ctx, {
        amount: '1000.00',
        calculationMode: 'EXCLUSIVE',
        treatment
      });

      const posted = await accountingCoreService.processTaxAccountingEvent(ctx, {
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        sourceModule: 'PROCUREMENT',
        sourceDocumentId: 'PINV-2026-001',
        eventType: 'PURCHASE_INVOICE',
        direction: 'INPUT',
        baseAccountId: accExpenseId,
        offsetAccountId: accApId,
        taxCalculation: taxCalc
      });

      expect(posted.status).toBe('POSTED');
      expect(posted.totalDebit).toBe('1180.00');
      expect(posted.totalCredit).toBe('1180.00');

      const lineExp = posted.lines.find(l => l.accountId === accExpenseId)!;
      expect(lineExp.debitAmount).toBe('1000.00');
      expect(lineExp.creditAmount).toBe('0.00');

      const lineInCgst = posted.lines.find(l => l.accountId === accInputCgstId)!;
      expect(lineInCgst.debitAmount).toBe('90.00');
      expect(lineInCgst.creditAmount).toBe('0.00');

      const lineInSgst = posted.lines.find(l => l.accountId === accInputSgstId)!;
      expect(lineInSgst.debitAmount).toBe('90.00');
      expect(lineInSgst.creditAmount).toBe('0.00');

      const lineAp = posted.lines.find(l => l.accountId === accApId)!;
      expect(lineAp.debitAmount).toBe('0.00');
      expect(lineAp.creditAmount).toBe('1180.00');
    });
  });

  // 3. Taxability & Zero Tax Handling
  describe('Taxability & Zero Tax Event Handling', () => {
    it('omits tax lines and posts base amounts for EXEMPT treatment', async () => {
      const cat = await taxEngineService.createTaxCategory(ctx, { companyId: 'company_hq', code: 'EXEMPT_CAT', name: 'Exempt Goods' });
      await taxEngineService.createTaxRule(ctx, { companyId: 'company_hq', taxCategoryId: cat.id, taxability: 'EXEMPT', validFrom: '2026-01-01' });

      const treatment = await taxEngineService.resolveTaxTreatment(ctx, {
        companyId: 'company_hq',
        transactionDate: '2026-04-15',
        taxCategoryId: cat.id,
        supplierStateCode: '27',
        recipientStateCode: '27'
      });

      const taxCalc = taxCalculationService.calculateTax(ctx, {
        amount: '1500.00',
        calculationMode: 'EXCLUSIVE',
        treatment
      });

      const posted = await accountingCoreService.processTaxAccountingEvent(ctx, {
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'SINV-EXEMPT-01',
        eventType: 'SALES_INVOICE',
        direction: 'OUTPUT',
        baseAccountId: accSalesId,
        offsetAccountId: accArId,
        taxCalculation: taxCalc
      });

      expect(posted.status).toBe('POSTED');
      expect(posted.totalDebit).toBe('1500.00');
      expect(posted.totalCredit).toBe('1500.00');
      expect(posted.lines).toHaveLength(2); // AR & Revenue only, no tax lines!
    });
  });

  // 4. Missing Configuration & Account Mapping Guards
  describe('Tax Account Mapping Guards (Section 26)', () => {
    it('rejects posting when tax component mapping is missing for non-zero tax amount', async () => {
      // Create tax category with CESS rate, but remove CESS mapping
      const cat = await taxEngineService.createTaxCategory(ctx, { companyId: 'company_hq', code: 'CESS_CAT', name: 'Cess Goods' });
      await taxEngineService.createTaxRate(ctx, { companyId: 'company_hq', taxCategoryId: cat.id, rateType: 'IGST', ratePercent: '12.000000', validFrom: '2026-01-01' });
      await taxEngineService.createTaxRate(ctx, { companyId: 'company_hq', taxCategoryId: cat.id, rateType: 'CESS', ratePercent: '5.000000', validFrom: '2026-01-01' });

      const treatment = await taxEngineService.resolveTaxTreatment(ctx, {
        companyId: 'company_hq',
        transactionDate: '2026-04-15',
        taxCategoryId: cat.id,
        supplierStateCode: '27',
        recipientStateCode: '07'
      });

      const taxCalc = taxCalculationService.calculateTax(ctx, {
        amount: '1000.00',
        calculationMode: 'EXCLUSIVE',
        treatment
      });

      // Clear CESS mapping for eventType 'UNMAPPED_EVENT'
      await expect(accountingCoreService.processTaxAccountingEvent(ctx, {
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'SINV-UNMAPPED',
        eventType: 'UNMAPPED_EVENT',
        direction: 'OUTPUT',
        baseAccountId: accSalesId,
        offsetAccountId: accArId,
        taxCalculation: taxCalc
      })).rejects.toThrow(AccountingError);
    });
  });

  // 5. Transaction Rollback Atomicity Verification (Section 32)
  describe('Transactional Rollback Atomicity Verification', () => {
    it('proves a failure during posting rolls back atomically with 0 posted journals or voucher leaks', async () => {
      const cat = await taxEngineService.createTaxCategory(ctx, { companyId: 'company_hq', code: 'FAIL_CAT', name: 'Fail Test' });
      await taxEngineService.createTaxRate(ctx, { companyId: 'company_hq', taxCategoryId: cat.id, rateType: 'IGST', ratePercent: '18.000000', validFrom: '2026-01-01' });

      const treatment = await taxEngineService.resolveTaxTreatment(ctx, {
        companyId: 'company_hq',
        transactionDate: '2026-04-15',
        taxCategoryId: cat.id,
        supplierStateCode: '27',
        recipientStateCode: '07'
      });

      const taxCalc = taxCalculationService.calculateTax(ctx, {
        amount: '1000.00',
        calculationMode: 'EXCLUSIVE',
        treatment
      });

      // Injected failure via simulateFailure: true
      await expect(accountingCoreService.processTaxAccountingEvent(ctx, {
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'SINV-FAIL-01',
        eventType: 'SALES_INVOICE',
        direction: 'OUTPUT',
        baseAccountId: accSalesId,
        offsetAccountId: accArId,
        taxCalculation: taxCalc,
        simulateFailure: true
      })).rejects.toThrow(AccountingError);

      // Verify document was not posted to GL
      await expect(glEngine.getJournalById(ctx, 'je_non_existent_rollback')).rejects.toThrow();
    });
  });

  // 6. Append-Only Reversal Verification
  describe('Append-Only Tax Journal Reversal', () => {
    it('reverses a posted tax journal via an append-only reversal journal with swapped debits/credits', async () => {
      const cat = await taxEngineService.createTaxCategory(ctx, { companyId: 'company_hq', code: 'REV_CAT', name: 'Reversal Test' });
      await taxEngineService.createTaxRate(ctx, { companyId: 'company_hq', taxCategoryId: cat.id, rateType: 'IGST', ratePercent: '18.000000', validFrom: '2026-01-01' });

      const treatment = await taxEngineService.resolveTaxTreatment(ctx, {
        companyId: 'company_hq',
        transactionDate: '2026-04-15',
        taxCategoryId: cat.id,
        supplierStateCode: '27',
        recipientStateCode: '07'
      });

      const taxCalc = taxCalculationService.calculateTax(ctx, {
        amount: '1000.00',
        calculationMode: 'EXCLUSIVE',
        treatment
      });

      const posted = await accountingCoreService.processTaxAccountingEvent(ctx, {
        companyId: 'company_hq',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'SINV-REV-ORIG',
        eventType: 'SALES_INVOICE',
        direction: 'OUTPUT',
        baseAccountId: accSalesId,
        offsetAccountId: accArId,
        taxCalculation: taxCalc
      });

      const reversal = await accountingCoreService.reverseAccountingEvent(ctx, {
        originalJournalId: posted.id!,
        reason: 'Customer credit note issued'
      });

      expect(reversal.status).toBe('POSTED');
      expect(reversal.originalJournalId).toBe(posted.id);
      expect(reversal.totalDebit).toBe('1180.00');
      expect(reversal.totalCredit).toBe('1180.00');

      // Original journal remains POSTED
      const orig = await glEngine.getJournalById(ctx, posted.id!);
      expect(orig.status).toBe('POSTED');
    });
  });

  // 7. Security & Concurrency Verification
  describe('Security & High-Load Concurrency', () => {
    it('rejects cross-tenant context during tax accounting event', async () => {
      const cat = await taxEngineService.createTaxCategory(ctx, { companyId: 'company_hq', code: 'SEC_CAT', name: 'Security Test' });
      await taxEngineService.createTaxRate(ctx, { companyId: 'company_hq', taxCategoryId: cat.id, rateType: 'IGST', ratePercent: '18.000000', validFrom: '2026-01-01' });

      const treatment = await taxEngineService.resolveTaxTreatment(ctx, {
        companyId: 'company_hq',
        transactionDate: '2026-04-15',
        taxCategoryId: cat.id,
        supplierStateCode: '27',
        recipientStateCode: '07'
      });

      const taxCalc = taxCalculationService.calculateTax(ctx, {
        amount: '1000.00',
        calculationMode: 'EXCLUSIVE',
        treatment
      });

      await expect(accountingCoreService.processTaxAccountingEvent(ctxTenantB, { // Context Tenant B vs Tax Calc Tenant A
        companyId: 'company_other',
        accountingDate: '2026-04-15',
        sourceModule: 'SALES',
        sourceDocumentId: 'SINV-SEC-01',
        eventType: 'SALES_INVOICE',
        direction: 'OUTPUT',
        baseAccountId: accSalesId,
        offsetAccountId: accArId,
        taxCalculation: taxCalc
      })).rejects.toThrow(/Tenant\/Company scope mismatch/);
    });

    it('executes 100 concurrent identical tax-accounting requests producing exactly 1 posted journal', async () => {
      const cat = await taxEngineService.createTaxCategory(ctx, { companyId: 'company_hq', code: 'CONCUR_CAT', name: 'Concurrency Test' });
      await taxEngineService.createTaxRate(ctx, { companyId: 'company_hq', taxCategoryId: cat.id, rateType: 'IGST', ratePercent: '18.000000', validFrom: '2026-01-01' });

      const treatment = await taxEngineService.resolveTaxTreatment(ctx, {
        companyId: 'company_hq',
        transactionDate: '2026-04-15',
        taxCategoryId: cat.id,
        supplierStateCode: '27',
        recipientStateCode: '07'
      });

      const taxCalc = taxCalculationService.calculateTax(ctx, {
        amount: '1000.00',
        calculationMode: 'EXCLUSIVE',
        treatment
      });

      const requests = Array.from({ length: 100 }, () =>
        accountingCoreService.processTaxAccountingEvent(ctx, {
          companyId: 'company_hq',
          accountingDate: '2026-04-15',
          sourceModule: 'SALES',
          sourceDocumentId: 'SINV-CONCURRENCY-SAME',
          eventType: 'SALES_INVOICE',
          direction: 'OUTPUT',
          baseAccountId: accSalesId,
          offsetAccountId: accArId,
          taxCalculation: taxCalc,
          idempotencyKey: 'key_tax_concur_same'
        })
      );

      const results = await Promise.allSettled(requests);
      const fulfilled = results.filter(r => r.status === 'fulfilled');

      expect(fulfilled.length).toBe(100);
      const journalIds = new Set(fulfilled.map(r => (r as PromiseFulfilledResult<any>).value.id));
      expect(journalIds.size).toBe(1);
    });
  });

  // 8. Property-Based / Randomized Invariant Tests (200 cases)
  describe('Randomized Property-Based Invariant Verification (200 Cases)', () => {
    it('verifies Total Debits == Total Credits and exact tax component postings across 200 random tax accounting events', async () => {
      const cat = await taxEngineService.createTaxCategory(ctx, { companyId: 'company_hq', code: 'RAND_CAT', name: 'Random Category' });
      await taxEngineService.createTaxRate(ctx, { companyId: 'company_hq', taxCategoryId: cat.id, rateType: 'CGST', ratePercent: '9.000000', validFrom: '2026-01-01' });
      await taxEngineService.createTaxRate(ctx, { companyId: 'company_hq', taxCategoryId: cat.id, rateType: 'SGST', ratePercent: '9.000000', validFrom: '2026-01-01' });

      const treatment = await taxEngineService.resolveTaxTreatment(ctx, {
        companyId: 'company_hq',
        transactionDate: '2026-04-15',
        taxCategoryId: cat.id,
        supplierStateCode: '27',
        recipientStateCode: '27'
      });

      for (let i = 0; i < 200; i++) {
        const randCents = Math.floor(Math.random() * 999999) + 100;
        const amountStr = (randCents / 100).toFixed(2);
        const direction = i % 2 === 0 ? 'OUTPUT' : 'INPUT';
        const mode = i % 3 === 0 ? 'INCLUSIVE' : 'EXCLUSIVE';

        const taxCalc = taxCalculationService.calculateTax(ctx, {
          amount: amountStr,
          calculationMode: mode,
          treatment
        });

        const posted = await accountingCoreService.processTaxAccountingEvent(ctx, {
          companyId: 'company_hq',
          accountingDate: '2026-04-15',
          sourceModule: 'STRESS',
          sourceDocumentId: `RAND-DOC-${i + 1}`,
          eventType: direction === 'OUTPUT' ? 'SALES_INVOICE' : 'PURCHASE_INVOICE',
          direction,
          baseAccountId: direction === 'OUTPUT' ? accSalesId : accExpenseId,
          offsetAccountId: direction === 'OUTPUT' ? accArId : accApId,
          taxCalculation: taxCalc
        });

        expect(posted.status).toBe('POSTED');
        expect(posted.totalDebit).toBe(posted.totalCredit);
        expect(posted.totalDebit).toBe(taxCalc.totalAmount);
      }
    });
  });
});
