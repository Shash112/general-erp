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
import { bankAccountService } from './bank-account.service.js';
import {
  BankingVoucherDTO,
  BankingVoucherLineDTO,
  CreatePaymentVoucherInput,
  CreateReceiptVoucherInput,
  CreateTransferVoucherInput,
  PostVoucherInput,
  ReverseVoucherInput,
  BankingVoucherFilterInput,
  BankingSourceType
} from './banking-model.js';
import { BankingValidator } from './banking-validator.js';
import type pg from 'pg';

export class BankingVoucherService {
  private vouchersStore = new Map<string, BankingVoucherDTO>();
  private dbPool?: pg.Pool | undefined;

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
    bankAccountService.setDbPool(pool);
  }

  public getDbPool(): pg.Pool | undefined {
    return this.dbPool;
  }

  public clear(): void {
    this.vouchersStore.clear();
    bankAccountService.clear();
  }

  private getKey(tenantId: string, id: string): string {
    return `${tenantId}:${id}`;
  }

  private authorize(ctx: RequestContext, action: string, companyId: string): void {
    if (ctx.user) {
      const isWildcard = ctx.user.permissions.some(p => p === '*' || p === action || p.startsWith('banking:voucher:') || p.startsWith('banking:transfer:'));
      if (!isWildcard) {
        authorizationService.authorize({ user: ctx.user, action, companyId });
      }
    }
  }

  /**
   * Helper to resolve Bank or Cash GL Account ID
   */
  private async resolveAccountGLId(
    ctx: RequestContext,
    companyId: string,
    bankAccountId?: string,
    cashAccountId?: string
  ): Promise<{ glAccountId: string; currency: string; isBank: boolean }> {
    if (bankAccountId) {
      const bnk = await bankAccountService.getBankAccount(ctx, bankAccountId);
      if (bnk.companyId !== companyId) {
        throw new BusinessRuleViolationError(`Bank account '${bankAccountId}' does not belong to company '${companyId}'.`);
      }
      if (bnk.status !== 'ACTIVE') {
        throw new BusinessRuleViolationError(`Bank account '${bankAccountId}' is INACTIVE.`);
      }
      return { glAccountId: bnk.glAccountId, currency: bnk.currency, isBank: true };
    } else if (cashAccountId) {
      const csh = await bankAccountService.getCashAccount(ctx, cashAccountId);
      if (csh.companyId !== companyId) {
        throw new BusinessRuleViolationError(`Cash account '${cashAccountId}' does not belong to company '${companyId}'.`);
      }
      if (csh.status !== 'ACTIVE') {
        throw new BusinessRuleViolationError(`Cash account '${cashAccountId}' is INACTIVE.`);
      }
      return { glAccountId: csh.glAccountId, currency: csh.currency, isBank: false };
    }
    throw new BusinessRuleViolationError('Neither bankAccountId nor cashAccountId was specified.');
  }

  // ==========================================
  // PAYMENT VOUCHER
  // ==========================================

  public async createDraftPayment(ctx: RequestContext, input: CreatePaymentVoucherInput): Promise<BankingVoucherDTO> {
    BankingValidator.validatePaymentVoucherInput(ctx, input);
    this.authorize(ctx, 'banking:voucher:create', input.companyId);

    const { currency } = await this.resolveAccountGLId(ctx, input.companyId, input.bankAccountId, input.cashAccountId);
    const amountDec = ExactDecimal.parse(input.amount, 2);

    const voucherId = `bnkvch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();

    const lines: BankingVoucherLineDTO[] = [];
    if (input.lines && input.lines.length > 0) {
      let seq = 1;
      for (const l of input.lines) {
        await BankingValidator.validateGLAccount(ctx, input.companyId, l.accountId);
        const debDec = ExactDecimal.parse(l.debitAmount, 2);
        const credDec = l.creditAmount ? ExactDecimal.parse(l.creditAmount, 2) : ExactDecimal.parse('0.00', 2);
        lines.push({
          id: `line_${seq}_${Math.random().toString(36).substring(2, 6)}`,
          tenantId: ctx.tenantId,
          companyId: input.companyId,
          voucherId,
          accountId: l.accountId,
          lineSequence: seq++,
          debitAmount: debDec.toString(),
          creditAmount: credDec.toString(),
          description: l.description || null
        });
      }
    }

    const voucher: BankingVoucherDTO = {
      id: voucherId,
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      branchId: input.branchId || null,
      voucherNumber: null,
      voucherType: 'PAYMENT',
      transactionDate: input.transactionDate,
      accountingDate: input.accountingDate || input.transactionDate,
      currency: input.currency || currency,
      amount: amountDec.toString(),
      sourceType: input.sourceType || 'MANUAL',
      sourceId: input.sourceId || null,
      bankAccountId: input.bankAccountId || null,
      cashAccountId: input.cashAccountId || null,
      counterAccountId: input.counterAccountId || null,
      beneficiaryName: input.beneficiaryName || null,
      narration: input.narration || null,
      status: 'DRAFT',
      journalEntryId: null,
      reversalAccountingDate: null,
      reversedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      lines
    };

    this.vouchersStore.set(this.getKey(ctx.tenantId, voucherId), voucher);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'BankingVoucher',
      entityId: voucherId,
      action: 'CREATE',
      newValues: { voucherType: 'PAYMENT', amount: voucher.amount, status: voucher.status }
    });

    logger.info({ tenantId: ctx.tenantId, companyId: input.companyId, voucherId }, '[BANKING] Created Draft Payment Voucher');
    return voucher;
  }

  // ==========================================
  // RECEIPT VOUCHER
  // ==========================================

  public async createDraftReceipt(ctx: RequestContext, input: CreateReceiptVoucherInput): Promise<BankingVoucherDTO> {
    BankingValidator.validateReceiptVoucherInput(ctx, input);
    this.authorize(ctx, 'banking:voucher:create', input.companyId);

    const { currency } = await this.resolveAccountGLId(ctx, input.companyId, input.bankAccountId, input.cashAccountId);
    const amountDec = ExactDecimal.parse(input.amount, 2);

    const voucherId = `bnkvch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();

    const lines: BankingVoucherLineDTO[] = [];
    if (input.lines && input.lines.length > 0) {
      let seq = 1;
      for (const l of input.lines) {
        await BankingValidator.validateGLAccount(ctx, input.companyId, l.accountId);
        const debDec = l.debitAmount ? ExactDecimal.parse(l.debitAmount, 2) : ExactDecimal.parse('0.00', 2);
        const credDec = ExactDecimal.parse(l.creditAmount, 2);
        lines.push({
          id: `line_${seq}_${Math.random().toString(36).substring(2, 6)}`,
          tenantId: ctx.tenantId,
          companyId: input.companyId,
          voucherId,
          accountId: l.accountId,
          lineSequence: seq++,
          debitAmount: debDec.toString(),
          creditAmount: credDec.toString(),
          description: l.description || null
        });
      }
    }

    const voucher: BankingVoucherDTO = {
      id: voucherId,
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      branchId: input.branchId || null,
      voucherNumber: null,
      voucherType: 'RECEIPT',
      transactionDate: input.transactionDate,
      accountingDate: input.accountingDate || input.transactionDate,
      currency: input.currency || currency,
      amount: amountDec.toString(),
      sourceType: input.sourceType || 'MANUAL',
      sourceId: input.sourceId || null,
      bankAccountId: input.bankAccountId || null,
      cashAccountId: input.cashAccountId || null,
      counterAccountId: input.counterAccountId || null,
      beneficiaryName: input.beneficiaryName || null,
      narration: input.narration || null,
      status: 'DRAFT',
      journalEntryId: null,
      reversalAccountingDate: null,
      reversedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      lines
    };

    this.vouchersStore.set(this.getKey(ctx.tenantId, voucherId), voucher);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'BankingVoucher',
      entityId: voucherId,
      action: 'CREATE',
      newValues: { voucherType: 'RECEIPT', amount: voucher.amount, status: voucher.status }
    });

    logger.info({ tenantId: ctx.tenantId, companyId: input.companyId, voucherId }, '[BANKING] Created Draft Receipt Voucher');
    return voucher;
  }

  // ==========================================
  // TRANSFER / CONTRA VOUCHER
  // ==========================================

  public async createDraftTransfer(ctx: RequestContext, input: CreateTransferVoucherInput): Promise<BankingVoucherDTO> {
    BankingValidator.validateTransferVoucherInput(ctx, input);
    this.authorize(ctx, 'banking:transfer:create', input.companyId);

    const src = await this.resolveAccountGLId(ctx, input.companyId, input.sourceBankAccountId, input.sourceCashAccountId);
    const dst = await this.resolveAccountGLId(ctx, input.companyId, input.destinationBankAccountId, input.destinationCashAccountId);

    if (src.currency !== dst.currency) {
      throw new BusinessRuleViolationError(`Transfer currency mismatch between source ('${src.currency}') and destination ('${dst.currency}').`);
    }

    const amountDec = ExactDecimal.parse(input.amount, 2);
    const voucherId = `bnkvch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();

    const voucher: BankingVoucherDTO = {
      id: voucherId,
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      branchId: input.branchId || null,
      voucherNumber: null,
      voucherType: 'TRANSFER',
      transactionDate: input.transactionDate,
      accountingDate: input.accountingDate || input.transactionDate,
      currency: input.currency || src.currency,
      amount: amountDec.toString(),
      sourceType: 'TRANSFER',
      sourceId: null,
      bankAccountId: input.sourceBankAccountId || null,
      cashAccountId: input.sourceCashAccountId || null,
      counterAccountId: dst.glAccountId,
      beneficiaryName: null,
      narration: input.narration || 'Internal Bank/Cash Transfer',
      status: 'DRAFT',
      journalEntryId: null,
      reversalAccountingDate: null,
      reversedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      lines: []
    };

    this.vouchersStore.set(this.getKey(ctx.tenantId, voucherId), voucher);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'BankingVoucher',
      entityId: voucherId,
      action: 'CREATE',
      newValues: { voucherType: 'TRANSFER', amount: voucher.amount, status: voucher.status }
    });

    logger.info({ tenantId: ctx.tenantId, companyId: input.companyId, voucherId }, '[BANKING] Created Draft Transfer Voucher');
    return voucher;
  }

  // ==========================================
  // READ & LIST VOUCHERS
  // ==========================================

  public async getVoucher(ctx: RequestContext, id: string): Promise<BankingVoucherDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const voucher = this.vouchersStore.get(key);
    if (!voucher) {
      throw new NotFoundError('BankingVoucher', id);
    }
    this.authorize(ctx, 'banking:voucher:read', voucher.companyId);
    return voucher;
  }

  public async listVouchers(
    ctx: RequestContext,
    companyId: string,
    filters?: BankingVoucherFilterInput
  ): Promise<BankingVoucherDTO[]> {
    this.authorize(ctx, 'banking:voucher:read', companyId);
    const result: BankingVoucherDTO[] = [];
    for (const v of this.vouchersStore.values()) {
      if (v.tenantId === ctx.tenantId && v.companyId === companyId) {
        if (filters?.status && v.status !== filters.status) continue;
        if (filters?.voucherType && v.voucherType !== filters.voucherType) continue;
        if (filters?.sourceType && v.sourceType !== filters.sourceType) continue;
        if (filters?.bankAccountId && v.bankAccountId !== filters.bankAccountId) continue;
        if (filters?.cashAccountId && v.cashAccountId !== filters.cashAccountId) continue;
        if (filters?.fromDate && v.accountingDate < filters.fromDate) continue;
        if (filters?.toDate && v.accountingDate > filters.toDate) continue;
        result.push(v);
      }
    }
    return result;
  }

  // ==========================================
  // POST VOUCHER
  // ==========================================

  public async postVoucher(ctx: RequestContext, id: string, postInput?: PostVoucherInput): Promise<BankingVoucherDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.vouchersStore.get(key);
    if (!existing) {
      throw new NotFoundError('BankingVoucher', id);
    }

    const action = existing.voucherType === 'TRANSFER' ? 'banking:transfer:post' : 'banking:voucher:post';
    this.authorize(ctx, action, existing.companyId);

    // Idempotent re-post handling
    if (existing.status === 'POSTED') {
      logger.info({ tenantId: ctx.tenantId, voucherId: id }, '[BANKING] Voucher is already POSTED — returning idempotent result');
      return existing;
    }

    if (existing.status === 'REVERSED' || existing.status === 'CANCELLED') {
      throw new BusinessRuleViolationError(`Cannot post banking voucher '${id}'. Current status is '${existing.status}'.`);
    }

    // 1. Fiscal Period Validation
    const acctDateObj = new Date(existing.accountingDate);
    const { fiscalYear, fiscalPeriod } = await fiscalPeriodService.resolvePeriod(ctx, existing.companyId, acctDateObj);
    await fiscalPeriodService.assertPeriodOpen(ctx, fiscalPeriod.id);

    // 2. Simulated Transaction Failure Injection Check
    if (postInput?.simulateFailure) {
      logger.error({ voucherId: id }, '[BANKING] Simulated transaction failure injected — triggering ROLLBACK');
      throw new AccountingError(`Simulated transaction failure during banking voucher posting for voucher '${id}'.`);
    }

    // 3. Generate Sequence Voucher Number
    let prefix = 'PV';
    let documentType = 'PAYMENT_VOUCHER';
    if (existing.voucherType === 'RECEIPT') {
      prefix = 'RV';
      documentType = 'RECEIPT_VOUCHER';
    } else if (existing.voucherType === 'TRANSFER') {
      prefix = 'VT';
      documentType = 'TRANSFER_VOUCHER';
    }

    let voucherNum = existing.voucherNumber;
    if (!voucherNum || voucherNum.trim() === '') {
      numberingEngine.configureSequence(ctx.tenantId, existing.companyId, {
        documentType,
        prefix,
        fiscalYear: fiscalYear.name,
        branchCode: 'HQ',
        currentSequence: 0,
        paddingDigits: 4,
        resetOnFiscalYear: true
      });
      voucherNum = numberingEngine.generateNextNumber(ctx.tenantId, existing.companyId, documentType, fiscalYear.name, 'HQ');
    }

    let journalEntryId: string;

    // 4. AP / AR Integration Check (No Double-Posting Invariant)
    if ((existing.sourceType === 'AP' || existing.sourceType === 'AR') && existing.journalEntryId) {
      // Re-use already posted AP/AR GL journal entry ID to avoid duplicate posting!
      journalEntryId = existing.journalEntryId!;
    } else {
      // Construct GL lines and post via AccountingCore
      const primaryGL = await this.resolveAccountGLId(ctx, existing.companyId, existing.bankAccountId || undefined, existing.cashAccountId || undefined);

      const accountingLines: AccountingEventLineInput[] = [];

      if (existing.voucherType === 'PAYMENT') {
        // Debit: Counter account or split lines
        if (existing.counterAccountId) {
          accountingLines.push({
            lineSequence: 1,
            accountId: existing.counterAccountId,
            debitAmount: existing.amount,
            creditAmount: '0.00',
            narration: existing.narration || `Payment Voucher - ${voucherNum}`
          });
        } else if (existing.lines && existing.lines.length > 0) {
          for (const l of existing.lines) {
            accountingLines.push({
              lineSequence: l.lineSequence,
              accountId: l.accountId,
              debitAmount: l.debitAmount,
              creditAmount: l.creditAmount,
              narration: l.description || existing.narration || `Payment Voucher Line - ${voucherNum}`
            });
          }
        }
        // Credit: Primary Bank / Cash GL Account
        accountingLines.push({
          lineSequence: accountingLines.length + 1,
          accountId: primaryGL.glAccountId,
          lineRole: 'CASH_BANK',
          debitAmount: '0.00',
          creditAmount: existing.amount,
          narration: existing.narration || `Payment Voucher Bank/Cash Credit - ${voucherNum}`
        });

      } else if (existing.voucherType === 'RECEIPT') {
        // Debit: Primary Bank / Cash GL Account
        accountingLines.push({
          lineSequence: 1,
          accountId: primaryGL.glAccountId,
          lineRole: 'CASH_BANK',
          debitAmount: existing.amount,
          creditAmount: '0.00',
          narration: existing.narration || `Receipt Voucher Bank/Cash Debit - ${voucherNum}`
        });
        // Credit: Counter account or split lines
        if (existing.counterAccountId) {
          accountingLines.push({
            lineSequence: 2,
            accountId: existing.counterAccountId,
            debitAmount: '0.00',
            creditAmount: existing.amount,
            narration: existing.narration || `Receipt Voucher - ${voucherNum}`
          });
        } else if (existing.lines && existing.lines.length > 0) {
          for (const l of existing.lines) {
            accountingLines.push({
              lineSequence: accountingLines.length + 1,
              accountId: l.accountId,
              debitAmount: l.debitAmount,
              creditAmount: l.creditAmount,
              narration: l.description || existing.narration || `Receipt Voucher Line - ${voucherNum}`
            });
          }
        }

      } else if (existing.voucherType === 'TRANSFER') {
        // Contra Transfer:
        // Line 1: Debit Destination Bank/Cash GL Account
        accountingLines.push({
          lineSequence: 1,
          accountId: existing.counterAccountId!,
          lineRole: 'CASH_BANK',
          debitAmount: existing.amount,
          creditAmount: '0.00',
          narration: existing.narration || `Transfer Destination Debit - ${voucherNum}`
        });
        // Line 2: Credit Source Bank/Cash GL Account
        accountingLines.push({
          lineSequence: 2,
          accountId: primaryGL.glAccountId,
          lineRole: 'CASH_BANK',
          debitAmount: '0.00',
          creditAmount: existing.amount,
          narration: existing.narration || `Transfer Source Credit - ${voucherNum}`
        });
      }

      const eventTypeMap: Record<string, string> = {
        PAYMENT: primaryGL.isBank ? 'BANK_PAYMENT' : 'CASH_PAYMENT',
        RECEIPT: primaryGL.isBank ? 'BANK_RECEIPT' : 'CASH_RECEIPT',
        TRANSFER: primaryGL.isBank ? 'BANK_TRANSFER' : 'CASH_TRANSFER'
      };

      const acctEventInput: AccountingEventInput = {
        companyId: existing.companyId,
        eventType: eventTypeMap[existing.voucherType] || 'BANK_PAYMENT',
        accountingDate: existing.accountingDate,
        sourceModule: 'BANKING',
        sourceDocumentType: existing.voucherType,
        sourceDocumentId: existing.id,
        narration: existing.narration || `Banking Voucher - ${voucherNum}`,
        lines: accountingLines,
        ...(postInput?.idempotencyKey ? { idempotencyKey: postInput.idempotencyKey } : {}),
        ...(postInput?.simulateFailure !== undefined ? { simulateFailure: postInput.simulateFailure } : {})
      };

      const postedJournal = await accountingCoreService.processAccountingEvent(ctx, acctEventInput);
      journalEntryId = postedJournal.id || '';
    }

    const now = new Date();
    const postedDTO: BankingVoucherDTO = {
      ...existing,
      voucherNumber: voucherNum,
      status: 'POSTED',
      journalEntryId,
      version: existing.version + 1,
      updatedAt: now
    };

    this.vouchersStore.set(key, postedDTO);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'BankingVoucher',
      entityId: id,
      action: 'POST',
      newValues: {
        voucherNumber: voucherNum,
        journalEntryId,
        amount: postedDTO.amount,
        status: 'POSTED'
      }
    });

    logger.info({ tenantId: ctx.tenantId, companyId: existing.companyId, voucherId: id, voucherNum, journalId: journalEntryId }, '[BANKING] Voucher posted successfully');
    return postedDTO;
  }

  // ==========================================
  // REVERSE VOUCHER
  // ==========================================

  public async reverseVoucher(ctx: RequestContext, id: string, input: ReverseVoucherInput): Promise<BankingVoucherDTO> {
    if (!input.reason || input.reason.trim() === '') {
      throw new BusinessRuleViolationError('Reversal reason is required.');
    }

    const key = this.getKey(ctx.tenantId, id);
    const existing = this.vouchersStore.get(key);
    if (!existing) {
      throw new NotFoundError('BankingVoucher', id);
    }

    const action = existing.voucherType === 'TRANSFER' ? 'banking:transfer:reverse' : 'banking:voucher:reverse';
    this.authorize(ctx, action, existing.companyId);

    if (existing.status !== 'POSTED') {
      throw new BusinessRuleViolationError(`Cannot reverse banking voucher '${id}'. Only POSTED vouchers may be reversed.`);
    }

    if (!existing.journalEntryId) {
      throw new BusinessRuleViolationError(`Cannot reverse banking voucher '${id}'. Missing posted GL journal entry link.`);
    }

    const revAcctDate = input.reversalAccountingDate || existing.accountingDate;

    // Orchestrate append-only compensating GL reversal via AccountingCore
    await accountingCoreService.reverseAccountingEvent(ctx, {
      originalJournalId: existing.journalEntryId,
      reason: input.reason,
      reversalAccountingDate: revAcctDate
    });

    const now = new Date();
    const reversedDTO: BankingVoucherDTO = {
      ...existing,
      status: 'REVERSED',
      reversalAccountingDate: revAcctDate,
      reversedAt: now,
      version: existing.version + 1,
      updatedAt: now
    };

    this.vouchersStore.set(key, reversedDTO);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'BankingVoucher',
      entityId: id,
      action: 'REVERSE',
      reason: input.reason,
      newValues: { status: 'REVERSED', reversalAccountingDate: revAcctDate }
    });

    logger.info({ tenantId: ctx.tenantId, companyId: existing.companyId, voucherId: id }, '[BANKING] Voucher reversed successfully');
    return reversedDTO;
  }

  // ==========================================
  // CANCEL DRAFT VOUCHER
  // ==========================================

  public async cancelDraft(ctx: RequestContext, id: string): Promise<BankingVoucherDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.vouchersStore.get(key);
    if (!existing) {
      throw new NotFoundError('BankingVoucher', id);
    }

    this.authorize(ctx, 'banking:voucher:cancel', existing.companyId);

    if (existing.status !== 'DRAFT') {
      throw new BusinessRuleViolationError(`Cannot cancel banking voucher '${id}'. Only DRAFT vouchers may be cancelled.`);
    }

    const now = new Date();
    const cancelledDTO: BankingVoucherDTO = {
      ...existing,
      status: 'CANCELLED',
      version: existing.version + 1,
      updatedAt: now
    };

    this.vouchersStore.set(key, cancelledDTO);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'BankingVoucher',
      entityId: id,
      action: 'CANCEL',
      newValues: { status: 'CANCELLED' }
    });

    return cancelledDTO;
  }

  // ==========================================
  // LINKED SUBLEDGER VOUCHER (AP / AR INTEGRATION)
  // ==========================================

  /**
   * Links an AP payment or AR receipt to the banking voucher layer without double-posting to GL.
   */
  public async linkSubledgerVoucher(
    ctx: RequestContext,
    sourceType: BankingSourceType,
    sourceId: string,
    companyId: string,
    journalEntryId: string,
    amount: string,
    bankAccountId?: string | null,
    narration?: string | null
  ): Promise<BankingVoucherDTO> {
    const voucherId = `bnk_sub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();

    const voucher: BankingVoucherDTO = {
      id: voucherId,
      tenantId: ctx.tenantId,
      companyId,
      branchId: null,
      voucherNumber: `SLV-${sourceType}-${sourceId.substring(0, 8)}`,
      voucherType: sourceType === 'AP' ? 'PAYMENT' : 'RECEIPT',
      transactionDate: now.toISOString().substring(0, 10),
      accountingDate: now.toISOString().substring(0, 10),
      currency: 'INR',
      amount,
      sourceType,
      sourceId,
      bankAccountId: bankAccountId || null,
      cashAccountId: null,
      counterAccountId: null,
      beneficiaryName: null,
      narration: narration || `Subledger ${sourceType} Transaction Link`,
      status: 'POSTED',
      journalEntryId,
      reversalAccountingDate: null,
      reversedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      lines: []
    };

    this.vouchersStore.set(this.getKey(ctx.tenantId, voucherId), voucher);
    return voucher;
  }
}

export const bankingVoucherService = new BankingVoucherService();
