import {
  RequestContext,
  ValidationError,
  ForbiddenError,
  ConflictError
} from '@general-erp/core';
import { auditService } from '../../platform/audit/audit.service.js';
import { productService } from './product.service.js';
import { getDb, pricingLists, pricingRules, pricingQuantityTiers, eq, and } from '@general-erp/database';

export interface PricingListDTO {
  id: string;
  tenantId: string;
  companyId: string;
  code: string;
  name: string;
  pricingType: string; // 'SALES' | 'PURCHASE'
  currency: string;
  effectiveFrom: string; // "YYYY-MM-DD"
  effectiveTo?: string | null;
  isActive: boolean;
  description?: string | null;
  createdAt: Date;
}

export interface PricingRuleDTO {
  id: string;
  tenantId: string;
  companyId: string;
  pricingListId?: string | null;
  productId: string;
  customerId?: string | null;
  supplierId?: string | null;
  unitPrice: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  minQuantity: string;
  isActive: boolean;
  createdAt: Date;
  tiers?: PricingQuantityTierDTO[];
}

export interface PricingQuantityTierDTO {
  id: string;
  tenantId: string;
  companyId: string;
  pricingRuleId: string;
  minQuantity: string;
  maxQuantity?: string | null;
  unitPrice: string;
  discountPercent: string;
  createdAt: Date;
}

export interface ResolvePriceParams {
  companyId: string;
  productId: string;
  customerId?: string;
  supplierId?: string;
  pricingType?: 'SALES' | 'PURCHASE';
  quantity?: number | string;
  currency?: string;
  effectiveDate?: string; // "YYYY-MM-DD", defaults to today
}

export interface ResolvedPriceResult {
  unitPrice: string;
  currency: string;
  source: 'ENTITY_OVERRIDE' | 'PRICE_LIST' | 'VOLUME_TIER' | 'PRODUCT_DEFAULT';
  ruleId?: string | null;
  pricingListId?: string | null;
  appliedTier?: {
    minQuantity: string;
    maxQuantity?: string | null;
    discountPercent: string;
  } | null;
}

export interface CreatePricingListInput {
  id?: string;
  companyId: string;
  code: string;
  name: string;
  pricingType?: 'SALES' | 'PURCHASE';
  currency?: string;
  effectiveFrom: string;
  effectiveTo?: string;
  description?: string;
}

export interface CreatePricingRuleInput {
  id?: string;
  companyId: string;
  pricingListId?: string;
  productId: string;
  customerId?: string;
  supplierId?: string;
  unitPrice: number | string;
  currency?: string;
  effectiveFrom: string;
  effectiveTo?: string;
  minQuantity?: number | string;
  tiers?: Array<{
    minQuantity: number | string;
    maxQuantity?: number | string;
    unitPrice: number | string;
    discountPercent?: number | string;
  }>;
}

export class PricingService {
  private listsMemoryStore = new Map<string, PricingListDTO>();
  private rulesMemoryStore = new Map<string, PricingRuleDTO>();

  // --- Pricing Lists ---

