import {
  RequestContext,
  NotFoundError,
  ForbiddenError,
  BusinessRuleViolationError,
  ExactDecimal
} from '@general-erp/core';
import { logger } from '../../../config/logger.js';
import { authorizationService } from '../../../platform/authorization/authorization.service.js';
import { auditService } from '../../../platform/audit/audit.service.js';
import { numberingEngine } from '../../../platform/numbering/numbering.service.js';
import { apDocumentService } from './ap-document.service.js';
import { fiscalPeriodService } from '../fiscal-period.service.js';
import { accountingCoreService, AccountingEventInput, AccountingEventLineInput } from '../accounting-core.service.js';
import {
  ApAdjustmentDTO,
  CreateApAdjustmentInput,
  PostApAdjustmentInput,
  ReverseApAdjustmentInput,
  ApAdjustmentFilterInput
} from './ap-adjustment-model.js';
import { ApAdjustmentValidator } from './ap-adjustment-validator.js';
import type pg from 'pg';

export class ApAdjustmentService {
  private adjustmentsStore = new Map<string, ApAdjustmentDTO>();
  private idempotencyStore = new Map<string, ApAdjustmentDTO>();
  private inFlightLocks = new Set<string>();
  private dbPool?: pg.Pool | undefined;

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
    apDocumentService.setDbPool(pool);
    accountingCoreService.setDbPool(pool);
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
      const isWildcard = ctx.user.permissions.some(p => p === '*' || p === action || p.startsWith('ap:adjustment:'));
      if (!isWildcard) {
        authorizationService.authorize({ user: ctx.user, action, companyId });
      }
    }
  }

  /**
   * Acquire in-memory locks for entities in deterministic order
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
   * Create a Draft AP Adjustment
   */
  public async createDraftAdjustment(ctx: RequestContext, input: CreateApAdjustmentInput): Promise<ApAdjustmentDTO> {
    ApAdjustmentValidator.validateCreateInput(ctx, input);

    // Idempotency check
    if (input.idempotencyKey && input.idempotencyKey.trim() !== '') {
      const idempKey = `${ctx.tenantId}:${input.idempotencyKey}`;
      const existing = this.idempotencyStore.get(idempKey);
      if (existing) {
        logger.info({ tenantId: ctx.tenantId, idempotencyKey: input.idempotencyKey }, '[AP] Returning idempotent draft adjustment result');
        return existing;
      }
    }

    // Target Open Item lookup
    const openItem = await apDocumentService.getOpenItem(ctx, input.openItemId);
    const companyId = input.companyId || openItem.companyId;

    this.authorize(ctx, 'ap:adjustment:create', companyId);

    // Isolation & Domain checks
    if (openItem.tenantId !== ctx.tenantId) {
      throw new ForbiddenError(`Target open item '${input.openItemId}' belongs to tenant '${openItem.tenantId}', not request tenant '${ctx.tenantId}'.`);
    }

    if (openItem.companyId !== companyId) {
      throw new ForbiddenError(`Target open item company '${openItem.companyId}' does not match context company '${companyId}'.`);
    }

    if (openItem.supplierId !== input.supplierId) {
      throw new BusinessRuleViolationError(
        `Adjustment supplierId '${input.supplierId}' does not match target open item supplierId '${openItem.supplierId}'. Cross-supplier adjustment is strictly forbidden.`
      );
    }

    if (openItem.documentType === 'CREDIT_NOTE') {
      throw new BusinessRuleViolationError(`Cannot adjust open item '${openItem.id}'. Target open item is a CREDIT_NOTE. Adjustments only target debit open items.`);
    }

    if (openItem.status === 'CANCELLED') {
      throw new BusinessRuleViolationError(`Cannot adjust open item '${openItem.id}'. Current status is CANCELLED.`);
    }

    const amountDec = ExactDecimal.parse(input.amount, 2);
    const outstandingDec = ExactDecimal.parse(openItem.outstandingAmount, 2);

    // Exposure reduction checks for WRITE_OFF and CREDIT_ADJUSTMENT
    if (input.adjustmentType === 'WRITE_OFF' || input.adjustmentType === 'CREDIT_ADJUSTMENT') {
      if (amountDec.compare(outstandingDec) > 0) {
        throw new BusinessRuleViolationError(
          `Adjustment amount '${amountDec.toString()}' exceeds available open item outstanding amount '${outstandingDec.toString()}' for item '${openItem.id}'.`
        );
      }
    }

    const adjustmentId = `apadj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();
    const adjDateStr = input.adjustmentDate || now.toISOString().split('T')[0]!;
    const acctDateStr = input.accountingDate || adjDateStr;

    const adjustmentDTO: ApAdjustmentDTO = {
      id: adjustmentId,
      tenantId: ctx.tenantId,
      companyId,
      supplierId: input.supplierId,
      openItemId: input.openItemId,
      adjustmentType: input.adjustmentType,
      amount: amountDec.toString(),
      adjustmentDate: adjDateStr,
      accountingDate: acctDateStr,
      reason: input.reason,
      status: 'DRAFT',
      journalEntryId: null,
      version: 1,
      createdAt: now,
      updatedAt: now
    };

    const key = this.getKey(ctx.tenantId, adjustmentId);
    this.adjustmentsStore.set(key, adjustmentDTO);

    if (input.idempotencyKey && input.idempotencyKey.trim() !== '') {
      this.idempotencyStore.set(`${ctx.tenantId}:${input.idempotencyKey}`, adjustmentDTO);
    }

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ApAdjustment',
      entityId: adjustmentId,
      action: 'CREATE',
      newValues: {
        supplierId: adjustmentDTO.supplierId,
        openItemId: adjustmentDTO.openItemId,
        adjustmentType: adjustmentDTO.adjustmentType,
        amount: adjustmentDTO.amount,
        status: adjustmentDTO.status
      }
    });

    logger.info({ tenantId: ctx.tenantId, companyId, adjustmentId }, '[AP] Created draft AP adjustment');
    return adjustmentDTO;
  }

  /**
   * Post an AP Adjustment (DRAFT -> POSTED)
   */
  public async postAdjustment(ctx: RequestContext, id: string, postInput?: PostApAdjustmentInput & { simulateFailure?: boolean }): Promise<ApAdjustmentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.adjustmentsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ApAdjustment', id);
    }

    this.authorize(ctx, 'ap:adjustment:post', existing.companyId);

    // Idempotent re-post handling
    if (existing.status === 'POSTED') {
      logger.info({ tenantId: ctx.tenantId, adjustmentId: id }, '[AP] Adjustment is already POSTED — returning idempotent result');
      return existing;
    }

    if (existing.status === 'REVERSED' || existing.status === 'CANCELLED') {
      throw new BusinessRuleViolationError(`Cannot post AP adjustment '${id}'. Status is '${existing.status}'.`);
    }

    // Post-lock idempotency check
    if (postInput?.idempotencyKey && postInput.idempotencyKey.trim() !== '') {
      const idempKey = `${ctx.tenantId}:${postInput.idempotencyKey}`;
      const existingIdemp = this.idempotencyStore.get(idempKey);
      if (existingIdemp && existingIdemp.status === 'POSTED') {
        return existingIdemp;
      }
    }

    // Acquire lock on target open item
    const releaseLocks = await this.acquireLocks(ctx.tenantId, [existing.openItemId]);

    try {
      // Re-check post-lock idempotency
      if (postInput?.idempotencyKey && postInput.idempotencyKey.trim() !== '') {
        const idempKey = `${ctx.tenantId}:${postInput.idempotencyKey}`;
        const existingIdemp = this.idempotencyStore.get(idempKey);
        if (existingIdemp && existingIdemp.status === 'POSTED') {
          return existingIdemp;
        }
      }

      const openItem = await apDocumentService.getOpenItem(ctx, existing.openItemId);

      // Context Isolation Checks
      if (openItem.tenantId !== ctx.tenantId) {
        throw new ForbiddenError(`Target open item tenant '${openItem.tenantId}' does not match request tenant '${ctx.tenantId}'.`);
      }
      if (openItem.companyId !== existing.companyId) {
        throw new ForbiddenError(`Target open item company '${openItem.companyId}' does not match adjustment company '${existing.companyId}'.`);
      }
      if (openItem.supplierId !== existing.supplierId) {
        throw new BusinessRuleViolationError(`Target open item supplier '${openItem.supplierId}' does not match adjustment supplier '${existing.supplierId}'.`);
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
        // DEBIT_ADJUSTMENT increases AP liability exposure
        newOutDec = currentOutDec.add(amountDec);
      }

      const newOutStr = newOutDec.toString();

      let newOpenItemStatus: 'OPEN' | 'PARTIALLY_SETTLED' | 'SETTLED' = 'PARTIALLY_SETTLED';
      if (newOutDec.equals(origDec)) {
        newOpenItemStatus = 'OPEN';
      } else if (newOutDec.isZero()) {
        newOpenItemStatus = 'SETTLED';
      }

      // Fiscal Period Validation
      const acctDateObj = new Date(existing.accountingDate);
      const { fiscalYear, fiscalPeriod } = await fiscalPeriodService.resolvePeriod(ctx, existing.companyId, acctDateObj);
      await fiscalPeriodService.assertPeriodOpen(ctx, fiscalPeriod.id);

      // Business Adjustment Numbering
      const adjustmentNumber = numberingEngine.generateNextNumber(
        ctx.tenantId,
        existing.companyId,
        'AP_ADJUSTMENT',
        fiscalYear.name,
        'HQ'
      );

      // Accounting Event Construction & Processing
      let lines: AccountingEventLineInput[];
      if (existing.adjustmentType === 'WRITE_OFF') {
        lines = [
          {
            lineSequence: 1,
            lineRole: 'AP_CONTROL',
            debitAmount: existing.amount,
            creditAmount: '0.00',
            narration: `AP Control Debit (Write-Off) - ${existing.reason}`
          },
          {
            lineSequence: 2,
            lineRole: 'WRITE_OFF_OFFSET',
            debitAmount: '0.00',
            creditAmount: existing.amount,
            narration: `Write-Off Offset - ${existing.reason}`
          }
        ];
      } else if (existing.adjustmentType === 'CREDIT_ADJUSTMENT') {
        lines = [
          {
            lineSequence: 1,
            lineRole: 'AP_CONTROL',
            debitAmount: existing.amount,
            creditAmount: '0.00',
            narration: `AP Control Debit (Credit Adjustment) - ${existing.reason}`
          },
          {
            lineSequence: 2,
            lineRole: 'CREDIT_ADJUSTMENT_OFFSET',
            debitAmount: '0.00',
            creditAmount: existing.amount,
            narration: `AP Credit Adjustment Offset - ${existing.reason}`
          }
        ];
      } else {
        // DEBIT_ADJUSTMENT
        lines = [
          {
            lineSequence: 1,
            lineRole: 'DEBIT_ADJUSTMENT_OFFSET',
            debitAmount: existing.amount,
            creditAmount: '0.00',
            narration: `AP Debit Adjustment Offset - ${existing.reason}`
          },
          {
            lineSequence: 2,
            lineRole: 'AP_CONTROL',
            debitAmount: '0.00',
            creditAmount: existing.amount,
            narration: `AP Control Credit (Debit Adjustment) - ${existing.reason}`
          }
        ];
      }

      const acctEventInput: AccountingEventInput = {
        companyId: existing.companyId,
        eventType: 'AP_ADJUSTMENT',
        accountingDate: existing.accountingDate,
        sourceModule: 'AP',
        sourceDocumentType: 'ADJUSTMENT',
        sourceDocumentId: existing.id,
        narration: `AP Adjustment [${existing.adjustmentType}] - ${existing.reason}`,
        idempotencyKey: postInput?.idempotencyKey,
        lines
      };

      // Atomic DB Transaction path if PostgreSQL dbPool is configured
      let postedJournalId: string | null = null;

      if (this.dbPool) {
        const client = await this.dbPool.connect();
        try {
          await client.query('BEGIN');
          await client.query("SET LOCAL app.ap_adjustment_authorized = 'true'");
          await client.query("SET LOCAL app.posting_authorized = 'true'");

          // Lock open item row in PostgreSQL FOR UPDATE
          const res = await client.query(
            `SELECT id, outstanding_amount, status FROM ap_open_items WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
            [existing.openItemId, ctx.tenantId]
          );

          if (res.rows.length > 0) {
            const dbOutDec = ExactDecimal.parse(res.rows[0].outstanding_amount, 2);
            if (existing.adjustmentType === 'WRITE_OFF' || existing.adjustmentType === 'CREDIT_ADJUSTMENT') {
              if (amountDec.compare(dbOutDec) > 0) {
                throw new BusinessRuleViolationError(
                  `Adjustment amount '${amountDec.toString()}' exceeds available open item outstanding amount '${dbOutDec.toString()}' in database.`
                );
              }
            }
          }

          // Update open item in DB
          await client.query(
            `UPDATE ap_open_items SET outstanding_amount = $1, status = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4`,
            [newOutStr, newOpenItemStatus, existing.openItemId, ctx.tenantId]
          );

          // Process GL accounting event
          const journal = await accountingCoreService.processAccountingEvent(ctx, acctEventInput);
          postedJournalId = journal.id ?? null;

          // Insert AP adjustment row in DB
          await client.query(
            `INSERT INTO ap_adjustments (
              id, tenant_id, company_id, adjustment_number, supplier_id, open_item_id,
              adjustment_type, amount, adjustment_date, accounting_date, reason, status,
              journal_entry_id, version, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'POSTED', $12, 1, NOW(), NOW())`,
            [
              existing.id,
              ctx.tenantId,
              existing.companyId,
              adjustmentNumber,
              existing.supplierId,
              existing.openItemId,
              existing.adjustmentType,
              existing.amount,
              existing.adjustmentDate,
              existing.accountingDate,
              existing.reason,
              postedJournalId
            ]
          );

          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          logger.error({ err, adjustmentId: id }, '[AP] Error posting DB AP adjustment');
          throw err;
        } finally {
          client.release();
        }
      } else {
        // In-memory fallback execution
        const journal = await accountingCoreService.processAccountingEvent(ctx, acctEventInput);
        postedJournalId = journal.id ?? null;
      }

      // Update Open Item balance & status in memory
      await apDocumentService.updateOpenItemBalance(ctx, existing.openItemId, newOutStr, newOpenItemStatus);

      // Update Adjustment DTO
      const now = new Date();
      const postedDTO: ApAdjustmentDTO = {
        ...existing,
        adjustmentNumber,
        status: 'POSTED',
        journalEntryId: postedJournalId,
        version: existing.version + 1,
        updatedAt: now
      };

      this.adjustmentsStore.set(key, postedDTO);

      if (postInput?.idempotencyKey && postInput.idempotencyKey.trim() !== '') {
        this.idempotencyStore.set(`${ctx.tenantId}:${postInput.idempotencyKey}`, postedDTO);
      }

      await auditService.logEvent(ctx, {
        module: 'finance',
        entityName: 'ApAdjustment',
        entityId: id,
        action: 'POST',
        newValues: {
          adjustmentNumber,
          status: postedDTO.status,
          journalEntryId: postedDTO.journalEntryId,
          newOpenItemOutstanding: newOutStr
        }
      });

      logger.info({ tenantId: ctx.tenantId, companyId: existing.companyId, adjustmentId: id }, '[AP] Successfully posted AP adjustment');
      return postedDTO;
    } finally {
      releaseLocks();
    }
  }

  /**
   * Reverse a posted AP Adjustment
   */
  public async reverseAdjustment(ctx: RequestContext, id: string, reverseInput: ReverseApAdjustmentInput): Promise<ApAdjustmentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.adjustmentsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ApAdjustment', id);
    }

    this.authorize(ctx, 'ap:adjustment:reverse', existing.companyId);

    if (existing.status === 'REVERSED') {
      logger.info({ tenantId: ctx.tenantId, adjustmentId: id }, '[AP] Adjustment is already REVERSED — returning idempotent result');
      return existing;
    }

    if (existing.status !== 'POSTED') {
      throw new BusinessRuleViolationError(`Cannot reverse AP adjustment '${id}'. Only POSTED adjustments may be reversed. Current status is '${existing.status}'.`);
    }

    if (!reverseInput.reason || reverseInput.reason.trim() === '') {
      throw new BusinessRuleViolationError('Reversal reason is required when reversing an AP adjustment.');
    }

    // Post-lock idempotency check
    if (reverseInput.idempotencyKey && reverseInput.idempotencyKey.trim() !== '') {
      const idempKey = `${ctx.tenantId}:${reverseInput.idempotencyKey}`;
      const existingIdemp = this.idempotencyStore.get(idempKey);
      if (existingIdemp && existingIdemp.status === 'REVERSED') {
        return existingIdemp;
      }
    }

    // Acquire lock on target open item
    const releaseLocks = await this.acquireLocks(ctx.tenantId, [existing.openItemId]);

    try {
      // Re-check post-lock idempotency
      if (reverseInput.idempotencyKey && reverseInput.idempotencyKey.trim() !== '') {
        const idempKey = `${ctx.tenantId}:${reverseInput.idempotencyKey}`;
        const existingIdemp = this.idempotencyStore.get(idempKey);
        if (existingIdemp && existingIdemp.status === 'REVERSED') {
          return existingIdemp;
        }
      }

      const openItem = await apDocumentService.getOpenItem(ctx, existing.openItemId);

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

      // Fiscal Period Validation for reversal
      const now = new Date();
      const revAcctDateStr = reverseInput.reversalAccountingDate || now.toISOString().split('T')[0]!;
      const revAcctDateObj = new Date(revAcctDateStr);
      const { fiscalPeriod } = await fiscalPeriodService.resolvePeriod(ctx, existing.companyId, revAcctDateObj);
      await fiscalPeriodService.assertPeriodOpen(ctx, fiscalPeriod.id);

      // Reversal Accounting Event Construction (Swapped lines)
      let lines: AccountingEventLineInput[];
      if (existing.adjustmentType === 'WRITE_OFF') {
        lines = [
          {
            lineSequence: 1,
            lineRole: 'WRITE_OFF_OFFSET',
            debitAmount: existing.amount,
            creditAmount: '0.00',
            narration: `Write-Off Offset Reversal - ${reverseInput.reason}`
          },
          {
            lineSequence: 2,
            lineRole: 'AP_CONTROL',
            debitAmount: '0.00',
            creditAmount: existing.amount,
            narration: `AP Control Credit Reversal (Write-Off) - ${reverseInput.reason}`
          }
        ];
      } else if (existing.adjustmentType === 'CREDIT_ADJUSTMENT') {
        lines = [
          {
            lineSequence: 1,
            lineRole: 'CREDIT_ADJUSTMENT_OFFSET',
            debitAmount: existing.amount,
            creditAmount: '0.00',
            narration: `AP Credit Adjustment Offset Reversal - ${reverseInput.reason}`
          },
          {
            lineSequence: 2,
            lineRole: 'AP_CONTROL',
            debitAmount: '0.00',
            creditAmount: existing.amount,
            narration: `AP Control Credit Reversal - ${reverseInput.reason}`
          }
        ];
      } else {
        // DEBIT_ADJUSTMENT REVERSED
        lines = [
          {
            lineSequence: 1,
            lineRole: 'AP_CONTROL',
            debitAmount: existing.amount,
            creditAmount: '0.00',
            narration: `AP Control Debit Reversal (Debit Adjustment) - ${reverseInput.reason}`
          },
          {
            lineSequence: 2,
            lineRole: 'DEBIT_ADJUSTMENT_OFFSET',
            debitAmount: '0.00',
            creditAmount: existing.amount,
            narration: `AP Debit Adjustment Offset Reversal - ${reverseInput.reason}`
          }
        ];
      }

      const acctEventInput: AccountingEventInput = {
        companyId: existing.companyId,
        eventType: 'AP_ADJUSTMENT_REVERSAL',
        accountingDate: revAcctDateStr,
        sourceModule: 'AP',
        sourceDocumentType: 'ADJUSTMENT_REVERSAL',
        sourceDocumentId: existing.id,
        narration: `Reversal of AP Adjustment [${existing.adjustmentType}] - ${reverseInput.reason}`,
        idempotencyKey: reverseInput?.idempotencyKey,
        lines
      };

      // Atomic DB Transaction path if PostgreSQL dbPool is configured
      if (this.dbPool) {
        const client = await this.dbPool.connect();
        try {
          await client.query('BEGIN');
          await client.query("SET LOCAL app.ap_adjustment_authorized = 'true'");
          await client.query("SET LOCAL app.posting_authorized = 'true'");

          // Lock rows FOR UPDATE
          await client.query(
            `SELECT id, outstanding_amount, status FROM ap_open_items WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
            [existing.openItemId, ctx.tenantId]
          );

          await client.query(
            `SELECT id, status FROM ap_adjustments WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
            [existing.id, ctx.tenantId]
          );

          // Update open item in DB
          await client.query(
            `UPDATE ap_open_items SET outstanding_amount = $1, status = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4`,
            [newOutStr, newOpenItemStatus, existing.openItemId, ctx.tenantId]
          );

          // Process GL accounting reversal
          await accountingCoreService.processAccountingEvent(ctx, acctEventInput);

          // Update adjustment status in DB
          await client.query(
            `UPDATE ap_adjustments SET status = 'REVERSED', reversal_accounting_date = $1, reversed_at = NOW(), reversed_by = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4`,
            [revAcctDateStr, ctx.user?.roles[0] || 'system', existing.id, ctx.tenantId]
          );

          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          logger.error({ err, adjustmentId: id }, '[AP] Error reversing DB AP adjustment');
          throw err;
        } finally {
          client.release();
        }
      } else {
        // In-memory fallback
        await accountingCoreService.processAccountingEvent(ctx, acctEventInput);
      }

      // Update Open Item balance & status in memory
      await apDocumentService.updateOpenItemBalance(ctx, existing.openItemId, newOutStr, newOpenItemStatus);

      // Update Adjustment DTO
      const reversedDTO: ApAdjustmentDTO = {
        ...existing,
        status: 'REVERSED',
        reversalAccountingDate: revAcctDateStr,
        reversedAt: now,
        reversedBy: ctx.user?.roles[0] || 'system',
        version: existing.version + 1,
        updatedAt: now
      };

      this.adjustmentsStore.set(key, reversedDTO);

      if (reverseInput.idempotencyKey && reverseInput.idempotencyKey.trim() !== '') {
        this.idempotencyStore.set(`${ctx.tenantId}:${reverseInput.idempotencyKey}`, reversedDTO);
      }

      await auditService.logEvent(ctx, {
        module: 'finance',
        entityName: 'ApAdjustment',
        entityId: id,
        action: 'REVERSE',
        newValues: {
          status: reversedDTO.status,
          reversalAccountingDate: revAcctDateStr,
          reversedAt: reversedDTO.reversedAt,
          newOpenItemOutstanding: newOutStr
        }
      });

      logger.info({ tenantId: ctx.tenantId, companyId: existing.companyId, adjustmentId: id }, '[AP] Successfully reversed AP adjustment');
      return reversedDTO;
    } finally {
      releaseLocks();
    }
  }

  /**
   * Cancel a Draft AP Adjustment
   */
  public async cancelAdjustment(ctx: RequestContext, id: string): Promise<ApAdjustmentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.adjustmentsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ApAdjustment', id);
    }

    this.authorize(ctx, 'ap:adjustment:cancel', existing.companyId);

    if (existing.status !== 'DRAFT') {
      throw new BusinessRuleViolationError(`Cannot cancel AP adjustment '${id}'. Only DRAFT adjustments may be cancelled. Current status is '${existing.status}'.`);
    }

    const now = new Date();
    const cancelledDTO: ApAdjustmentDTO = {
      ...existing,
      status: 'CANCELLED',
      version: existing.version + 1,
      updatedAt: now
    };

    this.adjustmentsStore.set(key, cancelledDTO);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ApAdjustment',
      entityId: id,
      action: 'CANCEL',
      newValues: { status: cancelledDTO.status }
    });

    logger.info({ tenantId: ctx.tenantId, companyId: existing.companyId, adjustmentId: id }, '[AP] Cancelled draft AP adjustment');
    return cancelledDTO;
  }

  /**
   * Get an AP adjustment by ID
   */
  public async getAdjustment(ctx: RequestContext, id: string): Promise<ApAdjustmentDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const adj = this.adjustmentsStore.get(key);
    if (!adj) {
      throw new NotFoundError('ApAdjustment', id);
    }
    this.authorize(ctx, 'ap:adjustment:read', adj.companyId);
    return adj;
  }

  /**
   * List AP adjustments for a company
   */
  public async listAdjustments(
    ctx: RequestContext,
    companyId: string,
    filters?: ApAdjustmentFilterInput
  ): Promise<ApAdjustmentDTO[]> {
    this.authorize(ctx, 'ap:adjustment:read', companyId);
    const result: ApAdjustmentDTO[] = [];
    for (const adj of this.adjustmentsStore.values()) {
      if (adj.tenantId === ctx.tenantId && adj.companyId === companyId) {
        if (filters?.supplierId && adj.supplierId !== filters.supplierId) continue;
        if (filters?.openItemId && adj.openItemId !== filters.openItemId) continue;
        if (filters?.adjustmentType && adj.adjustmentType !== filters.adjustmentType) continue;
        if (filters?.status && adj.status !== filters.status) continue;
        result.push(adj);
      }
    }
    return result;
  }
}

export const apAdjustmentService = new ApAdjustmentService();
