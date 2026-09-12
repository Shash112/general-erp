import {
  RequestContext,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError
} from '@general-erp/core';
import { auditService } from '../../platform/audit/audit.service.js';
import { masterDataService } from '../../platform/master-data/master-data.service.js';
import { getDb, products, NewProduct, eq, and, sql, ilike, or } from '@general-erp/database';

export interface ProductDTO {
  id: string;
  tenantId: string;
  companyId: string;
  name: string;
  code: string;
  sku: string;
  productType: string; // 'GOODS' | 'SERVICE'
  category?: string | null;
  hsnSac?: string | null;
  baseUom: string;
  purchasePrice: string;
  sellingPrice: string;
  minOrderQty: string;
  isSellable: boolean;
  isPurchasable: boolean;
  isActive: boolean;
  customFields?: Record<string, unknown> | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProductInput {
  id?: string;
  companyId: string;
  name: string;
  code: string;
  sku: string;
  productType?: string;
  category?: string;
  hsnSac?: string;
  baseUom?: string;
  purchasePrice?: number | string;
  sellingPrice?: number | string;
  minOrderQty?: number | string;
  isSellable?: boolean;
  isPurchasable?: boolean;
  customFields?: Record<string, unknown>;
}

export interface UpdateProductInput {
  name?: string;
  category?: string;
  hsnSac?: string;
  baseUom?: string;
  purchasePrice?: number | string;
  sellingPrice?: number | string;
  minOrderQty?: number | string;
  isSellable?: boolean;
  isPurchasable?: boolean;
  isActive?: boolean;
  customFields?: Record<string, unknown>;
}

export interface ListProductsQuery {
  companyId: string;
  search?: string;
  category?: string;
  productType?: string;
  isActive?: boolean;
  limit?: number;
  offset?: number;
}

export class ProductService {
  private memoryStore = new Map<string, ProductDTO>();

