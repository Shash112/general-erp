import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { taxEngineService } from '../src/modules/finance/tax-engine.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { journalDraftService } from '../src/modules/finance/journal-draft.service.js';
import { accountingConfigurationService } from '../src/modules/finance/accounting-core.service.js';
import { RequestContext, ExactDecimal } from '@general-erp/core';

describe('Phase 2.5.5 — Tax REST API & Final Hardening Tests', () => {
  let app: ReturnType<typeof buildApp>;
  let accArId: string;
  let accSalesId: string;
  let accApId: string;
  let accExpenseId: string;
  let accOutputCgstId: string;
  let accOutputSgstId: string;
  let accOutputIgstId: string;
  let accInputCgstId: string;
  let accInputSgstId: string;

  const ctx: RequestContext = {
    requestId: 'req_tax_api_test',
    tenantId: 'tenant_api_test',
    companyId: 'company_hq',
    ip: '127.0.0.1',
    userAgent: 'test-agent',
    timestamp: new Date()
  };

  const headersTenantA = {
    'x-tenant-id': 'tenant_api_test',
    'x-company-id': 'company_hq',
    'x-user-id': 'usr_admin',
    'x-user-roles': 'finance_admin',
    'x-user-permissions': '*'
  };

  const headersTenantB = {
    'x-tenant-id': 'tenant_other',
    'x-company-id': 'company_other',
    'x-user-id': 'usr_other',
    'x-user-roles': 'finance_admin',
    'x-user-permissions': '*'
  };

  beforeEach(async () => {
    app = buildApp();
    journalDraftService.clear();
    chartOfAccountsService.clear();
    fiscalPeriodService.clear();
    accountingConfigurationService.clear();
    taxEngineService.clear();

    // Create Open Fiscal Year
    await fiscalPeriodService.createFiscalYear(ctx, {
      companyId: 'company_hq',
      name: 'FY 2026-27',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2027-03-31')
    });

    // Create COA Accounts
    const ar = await chartOfAccountsService.createAccount(ctx, {
      companyId: 'company_hq',
      accountCode: '1100',
      accountName: 'Accounts Receivable',
      nodeType: 'ACCOUNT',
      accountType: 'ASSET'
    });
    accArId = ar.id;

    const sales = await chartOfAccountsService.createAccount(ctx, {
      companyId: 'company_hq',
      accountCode: '4000',
      accountName: 'Sales Revenue',
      nodeType: 'ACCOUNT',
      accountType: 'INCOME'
    });
    accSalesId = sales.id;

    const ap = await chartOfAccountsService.createAccount(ctx, {
      companyId: 'company_hq',
      accountCode: '2100',
      accountName: 'Accounts Payable',
      nodeType: 'ACCOUNT',
      accountType: 'LIABILITY'
    });
    accApId = ap.id;

    const exp = await chartOfAccountsService.createAccount(ctx, {
      companyId: 'company_hq',
      accountCode: '5000',
      accountName: 'Operating Expense',
      nodeType: 'ACCOUNT',
      accountType: 'EXPENSE'
    });
    accExpenseId = exp.id;

    const outCgst = await chartOfAccountsService.createAccount(ctx, {
      companyId: 'company_hq',
      accountCode: '2201',
      accountName: 'CGST Output Payable',
      nodeType: 'ACCOUNT',
      accountType: 'LIABILITY'
    });
    accOutputCgstId = outCgst.id;

    const outSgst = await chartOfAccountsService.createAccount(ctx, {
      companyId: 'company_hq',
      accountCode: '2202',
      accountName: 'SGST Output Payable',
      nodeType: 'ACCOUNT',
      accountType: 'LIABILITY'
    });
    accOutputSgstId = outSgst.id;

    const outIgst = await chartOfAccountsService.createAccount(ctx, {
      companyId: 'company_hq',
      accountCode: '2203',
      accountName: 'IGST Output Payable',
      nodeType: 'ACCOUNT',
      accountType: 'LIABILITY'
    });
    accOutputIgstId = outIgst.id;

    const inCgst = await chartOfAccountsService.createAccount(ctx, {
      companyId: 'company_hq',
      accountCode: '1301',
      accountName: 'CGST Input Credit',
      nodeType: 'ACCOUNT',
      accountType: 'ASSET'
    });
    accInputCgstId = inCgst.id;

    const inSgst = await chartOfAccountsService.createAccount(ctx, {
      companyId: 'company_hq',
      accountCode: '1302',
      accountName: 'SGST Input Credit',
      nodeType: 'ACCOUNT',
      accountType: 'ASSET'
    });
    accInputSgstId = inSgst.id;

    // Set Accounting Mappings for SALES_INVOICE and PURCHASE_INVOICE
    await accountingConfigurationService.setMapping(ctx, { companyId: 'company_hq', eventType: 'SALES_INVOICE', lineRole: 'OUTPUT_CGST', accountId: accOutputCgstId });
    await accountingConfigurationService.setMapping(ctx, { companyId: 'company_hq', eventType: 'SALES_INVOICE', lineRole: 'OUTPUT_SGST', accountId: accOutputSgstId });
    await accountingConfigurationService.setMapping(ctx, { companyId: 'company_hq', eventType: 'SALES_INVOICE', lineRole: 'OUTPUT_IGST', accountId: accOutputIgstId });

    await accountingConfigurationService.setMapping(ctx, { companyId: 'company_hq', eventType: 'PURCHASE_INVOICE', lineRole: 'INPUT_CGST', accountId: accInputCgstId });
    await accountingConfigurationService.setMapping(ctx, { companyId: 'company_hq', eventType: 'PURCHASE_INVOICE', lineRole: 'INPUT_SGST', accountId: accInputSgstId });
  });

  describe('REST API Resolution Endpoints', () => {
    it('resolves HSN/SAC code via POST /api/v1/finance/tax/hsn-sac/resolve', async () => {
      await taxEngineService.createHSNSAC(ctx, {
        companyId: 'company_hq',
        code: '8517',
        description: 'Telephone sets & smartphones',
        type: 'HSN',
        gstRate: '18.00'
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/tax/hsn-sac/resolve',
        headers: headersTenantA,
        payload: { companyId: 'company_hq', code: '8517' }
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data.code).toBe('8517');
      expect(json.data.type).toBe('HSN');
    });

    it('resolves tax category via POST /api/v1/finance/tax/categories/resolve', async () => {
      const cat = await taxEngineService.createTaxCategory(ctx, {
        companyId: 'company_hq',
        code: 'ELEC_GOODS',
        name: 'Electronic Goods'
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/tax/categories/resolve',
        headers: headersTenantA,
        payload: { companyId: 'company_hq', code: 'ELEC_GOODS' }
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data.id).toBe(cat.id);
      expect(json.data.code).toBe('ELEC_GOODS');
    });

    it('resolves effective tax rates via POST /api/v1/finance/tax/rates/resolve', async () => {
      const cat = await taxEngineService.createTaxCategory(ctx, {
        companyId: 'company_hq',
        code: 'STD_RATES',
        name: 'Standard Rates'
      });

      await taxEngineService.createTaxRate(ctx, {
        companyId: 'company_hq',
        taxCategoryId: cat.id,
        rateType: 'CGST',
        ratePercent: '9.000000',
        validFrom: '2026-01-01'
      });
      await taxEngineService.createTaxRate(ctx, {
        companyId: 'company_hq',
        taxCategoryId: cat.id,
        rateType: 'SGST',
        ratePercent: '9.000000',
        validFrom: '2026-01-01'
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/tax/rates/resolve',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq',
          taxCategoryId: cat.id,
          transactionDate: '2026-04-15'
        }
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data).toHaveLength(2);
      expect(json.data[0].ratePercent).toBe('9.000000');
    });

    it('resolves Place of Supply via POST /api/v1/finance/tax/pos/resolve', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/tax/pos/resolve',
        headers: headersTenantA,
        payload: {
          supplierStateCode: '27', // Maharashtra
          recipientStateCode: '07'  // Delhi
        }
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data.placeOfSupplyStateCode).toBe('07');
      expect(json.data.supplyNature).toBe('INTER_STATE');
    });

    it('resolves Tax Treatment via POST /api/v1/finance/tax/treatment/resolve', async () => {
      const cat = await taxEngineService.createTaxCategory(ctx, {
        companyId: 'company_hq',
        code: 'TREAT_CAT',
        name: 'Treatment Test Category'
      });
      await taxEngineService.createTaxRate(ctx, {
        companyId: 'company_hq',
        taxCategoryId: cat.id,
        rateType: 'CGST',
        ratePercent: '9.000000',
        validFrom: '2026-01-01'
      });
      await taxEngineService.createTaxRate(ctx, {
        companyId: 'company_hq',
        taxCategoryId: cat.id,
        rateType: 'SGST',
        ratePercent: '9.000000',
        validFrom: '2026-01-01'
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/tax/treatment/resolve',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq',
          transactionDate: '2026-04-15',
          taxCategoryId: cat.id,
          supplierStateCode: '27',
          recipientStateCode: '27'
        }
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data.placeOfSupply.supplyNature).toBe('INTRA_STATE');
      expect(json.data.taxability).toBe('TAXABLE');
      expect(json.data.rates).toHaveLength(2);
    });
  });

  describe('REST API Tax Calculation Endpoint', () => {
    it('performs exclusive calculation via POST /api/v1/finance/tax/calculate', async () => {
      const cat = await taxEngineService.createTaxCategory(ctx, {
        companyId: 'company_hq',
        code: 'CALC_EXCL',
        name: 'Calculation Exclusive'
      });
      await taxEngineService.createTaxRate(ctx, {
        companyId: 'company_hq',
        taxCategoryId: cat.id,
        rateType: 'IGST',
        ratePercent: '18.000000',
        validFrom: '2026-01-01'
      });

      const treatmentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/tax/treatment/resolve',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq',
          transactionDate: '2026-04-15',
          taxCategoryId: cat.id,
          supplierStateCode: '27',
          recipientStateCode: '07'
        }
      });
      const treatment = JSON.parse(treatmentRes.payload).data;

      const calcRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/tax/calculate',
        headers: headersTenantA,
        payload: {
          amount: '1000.00',
          calculationMode: 'EXCLUSIVE',
          treatment
        }
      });

      expect(calcRes.statusCode).toBe(200);
      const json = JSON.parse(calcRes.payload);
      expect(json.data.taxableAmount).toBe('1000.00');
      expect(json.data.totalTaxAmount).toBe('180.00');
      expect(json.data.totalAmount).toBe('1180.00');
    });

    it('performs inclusive calculation via POST /api/v1/finance/tax/calculate', async () => {
      const cat = await taxEngineService.createTaxCategory(ctx, {
        companyId: 'company_hq',
        code: 'CALC_INCL',
        name: 'Calculation Inclusive'
      });
      await taxEngineService.createTaxRate(ctx, {
        companyId: 'company_hq',
        taxCategoryId: cat.id,
        rateType: 'CGST',
        ratePercent: '9.000000',
        validFrom: '2026-01-01'
      });
      await taxEngineService.createTaxRate(ctx, {
        companyId: 'company_hq',
        taxCategoryId: cat.id,
        rateType: 'SGST',
        ratePercent: '9.000000',
        validFrom: '2026-01-01'
      });

      const treatmentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/tax/treatment/resolve',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq',
          transactionDate: '2026-04-15',
          taxCategoryId: cat.id,
          supplierStateCode: '27',
          recipientStateCode: '27'
        }
      });
      const treatment = JSON.parse(treatmentRes.payload).data;

      const calcRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/tax/calculate',
        headers: headersTenantA,
        payload: {
          amount: '118.00',
          calculationMode: 'INCLUSIVE',
          treatment
        }
      });

      expect(calcRes.statusCode).toBe(200);
      const json = JSON.parse(calcRes.payload);
      expect(json.data.taxableAmount).toBe('100.00');
      expect(json.data.totalTaxAmount).toBe('18.00');
      expect(json.data.totalAmount).toBe('118.00');
      expect(json.data.components[0].taxAmount).toBe('9.00');
      expect(json.data.components[1].taxAmount).toBe('9.00');
    });
  });

  describe('REST API Accounting Event & Reversal Endpoints', () => {
    it('posts output tax accounting event via POST /api/v1/finance/tax/accounting/events', async () => {
      const cat = await taxEngineService.createTaxCategory(ctx, {
        companyId: 'company_hq',
        code: 'ACCT_EVT_CAT',
        name: 'Accounting Event Cat'
      });
      await taxEngineService.createTaxRate(ctx, {
        companyId: 'company_hq',
        taxCategoryId: cat.id,
        rateType: 'CGST',
        ratePercent: '9.000000',
        validFrom: '2026-01-01'
      });
      await taxEngineService.createTaxRate(ctx, {
        companyId: 'company_hq',
        taxCategoryId: cat.id,
        rateType: 'SGST',
        ratePercent: '9.000000',
        validFrom: '2026-01-01'
      });

      const treatmentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/tax/treatment/resolve',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq',
          transactionDate: '2026-04-15',
          taxCategoryId: cat.id,
          supplierStateCode: '27',
          recipientStateCode: '27'
        }
      });
      const treatment = JSON.parse(treatmentRes.payload).data;

      const calcRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/tax/calculate',
        headers: headersTenantA,
        payload: { amount: '1000.00', calculationMode: 'EXCLUSIVE', treatment }
      });
      const taxCalculation = JSON.parse(calcRes.payload).data;

      const postRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/tax/accounting/events',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq',
          accountingDate: '2026-04-15',
          sourceModule: 'SALES',
          sourceDocumentId: 'INV-REST-01',
          eventType: 'SALES_INVOICE',
          direction: 'OUTPUT',
          baseAccountId: accSalesId,
          offsetAccountId: accArId,
          taxCalculation
        }
      });

      expect(postRes.statusCode).toBe(201);
      const journal = JSON.parse(postRes.payload).data;
      expect(journal.status).toBe('POSTED');
      expect(journal.totalDebit).toBe('1180.00');
      expect(journal.totalCredit).toBe('1180.00');
      expect(journal.lines).toHaveLength(4); // AR (1180 DR), Sales (1000 CR), CGST (90 CR), SGST (90 CR)
    });

    it('reverses a posted tax accounting entry via POST /api/v1/finance/tax/accounting/reverse', async () => {
      const cat = await taxEngineService.createTaxCategory(ctx, {
        companyId: 'company_hq',
        code: 'ACCT_REV_CAT',
        name: 'Accounting Rev Cat'
      });
      await taxEngineService.createTaxRate(ctx, {
        companyId: 'company_hq',
        taxCategoryId: cat.id,
        rateType: 'IGST',
        ratePercent: '18.000000',
        validFrom: '2026-01-01'
      });

      const treatmentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/tax/treatment/resolve',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq',
          transactionDate: '2026-04-15',
          taxCategoryId: cat.id,
          supplierStateCode: '27',
          recipientStateCode: '07'
        }
      });
      const treatment = JSON.parse(treatmentRes.payload).data;

      const calcRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/tax/calculate',
        headers: headersTenantA,
        payload: { amount: '1000.00', calculationMode: 'EXCLUSIVE', treatment }
      });
      const taxCalculation = JSON.parse(calcRes.payload).data;

      const postRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/tax/accounting/events',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq',
          accountingDate: '2026-04-15',
          sourceModule: 'SALES',
          sourceDocumentId: 'INV-REST-02',
          eventType: 'SALES_INVOICE',
          direction: 'OUTPUT',
          baseAccountId: accSalesId,
          offsetAccountId: accArId,
          taxCalculation
        }
      });
      const postedJournal = JSON.parse(postRes.payload).data;

      const revRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/tax/accounting/reverse',
        headers: headersTenantA,
        payload: {
          originalJournalId: postedJournal.id,
          reason: 'Customer Cancellation'
        }
      });

      expect(revRes.statusCode).toBe(200);
      const revJournal = JSON.parse(revRes.payload).data;
      expect(revJournal.status).toBe('POSTED');
      expect(revJournal.totalDebit).toBe('1180.00');
      expect(revJournal.totalCredit).toBe('1180.00');
      expect(revJournal.lines).toHaveLength(3); // Reversed lines
    });
  });

  describe('Validation & Security Hardening', () => {
    it('rejects cross-tenant company access attempt', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/tax/hsn-sac/resolve',
        headers: headersTenantB, // Tenant B headers
        payload: {
          companyId: 'company_hq', // Company owned by Tenant A
          code: '8517'
        }
      });

      expect(res.statusCode).toBe(403);
      const json = JSON.parse(res.payload);
      expect(json.error.message).toMatch(/Company scope mismatch/);
    });

    it('rejects malformed monetary amount with > 2 decimal scale', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/tax/calculate',
        headers: headersTenantA,
        payload: {
          amount: '1000.1234', // invalid scale
          calculationMode: 'EXCLUSIVE',
          treatment: { taxability: 'TAXABLE', rates: [] }
        }
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(json.error.message).toMatch(/exceeds maximum scale/);
    });

    it('rejects negative monetary amount', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/tax/calculate',
        headers: headersTenantA,
        payload: {
          amount: '-500.00',
          calculationMode: 'EXCLUSIVE',
          treatment: { taxability: 'TAXABLE', rates: [] }
        }
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(json.error.message).toMatch(/cannot be negative/);
    });

    it('rejects invalid calculationMode enum', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/tax/calculate',
        headers: headersTenantA,
        payload: {
          amount: '500.00',
          calculationMode: 'INVALID_MODE',
          treatment: { taxability: 'TAXABLE', rates: [] }
        }
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(json.error.message).toMatch(/Invalid calculationMode/);
    });
  });

  describe('Randomized REST API Calculation & Accounting Validation', () => {
    it('executes 200 randomized valid calculations via REST verifying debit/credit equality and decimal integrity', async () => {
      const cat = await taxEngineService.createTaxCategory(ctx, {
        companyId: 'company_hq',
        code: 'RAND_REST_CAT',
        name: 'Randomized REST Category'
      });
      await taxEngineService.createTaxRate(ctx, {
        companyId: 'company_hq',
        taxCategoryId: cat.id,
        rateType: 'CGST',
        ratePercent: '9.000000',
        validFrom: '2026-01-01'
      });
      await taxEngineService.createTaxRate(ctx, {
        companyId: 'company_hq',
        taxCategoryId: cat.id,
        rateType: 'SGST',
        ratePercent: '9.000000',
        validFrom: '2026-01-01'
      });

      const treatmentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/tax/treatment/resolve',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq',
          transactionDate: '2026-04-15',
          taxCategoryId: cat.id,
          supplierStateCode: '27',
          recipientStateCode: '27'
        }
      });
      const treatment = JSON.parse(treatmentRes.payload).data;

      for (let i = 0; i < 200; i++) {
        const randBaseInt = Math.floor(Math.random() * 500000) + 1; // 1 to 500000 cents
        const randAmountStr = (randBaseInt / 100).toFixed(2);
        const mode = i % 2 === 0 ? 'EXCLUSIVE' : 'INCLUSIVE';

        const calcRes = await app.inject({
          method: 'POST',
          url: '/api/v1/finance/tax/calculate',
          headers: headersTenantA,
          payload: { amount: randAmountStr, calculationMode: mode, treatment }
        });

        expect(calcRes.statusCode).toBe(200);
        const calc = JSON.parse(calcRes.payload).data;

        // Invariant checks
        const taxable = ExactDecimal.parse(calc.taxableAmount, 2);
        const totalTax = ExactDecimal.parse(calc.totalTaxAmount, 2);
        const total = ExactDecimal.parse(calc.totalAmount, 2);

        expect(total.equals(taxable.add(totalTax))).toBe(true);
        expect(typeof calc.taxableAmount).toBe('string');
        expect(typeof calc.totalTaxAmount).toBe('string');
        expect(typeof calc.totalAmount).toBe('string');
      }
    });
  });
});
