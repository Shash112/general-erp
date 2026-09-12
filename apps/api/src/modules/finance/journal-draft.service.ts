import {
  RequestContext,
  ValidationError,
  NotFoundError,
  BusinessRuleViolationError,
  ConflictError
} from '@general-erp/core';
import { logger } from '../../config/logger.js';
import { JournalModel, JournalEntryDTO, JournalLineDTO } from './journal-model.js';
import { authorizationService } from '../../platform/authorization/authorization.service.js';
import { auditService } from '../../platform/audit/audit.service.js';

export interface CreateDraftJournalInput {
  id?: string;
  companyId: string;
  fiscalYearId: string;
  fiscalPeriodId: string;
  accountingDate: string; // SQL DATE "YYYY-MM-DD"
  sourceModule?: string;  // Default 'MANUAL'
  sourceDocumentType?: string | null;
  sourceDocumentId?: string | null;
  currency?: string;      // Default 'INR'
  exchangeRate?: string;  // Default '1.000000'
  narration?: string | null;
  lines: Array<{
    id?: string;
    accountId: string;
    lineSequence: number;
    debitAmount: string;
    creditAmount: string;
    currency?: string;
    exchangeRate?: string;
    narration?: string | null;
    partyType?: string | null;
    partyId?: string | null;
    branchId?: string | null;
    departmentId?: string | null;
  }>;
}

export interface UpdateDraftJournalInput {
  accountingDate?: string;
  fiscalYearId?: string;
  fiscalPeriodId?: string;
  sourceModule?: string;
  sourceDocumentType?: string | null;
  sourceDocumentId?: string | null;
  currency?: string;
  exchangeRate?: string;
  narration?: string | null;
  expectedVersion?: number;
  lines?: Array<{
    id?: string;
    accountId: string;
    lineSequence: number;
    debitAmount: string;
    creditAmount: string;
    currency?: string;
    exchangeRate?: string;
    narration?: string | null;
    partyType?: string | null;
    partyId?: string | null;
    branchId?: string | null;
    departmentId?: string | null;
  }>;
}

export class JournalDraftService {
  private journalsStore = new Map<string, JournalEntryDTO>();
  private linesStore = new Map<string, JournalLineDTO[]>();

  private getStoreKey(tenantId: string, companyId: string, journalId: string): string {
    return `${tenantId}:${companyId}:${journalId}`;
  }

  /**
   * Helper for tests & store reset
   */
  public clear(): void {
    this.journalsStore.clear();
    this.linesStore.clear();
  }

  /**
   * Retrieves a draft journal entry header and lines scoped by tenant and company context.
   */
  public async getDraftById(ctx: RequestContext, id: string): Promise<JournalEntryDTO> {
    if (!ctx.tenantId || !ctx.companyId) {
      throw new ValidationError('RequestContext must include tenantId and companyId.');
    }

    const key = this.getStoreKey(ctx.tenantId, ctx.companyId, id);
    const journal = this.journalsStore.get(key);

    if (!journal) {
      throw new NotFoundError('JournalEntry', id);
    }

    if (ctx.user) {
      const isAuthorized = ctx.user.permissions.some(p => 
        p === '*' || 
        p.startsWith('finance:gl:') || 
        p.startsWith('finance:draft:')
      );
      if (!isAuthorized) {
        authorizationService.authorize({ user: ctx.user, action: 'finance:gl:read', companyId: journal.companyId });
      }
    }

    const lines = (this.linesStore.get(key) || []).slice().sort((a, b) => a.lineSequence - b.lineSequence);

    return {
      ...journal,
      lines: lines.map(line => ({ ...line }))
    };
  }

