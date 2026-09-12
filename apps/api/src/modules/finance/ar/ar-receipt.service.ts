import {
  RequestContext,
  NotFoundError,
  BusinessRuleViolationError,
  AccountingError,
  ExactDecimal
} from '@general-erp/core';
import { logger } from '../../../config/logger.js';
import { authorizationService } from '../../../platform/authorization/authorization.service.js';
import { auditService } from '../../../platform/audit/audit.service.js';
import { numberingEngine } from '../../../platform/numbering/numbering.service.js';
import { fiscalPeriodService } from '../fiscal-period.service.js';
import { accountingCoreService, AccountingEventInput, AccountingEventLineInput } from '../accounting-core.service.js';
import {
  ArReceiptDTO,
  CreateArReceiptInput,
  UpdateArReceiptInput,
  PostArReceiptInput,
  ArReceiptStatus
} from './ar-receipt-model.js';
import { ArReceiptValidator } from './ar-receipt-validator.js';
import type pg from 'pg';

export class ArReceiptService {
  private receiptsStore = new Map<string, ArReceiptDTO>();
  private dbPool?: pg.Pool | undefined;

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
    accountingCoreService.setDbPool(pool);
  }

  public getDbPool(): pg.Pool | undefined {
    return this.dbPool;
  }

  public clear(): void {
    this.receiptsStore.clear();
  }

  private getKey(tenantId: string, id: string): string {
    return `${tenantId}:${id}`;
  }

  private authorize(ctx: RequestContext, action: string, companyId: string): void {
    if (ctx.user) {
      const isWildcard = ctx.user.permissions.some(p => p === '*' || p === action || p.startsWith('ar:receipt:'));
      if (!isWildcard) {
        authorizationService.authorize({ user: ctx.user, action, companyId });
      }
    }
  }

  /**
   * Create a new Customer Receipt in DRAFT status
   */
  public async createDraft(ctx: RequestContext, input: CreateArReceiptInput): Promise<ArReceiptDTO> {
    const inputAny = input as any;
    input = {
      ...input,
      accountingDate: input.accountingDate || input.receiptDate,
      bankAccountId: input.bankAccountId || inputAny.depositAccountId,
      totalAmount: input.totalAmount || inputAny.amount
    };
    ArReceiptValidator.validateCreateInput(ctx, input);
    this.authorize(ctx, 'ar:receipt:create', input.companyId);
    await ArReceiptValidator.validateCustomer(ctx, input.companyId, input.customerId);
    await ArReceiptValidator.validateReceivingAccount(ctx, input.companyId, input.bankAccountId);

    const receiptId = `arrec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();

    const totalAmtDec = ExactDecimal.parse(input.totalAmount, 2);

    const receiptDTO: ArReceiptDTO = {
      id: receiptId,
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      customerId: input.customerId,
      receiptNumber: input.receiptNumber || null,
      receiptDate: input.receiptDate,
      accountingDate: input.accountingDate,
      paymentMode: input.paymentMode,
      bankAccountId: input.bankAccountId,
      totalAmount: totalAmtDec.toString(),
      allocatedAmount: '0.00',
      unappliedAmount: totalAmtDec.toString(),
      status: 'DRAFT',
      journalEntryId: null,
      version: 1,
      createdAt: now,
      updatedAt: now
    };

    this.receiptsStore.set(this.getKey(ctx.tenantId, receiptId), receiptDTO);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ArReceipt',
      entityId: receiptId,
      action: 'CREATE',
      newValues: {
        customerId: receiptDTO.customerId,
        totalAmount: receiptDTO.totalAmount,
        status: receiptDTO.status
      }
    });

    logger.info({ tenantId: ctx.tenantId, companyId: input.companyId, receiptId }, '[AR] Created draft customer receipt');
    return receiptDTO;
  }

  /**
   * Update a draft customer receipt
   */
  public async updateDraft(ctx: RequestContext, id: string, input: UpdateArReceiptInput): Promise<ArReceiptDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.receiptsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ArReceipt', id);
    }

    this.authorize(ctx, 'ar:receipt:update', existing.companyId);

    if (existing.status !== 'DRAFT') {
      throw new BusinessRuleViolationError(`Cannot update AR receipt '${id}'. Current status is '${existing.status}'. Only DRAFT receipts may be updated.`);
    }

    const companyId = existing.companyId;
    const customerId = input.customerId || existing.customerId;
    const bankAccountId = input.bankAccountId || existing.bankAccountId!;

    await ArReceiptValidator.validateCustomer(ctx, companyId, customerId);
    await ArReceiptValidator.validateReceivingAccount(ctx, companyId, bankAccountId);

    let totalAmount = existing.totalAmount;
    if (input.totalAmount) {
      ExactDecimal.validateScale(input.totalAmount, 2);
      const dec = ExactDecimal.parse(input.totalAmount, 2);
      if (!dec.isPositive()) {
        throw new BusinessRuleViolationError(`Receipt totalAmount must be positive (> 0.00). Provided: '${input.totalAmount}'.`);
      }
      totalAmount = dec.toString();
    }

    const now = new Date();
    const updatedDTO: ArReceiptDTO = {
      ...existing,
      customerId,
      receiptDate: input.receiptDate || existing.receiptDate,
      accountingDate: input.accountingDate || existing.accountingDate,
      paymentMode: input.paymentMode || existing.paymentMode,
      bankAccountId,
      totalAmount,
      unappliedAmount: totalAmount,
      referenceNumber: input.referenceNumber !== undefined ? input.referenceNumber : existing.referenceNumber,
      remarks: input.remarks !== undefined ? input.remarks : existing.remarks,
      version: existing.version + 1,
      updatedAt: now
    };

    this.receiptsStore.set(key, updatedDTO);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ArReceipt',
      entityId: id,
      action: 'UPDATE',
      newValues: {
        totalAmount: updatedDTO.totalAmount,
        version: updatedDTO.version
      }
    });

    return updatedDTO;
  }

  /**
   * Get an AR receipt by ID
   */
  public async getReceipt(ctx: RequestContext, id: string): Promise<ArReceiptDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const receipt = this.receiptsStore.get(key);
    if (!receipt) {
      throw new NotFoundError('ArReceipt', id);
    }
    this.authorize(ctx, 'ar:receipt:read', receipt.companyId);
    return receipt;
  }

  /**
   * List AR receipts for a company
   */
  public async listReceipts(
    ctx: RequestContext,
    companyId: string,
    filters?: { status?: ArReceiptStatus; customerId?: string }
  ): Promise<ArReceiptDTO[]> {
    this.authorize(ctx, 'ar:receipt:read', companyId);
    const result: ArReceiptDTO[] = [];
    for (const receipt of this.receiptsStore.values()) {
      if (receipt.tenantId === ctx.tenantId && receipt.companyId === companyId) {
        if (filters?.status && receipt.status !== filters.status) continue;
        if (filters?.customerId && receipt.customerId !== filters.customerId) continue;
        result.push(receipt);
      }
    }
    return result;
  }

  /**
   * Update receipt unapplied and allocated balance (used by Allocation Engine)
   */
  public async updateReceiptBalance(
    ctx: RequestContext,
    id: string,
    unappliedAmount: string,
    allocatedAmount: string
  ): Promise<ArReceiptDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.receiptsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ArReceipt', id);
    }

    const updated: ArReceiptDTO = {
      ...existing,
      unappliedAmount,
      allocatedAmount,
      updatedAt: new Date()
    };
    this.receiptsStore.set(key, updated);
    return updated;
  }

  /**
   * Atomically post an AR receipt (DRAFT -> POSTED)
   */
  public async postReceipt(ctx: RequestContext, id: string, postInput?: PostArReceiptInput): Promise<ArReceiptDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.receiptsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ArReceipt', id);
    }

    this.authorize(ctx, 'ar:receipt:post', existing.companyId);

    // Idempotent re-post handling
    if (existing.status === 'POSTED') {
      logger.info({ tenantId: ctx.tenantId, receiptId: id }, '[AR] Receipt is already POSTED — returning idempotent result');
      return existing;
    }

    if (existing.status === 'REVERSED') {
      throw new BusinessRuleViolationError(`Cannot post AR receipt '${id}'. Receipt status is REVERSED.`);
    }

    // 1. Fiscal Period Validation
    const acctDateObj = new Date(existing.accountingDate);
    const { fiscalYear, fiscalPeriod } = await fiscalPeriodService.resolvePeriod(ctx, existing.companyId, acctDateObj);
    await fiscalPeriodService.assertPeriodOpen(ctx, fiscalPeriod.id);

    // 2. Receipt Number Generation
    let receiptNum = existing.receiptNumber;
    if (!receiptNum || receiptNum.trim() === '') {
      receiptNum = numberingEngine.generateNextNumber(ctx.tenantId, existing.companyId, 'RECEIPT', fiscalYear.name, 'HQ');
    }

    // 3. Simulated Transaction Failure Injection Check
    if (postInput?.simulateFailure) {
      logger.error({ receiptId: id }, '[AR] Simulated transaction failure injected — triggering ROLLBACK');
      throw new AccountingError(`Simulated transaction failure during AR receipt posting for receipt '${id}'.`);
    }

    // 4. Construct Accounting Event & Post via AccountingCore / GLEngine
    // Line 1: Debit Cash/Bank Account (bankAccountId)
    // Line 2: Credit AR Control (AR_CONTROL mapping)
    const accountingLines: AccountingEventLineInput[] = [
      {
        lineSequence: 1,
        accountId: existing.bankAccountId || undefined,
        lineRole: 'CASH_BANK',
        debitAmount: existing.totalAmount,
        creditAmount: '0.00',
        narration: `Customer Receipt Cash/Bank - ${receiptNum}`
      },
      {
        lineSequence: 2,
        lineRole: 'AR_CONTROL',
        debitAmount: '0.00',
        creditAmount: existing.totalAmount,
        narration: `AR Control Credit - ${receiptNum}`
      }
    ];

    const acctEventInput: AccountingEventInput = {
      companyId: existing.companyId,
      eventType: 'AR_RECEIPT',
      accountingDate: existing.accountingDate,
      sourceModule: 'AR',
      sourceDocumentType: 'RECEIPT',
      sourceDocumentId: existing.id,
      narration: `AR Customer Receipt - ${receiptNum}`,
      idempotencyKey: postInput?.idempotencyKey,
      simulateFailure: postInput?.simulateFailure,
      lines: accountingLines
    };

    const postedJournal = await accountingCoreService.processAccountingEvent(ctx, acctEventInput);

    // 5. Commit Receipt State Updates
    const now = new Date();
    const postedDTO: ArReceiptDTO = {
      ...existing,
      receiptNumber: receiptNum,
      status: 'POSTED',
      allocatedAmount: '0.00',
      unappliedAmount: existing.totalAmount,
      journalEntryId: postedJournal.id,
      version: existing.version + 1,
      updatedAt: now
    };

    this.receiptsStore.set(key, postedDTO);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ArReceipt',
      entityId: id,
      action: 'POST',
      newValues: {
        receiptNumber: receiptNum,
        journalEntryId: postedJournal.id,
        totalAmount: postedDTO.totalAmount,
        unappliedAmount: postedDTO.unappliedAmount,
        status: 'POSTED'
      }
    });

    logger.info({ tenantId: ctx.tenantId, companyId: existing.companyId, receiptId: id, receiptNum, journalId: postedJournal.id }, '[AR] Receipt posted successfully');

    return postedDTO;
  }

  /**
   * Reverse a posted customer receipt
   */
  public async reverseReceipt(ctx: RequestContext, id: string, reason: string): Promise<ArReceiptDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.receiptsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ArReceipt', id);
    }

    this.authorize(ctx, 'ar:receipt:cancel', existing.companyId);

    if (existing.status !== 'POSTED') {
      throw new BusinessRuleViolationError(`Cannot reverse AR receipt '${id}'. Only POSTED receipts may be reversed.`);
    }

    if (!existing.journalEntryId) {
      throw new BusinessRuleViolationError(`Cannot reverse AR receipt '${id}'. Missing posted journal link.`);
    }

    // Orchestrate append-only GL reversal via AccountingCore
    await accountingCoreService.reverseAccountingEvent(ctx, {
      originalJournalId: existing.journalEntryId,
      reason
    });

    const now = new Date();
    const reversedDTO: ArReceiptDTO = {
      ...existing,
      status: 'REVERSED',
      version: existing.version + 1,
      updatedAt: now
    };

    this.receiptsStore.set(key, reversedDTO);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ArReceipt',
      entityId: id,
      action: 'CANCEL',
      reason,
      newValues: { status: 'REVERSED' }
    });

    return reversedDTO;
  }
}

export const arReceiptService = new ArReceiptService();
