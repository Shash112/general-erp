import {
  RequestContext,
  ValidationError,
  ForbiddenError
} from '@general-erp/core';
import { logger } from '../../config/logger.js';
import { auditService } from '../../platform/audit/audit.service.js';
import { idempotencyService } from '../../platform/idempotency/idempotency.service.js';
import { productService, CreateProductInput } from './product.service.js';
import { customerService, CreateCustomerInput } from './customer.service.js';
import { supplierService, CreateSupplierInput } from './supplier.service.js';
import { getDb, products, customers, suppliers, eq, and, or, inArray } from '@general-erp/database';
import crypto from 'crypto';

export const MAX_BULK_IMPORT_BATCH_SIZE = 500;

export type ImportEntityType = 'PRODUCT' | 'CUSTOMER' | 'SUPPLIER';

export interface RowValidationError {
  row: number;
  field: string;
  value: unknown;
  message: string;
}

export interface BulkImportResult {
  success: boolean;
  entityType: ImportEntityType;
  importedCount: number;
  idempotencyKey?: string | null;
  errors?: RowValidationError[];
}

export class CommercialImportService {
  async importProducts(ctx: RequestContext, companyId: string, items: CreateProductInput[], idempotencyKey?: string): Promise<BulkImportResult> {
    if (companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match request companyId');
    }

    if (idempotencyKey) {
      const check = await idempotencyService.checkOrClaim(ctx, idempotencyKey, items);
      if (check.isDuplicate && check.responseBody) {
        logger.info({ idempotencyKey }, '[COMMERCIAL_IMPORT] Returning cached idempotent import result');
        return check.responseBody as BulkImportResult;
      }
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new ValidationError('Import payload must be a non-empty array of records.');
    }

    if (items.length > MAX_BULK_IMPORT_BATCH_SIZE) {
      throw new ValidationError(`Bulk import batch size exceeds maximum limit of ${MAX_BULK_IMPORT_BATCH_SIZE} records (received ${items.length}).`);
    }

    const rowErrors: RowValidationError[] = [];
    const seenCodes = new Set<string>();
    const seenSkus = new Set<string>();

    // 1. Row-level & In-batch Duplicate Validation
    items.forEach((item, index) => {
      const rowNum = index + 1;
      if (!item.name || !item.name.trim()) {
        rowErrors.push({ row: rowNum, field: 'name', value: item.name, message: 'Product name is required.' });
      }
      if (!item.code || !item.code.trim()) {
        rowErrors.push({ row: rowNum, field: 'code', value: item.code, message: 'Product code is required.' });
      } else {
        const codeUpper = item.code.trim().toUpperCase();
        if (seenCodes.has(codeUpper)) {
          rowErrors.push({ row: rowNum, field: 'code', value: item.code, message: `Duplicate product code '${codeUpper}' within batch.` });
        } else {
          seenCodes.add(codeUpper);
        }
      }
      if (!item.sku || !item.sku.trim()) {
        rowErrors.push({ row: rowNum, field: 'sku', value: item.sku, message: 'Product SKU is required.' });
      } else {
        const skuUpper = item.sku.trim().toUpperCase();
        if (seenSkus.has(skuUpper)) {
          rowErrors.push({ row: rowNum, field: 'sku', value: item.sku, message: `Duplicate product SKU '${skuUpper}' within batch.` });
        } else {
          seenSkus.add(skuUpper);
        }
      }
    });

    if (rowErrors.length > 0) {
      if (idempotencyKey) idempotencyService.releaseClaim(ctx, idempotencyKey);
      throw new ValidationError(`Bulk import validation failed with ${rowErrors.length} errors.`, rowErrors);
    }

    // 2. Database Unique Duplicate Check & Atomic Execution
    const db = getDb();
    if (db) {
      const codesArray = Array.from(seenCodes);
      const skusArray = Array.from(seenSkus);

      const existingInDb = await db.select().from(products).where(
        and(
          eq(products.tenantId, ctx.tenantId),
          eq(products.companyId, ctx.companyId),
          or(inArray(products.code, codesArray), inArray(products.sku, skusArray))
        )
      );

      if (existingInDb.length > 0) {
        existingInDb.forEach((p: any) => {
          if (seenCodes.has(p.code)) {
            rowErrors.push({ row: 0, field: 'code', value: p.code, message: `Product code '${p.code}' already exists in database.` });
          }
          if (seenSkus.has(p.sku)) {
            rowErrors.push({ row: 0, field: 'sku', value: p.sku, message: `Product SKU '${p.sku}' already exists in database.` });
          }
        });
        if (idempotencyKey) idempotencyService.releaseClaim(ctx, idempotencyKey);
        throw new ValidationError(`Bulk import failed due to existing database record conflicts.`, rowErrors);
      }

      // Single Atomic Database Transaction (BEGIN ... COMMIT)
      try {
        await db.transaction(async () => {
          for (const item of items) {
            await productService.createProduct(ctx, { ...item, companyId });
          }
        });
      } catch (err) {
        if (idempotencyKey) idempotencyService.releaseClaim(ctx, idempotencyKey, err);
        throw err;
      }
    } else {
      // Memory Store atomic execution for test environments without live DB
      for (const item of items) {
        await productService.createProduct(ctx, { ...item, companyId });
      }
    }

    const payloadDigest = crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex');

    await auditService.logEvent(ctx, {
      module: 'commercial',
      entityName: 'BulkImportProduct',
      entityId: `import_${Date.now()}`,
      action: 'CREATE',
      newValues: { recordCount: items.length, payloadDigest }
    });

    const result: BulkImportResult = {
      success: true,
      entityType: 'PRODUCT',
      importedCount: items.length,
      idempotencyKey: idempotencyKey || null
    };

    if (idempotencyKey) {
      await idempotencyService.saveResult(ctx, idempotencyKey, items, 200, result);
    }

    return result;
  }

