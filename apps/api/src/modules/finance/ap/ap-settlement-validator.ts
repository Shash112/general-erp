import {
  RequestContext,
  ValidationError,
  ForbiddenError
} from '@general-erp/core';

export class ApSettlementValidator {
  /**
   * Validates tenant and company context isolation for AP settlement operations
   */
  public static validateCompanyContext(ctx: RequestContext, companyId: string): void {
    if (!ctx.tenantId || ctx.tenantId.trim() === '') {
      throw new ValidationError('RequestContext tenantId is required for AP settlement operations.');
    }
    if (!companyId || companyId.trim() === '') {
      throw new ValidationError('CompanyId is required for AP settlement operations.');
    }
    if (ctx.companyId && ctx.companyId !== companyId) {
      throw new ForbiddenError(
        `Tenant/Company context mismatch. Request companyId '${ctx.companyId}' does not match target companyId '${companyId}'.`
      );
    }
  }

  /**
   * Validates supplier context parameter
   */
  public static validateSupplierContext(supplierId: string): void {
    if (!supplierId || supplierId.trim() === '') {
      throw new ValidationError('SupplierId is required for supplier settlement summary.');
    }
  }

  /**
   * Validates SQL DATE format 'YYYY-MM-DD' for optional asOfDate
   */
  public static validateAsOfDate(asOfDate?: string | undefined): void {
    if (asOfDate && !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
      throw new ValidationError(`Invalid asOfDate format '${asOfDate}'. Must be SQL DATE format 'YYYY-MM-DD'.`);
    }
  }
}
