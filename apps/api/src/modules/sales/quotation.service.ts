import crypto from 'crypto';
import {
  RequestContext,
  ValidationError,
  ForbiddenError,
  NotFoundError,
  ConflictError
} from '@general-erp/core';
import { auditService } from '../../platform/audit/audit.service.js';
import { customerService } from '../commercial/customer.service.js';
import { productService } from '../commercial/product.service.js';
import { addressService } from '../commercial/address.service.js';
import { contactService } from '../commercial/contact.service.js';
import { pricingService } from '../commercial/pricing.service.js';
import { taxEngineService } from '../finance/tax-engine.service.js';
import { getDb, salesQuotations, salesQuotationLines, eq, and, ilike, or } from '@general-erp/database';

export interface QuotationLineDTO {
  id: string;
  quotationId: string;
  tenantId: string;
  companyId: string;
  lineNumber: number;
  productId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  description: string | null;
  uom: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  discountAmount: string;
  allocatedHeaderDiscountAmount: string;
  grossAmount: string;
  taxableAmount: string;
  hsnSac: string;
  cgstRate: string;
  cgstAmount: string;
  sgstRate: string;
  sgstAmount: string;
  igstRate: string;
  igstAmount: string;
  taxAmount: string;
  lineTotal: string;
  pricingSource: string;
  pricingRuleId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuotationDTO {
  id: string;
  tenantId: string;
  companyId: string;
  quotationNumber: string;
  revisionNumber: number;
  customerId: string;
  quotationDate: string;
  validityDate: string;
  currency: string;
  exchangeRate: string;
  salesRepresentativeId: string | null;
  pricingListId: string | null;
  billingAddressId: string;
  shippingAddressId: string;
  billingAddressSnapshot: Record<string, any>;
  shippingAddressSnapshot: Record<string, any>;
  contactId: string | null;
  contactSnapshot: Record<string, any> | null;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'REVISED' | 'CANCELLED' | 'CONVERTED';
  notes: string | null;
  termsAndConditions: string | null;
  subtotalAmount: string;
  headerDiscountAmount: string;
  discountAmount: string;
  taxableAmount: string;
  taxAmount: string;
  totalAmount: string;
  totalAmountBase: string;
  conversionContractId: string | null;
  conversionContractIssuedAt: Date | null;
  conversionContractHash: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
  lines: QuotationLineDTO[];
}

export interface QuotationConversionContract {
  contractId: string;
  contractVersion: string;
  issuedAt: string;
  contractHash: string;
  tenantId: string;
  companyId: string;
  quotationId: string;
  quotationNumber: string;
  revisionNumber: number;
  customerId: string;
  currency: string;
  exchangeRate: string;
  billingAddressId: string;
  shippingAddressId: string;
  contactId: string | null;
  billingAddressSnapshot: Record<string, any>;
  shippingAddressSnapshot: Record<string, any>;
  contactSnapshot: Record<string, any> | null;
  salesRepresentativeId: string | null;
  termsAndConditions: string | null;
  subtotalAmount: string;
  lineDiscountAmount: string;
  headerDiscountAmount: string;
  discountAmount: string;
  taxableAmount: string;
  taxAmount: string;
  totalAmount: string;
  totalAmountBase: string;
  lines: Array<{
    quotationLineId: string;
    lineNumber: number;
    productId: string;
    productCodeSnapshot: string;
    productNameSnapshot: string;
    description: string | null;
    uom: string;
    quantity: string;
    unitPrice: string;
    discountPercent: string;
    discountAmount: string;
    allocatedHeaderDiscountAmount: string;
    grossAmount: string;
    taxableAmount: string;
    hsnSac: string;
    cgstRate: string;
    cgstAmount: string;
    sgstRate: string;
    sgstAmount: string;
    igstRate: string;
    igstAmount: string;
    taxAmount: string;
    lineTotal: string;
    pricingSource: string;
    pricingRuleId: string | null;
  }>;
}

export interface CreateQuotationLineInput {
  productId: string;
  description?: string | null;
  uom?: string;
  quantity: number | string;
  unitPrice?: number | string;
  discountPercent?: number | string;
  pricingSource?: string;
  pricingRuleId?: string | null;
}

export interface CreateQuotationInput {
  id?: string;
  companyId: string;
  customerId: string;
  quotationDate: string; // "YYYY-MM-DD"
  validityDate: string;  // "YYYY-MM-DD"
  currency?: string;     // Default 'INR'
  exchangeRate?: number | string; // Default 1.000000
  salesRepresentativeId?: string | null;
  pricingListId?: string | null;
  billingAddressId: string;
  shippingAddressId: string;
  contactId?: string | null;
  notes?: string | null;
  termsAndConditions?: string | null;
  headerDiscountAmount?: number | string;
  lines: CreateQuotationLineInput[];
}

export interface QuotationPolicyConfig {
  maxSalesRepDiscountPercent?: string;
  maxAutoApproveQuotationAmount?: string;
  requireApprovalForManualPriceOverride?: boolean;
  allowExpiredQuotationConversion?: boolean;
}

function roundTo2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

function formatAmount(val: number): string {
  return roundTo2(val).toFixed(2);
}

export class QuotationService {
  private memoryStore = new Map<string, QuotationDTO>();
  private idempotencyStore = new Map<string, QuotationConversionContract>();
  private policyConfig: QuotationPolicyConfig = {
    maxSalesRepDiscountPercent: '10.00',
    maxAutoApproveQuotationAmount: '500000.00',
    requireApprovalForManualPriceOverride: true,
    allowExpiredQuotationConversion: false
  };

  public setPolicyConfig(config: Partial<QuotationPolicyConfig>): void {
    this.policyConfig = { ...this.policyConfig, ...config };
  }

  public getPolicyConfig(): QuotationPolicyConfig {
    return { ...this.policyConfig };
  }

  // --- Calculation Engine ---