  async createPricingList(ctx: RequestContext, input: CreatePricingListInput): Promise<PricingListDTO> {
    if (input.companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match request companyId');
    }
    if (!input.code || !input.code.trim()) {
      throw new ValidationError('Pricing list code is required.');
    }
    if (!input.name || !input.name.trim()) {
      throw new ValidationError('Pricing list name is required.');
    }
    if (!input.effectiveFrom) {
      throw new ValidationError('effectiveFrom date is required.');
    }

    const codeUpper = input.code.trim().toUpperCase();

    const db = getDb();
    if (db) {
      const existing = await db.select().from(pricingLists).where(
        and(eq(pricingLists.tenantId, ctx.tenantId), eq(pricingLists.companyId, ctx.companyId), eq(pricingLists.code, codeUpper))
      );
      if (existing.length > 0) {
        throw new ConflictError(`Pricing list with code '${codeUpper}' already exists.`);
      }

      const id = input.id || crypto.randomUUID();
      const newRec = {
        id,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        code: codeUpper,
        name: input.name.trim(),
        pricingType: input.pricingType || 'SALES',
        currency: input.currency || 'INR',
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo || null,
        description: input.description || null,
        isActive: true
      };

      const inserted = await db.insert(pricingLists).values(newRec).returning();
      const r = inserted[0]!;
      const dto: PricingListDTO = {
        id: r.id,
        tenantId: r.tenantId,
        companyId: r.companyId,
        code: r.code,
        name: r.name,
        pricingType: r.pricingType,
        currency: r.currency,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo || null,
        isActive: r.isActive,
        description: r.description || null,
        createdAt: r.createdAt
      };

      await auditService.logEvent(ctx, {
        module: 'commercial',
        entityName: 'PricingList',
        entityId: id,
        action: 'CREATE',
        newValues: { code: codeUpper, name: input.name }
      });

      return dto;
    } else {
      for (const pl of this.listsMemoryStore.values()) {
        if (pl.tenantId === ctx.tenantId && pl.companyId === ctx.companyId && pl.code === codeUpper) {
          throw new ConflictError(`Pricing list with code '${codeUpper}' already exists.`);
        }
      }

      const id = input.id || `plist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const dto: PricingListDTO = {
        id,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        code: codeUpper,
        name: input.name.trim(),
        pricingType: input.pricingType || 'SALES',
        currency: input.currency || 'INR',
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo || null,
        isActive: true,
        description: input.description || null,
        createdAt: new Date()
      };

      this.listsMemoryStore.set(`${ctx.tenantId}:${ctx.companyId}:${id}`, dto);
      return dto;
    }
  }

  async listPricingLists(ctx: RequestContext, companyId: string): Promise<PricingListDTO[]> {
    if (companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match query companyId');
    }

    const db = getDb();
    if (db) {
      const rows = await db.select().from(pricingLists).where(
        and(eq(pricingLists.tenantId, ctx.tenantId), eq(pricingLists.companyId, ctx.companyId))
      );
      return rows.map((r: any) => ({
        id: r.id,
        tenantId: r.tenantId,
        companyId: r.companyId,
        code: r.code,
        name: r.name,
        pricingType: r.pricingType,
        currency: r.currency,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo || null,
        isActive: r.isActive,
        description: r.description || null,
        createdAt: r.createdAt
      }));
    } else {
      return Array.from(this.listsMemoryStore.values()).filter(l => l.tenantId === ctx.tenantId && l.companyId === ctx.companyId);
    }
  }

  // --- Pricing Rules & Tiers ---

  async createPricingRule(ctx: RequestContext, input: CreatePricingRuleInput): Promise<PricingRuleDTO> {
    if (input.companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match request companyId');
    }
    if (!input.productId) {
      throw new ValidationError('productId is required.');
    }
    if (!input.effectiveFrom) {
      throw new ValidationError('effectiveFrom is required.');
    }

    const priceNum = Number(input.unitPrice);
    if (isNaN(priceNum) || priceNum < 0) {
      throw new ValidationError('Unit price cannot be negative.');
    }
    const unitPriceStr = priceNum.toFixed(2);

    const db = getDb();
    if (db) {
      const ruleId = input.id || crypto.randomUUID();
      const newRuleRec = {
        id: ruleId,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        pricingListId: input.pricingListId || null,
        productId: input.productId,
        customerId: input.customerId || null,
        supplierId: input.supplierId || null,
        unitPrice: unitPriceStr,
        currency: input.currency || 'INR',
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo || null,
        minQuantity: String(input.minQuantity ?? '1.0000'),
        isActive: true
      };

      const insertedRule = await db.insert(pricingRules).values(newRuleRec).returning();
      const r = insertedRule[0]!;

      const tiersDTO: PricingQuantityTierDTO[] = [];
      if (input.tiers && input.tiers.length > 0) {
        for (const tierInput of input.tiers) {
          const tierId = crypto.randomUUID();
          const tierUnitPrice = Number(tierInput.unitPrice).toFixed(2);
          const tierRec = {
            id: tierId,
            tenantId: ctx.tenantId,
            companyId: ctx.companyId,
            pricingRuleId: ruleId,
            minQuantity: String(tierInput.minQuantity),
            maxQuantity: tierInput.maxQuantity !== undefined ? String(tierInput.maxQuantity) : null,
            unitPrice: tierUnitPrice,
            discountPercent: String(tierInput.discountPercent ?? '0.00')
          };
          const insertedTier = await db.insert(pricingQuantityTiers).values(tierRec).returning();
          const t = insertedTier[0]!;
          tiersDTO.push({
            id: t.id,
            tenantId: t.tenantId,
            companyId: t.companyId,
            pricingRuleId: t.pricingRuleId,
            minQuantity: t.minQuantity,
            maxQuantity: t.maxQuantity || null,
            unitPrice: t.unitPrice,
            discountPercent: t.discountPercent,
            createdAt: t.createdAt
          });
        }
      }

      const dto: PricingRuleDTO = {
        id: r.id,
        tenantId: r.tenantId,
        companyId: r.companyId,
        pricingListId: r.pricingListId || null,
        productId: r.productId,
        customerId: r.customerId || null,
        supplierId: r.supplierId || null,
        unitPrice: r.unitPrice,
        currency: r.currency,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo || null,
        minQuantity: r.minQuantity,
        isActive: r.isActive,
        createdAt: r.createdAt,
        tiers: tiersDTO
      };

      await auditService.logEvent(ctx, {
        module: 'commercial',
        entityName: 'PricingRule',
        entityId: ruleId,
        action: 'CREATE',
        newValues: { productId: input.productId, unitPrice: unitPriceStr }
      });

      return dto;
    } else {
      const ruleId = input.id || `prule_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const tiersDTO: PricingQuantityTierDTO[] = [];
      if (input.tiers && input.tiers.length > 0) {
        for (const tierInput of input.tiers) {
          tiersDTO.push({
            id: `ptier_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            tenantId: ctx.tenantId,
            companyId: ctx.companyId,
            pricingRuleId: ruleId,
            minQuantity: String(tierInput.minQuantity),
            maxQuantity: tierInput.maxQuantity !== undefined ? String(tierInput.maxQuantity) : null,
            unitPrice: Number(tierInput.unitPrice).toFixed(2),
            discountPercent: String(tierInput.discountPercent ?? '0.00'),
            createdAt: new Date()
          });
        }
      }

      const dto: PricingRuleDTO = {
        id: ruleId,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        pricingListId: input.pricingListId || null,
        productId: input.productId,
        customerId: input.customerId || null,
        supplierId: input.supplierId || null,
        unitPrice: unitPriceStr,
        currency: input.currency || 'INR',
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo || null,
        minQuantity: String(input.minQuantity ?? '1.0000'),
        isActive: true,
        createdAt: new Date(),
        tiers: tiersDTO
      };

      this.rulesMemoryStore.set(`${ctx.tenantId}:${ctx.companyId}:${ruleId}`, dto);
      return dto;
    }
  }

  // --- Price Resolution Engine ---

  async resolvePrice(ctx: RequestContext, params: ResolvePriceParams): Promise<ResolvedPriceResult> {
    if (params.companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match request companyId');
    }

    const effDate = params.effectiveDate || new Date().toISOString().split('T')[0]!;
    const qtyVal = Number(params.quantity ?? 1);
    const currency = params.currency || 'INR';

    // 1. Fetch Product Master default price
    const product = await productService.getProduct(ctx, params.productId);

    const db = getDb();
    let rulesList: PricingRuleDTO[] = [];

    if (db) {
      const rows = await db.select().from(pricingRules).where(
        and(eq(pricingRules.tenantId, ctx.tenantId), eq(pricingRules.companyId, ctx.companyId), eq(pricingRules.productId, params.productId))
      );

      for (const r of rows) {
        if (!r.isActive) continue;
        if (r.effectiveFrom > effDate || (r.effectiveTo && r.effectiveTo < effDate)) continue;

        // Fetch tiers
        const tierRows = await db.select().from(pricingQuantityTiers).where(
          and(eq(pricingQuantityTiers.tenantId, ctx.tenantId), eq(pricingQuantityTiers.companyId, ctx.companyId), eq(pricingQuantityTiers.pricingRuleId, r.id))
        );

        rulesList.push({
          id: r.id,
          tenantId: r.tenantId,
          companyId: r.companyId,
          pricingListId: r.pricingListId || null,
          productId: r.productId,
          customerId: r.customerId || null,
          supplierId: r.supplierId || null,
          unitPrice: r.unitPrice,
          currency: r.currency,
          effectiveFrom: r.effectiveFrom,
          effectiveTo: r.effectiveTo || null,
          minQuantity: r.minQuantity,
          isActive: r.isActive,
          createdAt: r.createdAt,
          tiers: tierRows.map((t: any) => ({
            id: t.id,
            tenantId: t.tenantId,
            companyId: t.companyId,
            pricingRuleId: t.pricingRuleId,
            minQuantity: t.minQuantity,
            maxQuantity: t.maxQuantity || null,
            unitPrice: t.unitPrice,
            discountPercent: t.discountPercent,
            createdAt: t.createdAt
          }))
        });
      }
    } else {
      const allRules = Array.from(this.rulesMemoryStore.values()).filter(r => r.tenantId === ctx.tenantId && r.companyId === ctx.companyId && r.productId === params.productId && r.isActive);
      rulesList = allRules.filter(r => r.effectiveFrom <= effDate && (!r.effectiveTo || r.effectiveTo >= effDate));
    }

    // Cascade Priority 1: Entity-Specific Override
    if (params.customerId || params.supplierId) {
      const entityRule = rulesList.find(r => (params.customerId && r.customerId === params.customerId) || (params.supplierId && r.supplierId === params.supplierId));
      if (entityRule) {
        let finalPrice = entityRule.unitPrice;
        let appliedTier: ResolvedPriceResult['appliedTier'] = null;

        if (entityRule.tiers && entityRule.tiers.length > 0) {
          const tier = entityRule.tiers.find(t => {
            const minQ = Number(t.minQuantity);
            const maxQ = t.maxQuantity ? Number(t.maxQuantity) : null;
            return qtyVal >= minQ && (maxQ === null || qtyVal <= maxQ);
          });

          if (tier) {
            finalPrice = tier.unitPrice;
            appliedTier = {
              minQuantity: tier.minQuantity,
              maxQuantity: tier.maxQuantity || null,
              discountPercent: tier.discountPercent
            };
          }
        }

        return {
          unitPrice: finalPrice,
          currency: entityRule.currency,
          source: appliedTier ? 'VOLUME_TIER' : 'ENTITY_OVERRIDE',
          ruleId: entityRule.id,
          pricingListId: entityRule.pricingListId || null,
          appliedTier
        };
      }
    }

    // Cascade Priority 2: Price List Rule
    const listRule = rulesList.find(r => r.pricingListId && !r.customerId && !r.supplierId);
    if (listRule) {
      let finalPrice = listRule.unitPrice;
      let appliedTier: ResolvedPriceResult['appliedTier'] = null;

      if (listRule.tiers && listRule.tiers.length > 0) {
        const tier = listRule.tiers.find(t => {
          const minQ = Number(t.minQuantity);
          const maxQ = t.maxQuantity ? Number(t.maxQuantity) : null;
          return qtyVal >= minQ && (maxQ === null || qtyVal <= maxQ);
        });

        if (tier) {
          finalPrice = tier.unitPrice;
          appliedTier = {
            minQuantity: tier.minQuantity,
            maxQuantity: tier.maxQuantity || null,
            discountPercent: tier.discountPercent
          };
        }
      }

      return {
        unitPrice: finalPrice,
        currency: listRule.currency,
        source: appliedTier ? 'VOLUME_TIER' : 'PRICE_LIST',
        ruleId: listRule.id,
        pricingListId: listRule.pricingListId || null,
        appliedTier
      };
    }

    // Cascade Priority 3: Product Default Price
    const defaultPrice = (params.pricingType === 'PURCHASE') ? product.purchasePrice : product.sellingPrice;
    return {
      unitPrice: defaultPrice,
      currency,
      source: 'PRODUCT_DEFAULT',
      ruleId: null,
      pricingListId: null,
      appliedTier: null
    };
  }

  public clear(): void {
    this.listsMemoryStore.clear();
    this.rulesMemoryStore.clear();
  }
}

export const pricingService = new PricingService();
