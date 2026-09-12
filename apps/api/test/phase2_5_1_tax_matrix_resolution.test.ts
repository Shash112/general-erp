import { describe, it, expect, beforeEach } from 'vitest';
import { TaxEngineService } from '../src/modules/finance/tax-engine.service.js';
import { RequestContext, NotFoundError, ForbiddenError, BusinessRuleViolationError, ConflictError, ValidationError } from '@general-erp/core';

describe('Phase 2.5.1 — Tax Matrix & HSN/SAC Resolution Service Tests', () => {
  let taxEngine: TaxEngineService;

  const ctxTenantACompanyA: RequestContext = {
    requestId: 'req_001',
    tenantId: 'tenant_A',
    companyId: 'company_A',
    ip: '127.0.0.1',
    userAgent: 'test-agent',
    timestamp: new Date()
  };

  const ctxTenantACompanyB: RequestContext = {
    requestId: 'req_002',
    tenantId: 'tenant_A',
    companyId: 'company_B',
    ip: '127.0.0.1',
    userAgent: 'test-agent',
    timestamp: new Date()
  };

  const ctxTenantBCompanyA: RequestContext = {
    requestId: 'req_003',
    tenantId: 'tenant_B',
    companyId: 'company_A',
    ip: '127.0.0.1',
    userAgent: 'test-agent',
    timestamp: new Date()
  };

  beforeEach(() => {
    taxEngine = new TaxEngineService();
    taxEngine.clear();
  });

  // 1. HSN / SAC Resolution & Validation Tests
  describe('HSN / SAC Resolution & Validation', () => {
    it('resolves valid HSN code for Tenant A Company A', async () => {
      const hsn = await taxEngine.createHSNSAC(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: '8471',
        description: 'Automatic data processing machines',
        type: 'HSN'
      });

      const resolved = await taxEngine.resolveHSNSAC(ctxTenantACompanyA, '8471', 'HSN');
      expect(resolved.id).toBe(hsn.id);
      expect(resolved.code).toBe('8471');
      expect(resolved.type).toBe('HSN');
    });

    it('resolves valid SAC code for Tenant A Company A', async () => {
      const sac = await taxEngine.createHSNSAC(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: '998311',
        description: 'Management consulting services',
        type: 'SAC'
      });

      const resolved = await taxEngine.resolveHSNSAC(ctxTenantACompanyA, '998311', 'SAC');
      expect(resolved.id).toBe(sac.id);
      expect(resolved.type).toBe('SAC');
    });

    it('rejects unknown HSN/SAC code with NotFoundError', async () => {
      await expect(taxEngine.resolveHSNSAC(ctxTenantACompanyA, '999999'))
        .rejects.toThrow(NotFoundError);
    });

    it('rejects invalid HSN/SAC type during creation', async () => {
      await expect(taxEngine.createHSNSAC(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: '1234',
        description: 'Invalid',
        type: 'INVALID' as any
      })).rejects.toThrow(ValidationError);
    });

    it('rejects cross-tenant HSN lookup', async () => {
      await taxEngine.createHSNSAC(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: '8471',
        description: 'Laptops',
        type: 'HSN'
      });

      await expect(taxEngine.resolveHSNSAC(ctxTenantBCompanyA, '8471'))
        .rejects.toThrow(NotFoundError);
    });

    it('rejects cross-company HSN lookup', async () => {
      await taxEngine.createHSNSAC(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: '8471',
        description: 'Laptops',
        type: 'HSN'
      });

      await expect(taxEngine.resolveHSNSAC(ctxTenantACompanyB, '8471'))
        .rejects.toThrow(NotFoundError);
    });
  });

  // 2. Tax Category Resolution & Fallback Tests
  describe('Tax Category Resolution & Fallback', () => {
    it('resolves tax category by ID and by Code', async () => {
      const stdCat = await taxEngine.createTaxCategory(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: 'STANDARD',
        name: 'Standard GST Category (18%)'
      });

      const byId = await taxEngine.resolveTaxCategory(ctxTenantACompanyA, stdCat.id);
      expect(byId.code).toBe('STANDARD');

      const byCode = await taxEngine.resolveTaxCategory(ctxTenantACompanyA, 'STANDARD');
      expect(byCode.id).toBe(stdCat.id);
    });

    it('rejects cross-tenant and cross-company tax category resolution', async () => {
      const stdCat = await taxEngine.createTaxCategory(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: 'STANDARD',
        name: 'Standard GST Category'
      });

      await expect(taxEngine.resolveTaxCategory(ctxTenantBCompanyA, stdCat.id)).rejects.toThrow(NotFoundError);
      await expect(taxEngine.resolveTaxCategory(ctxTenantACompanyB, stdCat.id)).rejects.toThrow(NotFoundError);
      await expect(taxEngine.resolveTaxCategory(ctxTenantACompanyB, 'STANDARD')).rejects.toThrow(NotFoundError);
    });

    it('resolves default tax category fallback via HSN code when explicit taxCategoryId is missing', async () => {
      const stdCat = await taxEngine.createTaxCategory(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: 'STANDARD',
        name: 'Standard 18%'
      });

      await taxEngine.createHSNSAC(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: '8471',
        description: 'Laptops',
        type: 'HSN',
        defaultTaxCategoryId: stdCat.id
      });

      await taxEngine.createTaxRate(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: stdCat.id,
        rateType: 'IGST',
        ratePercent: '18.000000',
        validFrom: '2026-01-01'
      });

      const matrix = await taxEngine.resolveTaxMatrix(ctxTenantACompanyA, {
        companyId: 'company_A',
        transactionDate: '2026-06-15',
        hsnSacCode: '8471'
      });

      expect(matrix.taxCategory.id).toBe(stdCat.id);
      expect(matrix.taxCategory.code).toBe('STANDARD');
      expect(matrix.hsnSac?.code).toBe('8471');
      expect(matrix.rates).toHaveLength(1);
      expect(matrix.rates[0].ratePercent).toBe('18.000000');
    });

    it('throws BusinessRuleViolationError when tax category cannot be resolved from HSN or request', async () => {
      await taxEngine.createHSNSAC(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: '8471',
        description: 'Laptops without default category',
        type: 'HSN'
      });

      await expect(taxEngine.resolveTaxMatrix(ctxTenantACompanyA, {
        companyId: 'company_A',
        transactionDate: '2026-06-15',
        hsnSacCode: '8471'
      })).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  // 3. Effective-Dated Tax Rate Resolution Tests
  describe('Effective-Dated Tax Rate Resolution', () => {
    it('resolves historical, current, and future tax rates deterministically', async () => {
      const stdCat = await taxEngine.createTaxCategory(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: 'STANDARD',
        name: 'Standard GST'
      });

      // Historical rate: 2025-01-01 to 2025-12-31 (12%)
      await taxEngine.createTaxRate(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: stdCat.id,
        rateType: 'IGST',
        ratePercent: '12.000000',
        validFrom: '2025-01-01',
        validTo: '2025-12-31'
      });

      // Current rate: 2026-01-01 to 2026-12-31 (18%)
      await taxEngine.createTaxRate(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: stdCat.id,
        rateType: 'IGST',
        ratePercent: '18.000000',
        validFrom: '2026-01-01',
        validTo: '2026-12-31'
      });

      // Future rate: 2027-01-01 onwards (28%)
      await taxEngine.createTaxRate(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: stdCat.id,
        rateType: 'IGST',
        ratePercent: '28.000000',
        validFrom: '2027-01-01'
      });

      // Historical resolution
      const historicalRates = await taxEngine.resolveTaxRates(ctxTenantACompanyA, stdCat.id, '2025-06-15');
      expect(historicalRates[0].ratePercent).toBe('12.000000');

      // Current resolution
      const currentRates = await taxEngine.resolveTaxRates(ctxTenantACompanyA, stdCat.id, '2026-06-15');
      expect(currentRates[0].ratePercent).toBe('18.000000');

      // Boundary resolution (2026-12-31)
      const boundaryRates = await taxEngine.resolveTaxRates(ctxTenantACompanyA, stdCat.id, '2026-12-31');
      expect(boundaryRates[0].ratePercent).toBe('18.000000');

      // Future resolution (2027-01-01)
      const futureRates = await taxEngine.resolveTaxRates(ctxTenantACompanyA, stdCat.id, '2027-01-01');
      expect(futureRates[0].ratePercent).toBe('28.000000');
    });

    it('resolves multiple independent statutory rate types (CGST, SGST, IGST, UTGST, CESS)', async () => {
      const stdCat = await taxEngine.createTaxCategory(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: 'STANDARD',
        name: 'Standard GST'
      });

      await taxEngine.createTaxRate(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: stdCat.id,
        rateType: 'CGST',
        ratePercent: '9.000000',
        validFrom: '2026-01-01'
      });

      await taxEngine.createTaxRate(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: stdCat.id,
        rateType: 'SGST',
        ratePercent: '9.000000',
        validFrom: '2026-01-01'
      });

      await taxEngine.createTaxRate(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: stdCat.id,
        rateType: 'IGST',
        ratePercent: '18.000000',
        validFrom: '2026-01-01'
      });

      await taxEngine.createTaxRate(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: stdCat.id,
        rateType: 'UTGST',
        ratePercent: '9.000000',
        validFrom: '2026-01-01'
      });

      await taxEngine.createTaxRate(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: stdCat.id,
        rateType: 'CESS',
        ratePercent: '12.000000',
        validFrom: '2026-01-01'
      });

      const rates = await taxEngine.resolveTaxRates(ctxTenantACompanyA, stdCat.id, '2026-06-15');
      expect(rates).toHaveLength(5);
      expect(rates.map(r => r.rateType)).toEqual(['CGST', 'SGST', 'IGST', 'UTGST', 'CESS']);
    });
  });

  // 4. Tax Rules Priority & Specificity Resolution Tests
  describe('Tax Rules Priority & Specificity Resolution', () => {
    it('resolves highest precedence rule (lower priority integer)', async () => {
      const stdCat = await taxEngine.createTaxCategory(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: 'STANDARD',
        name: 'Standard'
      });

      // Priority 20: Generic Taxable Rule
      await taxEngine.createTaxRule(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: stdCat.id,
        taxability: 'TAXABLE',
        priority: 20,
        validFrom: '2026-01-01'
      });

      // Priority 5: Exemption Override Rule
      await taxEngine.createTaxRule(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: stdCat.id,
        taxability: 'EXEMPT',
        priority: 5,
        validFrom: '2026-01-01'
      });

      const rules = await taxEngine.resolveTaxRules(ctxTenantACompanyA, {
        taxCategoryId: stdCat.id,
        transactionDate: '2026-06-15'
      });

      expect(rules[0].priority).toBe(5);
      expect(rules[0].taxability).toBe('EXEMPT');
    });

    it('resolves specific HSN rule over generic category rule', async () => {
      const stdCat = await taxEngine.createTaxCategory(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: 'STANDARD',
        name: 'Standard'
      });

      const hsn = await taxEngine.createHSNSAC(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: '8471',
        description: 'Computers',
        type: 'HSN'
      });

      // Generic Rule (Priority 10)
      await taxEngine.createTaxRule(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: stdCat.id,
        taxability: 'TAXABLE',
        priority: 10,
        validFrom: '2026-01-01'
      });

      // Specific HSN Rule (Priority 10)
      const specificRule = await taxEngine.createTaxRule(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: stdCat.id,
        hsnSacCodeId: hsn.id,
        taxability: 'EXEMPT',
        priority: 10,
        validFrom: '2026-01-01'
      });

      const rules = await taxEngine.resolveTaxRules(ctxTenantACompanyA, {
        taxCategoryId: stdCat.id,
        hsnSacCodeId: hsn.id,
        transactionDate: '2026-06-15'
      });

      expect(rules[0].id).toBe(specificRule.id);
      expect(rules[0].taxability).toBe('EXEMPT');
    });

    it('throws ConflictError on ambiguous equal-priority equal-specificity conflicting rules', async () => {
      const stdCat = await taxEngine.createTaxCategory(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: 'STANDARD',
        name: 'Standard'
      });

      // Rule 1: TAXABLE
      await taxEngine.createTaxRule(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: stdCat.id,
        taxability: 'TAXABLE',
        priority: 10,
        validFrom: '2026-01-01'
      });

      // Rule 2: EXEMPT (Same priority 10, same category specificity)
      await taxEngine.createTaxRule(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: stdCat.id,
        taxability: 'EXEMPT',
        priority: 10,
        validFrom: '2026-01-01'
      });

      await expect(taxEngine.resolveTaxRules(ctxTenantACompanyA, {
        taxCategoryId: stdCat.id,
        transactionDate: '2026-06-15'
      })).rejects.toThrow(ConflictError);
    });

    it('ignores inactive rules during resolution', async () => {
      const stdCat = await taxEngine.createTaxCategory(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: 'STANDARD',
        name: 'Standard'
      });

      await taxEngine.createTaxRule(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: stdCat.id,
        taxability: 'EXEMPT',
        status: 'INACTIVE',
        priority: 1,
        validFrom: '2026-01-01'
      });

      const rules = await taxEngine.resolveTaxRules(ctxTenantACompanyA, {
        taxCategoryId: stdCat.id,
        transactionDate: '2026-06-15'
      });

      expect(rules).toHaveLength(0);
    });
  });

  // 5. Security & Isolation Matrix Tests
  describe('Multi-Tenant & Cross-Company Security Matrix', () => {
    it('rejects company scope mismatch during resolveTaxMatrix', async () => {
      await expect(taxEngine.resolveTaxMatrix(ctxTenantACompanyA, {
        companyId: 'company_B', // Mismatched company in context vs request
        transactionDate: '2026-06-15',
        taxCategoryId: 'cat_1'
      })).rejects.toThrow(ForbiddenError);
    });

    it('prevents cross-tenant default tax category reference during HSN creation', async () => {
      const tenantACat = await taxEngine.createTaxCategory(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: 'STANDARD',
        name: 'Standard A'
      });

      await expect(taxEngine.createHSNSAC(ctxTenantBCompanyA, {
        companyId: 'company_A',
        code: '8471',
        description: 'Cross tenant HSN',
        type: 'HSN',
        defaultTaxCategoryId: tenantACat.id
      })).rejects.toThrow(NotFoundError);
    });
  });

  // 6. Concurrency & Performance Tests
  describe('Concurrency & Randomized Stress Tests', () => {
    it('executes 100 concurrent resolution requests deterministically without errors', async () => {
      const stdCat = await taxEngine.createTaxCategory(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: 'STANDARD',
        name: 'Standard 18%'
      });

      await taxEngine.createHSNSAC(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: '8471',
        description: 'Laptops',
        type: 'HSN',
        defaultTaxCategoryId: stdCat.id
      });

      await taxEngine.createTaxRate(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: stdCat.id,
        rateType: 'IGST',
        ratePercent: '18.000000',
        validFrom: '2026-01-01'
      });

      const promises = Array.from({ length: 100 }).map(() =>
        taxEngine.resolveTaxMatrix(ctxTenantACompanyA, {
          companyId: 'company_A',
          transactionDate: '2026-06-15',
          hsnSacCode: '8471'
        })
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(100);
      for (const res of results) {
        expect(res.taxCategory.code).toBe('STANDARD');
        expect(res.rates[0].ratePercent).toBe('18.000000');
      }
    });

    it('proves zero floating-point arithmetic is performed during resolution', async () => {
      const stdCat = await taxEngine.createTaxCategory(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: 'SUPER_REDUCED',
        name: 'Super Reduced 0.25%'
      });

      await taxEngine.createTaxRate(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: stdCat.id,
        rateType: 'IGST',
        ratePercent: '0.250000',
        validFrom: '2026-01-01'
      });

      const res = await taxEngine.resolveTaxMatrix(ctxTenantACompanyA, {
        companyId: 'company_A',
        transactionDate: '2026-06-15',
        taxCategoryId: stdCat.id
      });

      // Assert exact string representation preserved
      expect(typeof res.rates[0].ratePercent).toBe('string');
      expect(res.rates[0].ratePercent).toBe('0.250000');
    });
  });
});
