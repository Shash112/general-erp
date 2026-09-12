import {
  RequestContext,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError
} from '@general-erp/core';
import { auditService } from '../../platform/audit/audit.service.js';
import { getDb, uomDefinitions, uomConversions, eq, and } from '@general-erp/database';

export interface UomDefinitionDTO {
  id: string;
  tenantId: string;
  companyId: string;
  code: string;
  name: string;
  symbol: string;
  category: string;
  precision: number;
  isActive: boolean;
  createdAt: Date;
}

export interface UomConversionDTO {
  id: string;
  tenantId: string;
  companyId: string;
  fromUom: string;
  toUom: string;
  conversionFactor: string; // numeric(18,6)
  createdAt: Date;
}

export interface CreateUomInput {
  id?: string;
  companyId: string;
  code: string;
  name: string;
  symbol: string;
  category?: string;
  precision?: number;
}

export interface CreateUomConversionInput {
  id?: string;
  companyId: string;
  fromUom: string;
  toUom: string;
  conversionFactor: number | string;
}

export class UomService {
  private defsMemoryStore = new Map<string, UomDefinitionDTO>();
  private convsMemoryStore = new Map<string, UomConversionDTO>();

  // --- UOM Definitions ---

  async createUom(ctx: RequestContext, input: CreateUomInput): Promise<UomDefinitionDTO> {
    if (input.companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match request companyId');
    }
    if (!input.code || !input.code.trim()) {
      throw new ValidationError('UOM code is required.');
    }
    if (!input.name || !input.name.trim()) {
      throw new ValidationError('UOM name is required.');
    }
    if (!input.symbol || !input.symbol.trim()) {
      throw new ValidationError('UOM symbol is required.');
    }

    const codeUpper = input.code.trim().toUpperCase();

    const db = getDb();
    if (db) {
      const existing = await db.select().from(uomDefinitions).where(
        and(eq(uomDefinitions.tenantId, ctx.tenantId), eq(uomDefinitions.companyId, ctx.companyId), eq(uomDefinitions.code, codeUpper))
      );
      if (existing.length > 0) {
        throw new ConflictError(`UOM definition with code '${codeUpper}' already exists.`);
      }

      const id = input.id || crypto.randomUUID();
      const newRec = {
        id,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        code: codeUpper,
        name: input.name.trim(),
        symbol: input.symbol.trim(),
        category: input.category || 'UNIT',
        precision: input.precision ?? 0,
        isActive: true
      };

      const inserted = await db.insert(uomDefinitions).values(newRec).returning();
      const r = inserted[0]!;
      const dto: UomDefinitionDTO = {
        id: r.id,
        tenantId: r.tenantId,
        companyId: r.companyId,
        code: r.code,
        name: r.name,
        symbol: r.symbol,
        category: r.category,
        precision: r.precision,
        isActive: r.isActive,
        createdAt: r.createdAt
      };

      await auditService.logEvent(ctx, {
        module: 'commercial',
        entityName: 'UomDefinition',
        entityId: id,
        action: 'CREATE',
        newValues: { code: codeUpper, name: input.name }
      });

      return dto;
    } else {
      for (const d of this.defsMemoryStore.values()) {
        if (d.tenantId === ctx.tenantId && d.companyId === ctx.companyId && d.code === codeUpper) {
          throw new ConflictError(`UOM definition with code '${codeUpper}' already exists.`);
        }
      }

      const id = input.id || `uom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const dto: UomDefinitionDTO = {
        id,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        code: codeUpper,
        name: input.name.trim(),
        symbol: input.symbol.trim(),
        category: input.category || 'UNIT',
        precision: input.precision ?? 0,
        isActive: true,
        createdAt: new Date()
      };

      this.defsMemoryStore.set(`${ctx.tenantId}:${ctx.companyId}:${id}`, dto);
      return dto;
    }
  }

  async listUoms(ctx: RequestContext, companyId: string): Promise<UomDefinitionDTO[]> {
    if (companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match query companyId');
    }

    const db = getDb();
    if (db) {
      const rows = await db.select().from(uomDefinitions).where(
        and(eq(uomDefinitions.tenantId, ctx.tenantId), eq(uomDefinitions.companyId, ctx.companyId))
      );
      return rows.map((r: any) => ({
        id: r.id,
        tenantId: r.tenantId,
        companyId: r.companyId,
        code: r.code,
        name: r.name,
        symbol: r.symbol,
        category: r.category,
        precision: r.precision,
        isActive: r.isActive,
        createdAt: r.createdAt
      }));
    } else {
      return Array.from(this.defsMemoryStore.values()).filter(d => d.tenantId === ctx.tenantId && d.companyId === ctx.companyId);
    }
  }

  // --- UOM Conversions ---

  async createConversion(ctx: RequestContext, input: CreateUomConversionInput): Promise<UomConversionDTO> {
    if (input.companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match request companyId');
    }

    const fromUpper = input.fromUom.trim().toUpperCase();
    const toUpper = input.toUom.trim().toUpperCase();

    if (fromUpper === toUpper) {
      throw new ValidationError('fromUom and toUom cannot be identical.');
    }

    const factorNum = Number(input.conversionFactor);
    if (isNaN(factorNum) || factorNum <= 0) {
      throw new ValidationError('Conversion factor must be a positive non-zero number.');
    }
    const factorStr = factorNum.toFixed(6);

    const db = getDb();
    if (db) {
      const existing = await db.select().from(uomConversions).where(
        and(
          eq(uomConversions.tenantId, ctx.tenantId),
          eq(uomConversions.companyId, ctx.companyId),
          eq(uomConversions.fromUom, fromUpper),
          eq(uomConversions.toUom, toUpper)
        )
      );

      if (existing.length > 0) {
        throw new ConflictError(`Conversion pair '${fromUpper}' -> '${toUpper}' already exists.`);
      }

      const id = input.id || crypto.randomUUID();
      const newRec = {
        id,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        fromUom: fromUpper,
        toUom: toUpper,
        conversionFactor: factorStr
      };

      const inserted = await db.insert(uomConversions).values(newRec).returning();
      const r = inserted[0]!;
      const dto: UomConversionDTO = {
        id: r.id,
        tenantId: r.tenantId,
        companyId: r.companyId,
        fromUom: r.fromUom,
        toUom: r.toUom,
        conversionFactor: String(r.conversionFactor),
        createdAt: r.createdAt
      };

      await auditService.logEvent(ctx, {
        module: 'commercial',
        entityName: 'UomConversion',
        entityId: id,
        action: 'CREATE',
        newValues: { pair: `${fromUpper}->${toUpper}`, factor: factorStr }
      });

      return dto;
    } else {
      for (const c of this.convsMemoryStore.values()) {
        if (c.tenantId === ctx.tenantId && c.companyId === ctx.companyId && c.fromUom === fromUpper && c.toUom === toUpper) {
          throw new ConflictError(`Conversion pair '${fromUpper}' -> '${toUpper}' already exists.`);
        }
      }

      const id = input.id || `conv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const dto: UomConversionDTO = {
        id,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        fromUom: fromUpper,
        toUom: toUpper,
        conversionFactor: factorStr,
        createdAt: new Date()
      };

      this.convsMemoryStore.set(`${ctx.tenantId}:${ctx.companyId}:${id}`, dto);
      return dto;
    }
  }