  private async calculateQuotationMonetaryFields(
    ctx: RequestContext,
    companyId: string,
    customerId: string,
    _billingAddressId: string,
    shippingAddressId: string,
    currency: string,
    exchangeRateVal: number,
    headerDiscountInput: number,
    linesInput: CreateQuotationLineInput[],
    _pricingListId?: string
  ): Promise<{
    subtotalAmount: string;
    lineDiscountAmount: string;
    headerDiscountAmount: string;
    discountAmount: string;
    taxableAmount: string;
    taxAmount: string;
    totalAmount: string;
    totalAmountBase: string;
    effectiveDiscountPercent: number;
    hasManualOverrideBelowBase: boolean;
    calculatedLines: Array<{
      lineNumber: number;
      productId: string;
      productCodeSnapshot: string;
      productNameSnapshot: string;
      description: string | null;
      uom: string;
      quantity: string;
      unitPrice: string;
      discountPercent: string;
      discountAmount: string;
      allocatedHeaderDiscountAmount: string;
      grossAmount: string;
      taxableAmount: string;
      hsnSac: string;
      cgstRate: string;
      cgstAmount: string;
      sgstRate: string;
      sgstAmount: string;
      igstRate: string;
      igstAmount: string;
      taxAmount: string;
      lineTotal: string;
      pricingSource: string;
      pricingRuleId: string | null;
    }>;
  }> {
    if (linesInput.length === 0) {
      throw new ValidationError('Quotation must contain at least one line item.');
    }

    const shippingAddress = await addressService.getAddress(ctx, shippingAddressId);
    const destinationStateCode = shippingAddress.stateCode || '27';

    let preHeaderTaxableTotalNum = 0;
    let subtotalNum = 0;
    let lineDiscountTotalNum = 0;
    let hasManualOverrideBelowBase = false;

    const interimLines: Array<{
      lineNumber: number;
      productId: string;
      productCodeSnapshot: string;
      productNameSnapshot: string;
      description: string | null;
      uom: string;
      quantityNum: number;
      unitPriceNum: number;
      discountPercentNum: number;
      grossAmountNum: number;
      lineDiscountAmountNum: number;
      preHeaderTaxableAmountNum: number;
      hsnSac: string;
      pricingSource: string;
      pricingRuleId: string | null;
      id: string;
    }> = [];

    for (let idx = 0; idx < linesInput.length; idx++) {
      const line = linesInput[idx]!;
      const lineNumber = idx + 1;

      const product = await productService.getProduct(ctx, line.productId);
      if (!product.isActive || !product.isSellable) {
        throw new ValidationError(`Product '${product.code}' is not active or sellable.`);
      }

      const qty = Number(line.quantity);
      if (isNaN(qty) || qty <= 0) {
        throw new ValidationError(`Line ${lineNumber}: Quantity must be greater than zero.`);
      }

      let priceNum: number;
      let pricingSource = line.pricingSource || 'PRODUCT_DEFAULT';
      let pricingRuleId = line.pricingRuleId || null;

      if (line.unitPrice !== undefined && line.unitPrice !== null) {
        priceNum = Number(line.unitPrice);
        if (isNaN(priceNum) || priceNum < 0) {
          throw new ValidationError(`Line ${lineNumber}: Unit price cannot be negative.`);
        }
        pricingSource = 'MANUAL';
        if (priceNum < Number(product.sellingPrice)) {
          hasManualOverrideBelowBase = true;
        }
      } else {
        const resolved = await pricingService.resolvePrice(ctx, {
          companyId,
          productId: line.productId,
          customerId,
          quantity: qty,
          currency
        });
        priceNum = Number(resolved.unitPrice);
        pricingSource = resolved.source;
        pricingRuleId = resolved.ruleId || null;
      }

      const discPct = Number(line.discountPercent ?? 0);
      if (isNaN(discPct) || discPct < 0 || discPct > 100) {
        throw new ValidationError(`Line ${lineNumber}: Discount percent must be between 0 and 100.`);
      }

      const grossNum = roundTo2(qty * priceNum);
      const lineDiscNum = roundTo2(grossNum * discPct / 100);
      const preHeaderTaxableNum = roundTo2(grossNum - lineDiscNum);

      subtotalNum += grossNum;
      lineDiscountTotalNum += lineDiscNum;
      preHeaderTaxableTotalNum += preHeaderTaxableNum;

      interimLines.push({
        lineNumber,
        productId: product.id,
        productCodeSnapshot: product.code,
        productNameSnapshot: product.name,
        description: line.description || null,
        uom: line.uom || product.baseUom,
        quantityNum: qty,
        unitPriceNum: priceNum,
        discountPercentNum: discPct,
        grossAmountNum: grossNum,
        lineDiscountAmountNum: lineDiscNum,
        preHeaderTaxableAmountNum: preHeaderTaxableNum,
        hsnSac: product.hsnSac || '998311',
        pricingSource,
        pricingRuleId,
        id: `temp_line_${lineNumber}`
      });
    }

    subtotalNum = roundTo2(subtotalNum);
    lineDiscountTotalNum = roundTo2(lineDiscountTotalNum);
    preHeaderTaxableTotalNum = roundTo2(preHeaderTaxableTotalNum);

    const headerDiscNum = roundTo2(headerDiscountInput);
    if (headerDiscNum < 0) {
      throw new ValidationError('Header discount amount cannot be negative.');
    }
    if (headerDiscNum > preHeaderTaxableTotalNum) {
      throw new ValidationError(`Header discount (${headerDiscNum}) cannot exceed total pre-header taxable amount (${preHeaderTaxableTotalNum}).`);
    }

    const allocatedHeaderDiscounts: number[] = new Array(interimLines.length).fill(0);
    let allocatedHeaderSum = 0;

    if (preHeaderTaxableTotalNum > 0 && headerDiscNum > 0) {
      for (let i = 0; i < interimLines.length; i++) {
        const line = interimLines[i]!;
        const alloc = roundTo2(headerDiscNum * (line.preHeaderTaxableAmountNum / preHeaderTaxableTotalNum));
        allocatedHeaderDiscounts[i] = alloc;
        allocatedHeaderSum += alloc;
      }
      allocatedHeaderSum = roundTo2(allocatedHeaderSum);
    }

    const residualCents = roundTo2(headerDiscNum - allocatedHeaderSum);
    if (Math.abs(residualCents) >= 0.001 && interimLines.length > 0) {
      let recipientIndex = 0;
      let maxPreHeaderTaxable = interimLines[0]!.preHeaderTaxableAmountNum;

      for (let i = 1; i < interimLines.length; i++) {
        const cur = interimLines[i]!;
        const candPreHeader = cur.preHeaderTaxableAmountNum;

        if (candPreHeader > maxPreHeaderTaxable) {
          maxPreHeaderTaxable = candPreHeader;
          recipientIndex = i;
        } else if (candPreHeader === maxPreHeaderTaxable) {
          const recipientLine = interimLines[recipientIndex]!;
          if (cur.lineNumber < recipientLine.lineNumber) {
            recipientIndex = i;
          } else if (cur.lineNumber === recipientLine.lineNumber) {
            if (cur.id < recipientLine.id) {
              recipientIndex = i;
            }
          }
        }
      }

      allocatedHeaderDiscounts[recipientIndex] = roundTo2(allocatedHeaderDiscounts[recipientIndex]! + residualCents);
    }

    let taxableTotalNum = 0;
    let taxTotalNum = 0;
    const calculatedLines: any[] = [];

    for (let i = 0; i < interimLines.length; i++) {
      const line = interimLines[i]!;
      const allocHeaderDisc = allocatedHeaderDiscounts[i]!;
      const finalTaxableNum = roundTo2(line.preHeaderTaxableAmountNum - allocHeaderDisc);
      // Tax engine Place of Supply resolution
      const posRes = taxEngineService.resolvePlaceOfSupply({
        supplierStateCode: '27',
        recipientStateCode: destinationStateCode
      });

      const isIntraState = posRes.supplyNature === 'INTRA_STATE';
      const cgstRateNum = isIntraState ? 9 : 0;
      const sgstRateNum = isIntraState ? 9 : 0;
      const igstRateNum = isIntraState ? 0 : 18;

      const cgstAmt = roundTo2(finalTaxableNum * cgstRateNum / 100);
      const sgstAmt = roundTo2(finalTaxableNum * sgstRateNum / 100);
      const igstAmt = roundTo2(finalTaxableNum * igstRateNum / 100);
      const lineTax = roundTo2(cgstAmt + sgstAmt + igstAmt);
      const lineTot = roundTo2(finalTaxableNum + lineTax);

      taxableTotalNum += finalTaxableNum;
      taxTotalNum += lineTax;

      calculatedLines.push({
        lineNumber: line.lineNumber,
        productId: line.productId,
        productCodeSnapshot: line.productCodeSnapshot,
        productNameSnapshot: line.productNameSnapshot,
        description: line.description,
        uom: line.uom,
        quantity: line.quantityNum.toFixed(4),
        unitPrice: line.unitPriceNum.toFixed(4),
        discountPercent: line.discountPercentNum.toFixed(2),
        discountAmount: formatAmount(line.lineDiscountAmountNum),
        allocatedHeaderDiscountAmount: formatAmount(allocHeaderDisc),
        grossAmount: formatAmount(line.grossAmountNum),
        taxableAmount: formatAmount(finalTaxableNum),
        hsnSac: line.hsnSac,
        cgstRate: cgstRateNum.toFixed(2),
        cgstAmount: formatAmount(cgstAmt),
        sgstRate: sgstRateNum.toFixed(2),
        sgstAmount: formatAmount(sgstAmt),
        igstRate: igstRateNum.toFixed(2),
        igstAmount: formatAmount(igstAmt),
        taxAmount: formatAmount(lineTax),
        lineTotal: formatAmount(lineTot),
        pricingSource: line.pricingSource,
        pricingRuleId: line.pricingRuleId
      });
    }

    taxableTotalNum = roundTo2(taxableTotalNum);
    taxTotalNum = roundTo2(taxTotalNum);
    const totalDiscountNum = roundTo2(lineDiscountTotalNum + headerDiscNum);
    const totalAmountNum = roundTo2(taxableTotalNum + taxTotalNum);
    const totalAmountBaseNum = roundTo2(totalAmountNum * exchangeRateVal);
    const effectiveDiscountPercent = subtotalNum > 0 ? roundTo2((totalDiscountNum / subtotalNum) * 100) : 0;

    return {
      subtotalAmount: formatAmount(subtotalNum),
      lineDiscountAmount: formatAmount(lineDiscountTotalNum),
      headerDiscountAmount: formatAmount(headerDiscNum),
      discountAmount: formatAmount(totalDiscountNum),
      taxableAmount: formatAmount(taxableTotalNum),
      taxAmount: formatAmount(taxTotalNum),
      totalAmount: formatAmount(totalAmountNum),
      totalAmountBase: formatAmount(totalAmountBaseNum),
      effectiveDiscountPercent,
      hasManualOverrideBelowBase,
      calculatedLines
    };
  }

