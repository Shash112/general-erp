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
  ApDocumentDTO,
  ApDocumentLineDTO,
  ApOpenItemDTO,
  CreateApDocumentInput,
  UpdateApDocumentInput,
  PostApDocumentInput,
  ApDocumentStatus,
  ApDocumentFilterInput
} from './ap-document-model.js';
import { ApDocumentValidator } from './ap-document-validator.js';
import type pg from 'pg';

export class ApDocumentService {
  private documentsStore = new Map<string, ApDocumentDTO>();
  private openItemsStore = new Map<string, ApOpenItemDTO>();
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
      const isWildcard = ctx.user.permissions.some(p => p === '*' || p === action || p.startsWith('ap:document:'));
      if (!isWildcard) {
        authorizationService.authorize({ user: ctx.user, action, companyId });
      }
    }
  }

  /**
   * Create a new AP Document in DRAFT status
   */
  public async createDraft(ctx: RequestContext, input: CreateApDocumentInput): Promise<ApDocumentDTO> {
    input = {
      ...input,
      accountingDate: input.accountingDate || input.documentDate
    };
    await ApDocumentValidator.validateCreateInput(ctx, input);
    this.authorize(ctx, 'ap:document:create', input.companyId);

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

    const isTaxable = (input.taxability ?? 'TAXABLE') === 'TAXABLE';
    let docTaxable = ExactDecimal.ZERO;
    let docTax = ExactDecimal.ZERO;
    let docGross = ExactDecimal.ZERO;

    let docCgst = ExactDecimal.ZERO;
    let docSgst = ExactDecimal.ZERO;
    let docIgst = ExactDecimal.ZERO;
    let docUtgst = ExactDecimal.ZERO;
    let docCess = ExactDecimal.ZERO;

    const constructedLines: ApDocumentLineDTO[] = [];
    const docId = `apdoc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();

    for (let i = 0; i < input.lines.length; i++) {
      const lineInput = input.lines[i]!;
      const seq = i + 1;

      // Validate amounts & exact decimal scale
      const parsed = ApDocumentValidator.validateLineAmountsAndScale(lineInput, seq);

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
              const supp = await masterDataService.getSupplier(ctx, input.supplierId);
              const suppStateCode = supp.gstin ? supp.gstin.substring(0, 2) : undefined;
              if (suppStateCode && suppStateCode !== input.placeOfSupplyStateCode) {
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
          // Keep provided values if resolution fails or not configured
        }
      }

      const lineId = `apdl_${Date.now()}_${seq}_${Math.random().toString(36).substring(2, 6)}`;
      const lineDTO: ApDocumentLineDTO = {
        id: lineId,
        tenantId: ctx.tenantId,
        companyId: input.companyId,
        apDocumentId: docId,
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
        expenseAccountId: lineInput.expenseAccountId,
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

    const docDTO: ApDocumentDTO = {
      id: docId,
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      supplierId: input.supplierId,
      branchId: input.branchId || null,
      documentType: input.documentType,
      documentNumber: input.documentNumber || null,
      supplierInvoiceNumber: input.supplierInvoiceNumber || null,
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
      sourceModule: 'AP',
      sourceDocumentId: input.supplierInvoiceNumber || null,
      journalEntryId: null,
      paymentTermsDays: input.paymentTermsDays ?? 30,
      remarks: input.remarks || null,
      lines: constructedLines,
      version: 1,
      createdAt: now,
      updatedAt: now
    };

    this.documentsStore.set(this.getKey(ctx.tenantId, docId), docDTO);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ApDocument',
      entityId: docId,
      action: 'CREATE',
      newValues: {
        documentType: docDTO.documentType,
        supplierId: docDTO.supplierId,
        grossAmount: docDTO.grossAmount,
        status: docDTO.status
      }
    });

    logger.info({ tenantId: ctx.tenantId, companyId: input.companyId, docId }, '[AP] Created draft document');
    return docDTO;
  }

  /**
   * Update a draft AP document
   */
  public async updateDraft(ctx: RequestContext, id: string, input: UpdateApDocumentInput): Promise<ApDocumentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.documentsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ApDocument', id);
    }

    this.authorize(ctx, 'ap:document:update', existing.companyId);

    if (existing.status !== 'DRAFT') {
      throw new BusinessRuleViolationError(`Cannot update AP document '${id}'. Current status is '${existing.status}'. Only DRAFT documents may be updated.`);
    }

    const companyId = existing.companyId;
    const supplierId = input.supplierId || existing.supplierId;
    await ApDocumentValidator.validateSupplier(ctx, companyId, supplierId);

    const docDate = input.documentDate || existing.documentDate;
    const acctDate = input.accountingDate || existing.accountingDate;
    const dueDate = input.dueDate || existing.dueDate;
    ApDocumentValidator.validateDates(docDate, acctDate, dueDate);

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
      isSez: l.isSez,
      expenseAccountId: l.expenseAccountId
    }));

    let docTaxable = ExactDecimal.ZERO;
    let docTax = ExactDecimal.ZERO;
    let docGross = ExactDecimal.ZERO;

    const updatedLines: ApDocumentLineDTO[] = [];
    const now = new Date();

    for (let i = 0; i < linesInput.length; i++) {
      const lineInput = linesInput[i]!;
      const seq = i + 1;
      const parsed = ApDocumentValidator.validateLineAmountsAndScale(lineInput, seq);

      const lineId = existing.lines[i]?.id || `apdl_${Date.now()}_${seq}`;
      const lineDTO: ApDocumentLineDTO = {
        id: lineId,
        tenantId: ctx.tenantId,
        companyId,
        apDocumentId: existing.id,
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
        expenseAccountId: lineInput.expenseAccountId,
        createdAt: existing.lines[i]?.createdAt || now
      };

      updatedLines.push(lineDTO);
      docTaxable = docTaxable.add(parsed.taxableAmount);
      docTax = docTax.add(parsed.taxAmount);
      docGross = docGross.add(parsed.grossAmount);
    }

    const updatedDTO: ApDocumentDTO = {
      ...existing,
      supplierId,
      branchId: input.branchId !== undefined ? (input.branchId || null) : existing.branchId,
      supplierInvoiceNumber: input.supplierInvoiceNumber !== undefined ? (input.supplierInvoiceNumber || null) : existing.supplierInvoiceNumber,
      documentDate: docDate,
      accountingDate: acctDate,
      dueDate,
      placeOfSupplyStateCode: input.placeOfSupplyStateCode !== undefined ? (input.placeOfSupplyStateCode || null) : existing.placeOfSupplyStateCode,
      supplyNature: input.supplyNature !== undefined ? (input.supplyNature || null) : existing.supplyNature,
      taxability: input.taxability !== undefined ? input.taxability : existing.taxability,
      isRcm: input.isRcm !== undefined ? input.isRcm : existing.isRcm,
      isSez: input.isSez !== undefined ? input.isSez : existing.isSez,
      paymentTermsDays: input.paymentTermsDays !== undefined ? input.paymentTermsDays : existing.paymentTermsDays,
      remarks: input.remarks !== undefined ? (input.remarks || null) : existing.remarks,
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
      entityName: 'ApDocument',
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
   * Get an AP document by ID
   */
  public async getDocument(ctx: RequestContext, id: string): Promise<ApDocumentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const doc = this.documentsStore.get(key);
    if (!doc) {
      throw new NotFoundError('ApDocument', id);
    }
    this.authorize(ctx, 'ap:document:read', doc.companyId);
    return doc;
  }

  /**
   * List AP documents for a company
   */
  public async listDocuments(
    ctx: RequestContext,
    companyId: string,
    filters?: ApDocumentFilterInput
  ): Promise<ApDocumentDTO[]> {
    this.authorize(ctx, 'ap:document:read', companyId);
    const result: ApDocumentDTO[] = [];
    for (const doc of this.documentsStore.values()) {
      if (doc.tenantId === ctx.tenantId && doc.companyId === companyId) {
        if (filters?.status && doc.status !== filters.status) continue;
        if (filters?.supplierId && doc.supplierId !== filters.supplierId) continue;
        if (filters?.documentType && doc.documentType !== filters.documentType) continue;
        result.push(doc);
      }
    }
    return result;
  }

  /**
   * List AP open items for a company
   */
  public async getOpenItems(
    ctx: RequestContext,
    companyId: string,
    filters?: { supplierId?: string; status?: string }
  ): Promise<ApOpenItemDTO[]> {
    this.authorize(ctx, 'ap:document:read', companyId);
    const result: ApOpenItemDTO[] = [];
    for (const item of this.openItemsStore.values()) {
      if (item.tenantId === ctx.tenantId && item.companyId === companyId) {
        if (filters?.supplierId && item.supplierId !== filters.supplierId) continue;
        if (filters?.status && item.status !== filters.status) continue;
        result.push(item);
      }
    }
    return result;
  }

  /**
   * Get an open item by ID
   */
  public async getOpenItem(ctx: RequestContext, id: string): Promise<ApOpenItemDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const item = this.openItemsStore.get(key);
    if (!item) {
      throw new NotFoundError('ApOpenItem', id);
    }
    this.authorize(ctx, 'ap:document:read', item.companyId);
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
  ): Promise<ApOpenItemDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.openItemsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ApOpenItem', id);
    }

    const updated: ApOpenItemDTO = {
      ...existing,
      outstandingAmount,
      status,
      updatedAt: new Date()
    };
    this.openItemsStore.set(key, updated);

    // Update parent document's outstanding amount and status if linked
    if (existing.apDocumentId) {
      const docKey = this.getKey(ctx.tenantId, existing.apDocumentId);
      const doc = this.documentsStore.get(docKey);
      if (doc) {
        const origGrossDec = ExactDecimal.parse(doc.grossAmount, 2);
        const newOutDec = ExactDecimal.parse(outstandingAmount, 2);
        const newAllocDec = origGrossDec.sub(newOutDec);

        let docStatus: ApDocumentStatus = doc.status;
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
  ): Promise<ApDocumentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const doc = this.documentsStore.get(key);
    if (!doc) {
      throw new NotFoundError('ApDocument', id);
    }
    if (doc.documentType !== 'CREDIT_NOTE') {
      throw new BusinessRuleViolationError(`Document '${id}' is not a CREDIT_NOTE.`);
    }

    ExactDecimal.validateScale(unappliedAmount, 2);
    ExactDecimal.validateScale(allocatedAmount, 2);

    const updated: ApDocumentDTO = {
      ...doc,
      unappliedAmount,
      allocatedAmount,
      status: 'POSTED',
      updatedAt: new Date()
    };
    this.documentsStore.set(key, updated);
    return updated;
  }

  /**
   * Atomically post an AP document (DRAFT -> POSTED)
   */
  public async postDocument(ctx: RequestContext, id: string, postInput?: PostApDocumentInput): Promise<ApDocumentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.documentsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ApDocument', id);
    }

    this.authorize(ctx, 'ap:document:post', existing.companyId);

    // Idempotent re-post handling
    if (existing.status === 'POSTED') {
      logger.info({ tenantId: ctx.tenantId, docId: id }, '[AP] Document is already POSTED — returning idempotent result');
      return existing;
    }

    if (existing.status === 'CANCELLED') {
      throw new BusinessRuleViolationError(`Cannot post AP document '${id}'. Document status is CANCELLED.`);
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
    let newOpenItem: ApOpenItemDTO | null = null;

    if (!isCreditNote) {
      // CREDIT Open Item (SUPPLIER_BILL, DEBIT_NOTE, OPENING_BALANCE)
      outstandingStr = existing.grossAmount;
      unappliedStr = '0.00';

      const openItemId = `apoi_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      newOpenItem = {
        id: openItemId,
        tenantId: ctx.tenantId,
        companyId: existing.companyId,
        supplierId: existing.supplierId,
        apDocumentId: existing.id,
        documentType: existing.documentType,
        documentNumber: docNum,
        documentDate: existing.documentDate,
        dueDate: existing.dueDate,
        currency: existing.currency,
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
      logger.error({ docId: id }, '[AP] Simulated transaction failure injected — triggering ROLLBACK');
      throw new AccountingError(`Simulated transaction failure during AP document posting for document '${id}'.`);
    }

    // 5. Construct Accounting Event & Post via AccountingCore / GLEngine
    const accountingLines: AccountingEventLineInput[] = [];
    let lineSeq = 1;

    if (existing.documentType === 'SUPPLIER_BILL' || existing.documentType === 'DEBIT_NOTE') {
      // Debit Expense / Inventory Lines per document line
      for (const line of existing.lines) {
        accountingLines.push({
          lineSequence: lineSeq++,
          accountId: line.expenseAccountId,
          lineRole: 'PURCHASE_EXPENSE',
          debitAmount: line.taxableAmount,
          creditAmount: '0.00',
          narration: `Purchase Expense - ${docNum} (${line.description})`
        });
      }

      // Debit Input Tax Component Lines
      for (const line of existing.lines) {
        if (ExactDecimal.parse(line.cgstAmount, 2).isPositive()) {
          accountingLines.push({ lineSequence: lineSeq++, lineRole: 'INPUT_CGST', debitAmount: line.cgstAmount, creditAmount: '0.00', narration: `CGST Input ${line.taxRatePercent}%` });
        }
        if (ExactDecimal.parse(line.sgstAmount, 2).isPositive()) {
          accountingLines.push({ lineSequence: lineSeq++, lineRole: 'INPUT_SGST', debitAmount: line.sgstAmount, creditAmount: '0.00', narration: `SGST Input ${line.taxRatePercent}%` });
        }
        if (ExactDecimal.parse(line.igstAmount, 2).isPositive()) {
          accountingLines.push({ lineSequence: lineSeq++, lineRole: 'INPUT_IGST', debitAmount: line.igstAmount, creditAmount: '0.00', narration: `IGST Input ${line.taxRatePercent}%` });
        }
        if (ExactDecimal.parse(line.utgstAmount, 2).isPositive()) {
          accountingLines.push({ lineSequence: lineSeq++, lineRole: 'INPUT_UTGST', debitAmount: line.utgstAmount, creditAmount: '0.00', narration: `UTGST Input ${line.taxRatePercent}%` });
        }
        if (ExactDecimal.parse(line.cessAmount, 2).isPositive()) {
          accountingLines.push({ lineSequence: lineSeq++, lineRole: 'INPUT_CESS', debitAmount: line.cessAmount, creditAmount: '0.00', narration: `CESS Input` });
        }
      }

      // Credit AP Control (Gross Amount)
      accountingLines.push({
        lineSequence: lineSeq++,
        lineRole: 'AP_CONTROL',
        debitAmount: '0.00',
        creditAmount: existing.grossAmount,
        narration: `AP Payable - ${docNum}`
      });
    } else if (existing.documentType === 'OPENING_BALANCE') {
      // Debit Retained Earnings / Opening Equity Offset
      accountingLines.push({
        lineSequence: lineSeq++,
        lineRole: 'RETAINED_EARNINGS',
        debitAmount: existing.grossAmount,
        creditAmount: '0.00',
        narration: `Opening Balance Offset - ${docNum}`
      });

      // Credit AP Control (Gross Amount)
      accountingLines.push({
        lineSequence: lineSeq++,
        lineRole: 'AP_CONTROL',
        debitAmount: '0.00',
        creditAmount: existing.grossAmount,
        narration: `Opening Payable - ${docNum}`
      });
    } else if (existing.documentType === 'CREDIT_NOTE') {
      // Debit AP Control (Gross Amount)
      accountingLines.push({
        lineSequence: lineSeq++,
        lineRole: 'AP_CONTROL',
        debitAmount: existing.grossAmount,
        creditAmount: '0.00',
        narration: `Credit Note AP Offset - ${docNum}`
      });

      // Credit Expense / Purchase Returns per document line
      for (const line of existing.lines) {
        accountingLines.push({
          lineSequence: lineSeq++,
          accountId: line.expenseAccountId,
          lineRole: 'PURCHASE_EXPENSE',
          debitAmount: '0.00',
          creditAmount: line.taxableAmount,
          narration: `Credit Note Purchase Reversal - ${docNum} (${line.description})`
        });
      }

      // Credit Input Tax Component Reversals
      for (const line of existing.lines) {
        if (ExactDecimal.parse(line.cgstAmount, 2).isPositive()) {
          accountingLines.push({ lineSequence: lineSeq++, lineRole: 'INPUT_CGST', debitAmount: '0.00', creditAmount: line.cgstAmount, narration: `CGST Input Reversal` });
        }
        if (ExactDecimal.parse(line.sgstAmount, 2).isPositive()) {
          accountingLines.push({ lineSequence: lineSeq++, lineRole: 'INPUT_SGST', debitAmount: '0.00', creditAmount: line.sgstAmount, narration: `SGST Input Reversal` });
        }
        if (ExactDecimal.parse(line.igstAmount, 2).isPositive()) {
          accountingLines.push({ lineSequence: lineSeq++, lineRole: 'INPUT_IGST', debitAmount: '0.00', creditAmount: line.igstAmount, narration: `IGST Input Reversal` });
        }
        if (ExactDecimal.parse(line.utgstAmount, 2).isPositive()) {
          accountingLines.push({ lineSequence: lineSeq++, lineRole: 'INPUT_UTGST', debitAmount: '0.00', creditAmount: line.utgstAmount, narration: `UTGST Input Reversal` });
        }
        if (ExactDecimal.parse(line.cessAmount, 2).isPositive()) {
          accountingLines.push({ lineSequence: lineSeq++, lineRole: 'INPUT_CESS', debitAmount: '0.00', creditAmount: line.cessAmount, narration: `CESS Input Reversal` });
        }
      }
    }

    const acctEventInput: AccountingEventInput = {
      companyId: existing.companyId,
      eventType: `AP_${existing.documentType}`,
      accountingDate: existing.accountingDate,
      sourceModule: 'AP',
      sourceDocumentType: existing.documentType,
      sourceDocumentId: existing.id,
      narration: `AP ${existing.documentType} - ${docNum}`,
      idempotencyKey: postInput?.idempotencyKey,
      simulateFailure: postInput?.simulateFailure,
      lines: accountingLines
    };

    const postedJournal = await accountingCoreService.processAccountingEvent(ctx, acctEventInput);

    // Commit AP Document State Updates & Open Item
    if (newOpenItem) {
      this.openItemsStore.set(this.getKey(ctx.tenantId, newOpenItem.id), newOpenItem);
    }

    const now = new Date();
    const postedDTO: ApDocumentDTO = {
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
      entityName: 'ApDocument',
      entityId: id,
      action: 'POST',
      newValues: {
        documentNumber: docNum,
        journalEntryId: postedJournal.id,
        grossAmount: postedDTO.grossAmount,
        status: 'POSTED'
      }
    });

    logger.info({ tenantId: ctx.tenantId, companyId: existing.companyId, docId: id, docNum, journalId: postedJournal.id }, '[AP] Document posted successfully');

    return postedDTO;
  }

  /**
   * Cancel a draft AP document
   */
  public async cancelDocument(ctx: RequestContext, id: string, reason: string): Promise<ApDocumentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.documentsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ApDocument', id);
    }

    this.authorize(ctx, 'ap:document:cancel', existing.companyId);

    if (existing.status === 'POSTED') {
      throw new BusinessRuleViolationError(`Cannot cancel POSTED AP document '${id}'. Posted financial records are immutable. Reversal requires a Credit Note or Debit Note.`);
    }

    if (existing.status === 'CANCELLED') {
      return existing;
    }

    const now = new Date();
    const cancelledDTO: ApDocumentDTO = {
      ...existing,
      status: 'CANCELLED',
      version: existing.version + 1,
      updatedAt: now
    };

    this.documentsStore.set(key, cancelledDTO);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ApDocument',
      entityId: id,
      action: 'CANCEL',
      reason,
      newValues: { status: 'CANCELLED' }
    });

    return cancelledDTO;
  }

  /**
   * Reverse a posted AP document
   */
  public async reverseDocument(ctx: RequestContext, id: string, reason: string, reversalAccountingDate?: string): Promise<ApDocumentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.documentsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ApDocument', id);
    }

    this.authorize(ctx, 'ap:document:cancel', existing.companyId);

    if (existing.status !== 'POSTED') {
      throw new BusinessRuleViolationError(`Cannot reverse AP document '${id}'. Status is '${existing.status}'.`);
    }

    if (existing.journalEntryId) {
      await accountingCoreService.reverseAccountingEvent(ctx, {
        originalJournalId: existing.journalEntryId,
        reason
      });
    }

    const now = new Date();
    const reversedDTO: ApDocumentDTO = {
      ...existing,
      status: 'REVERSED',
      reversalAccountingDate: reversalAccountingDate || (existing as any).reversalAccountingDate || now.toISOString().substring(0, 10),
      version: existing.version + 1,
      updatedAt: now
    };

    this.documentsStore.set(key, reversedDTO);

    for (const [openKey, item] of this.openItemsStore.entries()) {
      if (item.tenantId === ctx.tenantId && item.apDocumentId === id) {
        this.openItemsStore.set(openKey, {
          ...item,
          status: 'CANCELLED',
          updatedAt: now
        });
      }
    }

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ApDocument',
      entityId: id,
      action: 'REVERSE',
      reason,
      newValues: { status: 'REVERSED', reversalAccountingDate: reversedDTO.reversalAccountingDate }
    });

    return reversedDTO;
  }
}

export const apDocumentService = new ApDocumentService();
