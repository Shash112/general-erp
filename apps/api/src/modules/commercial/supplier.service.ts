import {
  RequestContext,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError
} from '@general-erp/core';
import { auditService } from '../../platform/audit/audit.service.js';
import { masterDataService } from '../../platform/master-data/master-data.service.js';
import { getDb, suppliers, NewSupplier, eq, and, sql, ilike, or } from '@general-erp/database';

export interface SupplierDTO {
  id: string;
  tenantId: string;
  companyId: string;
  name: string;
  legalName?: string | null;
  code: string;
  gstin?: string | null;
  gstType: string;
  pan?: string | null;
  msmeType: string; // 'MICRO' | 'SMALL' | 'MEDIUM' | 'NONE'
  msmeRegNo?: string | null;
  tdsSection?: string | null;
  email?: string | null;
  phone?: string | null;
  currency: string;
  paymentTermsId?: string | null;
  isActive: boolean;
  customFields?: Record<string, unknown> | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSupplierInput {
  id?: string;
  companyId: string;
  name: string;
  legalName?: string;
  code: string;
  gstin?: string;
  gstType?: string;
  pan?: string;
  msmeType?: string;
  msmeRegNo?: string;
  tdsSection?: string;
  email?: string;
  phone?: string;
  currency?: string;
  paymentTermsId?: string;
  customFields?: Record<string, unknown>;
}

export interface UpdateSupplierInput {
  name?: string;
  legalName?: string;
  gstin?: string;
  gstType?: string;
  pan?: string;
  msmeType?: string;
  msmeRegNo?: string;
  tdsSection?: string;
  email?: string;
  phone?: string;
  currency?: string;
  paymentTermsId?: string;
  isActive?: boolean;
  customFields?: Record<string, unknown>;
}

export interface ListSuppliersQuery {
  companyId: string;
  search?: string;
  msmeType?: string;
  isActive?: boolean;
  limit?: number;
  offset?: number;
}

export class SupplierService {
  private memoryStore = new Map<string, SupplierDTO>();

