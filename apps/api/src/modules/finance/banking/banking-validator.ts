import {
  RequestContext,
  ValidationError,
  BusinessRuleViolationError,
  ExactDecimal
} from '@general-erp/core';
import { chartOfAccountsService } from '../chart-of-accounts.service.js';
import {
  CreateBankAccountInput,
  CreateCashAccountInput,
  CreatePaymentVoucherInput,
  CreateReceiptVoucherInput,
  CreateTransferVoucherInput
} from './banking-model.js';

export class BankingValidator {
  /**
   * Masks a raw bank account number showing only the last 4 digits.
   */
  public static maskAccountNumber(rawNumber: string): string {
    const trimmed = rawNumber.trim();
    if (trimmed.length <= 4) {
      return `****${trimmed}`;
    }
    const last4 = trimmed.substring(trimmed.length - 4);
    return `XXXX-XXXX-${last4}`;
  }

  /**
   * Validates that no sensitive credentials (passwords, PINs, secrets) are being sent.
   */
  public static validateNoCredentials(input: Record<string, any>): void {
    const forbiddenKeys = ['password', 'pin', 'otp', 'cvv', 'secret', 'apiSecret'];
    for (const key of Object.keys(input)) {
      if (forbiddenKeys.some(fk => key.toLowerCase().includes(fk))) {
        throw new ValidationError(`Security violation: Field '${key}' contains forbidden banking credentials.`);
      }
    }
  }

