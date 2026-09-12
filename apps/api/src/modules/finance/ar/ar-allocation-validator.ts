import {
  RequestContext,
  ValidationError,
  ExactDecimal
} from '@general-erp/core';
import { CreateArAllocationInput } from './ar-allocation-model.js';

export class ArAllocationValidator {
  public static validateCreateInput(ctx: RequestContext, input: CreateArAllocationInput): void {
    if (!ctx.tenantId) {
      throw new ValidationError('RequestContext tenantId is required.');
    }

    if (!input.openItemId || input.openItemId.trim() === '') {
      throw new ValidationError('Allocation target openItemId is required.');
    }

    if (!input.allocationSourceType) {
      throw new ValidationError('Allocation source type is required.');
    }

    // Source Exclusivity Check
    if (input.allocationSourceType === 'RECEIPT') {
      if (!input.receiptId || input.receiptId.trim() === '') {
        throw new ValidationError('Allocation receiptId is required when allocationSourceType is RECEIPT.');
      }
      if (input.creditNoteId && input.creditNoteId.trim() !== '') {
        throw new ValidationError('Allocation creditNoteId must be null or omitted when allocationSourceType is RECEIPT.');
      }
    } else if (input.allocationSourceType === 'CREDIT_NOTE') {
      if (!input.creditNoteId || input.creditNoteId.trim() === '') {
        throw new ValidationError('Allocation creditNoteId is required when allocationSourceType is CREDIT_NOTE.');
      }
      if (input.receiptId && input.receiptId.trim() !== '') {
        throw new ValidationError('Allocation receiptId must be null or omitted when allocationSourceType is CREDIT_NOTE.');
      }
    } else {
      throw new ValidationError(`Invalid allocationSourceType '${input.allocationSourceType}'. Allowed values: 'RECEIPT', 'CREDIT_NOTE'.`);
    }

    if (input.allocationDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.allocationDate)) {
      throw new ValidationError(`Invalid allocationDate '${input.allocationDate}'. Must be SQL DATE format 'YYYY-MM-DD'.`);
    }

    if (!input.allocatedAmount || input.allocatedAmount.trim() === '') {
      throw new ValidationError('Allocation allocatedAmount is required.');
    }

    // Exact Decimal Scale & Positive Check for allocatedAmount
    ExactDecimal.validateScale(input.allocatedAmount, 2);
    const amountDec = ExactDecimal.parse(input.allocatedAmount, 2);
    if (!amountDec.isPositive()) {
      throw new ValidationError(`Allocation allocatedAmount must be positive (> 0.00). Provided: '${input.allocatedAmount}'.`);
    }

    // Exact Decimal Scale & Non-negative Check for discountAmount (if provided)
    if (input.discountAmount && input.discountAmount.trim() !== '') {
      ExactDecimal.validateScale(input.discountAmount, 2);
      const discountDec = ExactDecimal.parse(input.discountAmount, 2);
      if (discountDec.isNegative()) {
        throw new ValidationError(`Allocation discountAmount cannot be negative (< 0.00). Provided: '${input.discountAmount}'.`);
      }
    }
  }
}
