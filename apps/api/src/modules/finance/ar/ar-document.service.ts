import {
  RequestContext,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  BusinessRuleViolationError,
  AccountingError,
  ExactDecimal
} from '@general-erp/core';
import { logger } from '../../../config/logger.js';
import { authorizationService } from '../../../platform/authorization/authorization.service.js';
import { auditService } from '../../../platform/audit/audit.service.js';
import { masterDataService } from '../../../platform/master-data/master-data.service.js';
import { numberingEngine } from '../../../platform/numbering/numbering.service.js';
import { fiscalPeriodService } from '../fiscal-period.service.js';
import { taxEngineService } from '../tax-engine.service.js';
import { accountingCoreService, AccountingEventInput, AccountingEventLineInput } from '../accounting-core.service.js';
import {
  ArDocumentDTO,
  ArDocumentLineDTO,
  ArOpenItemDTO,
  CreateArDocumentInput,
  UpdateArDocumentInput,
  PostArDocumentInput,
  ArDocumentStatus
} from './ar-document-model.js';
import { ArDocumentValidator } from './ar-document-validator.js';
import type pg from 'pg';

export class ArDocumentService {
  private documentsStore = new Map<string, ArDocumentDTO>();
  private openItemsStore = new Map<string, ArOpenItemDTO>();
  private dbPool?: pg.Pool | undefined;

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
    accountingCoreService.setDbPool(pool);
  }

  public getDbPool(): pg.Pool | undefined {
    return this.dbPool;
  }

  public clear(): void {
    this.documentsStore.clear();
    this.openItemsStore.clear();
  }

  private getKey(tenantId: string, id: string): string {
    return `${tenantId}:${id}`;
  }

  private authorize(ctx: RequestContext, action: string, companyId: string): void {
    if (ctx.user) {
      const isWildcard = ctx.user.permissions.some(p => p === '*' || p === action || p.startsWith('ar:document:'));
      if (!isWildcard) {
        authorizationService.authorize({ user: ctx.user, action, companyId });
      }
    }
  }

  /**
   * Create a new AR Document in DRAFT status
   */
  public async createDraft(ctx: RequestContext, input: CreateArDocumentInput): Promise<ArDocumentDTO> {
    input = {
      ...input,
      accountingDate: input.accountingDate || input.documentDate
    };
    ArDocumentValidator.validateCreateInput(ctx, input);
    this.authorize(ctx, 'ar:document:create', input.companyId);
    await ArDocumentValidator.validateCustomer(ctx, input.companyId, input.customerId);

    // Validate products if provided
    for (let i = 0; i < input.lines.length; i++) {
      const line = input.lines[i]!;
      if (line.productId) {
        const prod = await masterDataService.getProduct(ctx, line.productId);
        if (prod.companyId !== input.companyId) {
          throw new ForbiddenError(`Product '${line.productId}' belongs to company '${prod.companyId}', not document company '${input.companyId}'.`);
        }
      }
    }

    // Resolve tax if taxability == TAXABLE and rates/components not fully passed
    const isTaxable = (input.taxability ?? 'TAXABLE') === 'TAXABLE';
    let docTaxable = ExactDecimal.ZERO;
    let docTax = ExactDecimal.ZERO;
    let docGross = ExactDecimal.ZERO;

    let docCgst = ExactDecimal.ZERO;
    let docSgst = ExactDecimal.ZERO;
    let docIgst = ExactDecimal.ZERO;
    let docUtgst = ExactDecimal.ZERO;
    let docCess = ExactDecimal.ZERO;

    const constructedLines: ArDocumentLineDTO[] = [];
    const docId = `ardoc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();

    for (let i = 0; i < input.lines.length; i++) {
      const lineInput = input.lines[i]!;
      const seq = i + 1;

      // Validate amounts & exact decimal scale
      const parsed = ArDocumentValidator.validateLineAmountsAndScale(lineInput, seq);

      // Perform Tax Resolution via TaxEngine if tax fields not fully supplied
      let lineCgst = parsed.cgstAmount;
      let lineSgst = parsed.sgstAmount;
      let lineIgst = parsed.igstAmount;
      let lineUtgst = parsed.utgstAmount;
      let lineCess = parsed.cessAmount;
      let lineRate = parsed.taxRatePercent;
      let lineTax = parsed.taxAmount;
      let lineGross = parsed.grossAmount;
      let hsnSac = lineInput.hsnSac || null;

      if (isTaxable && parsed.taxAmount.isZero() && lineInput.taxCategoryId) {
        try {
          const taxRes = await taxEngineService.resolveTaxMatrix(ctx, {
            companyId: input.companyId,
            taxCategoryId: lineInput.taxCategoryId,
            hsnSacCode: lineInput.hsnSac,
            transactionDate: input.documentDate
          });

          if (taxRes && taxRes.rates.length > 0) {
            const totalRateNum = taxRes.rates.reduce((sum, r) => sum + parseFloat(r.ratePercent), 0);
            lineRate = ExactDecimal.parse(totalRateNum.toString(), 6);
            const calcTaxNum = (parseFloat(parsed.taxableAmount.toString()) * totalRateNum) / 100.0;
            lineTax = ExactDecimal.parse(calcTaxNum.toFixed(2), 2);
            let isIntra = true;
            if (input.placeOfSupplyStateCode) {
              const cust = await masterDataService.getCustomer(ctx, input.customerId);
              const custStateCode = cust.stateCode || (cust.gstin ? cust.gstin.substring(0, 2) : undefined);
              if (custStateCode && custStateCode !== input.placeOfSupplyStateCode) {
                isIntra = false;
              }
            }
            if (isIntra) {
              const halfNum = (calcTaxNum / 2.0).toFixed(2);
              lineCgst = ExactDecimal.parse(halfNum, 2);
              lineSgst = ExactDecimal.parse(halfNum, 2);
              lineTax = lineCgst.add(lineSgst);
            } else {
              lineIgst = lineTax;
            }
            lineGross = parsed.taxableAmount.add(lineTax);
            hsnSac = taxRes.hsnSac?.code || hsnSac;
          }
        } catch {
          // If tax matrix resolution fails or not configured, keep provided values
        }
      }

      const lineId = `ardl_${Date.now()}_${seq}_${Math.random().toString(36).substring(2, 6)}`;
      const lineDTO: ArDocumentLineDTO = {
        id: lineId,
        tenantId: ctx.tenantId,
        companyId: input.companyId,
        arDocumentId: docId,
        lineSequence: seq,
        productId: lineInput.productId || null,
        description: lineInput.description,
        hsnSac,
        quantity: parsed.quantity.toString(),
        unitPrice: parsed.unitPrice.toString(),
        taxableAmount: parsed.taxableAmount.toString(),
        taxCategoryId: lineInput.taxCategoryId || null,
        taxRatePercent: lineRate.toString(),
        cgstAmount: lineCgst.toString(),
        sgstAmount: lineSgst.toString(),
        igstAmount: lineIgst.toString(),
        utgstAmount: lineUtgst.toString(),
        cessAmount: lineCess.toString(),
        taxAmount: lineTax.toString(),
        grossAmount: lineGross.toString(),
        isRcm: lineInput.isRcm ?? input.isRcm ?? false,
        isSez: lineInput.isSez ?? input.isSez ?? false,
        createdAt: now
      };

      constructedLines.push(lineDTO);

      docTaxable = docTaxable.add(parsed.taxableAmount);
      docTax = docTax.add(lineTax);
      docGross = docGross.add(lineGross);
      docCgst = docCgst.add(lineCgst);
      docSgst = docSgst.add(lineSgst);
      docIgst = docIgst.add(lineIgst);
      docUtgst = docUtgst.add(lineUtgst);
      docCess = docCess.add(lineCess);
    }

    // Assert document totals reconciliation invariant
    if (!docGross.equals(docTaxable.add(docTax))) {
      throw new ValidationError(`Document total grossAmount '${docGross.toString()}' does not reconcile with taxable ('${docTaxable.toString()}') + tax ('${docTax.toString()}').`);
    }

    const docDTO: ArDocumentDTO = {
      id: docId,
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      customerId: input.customerId,
      documentType: input.documentType,
      documentNumber: input.documentNumber || null,
      documentDate: input.documentDate,
      accountingDate: input.accountingDate,
      dueDate: input.dueDate,
      currency: input.currency || 'INR',
      exchangeRate: input.exchangeRate || '1.000000',
      placeOfSupplyStateCode: input.placeOfSupplyStateCode || null,
      supplyNature: input.supplyNature || null,
      taxability: input.taxability || (isTaxable ? 'TAXABLE' : 'EXEMPT'),
      isRcm: input.isRcm || false,
      isSez: input.isSez || false,
      taxableAmount: docTaxable.toString(),
      taxAmount: docTax.toString(),
      grossAmount: docGross.toString(),
      outstandingAmount: '0.00',
      allocatedAmount: '0.00',
      unappliedAmount: '0.00',
      status: 'DRAFT',
      sourceModule: input.sourceModule || 'AR',
      sourceDocumentId: input.sourceDocumentId || null,
      journalEntryId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      lines: constructedLines
    };

    this.documentsStore.set(this.getKey(ctx.tenantId, docId), docDTO);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ArDocument',
      entityId: docId,
      action: 'CREATE',
      newValues: {
        documentType: docDTO.documentType,
        customerId: docDTO.customerId,
        grossAmount: docDTO.grossAmount,
        status: docDTO.status
      }
    });

    logger.info({ tenantId: ctx.tenantId, companyId: input.companyId, docId }, '[AR] Created draft document');
    return docDTO;
  }

  /**
   * Update a draft AR document
   */
  public async updateDraft(ctx: RequestContext, id: string, input: UpdateArDocumentInput): Promise<ArDocumentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.documentsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ArDocument', id);
    }

    this.authorize(ctx, 'ar:document:update', existing.companyId);

    if (existing.status !== 'DRAFT') {
      throw new BusinessRuleViolationError(`Cannot update AR document '${id}'. Current status is '${existing.status}'. Only DRAFT documents may be updated.`);
    }

    const companyId = existing.companyId;
    const customerId = input.customerId || existing.customerId;
    await ArDocumentValidator.validateCustomer(ctx, companyId, customerId);

    const docDate = input.documentDate || existing.documentDate;
    const acctDate = input.accountingDate || existing.accountingDate;
    const dueDate = input.dueDate || existing.dueDate;
    ArDocumentValidator.validateDates(docDate, acctDate, dueDate);

    const linesInput = input.lines || existing.lines.map(l => ({
      productId: l.productId || undefined,
      description: l.description,
      hsnSac: l.hsnSac || undefined,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxCategoryId: l.taxCategoryId || undefined,
      taxRatePercent: l.taxRatePercent,
      cgstAmount: l.cgstAmount,
      sgstAmount: l.sgstAmount,
      igstAmount: l.igstAmount,
      utgstAmount: l.utgstAmount,
      cessAmount: l.cessAmount,
      taxableAmount: l.taxableAmount,
      taxAmount: l.taxAmount,
      grossAmount: l.grossAmount,
      isRcm: l.isRcm,
      isSez: l.isSez
    }));

    let docTaxable = ExactDecimal.ZERO;
    let docTax = ExactDecimal.ZERO;
    let docGross = ExactDecimal.ZERO;

    const updatedLines: ArDocumentLineDTO[] = [];
    const now = new Date();

    for (let i = 0; i < linesInput.length; i++) {
      const lineInput = linesInput[i]!;
      const seq = i + 1;
      const parsed = ArDocumentValidator.validateLineAmountsAndScale(lineInput, seq);

      const lineId = existing.lines[i]?.id || `ardl_${Date.now()}_${seq}`;
      const lineDTO: ArDocumentLineDTO = {
        id: lineId,
        tenantId: ctx.tenantId,
        companyId,
        arDocumentId: existing.id,
        lineSequence: seq,
        productId: lineInput.productId || null,
        description: lineInput.description,
        hsnSac: lineInput.hsnSac || null,
        quantity: parsed.quantity.toString(),
        unitPrice: parsed.unitPrice.toString(),
        taxableAmount: parsed.taxableAmount.toString(),
        taxCategoryId: lineInput.taxCategoryId || null,
        taxRatePercent: parsed.taxRatePercent.toString(),
        cgstAmount: parsed.cgstAmount.toString(),
        sgstAmount: parsed.sgstAmount.toString(),
        igstAmount: parsed.igstAmount.toString(),
        utgstAmount: parsed.utgstAmount.toString(),
        cessAmount: parsed.cessAmount.toString(),
        taxAmount: parsed.taxAmount.toString(),
        grossAmount: parsed.grossAmount.toString(),
        isRcm: lineInput.isRcm ?? existing.isRcm,
        isSez: lineInput.isSez ?? existing.isSez,
        createdAt: existing.lines[i]?.createdAt || now
      };

      updatedLines.push(lineDTO);
      docTaxable = docTaxable.add(parsed.taxableAmount);
      docTax = docTax.add(parsed.taxAmount);
      docGross = docGross.add(parsed.grossAmount);
    }

    const updatedDTO: ArDocumentDTO = {
      ...existing,
      customerId,
      documentDate: docDate,
      accountingDate: acctDate,
      dueDate,
      placeOfSupplyStateCode: input.placeOfSupplyStateCode !== undefined ? (input.placeOfSupplyStateCode || null) : existing.placeOfSupplyStateCode,
      supplyNature: input.supplyNature !== undefined ? (input.supplyNature || null) : existing.supplyNature,
      taxability: input.taxability !== undefined ? input.taxability : existing.taxability,
      isRcm: input.isRcm !== undefined ? input.isRcm : existing.isRcm,
      isSez: input.isSez !== undefined ? input.isSez : existing.isSez,
      taxableAmount: docTaxable.toString(),
      taxAmount: docTax.toString(),
      grossAmount: docGross.toString(),
      lines: updatedLines,
      version: existing.version + 1,
      updatedAt: now
    };

    this.documentsStore.set(key, updatedDTO);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ArDocument',
      entityId: id,
      action: 'UPDATE',
      newValues: {
        grossAmount: updatedDTO.grossAmount,
        version: updatedDTO.version
      }
    });

    return updatedDTO;
  }

  /**
   * Get an AR document by ID
   */
  public async getDocument(ctx: RequestContext, id: string): Promise<ArDocumentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const doc = this.documentsStore.get(key);
    if (!doc) {
      throw new NotFoundError('ArDocument', id);
    }
    this.authorize(ctx, 'ar:document:read', doc.companyId);
    return doc;
  }

  /**
   * List AR documents for a company
   */
  public async listDocuments(
    ctx: RequestContext,
    companyId: string,
    filters?: { status?: ArDocumentStatus; customerId?: string; documentType?: string }
  ): Promise<ArDocumentDTO[]> {
    this.authorize(ctx, 'ar:document:read', companyId);
    const result: ArDocumentDTO[] = [];
    for (const doc of this.documentsStore.values()) {
      if (doc.tenantId === ctx.tenantId && doc.companyId === companyId) {
        if (filters?.status && doc.status !== filters.status) continue;
        if (filters?.customerId && doc.customerId !== filters.customerId) continue;
        if (filters?.documentType && doc.documentType !== filters.documentType) continue;
        result.push(doc);
      }
    }
    return result;
  }

  /**
   * List AR open items for a company
   */
  public async getOpenItems(
    ctx: RequestContext,
    companyId: string,
    filters?: { customerId?: string; status?: string }
  ): Promise<ArOpenItemDTO[]> {
    this.authorize(ctx, 'ar:document:read', companyId);
    const result: ArOpenItemDTO[] = [];
    for (const item of this.openItemsStore.values()) {
      if (item.tenantId === ctx.tenantId && item.companyId === companyId) {
        if (filters?.customerId && item.customerId !== filters.customerId) continue;
        if (filters?.status && item.status !== filters.status) continue;
        result.push(item);
      }
    }
    return result;
  }

  /**
   * Get an open item by ID
   */
  public async getOpenItem(ctx: RequestContext, id: string): Promise<ArOpenItemDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const item = this.openItemsStore.get(key);
    if (!item) {
      throw new NotFoundError('ArOpenItem', id);
    }
    this.authorize(ctx, 'ar:document:read', item.companyId);
    return item;
  }

  /**
   * Update open item balance and status (used by Allocation Engine)
   */
  public async updateOpenItemBalance(
    ctx: RequestContext,
    id: string,
    outstandingAmount: string,
    status: 'OPEN' | 'PARTIALLY_SETTLED' | 'SETTLED' | 'CANCELLED'
  ): Promise<ArOpenItemDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.openItemsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ArOpenItem', id);
    }

    const updated: ArOpenItemDTO = {
      ...existing,
      outstandingAmount,
      status,
      updatedAt: new Date()
    };
    this.openItemsStore.set(key, updated);

    // Also update parent document's outstanding amount and status if linked
    if (existing.arDocumentId) {
      const docKey = this.getKey(ctx.tenantId, existing.arDocumentId);
      const doc = this.documentsStore.get(docKey);
      if (doc) {
        const origGrossDec = ExactDecimal.parse(doc.grossAmount, 2);
        const newOutDec = ExactDecimal.parse(outstandingAmount, 2);
        const newAllocDec = origGrossDec.sub(newOutDec);

        let docStatus: ArDocumentStatus = doc.status;
        if (doc.status === 'POSTED' || doc.status === 'PARTIALLY_SETTLED' || doc.status === 'SETTLED') {
          if (newOutDec.isZero()) {
            docStatus = 'SETTLED';
          } else if (newOutDec.compare(origGrossDec) < 0) {
            docStatus = 'PARTIALLY_SETTLED';
          } else {
            docStatus = 'POSTED';
          }
        }

        this.documentsStore.set(docKey, {
          ...doc,
          outstandingAmount,
          allocatedAmount: newAllocDec.toString(),
          status: docStatus,
          updatedAt: new Date()
        });
      }
    }

    return updated;
  }

  /**
   * Update Credit Note unapplied/allocated balance (used by Allocation Engine)
   */
  public async updateCreditNoteBalance(
    ctx: RequestContext,
    id: string,
    unappliedAmount: string,
    allocatedAmount: string
  ): Promise<ArDocumentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const doc = this.documentsStore.get(key);
    if (!doc) {
      throw new NotFoundError('ArDocument', id);
    }
    if (doc.documentType !== 'CREDIT_NOTE') {
      throw new BusinessRuleViolationError(`Document '${id}' is not a CREDIT_NOTE.`);
    }

    const unappDec = ExactDecimal.parse(unappliedAmount, 2);
    const allocDec = ExactDecimal.parse(allocatedAmount, 2);

    let docStatus: ArDocumentStatus = doc.status;
    if (doc.status === 'POSTED' || doc.status === 'PARTIALLY_SETTLED' || doc.status === 'SETTLED') {
      if (unappDec.isZero()) {
        docStatus = 'SETTLED';
      } else if (allocDec.isPositive()) {
        docStatus = 'PARTIALLY_SETTLED';
      } else {
        docStatus = 'POSTED';
      }
    }

    const updated: ArDocumentDTO = {
      ...doc,
      unappliedAmount,
      allocatedAmount,
      status: docStatus,
      updatedAt: new Date()
    };
    this.documentsStore.set(key, updated);
    return updated;
  }

  /**
   * Atomically post an AR document (DRAFT -> POSTED)
   */
  public async postDocument(ctx: RequestContext, id: string, postInput?: PostArDocumentInput): Promise<ArDocumentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.documentsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ArDocument', id);
    }

    this.authorize(ctx, 'ar:document:post', existing.companyId);

    // Idempotent re-post handling
    if (existing.status === 'POSTED') {
      logger.info({ tenantId: ctx.tenantId, docId: id }, '[AR] Document is already POSTED — returning idempotent result');
      return existing;
    }

    if (existing.status === 'CANCELLED') {
      throw new BusinessRuleViolationError(`Cannot post AR document '${id}'. Document status is CANCELLED.`);
    }

    // 1. Fiscal Period Validation
    const acctDateObj = new Date(existing.accountingDate);
    const { fiscalYear, fiscalPeriod } = await fiscalPeriodService.resolvePeriod(ctx, existing.companyId, acctDateObj);
    await fiscalPeriodService.assertPeriodOpen(ctx, fiscalPeriod.id);

    // 2. Document Number Generation
    let docNum = existing.documentNumber;
    if (!docNum || docNum.trim() === '') {
      docNum = numberingEngine.generateNextNumber(ctx.tenantId, existing.companyId, existing.documentType, fiscalYear.name, 'HQ');
    }

    // 3. Outstanding / Unapplied / Open Item Semantics Setup
    const isCreditNote = existing.documentType === 'CREDIT_NOTE';

    let outstandingStr = '0.00';
    let unappliedStr = '0.00';
    let newOpenItem: ArOpenItemDTO | null = null;

    if (!isCreditNote) {
      // DEBIT Open Item (INVOICE, DEBIT_NOTE, OPENING_BALANCE)
      outstandingStr = existing.grossAmount;
      unappliedStr = '0.00';

      const openItemId = `aroi_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      newOpenItem = {
        id: openItemId,
        tenantId: ctx.tenantId,
        companyId: existing.companyId,
        customerId: existing.customerId,
        arDocumentId: existing.id,
        documentType: existing.documentType,
        documentNumber: docNum,
        documentDate: existing.documentDate,
        dueDate: existing.dueDate,
        originalAmount: existing.grossAmount,
        outstandingAmount: existing.grossAmount,
        status: 'OPEN',
        createdAt: new Date(),
        updatedAt: new Date()
      };
    } else {
      // CREDIT SOURCE (CREDIT_NOTE) — NO open item created!
      outstandingStr = '0.00';
      unappliedStr = existing.grossAmount;
    }

    // 4. Simulated Transaction Failure Injection Check (Must occur BEFORE modifying persistent stores)
    if (postInput?.simulateFailure) {
      logger.error({ docId: id }, '[AR] Simulated transaction failure injected — triggering ROLLBACK');
      throw new AccountingError(`Simulated transaction failure during AR document posting for document '${id}'.`);
    }

    // 5. Construct Accounting Event & Post via AccountingCore / GLEngine
    const accountingLines: AccountingEventLineInput[] = [];
    let lineSeq = 1;

    if (existing.documentType === 'INVOICE' || existing.documentType === 'DEBIT_NOTE') {
      // Debit AR Control (Gross Amount)
      accountingLines.push({
        lineSequence: lineSeq++,
        lineRole: 'AR_CONTROL',
        debitAmount: existing.grossAmount,
        creditAmount: '0.00',
        narration: `AR Receivable - ${docNum}`
      });

      // Credit Revenue (Taxable Amount)
      accountingLines.push({
        lineSequence: lineSeq++,
        lineRole: 'SALES_REVENUE',
        debitAmount: '0.00',
        creditAmount: existing.taxableAmount,
        narration: `Sales Revenue - ${docNum}`
      });

      // Credit Tax Component Lines
      for (const line of existing.lines) {
        if (ExactDecimal.parse(line.cgstAmount, 2).isPositive()) {
          accountingLines.push({ lineSequence: lineSeq++, lineRole: 'OUTPUT_CGST', debitAmount: '0.00', creditAmount: line.cgstAmount, narration: `CGST Output ${line.taxRatePercent}%` });
        }
        if (ExactDecimal.parse(line.sgstAmount, 2).isPositive()) {
          accountingLines.push({ lineSequence: lineSeq++, lineRole: 'OUTPUT_SGST', debitAmount: '0.00', creditAmount: line.sgstAmount, narration: `SGST Output ${line.taxRatePercent}%` });
        }
        if (ExactDecimal.parse(line.igstAmount, 2).isPositive()) {
          accountingLines.push({ lineSequence: lineSeq++, lineRole: 'OUTPUT_IGST', debitAmount: '0.00', creditAmount: line.igstAmount, narration: `IGST Output ${line.taxRatePercent}%` });
        }
        if (ExactDecimal.parse(line.utgstAmount, 2).isPositive()) {
          accountingLines.push({ lineSequence: lineSeq++, lineRole: 'OUTPUT_UTGST', debitAmount: '0.00', creditAmount: line.utgstAmount, narration: `UTGST Output ${line.taxRatePercent}%` });
        }
        if (ExactDecimal.parse(line.cessAmount, 2).isPositive()) {
          accountingLines.push({ lineSequence: lineSeq++, lineRole: 'OUTPUT_CESS', debitAmount: '0.00', creditAmount: line.cessAmount, narration: `CESS Output` });
        }
      }
    } else if (existing.documentType === 'OPENING_BALANCE') {
      // Debit AR Control (Gross Amount)
      accountingLines.push({
        lineSequence: lineSeq++,
        lineRole: 'AR_CONTROL',
        debitAmount: existing.grossAmount,
        creditAmount: '0.00',
        narration: `Opening Receivable - ${docNum}`
      });

      // Credit Retained Earnings / Equity Offset
      accountingLines.push({
        lineSequence: lineSeq++,
        lineRole: 'RETAINED_EARNINGS',
        debitAmount: '0.00',
        creditAmount: existing.grossAmount,
        narration: `Opening Balance Offset - ${docNum}`
      });
    } else if (existing.documentType === 'CREDIT_NOTE') {
      // Debit Revenue (Taxable Amount)
      accountingLines.push({
        lineSequence: lineSeq++,
        lineRole: 'SALES_REVENUE',
        debitAmount: existing.taxableAmount,
        creditAmount: '0.00',
        narration: `Credit Note Sales Adjustment - ${docNum}`
      });

      // Debit Output Tax Components
      for (const line of existing.lines) {
        if (ExactDecimal.parse(line.cgstAmount, 2).isPositive()) {
          accountingLines.push({ lineSequence: lineSeq++, lineRole: 'OUTPUT_CGST', debitAmount: line.cgstAmount, creditAmount: '0.00', narration: `CGST Output Reversal` });
        }
        if (ExactDecimal.parse(line.sgstAmount, 2).isPositive()) {
          accountingLines.push({ lineSequence: lineSeq++, lineRole: 'OUTPUT_SGST', debitAmount: line.sgstAmount, creditAmount: '0.00', narration: `SGST Output Reversal` });
        }
        if (ExactDecimal.parse(line.igstAmount, 2).isPositive()) {
          accountingLines.push({ lineSequence: lineSeq++, lineRole: 'OUTPUT_IGST', debitAmount: line.igstAmount, creditAmount: '0.00', narration: `IGST Output Reversal` });
        }
        if (ExactDecimal.parse(line.utgstAmount, 2).isPositive()) {
          accountingLines.push({ lineSequence: lineSeq++, lineRole: 'OUTPUT_UTGST', debitAmount: line.utgstAmount, creditAmount: '0.00', narration: `UTGST Output Reversal` });
        }
        if (ExactDecimal.parse(line.cessAmount, 2).isPositive()) {
          accountingLines.push({ lineSequence: lineSeq++, lineRole: 'OUTPUT_CESS', debitAmount: line.cessAmount, creditAmount: '0.00', narration: `CESS Output Reversal` });
        }
      }

      // Credit AR Control (Gross Amount)
      accountingLines.push({
        lineSequence: lineSeq++,
        lineRole: 'AR_CONTROL',
        debitAmount: '0.00',
        creditAmount: existing.grossAmount,
        narration: `Credit Note AR Offset - ${docNum}`
      });
    }

    const acctEventInput: AccountingEventInput = {
      companyId: existing.companyId,
      eventType: `AR_${existing.documentType}`,
      accountingDate: existing.accountingDate,
      sourceModule: 'AR',
      sourceDocumentType: existing.documentType,
      sourceDocumentId: existing.id,
      narration: `AR ${existing.documentType} - ${docNum}`,
      idempotencyKey: postInput?.idempotencyKey,
      simulateFailure: postInput?.simulateFailure,
      lines: accountingLines
    };

    const postedJournal = await accountingCoreService.processAccountingEvent(ctx, acctEventInput);

    // 6. Commit AR Document State Updates & Open Item
    if (newOpenItem) {
      this.openItemsStore.set(this.getKey(ctx.tenantId, newOpenItem.id), newOpenItem);
    }

    const now = new Date();
    const postedDTO: ArDocumentDTO = {
      ...existing,
      documentNumber: docNum,
      outstandingAmount: outstandingStr,
      unappliedAmount: unappliedStr,
      status: 'POSTED',
      journalEntryId: postedJournal.id,
      version: existing.version + 1,
      updatedAt: now
    };

    this.documentsStore.set(key, postedDTO);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ArDocument',
      entityId: id,
      action: 'POST',
      newValues: {
        documentNumber: docNum,
        journalEntryId: postedJournal.id,
        grossAmount: postedDTO.grossAmount,
        status: 'POSTED'
      }
    });

    logger.info({ tenantId: ctx.tenantId, companyId: existing.companyId, docId: id, docNum, journalId: postedJournal.id }, '[AR] Document posted successfully');

    return postedDTO;
  }

  /**
   * Cancel a draft AR document
   */
  public async cancelDocument(ctx: RequestContext, id: string, reason: string): Promise<ArDocumentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.documentsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ArDocument', id);
    }

    this.authorize(ctx, 'ar:document:cancel', existing.companyId);

    if (existing.status === 'POSTED') {
      throw new BusinessRuleViolationError(`Cannot cancel POSTED AR document '${id}'. Posted financial records are immutable. Reversal requires a Credit Note or Debit Note.`);
    }

    if (existing.status === 'CANCELLED') {
      return existing;
    }

    const now = new Date();
    const cancelledDTO: ArDocumentDTO = {
      ...existing,
      status: 'CANCELLED',
      version: existing.version + 1,
      updatedAt: now
    };

    this.documentsStore.set(key, cancelledDTO);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ArDocument',
      entityId: id,
      action: 'CANCEL',
      reason,
      newValues: { status: 'CANCELLED' }
    });

    return cancelledDTO;
  }
}

export const arDocumentService = new ArDocumentService();
