import {
  RequestContext,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError
} from '@general-erp/core';
import { auditService } from '../../platform/audit/audit.service.js';
import { getDb, customers, NewCustomer, eq, and, sql, ilike, or } from '@general-erp/database';

export interface CustomerDTO {
  id: string;
  tenantId: string;
  companyId: string;
  name: string;
  legalName?: string | null;
  code: string;
  gstin?: string | null;
  gstType: string; // 'REGULAR' | 'COMPOSITION' | 'SEZ' | 'UNREGISTERED'
  pan?: string | null;
  email?: string | null;
  phone?: string | null;
  currency: string;
  paymentTermsId?: string | null;
  creditLimit: string;
  creditDays: number;
  isActive: boolean;
  customFields?: Record<string, unknown> | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCustomerInput {
  id?: string;
  companyId: string;
  name: string;
  legalName?: string;
  code: string;
  gstin?: string;
  gstType?: string;
  pan?: string;
  email?: string;
  phone?: string;
  currency?: string;
  paymentTermsId?: string;
  creditLimit?: number | string;
  creditDays?: number;
  customFields?: Record<string, unknown>;
}

export interface UpdateCustomerInput {
  name?: string;
  legalName?: string;
  gstin?: string;
  gstType?: string;
  pan?: string;
  email?: string;
  phone?: string;
  currency?: string;
  paymentTermsId?: string;
  creditLimit?: number | string;
  creditDays?: number;
  isActive?: boolean;
  customFields?: Record<string, unknown>;
}

export interface ListCustomersQuery {
  companyId: string;
  search?: string;
  gstType?: string;
  isActive?: boolean;
  limit?: number;
  offset?: number;
}

export class CustomerService {
  private memoryStore = new Map<string, CustomerDTO>();

