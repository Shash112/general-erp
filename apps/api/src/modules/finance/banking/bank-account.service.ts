import {
  RequestContext,
  NotFoundError,
  ExactDecimal
} from '@general-erp/core';
import { logger } from '../../../config/logger.js';
import { authorizationService } from '../../../platform/authorization/authorization.service.js';
import { auditService } from '../../../platform/audit/audit.service.js';
import { journalDraftService } from '../journal-draft.service.js';
import { JournalEntryDTO, JournalLineDTO } from '../journal-model.js';
import {
  BankAccountDTO,
  CashAccountDTO,
  CreateBankAccountInput,
  UpdateBankAccountInput,
  CreateCashAccountInput,
  UpdateCashAccountInput,
  BankAccountFilterInput,
  CashAccountFilterInput,
  AccountBalanceDTO,
  TransactionHistoryItemDTO
} from './banking-model.js';
import { BankingValidator } from './banking-validator.js';
import type pg from 'pg';

export class BankAccountService {
  private bankAccountsStore = new Map<string, BankAccountDTO>();
  private cashAccountsStore = new Map<string, CashAccountDTO>();
  private dbPool?: pg.Pool | undefined;

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
  }

  public getDbPool(): pg.Pool | undefined {
    return this.dbPool;
  }

  public clear(): void {
    this.bankAccountsStore.clear();
    this.cashAccountsStore.clear();
  }

  private getKey(tenantId: string, id: string): string {
    return `${tenantId}:${id}`;
  }

  private authorize(ctx: RequestContext, action: string, companyId: string): void {
    if (ctx.user) {
      const isWildcard = ctx.user.permissions.some(p => p === '*' || p === action || p.startsWith('banking:account:'));
      if (!isWildcard) {
        authorizationService.authorize({ user: ctx.user, action, companyId });
      }
    }
  }

  // ==========================================
  // BANK ACCOUNTS MASTER
  // ==========================================

  public async createBankAccount(ctx: RequestContext, input: CreateBankAccountInput): Promise<BankAccountDTO> {
    BankingValidator.validateCreateBankAccount(ctx, input);
    this.authorize(ctx, 'banking:account:create', input.companyId);
    await BankingValidator.validateGLAccount(ctx, input.companyId, input.glAccountId);

    const id = `bnk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();
    const currency = input.currency || 'INR';
    const maskedNumber = BankingValidator.maskAccountNumber(input.accountNumber);

    let openingBal: string | null = null;
    if (input.openingBalance) {
      openingBal = ExactDecimal.parse(input.openingBalance, 2).toString();
    }

    const bankAccount: BankAccountDTO = {
      id,
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      branchId: input.branchId || null,
      accountName: input.accountName.trim(),
      bankName: input.bankName.trim(),
      accountNumberMasked: maskedNumber,
      accountType: input.accountType,
      currency,
      glAccountId: input.glAccountId,
      status: 'ACTIVE',
      openingBalance: openingBal,
      version: 1,
      createdAt: now,
      updatedAt: now
    };

    this.bankAccountsStore.set(this.getKey(ctx.tenantId, id), bankAccount);

    if (this.dbPool) {
      await this.dbPool.query(
        `INSERT INTO bank_accounts (
          id, tenant_id, company_id, branch_id, account_name, bank_name,
          account_number_masked, account_type, currency, gl_account_id,
          status, opening_balance, version, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())`,
        [
          bankAccount.id, bankAccount.tenantId, bankAccount.companyId, bankAccount.branchId,
          bankAccount.accountName, bankAccount.bankName, bankAccount.accountNumberMasked,
          bankAccount.accountType, bankAccount.currency, bankAccount.glAccountId,
          bankAccount.status, bankAccount.openingBalance, bankAccount.version
        ]
      );
    }

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'BankAccount',
      entityId: id,
      action: 'CREATE',
      newValues: {
        accountName: bankAccount.accountName,
        bankName: bankAccount.bankName,
        accountNumberMasked: bankAccount.accountNumberMasked,
        glAccountId: bankAccount.glAccountId
      }
    });

    logger.info({ tenantId: ctx.tenantId, companyId: input.companyId, bankAccountId: id }, '[BANKING] Created Bank Account');
    return bankAccount;
  }

  public async updateBankAccount(ctx: RequestContext, id: string, input: UpdateBankAccountInput): Promise<BankAccountDTO> {
    BankingValidator.validateNoCredentials(input);
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.bankAccountsStore.get(key);
    if (!existing) {
      throw new NotFoundError('BankAccount', id);
    }

    this.authorize(ctx, 'banking:account:update', existing.companyId);

    if (input.glAccountId && input.glAccountId !== existing.glAccountId) {
      await BankingValidator.validateGLAccount(ctx, existing.companyId, input.glAccountId);
    }

    const now = new Date();
    const updated: BankAccountDTO = {
      ...existing,
      accountName: input.accountName !== undefined ? input.accountName.trim() : existing.accountName,
      bankName: input.bankName !== undefined ? input.bankName.trim() : existing.bankName,
      accountNumberMasked: input.accountNumber !== undefined ? BankingValidator.maskAccountNumber(input.accountNumber) : existing.accountNumberMasked,
      accountType: input.accountType !== undefined ? input.accountType : existing.accountType,
      glAccountId: input.glAccountId !== undefined ? input.glAccountId : existing.glAccountId,
      branchId: input.branchId !== undefined ? input.branchId : existing.branchId,
      version: existing.version + 1,
      updatedAt: now
    };

    this.bankAccountsStore.set(key, updated);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'BankAccount',
      entityId: id,
      action: 'UPDATE',
      newValues: { accountName: updated.accountName, glAccountId: updated.glAccountId, version: updated.version }
    });

    return updated;
  }

  public async getBankAccount(ctx: RequestContext, id: string): Promise<BankAccountDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const account = this.bankAccountsStore.get(key);
    if (!account) {
      throw new NotFoundError('BankAccount', id);
    }
    this.authorize(ctx, 'banking:account:read', account.companyId);
    return account;
  }

  public async listBankAccounts(ctx: RequestContext, companyId: string, filters?: BankAccountFilterInput): Promise<BankAccountDTO[]> {
    this.authorize(ctx, 'banking:account:read', companyId);
    const result: BankAccountDTO[] = [];
    for (const acc of this.bankAccountsStore.values()) {
      if (acc.tenantId === ctx.tenantId && acc.companyId === companyId) {
        if (filters?.status && acc.status !== filters.status) continue;
        if (filters?.accountType && acc.accountType !== filters.accountType) continue;
        if (filters?.currency && acc.currency !== filters.currency) continue;
        result.push(acc);
      }
    }
    return result;
  }

  public async activateBankAccount(ctx: RequestContext, id: string): Promise<BankAccountDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.bankAccountsStore.get(key);
    if (!existing) {
      throw new NotFoundError('BankAccount', id);
    }
    this.authorize(ctx, 'banking:account:activate', existing.companyId);

    const updated: BankAccountDTO = {
      ...existing,
      status: 'ACTIVE',
      version: existing.version + 1,
      updatedAt: new Date()
    };
    this.bankAccountsStore.set(key, updated);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'BankAccount',
      entityId: id,
      action: 'ACTIVATE',
      newValues: { status: 'ACTIVE' }
    });

    return updated;
  }

  public async deactivateBankAccount(ctx: RequestContext, id: string): Promise<BankAccountDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.bankAccountsStore.get(key);
    if (!existing) {
      throw new NotFoundError('BankAccount', id);
    }
    this.authorize(ctx, 'banking:account:deactivate', existing.companyId);

    const updated: BankAccountDTO = {
      ...existing,
      status: 'INACTIVE',
      version: existing.version + 1,
      updatedAt: new Date()
    };
    this.bankAccountsStore.set(key, updated);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'BankAccount',
      entityId: id,
      action: 'DEACTIVATE',
      newValues: { status: 'INACTIVE' }
    });

    return updated;
  }

  // ==========================================
  // CASH ACCOUNTS MASTER
  // ==========================================

  public async createCashAccount(ctx: RequestContext, input: CreateCashAccountInput): Promise<CashAccountDTO> {
    BankingValidator.validateCreateCashAccount(ctx, input);
    this.authorize(ctx, 'banking:account:create', input.companyId);
    await BankingValidator.validateGLAccount(ctx, input.companyId, input.glAccountId);

    const id = `csh_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();
    const currency = input.currency || 'INR';

    const cashAccount: CashAccountDTO = {
      id,
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      branchId: input.branchId || null,
      accountName: input.accountName.trim(),
      currency,
      glAccountId: input.glAccountId,
      status: 'ACTIVE',
      version: 1,
      createdAt: now,
      updatedAt: now
    };

    this.cashAccountsStore.set(this.getKey(ctx.tenantId, id), cashAccount);

    if (this.dbPool) {
      await this.dbPool.query(
        `INSERT INTO cash_accounts (
          id, tenant_id, company_id, branch_id, account_name, currency,
          gl_account_id, status, version, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
        [
          cashAccount.id, cashAccount.tenantId, cashAccount.companyId, cashAccount.branchId,
          cashAccount.accountName, cashAccount.currency, cashAccount.glAccountId,
          cashAccount.status, cashAccount.version
        ]
      );
    }

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'CashAccount',
      entityId: id,
      action: 'CREATE',
      newValues: { accountName: cashAccount.accountName, glAccountId: cashAccount.glAccountId }
    });

    logger.info({ tenantId: ctx.tenantId, companyId: input.companyId, cashAccountId: id }, '[BANKING] Created Cash Account');
    return cashAccount;
  }

  public async updateCashAccount(ctx: RequestContext, id: string, input: UpdateCashAccountInput): Promise<CashAccountDTO> {
    BankingValidator.validateNoCredentials(input);
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.cashAccountsStore.get(key);
    if (!existing) {
      throw new NotFoundError('CashAccount', id);
    }

    this.authorize(ctx, 'banking:account:update', existing.companyId);

    if (input.glAccountId && input.glAccountId !== existing.glAccountId) {
      await BankingValidator.validateGLAccount(ctx, existing.companyId, input.glAccountId);
    }

    const now = new Date();
    const updated: CashAccountDTO = {
      ...existing,
      accountName: input.accountName !== undefined ? input.accountName.trim() : existing.accountName,
      glAccountId: input.glAccountId !== undefined ? input.glAccountId : existing.glAccountId,
      branchId: input.branchId !== undefined ? input.branchId : existing.branchId,
      version: existing.version + 1,
      updatedAt: now
    };

    this.cashAccountsStore.set(key, updated);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'CashAccount',
      entityId: id,
      action: 'UPDATE',
      newValues: { accountName: updated.accountName, glAccountId: updated.glAccountId, version: updated.version }
    });

    return updated;
  }

  public async getCashAccount(ctx: RequestContext, id: string): Promise<CashAccountDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const account = this.cashAccountsStore.get(key);
    if (!account) {
      throw new NotFoundError('CashAccount', id);
    }
    this.authorize(ctx, 'banking:account:read', account.companyId);
    return account;
  }

  public async listCashAccounts(ctx: RequestContext, companyId: string, filters?: CashAccountFilterInput): Promise<CashAccountDTO[]> {
    this.authorize(ctx, 'banking:account:read', companyId);
    const result: CashAccountDTO[] = [];
    for (const acc of this.cashAccountsStore.values()) {
      if (acc.tenantId === ctx.tenantId && acc.companyId === companyId) {
        if (filters?.status && acc.status !== filters.status) continue;
        if (filters?.currency && acc.currency !== filters.currency) continue;
        result.push(acc);
      }
    }
    return result;
  }

  public async activateCashAccount(ctx: RequestContext, id: string): Promise<CashAccountDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.cashAccountsStore.get(key);
    if (!existing) {
      throw new NotFoundError('CashAccount', id);
    }
    this.authorize(ctx, 'banking:account:activate', existing.companyId);

    const updated: CashAccountDTO = {
      ...existing,
      status: 'ACTIVE',
      version: existing.version + 1,
      updatedAt: new Date()
    };
    this.cashAccountsStore.set(key, updated);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'CashAccount',
      entityId: id,
      action: 'ACTIVATE',
      newValues: { status: 'ACTIVE' }
    });

    return updated;
  }

  public async deactivateCashAccount(ctx: RequestContext, id: string): Promise<CashAccountDTO> {
    const key = this.getKey(ctx.tenantId, id);
    const existing = this.cashAccountsStore.get(key);
    if (!existing) {
      throw new NotFoundError('CashAccount', id);
    }
    this.authorize(ctx, 'banking:account:deactivate', existing.companyId);

    const updated: CashAccountDTO = {
      ...existing,
      status: 'INACTIVE',
      version: existing.version + 1,
      updatedAt: new Date()
    };
    this.cashAccountsStore.set(key, updated);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'CashAccount',
      entityId: id,
      action: 'DEACTIVATE',
      newValues: { status: 'INACTIVE' }
    });

    return updated;
  }

  // ==========================================
  // GL-DERIVED BALANCE & TRANSACTION HISTORY
  // ==========================================

  public async getAccountBalance(ctx: RequestContext, accountId: string, asOfDate?: string): Promise<AccountBalanceDTO> {
    let glAccountId: string;
    let currency: string;
    let companyId: string;

    const bankAcc = this.bankAccountsStore.get(this.getKey(ctx.tenantId, accountId));
    if (bankAcc) {
      glAccountId = bankAcc.glAccountId;
      currency = bankAcc.currency;
      companyId = bankAcc.companyId;
    } else {
      const cashAcc = this.cashAccountsStore.get(this.getKey(ctx.tenantId, accountId));
      if (cashAcc) {
        glAccountId = cashAcc.glAccountId;
        currency = cashAcc.currency;
        companyId = cashAcc.companyId;
      } else {
        throw new NotFoundError('BankAccount / CashAccount', accountId);
      }
    }

    this.authorize(ctx, 'banking:account:read', companyId);

    if (asOfDate) {
      BankingValidator.validateDateString(asOfDate, 'asOfDate');
    }

    let totalDebitsDec = ExactDecimal.parse('0.00', 2);
    let totalCreditsDec = ExactDecimal.parse('0.00', 2);

    if (this.dbPool) {
      let query = `
        SELECT jl.debit_amount, jl.credit_amount
        FROM journal_lines jl
        JOIN journal_entries je ON jl.journal_entry_id = je.id
        WHERE jl.tenant_id = $1 AND jl.company_id = $2 AND jl.account_id = $3
          AND je.status = 'POSTED'
      `;
      const params: any[] = [ctx.tenantId, companyId, glAccountId];
      if (asOfDate) {
        query += ` AND je.accounting_date <= $4`;
        params.push(asOfDate);
      }

      const res = await this.dbPool.query(query, params);
      for (const r of res.rows) {
        totalDebitsDec = totalDebitsDec.add(ExactDecimal.parse(String(r.debit_amount), 2));
        totalCreditsDec = totalCreditsDec.add(ExactDecimal.parse(String(r.credit_amount), 2));
      }
    } else {
      // In-memory store calculation
      const store = (journalDraftService as any).journalsStore as Map<string, JournalEntryDTO> | undefined;
      const linesStore = (journalDraftService as any).linesStore as Map<string, JournalLineDTO[]> | undefined;

      if (store) {
        for (const [storeKey, journal] of store.entries()) {
          if (
            journal.tenantId === ctx.tenantId &&
            journal.companyId === companyId &&
            journal.status === 'POSTED'
          ) {
            if (asOfDate && journal.accountingDate > asOfDate) continue;

            const lines = linesStore?.get(storeKey) || journal.lines || [];
            for (const l of lines) {
              if (l.accountId === glAccountId) {
                totalDebitsDec = totalDebitsDec.add(ExactDecimal.parse(l.debitAmount, 2));
                totalCreditsDec = totalCreditsDec.add(ExactDecimal.parse(l.creditAmount, 2));
              }
            }
          }
        }
      }
    }

    // Asset Net Balance = Total Debits - Total Credits
    const netBalanceDec = totalDebitsDec.sub(totalCreditsDec);

    return {
      accountId,
      glAccountId,
      currency,
      balance: netBalanceDec.toString(),
      asOfDate: asOfDate || new Date().toISOString().substring(0, 10)
    };
  }

  public async getTransactionHistory(
    ctx: RequestContext,
    accountId: string,
    options?: { fromDate?: string; toDate?: string; limit?: number; offset?: number }
  ): Promise<TransactionHistoryItemDTO[]> {
    let glAccountId: string;
    let companyId: string;

    const bankAcc = this.bankAccountsStore.get(this.getKey(ctx.tenantId, accountId));
    if (bankAcc) {
      glAccountId = bankAcc.glAccountId;
      companyId = bankAcc.companyId;
    } else {
      const cashAcc = this.cashAccountsStore.get(this.getKey(ctx.tenantId, accountId));
      if (cashAcc) {
        glAccountId = cashAcc.glAccountId;
        companyId = cashAcc.companyId;
      } else {
        throw new NotFoundError('BankAccount / CashAccount', accountId);
      }
    }

    this.authorize(ctx, 'banking:account:read', companyId);

    const items: TransactionHistoryItemDTO[] = [];

    const store = (journalDraftService as any).journalsStore as Map<string, JournalEntryDTO> | undefined;
    const linesStore = (journalDraftService as any).linesStore as Map<string, JournalLineDTO[]> | undefined;

    if (store) {
      for (const [storeKey, journal] of store.entries()) {
        if (
          journal.tenantId === ctx.tenantId &&
          journal.companyId === companyId &&
          journal.status === 'POSTED'
        ) {
          if (options?.fromDate && journal.accountingDate < options.fromDate) continue;
          if (options?.toDate && journal.accountingDate > options.toDate) continue;

          const lines = linesStore?.get(storeKey) || journal.lines || [];
          for (const l of lines) {
            if (l.accountId === glAccountId) {
              const debitDec = ExactDecimal.parse(l.debitAmount, 2);
              const creditDec = ExactDecimal.parse(l.creditAmount, 2);
              const netDec = debitDec.sub(creditDec);

              items.push({
                journalEntryId: journal.id || '',
                voucherNumber: journal.voucherNumber || null,
                accountingDate: journal.accountingDate,
                sourceModule: journal.sourceModule,
                sourceDocumentType: journal.sourceDocumentType || null,
                sourceDocumentId: journal.sourceDocumentId || null,
                debitAmount: debitDec.toString(),
                creditAmount: creditDec.toString(),
                netAmount: netDec.toString(),
                narration: l.narration || journal.narration || null
              });
            }
          }
        }
      }
    }

    // Sort by accountingDate ASC
    items.sort((a, b) => a.accountingDate.localeCompare(b.accountingDate));

    const offset = options?.offset || 0;
    const limit = options?.limit || 100;
    return items.slice(offset, offset + limit);
  }
}

export const bankAccountService = new BankAccountService();