  // --- CRUD Operations ---

  async createDraftQuotation(ctx: RequestContext, input: CreateQuotationInput): Promise<QuotationDTO> {
    if (input.companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match request companyId.');
    }

    const customer = await customerService.getCustomer(ctx, input.customerId);
    if (!customer.isActive) {
      throw new ValidationError(`Customer '${customer.name}' is inactive.`);
    }

    const billingAddress = await addressService.getAddress(ctx, input.billingAddressId);
    const shippingAddress = await addressService.getAddress(ctx, input.shippingAddressId);
    let contactSnap: Record<string, any> | null = null;

    if (input.contactId) {
      const contact = await contactService.getContact(ctx, input.contactId);
      contactSnap = {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        designation: contact.designation
      };
    }

    const currency = (input.currency || customer.currency || 'INR').toUpperCase();
    const exRateNum = Number(input.exchangeRate ?? 1.0);
    if (isNaN(exRateNum) || exRateNum <= 0) {
      throw new ValidationError('Exchange rate must be a positive number.');
    }
    if (currency === 'INR' && exRateNum !== 1.0) {
      throw new ValidationError('Exchange rate for base currency (INR) must be 1.000000.');
    }

    const calc = await this.calculateQuotationMonetaryFields(
      ctx,
      input.companyId,
      input.customerId,
      input.billingAddressId,
      input.shippingAddressId,
      currency,
      exRateNum,
      Number(input.headerDiscountAmount ?? 0),
      input.lines,
      input.pricingListId || undefined
    );

    const quotationNumber = `QT-2026-${Math.floor(10000 + Math.random() * 90000)}`;
    const id = input.id || crypto.randomUUID();

    const billingSnap = {
      id: billingAddress.id,
      addressType: billingAddress.addressType,
      addressLine1: billingAddress.addressLine1,
      addressLine2: billingAddress.addressLine2,
      city: billingAddress.city,
      state: billingAddress.state,
      stateCode: billingAddress.stateCode,
      postalCode: billingAddress.postalCode,
      country: billingAddress.country
    };

    const shippingSnap = {
      id: shippingAddress.id,
      addressType: shippingAddress.addressType,
      addressLine1: shippingAddress.addressLine1,
      addressLine2: shippingAddress.addressLine2,
      city: shippingAddress.city,
      state: shippingAddress.state,
      stateCode: shippingAddress.stateCode,
      postalCode: shippingAddress.postalCode,
      country: shippingAddress.country
    };

    const userId = ctx.user?.userId || 'system';

    const linesDTO: QuotationLineDTO[] = calc.calculatedLines.map(cl => ({
      id: crypto.randomUUID(),
      quotationId: id,
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      lineNumber: cl.lineNumber,
      productId: cl.productId,
      productCodeSnapshot: cl.productCodeSnapshot,
      productNameSnapshot: cl.productNameSnapshot,
      description: cl.description || null,
      uom: cl.uom,
      quantity: cl.quantity,
      unitPrice: cl.unitPrice,
      discountPercent: cl.discountPercent,
      discountAmount: cl.discountAmount,
      allocatedHeaderDiscountAmount: cl.allocatedHeaderDiscountAmount,
      grossAmount: cl.grossAmount,
      taxableAmount: cl.taxableAmount,
      hsnSac: cl.hsnSac,
      cgstRate: cl.cgstRate,
      cgstAmount: cl.cgstAmount,
      sgstRate: cl.sgstRate,
      sgstAmount: cl.sgstAmount,
      igstRate: cl.igstRate,
      igstAmount: cl.igstAmount,
      taxAmount: cl.taxAmount,
      lineTotal: cl.lineTotal,
      pricingSource: cl.pricingSource,
      pricingRuleId: cl.pricingRuleId || null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    const dto: QuotationDTO = {
      id,
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      quotationNumber,
      revisionNumber: 1,
      customerId: input.customerId,
      quotationDate: input.quotationDate,
      validityDate: input.validityDate,
      currency,
      exchangeRate: exRateNum.toFixed(6),
      salesRepresentativeId: input.salesRepresentativeId || null,
      pricingListId: input.pricingListId || null,
      billingAddressId: input.billingAddressId,
      shippingAddressId: input.shippingAddressId,
      billingAddressSnapshot: billingSnap,
      shippingAddressSnapshot: shippingSnap,
      contactId: input.contactId || null,
      contactSnapshot: contactSnap,
      status: 'DRAFT',
      notes: input.notes || null,
      termsAndConditions: input.termsAndConditions || null,
      subtotalAmount: calc.subtotalAmount,
      headerDiscountAmount: calc.headerDiscountAmount,
      discountAmount: calc.discountAmount,
      taxableAmount: calc.taxableAmount,
      taxAmount: calc.taxAmount,
      totalAmount: calc.totalAmount,
      totalAmountBase: calc.totalAmountBase,
      conversionContractId: null,
      conversionContractIssuedAt: null,
      conversionContractHash: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: userId,
      updatedBy: userId,
      lines: linesDTO
    };

    const db = getDb();
    if (db) {
      await db.insert(salesQuotations).values({
        id: dto.id,
        tenantId: dto.tenantId,
        companyId: dto.companyId,
        quotationNumber: dto.quotationNumber,
        revisionNumber: dto.revisionNumber,
        customerId: dto.customerId,
        quotationDate: dto.quotationDate,
        validityDate: dto.validityDate,
        currency: dto.currency,
        exchangeRate: dto.exchangeRate,
        salesRepresentativeId: dto.salesRepresentativeId,
        pricingListId: dto.pricingListId,
        billingAddressId: dto.billingAddressId,
        shippingAddressId: dto.shippingAddressId,
        billingAddressSnapshot: dto.billingAddressSnapshot,
        shippingAddressSnapshot: dto.shippingAddressSnapshot,
        contactId: dto.contactId,
        contactSnapshot: dto.contactSnapshot,
        status: dto.status,
        notes: dto.notes,
        termsAndConditions: dto.termsAndConditions,
        subtotalAmount: dto.subtotalAmount,
        headerDiscountAmount: dto.headerDiscountAmount,
        discountAmount: dto.discountAmount,
        taxableAmount: dto.taxableAmount,
        taxAmount: dto.taxAmount,
        totalAmount: dto.totalAmount,
        totalAmountBase: dto.totalAmountBase,
        createdBy: dto.createdBy,
        updatedBy: dto.updatedBy
      } as any);

      for (const l of linesDTO) {
        await db.insert(salesQuotationLines).values({
          id: l.id,
          quotationId: dto.id,
          tenantId: l.tenantId,
          companyId: l.companyId,
          lineNumber: l.lineNumber,
          productId: l.productId,
          productCodeSnapshot: l.productCodeSnapshot,
          productNameSnapshot: l.productNameSnapshot,
          description: l.description,
          uom: l.uom,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent,
          discountAmount: l.discountAmount,
          allocatedHeaderDiscountAmount: l.allocatedHeaderDiscountAmount,
          grossAmount: l.grossAmount,
          taxableAmount: l.taxableAmount,
          hsnSac: l.hsnSac,
          cgstRate: l.cgstRate,
          cgstAmount: l.cgstAmount,
          sgstRate: l.sgstRate,
          sgstAmount: l.sgstAmount,
          igstRate: l.igstRate,
          igstAmount: l.igstAmount,
          taxAmount: l.taxAmount,
          lineTotal: l.lineTotal,
          pricingSource: l.pricingSource,
          pricingRuleId: l.pricingRuleId
        } as any);
      }
    }

    this.memoryStore.set(`${ctx.tenantId}:${ctx.companyId}:${dto.id}`, dto);

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesQuotation',
      entityId: dto.id,
      action: 'CREATE',
      newValues: { quotationNumber: dto.quotationNumber, totalAmount: dto.totalAmount }
    });

    return dto;
  }

  async getQuotation(ctx: RequestContext, id: string): Promise<QuotationDTO> {
    const key = `${ctx.tenantId}:${ctx.companyId}:${id}`;
    const cached = this.memoryStore.get(key);
    if (cached) return cached;

    const db = getDb();
    if (db) {
      const rows = await db.select().from(salesQuotations).where(
        and(eq(salesQuotations.tenantId, ctx.tenantId), eq(salesQuotations.companyId, ctx.companyId), eq(salesQuotations.id, id))
      );
      if (rows.length === 0) {
        throw new NotFoundError(`Sales Quotation with ID '${id}' not found.`);
      }
      const r = rows[0]!;
      const lineRows = await db.select().from(salesQuotationLines).where(
        and(eq(salesQuotationLines.tenantId, ctx.tenantId), eq(salesQuotationLines.companyId, ctx.companyId), eq(salesQuotationLines.quotationId, id))
      );

      const dto: QuotationDTO = {
        id: r.id,
        tenantId: r.tenantId,
        companyId: r.companyId,
        quotationNumber: r.quotationNumber,
        revisionNumber: r.revisionNumber,
        customerId: r.customerId,
        quotationDate: r.quotationDate,
        validityDate: r.validityDate,
        currency: r.currency,
        exchangeRate: r.exchangeRate,
        salesRepresentativeId: r.salesRepresentativeId || null,
        pricingListId: r.pricingListId || null,
        billingAddressId: r.billingAddressId,
        shippingAddressId: r.shippingAddressId,
        billingAddressSnapshot: r.billingAddressSnapshot as any,
        shippingAddressSnapshot: r.shippingAddressSnapshot as any,
        contactId: r.contactId || null,
        contactSnapshot: r.contactSnapshot as any,
        status: r.status as any,
        notes: r.notes || null,
        termsAndConditions: r.termsAndConditions || null,
        subtotalAmount: r.subtotalAmount,
        headerDiscountAmount: r.headerDiscountAmount,
        discountAmount: r.discountAmount,
        taxableAmount: r.taxableAmount,
        taxAmount: r.taxAmount,
        totalAmount: r.totalAmount,
        totalAmountBase: r.totalAmountBase,
        conversionContractId: r.conversionContractId || null,
        conversionContractIssuedAt: r.conversionContractIssuedAt || null,
        conversionContractHash: r.conversionContractHash || null,
        version: r.version,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        createdBy: r.createdBy,
        updatedBy: r.updatedBy,
        lines: lineRows.map((l: any) => ({
          id: l.id,
          quotationId: l.quotationId,
          tenantId: l.tenantId,
          companyId: l.companyId,
          lineNumber: l.lineNumber,
          productId: l.productId,
          productCodeSnapshot: l.productCodeSnapshot,
          productNameSnapshot: l.productNameSnapshot,
          description: l.description || null,
          uom: l.uom,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent,
          discountAmount: l.discountAmount,
          allocatedHeaderDiscountAmount: l.allocatedHeaderDiscountAmount,
          grossAmount: l.grossAmount,
          taxableAmount: l.taxableAmount,
          hsnSac: l.hsnSac,
          cgstRate: l.cgstRate,
          cgstAmount: l.cgstAmount,
          sgstRate: l.sgstRate,
          sgstAmount: l.sgstAmount,
          igstRate: l.igstRate,
          igstAmount: l.igstAmount,
          taxAmount: l.taxAmount,
          lineTotal: l.lineTotal,
          pricingSource: l.pricingSource,
          pricingRuleId: l.pricingRuleId || null,
          version: l.version,
          createdAt: l.createdAt,
          updatedAt: l.updatedAt
        }))
      };

      this.memoryStore.set(key, dto);
      return dto;
    }

    throw new NotFoundError(`Sales Quotation with ID '${id}' not found.`);
  }

  async listQuotations(
    ctx: RequestContext,
    companyId: string,
    query?: { status?: string; search?: string; customerId?: string }
  ): Promise<QuotationDTO[]> {
    if (companyId !== ctx.companyId) {
      throw new ForbiddenError('Company scope violation: Context companyId does not match query companyId.');
    }

    const db = getDb();
    if (db) {
      let conds = [eq(salesQuotations.tenantId, ctx.tenantId), eq(salesQuotations.companyId, ctx.companyId)];
      if (query?.status) conds.push(eq(salesQuotations.status, query.status));
      if (query?.customerId) conds.push(eq(salesQuotations.customerId, query.customerId));
      if (query?.search) {
        conds.push(or(
          ilike(salesQuotations.quotationNumber, `%${query.search}%`),
          ilike(salesQuotations.notes || '', `%${query.search}%`)
        )!);
      }

      const rows = await db.select().from(salesQuotations).where(and(...conds));
      const result: QuotationDTO[] = [];
      for (const r of rows) {
        const full = await this.getQuotation(ctx, r.id);
        result.push(full);
      }
      return result;
    }

    return Array.from(this.memoryStore.values()).filter(q => {
      if (q.tenantId !== ctx.tenantId || q.companyId !== ctx.companyId) return false;
      if (query?.status && q.status !== query.status) return false;
      if (query?.customerId && q.customerId !== query.customerId) return false;
      if (query?.search) {
        const s = query.search.toLowerCase();
        if (!q.quotationNumber.toLowerCase().includes(s) && !(q.notes || '').toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }

  async updateDraftQuotation(ctx: RequestContext, id: string, input: Partial<CreateQuotationInput>): Promise<QuotationDTO> {
    const existing = await this.getQuotation(ctx, id);
    if (existing.status !== 'DRAFT') {
      throw new ValidationError(`Cannot edit quotation in state '${existing.status}'. Only DRAFT quotations are mutable.`);
    }

    const companyId = existing.companyId;
    const customerId = input.customerId || existing.customerId;
    const billingAddressId = input.billingAddressId || existing.billingAddressId;
    const shippingAddressId = input.shippingAddressId || existing.shippingAddressId;
    const currency = (input.currency || existing.currency).toUpperCase();
    const exRateNum = Number(input.exchangeRate ?? existing.exchangeRate);
    const headerDisc = Number(input.headerDiscountAmount ?? existing.headerDiscountAmount);

    let linesInput: CreateQuotationLineInput[];
    if (input.lines) {
      linesInput = input.lines;
    } else {
      linesInput = existing.lines.map(l => ({
        productId: l.productId,
        description: l.description,
        uom: l.uom,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
        pricingSource: l.pricingSource,
        pricingRuleId: l.pricingRuleId
      }));
    }

    const calc = await this.calculateQuotationMonetaryFields(
      ctx,
      companyId,
      customerId,
      billingAddressId,
      shippingAddressId,
      currency,
      exRateNum,
      headerDisc,
      linesInput,
      input.pricingListId || existing.pricingListId || undefined
    );

    const billingAddress = await addressService.getAddress(ctx, billingAddressId);
    const shippingAddress = await addressService.getAddress(ctx, shippingAddressId);
    const userId = ctx.user?.userId || 'system';

    existing.customerId = customerId;
    existing.quotationDate = input.quotationDate || existing.quotationDate;
    existing.validityDate = input.validityDate || existing.validityDate;
    existing.currency = currency;
    existing.exchangeRate = exRateNum.toFixed(6);
    existing.billingAddressId = billingAddressId;
    existing.shippingAddressId = shippingAddressId;
    existing.billingAddressSnapshot = {
      id: billingAddress.id,
      addressType: billingAddress.addressType,
      addressLine1: billingAddress.addressLine1,
      city: billingAddress.city,
      state: billingAddress.state,
      stateCode: billingAddress.stateCode,
      postalCode: billingAddress.postalCode,
      country: billingAddress.country
    };
    existing.shippingAddressSnapshot = {
      id: shippingAddress.id,
      addressType: shippingAddress.addressType,
      addressLine1: shippingAddress.addressLine1,
      city: shippingAddress.city,
      state: shippingAddress.state,
      stateCode: shippingAddress.stateCode,
      postalCode: shippingAddress.postalCode,
      country: shippingAddress.country
    };
    existing.notes = input.notes !== undefined ? (input.notes || null) : existing.notes;
    existing.termsAndConditions = input.termsAndConditions !== undefined ? (input.termsAndConditions || null) : existing.termsAndConditions;
    existing.subtotalAmount = calc.subtotalAmount;
    existing.headerDiscountAmount = calc.headerDiscountAmount;
    existing.discountAmount = calc.discountAmount;
    existing.taxableAmount = calc.taxableAmount;
    existing.taxAmount = calc.taxAmount;
    existing.totalAmount = calc.totalAmount;
    existing.totalAmountBase = calc.totalAmountBase;
    existing.updatedAt = new Date();
    existing.updatedBy = userId;

    existing.lines = calc.calculatedLines.map(cl => ({
      id: crypto.randomUUID(),
      quotationId: existing.id,
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      lineNumber: cl.lineNumber,
      productId: cl.productId,
      productCodeSnapshot: cl.productCodeSnapshot,
      productNameSnapshot: cl.productNameSnapshot,
      description: cl.description || null,
      uom: cl.uom,
      quantity: cl.quantity,
      unitPrice: cl.unitPrice,
      discountPercent: cl.discountPercent,
      discountAmount: cl.discountAmount,
      allocatedHeaderDiscountAmount: cl.allocatedHeaderDiscountAmount,
      grossAmount: cl.grossAmount,
      taxableAmount: cl.taxableAmount,
      hsnSac: cl.hsnSac,
      cgstRate: cl.cgstRate,
      cgstAmount: cl.cgstAmount,
      sgstRate: cl.sgstRate,
      sgstAmount: cl.sgstAmount,
      igstRate: cl.igstRate,
      igstAmount: cl.igstAmount,
      taxAmount: cl.taxAmount,
      lineTotal: cl.lineTotal,
      pricingSource: cl.pricingSource,
      pricingRuleId: cl.pricingRuleId || null,
      version: existing.version + 1,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    const key = `${ctx.tenantId}:${ctx.companyId}:${id}`;
    this.memoryStore.set(key, existing);

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesQuotation',
      entityId: id,
      action: 'UPDATE',
      newValues: { totalAmount: existing.totalAmount }
    });

    return existing;
  }

  // --- Lifecycle Transitions & Workflow ---

  async submitForApproval(ctx: RequestContext, id: string): Promise<QuotationDTO> {
    const q = await this.getQuotation(ctx, id);
    if (q.status !== 'DRAFT') {
      throw new ValidationError(`Cannot submit quotation in state '${q.status}'. Only DRAFT quotations can be submitted.`);
    }

    const subtotal = Number(q.subtotalAmount);
    const totalDisc = Number(q.discountAmount);
    const totalAmt = Number(q.totalAmount);
    const effectiveDiscPct = subtotal > 0 ? (totalDisc / subtotal) * 100 : 0;

    const maxSalesRepDisc = Number(this.policyConfig.maxSalesRepDiscountPercent ?? 10);
    const maxAutoApproveAmt = Number(this.policyConfig.maxAutoApproveQuotationAmount ?? 500000);

    let requiresApproval = false;

    if (effectiveDiscPct > maxSalesRepDisc) requiresApproval = true;
    if (totalAmt > maxAutoApproveAmt) requiresApproval = true;
    for (const l of q.lines) {
      if (Number(l.discountPercent) > maxSalesRepDisc) requiresApproval = true;
    }

    if (requiresApproval) {
      q.status = 'PENDING_APPROVAL';
    } else {
      q.status = 'APPROVED';
    }
    q.updatedAt = new Date();

    const key = `${ctx.tenantId}:${ctx.companyId}:${id}`;
    this.memoryStore.set(key, q);

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesQuotation',
      entityId: id,
      action: 'SUBMIT_FOR_APPROVAL',
      newValues: { status: q.status }
    });

    return q;
  }

  async approveQuotation(ctx: RequestContext, id: string): Promise<QuotationDTO> {
    const q = await this.getQuotation(ctx, id);
    if (q.status !== 'PENDING_APPROVAL') {
      throw new ValidationError(`Cannot approve quotation in state '${q.status}'. Only PENDING_APPROVAL quotations can be approved.`);
    }

    q.status = 'APPROVED';
    q.updatedAt = new Date();

    const key = `${ctx.tenantId}:${ctx.companyId}:${id}`;
    this.memoryStore.set(key, q);

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesQuotation',
      entityId: id,
      action: 'APPROVE',
      newValues: { status: 'APPROVED' }
    });

    return q;
  }

  async rejectQuotation(ctx: RequestContext, id: string, rejectionReason: string): Promise<QuotationDTO> {
    const q = await this.getQuotation(ctx, id);
    if (q.status !== 'PENDING_APPROVAL') {
      throw new ValidationError(`Cannot reject quotation in state '${q.status}'. Only PENDING_APPROVAL quotations can be rejected.`);
    }
    if (!rejectionReason || !rejectionReason.trim()) {
      throw new ValidationError('Rejection reason is required.');
    }

    q.status = 'REJECTED';
    q.notes = q.notes ? `${q.notes}\n[REJECTED]: ${rejectionReason}` : `[REJECTED]: ${rejectionReason}`;
    q.updatedAt = new Date();

    const key = `${ctx.tenantId}:${ctx.companyId}:${id}`;
    this.memoryStore.set(key, q);

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesQuotation',
      entityId: id,
      action: 'REJECT',
      newValues: { status: 'REJECTED', reason: rejectionReason }
    });

    return q;
  }

