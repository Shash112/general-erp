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
import { arReceiptService } from './ar-receipt.service.js';
import { arDocumentService } from './ar-document.service.js';
import {
  ArAllocationDTO,
  CreateArAllocationInput,
  ReverseArAllocationInput,
  ArAllocationFilterInput
} from './ar-allocation-model.js';
import { ArAllocationValidator } from './ar-allocation-validator.js';
import type pg from 'pg';

export class ArAllocationService {
  private allocationsStore = new Map<string, ArAllocationDTO>();
  private idempotencyStore = new Map<string, ArAllocationDTO>();
  private inFlightLocks = new Set<string>();
  private dbPool?: pg.Pool | undefined;

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
    arReceiptService.setDbPool(pool);
    arDocumentService.setDbPool(pool);
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
      const isWildcard = ctx.user.permissions.some(p => p === '*' || p === action || p.startsWith('ar:allocation:'));
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
   * Create an AR Allocation (Receipt -> Debit Item OR Credit Note -> Debit Item)
   */
  public async allocate(ctx: RequestContext, input: CreateArAllocationInput): Promise<ArAllocationDTO> {
    const inputAny = input as any;
    const allocationSourceType = input.allocationSourceType || inputAny.sourceType || 'RECEIPT';
    const openItemId = input.openItemId || inputAny.targetOpenItemId;
    const receiptId = input.receiptId || (allocationSourceType === 'RECEIPT' ? inputAny.sourceId : undefined);
    const creditNoteId = input.creditNoteId || (allocationSourceType === 'CREDIT_NOTE' ? inputAny.sourceId : undefined);

    input = {
      ...input,
      allocationSourceType,
      openItemId,
      ...(receiptId ? { receiptId } : {}),
      ...(creditNoteId ? { creditNoteId } : {})
    };
    ArAllocationValidator.validateCreateInput(ctx, input);

    // 1. Check Idempotency Key
    if (input.idempotencyKey && input.idempotencyKey.trim() !== '') {
      const idempKey = `${ctx.tenantId}:${input.idempotencyKey}`;
      const existing = this.idempotencyStore.get(idempKey);
      if (existing) {
        logger.info({ tenantId: ctx.tenantId, idempotencyKey: input.idempotencyKey }, '[AR] Returning idempotent allocation result');
        return existing;
      }
    }

    const sourceId = input.allocationSourceType === 'RECEIPT' ? input.receiptId! : input.creditNoteId!;
    const targetOpenItemId = input.openItemId;

    // Acquire deterministic locks on source and open item
    const releaseLocks = await this.acquireLocks(ctx.tenantId, [sourceId, targetOpenItemId]);

    try {
      // 2. Resolve Target Open Item
      const openItem = await arDocumentService.getOpenItem(ctx, openItemId);

      // Company Context Authorization
      this.authorize(ctx, 'ar:allocation:create', openItem.companyId);

      if (openItem.tenantId !== ctx.tenantId) {
        throw new ForbiddenError(`Target open item '${openItemId}' belongs to tenant '${openItem.tenantId}', not request tenant '${ctx.tenantId}'.`);
      }

      if (openItem.status === 'SETTLED' || openItem.status === 'CANCELLED') {
        throw new BusinessRuleViolationError(`Cannot allocate to open item '${openItemId}'. Current status is '${openItem.status}'. Target must be OPEN or PARTIALLY_SETTLED.`);
      }

      // 3. Resolve Allocation Source (Receipt or Credit Note)
      let sourceCustomerId = '';
      let sourceUnappliedStr = '0.00';
      let sourceAllocatedStr = '0.00';
      let sourceCompanyId = '';

      if (input.allocationSourceType === 'RECEIPT') {
        const receipt = await arReceiptService.getReceipt(ctx, input.receiptId!);

        if (receipt.companyId !== openItem.companyId) {
          throw new ForbiddenError(`Receipt company '${receipt.companyId}' does not match open item company '${openItem.companyId}'.`);
        }

        if (receipt.status !== 'POSTED') {
          throw new BusinessRuleViolationError(`Cannot allocate receipt '${receipt.id}'. Status is '${receipt.status}'. Receipt must be POSTED.`);
        }

        sourceCustomerId = receipt.customerId;
        sourceUnappliedStr = receipt.unappliedAmount;
        sourceAllocatedStr = receipt.allocatedAmount;
        sourceCompanyId = receipt.companyId;
      } else {
        // CREDIT_NOTE
        const creditNote = await arDocumentService.getDocument(ctx, input.creditNoteId!);

        if (creditNote.companyId !== openItem.companyId) {
          throw new ForbiddenError(`Credit note company '${creditNote.companyId}' does not match open item company '${openItem.companyId}'.`);
        }

        if (creditNote.documentType !== 'CREDIT_NOTE') {
          throw new BusinessRuleViolationError(`Document '${creditNote.id}' is a '${creditNote.documentType}', not a CREDIT_NOTE.`);
        }

        if (creditNote.status !== 'POSTED' && creditNote.status !== 'PARTIALLY_SETTLED') {
          throw new BusinessRuleViolationError(`Cannot allocate credit note '${creditNote.id}'. Status is '${creditNote.status}'. Credit note must be POSTED or PARTIALLY_SETTLED.`);
        }

        sourceCustomerId = creditNote.customerId;
        sourceUnappliedStr = creditNote.unappliedAmount;
        sourceAllocatedStr = creditNote.allocatedAmount;
        sourceCompanyId = creditNote.companyId;
      }

      // 4. Validate Same Customer Invariant
      if (sourceCustomerId !== openItem.customerId) {
        throw new BusinessRuleViolationError(
          `Allocation source customer '${sourceCustomerId}' does not match target open item customer '${openItem.customerId}'. Cross-customer allocation is strictly forbidden.`
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

      // 8. Commit Source Balance Updates
      if (input.allocationSourceType === 'RECEIPT') {
        await arReceiptService.updateReceiptBalance(ctx, input.receiptId!, newSourceUnappliedStr, newSourceAllocatedStr);
      } else {
        await arDocumentService.updateCreditNoteBalance(ctx, input.creditNoteId!, newSourceUnappliedStr, newSourceAllocatedStr);
      }

      // 9. Commit Open Item Balance Updates
      await arDocumentService.updateOpenItemBalance(ctx, openItemId, newOpenItemOutstandingStr, newOpenItemStatus);

      // 10. Persist Allocation DTO
      const allocId = `aralloc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const now = new Date();
      const allocDateStr = input.allocationDate || now.toISOString().substring(0, 10);

      const allocationDTO: ArAllocationDTO = {
        id: allocId,
        tenantId: ctx.tenantId,
        companyId: sourceCompanyId,
        allocationSourceType: input.allocationSourceType,
        receiptId: input.receiptId || null,
        creditNoteId: input.creditNoteId || null,
        openItemId,
        allocatedAmount: allocAmtDec.toString(),
        discountAmount: discountAmtDec.toString(),
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

      // 11. Audit Logging
      await auditService.logEvent(ctx, {
        module: 'finance',
        entityName: 'ArAllocation',
        entityId: allocId,
        action: 'CREATE',
        newValues: {
          allocationSourceType: allocationDTO.allocationSourceType,
          receiptId: allocationDTO.receiptId,
          creditNoteId: allocationDTO.creditNoteId,
          openItemId: allocationDTO.openItemId,
          allocatedAmount: allocationDTO.allocatedAmount,
          discountAmount: allocationDTO.discountAmount
        }
      });

      logger.info(
        { tenantId: ctx.tenantId, companyId: sourceCompanyId, allocId, sourceType: input.allocationSourceType, sourceId, openItemId },
        '[AR] Allocation created successfully'
      );

      return allocationDTO;
    } finally {
      releaseLocks();
    }
  }

  /**
   * Reverse an active AR Allocation
   */
  public async reverseAllocation(ctx: RequestContext, input: ReverseArAllocationInput): Promise<ArAllocationDTO> {
    const key = this.getKey(ctx.tenantId, input.allocationId);
    const existing = this.allocationsStore.get(key);
    if (!existing) {
      throw new NotFoundError('ArAllocation', input.allocationId);
    }

    this.authorize(ctx, 'ar:allocation:reverse', existing.companyId);

    if (existing.status === 'REVERSED') {
      throw new BusinessRuleViolationError(`Cannot reverse AR allocation '${existing.id}'. Allocation is already REVERSED.`);
    }

    const sourceId = existing.allocationSourceType === 'RECEIPT' ? existing.receiptId! : existing.creditNoteId!;
    const openItemId = existing.openItemId;

    // Acquire locks for rollback
    const releaseLocks = await this.acquireLocks(ctx.tenantId, [sourceId, openItemId]);

    try {
      const allocAmtDec = ExactDecimal.parse(existing.allocatedAmount, 2);
      const discountAmtDec = ExactDecimal.parse(existing.discountAmount, 2);
      const totalDeductionDec = allocAmtDec.add(discountAmtDec);

      // 1. Restore Source Balance
      if (existing.allocationSourceType === 'RECEIPT') {
        const receipt = await arReceiptService.getReceipt(ctx, existing.receiptId!);
        const newUnapplied = ExactDecimal.parse(receipt.unappliedAmount, 2).add(allocAmtDec).toString();
        const newAllocated = ExactDecimal.parse(receipt.allocatedAmount, 2).sub(allocAmtDec).toString();

        await arReceiptService.updateReceiptBalance(ctx, existing.receiptId!, newUnapplied, newAllocated);
      } else {
        // CREDIT_NOTE
        const creditNote = await arDocumentService.getDocument(ctx, existing.creditNoteId!);
        const newUnapplied = ExactDecimal.parse(creditNote.unappliedAmount, 2).add(allocAmtDec).toString();
        const newAllocated = ExactDecimal.parse(creditNote.allocatedAmount, 2).sub(allocAmtDec).toString();

        await arDocumentService.updateCreditNoteBalance(ctx, existing.creditNoteId!, newUnapplied, newAllocated);
      }

      // 2. Restore Target Open Item Balance
      const openItem = await arDocumentService.getOpenItem(ctx, openItemId);
      const origAmtDec = ExactDecimal.parse(openItem.originalAmount, 2);
      const newOutstandingDec = ExactDecimal.parse(openItem.outstandingAmount, 2).add(totalDeductionDec);
      const newOutstandingStr = newOutstandingDec.toString();

      let newOpenItemStatus: 'OPEN' | 'PARTIALLY_SETTLED' | 'SETTLED' = 'PARTIALLY_SETTLED';
      if (newOutstandingDec.equals(origAmtDec)) {
        newOpenItemStatus = 'OPEN';
      } else if (newOutstandingDec.isZero()) {
        newOpenItemStatus = 'SETTLED';
      }

      await arDocumentService.updateOpenItemBalance(ctx, openItemId, newOutstandingStr, newOpenItemStatus);

      // 3. Mark Allocation REVERSED
      const now = new Date();
      const reversedDTO: ArAllocationDTO = {
        ...existing,
        status: 'REVERSED',
        reversedAt: now,
        reversedBy: ctx.user?.roles[0] || 'system'
      };

      this.allocationsStore.set(key, reversedDTO);

      // 4. Audit Log
      const auditPayload: any = {
        module: 'finance',
        entityName: 'ArAllocation',
        entityId: existing.id,
        action: 'REVERSE',
        newValues: { status: 'REVERSED' }
      };
      if (input.reason) {
        auditPayload.reason = input.reason;
      }
      await auditService.logEvent(ctx, auditPayload);

      logger.info({ tenantId: ctx.tenantId, allocId: existing.id }, '[AR] Allocation reversed successfully');

      return reversedDTO;
    } finally {
      releaseLocks();
    }
  }

  /**
   * Get an allocation by ID
   */
  public async getAllocation(ctx: RequestContext, id: string): Promise<ArAllocationDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const alloc = this.allocationsStore.get(key);
    if (!alloc) {
      throw new NotFoundError('ArAllocation', id);
    }
    this.authorize(ctx, 'ar:allocation:read', alloc.companyId);
    return alloc;
  }

  /**
   * List allocations matching filters
   */
  public async listAllocations(ctx: RequestContext, companyId: string, filters?: ArAllocationFilterInput): Promise<ArAllocationDTO[]> {
    this.authorize(ctx, 'ar:allocation:read', companyId);
    const result: ArAllocationDTO[] = [];
    for (const alloc of this.allocationsStore.values()) {
      if (alloc.tenantId === ctx.tenantId && alloc.companyId === companyId) {
        if (filters?.receiptId && alloc.receiptId !== filters.receiptId) continue;
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

export const arAllocationService = new ArAllocationService();
