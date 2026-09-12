import {
  RequestContext,
  ValidationError,
  ForbiddenError,
  BusinessRuleViolationError,
  AccountingError,
  ExactDecimal
} from '@general-erp/core';
import { logger } from '../../config/logger.js';
import { chartOfAccountsService } from './chart-of-accounts.service.js';
import { fiscalPeriodService } from './fiscal-period.service.js';
import { journalDraftService, CreateDraftJournalInput } from './journal-draft.service.js';
import { JournalEntryDTO } from './journal-model.js';
import { glEngine } from './gl-engine.js';
import { authorizationService } from '../../platform/authorization/authorization.service.js';
import { auditService } from '../../platform/audit/audit.service.js';
import { idempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type pg from 'pg';
import { TaxCalculationResult } from './tax-calculation.service.js';

export type TaxAccountingDirection = 'INPUT' | 'OUTPUT';

export interface PostTaxAccountingEventInput {
  companyId: string;
  accountingDate: string; // "YYYY-MM-DD"
  sourceModule: string;
  sourceDocumentType?: string | null | undefined;
  sourceDocumentId: string;
  eventType: string; // e.g. 'SALES_INVOICE', 'PURCHASE_INVOICE'
  direction: TaxAccountingDirection;
  
  // Base line details (Revenue for OUTPUT, Expense for INPUT)
  baseAccountId?: string | undefined;
  baseAccountCode?: string | undefined;
  baseLineRole?: string | undefined;

  // Offset line details (AR for OUTPUT, AP for INPUT)
  offsetAccountId?: string | undefined;
  offsetAccountCode?: string | undefined;
  offsetLineRole?: string | undefined;

  taxCalculation: TaxCalculationResult;
  narration?: string | null | undefined;
  idempotencyKey?: string | undefined;
  simulateFailure?: boolean | undefined;
  isRcm?: boolean | undefined;
}

export interface AccountingEventLineInput {
  accountId?: string | undefined;
  accountCode?: string | undefined;
  lineRole?: string | undefined; // e.g. 'AR_CONTROL', 'SALES_REVENUE', 'OUTPUT_GST', 'AP_CONTROL', 'PURCHASE_EXPENSE', 'INPUT_GST', 'SALARY_EXPENSE', 'TDS_PAYABLE', 'BANK'
  lineSequence: number;
  debitAmount: string;
  creditAmount: string;
  narration?: string | null | undefined;
  partyType?: string | null | undefined;
  partyId?: string | null | undefined;
  branchId?: string | null | undefined;
  departmentId?: string | null | undefined;
}

export interface AccountingEventInput {
  eventId?: string | undefined;
  eventType: string; // e.g. 'MANUAL_JOURNAL', 'SALES_INVOICE', 'PURCHASE_INVOICE', 'EXPENSE_CLAIM', 'PAYROLL_RUN', 'BANK_TRANSACTION'
  companyId: string;
  fiscalYearId?: string | undefined;
  fiscalPeriodId?: string | undefined;
  accountingDate: string; // "YYYY-MM-DD"
  sourceModule: string;
  sourceDocumentType?: string | null | undefined;
  sourceDocumentId: string;
  narration?: string | null | undefined;
  currency?: string | undefined; // default 'INR'
  exchangeRate?: string | undefined; // default '1.000000'
  idempotencyKey?: string | undefined;
  simulateFailure?: boolean | undefined; // For testing transaction rollback
  lines: AccountingEventLineInput[];
}

export interface AccountingMappingInput {
  companyId: string;
  eventType: string;
  lineRole: string;
  accountId: string;
}

export interface AccountingMappingDTO {
  id: string;
  tenantId: string;
  companyId: string;
  eventType: string;
  lineRole: string;
  accountId: string;
  accountCode: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReverseAccountingEventInput {
  originalJournalId: string;
  reason: string;
  reversalAccountingDate?: string | undefined;
  idempotencyKey?: string | undefined;
}

export class AccountingConfigurationService {
  private mappingsStore = new Map<string, AccountingMappingDTO>();

  private getStoreKey(tenantId: string, companyId: string, eventType: string, lineRole: string): string {
    return `${tenantId}:${companyId}:${eventType}:${lineRole}`;
  }

  public clear(): void {
    this.mappingsStore.clear();
  }

  public async setMapping(ctx: RequestContext, input: AccountingMappingInput): Promise<AccountingMappingDTO> {
    if (!ctx.tenantId || !input.companyId) {
      throw new ValidationError('RequestContext tenantId and companyId are required.');
    }

    const account = await chartOfAccountsService.getAccountById(ctx, input.accountId);
    if (account.companyId !== input.companyId) {
      throw new ValidationError(`Account '${input.accountId}' does not belong to company '${input.companyId}'.`);
    }

    const key = this.getStoreKey(ctx.tenantId, input.companyId, input.eventType, input.lineRole);
    const now = new Date();

    const mapping: AccountingMappingDTO = {
      id: `map_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      eventType: input.eventType,
      lineRole: input.lineRole,
      accountId: account.id,
      accountCode: account.accountCode,
      isActive: true,
      createdAt: now,
      updatedAt: now
    };

    this.mappingsStore.set(key, mapping);
    return mapping;
  }

  public async getMapping(ctx: RequestContext, companyId: string, eventType: string, lineRole: string): Promise<AccountingMappingDTO | null> {
    if (!ctx.tenantId || !companyId) {
      return null;
    }
    const key = this.getStoreKey(ctx.tenantId, companyId, eventType, lineRole);
    return this.mappingsStore.get(key) || null;
  }
}

export const accountingConfigurationService = new AccountingConfigurationService();

export class AccountingInvariantValidator {
  /**
   * Validates core financial invariants for an accounting event before submission.
   */
  public static validateEvent(ctx: RequestContext, event: AccountingEventInput): void {
    if (!ctx.tenantId) {
      throw new ValidationError('RequestContext tenantId is required.');
    }
    if (!event.companyId || event.companyId.trim() === '') {
      throw new ValidationError('Accounting event companyId is required.');
    }
    if (ctx.companyId && ctx.companyId !== event.companyId) {
      throw new ValidationError(`Tenant/Company context mismatch. Request companyId '${ctx.companyId}' does not match event companyId '${event.companyId}'.`);
    }

    if (!event.accountingDate || !/^\d{4}-\d{2}-\d{2}$/.test(event.accountingDate)) {
      throw new ValidationError(`Invalid accountingDate format '${event.accountingDate}'. Must be SQL DATE format 'YYYY-MM-DD'.`);
    }

    if (!event.sourceModule || event.sourceModule.trim() === '') {
      throw new ValidationError('Accounting event sourceModule is required.');
    }
    if (!event.sourceDocumentId || event.sourceDocumentId.trim() === '') {
      throw new ValidationError('Accounting event sourceDocumentId is required.');
    }

    // Phase 2.4 Single-Currency Invariant Scope Check
    const currency = event.currency || 'INR';
    const exchangeRate = event.exchangeRate || '1.000000';

    if (currency !== 'INR') {
      throw new ValidationError(`Phase 2.4 Accounting Core enforces single-currency INR scope. Received currency: '${currency}'.`);
    }
    if (exchangeRate !== '1.000000') {
      throw new ValidationError(`Phase 2.4 Accounting Core enforces single-currency exchange rate '1.000000'. Received: '${exchangeRate}'.`);
    }

    if (!event.lines || !Array.isArray(event.lines) || event.lines.length < 2) {
      throw new ValidationError('Accounting event must contain at least 2 lines (Debit and Credit).');
    }

    let totalDebit = ExactDecimal.ZERO;
    let totalCredit = ExactDecimal.ZERO;

    for (const line of event.lines) {
      // 1. Monetary Scale Invariant
      ExactDecimal.validateScale(line.debitAmount, 2);
      ExactDecimal.validateScale(line.creditAmount, 2);

      const debit = ExactDecimal.parse(line.debitAmount, 2);
      const credit = ExactDecimal.parse(line.creditAmount, 2);

      // 2. Positive Amounts Invariant
      if (debit.isNegative() || credit.isNegative()) {
        throw new ValidationError(`Journal line sequence ${line.lineSequence} contains negative amount. Debit: '${line.debitAmount}', Credit: '${line.creditAmount}'.`);
      }

      // 3. Debit/Credit XOR Invariant
      if (debit.isPositive() && credit.isPositive()) {
        throw new ValidationError(`Journal line sequence ${line.lineSequence} violates Debit/Credit XOR invariant. Both debit ('${line.debitAmount}') and credit ('${line.creditAmount}') are positive.`);
      }
      if (debit.isZero() && credit.isZero()) {
        throw new ValidationError(`Journal line sequence ${line.lineSequence} contains zero amount. Either debit or credit must be positive.`);
      }

      totalDebit = totalDebit.add(debit);
      totalCredit = totalCredit.add(credit);
    }

    // 4. Balanced Journal Invariant
    if (!totalDebit.equals(totalCredit)) {
      throw new AccountingError(
        `Financial invariant violation: Total Debit (${totalDebit.toString()}) does not equal Total Credit (${totalCredit.toString()}) for source document '${event.sourceDocumentId}'.`
      );
    }

    if (totalDebit.isZero()) {
      throw new AccountingError(`Accounting event for source document '${event.sourceDocumentId}' cannot be posted with total amount zero.`);
    }
  }
}

export class AccountingCoreService {
  private dbPool?: pg.Pool | undefined;

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
    glEngine.setDbPool(pool);
  }

  public getDbPool(): pg.Pool | undefined {
    return this.dbPool;
  }

  /**
   * Integrates a TaxCalculationResult into a balanced, posted accounting event.
   * Validates calculation invariants, resolves tax control accounts via configuration,
   * constructs accounting lines, and posts atomically through GLEngine.
   */
  public async processTaxAccountingEvent(ctx: RequestContext, input: PostTaxAccountingEventInput): Promise<JournalEntryDTO> {
    if (!ctx.tenantId || !input.companyId) {
      throw new ValidationError('RequestContext tenantId and companyId are required.');
    }
    if (!input.taxCalculation) {
      throw new ValidationError('Tax accounting requires a valid TaxCalculationResult.');
    }

    const { taxCalculation } = input;

    // 1. Tenant/Company Scope Verification
    if (taxCalculation.tenantId !== ctx.tenantId || taxCalculation.companyId !== input.companyId) {
      throw new ForbiddenError('Tenant/Company scope mismatch between RequestContext and TaxCalculationResult.');
    }

    // 2. Exact Decimal & Tax Calculation Result Validation (Section 15, 16)
    ExactDecimal.validateScale(taxCalculation.taxableAmount, 2);
    ExactDecimal.validateScale(taxCalculation.totalTaxAmount, 2);
    ExactDecimal.validateScale(taxCalculation.totalAmount, 2);

    const taxableDec = ExactDecimal.parse(taxCalculation.taxableAmount, 2);
    const totalTaxDec = ExactDecimal.parse(taxCalculation.totalTaxAmount, 2);
    const totalDec = ExactDecimal.parse(taxCalculation.totalAmount, 2);

    if (!totalDec.equals(taxableDec.add(totalTaxDec))) {
      throw new ValidationError(
        `Tax calculation result reconciliation invariant failed: totalAmount ('${taxCalculation.totalAmount}') != taxableAmount ('${taxCalculation.taxableAmount}') + totalTaxAmount ('${taxCalculation.totalTaxAmount}').`
      );
    }

    let calculatedComponentSum = ExactDecimal.ZERO;
    for (const comp of taxCalculation.components || []) {
      ExactDecimal.validateScale(comp.taxAmount, 2);
      calculatedComponentSum = calculatedComponentSum.add(ExactDecimal.parse(comp.taxAmount, 2));
    }

    if (!totalTaxDec.equals(calculatedComponentSum)) {
      throw new ValidationError(
        `Tax calculation result component sum invariant failed: totalTaxAmount ('${taxCalculation.totalTaxAmount}') != sum(components) ('${calculatedComponentSum.toString()}').`
      );
    }

    // 3. Tax Account Mapping Pre-check for Non-Zero Tax Components (Section 26)
    if (taxCalculation.taxability === 'TAXABLE') {
      for (const comp of taxCalculation.components || []) {
        const compTaxDec = ExactDecimal.parse(comp.taxAmount, 2);
        if (compTaxDec.isPositive()) {
          const role = input.direction === 'OUTPUT' ? `OUTPUT_${comp.rateType}` : `INPUT_${comp.rateType}`;
          const mapping = await accountingConfigurationService.getMapping(ctx, input.companyId, input.eventType, role);
          if (!mapping || !mapping.isActive) {
            throw new AccountingError(
              `Tax account mapping missing for active lineRole '${role}' in company '${input.companyId}' and eventType '${input.eventType}'.`
            );
          }
        }
      }
    }

    // 4. Construct Accounting Event Lines based on Direction (INPUT vs OUTPUT)
    const lines: AccountingEventLineInput[] = [];
    let lineSeq = 1;

    if (input.direction === 'OUTPUT') {
      // Sales / Output Tax Event
      // Offset Line (Debit Customer / AR / Bank): totalAmount
      lines.push({
        lineSequence: lineSeq++,
        accountId: input.offsetAccountId,
        accountCode: input.offsetAccountCode,
        lineRole: input.offsetLineRole || 'AR_CONTROL',
        debitAmount: taxCalculation.totalAmount,
        creditAmount: '0.00',
        narration: input.narration || `Sales Invoice Output Tax - ${input.sourceDocumentId}`
      });

      // Base Line (Credit Revenue / Sales): taxableAmount
      lines.push({
        lineSequence: lineSeq++,
        accountId: input.baseAccountId,
        accountCode: input.baseAccountCode,
        lineRole: input.baseLineRole || 'SALES_REVENUE',
        debitAmount: '0.00',
        creditAmount: taxCalculation.taxableAmount,
        narration: input.narration || `Sales Revenue - ${input.sourceDocumentId}`
      });

      // Component Tax Lines (Credit Tax Output Accounts)
      if (taxCalculation.taxability === 'TAXABLE') {
        for (const comp of taxCalculation.components || []) {
          const compTaxDec = ExactDecimal.parse(comp.taxAmount, 2);
          if (compTaxDec.isPositive()) {
            const role = `OUTPUT_${comp.rateType}`;
            lines.push({
              lineSequence: lineSeq++,
              lineRole: role,
              debitAmount: '0.00',
              creditAmount: comp.taxAmount,
              narration: `GST Output ${comp.rateType} (${comp.ratePercent}%)`
            });
          }
        }
      }
    } else {
      // Purchase / Input Tax Event
      // Base Line (Debit Expense / Inventory): taxableAmount
      lines.push({
        lineSequence: lineSeq++,
        accountId: input.baseAccountId,
        accountCode: input.baseAccountCode,
        lineRole: input.baseLineRole || 'PURCHASE_EXPENSE',
        debitAmount: taxCalculation.taxableAmount,
        creditAmount: '0.00',
        narration: input.narration || `Purchase Expense - ${input.sourceDocumentId}`
      });

      // Component Tax Lines (Debit Tax Input Accounts)
      if (taxCalculation.taxability === 'TAXABLE') {
        for (const comp of taxCalculation.components || []) {
          const compTaxDec = ExactDecimal.parse(comp.taxAmount, 2);
          if (compTaxDec.isPositive()) {
            const role = `INPUT_${comp.rateType}`;
            lines.push({
              lineSequence: lineSeq++,
              lineRole: role,
              debitAmount: comp.taxAmount,
              creditAmount: '0.00',
              narration: `GST Input ${comp.rateType} (${comp.ratePercent}%)`
            });
          }
        }
      }

      // Offset Line (Credit Supplier / AP / Bank): totalAmount
      lines.push({
        lineSequence: lineSeq++,
        accountId: input.offsetAccountId,
        accountCode: input.offsetAccountCode,
        lineRole: input.offsetLineRole || 'AP_CONTROL',
        debitAmount: '0.00',
        creditAmount: taxCalculation.totalAmount,
        narration: input.narration || `Purchase Invoice Input Tax - ${input.sourceDocumentId}`
      });
    }

    // 5. Build Accounting Event & Submit to Authoritative Posting Engine
    const eventInput: AccountingEventInput = {
      companyId: input.companyId,
      eventType: input.eventType,
      accountingDate: input.accountingDate,
      sourceModule: input.sourceModule,
      sourceDocumentType: input.sourceDocumentType || null,
      sourceDocumentId: input.sourceDocumentId,
      narration: input.narration || null,
      idempotencyKey: input.idempotencyKey,
      simulateFailure: input.simulateFailure,
      lines
    };

    return this.processAccountingEvent(ctx, eventInput);
  }

  /**
   * Processes a business accounting event atomically through account resolution,
   * financial invariant verification, draft creation, and GL posting.
   */
  public async processAccountingEvent(ctx: RequestContext, eventInput: AccountingEventInput): Promise<JournalEntryDTO> {
    if (!ctx.tenantId || !eventInput.companyId) {
      throw new ValidationError('RequestContext tenantId and companyId are required.');
    }

    // Authorization Guard
    if (ctx.user) {
      const isAuthorized = ctx.user.permissions.some(p => p === '*' || p === 'finance:gl:create' || p === 'finance:gl:post' || p.startsWith('finance:gl:'));
      if (!isAuthorized) {
        authorizationService.authorize({ user: ctx.user, action: 'finance:gl:post', companyId: eventInput.companyId });
      }
    }

    // 1. Invariant Validation (Scale, XOR, Balance, Currency)
    AccountingInvariantValidator.validateEvent(ctx, eventInput);

    // Layer 1 Request Idempotency Check / Claim
    const idempotencyKey = eventInput.idempotencyKey;
    if (idempotencyKey && idempotencyKey.trim() !== '') {
      const claim = await idempotencyService.checkOrClaim(ctx, idempotencyKey, eventInput);
      if (claim.isDuplicate && claim.responseBody) {
        return claim.responseBody as JournalEntryDTO;
      }
    }

    try {
      // 2. Account Resolution & Eligibility Verification
      const resolvedLines = [];
      for (const line of eventInput.lines) {
        let resolvedAccountId = line.accountId;

        // Resolve via accountCode if accountId not provided
        if (!resolvedAccountId && line.accountCode) {
          const accounts = await chartOfAccountsService.getAccountsList(ctx, eventInput.companyId);
          const matched = accounts.find(a => a.accountCode === line.accountCode);
          if (matched) {
            resolvedAccountId = matched.id;
          }
        }

        // Resolve via lineRole if accountId still not provided
        if (!resolvedAccountId && line.lineRole) {
          const mapping = await accountingConfigurationService.getMapping(ctx, eventInput.companyId, eventInput.eventType, line.lineRole);
          if (mapping && mapping.isActive) {
            resolvedAccountId = mapping.accountId;
          } else {
            // Fallback resolution for standard lineRoles using postable COA accounts
            try {
              const accounts = await chartOfAccountsService.getAccountsList(ctx, eventInput.companyId);
              const postableAccounts = accounts.filter(a => a.isPostable && a.nodeType === 'ACCOUNT');
              if (line.lineRole === 'AP_CONTROL') {
                const acc = postableAccounts.find(a => a.isControlAccount && (a.controlAccountType === 'AP' || (a.controlAccountType as any) === 'PAYABLE')) || postableAccounts.find(a => a.accountCode === '2110');
                if (acc) resolvedAccountId = acc.id;
              } else if (line.lineRole === 'AR_CONTROL') {
                const acc = postableAccounts.find(a => a.isControlAccount && (a.controlAccountType === 'AR' || (a.controlAccountType as any) === 'RECEIVABLE')) || postableAccounts.find(a => a.accountCode === '1130');
                if (acc) resolvedAccountId = acc.id;
              } else if (line.lineRole === 'INPUT_CGST') {
                const acc = postableAccounts.find(a => a.accountCode === '1140') || postableAccounts.find(a => a.isControlAccount && a.controlAccountType === 'TAX_INPUT');
                if (acc) resolvedAccountId = acc.id;
              } else if (line.lineRole === 'INPUT_SGST') {
                const acc = postableAccounts.find(a => a.accountCode === '1141') || postableAccounts.find(a => a.isControlAccount && a.controlAccountType === 'TAX_INPUT');
                if (acc) resolvedAccountId = acc.id;
              } else if (line.lineRole === 'INPUT_IGST') {
                const acc = postableAccounts.find(a => a.accountCode === '1142') || postableAccounts.find(a => a.isControlAccount && a.controlAccountType === 'TAX_INPUT');
                if (acc) resolvedAccountId = acc.id;
              } else if (line.lineRole === 'INPUT_UTGST' || line.lineRole === 'INPUT_CESS') {
                const acc = postableAccounts.find(a => a.accountCode === '1140') || postableAccounts.find(a => a.isControlAccount && a.controlAccountType === 'TAX_INPUT');
                if (acc) resolvedAccountId = acc.id;
              } else if (line.lineRole === 'PURCHASE_EXPENSE') {
                const acc = postableAccounts.find(a => a.accountCode === '5110') || postableAccounts.find(a => a.accountType === 'EXPENSE');
                if (acc) resolvedAccountId = acc.id;
              } else if (line.lineRole === 'SALES_REVENUE') {
                const acc = postableAccounts.find(a => a.accountCode === '4100') || postableAccounts.find(a => a.accountType === 'INCOME');
                if (acc) resolvedAccountId = acc.id;
              }
            } catch {
              // Ignore fallback error
            }
          }
        }

        if (!resolvedAccountId) {
          throw new AccountingError(
            `Account resolution failed for line sequence ${line.lineSequence} (accountCode: '${line.accountCode || 'N/A'}', lineRole: '${line.lineRole || 'N/A'}').`
          );
        }

        // Assert Postable Account Invariant
        const eligibility = await chartOfAccountsService.assertAccountEligibilityForPosting(ctx, resolvedAccountId);
        if (!eligibility.isEligibleForPosting) {
          throw new BusinessRuleViolationError(
            eligibility.ineligibilityReason || `Account '${eligibility.accountCode}' is not eligible for posting.`
          );
        }

        resolvedLines.push({
          accountId: resolvedAccountId,
          lineSequence: line.lineSequence,
          debitAmount: line.debitAmount,
          creditAmount: line.creditAmount,
          currency: eventInput.currency || 'INR',
          exchangeRate: eventInput.exchangeRate || '1.000000',
          narration: line.narration || eventInput.narration || null,
          partyType: line.partyType || null,
          partyId: line.partyId || null,
          branchId: line.branchId || null,
          departmentId: line.departmentId || null
        });
      }

      // 3. Resolve & Assert Open Fiscal Period
      const acctDateObj = new Date(eventInput.accountingDate);
      const { fiscalYear, fiscalPeriod } = await fiscalPeriodService.resolvePeriod(ctx, eventInput.companyId, acctDateObj);
      await fiscalPeriodService.assertPeriodOpen(ctx, fiscalPeriod.id);

      // 4. Construct Draft Journal Input
      const draftInput: CreateDraftJournalInput = {
        companyId: eventInput.companyId,
        fiscalYearId: fiscalYear.id,
        fiscalPeriodId: fiscalPeriod.id,
        accountingDate: eventInput.accountingDate,
        sourceModule: eventInput.sourceModule,
        sourceDocumentType: eventInput.sourceDocumentType || null,
        sourceDocumentId: eventInput.sourceDocumentId,
        currency: eventInput.currency || 'INR',
        exchangeRate: eventInput.exchangeRate || '1.000000',
        narration: eventInput.narration || null,
        lines: resolvedLines
      };

      // 5. Create Draft Manual Journal
      const draft = await journalDraftService.createDraft(ctx, draftInput);

      // Simulated Failure Injection Verification
      if (eventInput.simulateFailure) {
        logger.error({ sourceDocumentId: eventInput.sourceDocumentId }, '[ACCOUNTING-CORE] Simulated transaction failure injected — triggering ROLLBACK');
        throw new AccountingError(`Simulated transaction failure during accounting event posting for document '${eventInput.sourceDocumentId}'.`);
      }

      // 6. Post Journal via Authoritative GLEngine Posting Pipeline
      const posted = await glEngine.postJournal(ctx, {
        journalEntryId: draft.id!
      });

      if (idempotencyKey && idempotencyKey.trim() !== '') {
        await idempotencyService.saveResult(ctx, idempotencyKey, eventInput, 200, posted);
      }

      logger.info({
        tenantId: ctx.tenantId,
        companyId: eventInput.companyId,
        journalId: posted.id,
        voucherNumber: posted.voucherNumber,
        sourceDocumentId: eventInput.sourceDocumentId,
        msg: '[ACCOUNTING-CORE] Accounting event processed and posted successfully'
      });

      await auditService.logEvent(ctx, {
        module: 'finance',
        entityName: 'AccountingEvent',
        entityId: eventInput.sourceDocumentId,
        action: 'POST',
        newValues: {
          eventType: eventInput.eventType,
          voucherNumber: posted.voucherNumber,
          totalDebit: posted.totalDebit,
          totalCredit: posted.totalCredit
        }
      });

      return posted;
    } catch (err) {
      if (idempotencyKey && idempotencyKey.trim() !== '') {
        idempotencyService.releaseClaim(ctx, idempotencyKey, err);
      }
      throw err;
    }
  }

  /**
   * Orchestrates an append-only reversal for an accounting event.
   */
  public async reverseAccountingEvent(ctx: RequestContext, input: ReverseAccountingEventInput): Promise<JournalEntryDTO> {
    if (!ctx.tenantId || !ctx.companyId) {
      throw new ValidationError('RequestContext tenantId and companyId are required.');
    }

    return glEngine.reverseJournal(ctx, input);
  }
}

export const accountingCoreService = new AccountingCoreService();
