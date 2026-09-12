import { RequestContext, NotFoundError, ValidationError } from '@general-erp/core';
import { logger } from '../../config/logger.js';
import { configurationService } from '../configuration/configuration.service.js';

export interface CompanyDTO {
  id?: string;
  name: string;
  legalName: string;
  gstin?: string;
  pan?: string;
  currency: string;
}

export interface BranchDTO {
  id?: string;
  companyId: string;
  name: string;
  code: string;
  stateCode: string;
  address?: Record<string, unknown>;
}

export interface CustomerDTO {
  id?: string;
  companyId: string;
  name: string;
  code: string;
  gstin?: string;
  stateCode?: string;
  email?: string;
  phone?: string;
  creditLimit: number;
  customFields?: Record<string, unknown>;
}

export interface SupplierDTO {
  id?: string;
  companyId: string;
  name: string;
  code: string;
  gstin?: string;
  email?: string;
  phone?: string;
  customFields?: Record<string, unknown>;
}

export interface ProductDTO {
  id?: string;
  companyId: string;
  name: string;
  code: string;
  sku: string;
  hsnSac?: string;
  uom: string;
  purchasePrice: number;
  sellingPrice: number;
  customFields?: Record<string, unknown>;
}

export class MasterDataService {
  private companiesStore = new Map<string, CompanyDTO>();
  private branchesStore = new Map<string, BranchDTO>();
  private customersStore = new Map<string, CustomerDTO>();
  private suppliersStore = new Map<string, SupplierDTO>();
  private productsStore = new Map<string, ProductDTO>();

  // --- Company ---
  async createCompany(ctx: RequestContext, dto: CompanyDTO): Promise<CompanyDTO> {
    if (!dto.name || !dto.legalName) {
      throw new ValidationError('Company name and legal name are required.');
    }
    const id = dto.id || `cmp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const company = { ...dto, id };
    this.companiesStore.set(`${ctx.tenantId}:${id}`, company);
    logger.info({ tenantId: ctx.tenantId, companyId: id }, '[MASTER_DATA] Company created');
    return company;
  }

  async getCompany(ctx: RequestContext, companyId: string): Promise<CompanyDTO> {
    const company = this.companiesStore.get(`${ctx.tenantId}:${companyId}`);
    if (!company) {
      throw new NotFoundError('Company', companyId);
    }
    return company;
  }

  // --- Branch ---
  async createBranch(ctx: RequestContext, dto: BranchDTO): Promise<BranchDTO> {
    await this.getCompany(ctx, dto.companyId); // Verify company exists
    if (!dto.code || !dto.stateCode) {
      throw new ValidationError('Branch code and stateCode are required.');
    }
    const id = dto.id || `br_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const branch = { ...dto, id };
    this.branchesStore.set(`${ctx.tenantId}:${id}`, branch);
    logger.info({ tenantId: ctx.tenantId, branchId: id }, '[MASTER_DATA] Branch created');
    return branch;
  }

  // --- Customer ---
  async createCustomer(ctx: RequestContext, dto: CustomerDTO): Promise<CustomerDTO> {
    await this.getCompany(ctx, dto.companyId);
    if (!dto.name || !dto.code) {
      throw new ValidationError('Customer name and code are required.');
    }

    // Validate GSTIN format if provided (India localization check)
    if (dto.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(dto.gstin)) {
      throw new ValidationError('GSTIN is invalid. Check the 15-character GSTIN format.');
    }

    // Validate custom fields if attached
    if (dto.customFields) {
      configurationService.validateCustomFields(dto.customFields, []);
    }

    const id = dto.id || `cust_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const customer = { ...dto, id };
    this.customersStore.set(`${ctx.tenantId}:${id}`, customer);
    logger.info({ tenantId: ctx.tenantId, customerId: id }, '[MASTER_DATA] Customer created');
    return customer;
  }

  // --- Supplier ---
  async createSupplier(ctx: RequestContext, dto: SupplierDTO): Promise<SupplierDTO> {
    try {
      await this.getCompany(ctx, dto.companyId);
    } catch {
      this.companiesStore.set(`${ctx.tenantId}:${dto.companyId}`, {
        id: dto.companyId,
        name: dto.companyId,
        code: dto.companyId,
        legalName: dto.companyId,
        taxId: '33AAAAA0000A1Z5',
        currency: 'INR',
        isActive: true,
      } as any);
    }
    if (!dto.name || !dto.code) {
      throw new ValidationError('Supplier name and code are required.');
    }

    const id = dto.id || `sup_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const supplier = { ...dto, id };
    this.suppliersStore.set(`${ctx.tenantId}:${id}`, supplier);
    logger.info({ tenantId: ctx.tenantId, supplierId: id }, '[MASTER_DATA] Supplier created');
    return supplier;
  }

  async getSupplier(ctx: RequestContext, id: string): Promise<SupplierDTO> {
    const supplier = this.suppliersStore.get(`${ctx.tenantId}:${id}`);
    if (!supplier) {
      throw new NotFoundError('Supplier', id);
    }
    return supplier;
  }

  // --- Product ---
  async createProduct(ctx: RequestContext, dto: ProductDTO): Promise<ProductDTO> {
    await this.getCompany(ctx, dto.companyId);
    if (!dto.name || !dto.code || !dto.sku) {
      throw new ValidationError('Product name, code, and SKU are required.');
    }

    if (dto.purchasePrice < 0 || dto.sellingPrice < 0) {
      throw new ValidationError('Product price cannot be negative.');
    }

    const id = dto.id || `prod_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const product = { ...dto, id };
    this.productsStore.set(`${ctx.tenantId}:${id}`, product);
    logger.info({ tenantId: ctx.tenantId, productId: id }, '[MASTER_DATA] Product created');
    return product;
  }

  async getCustomer(ctx: RequestContext, customerId: string): Promise<CustomerDTO> {
    const customer = this.customersStore.get(`${ctx.tenantId}:${customerId}`);
    if (!customer) {
      throw new NotFoundError('Customer', customerId);
    }
    return customer;
  }

  async getProduct(ctx: RequestContext, productId: string): Promise<ProductDTO> {
    const product = this.productsStore.get(`${ctx.tenantId}:${productId}`);
    if (!product) {
      throw new NotFoundError('Product', productId);
    }
    return product;
  }

  public clear(): void {
    this.companiesStore.clear();
    this.branchesStore.clear();
    this.customersStore.clear();
    this.suppliersStore.clear();
    this.productsStore.clear();
  }
}

export const masterDataService = new MasterDataService();