  /**
   * Validates date format YYYY-MM-DD
   */
  public static validateDateString(dateStr: string, fieldName: string): void {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new ValidationError(`Invalid ${fieldName} format '${dateStr}'. Expected YYYY-MM-DD.`);
    }
    const parsed = new Date(dateStr);
    if (isNaN(parsed.getTime())) {
      throw new ValidationError(`Invalid ${fieldName} date value '${dateStr}'.`);
    }
  }

  /**
   * Validates positive monetary amount string using ExactDecimal
   */
  public static validateAmount(amount: string, fieldName: string = 'amount'): ExactDecimal {
    if (!amount || typeof amount !== 'string') {
      throw new ValidationError(`${fieldName} must be a valid non-empty string.`);
    }
    ExactDecimal.validateScale(amount, 2);
    const dec = ExactDecimal.parse(amount, 2);
    if (!dec.isPositive()) {
      throw new BusinessRuleViolationError(`${fieldName} must be a positive decimal greater than 0.00. Provided: '${amount}'.`);
    }
    return dec;
  }

  /**
   * Validates GL account for bank/cash account mapping
   */
  public static async validateGLAccount(ctx: RequestContext, companyId: string, glAccountId: string): Promise<void> {
    const account = await chartOfAccountsService.assertAccountEligibilityForPosting(ctx, glAccountId);
    if (account.companyId !== companyId) {
      throw new ValidationError(`GL account '${account.accountCode}' does not belong to company '${companyId}'.`);
    }
    if (!account.isEligibleForPosting) {
      throw new BusinessRuleViolationError(
        account.ineligibilityReason || `GL account '${account.accountCode}' is not eligible for posting.`
      );
    }
  }

  /**
   * Validates Bank Account Create Input
   */
  public static validateCreateBankAccount(_ctx: RequestContext, input: CreateBankAccountInput): void {
    if (!input.companyId) throw new ValidationError('Company ID is required for bank account creation.');
    if (!input.accountName || input.accountName.trim() === '') throw new ValidationError('Account name is required.');
    if (!input.bankName || input.bankName.trim() === '') throw new ValidationError('Bank name is required.');
    if (!input.accountNumber || input.accountNumber.trim() === '') throw new ValidationError('Account number is required.');
    if (!input.glAccountId) throw new ValidationError('GL account ID is required for bank account creation.');
    this.validateNoCredentials(input);
    if (input.openingBalance) {
      ExactDecimal.validateScale(input.openingBalance, 2);
    }
  }

  /**
   * Validates Cash Account Create Input
   */
  public static validateCreateCashAccount(_ctx: RequestContext, input: CreateCashAccountInput): void {
    if (!input.companyId) throw new ValidationError('Company ID is required for cash account creation.');
    if (!input.accountName || input.accountName.trim() === '') throw new ValidationError('Account name is required.');
    if (!input.glAccountId) throw new ValidationError('GL account ID is required for cash account creation.');
    this.validateNoCredentials(input);
  }

  /**
   * Validates Payment Voucher Input
   */
  public static validatePaymentVoucherInput(_ctx: RequestContext, input: CreatePaymentVoucherInput): void {
    if (!input.companyId) throw new ValidationError('Company ID is required for payment voucher.');
    this.validateDateString(input.transactionDate, 'transactionDate');
    if (input.accountingDate) this.validateDateString(input.accountingDate, 'accountingDate');
    this.validateAmount(input.amount, 'amount');

    const hasBank = Boolean(input.bankAccountId);
    const hasCash = Boolean(input.cashAccountId);
    if ((hasBank && hasCash) || (!hasBank && !hasCash)) {
      throw new ValidationError('Payment voucher must specify exactly one paying account: either bankAccountId or cashAccountId.');
    }

    const hasCounter = Boolean(input.counterAccountId);
    const hasLines = Boolean(input.lines && input.lines.length > 0);
    if (!hasCounter && !hasLines) {
      throw new ValidationError('Payment voucher must specify either counterAccountId or line items.');
    }
    this.validateNoCredentials(input);
  }

  /**
   * Validates Receipt Voucher Input
   */
  public static validateReceiptVoucherInput(_ctx: RequestContext, input: CreateReceiptVoucherInput): void {
    if (!input.companyId) throw new ValidationError('Company ID is required for receipt voucher.');
    this.validateDateString(input.transactionDate, 'transactionDate');
    if (input.accountingDate) this.validateDateString(input.accountingDate, 'accountingDate');
    this.validateAmount(input.amount, 'amount');

    const hasBank = Boolean(input.bankAccountId);
    const hasCash = Boolean(input.cashAccountId);
    if ((hasBank && hasCash) || (!hasBank && !hasCash)) {
      throw new ValidationError('Receipt voucher must specify exactly one receiving account: either bankAccountId or cashAccountId.');
    }

    const hasCounter = Boolean(input.counterAccountId);
    const hasLines = Boolean(input.lines && input.lines.length > 0);
    if (!hasCounter && !hasLines) {
      throw new ValidationError('Receipt voucher must specify either counterAccountId or line items.');
    }
    this.validateNoCredentials(input);
  }

  /**
   * Validates Transfer Voucher Input
   */
  public static validateTransferVoucherInput(_ctx: RequestContext, input: CreateTransferVoucherInput): void {
    if (!input.companyId) throw new ValidationError('Company ID is required for transfer voucher.');
    this.validateDateString(input.transactionDate, 'transactionDate');
    if (input.accountingDate) this.validateDateString(input.accountingDate, 'accountingDate');
    this.validateAmount(input.amount, 'amount');

    const hasSrcBank = Boolean(input.sourceBankAccountId);
    const hasSrcCash = Boolean(input.sourceCashAccountId);
    if ((hasSrcBank && hasSrcCash) || (!hasSrcBank && !hasSrcCash)) {
      throw new ValidationError('Transfer voucher must specify exactly one source account: either sourceBankAccountId or sourceCashAccountId.');
    }

    const hasDstBank = Boolean(input.destinationBankAccountId);
    const hasDstCash = Boolean(input.destinationCashAccountId);
    if ((hasDstBank && hasDstCash) || (!hasDstBank && !hasDstCash)) {
      throw new ValidationError('Transfer voucher must specify exactly one destination account: either destinationBankAccountId or destinationCashAccountId.');
    }

    const srcId = input.sourceBankAccountId || input.sourceCashAccountId;
    const dstId = input.destinationBankAccountId || input.destinationCashAccountId;
    if (srcId === dstId) {
      throw new BusinessRuleViolationError('Transfer source account and destination account cannot be identical.');
    }
    this.validateNoCredentials(input);
  }
}
