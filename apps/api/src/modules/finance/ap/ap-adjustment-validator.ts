import {
  RequestContext,
  ValidationError,
  ExactDecimal
} from '@general-erp/core';
import { CreateApAdjustmentInput, ApAdjustmentType } from './ap-adjustment-model.js';

export class ApAdjustmentValidator {
  private static readonly VALID_ADJUSTMENT_TYPES: ApAdjustmentType[] = [
    'WRITE_OFF',
    'CREDIT_ADJUSTMENT',
    'DEBIT_ADJUSTMENT'
  ];

  /**
   * Validate creation input for an AP Adjustment
   */
  public static validateCreateInput(_ctx: RequestContext, input: CreateApAdjustmentInput): void {
    if (!input) {
      throw new ValidationError('Adjustment input is required.');
    }

    if (!input.supplierId || input.supplierId.trim() === '') {
      throw new ValidationError('supplierId is required.');
    }

    if (!input.openItemId || input.openItemId.trim() === '') {
      throw new ValidationError('openItemId is required.');
    }

    if (!input.adjustmentType || !this.VALID_ADJUSTMENT_TYPES.includes(input.adjustmentType)) {
      throw new ValidationError(
        `Invalid adjustmentType '${input.adjustmentType}'. Allowed values: 'WRITE_OFF', 'CREDIT_ADJUSTMENT', 'DEBIT_ADJUSTMENT'.`
      );
    }

    if (!input.reason || input.reason.trim() === '') {
      throw new ValidationError('Adjustment reason is required.');
    }

    ExactDecimal.validateScale(input.amount, 2);
    const amountDec = ExactDecimal.parse(input.amount, 2);

    if (!amountDec.isPositive()) {
      throw new ValidationError(`Adjustment amount must be positive (> 0.00). Provided: '${input.amount}'.`);
    }

    if (input.adjustmentDate) {
      this.validateDateFormat(input.adjustmentDate, 'adjustmentDate');
    }

    if (input.accountingDate) {
      this.validateDateFormat(input.accountingDate, 'accountingDate');
    }
  }

  /**
   * Validate date format YYYY-MM-DD
   */
  public static validateDateFormat(dateStr: string, fieldName: string): void {
    if (!dateStr || dateStr.trim() === '') {
      throw new ValidationError(`${fieldName} is required.`);
    }
    const isoRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoRegex.test(dateStr)) {
      throw new ValidationError(`Invalid ${fieldName} format '${dateStr}'. Must be SQL DATE format 'YYYY-MM-DD'.`);
    }
    const parsed = new Date(dateStr);
    if (isNaN(parsed.getTime())) {
      throw new ValidationError(`Invalid ${fieldName} date value '${dateStr}'.`);
    }
  }
}