  private formatSupplier(row: any): SupplierDTO {
    return {
      id: row.id,
      tenantId: row.tenantId,
      companyId: row.companyId,
      name: row.name,
      legalName: row.legalName || null,
      code: row.code,
      gstin: row.gstin || null,
      gstType: row.gstType || 'REGULAR',
      pan: row.pan || null,
      msmeType: row.msmeType || 'NONE',
      msmeRegNo: row.msmeRegNo || null,
      tdsSection: row.tdsSection || null,
      email: row.email || null,
      phone: row.phone || null,
      currency: row.currency || 'INR',
      paymentTermsId: row.paymentTermsId || null,
      isActive: row.isActive ?? true,
      customFields: row.customFields || null,
      version: row.version || 1,
      createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt || Date.now()),
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt || Date.now())
    };
  }

  async createSupplier(ctx: RequestContext, input: CreateSupplierInput): Promise<SupplierDTO> {
    if (input.companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match request companyId');
    }
    if (!input.name || !input.name.trim()) {
      throw new ValidationError('Supplier name is required.');
    }
    if (!input.code || !input.code.trim()) {
      throw new ValidationError('Supplier code is required.');
    }

    if (input.gstin && input.gstin.trim()) {
      const gstinUpper = input.gstin.trim().toUpperCase();
      if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstinUpper)) {
        throw new ValidationError('GSTIN is invalid. Check the 15-character GSTIN format.');
      }
    }

    if (input.pan && input.pan.trim()) {
      const panUpper = input.pan.trim().toUpperCase();
      if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panUpper)) {
        throw new ValidationError('PAN format is invalid. Check the 10-character PAN format.');
      }
    }

    const validMsmeTypes = ['MICRO', 'SMALL', 'MEDIUM', 'NONE'];
    const msmeType = (input.msmeType || 'NONE').toUpperCase();
    if (!validMsmeTypes.includes(msmeType)) {
      throw new ValidationError(`Invalid MSME type '${input.msmeType}'. Allowed: ${validMsmeTypes.join(', ')}`);
    }

    const codeUpper = input.code.trim().toUpperCase();

    const db = getDb();
    if (db) {
      const existing = await db.select().from(suppliers).where(
        and(eq(suppliers.tenantId, ctx.tenantId), eq(suppliers.companyId, ctx.companyId), eq(suppliers.code, codeUpper))
      );
      if (existing.length > 0) {
        throw new ConflictError(`Supplier with code '${codeUpper}' already exists.`);
      }

      const id = input.id || crypto.randomUUID();
      const newRecord: NewSupplier = {
        id,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        name: input.name.trim(),
        legalName: input.legalName?.trim() || null,
        code: codeUpper,
        gstin: input.gstin?.trim().toUpperCase() || null,
        gstType: input.gstType || 'REGULAR',
        pan: input.pan?.trim().toUpperCase() || null,
        msmeType,
        msmeRegNo: input.msmeRegNo?.trim() || null,
        tdsSection: input.tdsSection?.trim() || null,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        currency: input.currency || 'INR',
        paymentTermsId: input.paymentTermsId || null,
        isActive: true,
        customFields: input.customFields || {},
        version: 1
      };

      const inserted = await db.insert(suppliers).values(newRecord).returning();
      const result = this.formatSupplier(inserted[0]);

      await auditService.logEvent(ctx, {
        module: 'commercial',
        entityName: 'Supplier',
        entityId: id,
        action: 'CREATE',
        newValues: { code: codeUpper, name: input.name }
      });

      return result;
    } else {
      for (const s of this.memoryStore.values()) {
        if (s.tenantId === ctx.tenantId && s.companyId === ctx.companyId && s.code === codeUpper) {
          throw new ConflictError(`Supplier with code '${codeUpper}' already exists.`);
        }
      }

      const id = input.id || `sup_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const dto: SupplierDTO = {
        id,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        name: input.name.trim(),
        legalName: input.legalName?.trim() || null,
        code: codeUpper,
        gstin: input.gstin?.trim().toUpperCase() || null,
        gstType: input.gstType || 'REGULAR',
        pan: input.pan?.trim().toUpperCase() || null,
        msmeType,
        msmeRegNo: input.msmeRegNo?.trim() || null,
        tdsSection: input.tdsSection?.trim() || null,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        currency: input.currency || 'INR',
        paymentTermsId: input.paymentTermsId || null,
        isActive: true,
        customFields: input.customFields || null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      this.memoryStore.set(`${ctx.tenantId}:${ctx.companyId}:${id}`, dto);
      await masterDataService.createSupplier(ctx, {
        id,
        companyId: ctx.companyId,
        name: dto.name,
        code: dto.code,
        ...(dto.gstin ? { gstin: dto.gstin } : {}),
        ...(dto.email ? { email: dto.email } : {}),
        ...(dto.phone ? { phone: dto.phone } : {}),
      });
      return dto;
    }
  }

  async getSupplier(ctx: RequestContext, id: string): Promise<SupplierDTO> {
    const db = getDb();
    if (db) {
      const rows = await db.select().from(suppliers).where(
        and(eq(suppliers.tenantId, ctx.tenantId), eq(suppliers.companyId, ctx.companyId), eq(suppliers.id, id))
      );
      if (rows.length === 0) {
        throw new NotFoundError('Supplier', id);
      }
      return this.formatSupplier(rows[0]);
    } else {
      const dto = this.memoryStore.get(`${ctx.tenantId}:${ctx.companyId}:${id}`);
      if (!dto) throw new NotFoundError('Supplier', id);
      return dto;
    }
  }

  async listSuppliers(ctx: RequestContext, query: ListSuppliersQuery): Promise<{ items: SupplierDTO[]; total: number }> {
    if (query.companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match query companyId');
    }

    const db = getDb();
    if (db) {
      const conditions = [
        eq(suppliers.tenantId, ctx.tenantId),
        eq(suppliers.companyId, ctx.companyId)
      ];

      if (query.isActive !== undefined) {
        conditions.push(eq(suppliers.isActive, query.isActive));
      }
      if (query.msmeType) {
        conditions.push(eq(suppliers.msmeType, query.msmeType));
      }
      if (query.search) {
        const pattern = `%${query.search}%`;
        conditions.push(or(ilike(suppliers.name, pattern), ilike(suppliers.code, pattern), ilike(suppliers.gstin, pattern))!);
      }

      const limit = query.limit || 50;
      const offset = query.offset || 0;

      const rows = await db.select().from(suppliers)
        .where(and(...conditions))
        .limit(limit)
        .offset(offset);

      const countResult = await db.select({ count: sql<number>`count(*)::int` }).from(suppliers).where(and(...conditions));
      const total = countResult[0]?.count || 0;

      return {
        items: rows.map((r: any) => this.formatSupplier(r)),
        total
      };
    } else {
      let all = Array.from(this.memoryStore.values()).filter(s => s.tenantId === ctx.tenantId && s.companyId === ctx.companyId);
      if (query.isActive !== undefined) all = all.filter(s => s.isActive === query.isActive);
      if (query.msmeType) all = all.filter(s => s.msmeType === query.msmeType);
      if (query.search) {
        const str = query.search.toLowerCase();
        all = all.filter(s => s.name.toLowerCase().includes(str) || s.code.toLowerCase().includes(str) || (s.gstin && s.gstin.toLowerCase().includes(str)));
      }

      const offset = query.offset || 0;
      const limit = query.limit || 50;
      return {
        items: all.slice(offset, offset + limit),
        total: all.length
      };
    }
  }

  async updateSupplier(ctx: RequestContext, id: string, input: UpdateSupplierInput): Promise<SupplierDTO> {
    const existing = await this.getSupplier(ctx, id);

    if (input.gstin && input.gstin.trim()) {
      const gstinUpper = input.gstin.trim().toUpperCase();
      if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstinUpper)) {
        throw new ValidationError('GSTIN is invalid. Check the 15-character GSTIN format.');
      }
    }

    if (input.pan && input.pan.trim()) {
      const panUpper = input.pan.trim().toUpperCase();
      if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panUpper)) {
        throw new ValidationError('PAN format is invalid. Check the 10-character PAN format.');
      }
    }

    const db = getDb();
    if (db) {
      const updateData: Partial<NewSupplier> = {
        updatedAt: new Date(),
        version: existing.version + 1
      };

      if (input.name !== undefined) updateData.name = input.name.trim();
      if (input.legalName !== undefined) updateData.legalName = input.legalName.trim();
      if (input.gstin !== undefined) updateData.gstin = input.gstin ? input.gstin.trim().toUpperCase() : null;
      if (input.gstType !== undefined) updateData.gstType = input.gstType;
      if (input.pan !== undefined) updateData.pan = input.pan ? input.pan.trim().toUpperCase() : null;
      if (input.msmeType !== undefined) updateData.msmeType = input.msmeType.toUpperCase();
      if (input.msmeRegNo !== undefined) updateData.msmeRegNo = input.msmeRegNo ? input.msmeRegNo.trim() : null;
      if (input.tdsSection !== undefined) updateData.tdsSection = input.tdsSection ? input.tdsSection.trim() : null;
      if (input.email !== undefined) updateData.email = input.email ? input.email.trim() : null;
      if (input.phone !== undefined) updateData.phone = input.phone ? input.phone.trim() : null;
      if (input.currency !== undefined) updateData.currency = input.currency;
      if (input.paymentTermsId !== undefined) updateData.paymentTermsId = input.paymentTermsId;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;
      if (input.customFields !== undefined) updateData.customFields = input.customFields;

      const updated = await db.update(suppliers)
        .set(updateData)
        .where(and(eq(suppliers.tenantId, ctx.tenantId), eq(suppliers.companyId, ctx.companyId), eq(suppliers.id, id)))
        .returning();

      await auditService.logEvent(ctx, {
        module: 'commercial',
        entityName: 'Supplier',
        entityId: id,
        action: 'UPDATE',
        newValues: updateData
      });

      return this.formatSupplier(updated[0]);
    } else {
      const updated: SupplierDTO = {
        ...existing,
        name: input.name !== undefined ? input.name.trim() : existing.name,
        legalName: input.legalName !== undefined ? input.legalName.trim() : (existing.legalName || null),
        gstin: input.gstin !== undefined ? (input.gstin ? input.gstin.trim().toUpperCase() : null) : (existing.gstin || null),
        gstType: input.gstType !== undefined ? input.gstType : existing.gstType,
        pan: input.pan !== undefined ? (input.pan ? input.pan.trim().toUpperCase() : null) : (existing.pan || null),
        msmeType: input.msmeType !== undefined ? input.msmeType.toUpperCase() : existing.msmeType,
        msmeRegNo: input.msmeRegNo !== undefined ? (input.msmeRegNo ? input.msmeRegNo.trim() : null) : (existing.msmeRegNo || null),
        tdsSection: input.tdsSection !== undefined ? (input.tdsSection ? input.tdsSection.trim() : null) : (existing.tdsSection || null),
        email: input.email !== undefined ? (input.email ? input.email.trim() : null) : (existing.email || null),
        phone: input.phone !== undefined ? (input.phone ? input.phone.trim() : null) : (existing.phone || null),
        currency: input.currency !== undefined ? input.currency : existing.currency,
        paymentTermsId: input.paymentTermsId !== undefined ? input.paymentTermsId : (existing.paymentTermsId || null),
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

export const supplierService = new SupplierService();
