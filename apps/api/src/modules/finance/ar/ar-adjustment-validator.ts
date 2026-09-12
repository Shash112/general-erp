import {
  RequestContext,
  ValidationError,
  ExactDecimal
} from '@general-erp/core';
import { CreateArAdjustmentInput } from './ar-adjustment-model.js';

export class ArAdjustmentValidator {
  public static validateCreateInput(ctx: RequestContext, input: CreateArAdjustmentInput): void {
    if (!ctx.tenantId) {
      throw new ValidationError('RequestContext tenantId is required.');
    }

    if (!input.customerId || input.customerId.trim() === '') {
      throw new ValidationError('Adjustment customerId is required.');
    }

    if (!input.openItemId || input.openItemId.trim() === '') {
      throw new ValidationError('Adjustment target openItemId is required.');
    }

    if (!input.adjustmentType) {
      throw new ValidationError('Adjustment adjustmentType is required.');
    }

    const validTypes = ['WRITE_OFF', 'CREDIT_ADJUSTMENT', 'DEBIT_ADJUSTMENT'];
    if (!validTypes.includes(input.adjustmentType)) {
      throw new ValidationError(
        `Invalid adjustmentType '${input.adjustmentType}'. Allowed values: ${validTypes.map(t => `'${t}'`).join(', ')}.`
      );
    }

    if (!input.reason || input.reason.trim() === '') {
      throw new ValidationError('Adjustment reason / business justification is required.');
    }

    if (!input.amount || input.amount.trim() === '') {
      throw new ValidationError('Adjustment amount is required.');
    }

    // Exact Decimal Scale & Positive Check for amount
    ExactDecimal.validateScale(input.amount, 2);
    const amountDec = ExactDecimal.parse(input.amount, 2);
    if (!amountDec.isPositive()) {
      throw new ValidationError(`Adjustment amount must be positive (> 0.00). Provided: '${input.amount}'.`);
    }
  }

  public static validateCompanyContext(ctx: RequestContext, companyId: string): void {
    if (!ctx.tenantId) {
      throw new ValidationError('RequestContext tenantId is required.');
    }
    if (!companyId || companyId.trim() === '') {
      throw new ValidationError('Company context companyId is required.');
    }
  }
}