  async importCustomers(ctx: RequestContext, companyId: string, items: CreateCustomerInput[], idempotencyKey?: string): Promise<BulkImportResult> {
    if (companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match request companyId');
    }

    if (idempotencyKey) {
      const check = await idempotencyService.checkOrClaim(ctx, idempotencyKey, items);
      if (check.isDuplicate && check.responseBody) {
        return check.responseBody as BulkImportResult;
      }
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new ValidationError('Import payload must be a non-empty array of records.');
    }

    if (items.length > MAX_BULK_IMPORT_BATCH_SIZE) {
      throw new ValidationError(`Bulk import batch size exceeds maximum limit of ${MAX_BULK_IMPORT_BATCH_SIZE} records (received ${items.length}).`);
    }

    const rowErrors: RowValidationError[] = [];
    const seenCodes = new Set<string>();

    items.forEach((item, index) => {
      const rowNum = index + 1;
      if (!item.name || !item.name.trim()) {
        rowErrors.push({ row: rowNum, field: 'name', value: item.name, message: 'Customer name is required.' });
      }
      if (!item.code || !item.code.trim()) {
        rowErrors.push({ row: rowNum, field: 'code', value: item.code, message: 'Customer code is required.' });
      } else {
        const codeUpper = item.code.trim().toUpperCase();
        if (seenCodes.has(codeUpper)) {
          rowErrors.push({ row: rowNum, field: 'code', value: item.code, message: `Duplicate customer code '${codeUpper}' within batch.` });
        } else {
          seenCodes.add(codeUpper);
        }
      }
      if (item.gstin && item.gstin.trim() && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(item.gstin.trim().toUpperCase())) {
        rowErrors.push({ row: rowNum, field: 'gstin', value: item.gstin, message: 'Invalid 15-character GSTIN format.' });
      }
    });

    if (rowErrors.length > 0) {
      if (idempotencyKey) idempotencyService.releaseClaim(ctx, idempotencyKey);
      throw new ValidationError(`Bulk import validation failed with ${rowErrors.length} errors.`, rowErrors);
    }

    const db = getDb();
    if (db) {
      const codesArray = Array.from(seenCodes);
      const existingInDb = await db.select().from(customers).where(
        and(eq(customers.tenantId, ctx.tenantId), eq(customers.companyId, ctx.companyId), inArray(customers.code, codesArray))
      );

      if (existingInDb.length > 0) {
        existingInDb.forEach((c: any) => {
          rowErrors.push({ row: 0, field: 'code', value: c.code, message: `Customer code '${c.code}' already exists in database.` });
        });
        if (idempotencyKey) idempotencyService.releaseClaim(ctx, idempotencyKey);
        throw new ValidationError(`Bulk import failed due to existing database record conflicts.`, rowErrors);
      }

      try {
        await db.transaction(async () => {
          for (const item of items) {
            await customerService.createCustomer(ctx, { ...item, companyId });
          }
        });
      } catch (err) {
        if (idempotencyKey) idempotencyService.releaseClaim(ctx, idempotencyKey, err);
        throw err;
      }
    } else {
      for (const item of items) {
        await customerService.createCustomer(ctx, { ...item, companyId });
      }
    }

    const result: BulkImportResult = {
      success: true,
      entityType: 'CUSTOMER',
      importedCount: items.length,
      idempotencyKey: idempotencyKey || null
    };

    if (idempotencyKey) {
      await idempotencyService.saveResult(ctx, idempotencyKey, items, 200, result);
    }

    return result;
  }

