import { RequestContext, ValidationError, ForbiddenError, ExactDecimal } from '@general-erp/core';
import { masterDataService } from '../../../platform/master-data/master-data.service.js';
import { CreateArDocumentInput, CreateArDocumentLineInput, ArDocumentType } from './ar-document-model.js';

export class ArDocumentValidator {

  public static validateContext(ctx: RequestContext, companyId: string): void {
    if (!ctx.tenantId || ctx.tenantId.trim() === '') {
      throw new ValidationError('RequestContext tenantId is required.');
    }
    if (!companyId || companyId.trim() === '') {
      throw new ValidationError('AR document companyId is required.');
    }
    if (ctx.companyId && ctx.companyId !== companyId) {
      throw new ForbiddenError(`Tenant/Company context mismatch. Request companyId '${ctx.companyId}' does not match document companyId '${companyId}'.`);
    }
  }

  public static async validateCustomer(ctx: RequestContext, companyId: string, customerId: string): Promise<void> {
    if (!customerId || customerId.trim() === '') {
      throw new ValidationError('Customer ID is required for AR document.');
    }
    const customer = await masterDataService.getCustomer(ctx, customerId);
    if (customer.companyId !== companyId) {
      throw new ForbiddenError(`Customer '${customerId}' belongs to company '${customer.companyId}', not document company '${companyId}'.`);
    }
  }

  public static validateDocumentType(type: string): ArDocumentType {
    const validTypes: ArDocumentType[] = ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'OPENING_BALANCE'];
    if (!validTypes.includes(type as ArDocumentType)) {
      throw new ValidationError(`Invalid AR documentType '${type}'. Must be one of: ${validTypes.join(', ')}.`);
    }
    return type as ArDocumentType;
  }

  public static validateDates(documentDate: string, accountingDate: string, dueDate: string): void {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(documentDate)) {
      throw new ValidationError(`Invalid documentDate format '${documentDate}'. Must be YYYY-MM-DD.`);
    }
    if (!dateRegex.test(accountingDate)) {
      throw new ValidationError(`Invalid accountingDate format '${accountingDate}'. Must be YYYY-MM-DD.`);
    }
    if (!dateRegex.test(dueDate)) {
      throw new ValidationError(`Invalid dueDate format '${dueDate}'. Must be YYYY-MM-DD.`);
    }

    if (dueDate < documentDate) {
      throw new ValidationError(`Due date '${dueDate}' cannot be earlier than document date '${documentDate}'.`);
    }
  }

  public static validateLineAmountsAndScale(line: CreateArDocumentLineInput, seq: number): {
    quantity: ExactDecimal;
    unitPrice: ExactDecimal;
    taxableAmount: ExactDecimal;
    taxRatePercent: ExactDecimal;
    cgstAmount: ExactDecimal;
    sgstAmount: ExactDecimal;
    igstAmount: ExactDecimal;
    utgstAmount: ExactDecimal;
    cessAmount: ExactDecimal;
    taxAmount: ExactDecimal;
    grossAmount: ExactDecimal;
  } {
    if (!line.description || line.description.trim() === '') {
      throw new ValidationError(`Line ${seq} description is required.`);
    }

    ExactDecimal.validateScale(line.quantity, 4);
    ExactDecimal.validateScale(line.unitPrice, 2);

    const qty = ExactDecimal.parse(line.quantity, 4);
    const price = ExactDecimal.parse(line.unitPrice, 2);

    if (qty.isNegative() || qty.isZero()) {
      throw new ValidationError(`Line ${seq} quantity '${line.quantity}' must be greater than zero.`);
    }
    if (price.isNegative()) {
      throw new ValidationError(`Line ${seq} unit price '${line.unitPrice}' cannot be negative.`);
    }

    // Default or user-supplied line amounts
    const qtyNum = parseFloat(line.quantity);
    const priceNum = parseFloat(line.unitPrice);
    const taxableInput = line.taxableAmount ?? (qtyNum * priceNum).toFixed(2);
    ExactDecimal.validateScale(taxableInput, 2);
    const taxable = ExactDecimal.parse(taxableInput, 2);

    const taxRateStr = line.taxRatePercent ?? '0.000000';
    ExactDecimal.validateScale(taxRateStr, 6);
    const taxRate = ExactDecimal.parse(taxRateStr, 6);

    const cgstStr = line.cgstAmount ?? '0.00';
    const sgstStr = line.sgstAmount ?? '0.00';
    const igstStr = line.igstAmount ?? '0.00';
    const utgstStr = line.utgstAmount ?? '0.00';
    const cessStr = line.cessAmount ?? '0.00';

    ExactDecimal.validateScale(cgstStr, 2);
    ExactDecimal.validateScale(sgstStr, 2);
    ExactDecimal.validateScale(igstStr, 2);
    ExactDecimal.validateScale(utgstStr, 2);
    ExactDecimal.validateScale(cessStr, 2);

    const cgst = ExactDecimal.parse(cgstStr, 2);
    const sgst = ExactDecimal.parse(sgstStr, 2);
    const igst = ExactDecimal.parse(igstStr, 2);
    const utgst = ExactDecimal.parse(utgstStr, 2);
    const cess = ExactDecimal.parse(cessStr, 2);

    const calcTaxSum = cgst.add(sgst).add(igst).add(utgst).add(cess);
    const taxAmountInput = line.taxAmount ?? calcTaxSum.toString();
    ExactDecimal.validateScale(taxAmountInput, 2);
    const taxAmount = ExactDecimal.parse(taxAmountInput, 2);

    if (!taxAmount.equals(calcTaxSum)) {
      throw new ValidationError(`Line ${seq} taxAmount '${taxAmount.toString()}' does not equal component tax sum '${calcTaxSum.toString()}'.`);
    }

    const calcGross = taxable.add(taxAmount);
    const grossInput = line.grossAmount ?? calcGross.toString();
    ExactDecimal.validateScale(grossInput, 2);
    const grossAmount = ExactDecimal.parse(grossInput, 2);

    if (!grossAmount.equals(calcGross)) {
      throw new ValidationError(`Line ${seq} grossAmount '${grossAmount.toString()}' does not equal taxable ('${taxable.toString()}') + tax ('${taxAmount.toString()}').`);
    }

    return {
      quantity: qty,
      unitPrice: price,
      taxableAmount: taxable,
      taxRatePercent: taxRate,
      cgstAmount: cgst,
      sgstAmount: sgst,
      igstAmount: igst,
      utgstAmount: utgst,
      cessAmount: cess,
      taxAmount,
      grossAmount
    };
  }

  public static validateCreateInput(ctx: RequestContext, input: CreateArDocumentInput): void {
    this.validateContext(ctx, input.companyId);
    this.validateDocumentType(input.documentType);
    this.validateDates(input.documentDate, input.accountingDate, input.dueDate);

    if (input.currency && input.currency !== 'INR') {
      throw new ValidationError(`Phase 2.6 AR enforces single-currency INR scope. Received currency '${input.currency}'.`);
    }
    if (input.exchangeRate && input.exchangeRate !== '1.000000') {
      throw new ValidationError(`Phase 2.6 AR enforces single-currency exchange rate '1.000000'. Received '${input.exchangeRate}'.`);
    }

    if (!input.lines || !Array.isArray(input.lines) || input.lines.length === 0) {
      throw new ValidationError('AR document must contain at least one line.');
    }
  }
}
