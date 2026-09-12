import {
  RequestContext,
  ValidationError,
  NotFoundError,
  ForbiddenError
} from '@general-erp/core';
import { auditService } from '../../platform/audit/audit.service.js';
import { getDb, commercialContacts, NewCommercialContact, eq, and } from '@general-erp/database';

export interface CommercialContactDTO {
  id: string;
  tenantId: string;
  companyId: string;
  customerId?: string | null;
  supplierId?: string | null;
  branchId?: string | null;
  name: string;
  designation?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  isPrimary: boolean;
  customFields?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateContactInput {
  id?: string;
  companyId: string;
  customerId?: string;
  supplierId?: string;
  branchId?: string;
  name: string;
  designation?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  isPrimary?: boolean;
  customFields?: Record<string, unknown>;
}

export class ContactService {
  private memoryStore = new Map<string, CommercialContactDTO>();

  private formatContact(row: any): CommercialContactDTO {
    return {
      id: row.id,
      tenantId: row.tenantId,
      companyId: row.companyId,
      customerId: row.customerId || null,
      supplierId: row.supplierId || null,
      branchId: row.branchId || null,
      name: row.name,
      designation: row.designation || null,
      email: row.email || null,
      phone: row.phone || null,
      mobile: row.mobile || null,
      isPrimary: row.isPrimary ?? false,
      customFields: row.customFields || {},
      createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt || Date.now()),
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt || Date.now())
    };
  }

  async createContact(ctx: RequestContext, input: CreateContactInput): Promise<CommercialContactDTO> {
    if (input.companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match request companyId');
    }

    const parentsCount = (input.customerId ? 1 : 0) + (input.supplierId ? 1 : 0) + (input.branchId ? 1 : 0);
    if (parentsCount !== 1) {
      throw new ValidationError('Contact must be associated with exactly one parent (customerId, supplierId, or branchId).');
    }

    if (!input.name || !input.name.trim()) {
      throw new ValidationError('Contact name is required.');
    }

    const db = getDb();
    if (db) {
      const id = input.id || crypto.randomUUID();
      const newRecord: NewCommercialContact = {
        id,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        customerId: input.customerId || null,
        supplierId: input.supplierId || null,
        branchId: input.branchId || null,
        name: input.name.trim(),
        designation: input.designation?.trim() || null,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        mobile: input.mobile?.trim() || null,
        isPrimary: input.isPrimary ?? false,
        customFields: input.customFields || {}
      };

      const inserted = await db.insert(commercialContacts).values(newRecord).returning();
      const result = this.formatContact(inserted[0]);

      await auditService.logEvent(ctx, {
        module: 'commercial',
        entityName: 'CommercialContact',
        entityId: id,
        action: 'CREATE',
        newValues: { name: input.name }
      });

      return result;
    } else {
      const id = input.id || `cont_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const dto: CommercialContactDTO = {
        id,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        customerId: input.customerId || null,
        supplierId: input.supplierId || null,
        branchId: input.branchId || null,
        name: input.name.trim(),
        designation: input.designation?.trim() || null,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        mobile: input.mobile?.trim() || null,
        isPrimary: input.isPrimary ?? false,
        customFields: input.customFields || {},
        createdAt: new Date(),
        updatedAt: new Date()
      };

      this.memoryStore.set(`${ctx.tenantId}:${ctx.companyId}:${id}`, dto);
      return dto;
    }
  }

  async getContact(ctx: RequestContext, id: string): Promise<CommercialContactDTO> {
    const db = getDb();
    if (db) {
      const rows = await db.select().from(commercialContacts).where(
        and(eq(commercialContacts.tenantId, ctx.tenantId), eq(commercialContacts.companyId, ctx.companyId), eq(commercialContacts.id, id))
      );
      if (rows.length === 0) throw new NotFoundError('CommercialContact', id);
      return this.formatContact(rows[0]);
    } else {
      const dto = this.memoryStore.get(`${ctx.tenantId}:${ctx.companyId}:${id}`);
      if (!dto) throw new NotFoundError('CommercialContact', id);
      return dto;
    }
  }

  async listContactsForParent(ctx: RequestContext, parent: { customerId?: string; supplierId?: string; branchId?: string }): Promise<CommercialContactDTO[]> {
    const db = getDb();
    if (db) {
      const conditions = [
        eq(commercialContacts.tenantId, ctx.tenantId),
        eq(commercialContacts.companyId, ctx.companyId)
      ];

      if (parent.customerId) conditions.push(eq(commercialContacts.customerId, parent.customerId));
      if (parent.supplierId) conditions.push(eq(commercialContacts.supplierId, parent.supplierId));
      if (parent.branchId) conditions.push(eq(commercialContacts.branchId, parent.branchId));

      const rows = await db.select().from(commercialContacts).where(and(...conditions));
      return rows.map((r: any) => this.formatContact(r));
    } else {
      let list = Array.from(this.memoryStore.values()).filter(c => c.tenantId === ctx.tenantId && c.companyId === ctx.companyId);
      if (parent.customerId) list = list.filter(c => c.customerId === parent.customerId);
      if (parent.supplierId) list = list.filter(c => c.supplierId === parent.supplierId);
      if (parent.branchId) list = list.filter(a => a.branchId === parent.branchId);
      return list;
    }
  }

  async deleteContact(ctx: RequestContext, id: string): Promise<void> {
    await this.getContact(ctx, id);

    const db = getDb();
    if (db) {
      await db.delete(commercialContacts).where(
        and(eq(commercialContacts.tenantId, ctx.tenantId), eq(commercialContacts.companyId, ctx.companyId), eq(commercialContacts.id, id))
      );
    } else {
      this.memoryStore.delete(`${ctx.tenantId}:${ctx.companyId}:${id}`);
    }

    await auditService.logEvent(ctx, {
      module: 'commercial',
      entityName: 'CommercialContact',
      entityId: id,
      action: 'UPDATE',
      newValues: { action: 'DELETED' }
    });
  }

  public clear(): void {
    this.memoryStore.clear();
  }
}

export const contactService = new ContactService();
