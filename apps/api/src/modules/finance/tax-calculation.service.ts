import {
  RequestContext,
  ExactDecimal,
  ValidationError,
  ForbiddenError,
  BusinessRuleViolationError
} from '@general-erp/core';
import { logger } from '../../config/logger.js';
import {
  TaxTreatmentResolutionResult,
  TaxComponentType,
  TaxabilityType
} from './tax-engine.service.js';

export type TaxCalculationMode = 'EXCLUSIVE' | 'INCLUSIVE';

export interface TaxCalculationComponentResult {
  rateType: TaxComponentType;
  ratePercent: string; // Preserved numeric(9,6) exact decimal string
  taxAmount: string;   // Preserved numeric(20,2) exact decimal string
}

export interface TaxCalculationResult {
  tenantId: string;
  companyId: string;
  transactionDate: string;
  taxableAmount: string;   // numeric(20,2) exact decimal string
  taxability: TaxabilityType;
  calculationMode: TaxCalculationMode;
  components: TaxCalculationComponentResult[];
  totalTaxAmount: string;  // numeric(20,2) exact decimal string
  totalAmount: string;     // numeric(20,2) exact decimal string
}

export interface CalculateTaxParams {
  amount: string; // Input monetary amount: Taxable amount for EXCLUSIVE, Total inclusive amount for INCLUSIVE
  calculationMode: TaxCalculationMode;
  treatment: TaxTreatmentResolutionResult;
}

