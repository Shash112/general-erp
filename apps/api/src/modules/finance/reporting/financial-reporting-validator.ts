import { RequestContext, ValidationError } from '@general-erp/core';

export class FinancialReportingValidator {
  public static validateCompanyContext(ctx: RequestContext, companyId?: string): string {
    if (!ctx.tenantId) {
      throw new ValidationError('RequestContext tenantId is required.');
    }

    const resolvedCompanyId = companyId || ctx.companyId;
    if (!resolvedCompanyId || resolvedCompanyId.trim() === '') {
      throw new ValidationError('Company ID is required for financial reporting.');
    }

    if (ctx.companyId && ctx.companyId !== resolvedCompanyId) {
      throw new ValidationError(`Company access denied. Requested company '${resolvedCompanyId}' does not match context company '${ctx.companyId}'.`);
    }

    return resolvedCompanyId;
  }

  public static validateDateString(dateStr?: string, fieldName = 'date'): string | undefined {
    if (!dateStr) return undefined;
    const trimmed = dateStr.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      throw new ValidationError(`Invalid ${fieldName} format '${dateStr}'. Expected SQL DATE format 'YYYY-MM-DD'.`);
    }
    const d = new Date(trimmed);
    if (isNaN(d.getTime())) {
      throw new ValidationError(`Invalid ${fieldName} value '${dateStr}'.`);
    }
    return trimmed;
  }

  public static validateDateRange(fromDate?: string, toDate?: string): { fromDate?: string | undefined; toDate?: string | undefined } {
    const validatedFrom = this.validateDateString(fromDate, 'fromDate');
    const validatedTo = this.validateDateString(toDate, 'toDate');

    if (validatedFrom && validatedTo) {
      if (new Date(validatedFrom) > new Date(validatedTo)) {
        throw new ValidationError(`fromDate '${validatedFrom}' must be earlier than or equal to toDate '${validatedTo}'.`);
      }
    }

    return { fromDate: validatedFrom, toDate: validatedTo };
  }

  public static validatePagination(page?: number, limit?: number): { page: number; limit: number } {
    const validPage = page && page > 0 ? Math.floor(page) : 1;
    let validLimit = limit && limit > 0 ? Math.floor(limit) : 50;

    if (validLimit > 200) {
      validLimit = 200; // Cap maximum limit to 200 for memory and performance safety
    }

    return { page: validPage, limit: validLimit };
  }
}