  /**
   * Creates a new manual draft journal entry.
   * Draft entries receive status = 'DRAFT' and voucherNumber = NULL.
   * Draft creation does NOT consume voucher numbers from the NumberingEngine.
   */
  public async createDraft(ctx: RequestContext, input: CreateDraftJournalInput): Promise<JournalEntryDTO> {
    if (!ctx.tenantId) {
      throw new ValidationError('RequestContext tenantId is required.');
    }

    if (!input.companyId || input.companyId.trim() === '') {
      throw new ValidationError('Journal companyId is required.');
    }

    if (ctx.companyId && ctx.companyId !== input.companyId) {
      throw new ValidationError(`Tenant/Company context mismatch. Request companyId '${ctx.companyId}' does not match input companyId '${input.companyId}'.`);
    }

    if (ctx.user) {
      const action = ctx.user.permissions.some(p => p === 'finance:draft:create') ? 'finance:draft:create' : 'finance:gl:create';
      authorizationService.authorize({ user: ctx.user, action, companyId: input.companyId });
    }

    const now = new Date();
    const journalId = input.id || `je_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const formattedLines: JournalLineDTO[] = input.lines.map((l, index) => {
      const lineId = l.id || `jl_${journalId}_${index + 1}`;
      return {
        id: lineId,
        tenantId: ctx.tenantId,
        companyId: input.companyId,
        journalEntryId: journalId,
        accountId: l.accountId,
        lineSequence: l.lineSequence,
        debitAmount: l.debitAmount,
        creditAmount: l.creditAmount,
        currency: l.currency || input.currency || 'INR',
        exchangeRate: l.exchangeRate || input.exchangeRate || '1.000000',
        baseDebitAmount: l.debitAmount,
        baseCreditAmount: l.creditAmount,
        narration: l.narration || null,
        partyType: l.partyType || null,
        partyId: l.partyId || null,
        branchId: l.branchId || null,
        departmentId: l.departmentId || null,
        createdAt: now
      };
    });

    // Calculate line-derived exact totals
    const { totalDebit, totalCredit } = JournalModel.calculateTotals(formattedLines);

    const draftDto: JournalEntryDTO = {
      id: journalId,
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      voucherNumber: null, // DRAFT voucher number must remain NULL
      fiscalYearId: input.fiscalYearId,
      fiscalPeriodId: input.fiscalPeriodId,
      accountingDate: input.accountingDate,
      postingDate: null,
      sourceModule: input.sourceModule || 'MANUAL',
      sourceDocumentType: input.sourceDocumentType || null,
      sourceDocumentId: input.sourceDocumentId || null,
      originalJournalId: null,
      status: 'DRAFT',
      totalDebit: totalDebit.toString(),
      totalCredit: totalCredit.toString(),
      currency: input.currency || 'INR',
      exchangeRate: input.exchangeRate || '1.000000',
      narration: input.narration || null,
      createdBy: ctx.user?.userId || 'system',
      postedBy: null,
      postedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      lines: formattedLines
    };

    // Full Domain Validation Contract
    JournalModel.validate(draftDto);

    // Atomic Store Persistence
    const storeKey = this.getStoreKey(ctx.tenantId, input.companyId, journalId);
    this.journalsStore.set(storeKey, { ...draftDto, lines: [] });
    this.linesStore.set(storeKey, formattedLines.map(l => ({ ...l })));

    logger.info({
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      journalId,
      totalDebit: totalDebit.toString(),
      msg: '[GL] Draft journal created successfully'
    });

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'JournalEntry',
      entityId: journalId,
      action: 'CREATE',
      newValues: {
        companyId: input.companyId,
        voucherNumber: draftDto.voucherNumber,
        totalDebit: draftDto.totalDebit,
        totalCredit: draftDto.totalCredit,
        sourceModule: draftDto.sourceModule,
        sourceDocumentId: draftDto.sourceDocumentId,
        status: draftDto.status
      }
    });

    return draftDto;
  }

  /**
   * Updates an existing draft journal entry.
   * Protects system-managed fields against mass assignment attacks.
   * Enforces optimistic concurrency via version checking.
   */
  public async updateDraft(ctx: RequestContext, id: string, input: UpdateDraftJournalInput): Promise<JournalEntryDTO> {
    if (!ctx.tenantId || !ctx.companyId) {
      throw new ValidationError('RequestContext tenantId and companyId are required.');
    }

    const storeKey = this.getStoreKey(ctx.tenantId, ctx.companyId, id);
    const existing = this.journalsStore.get(storeKey);

    if (!existing) {
      throw new NotFoundError('JournalEntry', id);
    }

    if (ctx.user) {
      const action = ctx.user.permissions.some(p => p === 'finance:draft:update') ? 'finance:draft:update' : 'finance:gl:update';
      authorizationService.authorize({ user: ctx.user, action, companyId: existing.companyId });
    }

    // Status Restriction Guard
    if (existing.status !== 'DRAFT') {
      throw new BusinessRuleViolationError(
        `Cannot update journal entry '${id}' with status '${existing.status}'. Only DRAFT journals can be updated.`
      );
    }

    // Optimistic Concurrency Guard
    if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
      throw new ConflictError(
        `Concurrent modification detected for journal entry '${id}'. Expected version ${input.expectedVersion}, but current version is ${existing.version}.`
      );
    }

    const now = new Date();

    // Prepare updated lines or preserve existing
    let updatedLines: JournalLineDTO[];
    if (input.lines) {
      updatedLines = input.lines.map((l, index) => ({
        id: l.id || `jl_${id}_${index + 1}`,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        journalEntryId: id,
        accountId: l.accountId,
        lineSequence: l.lineSequence,
        debitAmount: l.debitAmount,
        creditAmount: l.creditAmount,
        currency: l.currency || input.currency || existing.currency,
        exchangeRate: l.exchangeRate || input.exchangeRate || existing.exchangeRate,
        baseDebitAmount: l.debitAmount,
        baseCreditAmount: l.creditAmount,
        narration: l.narration !== undefined ? l.narration : null,
        partyType: l.partyType !== undefined ? l.partyType : null,
        partyId: l.partyId !== undefined ? l.partyId : null,
        branchId: l.branchId !== undefined ? l.branchId : null,
        departmentId: l.departmentId !== undefined ? l.departmentId : null,
        createdAt: now
      }));
    } else {
      updatedLines = (this.linesStore.get(storeKey) || []).map(l => ({ ...l }));
    }

    // Calculate line-derived exact totals
    const { totalDebit, totalCredit } = JournalModel.calculateTotals(updatedLines);

    // Protected Mass Assignment Defense: Preserve system-managed fields
    const updatedDto: JournalEntryDTO = {
      id: existing.id || id,                               // PROTECTED
      tenantId: existing.tenantId,                         // PROTECTED
      companyId: existing.companyId,                       // PROTECTED
      voucherNumber: existing.voucherNumber || null,       // PROTECTED (NULL for DRAFT)
      fiscalYearId: input.fiscalYearId ?? existing.fiscalYearId,
      fiscalPeriodId: input.fiscalPeriodId ?? existing.fiscalPeriodId,
      accountingDate: input.accountingDate ?? existing.accountingDate,
      postingDate: existing.postingDate || null,           // PROTECTED
      sourceModule: input.sourceModule ?? existing.sourceModule,
      sourceDocumentType: input.sourceDocumentType !== undefined ? input.sourceDocumentType : existing.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId !== undefined ? input.sourceDocumentId : existing.sourceDocumentId,
      originalJournalId: existing.originalJournalId || null, // PROTECTED
      status: 'DRAFT',                                     // PROTECTED
      totalDebit: totalDebit.toString(),
      totalCredit: totalCredit.toString(),
      currency: input.currency ?? existing.currency,
      exchangeRate: input.exchangeRate ?? existing.exchangeRate,
      narration: input.narration !== undefined ? input.narration : existing.narration,
      createdBy: existing.createdBy,                       // PROTECTED
      postedBy: existing.postedBy || null,                 // PROTECTED
      postedAt: existing.postedAt || null,                 // PROTECTED
      version: existing.version + 1,                       // Incremented version
      createdAt: existing.createdAt,                       // PROTECTED
      updatedAt: now,
      lines: updatedLines
    };

    // Full Domain Validation Contract
    JournalModel.validate(updatedDto);

    // Atomic Store Replacement
    this.journalsStore.set(storeKey, { ...updatedDto, lines: [] });
    this.linesStore.set(storeKey, updatedLines.map(l => ({ ...l })));

    logger.info({
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      journalId: id,
      version: updatedDto.version,
      msg: '[GL] Draft journal updated successfully'
    });

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'JournalEntry',
      entityId: id,
      action: 'UPDATE',
      newValues: {
        totalDebit: updatedDto.totalDebit,
        totalCredit: updatedDto.totalCredit,
        version: updatedDto.version
      }
    });

    return updatedDto;
  }

  /**
   * Cancels a draft journal entry.
   * Valid transition: DRAFT -> CANCELLED.
   * Does NOT delete records and does NOT allocate voucher numbers.
   */
  public async cancelDraft(ctx: RequestContext, id: string): Promise<JournalEntryDTO> {
    if (!ctx.tenantId || !ctx.companyId) {
      throw new ValidationError('RequestContext tenantId and companyId are required.');
    }

    const storeKey = this.getStoreKey(ctx.tenantId, ctx.companyId, id);
    const existing = this.journalsStore.get(storeKey);

    if (!existing) {
      throw new NotFoundError('JournalEntry', id);
    }

    if (ctx.user) {
      const action = ctx.user.permissions.some(p => p === 'finance:draft:cancel') ? 'finance:draft:cancel' : 'finance:gl:cancel';
      authorizationService.authorize({ user: ctx.user, action, companyId: existing.companyId });
    }

    if (existing.status === 'POSTED') {
      throw new BusinessRuleViolationError(
        `Cannot cancel a POSTED journal entry. Posted entries are strictly immutable and must be corrected via reversal journals.`
      );
    }

    if (existing.status === 'CANCELLED') {
      throw new BusinessRuleViolationError(`Journal entry '${id}' is already CANCELLED.`);
    }

    if (existing.status !== 'DRAFT') {
      throw new BusinessRuleViolationError(
        `Cannot cancel journal entry '${id}' with status '${existing.status}'. Only DRAFT journals can be cancelled.`
      );
    }

    const now = new Date();
    const existingLines = (this.linesStore.get(storeKey) || []).map(l => ({ ...l }));

    const cancelledDto: JournalEntryDTO = {
      id: existing.id || id,
      tenantId: existing.tenantId,
      companyId: existing.companyId,
      voucherNumber: existing.voucherNumber || null,
      fiscalYearId: existing.fiscalYearId,
      fiscalPeriodId: existing.fiscalPeriodId,
      accountingDate: existing.accountingDate,
      postingDate: existing.postingDate || null,
      sourceModule: existing.sourceModule,
      sourceDocumentType: existing.sourceDocumentType || null,
      sourceDocumentId: existing.sourceDocumentId || null,
      originalJournalId: existing.originalJournalId || null,
      status: 'CANCELLED',
      totalDebit: existing.totalDebit,
      totalCredit: existing.totalCredit,
      currency: existing.currency,
      exchangeRate: existing.exchangeRate,
      narration: existing.narration || null,
      createdBy: existing.createdBy,
      postedBy: existing.postedBy || null,
      postedAt: existing.postedAt || null,
      version: existing.version + 1,
      createdAt: existing.createdAt,
      updatedAt: now,
      lines: existingLines
    };

    this.journalsStore.set(storeKey, { ...cancelledDto, lines: [] });

    logger.info({
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      journalId: id,
      version: cancelledDto.version,
      msg: '[GL] Draft journal cancelled successfully'
    });

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'JournalEntry',
      entityId: id,
      action: 'CANCEL',
      newValues: {
        status: 'CANCELLED',
        version: cancelledDto.version
      }
    });

    return cancelledDto;
  }
}

export const journalDraftService = new JournalDraftService();
