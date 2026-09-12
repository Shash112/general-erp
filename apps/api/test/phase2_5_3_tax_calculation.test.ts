import { describe, it, expect, beforeEach } from 'vitest';
import { TaxCalculationService } from '../src/modules/finance/tax-calculation.service.js';
import { TaxEngineService, TaxTreatmentResolutionResult } from '../src/modules/finance/tax-engine.service.js';
import { ExactDecimal, RequestContext, ValidationError, ForbiddenError, BusinessRuleViolationError } from '@general-erp/core';

describe('Phase 2.5.3 — Tax Calculation Engine Tests', () => {
  let taxEngine: TaxEngineService;
  let taxCalc: TaxCalculationService;

  const ctxTenantACompanyA: RequestContext = {
    requestId: 'req_calc_001',
    tenantId: 'tenant_A',
    companyId: 'company_A',
    ip: '127.0.0.1',
    userAgent: 'test-agent',
    timestamp: new Date()
  };

  const ctxTenantACompanyB: RequestContext = {
    requestId: 'req_calc_002',
    tenantId: 'tenant_A',
    companyId: 'company_B',
    ip: '127.0.0.1',
    userAgent: 'test-agent',
    timestamp: new Date()
  };

  beforeEach(() => {
    taxEngine = new TaxEngineService();
    taxEngine.clear();
    taxCalc = new TaxCalculationService();
  });

  // Helper helper to quickly mock or create a resolved treatment
  async function createMockTreatment(
    taxability: 'TAXABLE' | 'EXEMPT' | 'NIL_RATED' | 'NON_GST' = 'TAXABLE',
    ratesInput: Array<{ rateType: 'CGST' | 'SGST' | 'IGST' | 'UTGST' | 'CESS'; ratePercent: string }> = [],
    supplyNature: 'INTRA_STATE' | 'INTER_STATE' = 'INTRA_STATE',
    isUtgstApplicable: boolean = false
  ): Promise<TaxTreatmentResolutionResult> {
    const cat = await taxEngine.createTaxCategory(ctxTenantACompanyA, {
      companyId: 'company_A',
      code: `CAT_${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      name: 'Test Category'
    });

    for (const r of ratesInput) {
      await taxEngine.createTaxRate(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: cat.id,
        rateType: r.rateType,
        ratePercent: r.ratePercent,
        validFrom: '2026-01-01'
      });
    }

    if (taxability !== 'TAXABLE') {
      await taxEngine.createTaxRule(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: cat.id,
        taxability,
        validFrom: '2026-01-01'
      });
    }

    return taxEngine.resolveTaxTreatment(ctxTenantACompanyA, {
      companyId: 'company_A',
      transactionDate: '2026-06-15',
      taxCategoryId: cat.id,
      supplierStateCode: '27',
      recipientStateCode: supplyNature === 'INTRA_STATE' ? (isUtgstApplicable ? '04' : '27') : '07'
    });
  }

  // 1. Exact Decimal Half-Even Rounding Tests
  describe('Exact Decimal Half-Even (Banker\'s) Rounding', () => {
    it('rounds 1.005 -> 1.00 (Even 0 stays 0)', () => {
      const res = ExactDecimal.halfEvenRound(1005n, 3, 2);
      expect(res.toString()).toBe('1.00');
    });

    it('rounds 1.015 -> 1.02 (Odd 1 rounds up to 2)', () => {
      const res = ExactDecimal.halfEvenRound(1015n, 3, 2);
      expect(res.toString()).toBe('1.02');
    });

    it('rounds 2.005 -> 2.00 (Even 0 stays 0)', () => {
      const res = ExactDecimal.halfEvenRound(2005n, 3, 2);
      expect(res.toString()).toBe('2.00');
    });

    it('rounds 2.015 -> 2.02 (Odd 1 rounds up to 2)', () => {
      const res = ExactDecimal.halfEvenRound(2015n, 3, 2);
      expect(res.toString()).toBe('2.02');
    });

    it('rounds values strictly above half (1.0051 -> 1.01)', () => {
      const res = ExactDecimal.halfEvenRound(10051n, 4, 2);
      expect(res.toString()).toBe('1.01');
    });

    it('rounds values strictly below half (1.0049 -> 1.00)', () => {
      const res = ExactDecimal.halfEvenRound(10049n, 4, 2);
      expect(res.toString()).toBe('1.00');
    });

    it('correctly handles zero and negative numbers', () => {
      expect(ExactDecimal.halfEvenRound(0n, 3, 2).toString()).toBe('0.00');
      expect(ExactDecimal.halfEvenRound(-1015n, 3, 2).toString()).toBe('-1.02');
      expect(ExactDecimal.halfEvenRound(-1005n, 3, 2).toString()).toBe('-1.00');
    });
  });

  // 2. Exclusive Tax Calculations
  describe('Exclusive Tax Calculation Pipeline', () => {
    it('calculates Exclusive CGST (9%) + SGST (9%) on 1000.00', async () => {
      const treatment = await createMockTreatment('TAXABLE', [
        { rateType: 'CGST', ratePercent: '9.000000' },
        { rateType: 'SGST', ratePercent: '9.000000' },
        { rateType: 'IGST', ratePercent: '18.000000' }
      ], 'INTRA_STATE');

      const result = taxCalc.calculateTax(ctxTenantACompanyA, {
        amount: '1000.00',
        calculationMode: 'EXCLUSIVE',
        treatment
      });

      expect(result.taxableAmount).toBe('1000.00');
      expect(result.totalTaxAmount).toBe('180.00');
      expect(result.totalAmount).toBe('1180.00');
      expect(result.components).toEqual([
        { rateType: 'CGST', ratePercent: '9.000000', taxAmount: '90.00' },
        { rateType: 'SGST', ratePercent: '9.000000', taxAmount: '90.00' }
      ]);
    });

    it('calculates Exclusive IGST (18%) on 1000.00 for Inter-State supply', async () => {
      const treatment = await createMockTreatment('TAXABLE', [
        { rateType: 'CGST', ratePercent: '9.000000' },
        { rateType: 'SGST', ratePercent: '9.000000' },
        { rateType: 'IGST', ratePercent: '18.000000' }
      ], 'INTER_STATE');

      const result = taxCalc.calculateTax(ctxTenantACompanyA, {
        amount: '1000.00',
        calculationMode: 'EXCLUSIVE',
        treatment
      });

      expect(result.taxableAmount).toBe('1000.00');
      expect(result.totalTaxAmount).toBe('180.00');
      expect(result.totalAmount).toBe('1180.00');
      expect(result.components).toEqual([
        { rateType: 'IGST', ratePercent: '18.000000', taxAmount: '180.00' }
      ]);
    });

    it('calculates Exclusive CGST (9%) + UTGST (9%) for Non-Legislature UT', async () => {
      const cat = await taxEngine.createTaxCategory(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: 'CAT_UTGST',
        name: 'UTGST Category'
      });

      await taxEngine.createTaxRate(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: cat.id,
        rateType: 'CGST',
        ratePercent: '9.000000',
        validFrom: '2026-01-01'
      });

      await taxEngine.createTaxRate(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: cat.id,
        rateType: 'UTGST',
        ratePercent: '9.000000',
        validFrom: '2026-01-01'
      });

      const treatment = await taxEngine.resolveTaxTreatment(ctxTenantACompanyA, {
        companyId: 'company_A',
        transactionDate: '2026-06-15',
        taxCategoryId: cat.id,
        supplierStateCode: '04', // Chandigarh (UT_WITHOUT_LEGISLATURE)
        recipientStateCode: '04'
      });

      const result = taxCalc.calculateTax(ctxTenantACompanyA, {
        amount: '500.00',
        calculationMode: 'EXCLUSIVE',
        treatment
      });

      expect(result.taxableAmount).toBe('500.00');
      expect(result.totalTaxAmount).toBe('90.00');
      expect(result.totalAmount).toBe('590.00');
      expect(result.components).toEqual([
        { rateType: 'CGST', ratePercent: '9.000000', taxAmount: '45.00' },
        { rateType: 'UTGST', ratePercent: '9.000000', taxAmount: '45.00' }
      ]);
    });

    it('calculates Exclusive IGST (12%) + CESS (5%) on 2000.00', async () => {
      const treatment = await createMockTreatment('TAXABLE', [
        { rateType: 'IGST', ratePercent: '12.000000' },
        { rateType: 'CESS', ratePercent: '5.000000' }
      ], 'INTER_STATE');

      const result = taxCalc.calculateTax(ctxTenantACompanyA, {
        amount: '2000.00',
        calculationMode: 'EXCLUSIVE',
        treatment
      });

      expect(result.taxableAmount).toBe('2000.00');
      expect(result.components[0]).toEqual({ rateType: 'IGST', ratePercent: '12.000000', taxAmount: '240.00' });
      expect(result.components[1]).toEqual({ rateType: 'CESS', ratePercent: '5.000000', taxAmount: '100.00' });
      expect(result.totalTaxAmount).toBe('340.00');
      expect(result.totalAmount).toBe('2340.00');
    });
  });

  // 3. Inclusive Tax Extraction Calculations
  describe('Inclusive Tax Extraction Pipeline', () => {
    it('extracts Inclusive CGST (9%) + SGST (9%) on 118.00', async () => {
      const treatment = await createMockTreatment('TAXABLE', [
        { rateType: 'CGST', ratePercent: '9.000000' },
        { rateType: 'SGST', ratePercent: '9.000000' }
      ], 'INTRA_STATE');

      const result = taxCalc.calculateTax(ctxTenantACompanyA, {
        amount: '118.00',
        calculationMode: 'INCLUSIVE',
        treatment
      });

      expect(result.totalAmount).toBe('118.00');
      expect(result.taxableAmount).toBe('100.00');
      expect(result.totalTaxAmount).toBe('18.00');
      expect(result.components).toEqual([
        { rateType: 'CGST', ratePercent: '9.000000', taxAmount: '9.00' },
        { rateType: 'SGST', ratePercent: '9.000000', taxAmount: '9.00' }
      ]);
    });

    it('extracts Inclusive IGST (18%) on 118.00 for Inter-State supply', async () => {
      const treatment = await createMockTreatment('TAXABLE', [
        { rateType: 'IGST', ratePercent: '18.000000' }
      ], 'INTER_STATE');

      const result = taxCalc.calculateTax(ctxTenantACompanyA, {
        amount: '118.00',
        calculationMode: 'INCLUSIVE',
        treatment
      });

      expect(result.totalAmount).toBe('118.00');
      expect(result.taxableAmount).toBe('100.00');
      expect(result.totalTaxAmount).toBe('18.00');
      expect(result.components).toEqual([
        { rateType: 'IGST', ratePercent: '18.000000', taxAmount: '18.00' }
      ]);
    });

    it('handles repeating decimal extraction deterministically (100.00 inclusive at 18%)', async () => {
      const treatment = await createMockTreatment('TAXABLE', [
        { rateType: 'CGST', ratePercent: '9.000000' },
        { rateType: 'SGST', ratePercent: '9.000000' }
      ], 'INTRA_STATE');

      const result = taxCalc.calculateTax(ctxTenantACompanyA, {
        amount: '100.00',
        calculationMode: 'INCLUSIVE',
        treatment
      });

      // CGST unrounded: 100 * 9 / 118 = 7.627118... -> Half-Even rounds to 7.63
      // SGST unrounded: 100 * 9 / 118 = 7.627118... -> Half-Even rounds to 7.63
      // Total Tax = 7.63 + 7.63 = 15.26
      // Taxable = 100.00 - 15.26 = 84.74
      expect(result.totalAmount).toBe('100.00');
      expect(result.components[0].taxAmount).toBe('7.63');
      expect(result.components[1].taxAmount).toBe('7.63');
      expect(result.totalTaxAmount).toBe('15.26');
      expect(result.taxableAmount).toBe('84.74');
      expect(ExactDecimal.parse(result.taxableAmount).add(ExactDecimal.parse(result.totalTaxAmount)).toString()).toBe('100.00');
    });

    it('extracts Inclusive IGST (5%) on 105.00', async () => {
      const treatment = await createMockTreatment('TAXABLE', [
        { rateType: 'IGST', ratePercent: '5.000000' }
      ], 'INTER_STATE');

      const result = taxCalc.calculateTax(ctxTenantACompanyA, {
        amount: '105.00',
        calculationMode: 'INCLUSIVE',
        treatment
      });

      expect(result.totalAmount).toBe('105.00');
      expect(result.taxableAmount).toBe('100.00');
      expect(result.totalTaxAmount).toBe('5.00');
    });
  });

  // 4. Non-Taxable Treatments (EXEMPT, NIL_RATED, NON_GST)
  describe('Non-Taxable Treatments Handling', () => {
    it('returns zero tax for EXEMPT treatment', async () => {
      const treatment = await createMockTreatment('EXEMPT', [
        { rateType: 'CGST', ratePercent: '9.000000' },
        { rateType: 'SGST', ratePercent: '9.000000' }
      ], 'INTRA_STATE');

      const result = taxCalc.calculateTax(ctxTenantACompanyA, {
        amount: '1000.00',
        calculationMode: 'EXCLUSIVE',
        treatment
      });

      expect(result.taxableAmount).toBe('1000.00');
      expect(result.totalTaxAmount).toBe('0.00');
      expect(result.totalAmount).toBe('1000.00');
      expect(result.components).toEqual([]);
      expect(result.taxability).toBe('EXEMPT');
    });

    it('returns zero tax for NIL_RATED treatment', async () => {
      const treatment = await createMockTreatment('NIL_RATED', [], 'INTRA_STATE');

      const result = taxCalc.calculateTax(ctxTenantACompanyA, {
        amount: '500.00',
        calculationMode: 'INCLUSIVE',
        treatment
      });

      expect(result.taxableAmount).toBe('500.00');
      expect(result.totalTaxAmount).toBe('0.00');
      expect(result.totalAmount).toBe('500.00');
      expect(result.taxability).toBe('NIL_RATED');
    });

    it('returns zero tax for NON_GST treatment', async () => {
      const treatment = await createMockTreatment('NON_GST', [], 'INTRA_STATE');

      const result = taxCalc.calculateTax(ctxTenantACompanyA, {
        amount: '250.00',
        calculationMode: 'EXCLUSIVE',
        treatment
      });

      expect(result.taxableAmount).toBe('250.00');
      expect(result.totalTaxAmount).toBe('0.00');
      expect(result.totalAmount).toBe('250.00');
      expect(result.taxability).toBe('NON_GST');
    });
  });

  // 5. Input Validation & Precision Scale Enforcement
  describe('Input Validation & Scale Guards', () => {
    it('rejects monetary amounts with scale > 2 (e.g. 100.001)', async () => {
      const treatment = await createMockTreatment('TAXABLE', [{ rateType: 'IGST', ratePercent: '18.000000' }], 'INTER_STATE');

      expect(() => taxCalc.calculateTax(ctxTenantACompanyA, {
        amount: '100.001',
        calculationMode: 'EXCLUSIVE',
        treatment
      })).toThrow(ValidationError);

      expect(() => taxCalc.calculateTax(ctxTenantACompanyA, {
        amount: '10.999',
        calculationMode: 'EXCLUSIVE',
        treatment
      })).toThrow(ValidationError);
    });

    it('rejects negative monetary amounts', async () => {
      const treatment = await createMockTreatment('TAXABLE', [{ rateType: 'IGST', ratePercent: '18.000000' }], 'INTER_STATE');

      expect(() => taxCalc.calculateTax(ctxTenantACompanyA, {
        amount: '-100.00',
        calculationMode: 'EXCLUSIVE',
        treatment
      })).toThrow(ValidationError);
    });

    it('rejects invalid calculation modes', async () => {
      const treatment = await createMockTreatment('TAXABLE', [{ rateType: 'IGST', ratePercent: '18.000000' }], 'INTER_STATE');

      expect(() => taxCalc.calculateTax(ctxTenantACompanyA, {
        amount: '100.00',
        calculationMode: 'INVALID' as any,
        treatment
      })).toThrow(ValidationError);
    });

    it('rejects missing treatment or missing amount', async () => {
      expect(() => taxCalc.calculateTax(ctxTenantACompanyA, {
        amount: '',
        calculationMode: 'EXCLUSIVE',
        treatment: null as any
      })).toThrow(ValidationError);
    });
  });

  // 6. Statutory Reference Vectors (5%, 12%, 18%, 28%)
  describe('Statutory Reference Vectors (5%, 12%, 18%, 28%)', () => {
    const vectors = [
      { rate: '5.000000', amount: '1000.00', mode: 'EXCLUSIVE', expTax: '50.00', expTotal: '1050.00' },
      { rate: '12.000000', amount: '1000.00', mode: 'EXCLUSIVE', expTax: '120.00', expTotal: '1120.00' },
      { rate: '18.000000', amount: '1000.00', mode: 'EXCLUSIVE', expTax: '180.00', expTotal: '1180.00' },
      { rate: '28.000000', amount: '1000.00', mode: 'EXCLUSIVE', expTax: '280.00', expTotal: '1280.00' },
      { rate: '5.000000', amount: '105.00', mode: 'INCLUSIVE', expTax: '5.00', expBase: '100.00' },
      { rate: '12.000000', amount: '112.00', mode: 'INCLUSIVE', expTax: '12.00', expBase: '100.00' },
      { rate: '18.000000', amount: '118.00', mode: 'INCLUSIVE', expTax: '18.00', expBase: '100.00' },
      { rate: '28.000000', amount: '128.00', mode: 'INCLUSIVE', expTax: '28.00', expBase: '100.00' }
    ];

    vectors.forEach(vec => {
      it(`calculates statutory vector ${vec.rate}% (${vec.mode}) for ${vec.amount}`, async () => {
        const treatment = await createMockTreatment('TAXABLE', [{ rateType: 'IGST', ratePercent: vec.rate }], 'INTER_STATE');
        const res = taxCalc.calculateTax(ctxTenantACompanyA, {
          amount: vec.amount,
          calculationMode: vec.mode as any,
          treatment
        });

        if (vec.mode === 'EXCLUSIVE') {
          expect(res.taxableAmount).toBe(vec.amount);
          expect(res.totalTaxAmount).toBe(vec.expTax);
          expect(res.totalAmount).toBe(vec.expTotal);
        } else {
          expect(res.totalAmount).toBe(vec.amount);
          expect(res.taxableAmount).toBe(vec.expBase);
          expect(res.totalTaxAmount).toBe(vec.expTax);
        }
      });
    });
  });

  // 7. Security & Concurrency Verification
  describe('Multi-Tenant Security & Concurrency', () => {
    it('rejects company scope mismatch during calculation', async () => {
      const treatment = await createMockTreatment('TAXABLE', [{ rateType: 'IGST', ratePercent: '18.000000' }], 'INTER_STATE');

      expect(() => taxCalc.calculateTax(ctxTenantACompanyB, { // Context company_B vs treatment company_A
        amount: '1000.00',
        calculationMode: 'EXCLUSIVE',
        treatment
      })).toThrow(ForbiddenError);
    });

    it('executes 100 concurrent identical calculations deterministically', async () => {
      const treatment = await createMockTreatment('TAXABLE', [
        { rateType: 'CGST', ratePercent: '9.000000' },
        { rateType: 'SGST', ratePercent: '9.000000' }
      ], 'INTRA_STATE');

      const results = Array.from({ length: 100 }).map(() =>
        taxCalc.calculateTax(ctxTenantACompanyA, {
          amount: '1000.00',
          calculationMode: 'EXCLUSIVE',
          treatment
        })
      );

      expect(results).toHaveLength(100);
      for (const res of results) {
        expect(res.taxableAmount).toBe('1000.00');
        expect(res.totalTaxAmount).toBe('180.00');
        expect(res.totalAmount).toBe('1180.00');
      }
    });
  });

  // 8. Property-Based / Randomized Invariant Tests (200 cases)
  describe('Randomized Invariant Verification (200 Random Test Cases)', () => {
    it('verifies totalAmount === taxableAmount + totalTaxAmount and totalTax === sum(components) across 200 random cases', async () => {
      const ratesList: Array<Array<{ rateType: 'CGST' | 'SGST' | 'IGST' | 'UTGST'; ratePercent: string }>> = [
        [{ rateType: 'IGST', ratePercent: '5.000000' }],
        [{ rateType: 'IGST', ratePercent: '12.000000' }],
        [{ rateType: 'CGST', ratePercent: '9.000000' }, { rateType: 'SGST', ratePercent: '9.000000' }],
        [{ rateType: 'CGST', ratePercent: '14.000000' }, { rateType: 'SGST', ratePercent: '14.000000' }]
      ];

      for (let i = 0; i < 200; i++) {
        const randInt = Math.floor(Math.random() * 999999) + 1; // 1 to 999999 cents
        const amount = (randInt / 100).toFixed(2);
        const mode = i % 2 === 0 ? 'EXCLUSIVE' : 'INCLUSIVE';
        const rates = ratesList[i % ratesList.length]!;
        const supplyNature = (rates[0]!.rateType === 'IGST') ? 'INTER_STATE' : 'INTRA_STATE';

        const treatment = await createMockTreatment('TAXABLE', rates, supplyNature);
        const result = taxCalc.calculateTax(ctxTenantACompanyA, {
          amount,
          calculationMode: mode,
          treatment
        });

        const decTaxable = ExactDecimal.parse(result.taxableAmount, 2);
        const decTax = ExactDecimal.parse(result.totalTaxAmount, 2);
        const decTotal = ExactDecimal.parse(result.totalAmount, 2);

        // Verify Invariant 1: totalAmount === taxableAmount + totalTaxAmount
        expect(decTotal.equals(decTaxable.add(decTax))).toBe(true);

        // Verify Invariant 2: totalTaxAmount === sum(components.taxAmount)
        let compSum = ExactDecimal.ZERO;
        for (const comp of result.components) {
          compSum = compSum.add(ExactDecimal.parse(comp.taxAmount, 2));
        }
        expect(decTax.equals(compSum)).toBe(true);
      }
    });
  });
});