  private formatProduct(row: any): ProductDTO {
    return {
      id: row.id,
      tenantId: row.tenantId,
      companyId: row.companyId,
      name: row.name,
      code: row.code,
      sku: row.sku,
      productType: row.productType || 'GOODS',
      category: row.category || null,
      hsnSac: row.hsnSac || null,
      baseUom: row.baseUom || 'PCS',
      purchasePrice: String(row.purchasePrice || '0.00'),
      sellingPrice: String(row.sellingPrice || '0.00'),
      minOrderQty: String(row.minOrderQty || '1.0000'),
      isSellable: row.isSellable ?? true,
      isPurchasable: row.isPurchasable ?? true,
      isActive: row.isActive ?? true,
      customFields: row.customFields || null,
      version: row.version || 1,
      createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt || Date.now()),
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt || Date.now())
    };
  }

  async createProduct(ctx: RequestContext, input: CreateProductInput): Promise<ProductDTO> {
    if (input.companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match request companyId');
    }
    if (!input.name || !input.name.trim()) {
      throw new ValidationError('Product name is required.');
    }
    if (!input.code || !input.code.trim()) {
      throw new ValidationError('Product code is required.');
    }
    if (!input.sku || !input.sku.trim()) {
      throw new ValidationError('Product SKU is required.');
    }

    const purchPriceNum = Number(input.purchasePrice ?? 0);
    const sellPriceNum = Number(input.sellingPrice ?? 0);
    if (isNaN(purchPriceNum) || isNaN(sellPriceNum) || purchPriceNum < 0 || sellPriceNum < 0) {
      throw new ValidationError('Product prices cannot be negative.');
    }
    const purchPriceStr = purchPriceNum.toFixed(2);
    const sellPriceStr = sellPriceNum.toFixed(2);

    const codeUpper = input.code.trim().toUpperCase();
    const skuUpper = input.sku.trim().toUpperCase();

    // Check DB or memory store
    const db = getDb();
    if (db) {
      const existing = await db.select().from(products).where(
        and(
          eq(products.tenantId, ctx.tenantId),
          eq(products.companyId, ctx.companyId),
          or(eq(products.code, codeUpper), eq(products.sku, skuUpper))
        )
      );
      if (existing.length > 0) {
        if (existing.some((p: any) => p.code === codeUpper)) {
          throw new ConflictError(`Product with code '${codeUpper}' already exists.`);
        }
        throw new ConflictError(`Product with SKU '${skuUpper}' already exists.`);
      }

      const id = input.id || crypto.randomUUID();
      const newRecord: NewProduct = {
        id,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        name: input.name.trim(),
        code: codeUpper,
        sku: skuUpper,
        productType: input.productType || 'GOODS',
        category: input.category || null,
        hsnSac: input.hsnSac || null,
        baseUom: input.baseUom || 'PCS',
        purchasePrice: purchPriceStr,
        sellingPrice: sellPriceStr,
        minOrderQty: String(input.minOrderQty ?? '1.0000'),
        isSellable: input.isSellable ?? true,
        isPurchasable: input.isPurchasable ?? true,
        isActive: true,
        customFields: input.customFields || {},
        version: 1
      };

      const inserted = await db.insert(products).values(newRecord).returning();
      const result = this.formatProduct(inserted[0]);

      await auditService.logEvent(ctx, {
        module: 'commercial',
        entityName: 'Product',
        entityId: id,
        action: 'CREATE',
        newValues: { code: codeUpper, sku: skuUpper, name: input.name }
      });

      const masterProd: any = {
        id: result.id,
        companyId: result.companyId,
        name: result.name,
        code: result.code,
        sku: result.sku,
        uom: result.baseUom,
        purchasePrice: parseFloat(result.purchasePrice || '0'),
        sellingPrice: parseFloat(result.sellingPrice || '0')
      };
      if (result.hsnSac) masterProd.hsnSac = result.hsnSac;
      await masterDataService.createProduct(ctx, masterProd).catch(() => {});

      return result;
    } else {
      // Memory Store Fallback
      for (const p of this.memoryStore.values()) {
        if (p.tenantId === ctx.tenantId && p.companyId === ctx.companyId) {
          if (p.code === codeUpper) throw new ConflictError(`Product with code '${codeUpper}' already exists.`);
          if (p.sku === skuUpper) throw new ConflictError(`Product with SKU '${skuUpper}' already exists.`);
        }
      }

      const id = input.id || `prod_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const dto: ProductDTO = {
        id,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        name: input.name.trim(),
        code: codeUpper,
        sku: skuUpper,
        productType: input.productType || 'GOODS',
        category: input.category || null,
        hsnSac: input.hsnSac || null,
        baseUom: input.baseUom || 'PCS',
        purchasePrice: purchPriceStr,
        sellingPrice: sellPriceStr,
        minOrderQty: String(input.minOrderQty ?? '1.0000'),
        isSellable: input.isSellable ?? true,
        isPurchasable: input.isPurchasable ?? true,
        isActive: true,
        customFields: input.customFields || null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      this.memoryStore.set(`${ctx.tenantId}:${ctx.companyId}:${id}`, dto);

      const masterProd: any = {
        id: dto.id,
        companyId: dto.companyId,
        name: dto.name,
        code: dto.code,
        sku: dto.sku,
        uom: dto.baseUom,
        purchasePrice: parseFloat(dto.purchasePrice || '0'),
        sellingPrice: parseFloat(dto.sellingPrice || '0')
      };
      if (dto.hsnSac) masterProd.hsnSac = dto.hsnSac;
      await masterDataService.createProduct(ctx, masterProd).catch(() => {});

      return dto;
    }
  }

  async getProduct(ctx: RequestContext, id: string): Promise<ProductDTO> {
    const db = getDb();
    if (db) {
      const rows = await db.select().from(products).where(
        and(eq(products.tenantId, ctx.tenantId), eq(products.companyId, ctx.companyId), eq(products.id, id))
      );
      if (rows.length === 0) {
        throw new NotFoundError('Product', id);
      }
      return this.formatProduct(rows[0]);
    } else {
      const dto = this.memoryStore.get(`${ctx.tenantId}:${ctx.companyId}:${id}`);
      if (!dto) throw new NotFoundError('Product', id);
      return dto;
    }
  }

  async listProducts(ctx: RequestContext, query: ListProductsQuery): Promise<{ items: ProductDTO[]; total: number }> {
    if (query.companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match query companyId');
    }

    const db = getDb();
    if (db) {
      const conditions = [
        eq(products.tenantId, ctx.tenantId),
        eq(products.companyId, ctx.companyId)
      ];

      if (query.isActive !== undefined) {
        conditions.push(eq(products.isActive, query.isActive));
      }
      if (query.productType) {
        conditions.push(eq(products.productType, query.productType));
      }
      if (query.category) {
        conditions.push(eq(products.category, query.category));
      }
      if (query.search) {
        const pattern = `%${query.search}%`;
        conditions.push(or(ilike(products.name, pattern), ilike(products.code, pattern), ilike(products.sku, pattern))!);
      }

      const limit = query.limit || 50;
      const offset = query.offset || 0;

      const rows = await db.select().from(products)
        .where(and(...conditions))
        .limit(limit)
        .offset(offset);

      const countResult = await db.select({ count: sql<number>`count(*)::int` }).from(products).where(and(...conditions));
      const total = countResult[0]?.count || 0;

      return {
        items: rows.map((r: any) => this.formatProduct(r)),
        total
      };
    } else {
      let all = Array.from(this.memoryStore.values()).filter(p => p.tenantId === ctx.tenantId && p.companyId === ctx.companyId);
      if (query.isActive !== undefined) all = all.filter(p => p.isActive === query.isActive);
      if (query.productType) all = all.filter(p => p.productType === query.productType);
      if (query.category) all = all.filter(p => p.category === query.category);
      if (query.search) {
        const s = query.search.toLowerCase();
        all = all.filter(p => p.name.toLowerCase().includes(s) || p.code.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s));
      }

      const offset = query.offset || 0;
      const limit = query.limit || 50;
      return {
        items: all.slice(offset, offset + limit),
        total: all.length
      };
    }
  }

  async updateProduct(ctx: RequestContext, id: string, input: UpdateProductInput): Promise<ProductDTO> {
    const existing = await this.getProduct(ctx, id);

    const db = getDb();
    if (db) {
      const updateData: Partial<NewProduct> = {
        updatedAt: new Date(),
        version: existing.version + 1
      };

      if (input.name !== undefined) updateData.name = input.name.trim();
      if (input.category !== undefined) updateData.category = input.category;
      if (input.hsnSac !== undefined) updateData.hsnSac = input.hsnSac;
      if (input.baseUom !== undefined) updateData.baseUom = input.baseUom;
      if (input.purchasePrice !== undefined) updateData.purchasePrice = Number(input.purchasePrice).toFixed(2);
      if (input.sellingPrice !== undefined) updateData.sellingPrice = Number(input.sellingPrice).toFixed(2);
      if (input.minOrderQty !== undefined) updateData.minOrderQty = String(input.minOrderQty);
      if (input.isSellable !== undefined) updateData.isSellable = input.isSellable;
      if (input.isPurchasable !== undefined) updateData.isPurchasable = input.isPurchasable;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;
      if (input.customFields !== undefined) updateData.customFields = input.customFields;

      const updated = await db.update(products)
        .set(updateData)
        .where(and(eq(products.tenantId, ctx.tenantId), eq(products.companyId, ctx.companyId), eq(products.id, id)))
        .returning();

      await auditService.logEvent(ctx, {
        module: 'commercial',
        entityName: 'Product',
        entityId: id,
        action: 'UPDATE',
        newValues: updateData
      });

      return this.formatProduct(updated[0]);
    } else {
      const updated: ProductDTO = {
        ...existing,
        name: input.name !== undefined ? input.name.trim() : existing.name,
        category: input.category !== undefined ? input.category : (existing.category || null),
        hsnSac: input.hsnSac !== undefined ? input.hsnSac : (existing.hsnSac || null),
        baseUom: input.baseUom !== undefined ? input.baseUom : existing.baseUom,
        purchasePrice: input.purchasePrice !== undefined ? Number(input.purchasePrice).toFixed(2) : existing.purchasePrice,
        sellingPrice: input.sellingPrice !== undefined ? Number(input.sellingPrice).toFixed(2) : existing.sellingPrice,
        minOrderQty: input.minOrderQty !== undefined ? String(input.minOrderQty) : existing.minOrderQty,
        isSellable: input.isSellable !== undefined ? input.isSellable : existing.isSellable,
        isPurchasable: input.isPurchasable !== undefined ? input.isPurchasable : existing.isPurchasable,
        isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
        customFields: input.customFields !== undefined ? input.customFields : (existing.customFields || null),
        version: existing.version + 1,
        updatedAt: new Date()
      };

      this.memoryStore.set(`${ctx.tenantId}:${ctx.companyId}:${id}`, updated);
      return updated;
    }
  }

  public clear(): void {
    this.memoryStore.clear();
  }
}

export const productService = new ProductService();
