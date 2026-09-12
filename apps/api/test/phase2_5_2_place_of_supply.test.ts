import { describe, it, expect, beforeEach } from 'vitest';
import { TaxEngineService } from '../src/modules/finance/tax-engine.service.js';
import { RequestContext, ValidationError, ForbiddenError, NotFoundError, BusinessRuleViolationError, ConflictError } from '@general-erp/core';

describe('Phase 2.5.2 — Place of Supply & Taxability Evaluator Tests', () => {
  let taxEngine: TaxEngineService;

  const ctxTenantACompanyA: RequestContext = {
    requestId: 'req_pos_001',
    tenantId: 'tenant_A',
    companyId: 'company_A',
    ip: '127.0.0.1',
    userAgent: 'test-agent',
    timestamp: new Date()
  };

  const ctxTenantACompanyB: RequestContext = {
    requestId: 'req_pos_002',
    tenantId: 'tenant_A',
    companyId: 'company_B',
    ip: '127.0.0.1',
    userAgent: 'test-agent',
    timestamp: new Date()
  };

  beforeEach(() => {
    taxEngine = new TaxEngineService();
    taxEngine.clear();
  });

  // 1. State / Union Territory Validation Tests
  describe('Indian State & Union Territory Code Validation', () => {
    it('validates 2-digit Indian State code (e.g. 27 Maharashtra, 07 Delhi)', () => {
      expect(taxEngine.validateStateCode('27', 'supplierStateCode')).toBe('27');
      expect(taxEngine.validateStateCode('07', 'supplierStateCode')).toBe('07');
      expect(taxEngine.validateStateCode('7', 'supplierStateCode')).toBe('07'); // Single digit auto-padded
    });

    it('validates 2-digit Union Territory code (e.g. 04 Chandigarh, 35 Andaman)', () => {
      expect(taxEngine.validateStateCode('04', 'supplierStateCode')).toBe('04');
      expect(taxEngine.validateStateCode('35', 'supplierStateCode')).toBe('35');
      expect(taxEngine.validateStateCode('38', 'supplierStateCode')).toBe('38'); // Ladakh
      expect(taxEngine.validateStateCode('97', 'supplierStateCode')).toBe('97'); // Other Territory
    });

    it('rejects invalid state/UT code with ValidationError', () => {
      expect(() => taxEngine.validateStateCode('99', 'supplierStateCode')).toThrow(ValidationError);
      expect(() => taxEngine.validateStateCode('XX', 'supplierStateCode')).toThrow(ValidationError);
    });

    it('rejects empty or missing state code with ValidationError', () => {
      expect(() => taxEngine.validateStateCode('', 'supplierStateCode')).toThrow(ValidationError);
      expect(() => taxEngine.validateStateCode(null as any, 'supplierStateCode')).toThrow(ValidationError);
    });
  });

  // 2. Deemed Exports Uncoupling Verification Tests
  describe('Deemed Exports Uncoupling Verification', () => {
    it('proves deemed export does NOT independently force INTER_STATE classification when supplier and recipient are in the same state', () => {
      const pos = taxEngine.resolvePlaceOfSupply({
        supplierStateCode: '27', // Maharashtra
        recipientStateCode: '27',  // Maharashtra
        isDeemedExport: true
      });

      // Deemed export within same state remains INTRA_STATE
      expect(pos.supplyNature).toBe('INTRA_STATE');
      expect(pos.isDeemedExport).toBe(true);
      expect(pos.supplierStateCode).toBe('27');
      expect(pos.recipientStateCode).toBe('27');
    });

    it('preserves INTER_STATE classification for deemed export when supplier and recipient are in different states', () => {
      const pos = taxEngine.resolvePlaceOfSupply({
        supplierStateCode: '27', // Maharashtra
        recipientStateCode: '07',  // Delhi
        isDeemedExport: true
      });

      expect(pos.supplyNature).toBe('INTER_STATE');
      expect(pos.isDeemedExport).toBe(true);
    });
  });

  // 3. Territory Type Classification & UTGST Applicability Tests
  describe('Territory Classification & UTGST Applicability Separation', () => {
    it('classifies 01 Jammu & Kashmir as UT_WITH_LEGISLATURE (SGST applies for intra-state)', () => {
      const pos = taxEngine.resolvePlaceOfSupply({ supplierStateCode: '01', recipientStateCode: '01' });
      expect(pos.supplierTerritoryType).toBe('UT_WITH_LEGISLATURE');
      expect(pos.supplyNature).toBe('INTRA_STATE');
      expect(pos.isUtgstApplicable).toBe(false);
    });

    it('classifies 04 Chandigarh as UT_WITHOUT_LEGISLATURE (UTGST applies for intra-state)', () => {
      const pos = taxEngine.resolvePlaceOfSupply({ supplierStateCode: '04', recipientStateCode: '04' });
      expect(pos.supplierTerritoryType).toBe('UT_WITHOUT_LEGISLATURE');
      expect(pos.supplyNature).toBe('INTRA_STATE');
      expect(pos.isUtgstApplicable).toBe(true);
    });

    it('classifies 07 Delhi as UT_WITH_LEGISLATURE (SGST applies for intra-state)', () => {
      const pos = taxEngine.resolvePlaceOfSupply({ supplierStateCode: '07', recipientStateCode: '07' });
      expect(pos.supplierTerritoryType).toBe('UT_WITH_LEGISLATURE');
      expect(pos.isUtgstApplicable).toBe(false);
    });

    it('classifies 25 Daman & Diu historically as UT_WITHOUT_LEGISLATURE (UTGST applies)', () => {
      const pos = taxEngine.resolvePlaceOfSupply({ supplierStateCode: '25', recipientStateCode: '25', transactionDate: '2019-12-01' });
      expect(pos.supplierTerritoryType).toBe('UT_WITHOUT_LEGISLATURE');
      expect(pos.isUtgstApplicable).toBe(true);
    });

    it('classifies 31 Lakshadweep as UT_WITHOUT_LEGISLATURE (UTGST applies)', () => {
      const pos = taxEngine.resolvePlaceOfSupply({ supplierStateCode: '31', recipientStateCode: '31' });
      expect(pos.supplierTerritoryType).toBe('UT_WITHOUT_LEGISLATURE');
      expect(pos.isUtgstApplicable).toBe(true);
    });

    it('classifies 34 Puducherry as UT_WITH_LEGISLATURE (SGST applies)', () => {
      const pos = taxEngine.resolvePlaceOfSupply({ supplierStateCode: '34', recipientStateCode: '34' });
      expect(pos.supplierTerritoryType).toBe('UT_WITH_LEGISLATURE');
      expect(pos.isUtgstApplicable).toBe(false);
    });

    it('classifies 35 Andaman & Nicobar Islands as UT_WITHOUT_LEGISLATURE (UTGST applies)', () => {
      const pos = taxEngine.resolvePlaceOfSupply({ supplierStateCode: '35', recipientStateCode: '35' });
      expect(pos.supplierTerritoryType).toBe('UT_WITHOUT_LEGISLATURE');
      expect(pos.isUtgstApplicable).toBe(true);
    });

    it('classifies 38 Ladakh as UT_WITHOUT_LEGISLATURE (UTGST applies)', () => {
      const pos = taxEngine.resolvePlaceOfSupply({ supplierStateCode: '38', recipientStateCode: '38' });
      expect(pos.supplierTerritoryType).toBe('UT_WITHOUT_LEGISLATURE');
      expect(pos.isUtgstApplicable).toBe(true);
    });

    it('classifies 97 Other Territory as OTHER_TERRITORY (UTGST applies)', () => {
      const pos = taxEngine.resolvePlaceOfSupply({ supplierStateCode: '97', recipientStateCode: '97' });
      expect(pos.supplierTerritoryType).toBe('OTHER_TERRITORY');
      expect(pos.isUtgstApplicable).toBe(true);
    });
  });

  // 3b. Historical Territory Code Resolution Tests (Code 25 vs Code 26)
  describe('Historical GST Territory Code Resolution (Code 25 vs Code 26)', () => {
    it('resolves historical Code 25 to Daman and Diu prior to merger (e.g. 2019-12-01)', () => {
      const terr = taxEngine.resolveTerritory('25', '2019-12-01');
      expect(terr.code).toBe('25');
      expect(terr.name).toBe('Daman and Diu');
      expect(terr.territoryType).toBe('UT_WITHOUT_LEGISLATURE');
      expect(terr.validFrom).toBe('2017-07-01');
      expect(terr.validTo).toBe('2020-01-25');
      expect(terr.isCurrent).toBe(false);
    });

    it('resolves historical Code 26 to Dadra and Nagar Haveli prior to merger (e.g. 2019-12-01)', () => {
      const terr = taxEngine.resolveTerritory('26', '2019-12-01');
      expect(terr.code).toBe('26');
      expect(terr.name).toBe('Dadra and Nagar Haveli');
      expect(terr.territoryType).toBe('UT_WITHOUT_LEGISLATURE');
      expect(terr.validFrom).toBe('2017-07-01');
      expect(terr.validTo).toBe('2020-01-25');
      expect(terr.isCurrent).toBe(false);
    });

    it('resolves Code 26 to unified Dadra and Nagar Haveli and Daman and Diu after merger (e.g. 2026-06-15)', () => {
      const terr = taxEngine.resolveTerritory('26', '2026-06-15');
      expect(terr.code).toBe('26');
      expect(terr.name).toBe('Dadra and Nagar Haveli and Daman and Diu');
      expect(terr.territoryType).toBe('UT_WITHOUT_LEGISLATURE');
      expect(terr.validFrom).toBe('2020-01-26');
      expect(terr.validTo).toBeNull();
      expect(terr.isCurrent).toBe(true);
    });

    it('handles transition boundary on 2020-01-25 (last day of historical 25 and 26)', () => {
      const terr25 = taxEngine.resolveTerritory('25', '2020-01-25');
      expect(terr25.name).toBe('Daman and Diu');

      const terr26 = taxEngine.resolveTerritory('26', '2020-01-25');
      expect(terr26.name).toBe('Dadra and Nagar Haveli');
    });

    it('handles transition boundary on 2020-01-26 (effective date of unified Code 26)', () => {
      const terr26 = taxEngine.resolveTerritory('26', '2020-01-26');
      expect(terr26.name).toBe('Dadra and Nagar Haveli and Daman and Diu');

      expect(() => taxEngine.resolveTerritory('25', '2020-01-26')).toThrow(ValidationError);
    });

    it('rejects Code 25 outside its validity period (e.g. on current date 2026-06-15)', () => {
      expect(() => taxEngine.validateStateCode('25', 'supplierStateCode', '2026-06-15')).toThrow(ValidationError);
      expect(() => taxEngine.resolvePlaceOfSupply({
        supplierStateCode: '25',
        recipientStateCode: '25',
        transactionDate: '2026-06-15'
      })).toThrow(ValidationError);
    });

    it('rejects Code 26 for transaction date prior to 2017-07-01 (GST commencement)', () => {
      expect(() => taxEngine.validateStateCode('26', 'supplierStateCode', '2016-01-01')).toThrow(ValidationError);
    });

    it('proves Code 25 does not appear as a current duplicate in current state map', () => {
      const matches = taxEngine.resolveTerritory('25'); // Undefined date defaults to current/historical entry
      expect(matches.code).toBe('25');
      expect(matches.isCurrent).toBe(false);
    });
  });

  // 4. Place of Supply Derivation Source Modeling Tests
  describe('Place of Supply Derivation Source Modeling', () => {
    it('models posSource as DERIVED when placeOfSupplyStateCode is not explicitly provided', () => {
      const pos = taxEngine.resolvePlaceOfSupply({
        supplierStateCode: '27',
        recipientStateCode: '07'
      });

      expect(pos.posSource).toBe('DERIVED');
      expect(pos.placeOfSupplyStateCode).toBe('07');
    });

    it('models posSource as EXPLICIT when placeOfSupplyStateCode is explicitly provided', () => {
      const pos = taxEngine.resolvePlaceOfSupply({
        supplierStateCode: '27',
        recipientStateCode: '07',
        placeOfSupplyStateCode: '27'
      });

      expect(pos.posSource).toBe('EXPLICIT');
      expect(pos.placeOfSupplyStateCode).toBe('27');
    });

    it('models posSource as SPECIAL_RULE for SEZ and Import transactions', () => {
      const posSez = taxEngine.resolvePlaceOfSupply({
        supplierStateCode: '27',
        recipientStateCode: '27',
        isSez: true
      });
      expect(posSez.posSource).toBe('SPECIAL_RULE');
      expect(posSez.supplyNature).toBe('INTER_STATE');

      const posImport = taxEngine.resolvePlaceOfSupply({
        supplierStateCode: '27',
        isImport: true
      });
      expect(posImport.posSource).toBe('SPECIAL_RULE');
      expect(posImport.supplyNature).toBe('INTER_STATE');
    });
  });

  // 5. Tax Treatment Resolution & Component Rate Filtering Tests
  describe('Tax Treatment Resolution & Component Rate Filtering', () => {
    it('resolves INTRA_STATE treatment with CGST + SGST rates filtered', async () => {
      const cat = await taxEngine.createTaxCategory(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: 'STANDARD',
        name: 'Standard 18%'
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
        rateType: 'SGST',
        ratePercent: '9.000000',
        validFrom: '2026-01-01'
      });

      await taxEngine.createTaxRate(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: cat.id,
        rateType: 'IGST',
        ratePercent: '18.000000',
        validFrom: '2026-01-01'
      });

      const treatment = await taxEngine.resolveTaxTreatment(ctxTenantACompanyA, {
        companyId: 'company_A',
        transactionDate: '2026-06-15',
        taxCategoryId: cat.id,
        supplierStateCode: '27', // Maharashtra
        recipientStateCode: '27'  // Maharashtra -> INTRA_STATE
      });

      expect(treatment.placeOfSupply.supplyNature).toBe('INTRA_STATE');
      expect(treatment.applicableComponentTypes).toEqual(['CGST', 'SGST', 'CESS']);
      expect(treatment.rates).toHaveLength(2);
      expect(treatment.rates.map(r => r.rateType)).toEqual(['CGST', 'SGST']);
      expect(treatment.taxability).toBe('TAXABLE');
      expect(treatment.isRcm).toBe(false);
    });

    it('resolves INTER_STATE treatment with IGST rate filtered', async () => {
      const cat = await taxEngine.createTaxCategory(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: 'STANDARD',
        name: 'Standard 18%'
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
        rateType: 'SGST',
        ratePercent: '9.000000',
        validFrom: '2026-01-01'
      });

      await taxEngine.createTaxRate(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: cat.id,
        rateType: 'IGST',
        ratePercent: '18.000000',
        validFrom: '2026-01-01'
      });

      const treatment = await taxEngine.resolveTaxTreatment(ctxTenantACompanyA, {
        companyId: 'company_A',
        transactionDate: '2026-06-15',
        taxCategoryId: cat.id,
        supplierStateCode: '27', // Maharashtra
        recipientStateCode: '07'  // Delhi -> INTER_STATE
      });

      expect(treatment.placeOfSupply.supplyNature).toBe('INTER_STATE');
      expect(treatment.applicableComponentTypes).toEqual(['IGST', 'CESS']);
      expect(treatment.rates).toHaveLength(1);
      expect(treatment.rates[0].rateType).toBe('IGST');
      expect(treatment.rates[0].ratePercent).toBe('18.000000');
    });

    it('resolves INTRA_STATE UTGST treatment for non-legislature UT (e.g. 04 Chandigarh)', async () => {
      const cat = await taxEngine.createTaxCategory(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: 'STANDARD',
        name: 'Standard 18%'
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
        supplierStateCode: '04', // Chandigarh
        recipientStateCode: '04'  // Chandigarh -> INTRA_STATE UTGST
      });

      expect(treatment.placeOfSupply.supplyNature).toBe('INTRA_STATE');
      expect(treatment.placeOfSupply.isUtgstApplicable).toBe(true);
      expect(treatment.applicableComponentTypes).toEqual(['CGST', 'UTGST', 'CESS']);
      expect(treatment.rates.map(r => r.rateType)).toEqual(['CGST', 'UTGST']);
    });
  });

  // 6. Multi-Tenant Security & Concurrency Tests
  describe('Multi-Tenant Security & Concurrency Verification', () => {
    it('rejects company scope mismatch during resolveTaxTreatment', async () => {
      await expect(taxEngine.resolveTaxTreatment(ctxTenantACompanyA, {
        companyId: 'company_B', // Context company_A vs Request company_B
        transactionDate: '2026-06-15',
        supplierStateCode: '27',
        taxCategoryId: 'cat_1'
      })).rejects.toThrow(ForbiddenError);
    });

    it('proves zero floating-point tax amount calculations are performed and rate strings are preserved', async () => {
      const cat = await taxEngine.createTaxCategory(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: 'SPECIAL',
        name: 'Special Rate 0.25%'
      });

      await taxEngine.createTaxRate(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: cat.id,
        rateType: 'IGST',
        ratePercent: '0.250000',
        validFrom: '2026-01-01'
      });

      const treatment = await taxEngine.resolveTaxTreatment(ctxTenantACompanyA, {
        companyId: 'company_A',
        transactionDate: '2026-06-15',
        taxCategoryId: cat.id,
        supplierStateCode: '27',
        recipientStateCode: '07'
      });

      expect(typeof treatment.rates[0].ratePercent).toBe('string');
      expect(treatment.rates[0].ratePercent).toBe('0.250000');
      expect((treatment as any).taxAmount).toBeUndefined();
      expect((treatment as any).cgstAmount).toBeUndefined();
    });

    it('executes 100 concurrent resolveTaxTreatment requests deterministically', async () => {
      const cat = await taxEngine.createTaxCategory(ctxTenantACompanyA, {
        companyId: 'company_A',
        code: 'STANDARD',
        name: 'Standard 18%'
      });

      await taxEngine.createTaxRate(ctxTenantACompanyA, {
        companyId: 'company_A',
        taxCategoryId: cat.id,
        rateType: 'IGST',
        ratePercent: '18.000000',
        validFrom: '2026-01-01'
      });

      const promises = Array.from({ length: 100 }).map(() =>
        taxEngine.resolveTaxTreatment(ctxTenantACompanyA, {
          companyId: 'company_A',
          transactionDate: '2026-06-15',
          taxCategoryId: cat.id,
          supplierStateCode: '27',
          recipientStateCode: '07'
        })
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(100);
      for (const res of results) {
        expect(res.placeOfSupply.supplyNature).toBe('INTER_STATE');
        expect(res.rates[0].ratePercent).toBe('18.000000');
      }
    });
  });
});
