import {
  RequestContext,
  NotFoundError,
  ForbiddenError,
  BusinessRuleViolationError,
  AccountingError,
  ExactDecimal
} from '@general-erp/core';
import { logger } from '../../../config/logger.js';
import { authorizationService } from '../../../platform/authorization/authorization.service.js';
import { auditService } from '../../../platform/audit/audit.service.js';
import { arDocumentService } from './ar-document.service.js';
import { fiscalPeriodService } from '../fiscal-period.service.js';
import { accountingCoreService, AccountingEventInput, AccountingEventLineInput } from '../accounting-core.service.js';
import {
  ArAdjustmentDTO,
  CreateArAdjustmentInput,
  PostArAdjustmentInput,
  ReverseArAdjustmentInput,
  ArAdjustmentFilterInput
} from './ar-adjustment-model.js';
import { ArAdjustmentValidator } from './ar-adjustment-validator.js';
import type pg from 'pg';

export class ArAdjustmentService {
  private adjustmentsStore = new Map<string, ArAdjustmentDTO>();
  private idempotencyStore = new Map<string, ArAdjustmentDTO>();
  private inFlightLocks = new Set<string>();
  private dbPool?: pg.Pool | undefined;

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
    arDocumentService.setDbPool(pool);
  }

  public getDbPool(): pg.Pool | undefined {
    return this.dbPool;
  }

  public clear(): void {
    this.adjustmentsStore.clear();
    this.idempotencyStore.clear();
    this.inFlightLocks.clear();
  }

  private getKey(tenantId: string, id: string): string {
    return `${tenantId}:${id}`;
  }

  private authorize(ctx: RequestContext, action: string, companyId: string): void {
    if (ctx.user) {
      const isWildcard = ctx.user.permissions.some(p => p === '*' || p === action || p.startsWith('ar:adjustment:'));
      if (!isWildcard) {
        authorizationService.authorize({ user: ctx.user, action, companyId });
      }
    }
  }

  /**
   * Acquire in-memory locks for entities in deterministic order to prevent race conditions & deadlocks
   */
  private async acquireLocks(tenantId: string, entityIds: string[]): Promise<() => void> {
    const sortedIds = [...new Set(entityIds)].sort();
    const lockKeys = sortedIds.map(id => `${tenantId}:${id}`);

    while (lockKeys.some(k => this.inFlightLocks.has(k))) {
      await new Promise(res => setTimeout(res, 10));
    }

    for (const k of lockKeys) {
      this.inFlightLocks.add(k);
    }

    return () => {
      for (const k of lockKeys) {
        this.inFlightLocks.delete(k);
      }
    };
  }

  /**
   * Create a Draft AR Adjustment
   */
  public async createDraftAdjustment(ctx: RequestContext, input: CreateArAdjustmentInput): Promise<ArAdjustmentDTO> {
    ArAdjustmentValidator.validateCreateInput(ctx, input);

    // Idempotency check
    if (input.idempotencyKey && input.idempotencyKey.trim() !== '') {
      const idempKey = `${ctx.tenantId}:${input.idempotencyKey}`;
      const existing = this.idempotencyStore.get(idempKey);
      if (existing) {
        logger.info({ tenantId: ctx.tenantId, idempotencyKey: input.idempotencyKey }, '[AR] Returning idempotent draft adjustment result');
        return existing;
      }
    }

    // Target Open Item lookup
    const openItem = await arDocumentService.getOpenItem(ctx, input.openItemId);

    const companyId = input.companyId || openItem.companyId;
    this.authorize(ctx, 'ar:adjustment:create', companyId);

    // Tenant, Company, and Customer isolation checks
    if (openItem.tenantId !== ctx.tenantId) {
      throw new ForbiddenError(`Target open item '${input.openItemId}' belongs to tenant '${openItem.tenantId}', not request tenant '${ctx.tenantId}'.`);
    }

    if (openItem.companyId !== companyId) {
      throw new ForbiddenError(`Target open item company '${openItem.companyId}' does not match context company '${companyId}'.`);
    }

    if (openItem.customerId !== input.customerId) {
      throw new BusinessRuleViolationError(
        `Adjustment customerId '${input.customerId}' does not match open item customerId '${openItem.customerId}'.`
      );
    }

    // Status check
    if (openItem.status === 'CANCELLED') {
      throw new BusinessRuleViolationError(`Cannot adjust open item '${openItem.id}'. Current status is CANCELLED.`);
    }

    const amountDec = ExactDecimal.parse(input.amount, 2);
    const outstandingDec = ExactDecimal.parse(openItem.outstandingAmount, 2);

    // Reduction validation for WRITE_OFF and CREDIT_ADJUSTMENT
    if (input.adjustmentType === 'WRITE_OFF' || input.adjustmentType === 'CREDIT_ADJUSTMENT') {
      if (amountDec.compare(outstandingDec) > 0) {
        throw new BusinessRuleViolationError(
          `Adjustment amount '${amountDec.toString()}' exceeds available open item outstanding amount '${outstandingDec.toString()}' for item '${openItem.id}'.`
        );
      }
    }

    const adjustmentId = crypto.randomUUID();
    const now = new Date();
    const adjustmentDTO: ArAdjustmentDTO = {
      id: adjustmentId,
      tenantId: ctx.tenantId,
      companyId,
      customerId: input.customerId,
      openItemId: input.openItemId,
      adjustmentType: input.adjustmentType,
      amount: amountDec.toString(),
      reason: input.reason,
      status: 'DRAFT',
      journalEntryId: null,
      createdAt: now
    };

    const key = this.getKey(ctx.tenantId, adjustmentId);
    this.adjustmentsStore.set(key, adjustmentDTO);

    if (input.idempotencyKey && input.idempotencyKey.trim() !== '') {
      this.idempotencyStore.set(`${ctx.tenantId}:${input.idempotencyKey}`, adjustmentDTO);
    }

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ArAdjustment',
      entityId: adjustmentId,
      action: 'CREATE',
      newValues: {
        customerId: adjustmentDTO.customerId,
        openItemId: adjustmentDTO.openItemId,
        adjustmentType: adjustmentDTO.adjustmentType,
        amount: adjustmentDTO.amount,
        status: adjustmentDTO.status
      }
    });

    logger.info({ tenantId: ctx.tenantId, companyId, adjustmentId }, '[AR] Created draft AR adjustment');
    return adjustmentDTO;
  }

  /**
   * Post an AR Adjustment (DRAFT -> POSTED)
   */
  public async postAdjustment(ctx: RequestContext, id: string, postInput?: PostArAdjustmentInput & { simulateFailure?: boolean }): Promise<ArAdjustmentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.adjustmentsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ArAdjustment', id);
    }

    this.authorize(ctx, 'ar:adjustment:post', existing.companyId);

    // Idempotent re-post handling
    if (existing.status === 'POSTED' || existing.status === 'ACTIVE') {
      logger.info({ tenantId: ctx.tenantId, adjustmentId: id }, '[AR] Adjustment is already POSTED — returning idempotent result');
      return existing;
    }

    if (existing.status === 'REVERSED') {
      throw new BusinessRuleViolationError(`Cannot post AR adjustment '${id}'. Adjustment status is REVERSED.`);
    }

    // Acquire lock on target open item
    const releaseLocks = await this.acquireLocks(ctx.tenantId, [existing.openItemId]);

    try {
      const openItem = await arDocumentService.getOpenItem(ctx, existing.openItemId);

      // Isolation checks
      if (openItem.tenantId !== ctx.tenantId) {
        throw new ForbiddenError(`Target open item tenant '${openItem.tenantId}' does not match request tenant '${ctx.tenantId}'.`);
      }
      if (openItem.companyId !== existing.companyId) {
        throw new ForbiddenError(`Target open item company '${openItem.companyId}' does not match adjustment company '${existing.companyId}'.`);
      }
      if (openItem.customerId !== existing.customerId) {
        throw new BusinessRuleViolationError(`Target open item customer '${openItem.customerId}' does not match adjustment customer '${existing.customerId}'.`);
      }

      const amountDec = ExactDecimal.parse(existing.amount, 2);
      const origDec = ExactDecimal.parse(openItem.originalAmount, 2);
      const currentOutDec = ExactDecimal.parse(openItem.outstandingAmount, 2);

      let newOutDec: ExactDecimal;
      if (existing.adjustmentType === 'WRITE_OFF' || existing.adjustmentType === 'CREDIT_ADJUSTMENT') {
        if (amountDec.compare(currentOutDec) > 0) {
          throw new BusinessRuleViolationError(
            `Adjustment amount '${amountDec.toString()}' exceeds available open item outstanding amount '${currentOutDec.toString()}' for item '${openItem.id}'.`
          );
        }
        newOutDec = currentOutDec.sub(amountDec);
      } else {
        // DEBIT_ADJUSTMENT
        newOutDec = currentOutDec.add(amountDec);
      }

      const newOutStr = newOutDec.toString();

      let newOpenItemStatus: 'OPEN' | 'PARTIALLY_SETTLED' | 'SETTLED' = 'PARTIALLY_SETTLED';
      if (newOutDec.equals(origDec)) {
        newOpenItemStatus = 'OPEN';
      } else if (newOutDec.isZero()) {
        newOpenItemStatus = 'SETTLED';
      }

      // Simulated transaction failure check for atomic rollback testing
      if (postInput?.simulateFailure || (ctx as any).metadata?.simulateFailure) {
        logger.error({ adjustmentId: id }, '[AR] Simulated transaction failure injected — triggering ROLLBACK');
        throw new AccountingError(`Simulated transaction failure during AR adjustment posting for adjustment '${id}'.`);
      }

      // Fiscal Period Validation
      const now = new Date();
      const acctDateStr = now.toISOString().split('T')[0]!;
      const { fiscalPeriod } = await fiscalPeriodService.resolvePeriod(ctx, existing.companyId, now);
      await fiscalPeriodService.assertPeriodOpen(ctx, fiscalPeriod.id);

      // Accounting Event Construction & Processing
      let lines: AccountingEventLineInput[];
      if (existing.adjustmentType === 'WRITE_OFF') {
        lines = [
          {
            lineSequence: 1,
            lineRole: 'WRITE_OFF_EXPENSE',
            debitAmount: existing.amount,
            creditAmount: '0.00',
            narration: `Bad Debt / Write-Off Expense - ${existing.reason}`
          },
          {
            lineSequence: 2,
            lineRole: 'AR_CONTROL',
            debitAmount: '0.00',
            creditAmount: existing.amount,
            narration: `AR Control Credit (Write-Off) - ${existing.reason}`
          }
        ];
      } else if (existing.adjustmentType === 'CREDIT_ADJUSTMENT') {
        lines = [
          {
            lineSequence: 1,
            lineRole: 'CREDIT_ADJUSTMENT',
            debitAmount: existing.amount,
            creditAmount: '0.00',
            narration: `AR Credit Adjustment - ${existing.reason}`
          },
          {
            lineSequence: 2,
            lineRole: 'AR_CONTROL',
            debitAmount: '0.00',
            creditAmount: existing.amount,
            narration: `AR Control Credit - ${existing.reason}`
          }
        ];
      } else {
        // DEBIT_ADJUSTMENT
        lines = [
          {
            lineSequence: 1,
            lineRole: 'AR_CONTROL',
            debitAmount: existing.amount,
            creditAmount: '0.00',
            narration: `AR Control Debit (Adjustment) - ${existing.reason}`
          },
          {
            lineSequence: 2,
            lineRole: 'DEBIT_ADJUSTMENT',
            debitAmount: '0.00',
            creditAmount: existing.amount,
            narration: `AR Debit Adjustment Revenue - ${existing.reason}`
          }
        ];
      }

      const acctEventInput: AccountingEventInput = {
        companyId: existing.companyId,
        eventType: 'AR_ADJUSTMENT',
        accountingDate: acctDateStr,
        sourceModule: 'AR',
        sourceDocumentType: 'ADJUSTMENT',
        sourceDocumentId: existing.id,
        narration: `AR Adjustment [${existing.adjustmentType}] - ${existing.reason}`,
        idempotencyKey: postInput?.idempotencyKey,
        simulateFailure: postInput?.simulateFailure,
        lines
      };

      const postedJournal = await accountingCoreService.processAccountingEvent(ctx, acctEventInput);

      // Update Open Item balance & status
      await arDocumentService.updateOpenItemBalance(ctx, existing.openItemId, newOutStr, newOpenItemStatus);

      // Update Adjustment State
      const postedDTO: ArAdjustmentDTO = {
        ...existing,
        status: 'POSTED',
        journalEntryId: postedJournal.id ?? null
      };

      this.adjustmentsStore.set(key, postedDTO);

      await auditService.logEvent(ctx, {
        module: 'finance',
        entityName: 'ArAdjustment',
        entityId: id,
        action: 'POST',
        newValues: {
          status: postedDTO.status,
          journalEntryId: postedDTO.journalEntryId,
          newOpenItemOutstanding: newOutStr
        }
      });

      logger.info({ tenantId: ctx.tenantId, companyId: existing.companyId, adjustmentId: id }, '[AR] Successfully posted AR adjustment');
      return postedDTO;
    } finally {
      releaseLocks();
    }
  }

  /**
   * Reverse a posted AR Adjustment
   */
  public async reverseAdjustment(ctx: RequestContext, id: string, reverseInput: ReverseArAdjustmentInput & { simulateFailure?: boolean }): Promise<ArAdjustmentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.adjustmentsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ArAdjustment', id);
    }

    this.authorize(ctx, 'ar:adjustment:reverse', existing.companyId);

    if (existing.status === 'REVERSED') {
      logger.info({ tenantId: ctx.tenantId, adjustmentId: id }, '[AR] Adjustment is already REVERSED — returning idempotent result');
      return existing;
    }

    if (existing.status !== 'POSTED' && existing.status !== 'ACTIVE') {
      throw new BusinessRuleViolationError(`Cannot reverse AR adjustment '${id}'. Only POSTED adjustments may be reversed. Current status is '${existing.status}'.`);
    }

    if (!reverseInput.reason || reverseInput.reason.trim() === '') {
      throw new BusinessRuleViolationError('Reversal reason is required when reversing an AR adjustment.');
    }

    // Acquire lock on target open item
    const releaseLocks = await this.acquireLocks(ctx.tenantId, [existing.openItemId]);

    try {
      const openItem = await arDocumentService.getOpenItem(ctx, existing.openItemId);

      const amountDec = ExactDecimal.parse(existing.amount, 2);
      const origDec = ExactDecimal.parse(openItem.originalAmount, 2);
      const currentOutDec = ExactDecimal.parse(openItem.outstandingAmount, 2);

      let newOutDec: ExactDecimal;
      if (existing.adjustmentType === 'WRITE_OFF' || existing.adjustmentType === 'CREDIT_ADJUSTMENT') {
        // Reversing a reduction increases outstanding
        newOutDec = currentOutDec.add(amountDec);
      } else {
        // Reversing a debit adjustment decreases outstanding
        if (amountDec.compare(currentOutDec) > 0) {
          throw new BusinessRuleViolationError(
            `Reversing debit adjustment amount '${amountDec.toString()}' would cause negative outstanding amount on open item '${openItem.id}'. Current outstanding: '${currentOutDec.toString()}'.`
          );
        }
        newOutDec = currentOutDec.sub(amountDec);
      }

      const newOutStr = newOutDec.toString();

      let newOpenItemStatus: 'OPEN' | 'PARTIALLY_SETTLED' | 'SETTLED' = 'PARTIALLY_SETTLED';
      if (newOutDec.equals(origDec)) {
        newOpenItemStatus = 'OPEN';
      } else if (newOutDec.isZero()) {
        newOpenItemStatus = 'SETTLED';
      }

      // Simulated transaction failure check for atomic rollback testing
      if (reverseInput?.simulateFailure || (ctx as any).metadata?.simulateFailure) {
        logger.error({ adjustmentId: id }, '[AR] Simulated transaction failure injected during reversal — triggering ROLLBACK');
        throw new AccountingError(`Simulated transaction failure during AR adjustment reversal for adjustment '${id}'.`);
      }

      // Fiscal Period Validation
      const now = new Date();
      const acctDateStr = reverseInput.reversalDate || now.toISOString().split('T')[0]!;
      const acctDate = reverseInput.reversalDate ? new Date(reverseInput.reversalDate) : now;
      const { fiscalPeriod } = await fiscalPeriodService.resolvePeriod(ctx, existing.companyId, acctDate);
      await fiscalPeriodService.assertPeriodOpen(ctx, fiscalPeriod.id);

      // Reversal Accounting Event Construction (Swapped lines)
      let lines: AccountingEventLineInput[];
      if (existing.adjustmentType === 'WRITE_OFF') {
        lines = [
          {
            lineSequence: 1,
            lineRole: 'AR_CONTROL',
            debitAmount: existing.amount,
            creditAmount: '0.00',
            narration: `AR Control Reversal (Write-Off) - ${reverseInput.reason}`
          },
          {
            lineSequence: 2,
            lineRole: 'WRITE_OFF_EXPENSE',
            debitAmount: '0.00',
            creditAmount: existing.amount,
            narration: `Write-Off Expense Reversal - ${reverseInput.reason}`
          }
        ];
      } else if (existing.adjustmentType === 'CREDIT_ADJUSTMENT') {
        lines = [
          {
            lineSequence: 1,
            lineRole: 'AR_CONTROL',
            debitAmount: existing.amount,
            creditAmount: '0.00',
            narration: `AR Control Credit Reversal - ${reverseInput.reason}`
          },
          {
            lineSequence: 2,
            lineRole: 'CREDIT_ADJUSTMENT',
            debitAmount: '0.00',
            creditAmount: existing.amount,
            narration: `Credit Adjustment Reversal - ${reverseInput.reason}`
          }
        ];
      } else {
        // DEBIT_ADJUSTMENT REVERSED
        lines = [
          {
            lineSequence: 1,
            lineRole: 'DEBIT_ADJUSTMENT',
            debitAmount: existing.amount,
            creditAmount: '0.00',
            narration: `Debit Adjustment Reversal - ${reverseInput.reason}`
          },
          {
            lineSequence: 2,
            lineRole: 'AR_CONTROL',
            debitAmount: '0.00',
            creditAmount: existing.amount,
            narration: `AR Control Reversal - ${reverseInput.reason}`
          }
        ];
      }

      const acctEventInput: AccountingEventInput = {
        companyId: existing.companyId,
        eventType: 'AR_ADJUSTMENT_REVERSAL',
        accountingDate: acctDateStr,
        sourceModule: 'AR',
        sourceDocumentType: 'ADJUSTMENT_REVERSAL',
        sourceDocumentId: existing.id,
        narration: `Reversal of AR Adjustment [${existing.adjustmentType}] - ${reverseInput.reason}`,
        idempotencyKey: reverseInput?.idempotencyKey,
        lines
      };

      await accountingCoreService.processAccountingEvent(ctx, acctEventInput);

      // Update Open Item balance & status
      await arDocumentService.updateOpenItemBalance(ctx, existing.openItemId, newOutStr, newOpenItemStatus);

      // Update Adjustment State to REVERSED
      const reversedDTO: ArAdjustmentDTO = {
        ...existing,
        status: 'REVERSED',
        reversedAt: now,
        reversedBy: ctx.user?.userId || 'SYSTEM'
      };

      this.adjustmentsStore.set(key, reversedDTO);

      await auditService.logEvent(ctx, {
        module: 'finance',
        entityName: 'ArAdjustment',
        entityId: id,
        action: 'REVERSE',
        newValues: {
          status: reversedDTO.status,
          reversedAt: reversedDTO.reversedAt,
          reversedBy: reversedDTO.reversedBy,
          newOpenItemOutstanding: newOutStr
        }
      });

      logger.info({ tenantId: ctx.tenantId, companyId: existing.companyId, adjustmentId: id }, '[AR] Successfully reversed AR adjustment');
      return reversedDTO;
    } finally {
      releaseLocks();
    }
  }

  /**
   * Get an AR adjustment by ID
   */
  public async getAdjustment(ctx: RequestContext, id: string): Promise<ArAdjustmentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const adj = this.adjustmentsStore.get(key);
    if (!adj) {
      throw new NotFoundError('ArAdjustment', id);
    }
    this.authorize(ctx, 'ar:adjustment:read', adj.companyId);
    return adj;
  }

  /**
   * List AR adjustments for a company
   */
  public async listAdjustments(
    ctx: RequestContext,
    companyId: string,
    filters?: ArAdjustmentFilterInput
  ): Promise<ArAdjustmentDTO[]> {
    this.authorize(ctx, 'ar:adjustment:read', companyId);
    const result: ArAdjustmentDTO[] = [];
    for (const adj of this.adjustmentsStore.values()) {
      if (adj.tenantId === ctx.tenantId && adj.companyId === companyId) {
        if (filters?.customerId && adj.customerId !== filters.customerId) continue;
        if (filters?.openItemId && adj.openItemId !== filters.openItemId) continue;
        if (filters?.adjustmentType && adj.adjustmentType !== filters.adjustmentType) continue;
        if (filters?.status && adj.status !== filters.status) continue;
        result.push(adj);
      }
    }
    return result;
  }
}

export const arAdjustmentService = new ArAdjustmentService();
