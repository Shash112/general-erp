import {
  RequestContext,
  ValidationError
} from '@general-erp/core';
import { SupplierStatementQueryInput } from './ap-aging-model.js';

export class ApAgingValidator {
  public static validateCompanyContext(ctx: RequestContext, companyId: string): void {
    if (!ctx.tenantId || ctx.tenantId.trim() === '') {
      throw new ValidationError('RequestContext tenantId is required.');
    }
    if (!companyId || companyId.trim() === '') {
      throw new ValidationError('Company context companyId is required.');
    }
  }

  public static validateSupplierContext(supplierId: string): void {
    if (!supplierId || supplierId.trim() === '') {
      throw new ValidationError('Supplier ID is required.');
    }
  }

  public static validateDate(dateStr?: string, fieldName = 'asOfDate'): void {
    if (dateStr && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new ValidationError(`Invalid ${fieldName} '${dateStr}'. Must be SQL DATE format 'YYYY-MM-DD'.`);
    }
  }

  public static validateStatementQuery(ctx: RequestContext, companyId: string, input: SupplierStatementQueryInput): void {
    this.validateCompanyContext(ctx, companyId);
    this.validateSupplierContext(input.supplierId);

    if (!input.fromDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.fromDate)) {
      throw new ValidationError(`Invalid statement fromDate '${input.fromDate}'. Must be SQL DATE format 'YYYY-MM-DD'.`);
    }

    if (!input.toDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.toDate)) {
      throw new ValidationError(`Invalid statement toDate '${input.toDate}'. Must be SQL DATE format 'YYYY-MM-DD'.`);
    }

    if (input.fromDate > input.toDate) {
      throw new ValidationError(`Statement fromDate '${input.fromDate}' cannot be after toDate '${input.toDate}'.`);
    }
  }
}