  private formatCustomer(row: any): CustomerDTO {
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
      email: row.email || null,
      phone: row.phone || null,
      currency: row.currency || 'INR',
      paymentTermsId: row.paymentTermsId || null,
      creditLimit: String(row.creditLimit || '0.00'),
      creditDays: Number(row.creditDays || 0),
      isActive: row.isActive ?? true,
      customFields: row.customFields || null,
      version: row.version || 1,
      createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt || Date.now()),
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt || Date.now())
    };
  }

  async createCustomer(ctx: RequestContext, input: CreateCustomerInput): Promise<CustomerDTO> {
    if (input.companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match request companyId');
    }
    if (!input.name || !input.name.trim()) {
      throw new ValidationError('Customer name is required.');
    }
    if (!input.code || !input.code.trim()) {
      throw new ValidationError('Customer code is required.');
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

    const creditLimitNum = Number(input.creditLimit ?? 0);
    if (isNaN(creditLimitNum) || creditLimitNum < 0) {
      throw new ValidationError('Credit limit cannot be negative.');
    }
    const creditLimitStr = creditLimitNum.toFixed(2);

    const codeUpper = input.code.trim().toUpperCase();

    const db = getDb();
    if (db) {
      const existing = await db.select().from(customers).where(
        and(eq(customers.tenantId, ctx.tenantId), eq(customers.companyId, ctx.companyId), eq(customers.code, codeUpper))
      );
      if (existing.length > 0) {
        throw new ConflictError(`Customer with code '${codeUpper}' already exists.`);
      }

      const id = input.id || crypto.randomUUID();
      const newRecord: NewCustomer = {
        id,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        name: input.name.trim(),
        legalName: input.legalName?.trim() || null,
        code: codeUpper,
        gstin: input.gstin?.trim().toUpperCase() || null,
        gstType: input.gstType || 'REGULAR',
        pan: input.pan?.trim().toUpperCase() || null,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        currency: input.currency || 'INR',
        paymentTermsId: input.paymentTermsId || null,
        creditLimit: creditLimitStr,
        creditDays: input.creditDays || 0,
        isActive: true,
        customFields: input.customFields || {},
        version: 1
      };

      const inserted = await db.insert(customers).values(newRecord).returning();
      const result = this.formatCustomer(inserted[0]);

      await auditService.logEvent(ctx, {
        module: 'commercial',
        entityName: 'Customer',
        entityId: id,
        action: 'CREATE',
        newValues: { code: codeUpper, name: input.name }
      });

      return result;
    } else {
      for (const c of this.memoryStore.values()) {
        if (c.tenantId === ctx.tenantId && c.companyId === ctx.companyId && c.code === codeUpper) {
          throw new ConflictError(`Customer with code '${codeUpper}' already exists.`);
        }
      }

      const id = input.id || `cust_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const dto: CustomerDTO = {
        id,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        name: input.name.trim(),
        legalName: input.legalName?.trim() || null,
        code: codeUpper,
        gstin: input.gstin?.trim().toUpperCase() || null,
        gstType: input.gstType || 'REGULAR',
        pan: input.pan?.trim().toUpperCase() || null,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        currency: input.currency || 'INR',
        paymentTermsId: input.paymentTermsId || null,
        creditLimit: creditLimitStr,
        creditDays: input.creditDays || 0,
        isActive: true,
        customFields: input.customFields || null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      this.memoryStore.set(`${ctx.tenantId}:${ctx.companyId}:${id}`, dto);
      return dto;
    }
  }

  async getCustomer(ctx: RequestContext, id: string): Promise<CustomerDTO> {
    const db = getDb();
    if (db) {
      const rows = await db.select().from(customers).where(
        and(eq(customers.tenantId, ctx.tenantId), eq(customers.companyId, ctx.companyId), eq(customers.id, id))
      );
      if (rows.length === 0) {
        throw new NotFoundError('Customer', id);
      }
      return this.formatCustomer(rows[0]);
    } else {
      const dto = this.memoryStore.get(`${ctx.tenantId}:${ctx.companyId}:${id}`);
      if (!dto) throw new NotFoundError('Customer', id);
      return dto;
    }
  }

  async listCustomers(ctx: RequestContext, query: ListCustomersQuery): Promise<{ items: CustomerDTO[]; total: number }> {
    if (query.companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match query companyId');
    }

    const db = getDb();
    if (db) {
      const conditions = [
        eq(customers.tenantId, ctx.tenantId),
        eq(customers.companyId, ctx.companyId)
      ];

      if (query.isActive !== undefined) {
        conditions.push(eq(customers.isActive, query.isActive));
      }
      if (query.gstType) {
        conditions.push(eq(customers.gstType, query.gstType));
      }
      if (query.search) {
        const pattern = `%${query.search}%`;
        conditions.push(or(ilike(customers.name, pattern), ilike(customers.code, pattern), ilike(customers.gstin, pattern))!);
      }

      const limit = query.limit || 50;
      const offset = query.offset || 0;

      const rows = await db.select().from(customers)
        .where(and(...conditions))
        .limit(limit)
        .offset(offset);

      const countResult = await db.select({ count: sql<number>`count(*)::int` }).from(customers).where(and(...conditions));
      const total = countResult[0]?.count || 0;

      return {
        items: rows.map((r: any) => this.formatCustomer(r)),
        total
      };
    } else {
      let all = Array.from(this.memoryStore.values()).filter(c => c.tenantId === ctx.tenantId && c.companyId === ctx.companyId);
      if (query.isActive !== undefined) all = all.filter(c => c.isActive === query.isActive);
      if (query.gstType) all = all.filter(c => c.gstType === query.gstType);
      if (query.search) {
        const s = query.search.toLowerCase();
        all = all.filter(c => c.name.toLowerCase().includes(s) || c.code.toLowerCase().includes(s) || (c.gstin && c.gstin.toLowerCase().includes(s)));
      }

      const offset = query.offset || 0;
      const limit = query.limit || 50;
      return {
        items: all.slice(offset, offset + limit),
        total: all.length
      };
    }
  }

  async updateCustomer(ctx: RequestContext, id: string, input: UpdateCustomerInput): Promise<CustomerDTO> {
    const existing = await this.getCustomer(ctx, id);

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
      const updateData: Partial<NewCustomer> = {
        updatedAt: new Date(),
        version: existing.version + 1
      };

      if (input.name !== undefined) updateData.name = input.name.trim();
      if (input.legalName !== undefined) updateData.legalName = input.legalName.trim();
      if (input.gstin !== undefined) updateData.gstin = input.gstin ? input.gstin.trim().toUpperCase() : null;
      if (input.gstType !== undefined) updateData.gstType = input.gstType;
      if (input.pan !== undefined) updateData.pan = input.pan ? input.pan.trim().toUpperCase() : null;
      if (input.email !== undefined) updateData.email = input.email ? input.email.trim() : null;
      if (input.phone !== undefined) updateData.phone = input.phone ? input.phone.trim() : null;
      if (input.currency !== undefined) updateData.currency = input.currency;
      if (input.paymentTermsId !== undefined) updateData.paymentTermsId = input.paymentTermsId;
      if (input.creditLimit !== undefined) updateData.creditLimit = Number(input.creditLimit).toFixed(2);
      if (input.creditDays !== undefined) updateData.creditDays = input.creditDays;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;
      if (input.customFields !== undefined) updateData.customFields = input.customFields;

      const updated = await db.update(customers)
        .set(updateData)
        .where(and(eq(customers.tenantId, ctx.tenantId), eq(customers.companyId, ctx.companyId), eq(customers.id, id)))
        .returning();

      await auditService.logEvent(ctx, {
        module: 'commercial',
        entityName: 'Customer',
        entityId: id,
        action: 'UPDATE',
        newValues: updateData
      });

      return this.formatCustomer(updated[0]);
    } else {
      const updated: CustomerDTO = {
        ...existing,
        name: input.name !== undefined ? input.name.trim() : existing.name,
        legalName: input.legalName !== undefined ? input.legalName.trim() : (existing.legalName || null),
        gstin: input.gstin !== undefined ? (input.gstin ? input.gstin.trim().toUpperCase() : null) : (existing.gstin || null),
        gstType: input.gstType !== undefined ? input.gstType : existing.gstType,
        pan: input.pan !== undefined ? (input.pan ? input.pan.trim().toUpperCase() : null) : (existing.pan || null),
        email: input.email !== undefined ? (input.email ? input.email.trim() : null) : (existing.email || null),
        phone: input.phone !== undefined ? (input.phone ? input.phone.trim() : null) : (existing.phone || null),
        currency: input.currency !== undefined ? input.currency : existing.currency,
        paymentTermsId: input.paymentTermsId !== undefined ? input.paymentTermsId : (existing.paymentTermsId || null),
        creditLimit: input.creditLimit !== undefined ? Number(input.creditLimit).toFixed(2) : existing.creditLimit,
        creditDays: input.creditDays !== undefined ? input.creditDays : existing.creditDays,
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

export const customerService = new CustomerService();
