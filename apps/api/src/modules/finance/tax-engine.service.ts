import {
  RequestContext,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  BusinessRuleViolationError,
  ConflictError
} from '@general-erp/core';
import { logger } from '../../config/logger.js';

export type TaxComponentType = 'CGST' | 'SGST' | 'IGST' | 'UTGST' | 'CESS';
export type TaxabilityType = 'TAXABLE' | 'EXEMPT' | 'NIL_RATED' | 'NON_GST';
export type HSNSACClassificationType = 'HSN' | 'SAC';
export type SupplyNatureType = 'INTRA_STATE' | 'INTER_STATE';
export type TerritoryType = 'STATE' | 'UT_WITH_LEGISLATURE' | 'UT_WITHOUT_LEGISLATURE' | 'OTHER_TERRITORY';
export type PlaceOfSupplySource = 'DERIVED' | 'EXPLICIT' | 'SPECIAL_RULE';

export interface IndianTerritory {
  code: string;
  name: string;
  territoryType: TerritoryType;
  validFrom: string;    // SQL DATE "YYYY-MM-DD"
  validTo?: string | null; // NULL = open-ended / active
  isCurrent: boolean;
}

export const INDIAN_TERRITORY_REGISTRY: IndianTerritory[] = [
  { code: '01', name: 'Jammu and Kashmir', territoryType: 'UT_WITH_LEGISLATURE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '02', name: 'Himachal Pradesh', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '03', name: 'Punjab', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '04', name: 'Chandigarh', territoryType: 'UT_WITHOUT_LEGISLATURE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '05', name: 'Uttarakhand', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '06', name: 'Haryana', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '07', name: 'Delhi', territoryType: 'UT_WITH_LEGISLATURE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '08', name: 'Rajasthan', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '09', name: 'Uttar Pradesh', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '10', name: 'Bihar', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '11', name: 'Sikkim', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '12', name: 'Arunachal Pradesh', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '13', name: 'Nagaland', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '14', name: 'Manipur', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '15', name: 'Mizoram', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '16', name: 'Tripura', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '17', name: 'Meghalaya', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '18', name: 'Assam', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '19', name: 'West Bengal', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '20', name: 'Jharkhand', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '21', name: 'Odisha', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '22', name: 'Chhattisgarh', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '23', name: 'Madhya Pradesh', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '24', name: 'Gujarat', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  // Historical Daman and Diu territory code (valid until 2020-01-25)
  { code: '25', name: 'Daman and Diu', territoryType: 'UT_WITHOUT_LEGISLATURE', validFrom: '2017-07-01', validTo: '2020-01-25', isCurrent: false },
  // Historical Dadra and Nagar Haveli territory code (valid until 2020-01-25)
  { code: '26', name: 'Dadra and Nagar Haveli', territoryType: 'UT_WITHOUT_LEGISLATURE', validFrom: '2017-07-01', validTo: '2020-01-25', isCurrent: false },
  // Unified Dadra and Nagar Haveli and Daman and Diu territory code (effective 2020-01-26)
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu', territoryType: 'UT_WITHOUT_LEGISLATURE', validFrom: '2020-01-26', validTo: null, isCurrent: true },
  { code: '27', name: 'Maharashtra', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '28', name: 'Andhra Pradesh (Old)', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '29', name: 'Karnataka', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '30', name: 'Goa', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '31', name: 'Lakshadweep', territoryType: 'UT_WITHOUT_LEGISLATURE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '32', name: 'Kerala', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '33', name: 'Tamil Nadu', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '34', name: 'Puducherry', territoryType: 'UT_WITH_LEGISLATURE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '35', name: 'Andaman and Nicobar Islands', territoryType: 'UT_WITHOUT_LEGISLATURE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '36', name: 'Telangana', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '37', name: 'Andhra Pradesh (New)', territoryType: 'STATE', validFrom: '2017-07-01', validTo: null, isCurrent: true },
  { code: '38', name: 'Ladakh', territoryType: 'UT_WITHOUT_LEGISLATURE', validFrom: '2019-10-31', validTo: null, isCurrent: true },
  { code: '97', name: 'Other Territory / Special Zone', territoryType: 'OTHER_TERRITORY', validFrom: '2017-07-01', validTo: null, isCurrent: true }
];

export const INDIAN_STATES_AND_UTS: Record<string, { name: string; territoryType: TerritoryType }> = {};
for (const entry of INDIAN_TERRITORY_REGISTRY) {
  if (entry.isCurrent) {
    INDIAN_STATES_AND_UTS[entry.code] = {
      name: entry.name,
      territoryType: entry.territoryType
    };
  }
}

export interface TaxCategoryDTO {
  id: string;
  tenantId: string;
  companyId: string;
  code: string;
  name: string;
  description?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: Date;
  updatedAt: Date;
}

export interface HSNSACDTO {
  id: string;
  tenantId: string;
  companyId: string;
  code: string;
  description: string;
  type: HSNSACClassificationType;
  defaultTaxCategoryId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaxRateDTO {
  id: string;
  tenantId: string;
  companyId: string;
  taxCategoryId: string;
  rateType: TaxComponentType;
  ratePercent: string; // High-precision exact decimal string numeric(9,6)
  validFrom: string;   // SQL DATE "YYYY-MM-DD"
  validTo?: string | null; // NULL = open-ended
  createdAt: Date;
  updatedAt: Date;
}

export interface TaxRuleDTO {
  id: string;
  tenantId: string;
  companyId: string;
  taxCategoryId?: string | null;
  hsnSacCodeId?: string | null;
  supplyType: string;
  taxability: TaxabilityType;
  isRcm: boolean;
  isSez: boolean;
  priority: number;
  status: 'ACTIVE' | 'INACTIVE';
  validFrom: string;
  validTo?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResolveTaxRulesParams {
  taxCategoryId?: string | undefined;
  hsnSacCodeId?: string | undefined;
  supplyType?: string | undefined;
  transactionDate: string; // SQL DATE "YYYY-MM-DD"
}

export interface ResolveTaxMatrixRequest {
  companyId: string;
  transactionDate: string; // SQL DATE "YYYY-MM-DD"
  hsnSacCode?: string | undefined;
  hsnSacType?: HSNSACClassificationType | undefined;
  taxCategoryId?: string | undefined; // Optional explicit category
  supplyType?: string | undefined;
}

export interface TaxMatrixResolutionResult {
  tenantId: string;
  companyId: string;
  transactionDate: string;
  hsnSac?: {
    id: string;
    code: string;
    type: HSNSACClassificationType;
    description: string;
  } | undefined;
  taxCategory: {
    id: string;
    code: string;
    name: string;
    description?: string | undefined;
  };
  rates: Array<{
    id: string;
    rateType: TaxComponentType;
    ratePercent: string; // Preserved numeric(9,6) string
    validFrom: string;
    validTo?: string | null | undefined;
  }>;
  taxRule?: {
    id: string;
    taxability: TaxabilityType;
    supplyType: string;
    isRcm: boolean;
    isSez: boolean;
    priority: number;
  } | undefined;
}

export interface ResolvePlaceOfSupplyParams {
  supplierStateCode: string;
  recipientStateCode?: string | undefined;
  placeOfSupplyStateCode?: string | undefined; // Explicit PoS override
  isSez?: boolean | undefined;
  isDeemedExport?: boolean | undefined;
  isImport?: boolean | undefined;
  transactionDate?: string | undefined;
}

export interface PlaceOfSupplyEvaluationResult {
  supplierStateCode: string;
  supplierTerritoryType: TerritoryType;
  recipientStateCode: string;
  recipientTerritoryType: TerritoryType;
  placeOfSupplyStateCode: string;
  placeOfSupplyTerritoryType: TerritoryType;
  posSource: PlaceOfSupplySource;
  supplyNature: SupplyNatureType;
  isUtgstApplicable: boolean;
  isSez: boolean;
  isDeemedExport: boolean;
  isImport: boolean;
}

export interface ResolveTaxTreatmentRequest extends ResolveTaxMatrixRequest, Omit<ResolvePlaceOfSupplyParams, 'transactionDate'> {
  transactionDate: string;
}

export interface TaxTreatmentResolutionResult {
  tenantId: string;
  companyId: string;
  transactionDate: string;
  placeOfSupply: PlaceOfSupplyEvaluationResult;
  taxability: TaxabilityType;
  isRcm: boolean;
  isSez: boolean;
  hsnSac?: {
    id: string;
    code: string;
    type: HSNSACClassificationType;
    description: string;
  } | undefined;
  taxCategory: {
    id: string;
    code: string;
    name: string;
    description?: string | undefined;
  };
  applicableComponentTypes: TaxComponentType[];
  rates: Array<{
    id: string;
    rateType: TaxComponentType;
    ratePercent: string; // Preserved numeric(9,6) exact decimal string
    validFrom: string;
    validTo?: string | null | undefined;
  }>;
  taxRule?: {
    id: string;
    taxability: TaxabilityType;
    supplyType: string;
    isRcm: boolean;
    isSez: boolean;
    priority: number;
  } | undefined;
}

export interface CreateTaxCategoryInput {
  id?: string | undefined;
  companyId: string;
  code: string;
  name: string;
  description?: string | undefined;
  status?: 'ACTIVE' | 'INACTIVE' | undefined;
}

export interface CreateHSNSACInput {
  id?: string | undefined;
  companyId: string;
  code: string;
  description: string;
  type: HSNSACClassificationType;
  defaultTaxCategoryId?: string | undefined;
}

export interface CreateTaxRateInput {
  id?: string | undefined;
  companyId: string;
  taxCategoryId: string;
  rateType: TaxComponentType;
  ratePercent: string;
  validFrom: string;
  validTo?: string | null | undefined;
}

export interface CreateTaxRuleInput {
  id?: string | undefined;
  companyId: string;
  taxCategoryId?: string | undefined;
  hsnSacCodeId?: string | undefined;
  supplyType?: string | undefined;
  taxability?: TaxabilityType | undefined;
  isRcm?: boolean | undefined;
  isSez?: boolean | undefined;
  priority?: number | undefined;
  status?: 'ACTIVE' | 'INACTIVE' | undefined;
  validFrom: string;
  validTo?: string | null | undefined;
}

export class TaxEngineService {
  private categoriesStore = new Map<string, TaxCategoryDTO>();
  private hsnSacStore = new Map<string, HSNSACDTO>();
  private ratesStore = new Map<string, TaxRateDTO>();
  private rulesStore = new Map<string, TaxRuleDTO>();

  /**
   * Resets all in-memory configuration stores (primarily for tests & clean setups).
   */
  public clear(): void {
    this.categoriesStore.clear();
    this.hsnSacStore.clear();
    this.ratesStore.clear();
    this.rulesStore.clear();
  }

  // --- State Code & Territory Resolution ---

  public resolveTerritory(stateCode: string, transactionDate?: string): IndianTerritory {
    if (!stateCode || typeof stateCode !== 'string') {
      throw new ValidationError('State code is missing or invalid.');
    }
    const formattedCode = stateCode.padStart(2, '0');
    const matches = INDIAN_TERRITORY_REGISTRY.filter(t => t.code === formattedCode);

    if (matches.length === 0) {
      throw new ValidationError(`Invalid Indian State/UT code '${stateCode}'. Must be a valid 2-digit GST state code.`);
    }

    if (transactionDate) {
      this.validateDateString(transactionDate, 'transactionDate');
      const validEntry = matches.find(
        t => t.validFrom <= transactionDate && (t.validTo === null || t.validTo === undefined || t.validTo >= transactionDate)
      );
      if (!validEntry) {
        throw new ValidationError(`GST state code '${stateCode}' is not valid on transaction date '${transactionDate}'.`);
      }
      return validEntry;
    }

    const currentEntry = matches.find(t => t.isCurrent) || matches[matches.length - 1]!;
    return currentEntry;
  }

  public validateStateCode(stateCode: string, fieldName: string, transactionDate?: string): string {
    if (!stateCode || typeof stateCode !== 'string') {
      throw new ValidationError(`Required state code field '${fieldName}' is missing or empty.`);
    }

    const formattedCode = stateCode.padStart(2, '0');
    const matches = INDIAN_TERRITORY_REGISTRY.filter(t => t.code === formattedCode);

    if (matches.length === 0) {
      throw new ValidationError(`Invalid Indian State/UT code '${stateCode}' for field '${fieldName}'. Must be a valid 2-digit GST state code.`);
    }

    if (transactionDate) {
      this.validateDateString(transactionDate, 'transactionDate');
      const validEntry = matches.find(
        t => t.validFrom <= transactionDate && (t.validTo === null || t.validTo === undefined || t.validTo >= transactionDate)
      );
      if (!validEntry) {
        throw new ValidationError(`GST state code '${stateCode}' for field '${fieldName}' is not valid on transaction date '${transactionDate}'.`);
      }
    }

    return formattedCode;
  }

  // --- Place of Supply Evaluation ---

  public resolvePlaceOfSupply(params: ResolvePlaceOfSupplyParams): PlaceOfSupplyEvaluationResult {
    const supplierStateCode = this.validateStateCode(params.supplierStateCode, 'supplierStateCode', params.transactionDate);

    let recipientStateCode: string;
    if (params.recipientStateCode) {
      recipientStateCode = this.validateStateCode(params.recipientStateCode, 'recipientStateCode', params.transactionDate);
    } else {
      recipientStateCode = supplierStateCode;
    }

    let placeOfSupplyStateCode: string;
    if (params.placeOfSupplyStateCode) {
      placeOfSupplyStateCode = this.validateStateCode(params.placeOfSupplyStateCode, 'placeOfSupplyStateCode', params.transactionDate);
    } else {
      placeOfSupplyStateCode = recipientStateCode;
    }

    const supplierStateInfo = this.resolveTerritory(supplierStateCode, params.transactionDate);
    const recipientStateInfo = this.resolveTerritory(recipientStateCode, params.transactionDate);
    const posStateInfo = this.resolveTerritory(placeOfSupplyStateCode, params.transactionDate);

    const isSez = params.isSez === true;
    const isDeemedExport = params.isDeemedExport === true;
    const isImport = params.isImport === true;

    // Determine PoS Derivation Source
    let posSource: PlaceOfSupplySource;
    if (params.placeOfSupplyStateCode) {
      posSource = 'EXPLICIT';
    } else if (isSez || isImport) {
      posSource = 'SPECIAL_RULE';
    } else {
      posSource = 'DERIVED';
    }

    // Supply Nature determination:
    // SEZ supplies and Imports force INTER_STATE per statutory special rules.
    // Deemed Exports do NOT independently force INTER_STATE (supply nature depends on location/PoS).
    let supplyNature: SupplyNatureType;
    if (isSez || isImport) {
      supplyNature = 'INTER_STATE';
    } else if (supplierStateCode === placeOfSupplyStateCode) {
      supplyNature = 'INTRA_STATE';
    } else {
      supplyNature = 'INTER_STATE';
    }

    // Determine if UTGST applies (for Intra-state supplies where supplier territory is UT_WITHOUT_LEGISLATURE or OTHER_TERRITORY)
    const isUtgstApplicable = supplyNature === 'INTRA_STATE' &&
      (supplierStateInfo.territoryType === 'UT_WITHOUT_LEGISLATURE' || supplierStateInfo.territoryType === 'OTHER_TERRITORY');

    return {
      supplierStateCode,
      supplierTerritoryType: supplierStateInfo.territoryType,
      recipientStateCode,
      recipientTerritoryType: recipientStateInfo.territoryType,
      placeOfSupplyStateCode,
      placeOfSupplyTerritoryType: posStateInfo.territoryType,
      posSource,
      supplyNature,
      isUtgstApplicable,
      isSez,
      isDeemedExport,
      isImport
    };
  }

  // --- Configuration Seeders / Creators ---

  public async createTaxCategory(ctx: RequestContext, input: CreateTaxCategoryInput): Promise<TaxCategoryDTO> {
    if (input.companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match request companyId');
    }
    if (!input.code || !input.name) {
      throw new ValidationError('Tax Category code and name are required.');
    }

    // Check code uniqueness within tenant + company
    const existing = Array.from(this.categoriesStore.values()).find(
      c => c.tenantId === ctx.tenantId && c.companyId === ctx.companyId && c.code.toUpperCase() === input.code.toUpperCase()
    );
    if (existing) {
      throw new ConflictError(`Tax category code '${input.code}' already exists for this company.`);
    }

    const id = input.id || `tax_cat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const category: TaxCategoryDTO = {
      id,
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      code: input.code.toUpperCase(),
      name: input.name,
      description: input.description || null,
      status: input.status || 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.categoriesStore.set(id, category);
    logger.info({ tenantId: ctx.tenantId, companyId: ctx.companyId, categoryId: id }, '[TAX_ENGINE] Created Tax Category');
    return category;
  }

  public async createHSNSAC(ctx: RequestContext, input: CreateHSNSACInput): Promise<HSNSACDTO> {
    if (input.companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match request companyId');
    }
    if (!input.code || !input.description || !input.type) {
      throw new ValidationError('HSN/SAC code, description, and type are required.');
    }
    if (input.type !== 'HSN' && input.type !== 'SAC') {
      throw new ValidationError("HSN/SAC type must be 'HSN' or 'SAC'.");
    }

    // Validate default tax category composite ownership if provided
    if (input.defaultTaxCategoryId) {
      const category = this.categoriesStore.get(input.defaultTaxCategoryId);
      if (!category || category.tenantId !== ctx.tenantId || category.companyId !== ctx.companyId) {
        throw new NotFoundError('Tax Category', input.defaultTaxCategoryId);
      }
    }

    const existing = Array.from(this.hsnSacStore.values()).find(
      h => h.tenantId === ctx.tenantId && h.companyId === ctx.companyId && h.code === input.code && h.type === input.type
    );
    if (existing) {
      throw new ConflictError(`HSN/SAC code '${input.code}' of type '${input.type}' already exists for this company.`);
    }

    const id = input.id || `hsn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const record: HSNSACDTO = {
      id,
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      code: input.code,
      description: input.description,
      type: input.type,
      defaultTaxCategoryId: input.defaultTaxCategoryId || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.hsnSacStore.set(id, record);
    logger.info({ tenantId: ctx.tenantId, companyId: ctx.companyId, hsnSacId: id }, '[TAX_ENGINE] Created HSN/SAC Code');
    return record;
  }

  public async createTaxRate(ctx: RequestContext, input: CreateTaxRateInput): Promise<TaxRateDTO> {
    if (input.companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match request companyId');
    }
    const category = this.categoriesStore.get(input.taxCategoryId);
    if (!category || category.tenantId !== ctx.tenantId || category.companyId !== ctx.companyId) {
      throw new NotFoundError('Tax Category', input.taxCategoryId);
    }

    const validRateTypes: TaxComponentType[] = ['CGST', 'SGST', 'IGST', 'UTGST', 'CESS'];
    if (!validRateTypes.includes(input.rateType)) {
      throw new ValidationError(`Invalid rateType '${input.rateType}'. Allowed: ${validRateTypes.join(', ')}.`);
    }

    this.validateDateString(input.validFrom, 'validFrom');
    if (input.validTo) {
      this.validateDateString(input.validTo, 'validTo');
      if (input.validTo < input.validFrom) {
        throw new ValidationError('validTo date cannot be earlier than validFrom date.');
      }
    }

    // Check temporal overlap against existing rates for same (tenantId, companyId, taxCategoryId, rateType)
    const existingRates = Array.from(this.ratesStore.values()).filter(
      r => r.tenantId === ctx.tenantId && r.companyId === ctx.companyId && r.taxCategoryId === input.taxCategoryId && r.rateType === input.rateType
    );

    for (const existing of existingRates) {
      if (this.datesOverlap(existing.validFrom, existing.validTo || null, input.validFrom, input.validTo || null)) {
        throw new ConflictError(
          `Overlapping rate configuration for rateType '${input.rateType}' and category '${category.code}'. ` +
          `Existing period [${existing.validFrom} to ${existing.validTo || 'open-ended'}] overlaps with new period [${input.validFrom} to ${input.validTo || 'open-ended'}].`
        );
      }
    }

    const id = input.id || `rate_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const rate: TaxRateDTO = {
      id,
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      taxCategoryId: input.taxCategoryId,
      rateType: input.rateType,
      ratePercent: input.ratePercent,
      validFrom: input.validFrom,
      validTo: input.validTo || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.ratesStore.set(id, rate);
    logger.info({ tenantId: ctx.tenantId, companyId: ctx.companyId, rateId: id }, '[TAX_ENGINE] Created Tax Rate');
    return rate;
  }

  public async createTaxRule(ctx: RequestContext, input: CreateTaxRuleInput): Promise<TaxRuleDTO> {
    if (input.companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match request companyId');
    }
    if (input.taxCategoryId) {
      const category = this.categoriesStore.get(input.taxCategoryId);
      if (!category || category.tenantId !== ctx.tenantId || category.companyId !== ctx.companyId) {
        throw new NotFoundError('Tax Category', input.taxCategoryId);
      }
    }
    if (input.hsnSacCodeId) {
      const hsn = this.hsnSacStore.get(input.hsnSacCodeId);
      if (!hsn || hsn.tenantId !== ctx.tenantId || hsn.companyId !== ctx.companyId) {
        throw new NotFoundError('HSN/SAC Code', input.hsnSacCodeId);
      }
    }

    this.validateDateString(input.validFrom, 'validFrom');
    if (input.validTo) {
      this.validateDateString(input.validTo, 'validTo');
      if (input.validTo < input.validFrom) {
        throw new ValidationError('validTo date cannot be earlier than validFrom date.');
      }
    }

    const id = input.id || `rule_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const rule: TaxRuleDTO = {
      id,
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      taxCategoryId: input.taxCategoryId || null,
      hsnSacCodeId: input.hsnSacCodeId || null,
      supplyType: input.supplyType || 'ALL',
      taxability: input.taxability || 'TAXABLE',
      isRcm: input.isRcm || false,
      isSez: input.isSez || false,
      priority: input.priority ?? 10,
      status: input.status || 'ACTIVE',
      validFrom: input.validFrom,
      validTo: input.validTo || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.rulesStore.set(id, rule);
    logger.info({ tenantId: ctx.tenantId, companyId: ctx.companyId, ruleId: id }, '[TAX_ENGINE] Created Tax Rule');
    return rule;
  }

  // --- Core Resolution Operations ---

  public async resolveHSNSAC(ctx: RequestContext, code: string, type?: HSNSACClassificationType): Promise<HSNSACDTO> {
    if (!code) {
      throw new ValidationError('HSN/SAC code is required for resolution.');
    }

    const record = Array.from(this.hsnSacStore.values()).find(
      h => h.tenantId === ctx.tenantId &&
           h.companyId === ctx.companyId &&
           h.code === code &&
           (!type || h.type === type)
    );

    if (!record) {
      throw new NotFoundError('HSN/SAC Code', code);
    }

    return record;
  }

  public async resolveTaxCategory(ctx: RequestContext, identifier: string): Promise<TaxCategoryDTO> {
    if (!identifier) {
      throw new ValidationError('Tax Category identifier is required for resolution.');
    }

    const category = Array.from(this.categoriesStore.values()).find(
      c => c.tenantId === ctx.tenantId &&
           c.companyId === ctx.companyId &&
           (c.id === identifier || c.code.toUpperCase() === identifier.toUpperCase())
    );

    if (!category) {
      throw new NotFoundError('Tax Category', identifier);
    }

    return category;
  }

  public async resolveTaxRates(ctx: RequestContext, taxCategoryId: string, transactionDate: string): Promise<TaxRateDTO[]> {
    this.validateDateString(transactionDate, 'transactionDate');
    await this.resolveTaxCategory(ctx, taxCategoryId);

    const matchingRates = Array.from(this.ratesStore.values()).filter(r => {
      if (r.tenantId !== ctx.tenantId || r.companyId !== ctx.companyId || r.taxCategoryId !== taxCategoryId) {
        return false;
      }
      return r.validFrom <= transactionDate && (r.validTo === null || r.validTo === undefined || r.validTo >= transactionDate);
    });

    const ratesByType = new Map<TaxComponentType, TaxRateDTO[]>();
    for (const rate of matchingRates) {
      const list = ratesByType.get(rate.rateType) || [];
      list.push(rate);
      ratesByType.set(rate.rateType, list);
    }

    for (const [rateType, list] of ratesByType.entries()) {
      if (list.length > 1) {
        throw new ConflictError(
          `TAX_CONFIGURATION_CONFLICT: Multiple overlapping tax rates found for rate_type '${rateType}' ` +
          `and category '${taxCategoryId}' on date '${transactionDate}'.`
        );
      }
    }

    const rateTypeOrder: Record<TaxComponentType, number> = {
      CGST: 1,
      SGST: 2,
      IGST: 3,
      UTGST: 4,
      CESS: 5
    };

    return matchingRates.sort((a, b) => rateTypeOrder[a.rateType] - rateTypeOrder[b.rateType]);
  }

  public async resolveTaxRules(ctx: RequestContext, params: ResolveTaxRulesParams): Promise<TaxRuleDTO[]> {
    this.validateDateString(params.transactionDate, 'transactionDate');

    const activeRules = Array.from(this.rulesStore.values()).filter(r => {
      if (r.tenantId !== ctx.tenantId || r.companyId !== ctx.companyId || r.status !== 'ACTIVE') {
        return false;
      }
      if (r.validFrom > params.transactionDate || (r.validTo && r.validTo < params.transactionDate)) {
        return false;
      }
      if (r.taxCategoryId && params.taxCategoryId && r.taxCategoryId !== params.taxCategoryId) {
        return false;
      }
      if (r.hsnSacCodeId && params.hsnSacCodeId && r.hsnSacCodeId !== params.hsnSacCodeId) {
        return false;
      }
      if (r.supplyType && r.supplyType !== 'ALL' && params.supplyType && r.supplyType !== params.supplyType) {
        return false;
      }
      return true;
    });

    const scoredRules = activeRules.map(rule => {
      let specificityScore = 0;
      if (rule.hsnSacCodeId) specificityScore += 2;
      if (rule.taxCategoryId) specificityScore += 1;
      if (rule.supplyType && rule.supplyType !== 'ALL') specificityScore += 1;
      return { rule, specificityScore };
    });

    scoredRules.sort((a, b) => {
      if (a.rule.priority !== b.rule.priority) {
        return a.rule.priority - b.rule.priority;
      }
      return b.specificityScore - a.specificityScore;
    });

    const sortedRules = scoredRules.map(sr => sr.rule);

    if (scoredRules.length >= 2 && scoredRules[0] && scoredRules[1]) {
      const firstScored = scoredRules[0];
      const secondScored = scoredRules[1];
      if (
        firstScored.rule.priority === secondScored.rule.priority &&
        firstScored.specificityScore === secondScored.specificityScore
      ) {
        if (
          firstScored.rule.taxability !== secondScored.rule.taxability ||
          firstScored.rule.isRcm !== secondScored.rule.isRcm
        ) {
          throw new ConflictError(
            `TAX_CONFIGURATION_CONFLICT: Ambiguous conflicting tax rules with equal priority (${firstScored.rule.priority}) ` +
            `resolved for date '${params.transactionDate}'.`
          );
        }
      }
    }

    return sortedRules;
  }

  public async resolveTaxMatrix(ctx: RequestContext, request: ResolveTaxMatrixRequest): Promise<TaxMatrixResolutionResult> {
    if (request.companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match request companyId');
    }
    this.validateDateString(request.transactionDate, 'transactionDate');

    let resolvedHsn: HSNSACDTO | undefined;
    let resolvedCategory: TaxCategoryDTO | undefined;

    if (request.taxCategoryId) {
      resolvedCategory = await this.resolveTaxCategory(ctx, request.taxCategoryId);
      if (request.hsnSacCode) {
        try {
          resolvedHsn = await this.resolveHSNSAC(ctx, request.hsnSacCode, request.hsnSacType);
        } catch (e) {
          logger.warn({ hsnSacCode: request.hsnSacCode }, '[TAX_ENGINE] Optional HSN resolution did not match');
        }
      }
    } else if (request.hsnSacCode) {
      resolvedHsn = await this.resolveHSNSAC(ctx, request.hsnSacCode, request.hsnSacType);
      if (resolvedHsn.defaultTaxCategoryId) {
        resolvedCategory = await this.resolveTaxCategory(ctx, resolvedHsn.defaultTaxCategoryId);
      } else {
        throw new BusinessRuleViolationError(
          `Tax category could not be resolved. HSN/SAC code '${request.hsnSacCode}' has no default tax category ` +
          `and no explicit taxCategoryId was provided.`
        );
      }
    } else {
      throw new BusinessRuleViolationError(
        'Tax category could not be resolved. Explicit taxCategoryId or HSN/SAC code is required.'
      );
    }

    const rates = await this.resolveTaxRates(ctx, resolvedCategory.id, request.transactionDate);

    const rules = await this.resolveTaxRules(ctx, {
      taxCategoryId: resolvedCategory.id,
      hsnSacCodeId: resolvedHsn ? resolvedHsn.id : undefined,
      supplyType: request.supplyType,
      transactionDate: request.transactionDate
    });

    const topRule = rules[0] || undefined;

    const result: TaxMatrixResolutionResult = {
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      transactionDate: request.transactionDate,
      taxCategory: {
        id: resolvedCategory.id,
        code: resolvedCategory.code,
        name: resolvedCategory.name,
        ...(resolvedCategory.description ? { description: resolvedCategory.description } : {})
      },
      rates: rates.map(r => ({
        id: r.id,
        rateType: r.rateType,
        ratePercent: r.ratePercent,
        validFrom: r.validFrom,
        validTo: r.validTo || null
      }))
    };

    if (resolvedHsn) {
      result.hsnSac = {
        id: resolvedHsn.id,
        code: resolvedHsn.code,
        type: resolvedHsn.type,
        description: resolvedHsn.description
      };
    }

    if (topRule) {
      result.taxRule = {
        id: topRule.id,
        taxability: topRule.taxability,
        supplyType: topRule.supplyType,
        isRcm: topRule.isRcm,
        isSez: topRule.isSez,
        priority: topRule.priority
      };
    }

    return result;
  }

  // --- Phase 2.5.2 Place of Supply & Taxability Treatment Entry Point ---

  public async resolveTaxTreatment(ctx: RequestContext, request: ResolveTaxTreatmentRequest): Promise<TaxTreatmentResolutionResult> {
    if (request.companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match request companyId');
    }

    // 1. Evaluate Place of Supply & Supply Nature
    const poSResult = this.resolvePlaceOfSupply({
      supplierStateCode: request.supplierStateCode,
      recipientStateCode: request.recipientStateCode,
      placeOfSupplyStateCode: request.placeOfSupplyStateCode,
      isSez: request.isSez,
      isDeemedExport: request.isDeemedExport,
      isImport: request.isImport
    });

    // 2. Resolve Tax Matrix using resolved supplyNature
    const matrix = await this.resolveTaxMatrix(ctx, {
      ...request,
      supplyType: poSResult.supplyNature
    });

    // 3. Determine Applicable Statutory Tax Component Types
    let applicableComponentTypes: TaxComponentType[];
    if (poSResult.supplyNature === 'INTRA_STATE') {
      if (poSResult.isUtgstApplicable) {
        applicableComponentTypes = ['CGST', 'UTGST', 'CESS'];
      } else {
        applicableComponentTypes = ['CGST', 'SGST', 'CESS'];
      }
    } else {
      applicableComponentTypes = ['IGST', 'CESS'];
    }

    // 4. Filter Rate Components to Applicable Types
    const applicableRates = matrix.rates.filter(r => applicableComponentTypes.includes(r.rateType));

    // 5. Determine Taxability Classification & Metadata Flags from Resolved Rule
    const taxability: TaxabilityType = matrix.taxRule ? matrix.taxRule.taxability : 'TAXABLE';
    const isRcm: boolean = matrix.taxRule ? matrix.taxRule.isRcm : false;
    const isSez: boolean = poSResult.isSez || (matrix.taxRule ? matrix.taxRule.isSez : false);

    const result: TaxTreatmentResolutionResult = {
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      transactionDate: request.transactionDate,
      placeOfSupply: poSResult,
      taxability,
      isRcm,
      isSez,
      taxCategory: matrix.taxCategory,
      applicableComponentTypes,
      rates: applicableRates
    };

    if (matrix.hsnSac) {
      result.hsnSac = matrix.hsnSac;
    }

    if (matrix.taxRule) {
      result.taxRule = matrix.taxRule;
    }

    return result;
  }

  // --- Internal Utilities ---

  private validateDateString(dateStr: string, fieldName: string): void {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new ValidationError(`Invalid date format for ${fieldName}: '${dateStr}'. Must be SQL DATE 'YYYY-MM-DD'.`);
    }
  }

  private datesOverlap(start1: string, end1: string | null, start2: string, end2: string | null): boolean {
    const e1 = end1 || '9999-12-31';
    const e2 = end2 || '9999-12-31';
    return start1 <= e2 && start2 <= e1;
  }
}

export const taxEngineService = new TaxEngineService();
