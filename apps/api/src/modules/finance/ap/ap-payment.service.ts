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
  ApPaymentDTO,
  CreateApPaymentInput,
  UpdateApPaymentInput,
  PostApPaymentInput,
  ApPaymentFilterInput
} from './ap-payment-model.js';
import { ApPaymentValidator } from './ap-payment-validator.js';
import type pg from 'pg';

export class ApPaymentService {
  private paymentsStore = new Map<string, ApPaymentDTO>();
  private dbPool?: pg.Pool | undefined;

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
    accountingCoreService.setDbPool(pool);
  }

  public getDbPool(): pg.Pool | undefined {
    return this.dbPool;
  }

  public clear(): void {
    this.paymentsStore.clear();
  }

  private getKey(tenantId: string, id: string): string {
    return `${tenantId}:${id}`;
  }

  private authorize(ctx: RequestContext, action: string, companyId: string): void {
    if (ctx.user) {
      const isWildcard = ctx.user.permissions.some(p => p === '*' || p === action || p.startsWith('ap:payment:'));
      if (!isWildcard) {
        authorizationService.authorize({ user: ctx.user, action, companyId });
      }
    }
  }

  /**
   * Create a new Supplier Payment in DRAFT status
   */
  public async createDraft(ctx: RequestContext, input: CreateApPaymentInput): Promise<ApPaymentDTO> {
    input = {
      ...input,
      accountingDate: input.accountingDate || input.paymentDate
    };
    ApPaymentValidator.validateCreateInput(ctx, input);
    this.authorize(ctx, 'ap:payment:create', input.companyId);
    await ApPaymentValidator.validateSupplier(ctx, input.companyId, input.supplierId);
    await ApPaymentValidator.validatePayingAccount(ctx, input.companyId, input.bankAccountId);

    const paymentId = `appay_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();

    const totalAmtDec = ExactDecimal.parse(input.totalAmount, 2);

    const paymentDTO: ApPaymentDTO = {
      id: paymentId,
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      supplierId: input.supplierId,
      paymentNumber: input.paymentNumber || null,
      paymentDate: input.paymentDate,
      accountingDate: input.accountingDate!,
      paymentMode: input.paymentMode,
      bankAccountId: input.bankAccountId,
      totalAmount: totalAmtDec.toString(),
      allocatedAmount: '0.00',
      unappliedAmount: totalAmtDec.toString(),
      status: 'DRAFT',
      journalEntryId: null,
      referenceNumber: input.referenceNumber || null,
      remarks: input.remarks || null,
      version: 1,
      createdAt: now,
      updatedAt: now
    };

    this.paymentsStore.set(this.getKey(ctx.tenantId, paymentId), paymentDTO);

    // If DB pool is configured, insert into ap_payments table as well
    if (this.dbPool) {
      const client = await this.dbPool.connect();
      try {
        await client.query(
          `INSERT INTO ap_payments (
            id, tenant_id, company_id, supplier_id, payment_number,
            payment_date, accounting_date, payment_mode, bank_account_id,
            total_amount, allocated_amount, unapplied_amount, status,
            reference_number, remarks, version, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())`,
          [
            paymentDTO.id,
            paymentDTO.tenantId,
            paymentDTO.companyId,
            paymentDTO.supplierId,
            paymentDTO.paymentNumber,
            paymentDTO.paymentDate,
            paymentDTO.accountingDate,
            paymentDTO.paymentMode,
            paymentDTO.bankAccountId,
            paymentDTO.totalAmount,
            paymentDTO.allocatedAmount,
            paymentDTO.unappliedAmount,
            paymentDTO.status,
            paymentDTO.referenceNumber,
            paymentDTO.remarks,
            paymentDTO.version
          ]
        );
      } catch (err) {
        logger.error({ err, paymentId }, '[AP] Error inserting draft payment into database');
        throw err;
      } finally {
        client.release();
      }
    }

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ApPayment',
      entityId: paymentId,
      action: 'CREATE',
      newValues: {
        supplierId: paymentDTO.supplierId,
        totalAmount: paymentDTO.totalAmount,
        status: paymentDTO.status
      }
    });

    logger.info({ tenantId: ctx.tenantId, companyId: input.companyId, paymentId }, '[AP] Created draft supplier payment');
    return paymentDTO;
  }

  /**
   * Update a draft supplier payment
   */
  public async updateDraft(ctx: RequestContext, id: string, input: UpdateApPaymentInput): Promise<ApPaymentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.paymentsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ApPayment', id);
    }

    this.authorize(ctx, 'ap:payment:update', existing.companyId);

    if (existing.status !== 'DRAFT') {
      throw new BusinessRuleViolationError(`Cannot update AP payment '${id}'. Current status is '${existing.status}'. Only DRAFT payments may be updated.`);
    }

    const companyId = existing.companyId;
    const supplierId = input.supplierId || existing.supplierId;
    const bankAccountId = input.bankAccountId || existing.bankAccountId!;

    await ApPaymentValidator.validateSupplier(ctx, companyId, supplierId);
    await ApPaymentValidator.validatePayingAccount(ctx, companyId, bankAccountId);

    let totalAmount = existing.totalAmount;
    if (input.totalAmount) {
      ExactDecimal.validateScale(input.totalAmount, 2);
      const dec = ExactDecimal.parse(input.totalAmount, 2);
      if (!dec.isPositive()) {
        throw new BusinessRuleViolationError(`Payment totalAmount must be positive (> 0.00). Provided: '${input.totalAmount}'.`);
      }
      totalAmount = dec.toString();
    }

    const now = new Date();
    const updatedDTO: ApPaymentDTO = {
      ...existing,
      supplierId,
      paymentDate: input.paymentDate || existing.paymentDate,
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

    this.paymentsStore.set(key, updatedDTO);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ApPayment',
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
   * Get an AP payment by ID
   */
  public async getPayment(ctx: RequestContext, id: string): Promise<ApPaymentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const payment = this.paymentsStore.get(key);
    if (!payment) {
      throw new NotFoundError('ApPayment', id);
    }
    this.authorize(ctx, 'ap:payment:read', payment.companyId);
    return payment;
  }

  /**
   * List AP payments for a company
   */
  public async listPayments(
    ctx: RequestContext,
    companyId: string,
    filters?: ApPaymentFilterInput
  ): Promise<ApPaymentDTO[]> {
    this.authorize(ctx, 'ap:payment:read', companyId);
    const result: ApPaymentDTO[] = [];
    for (const payment of this.paymentsStore.values()) {
      if (payment.tenantId === ctx.tenantId && payment.companyId === companyId) {
        if (filters?.status && payment.status !== filters.status) continue;
        if (filters?.supplierId && payment.supplierId !== filters.supplierId) continue;
        if (filters?.paymentMode && payment.paymentMode !== filters.paymentMode) continue;
        result.push(payment);
      }
    }
    return result;
  }

  /**
   * Update payment unapplied and allocated balance (used by Allocation Engine)
   */
  public async updatePaymentBalance(
    ctx: RequestContext,
    id: string,
    unappliedAmount: string,
    allocatedAmount: string
  ): Promise<ApPaymentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.paymentsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ApPayment', id);
    }

    const updated: ApPaymentDTO = {
      ...existing,
      unappliedAmount,
      allocatedAmount,
      updatedAt: new Date()
    };
    this.paymentsStore.set(key, updated);
    return updated;
  }

  /**
   * Atomically post an AP payment (DRAFT -> POSTED)
   */
  public async postPayment(ctx: RequestContext, id: string, postInput?: PostApPaymentInput): Promise<ApPaymentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.paymentsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ApPayment', id);
    }

    this.authorize(ctx, 'ap:payment:post', existing.companyId);

    // Idempotent re-post handling
    if (existing.status === 'POSTED') {
      logger.info({ tenantId: ctx.tenantId, paymentId: id }, '[AP] Payment is already POSTED — returning idempotent result');
      return existing;
    }

    if (existing.status === 'REVERSED') {
      throw new BusinessRuleViolationError(`Cannot post AP payment '${id}'. Payment status is REVERSED.`);
    }

    // 1. Fiscal Period Validation
    const acctDateObj = new Date(existing.accountingDate);
    const { fiscalYear, fiscalPeriod } = await fiscalPeriodService.resolvePeriod(ctx, existing.companyId, acctDateObj);
    await fiscalPeriodService.assertPeriodOpen(ctx, fiscalPeriod.id);

    // 2. Payment Number Generation
    let paymentNum = existing.paymentNumber;
    if (!paymentNum || paymentNum.trim() === '') {
      paymentNum = numberingEngine.generateNextNumber(ctx.tenantId, existing.companyId, 'PAYMENT', fiscalYear.name, 'HQ');
    }

    // 3. Simulated Transaction Failure Injection Check
    if (postInput?.simulateFailure) {
      logger.error({ paymentId: id }, '[AP] Simulated transaction failure injected — triggering ROLLBACK');
      throw new AccountingError(`Simulated transaction failure during AP payment posting for payment '${id}'.`);
    }

    // 4. Construct Accounting Event & Post via AccountingCore / GLEngine
    // Supplier Payment is a DEBIT source against AP liability:
    // Line 1: Debit AP Control Account (AP_CONTROL lineRole)
    // Line 2: Credit Cash/Bank Account (bankAccountId)
    const accountingLines: AccountingEventLineInput[] = [
      {
        lineSequence: 1,
        lineRole: 'AP_CONTROL',
        debitAmount: existing.totalAmount,
        creditAmount: '0.00',
        narration: `AP Supplier Payment - ${paymentNum}`
      },
      {
        lineSequence: 2,
        accountId: existing.bankAccountId || undefined,
        lineRole: 'CASH_BANK',
        debitAmount: '0.00',
        creditAmount: existing.totalAmount,
        narration: `Supplier Payment Bank/Cash Credit - ${paymentNum}`
      }
    ];

    const acctEventInput: AccountingEventInput = {
      companyId: existing.companyId,
      eventType: 'AP_PAYMENT',
      accountingDate: existing.accountingDate,
      sourceModule: 'AP',
      sourceDocumentType: 'PAYMENT',
      sourceDocumentId: existing.id,
      narration: `AP Supplier Payment - ${paymentNum}`,
      idempotencyKey: postInput?.idempotencyKey,
      simulateFailure: postInput?.simulateFailure,
      lines: accountingLines
    };

    const postedJournal = await accountingCoreService.processAccountingEvent(ctx, acctEventInput);

    // 5. Commit Payment State Updates
    const now = new Date();
    const postedDTO: ApPaymentDTO = {
      ...existing,
      paymentNumber: paymentNum,
      status: 'POSTED',
      allocatedAmount: '0.00',
      unappliedAmount: existing.totalAmount,
      journalEntryId: postedJournal.id,
      version: existing.version + 1,
      updatedAt: now
    };

    this.paymentsStore.set(key, postedDTO);

    // If DB pool is configured, update DB row with transaction-local authorization
    if (this.dbPool) {
      const client = await this.dbPool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL app.ap_posting_authorized = 'true'");
        await client.query("SET LOCAL app.posting_authorized = 'true'");
        await client.query(
          `UPDATE ap_payments SET
            payment_number = $1,
            status = 'POSTED',
            allocated_amount = '0.00',
            unapplied_amount = $2,
            journal_entry_id = $3,
            version = version + 1,
            updated_at = NOW()
          WHERE id = $4 AND tenant_id = $5 AND company_id = $6`,
          [paymentNum, postedDTO.unappliedAmount, postedJournal.id, existing.id, ctx.tenantId, existing.companyId]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ err, paymentId: id }, '[AP] Error updating posted payment in database');
        throw err;
      } finally {
        client.release();
      }
    }

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ApPayment',
      entityId: id,
      action: 'POST',
      newValues: {
        paymentNumber: paymentNum,
        journalEntryId: postedJournal.id,
        totalAmount: postedDTO.totalAmount,
        unappliedAmount: postedDTO.unappliedAmount,
        status: 'POSTED'
      }
    });

    logger.info(
      { tenantId: ctx.tenantId, companyId: existing.companyId, paymentId: id, paymentNum, journalId: postedJournal.id },
      '[AP] Supplier payment posted successfully'
    );

    return postedDTO;
  }

  /**
   * Reverse a posted supplier payment
   */
  public async reversePayment(ctx: RequestContext, id: string, reason: string, reversalAccountingDate?: string): Promise<ApPaymentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.paymentsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ApPayment', id);
    }

    this.authorize(ctx, 'ap:payment:cancel', existing.companyId);

    if (existing.status !== 'POSTED') {
      throw new BusinessRuleViolationError(`Cannot reverse AP payment '${id}'. Only POSTED payments may be reversed.`);
    }

    if (!existing.journalEntryId) {
      throw new BusinessRuleViolationError(`Cannot reverse AP payment '${id}'. Missing posted journal link.`);
    }

    // Orchestrate append-only GL reversal via AccountingCore
    await accountingCoreService.reverseAccountingEvent(ctx, {
      originalJournalId: existing.journalEntryId,
      reason
    });

    const now = new Date();
    const reversedDTO: ApPaymentDTO = {
      ...existing,
      status: 'REVERSED',
      reversalAccountingDate: reversalAccountingDate || (existing as any).reversalAccountingDate || now.toISOString().substring(0, 10),
      version: existing.version + 1,
      updatedAt: now
    };

    this.paymentsStore.set(key, reversedDTO);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ApPayment',
      entityId: id,
      action: 'CANCEL',
      reason,
      newValues: { status: 'REVERSED' }
    });

    return reversedDTO;
  }
}

export const apPaymentService = new ApPaymentService();
