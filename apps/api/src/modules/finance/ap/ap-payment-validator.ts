import {
  RequestContext,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ExactDecimal
} from '@general-erp/core';
import { masterDataService } from '../../../platform/master-data/master-data.service.js';
import { chartOfAccountsService } from '../chart-of-accounts.service.js';
import { CreateApPaymentInput, ApPaymentMode } from './ap-payment-model.js';

export class ApPaymentValidator {
  private static readonly VALID_PAYMENT_MODES: ApPaymentMode[] = [
    'CASH',
    'BANK_TRANSFER',
    'CHEQUE',
    'UPI',
    'OTHER'
  ];

  public static validateCreateInput(ctx: RequestContext, input: CreateApPaymentInput): void {
    if (!ctx.tenantId) {
      throw new ValidationError('RequestContext tenantId is required.');
    }
    if (!input.companyId || input.companyId.trim() === '') {
      throw new ValidationError('Payment companyId is required.');
    }
    if (ctx.companyId && ctx.companyId !== input.companyId) {
      throw new ForbiddenError(
        `Tenant/Company context mismatch. Request companyId '${ctx.companyId}' does not match payment companyId '${input.companyId}'.`
      );
    }

    if (!input.supplierId || input.supplierId.trim() === '') {
      throw new ValidationError('Payment supplierId is required.');
    }

    if (!input.paymentDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate)) {
      throw new ValidationError(`Invalid paymentDate '${input.paymentDate}'. Must be SQL DATE format 'YYYY-MM-DD'.`);
    }
    if (!input.accountingDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.accountingDate)) {
      throw new ValidationError(`Invalid accountingDate '${input.accountingDate}'. Must be SQL DATE format 'YYYY-MM-DD'.`);
    }

    if (!this.VALID_PAYMENT_MODES.includes(input.paymentMode)) {
      throw new ValidationError(`Invalid paymentMode '${input.paymentMode}'. Allowed values: ${this.VALID_PAYMENT_MODES.join(', ')}.`);
    }

    if (!input.bankAccountId || input.bankAccountId.trim() === '') {
      throw new ValidationError('Payment bank/cash accountId is required.');
    }

    if (!input.totalAmount || input.totalAmount.trim() === '') {
      throw new ValidationError('Payment totalAmount is required.');
    }

    // Exact Decimal Scale & Positive Check
    ExactDecimal.validateScale(input.totalAmount, 2);
    const amountDec = ExactDecimal.parse(input.totalAmount, 2);
    if (!amountDec.isPositive()) {
      throw new ValidationError(`Payment totalAmount must be positive (> 0.00). Provided: '${input.totalAmount}'.`);
    }
  }

  public static async validateSupplier(ctx: RequestContext, companyId: string, supplierId: string): Promise<void> {
    const supplier = await masterDataService.getSupplier(ctx, supplierId);
    if (supplier.companyId !== companyId) {
      throw new ForbiddenError(`Supplier '${supplierId}' belongs to company '${supplier.companyId}', not payment company '${companyId}'.`);
    }
  }

  public static async validatePayingAccount(ctx: RequestContext, companyId: string, bankAccountId: string): Promise<void> {
    try {
      const account = await chartOfAccountsService.getAccountById(ctx, bankAccountId);
      if (account.companyId !== companyId) {
        throw new ValidationError(`Paying account '${bankAccountId}' belongs to company '${account.companyId}', not payment company '${companyId}'.`);
      }

      const eligibility = await chartOfAccountsService.assertAccountEligibilityForPosting(ctx, bankAccountId);
      if (!eligibility.isEligibleForPosting) {
        throw new ValidationError(
          eligibility.ineligibilityReason || `Account '${account.accountCode}' is inactive or not eligible for posting.`
        );
      }
    } catch (err) {
      if (err instanceof NotFoundError) {
        throw new ValidationError(`Paying bank/cash account '${bankAccountId}' was not found for this tenant/company.`);
      }
      throw err;
    }
  }
}