export class TaxCalculationService {
  /**
   * Calculates statutory tax amounts for exclusive or inclusive transactions using exact decimal arithmetic
   * and deterministic Half-Even rounding.
   */
  public calculateTax(ctx: RequestContext, params: CalculateTaxParams): TaxCalculationResult {
    // 1. Security & Tenant/Company Scope Verification
    if (!params || !params.treatment) {
      throw new ValidationError('Tax calculation requires a valid TaxTreatmentResolutionResult.');
    }
    if (params.treatment.companyId !== ctx.companyId || params.treatment.tenantId !== ctx.tenantId) {
      throw new ForbiddenError('Company/Tenant scope violation: Context scope does not match treatment scope.');
    }

    // 2. Input Parameter Validation
    if (!params.amount || typeof params.amount !== 'string') {
      throw new ValidationError('Monetary amount is required and must be a non-empty string.');
    }
    ExactDecimal.validateScale(params.amount, 2);

    const parsedAmount = ExactDecimal.parse(params.amount, 2);
    if (parsedAmount.isNegative()) {
      throw new ValidationError(`Negative monetary amounts ('${params.amount}') are not supported for tax calculation.`);
    }

    if (params.calculationMode !== 'EXCLUSIVE' && params.calculationMode !== 'INCLUSIVE') {
      throw new ValidationError(`Invalid calculation mode '${params.calculationMode}'. Must be 'EXCLUSIVE' or 'INCLUSIVE'.`);
    }

    const { treatment } = params;

    // 3. Taxability Handling (Non-Taxable Treatments: EXEMPT, NIL_RATED, NON_GST)
    if (treatment.taxability !== 'TAXABLE') {
      const formattedAmount = parsedAmount.toString();
      return {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        transactionDate: treatment.transactionDate,
        taxableAmount: formattedAmount,
        taxability: treatment.taxability,
        calculationMode: params.calculationMode,
        components: [],
        totalTaxAmount: '0.00',
        totalAmount: formattedAmount
      };
    }

    // 4. Filter applicable rates to statutory selected component types
    const applicableRates = (treatment.rates || []).filter(r =>
      treatment.applicableComponentTypes.includes(r.rateType)
    );

    if (applicableRates.length === 0) {
      throw new BusinessRuleViolationError(
        `Tax calculation failed. Treatment has taxability 'TAXABLE' but no matching applicable rates were resolved.`
      );
    }

    let taxableDec: ExactDecimal;
    let totalTaxDec = ExactDecimal.ZERO;
    let totalDec: ExactDecimal;
    const componentsResult: TaxCalculationComponentResult[] = [];

    // 5. Exclusive Tax Calculation
    if (params.calculationMode === 'EXCLUSIVE') {
      taxableDec = parsedAmount;

      for (const rateDTO of applicableRates) {
        if (!rateDTO.ratePercent || !/^\d+(\.\d+)?$/.test(rateDTO.ratePercent.trim())) {
          throw new ValidationError(`Invalid tax rate percentage string: '${rateDTO.ratePercent}'.`);
        }

        const cleanRateStr = rateDTO.ratePercent.trim();
        const parts = cleanRateStr.split('.');
        const intPart = parts[0]!;
        const decPart = (parts[1] || '').padEnd(6, '0').slice(0, 6);
        const rateBigInt = BigInt(intPart + decPart); // scale 6

        // Tax = Taxable * Rate / 100
        // taxableDec.rawBigInt has scale 2. rateBigInt has scale 6.
        // Product rawBigInt has scale 2 + 6 = 8.
        const unroundedTaxRaw = taxableDec.rawBigInt * rateBigInt; // scale 8 (represents Taxable * RatePercent)
        // Divide by 100 to get actual tax amount (scale 8 remains)
        const unroundedTaxScale8 = unroundedTaxRaw / 100n;

        const componentTaxDec = ExactDecimal.halfEvenRound(unroundedTaxScale8, 8, 2);
        componentsResult.push({
          rateType: rateDTO.rateType,
          ratePercent: rateDTO.ratePercent,
          taxAmount: componentTaxDec.toString()
        });

        totalTaxDec = totalTaxDec.add(componentTaxDec);
      }

      totalDec = taxableDec.add(totalTaxDec);
    } 
    // 6. Inclusive Tax Calculation
    else {
      totalDec = parsedAmount;

      // Sum all component rate percents to find total applicable rate
      let totalRateScale6 = 0n;
      const rateBigInts: bigint[] = [];

      for (const rateDTO of applicableRates) {
        if (!rateDTO.ratePercent || !/^\d+(\.\d+)?$/.test(rateDTO.ratePercent.trim())) {
          throw new ValidationError(`Invalid tax rate percentage string: '${rateDTO.ratePercent}'.`);
        }
        const cleanRateStr = rateDTO.ratePercent.trim();
        const parts = cleanRateStr.split('.');
        const intPart = parts[0]!;
        const decPart = (parts[1] || '').padEnd(6, '0').slice(0, 6);
        const rBig = BigInt(intPart + decPart);
        rateBigInts.push(rBig);
        totalRateScale6 += rBig;
      }

      // TotalRateFactor = 100 + TotalRate (in scale 6)
      const hundredScale6 = 100_000_000n;
      const totalRateFactorScale6 = hundredScale6 + totalRateScale6; // scale 6

      // Component Tax = (TotalInclusive * ComponentRate) / (100 + TotalRate)
      // TotalInclusive.rawBigInt (scale 2). ComponentRate (scale 6).
      // Numerator = TotalInclusive.rawBigInt * ComponentRate * 10^8 (for scale 10 precision)
      for (let i = 0; i < applicableRates.length; i++) {
        const rateDTO = applicableRates[i]!;
        const rateBigInt = rateBigInts[i]!;

        const numerator = totalDec.rawBigInt * rateBigInt * 100_000_000n; // scale 2 + 6 + 8 = 16
        const unroundedComponentTaxScale10 = numerator / totalRateFactorScale6; // scale 16 - 6 = 10

        const componentTaxDec = ExactDecimal.halfEvenRound(unroundedComponentTaxScale10, 10, 2);
        componentsResult.push({
          rateType: rateDTO.rateType,
          ratePercent: rateDTO.ratePercent,
          taxAmount: componentTaxDec.toString()
        });

        totalTaxDec = totalTaxDec.add(componentTaxDec);
      }

      taxableDec = totalDec.sub(totalTaxDec);
    }

    // 7. Invariants Assertion
    if (!totalDec.equals(taxableDec.add(totalTaxDec))) {
      throw new BusinessRuleViolationError('Tax calculation invariant failed: totalAmount != taxableAmount + totalTaxAmount');
    }

    const result: TaxCalculationResult = {
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      transactionDate: treatment.transactionDate,
      taxableAmount: taxableDec.toString(),
      taxability: treatment.taxability,
      calculationMode: params.calculationMode,
      components: componentsResult,
      totalTaxAmount: totalTaxDec.toString(),
      totalAmount: totalDec.toString()
    };

    logger.info(
      {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        calculationMode: params.calculationMode,
        taxableAmount: result.taxableAmount,
        totalTaxAmount: result.totalTaxAmount,
        totalAmount: result.totalAmount
      },
      '[TAX_CALCULATION] Completed Tax Calculation'
    );

    return result;
  }
}

export const taxCalculationService = new TaxCalculationService();