  async sendQuotation(ctx: RequestContext, id: string): Promise<QuotationDTO> {
    const q = await this.getQuotation(ctx, id);
    if (q.status !== 'APPROVED') {
      throw new ValidationError(`Cannot send quotation in state '${q.status}'. Only APPROVED quotations can be sent.`);
    }

    const billingAddress = await addressService.getAddress(ctx, q.billingAddressId);
    const shippingAddress = await addressService.getAddress(ctx, q.shippingAddressId);

    q.billingAddressSnapshot = {
      id: billingAddress.id,
      addressType: billingAddress.addressType,
      addressLine1: billingAddress.addressLine1,
      city: billingAddress.city,
      state: billingAddress.state,
      stateCode: billingAddress.stateCode,
      postalCode: billingAddress.postalCode,
      country: billingAddress.country
    };

    q.shippingAddressSnapshot = {
      id: shippingAddress.id,
      addressType: shippingAddress.addressType,
      addressLine1: shippingAddress.addressLine1,
      city: shippingAddress.city,
      state: shippingAddress.state,
      stateCode: shippingAddress.stateCode,
      postalCode: shippingAddress.postalCode,
      country: shippingAddress.country
    };

    if (q.contactId) {
      const contact = await contactService.getContact(ctx, q.contactId);
      q.contactSnapshot = {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        designation: contact.designation
      };
    }

    q.status = 'SENT';
    q.updatedAt = new Date();

    const key = `${ctx.tenantId}:${ctx.companyId}:${id}`;
    this.memoryStore.set(key, q);

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesQuotation',
      entityId: id,
      action: 'SEND',
      newValues: { status: 'SENT' }
    });

