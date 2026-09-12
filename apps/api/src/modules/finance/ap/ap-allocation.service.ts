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
import { accountingCoreService, AccountingEventInput, AccountingEventLineInput } from '../accounting-core.service.js';
import { apPaymentService } from './ap-payment.service.js';
import { apDocumentService } from './ap-document.service.js';
import {
  ApAllocationDTO,
  CreateApAllocationInput,
  ReverseApAllocationInput,
  ApAllocationFilterInput
} from './ap-allocation-model.js';
import { ApAllocationValidator } from './ap-allocation-validator.js';
import type pg from 'pg';

export class ApAllocationService {
  private allocationsStore = new Map<string, ApAllocationDTO>();
  private idempotencyStore = new Map<string, ApAllocationDTO>();
  private inFlightLocks = new Set<string>();
  private dbPool?: pg.Pool | undefined;

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
    apPaymentService.setDbPool(pool);
    apDocumentService.setDbPool(pool);
    accountingCoreService.setDbPool(pool);
  }

  public getDbPool(): pg.Pool | undefined {
    return this.dbPool;
  }

  public clear(): void {
    this.allocationsStore.clear();
    this.idempotencyStore.clear();
    this.inFlightLocks.clear();
  }

  private getKey(tenantId: string, id: string): string {
    return `${tenantId}:${id}`;
  }

  private authorize(ctx: RequestContext, action: string, companyId: string): void {
    if (ctx.user) {
      const isWildcard = ctx.user.permissions.some(p => p === '*' || p === action || p.startsWith('ap:allocation:'));
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

    // Wait until all keys are available
    while (lockKeys.some(k => this.inFlightLocks.has(k))) {
      await new Promise(res => setTimeout(res, 10));
    }

    // Acquire all keys
    for (const k of lockKeys) {
      this.inFlightLocks.add(k);
    }

    // Release function
    return () => {
      for (const k of lockKeys) {
        this.inFlightLocks.delete(k);
      }
    };
  }

  /**
   * Create an AP Allocation (Payment -> Credit Item OR Credit Note -> Credit Item)
   */
  public async allocate(ctx: RequestContext, input: CreateApAllocationInput): Promise<ApAllocationDTO> {
    const inputAny = input as any;
    const allocationSourceType = input.allocationSourceType || inputAny.sourceType || 'PAYMENT';
    const openItemId = input.openItemId || inputAny.targetOpenItemId;
    const paymentId = input.paymentId || (allocationSourceType === 'PAYMENT' ? inputAny.sourceId : undefined);
    const creditNoteId = input.creditNoteId || (allocationSourceType === 'CREDIT_NOTE' ? inputAny.sourceId : undefined);

    input = {
      ...input,
      allocationSourceType,
      openItemId,
      ...(paymentId ? { paymentId } : {}),
      ...(creditNoteId ? { creditNoteId } : {})
    };
    ApAllocationValidator.validateCreateInput(ctx, input);

    // 1. Check Idempotency Key
    if (input.idempotencyKey && input.idempotencyKey.trim() !== '') {
      const idempKey = `${ctx.tenantId}:${input.idempotencyKey}`;
      const existing = this.idempotencyStore.get(idempKey);
      if (existing) {
        logger.info({ tenantId: ctx.tenantId, idempotencyKey: input.idempotencyKey }, '[AP] Returning idempotent allocation result');
        return existing;
      }
    }

    const sourceId = input.allocationSourceType === 'PAYMENT' ? input.paymentId! : input.creditNoteId!;
    const targetOpenItemId = input.openItemId;

    // Acquire deterministic locks on source and open item
    const releaseLocks = await this.acquireLocks(ctx.tenantId, [sourceId, targetOpenItemId]);

    try {
      // Re-verify idempotency key after acquiring lock to handle concurrent duplicate requests
      if (input.idempotencyKey && input.idempotencyKey.trim() !== '') {
        const idempKey = `${ctx.tenantId}:${input.idempotencyKey}`;
        const existing = this.idempotencyStore.get(idempKey);
        if (existing) {
          logger.info({ tenantId: ctx.tenantId, idempotencyKey: input.idempotencyKey }, '[AP] Returning idempotent allocation result under lock');
          return existing;
        }
      }

      // 2. Resolve Target Open Item
      const openItem = await apDocumentService.getOpenItem(ctx, openItemId);

      // Company Context Authorization
      this.authorize(ctx, 'ap:allocation:create', openItem.companyId);

      if (openItem.tenantId !== ctx.tenantId) {
        throw new ForbiddenError(`Target open item '${openItemId}' belongs to tenant '${openItem.tenantId}', not request tenant '${ctx.tenantId}'.`);
      }

      if (openItem.status === 'SETTLED' || openItem.status === 'CANCELLED') {
        throw new BusinessRuleViolationError(`Cannot allocate to open item '${openItemId}'. Current status is '${openItem.status}'. Target must be OPEN or PARTIALLY_SETTLED.`);
      }

      // 3. Resolve Allocation Source (Payment or Credit Note)
      let sourceSupplierId = '';
      let sourceUnappliedStr = '0.00';
      let sourceAllocatedStr = '0.00';
      let sourceCompanyId = '';

      if (input.allocationSourceType === 'PAYMENT') {
        const payment = await apPaymentService.getPayment(ctx, input.paymentId!);

        if (payment.companyId !== openItem.companyId) {
          throw new ForbiddenError(`Payment company '${payment.companyId}' does not match open item company '${openItem.companyId}'.`);
        }

        if (payment.status !== 'POSTED') {
          throw new BusinessRuleViolationError(`Cannot allocate payment '${payment.id}'. Status is '${payment.status}'. Payment must be POSTED.`);
        }

        sourceSupplierId = payment.supplierId;
        sourceUnappliedStr = payment.unappliedAmount;
        sourceAllocatedStr = payment.allocatedAmount;
        sourceCompanyId = payment.companyId;
      } else {
        // CREDIT_NOTE
        const creditNote = await apDocumentService.getDocument(ctx, input.creditNoteId!);

        if (creditNote.companyId !== openItem.companyId) {
          throw new ForbiddenError(`Credit note company '${creditNote.companyId}' does not match open item company '${openItem.companyId}'.`);
        }

        if (creditNote.documentType !== 'CREDIT_NOTE') {
          throw new BusinessRuleViolationError(`Document '${creditNote.id}' is a '${creditNote.documentType}', not a CREDIT_NOTE.`);
        }

        if (creditNote.status !== 'POSTED') {
          throw new BusinessRuleViolationError(`Cannot allocate credit note '${creditNote.id}'. Status is '${creditNote.status}'. Credit note must be POSTED.`);
        }

        sourceSupplierId = creditNote.supplierId;
        sourceUnappliedStr = creditNote.unappliedAmount;
        sourceAllocatedStr = creditNote.allocatedAmount;
        sourceCompanyId = creditNote.companyId;
      }

      // 4. Validate Same Supplier Invariant
      if (sourceSupplierId !== openItem.supplierId) {
        throw new BusinessRuleViolationError(
          `Allocation source supplier '${sourceSupplierId}' does not match target open item supplier '${openItem.supplierId}'. Cross-supplier allocation is strictly forbidden.`
        );
      }

      // 5. Parse Exact Decimal Amounts
      const allocAmtDec = ExactDecimal.parse(input.allocatedAmount, 2);
      const discountAmtDec = input.discountAmount && input.discountAmount.trim() !== ''
        ? ExactDecimal.parse(input.discountAmount, 2)
        : ExactDecimal.ZERO;
      const totalDeductionDec = allocAmtDec.add(discountAmtDec);

      const sourceUnappliedDec = ExactDecimal.parse(sourceUnappliedStr, 2);
      const sourceAllocatedDec = ExactDecimal.parse(sourceAllocatedStr, 2);
      const openItemOutstandingDec = ExactDecimal.parse(openItem.outstandingAmount, 2);

      // 6. Over-allocation Checks
      if (allocAmtDec.compare(sourceUnappliedDec) > 0) {
        throw new BusinessRuleViolationError(
          `Allocation amount '${allocAmtDec.toString()}' exceeds available unapplied amount '${sourceUnappliedDec.toString()}' for ${input.allocationSourceType} '${sourceId}'.`
        );
      }

      if (totalDeductionDec.compare(openItemOutstandingDec) > 0) {
        throw new BusinessRuleViolationError(
          `Total allocation deduction '${totalDeductionDec.toString()}' (allocated: ${allocAmtDec.toString()}, discount: ${discountAmtDec.toString()}) exceeds outstanding open item amount '${openItemOutstandingDec.toString()}' for item '${openItemId}'.`
        );
      }

      // 7. Calculate New Balances
      const newSourceUnappliedStr = sourceUnappliedDec.sub(allocAmtDec).toString();
      const newSourceAllocatedStr = sourceAllocatedDec.add(allocAmtDec).toString();

      const newOpenItemOutstandingDec = openItemOutstandingDec.sub(totalDeductionDec);
      const newOpenItemOutstandingStr = newOpenItemOutstandingDec.toString();
      const newOpenItemStatus = newOpenItemOutstandingDec.isZero() ? 'SETTLED' : 'PARTIALLY_SETTLED';

      // 8. Handle Prompt Payment Discount Accounting (if discount > 0)
      let discountJournalEntryId: string | null = null;
      if (discountAmtDec.isPositive()) {
        const discountLines: AccountingEventLineInput[] = [
          {
            lineSequence: 1,
            lineRole: 'AP_CONTROL',
            debitAmount: discountAmtDec.toString(),
            creditAmount: '0.00',
            narration: `Prompt Payment Discount AP Control - ${openItem.documentNumber}`
          },
          {
            lineSequence: 2,
            lineRole: 'PURCHASE_DISCOUNT_INCOME',
            debitAmount: '0.00',
            creditAmount: discountAmtDec.toString(),
            narration: `Purchase Discount Income - ${openItem.documentNumber}`
          }
        ];

        const discountEvent: AccountingEventInput = {
          companyId: sourceCompanyId,
          eventType: 'AP_DISCOUNT',
          accountingDate: openItem.documentDate,
          sourceModule: 'AP',
          sourceDocumentType: 'ALLOCATION',
          sourceDocumentId: openItemId,
          narration: `Purchase Discount Received - ${openItem.documentNumber}`,
          lines: discountLines
        };

        const discountJournal = await accountingCoreService.processAccountingEvent(ctx, discountEvent);
        if (discountJournal && discountJournal.id) {
          discountJournalEntryId = discountJournal.id;
        }
      }

      // 9. Commit Source Balance Updates
      if (input.allocationSourceType === 'PAYMENT') {
        await apPaymentService.updatePaymentBalance(ctx, input.paymentId!, newSourceUnappliedStr, newSourceAllocatedStr);
      } else {
        await apDocumentService.updateCreditNoteBalance(ctx, input.creditNoteId!, newSourceUnappliedStr, newSourceAllocatedStr);
      }

      // 10. Commit Open Item Balance Updates
      await apDocumentService.updateOpenItemBalance(ctx, openItemId, newOpenItemOutstandingStr, newOpenItemStatus);

      // 11. Persist Allocation DTO
      const allocId = `apalloc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const now = new Date();
      const allocDateStr = input.allocationDate || now.toISOString().substring(0, 10);

      const allocationDTO: ApAllocationDTO = {
        id: allocId,
        tenantId: ctx.tenantId,
        companyId: sourceCompanyId,
        allocationSourceType: input.allocationSourceType,
        paymentId: input.paymentId || null,
        creditNoteId: input.creditNoteId || null,
        openItemId,
        allocatedAmount: allocAmtDec.toString(),
        discountAmount: discountAmtDec.toString(),
        discountJournalEntryId,
        allocationDate: allocDateStr,
        status: 'ACTIVE',
        reversedAt: null,
        reversedBy: null,
        createdAt: now
      };

      const key = this.getKey(ctx.tenantId, allocId);
      this.allocationsStore.set(key, allocationDTO);

      if (input.idempotencyKey && input.idempotencyKey.trim() !== '') {
        this.idempotencyStore.set(`${ctx.tenantId}:${input.idempotencyKey}`, allocationDTO);
      }

      // If DB pool is configured, acquire PostgreSQL row locks FOR UPDATE in sorted order and execute atomic DB updates
      if (this.dbPool) {
        const client = await this.dbPool.connect();
        try {
          await client.query('BEGIN');
          await client.query("SET LOCAL app.ap_allocation_authorized = 'true'");
          await client.query("SET LOCAL app.posting_authorized = 'true'");

          // Global Lock Order: acquire SELECT ... FOR UPDATE in sorted entity ID order
          const lockEntities = [
            { id: sourceId, kind: input.allocationSourceType },
            { id: targetOpenItemId, kind: 'OPEN_ITEM' }
          ].sort((a, b) => a.id.localeCompare(b.id));

          let dbSourceUnappliedStr = sourceUnappliedStr;
          let dbSourceAllocatedStr = sourceAllocatedStr;
          let dbOpenItemOutstandingStr = openItem.outstandingAmount;

          for (const ent of lockEntities) {
            if (ent.kind === 'PAYMENT') {
              const res = await client.query(
                `SELECT id, unapplied_amount, allocated_amount, status FROM ap_payments WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
                [ent.id, ctx.tenantId]
              );
              if (res.rows.length > 0) {
                dbSourceUnappliedStr = res.rows[0].unapplied_amount;
                dbSourceAllocatedStr = res.rows[0].allocated_amount;
              }
            } else if (ent.kind === 'CREDIT_NOTE') {
              const res = await client.query(
                `SELECT id, unapplied_amount, allocated_amount, status FROM ap_documents WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
                [ent.id, ctx.tenantId]
              );
              if (res.rows.length > 0) {
                dbSourceUnappliedStr = res.rows[0].unapplied_amount;
                dbSourceAllocatedStr = res.rows[0].allocated_amount;
              }
            } else {
              const res = await client.query(
                `SELECT id, outstanding_amount, status FROM ap_open_items WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
                [ent.id, ctx.tenantId]
              );
              if (res.rows.length > 0) {
                dbOpenItemOutstandingStr = res.rows[0].outstanding_amount;
              }
            }
          }

          // DB-authoritative row re-validation under lock
          const dbSourceUnappliedDec = ExactDecimal.parse(dbSourceUnappliedStr, 2);
          const dbOpenItemOutstandingDec = ExactDecimal.parse(dbOpenItemOutstandingStr, 2);

          if (allocAmtDec.compare(dbSourceUnappliedDec) > 0) {
            throw new BusinessRuleViolationError(
              `Allocation amount '${allocAmtDec.toString()}' exceeds available unapplied amount '${dbSourceUnappliedDec.toString()}' for ${input.allocationSourceType} '${sourceId}' in database.`
            );
          }

          if (totalDeductionDec.compare(dbOpenItemOutstandingDec) > 0) {
            throw new BusinessRuleViolationError(
              `Total allocation deduction '${totalDeductionDec.toString()}' exceeds outstanding open item amount '${dbOpenItemOutstandingDec.toString()}' for item '${openItemId}' in database.`
            );
          }

          const dbNewSourceUnapplied = dbSourceUnappliedDec.sub(allocAmtDec).toString();
          const dbNewSourceAllocated = ExactDecimal.parse(dbSourceAllocatedStr, 2).add(allocAmtDec).toString();
          const dbNewOpenItemOutstandingDec = dbOpenItemOutstandingDec.sub(totalDeductionDec);
          const dbNewOpenItemOutstanding = dbNewOpenItemOutstandingDec.toString();
          const dbNewOpenItemStatus = dbNewOpenItemOutstandingDec.isZero() ? 'SETTLED' : 'PARTIALLY_SETTLED';

          // Update Source Balance in DB
          if (input.allocationSourceType === 'PAYMENT') {
            await client.query(
              `UPDATE ap_payments SET unapplied_amount = $1, allocated_amount = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4`,
              [dbNewSourceUnapplied, dbNewSourceAllocated, sourceId, ctx.tenantId]
            );
          } else {
            await client.query(
              `UPDATE ap_documents SET unapplied_amount = $1, allocated_amount = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4`,
              [dbNewSourceUnapplied, dbNewSourceAllocated, sourceId, ctx.tenantId]
            );
          }

          // Update Open Item Balance in DB
          await client.query(
            `UPDATE ap_open_items SET outstanding_amount = $1, status = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4`,
            [dbNewOpenItemOutstanding, dbNewOpenItemStatus, targetOpenItemId, ctx.tenantId]
          );

          await client.query(
            `INSERT INTO ap_allocations (
              id, tenant_id, company_id, allocation_source_type, payment_id, credit_note_id,
              open_item_id, allocated_amount, discount_amount, allocation_date, status, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
            [
              allocationDTO.id,
              allocationDTO.tenantId,
              allocationDTO.companyId,
              allocationDTO.allocationSourceType,
              allocationDTO.paymentId,
              allocationDTO.creditNoteId,
              allocationDTO.openItemId,
              allocationDTO.allocatedAmount,
              allocationDTO.discountAmount,
              allocationDTO.allocationDate,
              allocationDTO.status
            ]
          );
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          logger.error({ err, allocId }, '[AP] Error creating DB allocation row');
          throw err;
        } finally {
          client.release();
        }
      }

      // 12. Audit Logging
      await auditService.logEvent(ctx, {
        module: 'finance',
        entityName: 'ApAllocation',
        entityId: allocId,
        action: 'CREATE',
        newValues: {
          allocationSourceType: allocationDTO.allocationSourceType,
          paymentId: allocationDTO.paymentId,
          creditNoteId: allocationDTO.creditNoteId,
          openItemId: allocationDTO.openItemId,
          allocatedAmount: allocationDTO.allocatedAmount,
          discountAmount: allocationDTO.discountAmount
        }
      });

      logger.info(
        { tenantId: ctx.tenantId, companyId: sourceCompanyId, allocId, sourceType: input.allocationSourceType, sourceId, openItemId },
        '[AP] Allocation created successfully'
      );

      return allocationDTO;
    } finally {
      releaseLocks();
    }
  }

  /**
   * Reverse an active AP Allocation
   */
  public async reverseAllocation(ctx: RequestContext, input: ReverseApAllocationInput): Promise<ApAllocationDTO> {
    const key = this.getKey(ctx.tenantId, input.allocationId);
    const existing = this.allocationsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ApAllocation', input.allocationId);
    }

    this.authorize(ctx, 'ap:allocation:reverse', existing.companyId);

    if (existing.status === 'REVERSED') {
      throw new BusinessRuleViolationError(`Cannot reverse AP allocation '${existing.id}'. Allocation is already REVERSED.`);
    }

    const sourceId = existing.allocationSourceType === 'PAYMENT' ? existing.paymentId! : existing.creditNoteId!;
    const openItemId = existing.openItemId;

    // Acquire locks for rollback
    const releaseLocks = await this.acquireLocks(ctx.tenantId, [sourceId, openItemId]);

    try {
      // If DB pool is configured, acquire PostgreSQL row locks FOR UPDATE in sorted order
      if (this.dbPool) {
        const client = await this.dbPool.connect();
        try {
          await client.query('BEGIN');
          await client.query("SET LOCAL app.ap_allocation_authorized = 'true'");
          await client.query("SET LOCAL app.posting_authorized = 'true'");

          const lockEntities = [
            { id: sourceId, kind: existing.allocationSourceType },
            { id: openItemId, kind: 'OPEN_ITEM' }
          ].sort((a, b) => a.id.localeCompare(b.id));

          for (const ent of lockEntities) {
            if (ent.kind === 'PAYMENT') {
              await client.query(
                `SELECT id, unapplied_amount, allocated_amount FROM ap_payments WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
                [ent.id, ctx.tenantId]
              );
            } else if (ent.kind === 'CREDIT_NOTE') {
              await client.query(
                `SELECT id, unapplied_amount, allocated_amount FROM ap_documents WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
                [ent.id, ctx.tenantId]
              );
            } else {
              await client.query(
                `SELECT id, outstanding_amount FROM ap_open_items WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
                [ent.id, ctx.tenantId]
              );
            }
          }

          await client.query(
            `UPDATE ap_allocations SET status = 'REVERSED', reversed_at = NOW(), reversed_by = $1 WHERE id = $2 AND tenant_id = $3`,
            [ctx.user?.roles[0] || 'system', existing.id, ctx.tenantId]
          );

          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          logger.error({ err, allocId: existing.id }, '[AP] Error reversing DB allocation row');
          throw err;
        } finally {
          client.release();
        }
      }

      const allocAmtDec = ExactDecimal.parse(existing.allocatedAmount, 2);
      const discountAmtDec = ExactDecimal.parse(existing.discountAmount, 2);
      const totalDeductionDec = allocAmtDec.add(discountAmtDec);

      // 1. Restore Source Balance
      if (existing.allocationSourceType === 'PAYMENT') {
        const payment = await apPaymentService.getPayment(ctx, existing.paymentId!);
        const newUnapplied = ExactDecimal.parse(payment.unappliedAmount, 2).add(allocAmtDec).toString();
        const newAllocated = ExactDecimal.parse(payment.allocatedAmount, 2).sub(allocAmtDec).toString();

        await apPaymentService.updatePaymentBalance(ctx, existing.paymentId!, newUnapplied, newAllocated);
      } else {
        // CREDIT_NOTE
        const creditNote = await apDocumentService.getDocument(ctx, existing.creditNoteId!);
        const newUnapplied = ExactDecimal.parse(creditNote.unappliedAmount, 2).add(allocAmtDec).toString();
        const newAllocated = ExactDecimal.parse(creditNote.allocatedAmount, 2).sub(allocAmtDec).toString();

        await apDocumentService.updateCreditNoteBalance(ctx, existing.creditNoteId!, newUnapplied, newAllocated);
      }

      // 2. Restore Target Open Item Balance
      const openItem = await apDocumentService.getOpenItem(ctx, openItemId);
      const origAmtDec = ExactDecimal.parse(openItem.originalAmount, 2);
      const newOutstandingDec = ExactDecimal.parse(openItem.outstandingAmount, 2).add(totalDeductionDec);
      const newOutstandingStr = newOutstandingDec.toString();

      let newOpenItemStatus: 'OPEN' | 'PARTIALLY_SETTLED' | 'SETTLED' = 'PARTIALLY_SETTLED';
      if (newOutstandingDec.equals(origAmtDec)) {
        newOpenItemStatus = 'OPEN';
      } else if (newOutstandingDec.isZero()) {
        newOpenItemStatus = 'SETTLED';
      }

      await apDocumentService.updateOpenItemBalance(ctx, openItemId, newOutstandingStr, newOpenItemStatus);

      // 3. Reverse Prompt Payment Discount Accounting (if present)
      if (existing.discountJournalEntryId) {
        await accountingCoreService.reverseAccountingEvent(ctx, {
          originalJournalId: existing.discountJournalEntryId,
          reason: input.reason || `Reversal of AP prompt payment discount allocation '${existing.id}'`
        });
      }

      // 4. Mark Allocation REVERSED
      const now = new Date();
      const reversedDTO: ApAllocationDTO = {
        ...existing,
        status: 'REVERSED',
        reversalAccountingDate: input.reversalAccountingDate || (existing as any).reversalAccountingDate || now.toISOString().substring(0, 10),
        reversedAt: now,
        reversedBy: ctx.user?.roles[0] || 'system'
      };

      this.allocationsStore.set(key, reversedDTO);

      // 4. Audit Log
      const auditPayload: any = {
        module: 'finance',
        entityName: 'ApAllocation',
        entityId: existing.id,
        action: 'REVERSE',
        newValues: { status: 'REVERSED' }
      };
      if (input.reason) {
        auditPayload.reason = input.reason;
      }
      await auditService.logEvent(ctx, auditPayload);

      logger.info({ tenantId: ctx.tenantId, allocId: existing.id }, '[AP] Allocation reversed successfully');

      return reversedDTO;
    } finally {
      releaseLocks();
    }
  }

  /**
   * Get an allocation by ID
   */
  public async getAllocation(ctx: RequestContext, id: string): Promise<ApAllocationDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const alloc = this.allocationsStore.get(key);
    if (!alloc) {
      throw new NotFoundError('ApAllocation', id);
    }
    this.authorize(ctx, 'ap:allocation:read', alloc.companyId);
    return alloc;
  }

  /**
   * List allocations matching filters
   */
  public async listAllocations(ctx: RequestContext, companyId: string, filters?: ApAllocationFilterInput): Promise<ApAllocationDTO[]> {
    this.authorize(ctx, 'ap:allocation:read', companyId);
    const result: ApAllocationDTO[] = [];
    for (const alloc of this.allocationsStore.values()) {
      if (alloc.tenantId === ctx.tenantId && alloc.companyId === companyId) {
        if (filters?.paymentId && alloc.paymentId !== filters.paymentId) continue;
        if (filters?.creditNoteId && alloc.creditNoteId !== filters.creditNoteId) continue;
        if (filters?.openItemId && alloc.openItemId !== filters.openItemId) continue;
        if (filters?.allocationSourceType && alloc.allocationSourceType !== filters.allocationSourceType) continue;
        if (filters?.status && alloc.status !== filters.status) continue;
        result.push(alloc);
      }
    }
    return result;
  }
}

export const apAllocationService = new ApAllocationService();
