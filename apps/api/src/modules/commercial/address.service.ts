import {
  RequestContext,
  ValidationError,
  NotFoundError,
  ForbiddenError
} from '@general-erp/core';
import { auditService } from '../../platform/audit/audit.service.js';
import { taxEngineService } from '../finance/tax-engine.service.js';
import { getDb, commercialAddresses, NewCommercialAddress, eq, and } from '@general-erp/database';

export interface CommercialAddressDTO {
  id: string;
  tenantId: string;
  companyId: string;
  customerId?: string | null;
  supplierId?: string | null;
  branchId?: string | null;
  addressType: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  district?: string | null;
  state: string;
  stateCode: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAddressInput {
  id?: string;
  companyId: string;
  customerId?: string;
  supplierId?: string;
  branchId?: string;
  addressType?: string; // BILLING, SHIPPING, OFFICE, REGISTERED, OTHER
  addressLine1: string;
  addressLine2?: string;
  city: string;
  district?: string;
  state: string;
  stateCode: string;
  postalCode: string;
  country?: string;
  isDefault?: boolean;
}

export class AddressService {
  private memoryStore = new Map<string, CommercialAddressDTO>();

  private formatAddress(row: any): CommercialAddressDTO {
    return {
      id: row.id,
      tenantId: row.tenantId,
      companyId: row.companyId,
      customerId: row.customerId || null,
      supplierId: row.supplierId || null,
      branchId: row.branchId || null,
      addressType: row.addressType || 'BILLING',
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2 || null,
      city: row.city,
      district: row.district || null,
      state: row.state,
      stateCode: row.stateCode,
      postalCode: row.postalCode,
      country: row.country || 'IND',
      isDefault: row.isDefault ?? false,
      createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt || Date.now()),
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt || Date.now())
    };
  }

  async createAddress(ctx: RequestContext, input: CreateAddressInput): Promise<CommercialAddressDTO> {
    if (input.companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match request companyId');
    }

    const parentsCount = (input.customerId ? 1 : 0) + (input.supplierId ? 1 : 0) + (input.branchId ? 1 : 0);
    if (parentsCount !== 1) {
      throw new ValidationError('Address must be associated with exactly one parent (customerId, supplierId, or branchId).');
    }

    if (!input.addressLine1 || !input.addressLine1.trim()) {
      throw new ValidationError('addressLine1 is required.');
    }
    if (!input.city || !input.city.trim()) {
      throw new ValidationError('city is required.');
    }
    if (!input.state || !input.state.trim()) {
      throw new ValidationError('state is required.');
    }
    if (!input.postalCode || !input.postalCode.trim()) {
      throw new ValidationError('postalCode is required.');
    }

    const validatedStateCode = taxEngineService.validateStateCode(input.stateCode, 'stateCode');

    const db = getDb();
    if (db) {
      const id = input.id || crypto.randomUUID();
      const newRecord: NewCommercialAddress = {
        id,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        customerId: input.customerId || null,
        supplierId: input.supplierId || null,
        branchId: input.branchId || null,
        addressType: input.addressType || 'BILLING',
        addressLine1: input.addressLine1.trim(),
        addressLine2: input.addressLine2?.trim() || null,
        city: input.city.trim(),
        district: input.district?.trim() || null,
        state: input.state.trim(),
        stateCode: validatedStateCode,
        postalCode: input.postalCode.trim(),
        country: input.country || 'IND',
        isDefault: input.isDefault ?? false
      };

      const inserted = await db.insert(commercialAddresses).values(newRecord).returning();
      const result = this.formatAddress(inserted[0]);

      await auditService.logEvent(ctx, {
        module: 'commercial',
        entityName: 'CommercialAddress',
        entityId: id,
        action: 'CREATE',
        newValues: { city: input.city, stateCode: validatedStateCode }
      });

      return result;
    } else {
      const id = input.id || `addr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const dto: CommercialAddressDTO = {
        id,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        customerId: input.customerId || null,
        supplierId: input.supplierId || null,
        branchId: input.branchId || null,
        addressType: input.addressType || 'BILLING',
        addressLine1: input.addressLine1.trim(),
        addressLine2: input.addressLine2?.trim() || null,
        city: input.city.trim(),
        district: input.district?.trim() || null,
        state: input.state.trim(),
        stateCode: validatedStateCode,
        postalCode: input.postalCode.trim(),
        country: input.country || 'IND',
        isDefault: input.isDefault ?? false,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      this.memoryStore.set(`${ctx.tenantId}:${ctx.companyId}:${id}`, dto);
      return dto;
    }
  }

  async getAddress(ctx: RequestContext, id: string): Promise<CommercialAddressDTO> {
    const db = getDb();
    if (db) {
      const rows = await db.select().from(commercialAddresses).where(
        and(eq(commercialAddresses.tenantId, ctx.tenantId), eq(commercialAddresses.companyId, ctx.companyId), eq(commercialAddresses.id, id))
      );
      if (rows.length === 0) throw new NotFoundError('CommercialAddress', id);
      return this.formatAddress(rows[0]);
    } else {
      const dto = this.memoryStore.get(`${ctx.tenantId}:${ctx.companyId}:${id}`);
      if (!dto) throw new NotFoundError('CommercialAddress', id);
      return dto;
    }
  }

  async listAddressesForParent(ctx: RequestContext, parent: { customerId?: string; supplierId?: string; branchId?: string }): Promise<CommercialAddressDTO[]> {
    const db = getDb();
    if (db) {
      const conditions = [
        eq(commercialAddresses.tenantId, ctx.tenantId),
        eq(commercialAddresses.companyId, ctx.companyId)
      ];

      if (parent.customerId) conditions.push(eq(commercialAddresses.customerId, parent.customerId));
      if (parent.supplierId) conditions.push(eq(commercialAddresses.supplierId, parent.supplierId));
      if (parent.branchId) conditions.push(eq(commercialAddresses.branchId, parent.branchId));

      const rows = await db.select().from(commercialAddresses).where(and(...conditions));
      return rows.map((r: any) => this.formatAddress(r));
    } else {
      let list = Array.from(this.memoryStore.values()).filter(a => a.tenantId === ctx.tenantId && a.companyId === ctx.companyId);
      if (parent.customerId) list = list.filter(a => a.customerId === parent.customerId);
      if (parent.supplierId) list = list.filter(a => a.supplierId === parent.supplierId);
      if (parent.branchId) list = list.filter(a => a.branchId === parent.branchId);
      return list;
    }
  }

  async deleteAddress(ctx: RequestContext, id: string): Promise<void> {
    await this.getAddress(ctx, id);

    const db = getDb();
    if (db) {
      await db.delete(commercialAddresses).where(
        and(eq(commercialAddresses.tenantId, ctx.tenantId), eq(commercialAddresses.companyId, ctx.companyId), eq(commercialAddresses.id, id))
      );
    } else {
      this.memoryStore.delete(`${ctx.tenantId}:${ctx.companyId}:${id}`);
    }

    await auditService.logEvent(ctx, {
      module: 'commercial',
      entityName: 'CommercialAddress',
      entityId: id,
      action: 'UPDATE',
      newValues: { action: 'DELETED' }
    });
  }

  public clear(): void {
    this.memoryStore.clear();
  }
}

export const addressService = new AddressService();