  async importSuppliers(ctx: RequestContext, companyId: string, items: CreateSupplierInput[], idempotencyKey?: string): Promise<BulkImportResult> {
    if (companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match request companyId');
    }

    if (idempotencyKey) {
      const check = await idempotencyService.checkOrClaim(ctx, idempotencyKey, items);
      if (check.isDuplicate && check.responseBody) {
        return check.responseBody as BulkImportResult;
      }
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new ValidationError('Import payload must be a non-empty array of records.');
    }

    if (items.length > MAX_BULK_IMPORT_BATCH_SIZE) {
      throw new ValidationError(`Bulk import batch size exceeds maximum limit of ${MAX_BULK_IMPORT_BATCH_SIZE} records (received ${items.length}).`);
    }

    const rowErrors: RowValidationError[] = [];
    const seenCodes = new Set<string>();

    items.forEach((item, index) => {
      const rowNum = index + 1;
      if (!item.name || !item.name.trim()) {
        rowErrors.push({ row: rowNum, field: 'name', value: item.name, message: 'Supplier name is required.' });
      }
      if (!item.code || !item.code.trim()) {
        rowErrors.push({ row: rowNum, field: 'code', value: item.code, message: 'Supplier code is required.' });
      } else {
        const codeUpper = item.code.trim().toUpperCase();
        if (seenCodes.has(codeUpper)) {
          rowErrors.push({ row: rowNum, field: 'code', value: item.code, message: `Duplicate supplier code '${codeUpper}' within batch.` });
        } else {
          seenCodes.add(codeUpper);
        }
      }
    });

    if (rowErrors.length > 0) {
      if (idempotencyKey) idempotencyService.releaseClaim(ctx, idempotencyKey);
      throw new ValidationError(`Bulk import validation failed with ${rowErrors.length} errors.`, rowErrors);
    }

    const db = getDb();
    if (db) {
      const codesArray = Array.from(seenCodes);
      const existingInDb = await db.select().from(suppliers).where(
        and(eq(suppliers.tenantId, ctx.tenantId), eq(suppliers.companyId, ctx.companyId), inArray(suppliers.code, codesArray))
      );

      if (existingInDb.length > 0) {
        existingInDb.forEach((s: any) => {
          rowErrors.push({ row: 0, field: 'code', value: s.code, message: `Supplier code '${s.code}' already exists in database.` });
        });
        if (idempotencyKey) idempotencyService.releaseClaim(ctx, idempotencyKey);
        throw new ValidationError(`Bulk import failed due to existing database record conflicts.`, rowErrors);
      }

      try {
        await db.transaction(async () => {
          for (const item of items) {
            await supplierService.createSupplier(ctx, { ...item, companyId });
          }
        });
      } catch (err) {
        if (idempotencyKey) idempotencyService.releaseClaim(ctx, idempotencyKey, err);
        throw err;
      }
    } else {
      for (const item of items) {
        await supplierService.createSupplier(ctx, { ...item, companyId });
      }
    }

    const result: BulkImportResult = {
      success: true,
      entityType: 'SUPPLIER',
      importedCount: items.length,
      idempotencyKey: idempotencyKey || null
    };

    if (idempotencyKey) {
      await idempotencyService.saveResult(ctx, idempotencyKey, items, 200, result);
    }

    return result;
  }
}

export const commercialImportService = new CommercialImportService();
