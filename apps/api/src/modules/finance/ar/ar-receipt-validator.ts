import {
  RequestContext,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ExactDecimal
} from '@general-erp/core';
import { masterDataService } from '../../../platform/master-data/master-data.service.js';
import { chartOfAccountsService } from '../chart-of-accounts.service.js';
import { CreateArReceiptInput, ArPaymentMode } from './ar-receipt-model.js';

export class ArReceiptValidator {
  private static readonly VALID_PAYMENT_MODES: ArPaymentMode[] = [
    'CASH',
    'BANK_TRANSFER',
    'CHEQUE',
    'UPI',
    'OTHER'
  ];

  public static validateCreateInput(ctx: RequestContext, input: CreateArReceiptInput): void {
    if (!ctx.tenantId) {
      throw new ValidationError('RequestContext tenantId is required.');
    }
    if (!input.companyId || input.companyId.trim() === '') {
      throw new ValidationError('Receipt companyId is required.');
    }
    if (ctx.companyId && ctx.companyId !== input.companyId) {
      throw new ForbiddenError(`Tenant/Company context mismatch. Request companyId '${ctx.companyId}' does not match receipt companyId '${input.companyId}'.`);
    }

    if (!input.customerId || input.customerId.trim() === '') {
      throw new ValidationError('Receipt customerId is required.');
    }

    if (!input.receiptDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.receiptDate)) {
      throw new ValidationError(`Invalid receiptDate '${input.receiptDate}'. Must be SQL DATE format 'YYYY-MM-DD'.`);
    }
    if (!input.accountingDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.accountingDate)) {
      throw new ValidationError(`Invalid accountingDate '${input.accountingDate}'. Must be SQL DATE format 'YYYY-MM-DD'.`);
    }

    if (!this.VALID_PAYMENT_MODES.includes(input.paymentMode)) {
      throw new ValidationError(`Invalid paymentMode '${input.paymentMode}'. Allowed values: ${this.VALID_PAYMENT_MODES.join(', ')}.`);
    }

    if (!input.bankAccountId || input.bankAccountId.trim() === '') {
      throw new ValidationError('Receipt receiving bank/cash accountId is required.');
    }

    if (!input.totalAmount || input.totalAmount.trim() === '') {
      throw new ValidationError('Receipt totalAmount is required.');
    }

    // Exact Decimal Scale & Positive Check
    ExactDecimal.validateScale(input.totalAmount, 2);
    const amountDec = ExactDecimal.parse(input.totalAmount, 2);
    if (!amountDec.isPositive()) {
      throw new ValidationError(`Receipt totalAmount must be positive (> 0.00). Provided: '${input.totalAmount}'.`);
    }
  }

  public static async validateCustomer(ctx: RequestContext, companyId: string, customerId: string): Promise<void> {
    const customer = await masterDataService.getCustomer(ctx, customerId);
    if (customer.companyId !== companyId) {
      throw new ForbiddenError(`Customer '${customerId}' belongs to company '${customer.companyId}', not receipt company '${companyId}'.`);
    }
  }

  public static async validateReceivingAccount(ctx: RequestContext, companyId: string, bankAccountId: string): Promise<void> {
    try {
      const account = await chartOfAccountsService.getAccountById(ctx, bankAccountId);
      if (account.companyId !== companyId) {
        throw new ValidationError(`Receiving account '${bankAccountId}' belongs to company '${account.companyId}', not receipt company '${companyId}'.`);
      }

      const eligibility = await chartOfAccountsService.assertAccountEligibilityForPosting(ctx, bankAccountId);
      if (!eligibility.isEligibleForPosting) {
        throw new ValidationError(
          eligibility.ineligibilityReason || `Account '${account.accountCode}' is inactive or not eligible for posting.`
        );
      }
    } catch (err) {
      if (err instanceof NotFoundError) {
        throw new ValidationError(`Receiving bank/cash account '${bankAccountId}' was not found for this tenant/company.`);
      }
      throw err;
    }
  }
}
