import {
  RequestContext,
  ValidationError,
  ForbiddenError
} from '@general-erp/core';

export class ArSettlementValidator {
  public static validateCompanyContext(ctx: RequestContext, companyId: string): void {
    if (!ctx.tenantId) {
      throw new ValidationError('RequestContext tenantId is required.');
    }
    if (!companyId || companyId.trim() === '') {
      throw new ValidationError('CompanyId is required for settlement operations.');
    }
    if (ctx.companyId && ctx.companyId !== companyId) {
      throw new ForbiddenError(
        `Tenant/Company context mismatch. Request companyId '${ctx.companyId}' does not match target companyId '${companyId}'.`
      );
    }
  }

  public static validateCustomerContext(customerId: string): void {
    if (!customerId || customerId.trim() === '') {
      throw new ValidationError('CustomerId is required for customer settlement summary.');
    }
  }
}