  async convertQuantity(ctx: RequestContext, companyId: string, fromUom: string, toUom: string, quantity: number | string): Promise<{ convertedQuantity: string; conversionFactor: string }> {
    const fromUpper = fromUom.trim().toUpperCase();
    const toUpper = toUom.trim().toUpperCase();
    const qtyNum = Number(quantity);

    if (isNaN(qtyNum)) {
      throw new ValidationError('Invalid quantity for UOM conversion.');
    }

    if (fromUpper === toUpper) {
      return { convertedQuantity: qtyNum.toFixed(6), conversionFactor: '1.000000' };
    }

    const db = getDb();
    let forwardConv: UomConversionDTO | undefined;
    let reverseConv: UomConversionDTO | undefined;

    if (db) {
      const rows = await db.select().from(uomConversions).where(
        and(eq(uomConversions.tenantId, ctx.tenantId), eq(uomConversions.companyId, companyId))
      );

      forwardConv = rows.find((r: any) => r.fromUom === fromUpper && r.toUom === toUpper) as UomConversionDTO | undefined;
      if (!forwardConv) {
        reverseConv = rows.find((r: any) => r.fromUom === toUpper && r.toUom === fromUpper) as UomConversionDTO | undefined;
      }
    } else {
      const all = Array.from(this.convsMemoryStore.values()).filter(c => c.tenantId === ctx.tenantId && c.companyId === companyId);
      forwardConv = all.find(c => c.fromUom === fromUpper && c.toUom === toUpper);
      if (!forwardConv) {
        reverseConv = all.find(c => c.fromUom === toUpper && c.toUom === fromUpper);
      }
    }

    if (forwardConv) {
      const factor = Number(forwardConv.conversionFactor);
      const converted = (qtyNum * factor).toFixed(6);
      return { convertedQuantity: converted, conversionFactor: forwardConv.conversionFactor };
    }

    if (reverseConv) {
      const factor = Number(reverseConv.conversionFactor);
      const converted = (qtyNum / factor).toFixed(6);
      return { convertedQuantity: converted, conversionFactor: reverseConv.conversionFactor };
    }

    throw new NotFoundError('UOM Conversion', `${fromUpper} -> ${toUpper}`);
  }

  public clear(): void {
    this.defsMemoryStore.clear();
    this.convsMemoryStore.clear();
  }
}

export const uomService = new UomService();