    return q;
  }

  async acceptQuotation(ctx: RequestContext, id: string): Promise<QuotationDTO> {
    const q = await this.getQuotation(ctx, id);
    if (q.status !== 'SENT') {
      throw new ValidationError(`Cannot accept quotation in state '${q.status}'. Only SENT quotations can be accepted.`);
    }

    const todayStr = new Date().toISOString().split('T')[0]!;
    if (q.validityDate < todayStr && !this.policyConfig.allowExpiredQuotationConversion) {
      q.status = 'EXPIRED';
      const key = `${ctx.tenantId}:${ctx.companyId}:${id}`;
      this.memoryStore.set(key, q);
      throw new ValidationError(`Quotation '${q.quotationNumber}' has expired on ${q.validityDate}.`);
    }

    q.status = 'ACCEPTED';
    q.updatedAt = new Date();

    const key = `${ctx.tenantId}:${ctx.companyId}:${id}`;
    this.memoryStore.set(key, q);

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesQuotation',
      entityId: id,
      action: 'ACCEPT',
      newValues: { status: 'ACCEPTED' }
    });

    return q;
  }

  async cancelQuotation(ctx: RequestContext, id: string, cancellationReason?: string): Promise<QuotationDTO> {
    const q = await this.getQuotation(ctx, id);
    if (q.status !== 'DRAFT' && q.status !== 'APPROVED') {
      throw new ValidationError(`Cannot cancel quotation in state '${q.status}'. Only DRAFT or APPROVED quotations can be cancelled.`);
    }

    q.status = 'CANCELLED';
    if (cancellationReason) {
      q.notes = q.notes ? `${q.notes}\n[CANCELLED]: ${cancellationReason}` : `[CANCELLED]: ${cancellationReason}`;
    }
    q.updatedAt = new Date();

    const key = `${ctx.tenantId}:${ctx.companyId}:${id}`;
    this.memoryStore.set(key, q);

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesQuotation',
      entityId: id,
      action: 'CANCEL',
      newValues: { status: 'CANCELLED', reason: cancellationReason }
    });

    return q;
  }

  // --- Single-Table Revision Workflow ---

  async createRevision(ctx: RequestContext, id: string): Promise<QuotationDTO> {
    const source = await this.getQuotation(ctx, id);
    if (source.status !== 'SENT' && source.status !== 'REJECTED') {
      throw new ValidationError(`Cannot revise quotation in state '${source.status}'. Revisions are allowed only from SENT or REJECTED state.`);
    }

    source.status = 'REVISED';
    source.updatedAt = new Date();
    this.memoryStore.set(`${ctx.tenantId}:${ctx.companyId}:${source.id}`, source);

    const nextRevisionNumber = source.revisionNumber + 1;
    const newId = crypto.randomUUID();

    const linesInput: CreateQuotationLineInput[] = source.lines.map(l => ({
      productId: l.productId,
      description: l.description,
      uom: l.uom,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      pricingSource: l.pricingSource,
      pricingRuleId: l.pricingRuleId
    }));

    const calc = await this.calculateQuotationMonetaryFields(
      ctx,
      source.companyId,
      source.customerId,
      source.billingAddressId,
      source.shippingAddressId,
      source.currency,
      Number(source.exchangeRate),
      Number(source.headerDiscountAmount),
      linesInput,
      source.pricingListId || undefined
    );

    const userId = ctx.user?.userId || 'system';

    const linesDTO: QuotationLineDTO[] = calc.calculatedLines.map(cl => ({
      id: crypto.randomUUID(),
      quotationId: newId,
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      lineNumber: cl.lineNumber,
      productId: cl.productId,
      productCodeSnapshot: cl.productCodeSnapshot,
      productNameSnapshot: cl.productNameSnapshot,
      description: cl.description || null,
      uom: cl.uom,
      quantity: cl.quantity,
      unitPrice: cl.unitPrice,
      discountPercent: cl.discountPercent,
      discountAmount: cl.discountAmount,
      allocatedHeaderDiscountAmount: cl.allocatedHeaderDiscountAmount,
      grossAmount: cl.grossAmount,
      taxableAmount: cl.taxableAmount,
      hsnSac: cl.hsnSac,
      cgstRate: cl.cgstRate,
      cgstAmount: cl.cgstAmount,
      sgstRate: cl.sgstRate,
      sgstAmount: cl.sgstAmount,
      igstRate: cl.igstRate,
      igstAmount: cl.igstAmount,
      taxAmount: cl.taxAmount,
      lineTotal: cl.lineTotal,
      pricingSource: cl.pricingSource,
      pricingRuleId: cl.pricingRuleId || null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    const rev2DTO: QuotationDTO = {
      id: newId,
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      quotationNumber: source.quotationNumber,
      revisionNumber: nextRevisionNumber,
      customerId: source.customerId,
      quotationDate: new Date().toISOString().split('T')[0]!,
      validityDate: source.validityDate,
      currency: source.currency,
      exchangeRate: source.exchangeRate,
      salesRepresentativeId: source.salesRepresentativeId || null,
      pricingListId: source.pricingListId || null,
      billingAddressId: source.billingAddressId,
      shippingAddressId: source.shippingAddressId,
      billingAddressSnapshot: source.billingAddressSnapshot,
      shippingAddressSnapshot: source.shippingAddressSnapshot,
      contactId: source.contactId || null,
      contactSnapshot: source.contactSnapshot || null,
      status: 'DRAFT',
      notes: source.notes || null,
      termsAndConditions: source.termsAndConditions || null,
      subtotalAmount: calc.subtotalAmount,
      headerDiscountAmount: calc.headerDiscountAmount,
      discountAmount: calc.discountAmount,
      taxableAmount: calc.taxableAmount,
      taxAmount: calc.taxAmount,
      totalAmount: calc.totalAmount,
      totalAmountBase: calc.totalAmountBase,
      conversionContractId: null,
      conversionContractIssuedAt: null,
      conversionContractHash: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: userId,
      updatedBy: userId,
      lines: linesDTO
    };

    this.memoryStore.set(`${ctx.tenantId}:${ctx.companyId}:${newId}`, rev2DTO);

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesQuotation',
      entityId: newId,
      action: 'CREATE_REVISION',
      newValues: { quotationNumber: rev2DTO.quotationNumber, revisionNumber: nextRevisionNumber }
    });

    return rev2DTO;
  }

  // --- Conversion Contract Issuance ---

  async issueConversionContract(
    ctx: RequestContext,
    id: string,
    idempotencyKey?: string
  ): Promise<QuotationConversionContract> {
    if (idempotencyKey) {
      const cached = this.idempotencyStore.get(`${ctx.tenantId}:${ctx.companyId}:${idempotencyKey}`);
      if (cached) return cached;
    }

    const q = await this.getQuotation(ctx, id);

    if (q.status !== 'ACCEPTED') {
      throw new ValidationError(`Cannot issue conversion contract for quotation in state '${q.status}'. Only ACCEPTED quotations can issue a conversion contract.`);
    }

    const todayStr = new Date().toISOString().split('T')[0]!;
    if (q.validityDate < todayStr && !this.policyConfig.allowExpiredQuotationConversion) {
      throw new ValidationError(`EXPIRED_QUOTATION_CONVERSION_PROHIBITED: Quotation '${q.quotationNumber}' has expired on ${q.validityDate}.`);
    }

    if (q.conversionContractId) {
      throw new ConflictError(`CONVERSION_CONTRACT_ALREADY_ISSUED: Conversion contract has already been issued for quotation '${q.quotationNumber}' (Contract ID: ${q.conversionContractId}).`);
    }

    const contractId = `qcc_${crypto.randomUUID()}`;
    const issuedAt = new Date().toISOString();

    const payloadLines = q.lines.map(l => ({
      quotationLineId: l.id,
      lineNumber: l.lineNumber,
      productId: l.productId,
      productCodeSnapshot: l.productCodeSnapshot,
      productNameSnapshot: l.productNameSnapshot,
      description: l.description || null,
      uom: l.uom,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      discountAmount: l.discountAmount,
      allocatedHeaderDiscountAmount: l.allocatedHeaderDiscountAmount,
      grossAmount: l.grossAmount,
      taxableAmount: l.taxableAmount,
      hsnSac: l.hsnSac,
      cgstRate: l.cgstRate,
      cgstAmount: l.cgstAmount,
      sgstRate: l.sgstRate,
      sgstAmount: l.sgstAmount,
      igstRate: l.igstRate,
      igstAmount: l.igstAmount,
      taxAmount: l.taxAmount,
      lineTotal: l.lineTotal,
      pricingSource: l.pricingSource,
      pricingRuleId: l.pricingRuleId || null
    }));

    const rawDigest = JSON.stringify({
      quotationNumber: q.quotationNumber,
      revisionNumber: q.revisionNumber,
      customerId: q.customerId,
      totalAmount: q.totalAmount,
      lines: payloadLines
    });
    const contractHash = crypto.createHash('sha256').update(rawDigest).digest('hex');

    const contract: QuotationConversionContract = {
      contractId,
      contractVersion: '1.0',
      issuedAt,
      contractHash,
      tenantId: q.tenantId,
      companyId: q.companyId,
      quotationId: q.id,
      quotationNumber: q.quotationNumber,
      revisionNumber: q.revisionNumber,
      customerId: q.customerId,
      currency: q.currency,
      exchangeRate: q.exchangeRate,
      billingAddressId: q.billingAddressId,
      shippingAddressId: q.shippingAddressId,
      contactId: q.contactId || null,
      billingAddressSnapshot: q.billingAddressSnapshot,
      shippingAddressSnapshot: q.shippingAddressSnapshot,
      contactSnapshot: q.contactSnapshot || null,
      salesRepresentativeId: q.salesRepresentativeId || null,
      termsAndConditions: q.termsAndConditions || null,
      subtotalAmount: q.subtotalAmount,
      lineDiscountAmount: formatAmount(Number(q.discountAmount) - Number(q.headerDiscountAmount)),
      headerDiscountAmount: q.headerDiscountAmount,
      discountAmount: q.discountAmount,
      taxableAmount: q.taxableAmount,
      taxAmount: q.taxAmount,
      totalAmount: q.totalAmount,
      totalAmountBase: q.totalAmountBase,
      lines: payloadLines
    };

    q.conversionContractId = contractId;
    q.conversionContractIssuedAt = new Date(issuedAt);
    q.conversionContractHash = contractHash;
    q.updatedAt = new Date();

    const key = `${ctx.tenantId}:${ctx.companyId}:${id}`;
    this.memoryStore.set(key, q);

    if (idempotencyKey) {
      this.idempotencyStore.set(`${ctx.tenantId}:${ctx.companyId}:${idempotencyKey}`, contract);
    }

    await auditService.logEvent(ctx, {
      module: 'sales',
      entityName: 'SalesQuotation',
      entityId: id,
      action: 'ISSUE_CONVERSION_CONTRACT',
      newValues: { contractId, contractHash }
    });

    return contract;
  }

  public clear(): void {
    this.memoryStore.clear();
    this.idempotencyStore.clear();
    this.policyConfig = {
      maxSalesRepDiscountPercent: '10.00',
      maxAutoApproveQuotationAmount: '500000.00',
      requireApprovalForManualPriceOverride: true,
      allowExpiredQuotationConversion: false
    };
  }

  public clearMemoryStores(): void {
    this.clear();
  }
}

export const quotationService = new QuotationService();
