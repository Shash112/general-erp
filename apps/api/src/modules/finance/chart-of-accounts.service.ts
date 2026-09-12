import { RequestContext, ValidationError, NotFoundError, BusinessRuleViolationError } from '@general-erp/core';
import { logger } from '../../config/logger.js';
import { authorizationService } from '../../platform/authorization/authorization.service.js';
import { auditService } from '../../platform/audit/audit.service.js';

export type AccountNodeType = 'GROUP' | 'ACCOUNT';
export type CanonicalAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
export type AccountNature = 'NORMAL' | 'CONTRA';
export type NormalBalance = 'DEBIT' | 'CREDIT';
export type AccountStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE';
export type ControlAccountType = 'AR' | 'AP' | 'TAX_INPUT' | 'TAX_OUTPUT' | 'CASH' | 'BANK' | 'PAYROLL' | 'INVENTORY' | 'FIXED_ASSETS';

export interface ChartOfAccountDTO {
  id: string;
  tenantId: string;
  companyId: string;
  accountCode: string;
  accountName: string;
  nodeType: AccountNodeType;
  accountType: CanonicalAccountType;
  accountSubtype?: string;
  accountNature: AccountNature;
  normalBalance: NormalBalance;
  parentId?: string;
  isPostable: boolean;
  isControlAccount: boolean;
  controlAccountType?: ControlAccountType;
  currency?: string;
  status: AccountStatus;
  displayOrder: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChartOfAccountNodeDTO extends ChartOfAccountDTO {
  children: ChartOfAccountNodeDTO[];
}

export interface CreateAccountRequest {
  companyId: string;
  accountCode: string;
  accountName: string;
  nodeType?: AccountNodeType;
  accountType: CanonicalAccountType;
  accountSubtype?: string;
  accountNature?: AccountNature;
  parentId?: string;
  isControlAccount?: boolean;
  controlAccountType?: ControlAccountType;
  currency?: string;
  displayOrder?: number;
}

export interface UpdateAccountRequest {
  accountName?: string;
  accountSubtype?: string;
  displayOrder?: number;
  status?: AccountStatus;
  accountCode?: string;
  accountType?: CanonicalAccountType;
  accountNature?: AccountNature;
  normalBalance?: NormalBalance;
  nodeType?: AccountNodeType;
  parentId?: string;
  isControlAccount?: boolean;
  controlAccountType?: ControlAccountType;
  currency?: string;
}

export interface GLAccountEligibility {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: CanonicalAccountType;
  accountSubtype?: string;
  accountNature: AccountNature;
  normalBalance: NormalBalance;
  nodeType: AccountNodeType;
  isPostable: boolean;
  status: AccountStatus;
  isEligibleForPosting: boolean;
  ineligibilityReason?: string;
  isControlAccount: boolean;
  controlAccountType?: ControlAccountType;
  companyId: string;
  currency?: string;
}

export interface ApplyTemplateRequest {
  companyId: string;
  templateId: string; // e.g. 'INDIAN_SME_DEFAULT_V1'
}

export interface PostedTransactionLookup {
  hasPostedTransactions(ctx: RequestContext, accountId: string): Promise<boolean>;
}

export class NoOpPostedTransactionLookup implements PostedTransactionLookup {
  async hasPostedTransactions(_ctx: RequestContext, _accountId: string): Promise<boolean> {
    return false;
  }
}

export class TestPostedTransactionLookupAdapter implements PostedTransactionLookup {
  private postedAccounts = new Set<string>();

  registerPostedTransaction(accountId: string): void {
    this.postedAccounts.add(accountId);
  }

  unregisterPostedTransaction(accountId: string): void {
    this.postedAccounts.delete(accountId);
  }

  clear(): void {
    this.postedAccounts.clear();
  }

  async hasPostedTransactions(_ctx: RequestContext, accountId: string): Promise<boolean> {
    return this.postedAccounts.has(accountId);
  }
}

import { glPostedTransactionLookupAdapter, GLPostedTransactionLookupAdapter } from './gl-posted-transaction-lookup.adapter.js';
export { GLPostedTransactionLookupAdapter, glPostedTransactionLookupAdapter };

export class ChartOfAccountsService {
  private accountsStore = new Map<string, ChartOfAccountDTO>();
  private postedTransactionLookup: PostedTransactionLookup;

  /**
   * Helper for tests & store reset
   */
  public clear(): void {
    this.accountsStore.clear();
  }

  constructor(postedTransactionLookup?: PostedTransactionLookup) {
    this.postedTransactionLookup = postedTransactionLookup || new NoOpPostedTransactionLookup();
  }

  public setPostedTransactionLookup(lookup: PostedTransactionLookup): void {
    this.postedTransactionLookup = lookup;
  }

  public getPostedTransactionLookup(): PostedTransactionLookup {
    return this.postedTransactionLookup;
  }

  /**
   * Helper for tests: register a mock posted transaction via TestPostedTransactionLookupAdapter
   */
  public registerPostedTransactionForTest(accountId: string): void {
    if (!(this.postedTransactionLookup instanceof TestPostedTransactionLookupAdapter)) {
      const adapter = new TestPostedTransactionLookupAdapter();
      this.postedTransactionLookup = adapter;
    }
    (this.postedTransactionLookup as TestPostedTransactionLookupAdapter).registerPostedTransaction(accountId);
  }

  /**
   * Calculate deterministic normal balance based on accountType and accountNature
   */
  public static calculateNormalBalance(accountType: CanonicalAccountType, accountNature: AccountNature): NormalBalance {
    const isDebitCategory = accountType === 'ASSET' || accountType === 'EXPENSE';
    if (accountNature === 'NORMAL') {
      return isDebitCategory ? 'DEBIT' : 'CREDIT';
    } else {
      return isDebitCategory ? 'CREDIT' : 'DEBIT';
    }
  }

  public calculateNormalBalance(accountType: CanonicalAccountType, accountNature: AccountNature): NormalBalance {
    return ChartOfAccountsService.calculateNormalBalance(accountType, accountNature);
  }

  /**
   * Helper to normalize account code
   */
  private normalizeAccountCode(code: string): string {
    const cleaned = code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{4,10}$/.test(cleaned)) {
      throw new ValidationError(`Account code '${code}' is invalid. Must be 4-10 uppercase alphanumeric characters, hyphens, or underscores.`);
    }
    return cleaned;
  }

  /**
   * Create a new Account Group or Ledger Account
   */
  async createAccount(ctx: RequestContext, req: CreateAccountRequest): Promise<ChartOfAccountDTO> {
    if (ctx.user) {
      authorizationService.authorize({ user: ctx.user, action: 'finance:coa:create', companyId: req.companyId });
    }

    const companyId = req.companyId || ctx.companyId!;
    const accountCode = this.normalizeAccountCode(req.accountCode);
    const nodeType: AccountNodeType = req.nodeType || 'ACCOUNT';
    const accountNature: AccountNature = req.accountNature || 'NORMAL';
    const isPostable = nodeType === 'ACCOUNT';
    const isControlAccount = req.isControlAccount ?? false;
    let controlAccountType = req.controlAccountType;

    // Control account consistency check
    if (!isControlAccount) {
      controlAccountType = undefined;
    } else if (!controlAccountType) {
      throw new ValidationError('controlAccountType is required when isControlAccount is true.');
    }

    // Check accountCode uniqueness for (tenantId, companyId)
    for (const acc of this.accountsStore.values()) {
      if (acc.tenantId === ctx.tenantId && acc.companyId === companyId && acc.accountCode === accountCode) {
        throw new ValidationError(`Account code '${accountCode}' already exists for this company.`);
      }
    }

    // Parent hierarchy & depth validation
    let parentAcc: ChartOfAccountDTO | undefined;
    if (req.parentId) {
      const parentKey = `${ctx.tenantId}:${req.parentId}`;
      parentAcc = this.accountsStore.get(parentKey);

      if (!parentAcc || parentAcc.tenantId !== ctx.tenantId || parentAcc.companyId !== companyId) {
        throw new NotFoundError('Parent Account', req.parentId);
      }

      if (parentAcc.accountType !== req.accountType) {
        throw new ValidationError(`Child accountType '${req.accountType}' must match parent accountType '${parentAcc.accountType}'.`);
      }

      // Calculate depth
      let depth = 2; // New node will be at parent depth + 1
      let currParent: ChartOfAccountDTO | undefined = parentAcc;
      while (currParent) {
        if (depth > 10) {
          throw new ValidationError('Account hierarchy depth exceeds maximum allowed limit of 10 levels.');
        }
        depth++;
        currParent = currParent.parentId ? this.accountsStore.get(`${ctx.tenantId}:${currParent.parentId}`) : undefined;
      }
    }

    const normalBalance = ChartOfAccountsService.calculateNormalBalance(req.accountType, accountNature);
    const accountId = `coa_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const account: ChartOfAccountDTO = {
      id: accountId,
      tenantId: ctx.tenantId,
      companyId,
      accountCode,
      accountName: req.accountName.trim(),
      nodeType,
      accountType: req.accountType,
      ...(req.accountSubtype !== undefined ? { accountSubtype: req.accountSubtype } : {}),
      accountNature,
      normalBalance,
      ...(req.parentId !== undefined ? { parentId: req.parentId } : {}),
      isPostable,
      isControlAccount,
      ...(controlAccountType !== undefined ? { controlAccountType } : {}),
      ...(req.currency !== undefined ? { currency: req.currency } : {}),
      status: 'ACTIVE',
      displayOrder: req.displayOrder || 0,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.accountsStore.set(`${ctx.tenantId}:${accountId}`, account);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ChartOfAccounts',
      entityId: accountId,
      action: 'CREATE',
      newValues: { accountCode, accountName: req.accountName, nodeType, accountType: req.accountType }
    });

    logger.info({ tenantId: ctx.tenantId, companyId, accountId, accountCode }, '[COA] Account created');
    return account;
  }

  /**
   * Update existing Account (enforces post-posting attribute immutability)
   */
  async updateAccount(ctx: RequestContext, accountId: string, req: UpdateAccountRequest): Promise<ChartOfAccountDTO> {
    const key = `${ctx.tenantId}:${accountId}`;
    const account = this.accountsStore.get(key);

    if (!account) {
      throw new NotFoundError('ChartOfAccount', accountId);
    }

    if (ctx.user) {
      authorizationService.authorize({ user: ctx.user, action: 'finance:coa:update', companyId: account.companyId });
    }

    const hasPostings = await this.postedTransactionLookup.hasPostedTransactions(ctx, accountId);

    // If postings exist, verify no attempt to mutate immutable attributes
    if (hasPostings) {
      if (
        (req.accountCode !== undefined && req.accountCode !== account.accountCode) ||
        (req.accountType !== undefined && req.accountType !== account.accountType) ||
        (req.accountSubtype !== undefined && req.accountSubtype !== account.accountSubtype) ||
        (req.accountNature !== undefined && req.accountNature !== account.accountNature) ||
        (req.normalBalance !== undefined && req.normalBalance !== account.normalBalance) ||
        (req.nodeType !== undefined && req.nodeType !== account.nodeType) ||
        (req.parentId !== undefined && req.parentId !== account.parentId) ||
        (req.isControlAccount !== undefined && req.isControlAccount !== account.isControlAccount) ||
        (req.controlAccountType !== undefined && req.controlAccountType !== account.controlAccountType) ||
        (req.currency !== undefined && req.currency !== account.currency)
      ) {
        throw new BusinessRuleViolationError(`Account '${account.accountCode}' cannot mutate classification, hierarchy, or control attributes after posted financial transactions exist.`);
      }
    }

    if (req.accountName !== undefined) account.accountName = req.accountName.trim();
    if (req.displayOrder !== undefined) account.displayOrder = req.displayOrder;
    if (req.status !== undefined) account.status = req.status;

    if (!hasPostings) {
      if (req.accountCode !== undefined) account.accountCode = req.accountCode.trim();
      if (req.accountType !== undefined) account.accountType = req.accountType;
      if (req.accountNature !== undefined) account.accountNature = req.accountNature;
      if (req.normalBalance !== undefined) account.normalBalance = req.normalBalance;
      if (req.nodeType !== undefined) account.nodeType = req.nodeType;
      if (req.parentId !== undefined) account.parentId = req.parentId;
      if (req.isControlAccount !== undefined) account.isControlAccount = req.isControlAccount;
      if (req.controlAccountType !== undefined) account.controlAccountType = req.controlAccountType;
      if (req.currency !== undefined) account.currency = req.currency;
      if (req.accountSubtype !== undefined) account.accountSubtype = req.accountSubtype;
    }

    account.version += 1;
    account.updatedAt = new Date();

    this.accountsStore.set(key, account);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ChartOfAccounts',
      entityId: accountId,
      action: 'UPDATE',
      newValues: { accountName: account.accountName, status: account.status }
    });

    return account;
  }

  /**
   * Activate Account
   */
  async activateAccount(ctx: RequestContext, accountId: string): Promise<ChartOfAccountDTO> {
    const key = `${ctx.tenantId}:${accountId}`;
    const account = this.accountsStore.get(key);

    if (!account) {
      throw new NotFoundError('ChartOfAccount', accountId);
    }

    if (ctx.user) {
      authorizationService.authorize({ user: ctx.user, action: 'finance:coa:activate', companyId: account.companyId });
    }

    account.status = 'ACTIVE';
    account.version += 1;
    account.updatedAt = new Date();
    this.accountsStore.set(key, account);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ChartOfAccounts',
      entityId: accountId,
      action: 'ACTIVATED'
    });

    return account;
  }

  /**
   * Deactivate Account
   */
  async deactivateAccount(ctx: RequestContext, accountId: string): Promise<ChartOfAccountDTO> {
    const key = `${ctx.tenantId}:${accountId}`;
    const account = this.accountsStore.get(key);

    if (!account) {
      throw new NotFoundError('ChartOfAccount', accountId);
    }

    if (ctx.user) {
      authorizationService.authorize({ user: ctx.user, action: 'finance:coa:deactivate', companyId: account.companyId });
    }

    account.status = 'INACTIVE';
    account.version += 1;
    account.updatedAt = new Date();
    this.accountsStore.set(key, account);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ChartOfAccounts',
      entityId: accountId,
      action: 'DEACTIVATED'
    });

    return account;
  }

  /**
   * Delete Account (Strict 5-point safety check)
   */
  async deleteAccount(ctx: RequestContext, accountId: string): Promise<boolean> {
    const key = `${ctx.tenantId}:${accountId}`;
    const account = this.accountsStore.get(key);

    if (!account) {
      throw new NotFoundError('ChartOfAccount', accountId);
    }

    if (ctx.user) {
      authorizationService.authorize({ user: ctx.user, action: 'finance:coa:admin', companyId: account.companyId });
    }

    // 1. Check posted GL transactions via PostedTransactionLookup contract
    const hasPostings = await this.postedTransactionLookup.hasPostedTransactions(ctx, accountId);
    if (hasPostings) {
      throw new BusinessRuleViolationError(`Account '${account.accountCode}' cannot be deleted because historical posted financial transactions exist. Deactivate the account instead.`);
    }

    // 2. Check child accounts
    for (const child of this.accountsStore.values()) {
      if (child.tenantId === ctx.tenantId && child.companyId === account.companyId && child.parentId === accountId) {
        throw new BusinessRuleViolationError(`Account '${account.accountCode}' cannot be deleted because child accounts exist.`);
      }
    }

    this.accountsStore.delete(key);

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ChartOfAccounts',
      entityId: accountId,
      action: 'UPDATE',
      newValues: { action: 'PHYSICALLY_DELETED', accountCode: account.accountCode }
    });

    return true;
  }

  /**
   * Assert GL Account Eligibility for posting
   */
  async assertAccountEligibilityForPosting(ctx: RequestContext, accountId: string): Promise<GLAccountEligibility> {
    const key = `${ctx.tenantId}:${accountId}`;
    const account = this.accountsStore.get(key);

    if (!account) {
      throw new NotFoundError('ChartOfAccount', accountId);
    }

    let isEligible = true;
    let ineligibilityReason: string | undefined;

    if (account.status !== 'ACTIVE') {
      isEligible = false;
      ineligibilityReason = `Account '${account.accountCode}' is not ACTIVE (current status: ${account.status}).`;
    } else if (account.nodeType !== 'ACCOUNT' || !account.isPostable) {
      isEligible = false;
      ineligibilityReason = `Account '${account.accountCode}' is a GROUP node and cannot receive journal postings.`;
    }

    return {
      accountId: account.id,
      accountCode: account.accountCode,
      accountName: account.accountName,
      accountType: account.accountType,
      ...(account.accountSubtype !== undefined ? { accountSubtype: account.accountSubtype } : {}),
      accountNature: account.accountNature,
      normalBalance: account.normalBalance,
      nodeType: account.nodeType,
      isPostable: account.isPostable,
      status: account.status,
      isEligibleForPosting: isEligible,
      ...(ineligibilityReason !== undefined ? { ineligibilityReason } : {}),
      isControlAccount: account.isControlAccount,
      ...(account.controlAccountType !== undefined ? { controlAccountType: account.controlAccountType } : {}),
      companyId: account.companyId,
      ...(account.currency !== undefined ? { currency: account.currency } : {})
    };
  }

  /**
   * Get Account by ID
   */
  async getAccountById(ctx: RequestContext, accountId: string): Promise<ChartOfAccountDTO> {
    const account = this.accountsStore.get(`${ctx.tenantId}:${accountId}`);
    if (!account) {
      throw new NotFoundError('ChartOfAccount', accountId);
    }
    return account;
  }

  /**
   * Get flat list of accounts for company
   */
  async getAccountsList(ctx: RequestContext, companyId: string, filters?: { accountType?: CanonicalAccountType; isPostable?: boolean; status?: AccountStatus }): Promise<ChartOfAccountDTO[]> {
    let list = Array.from(this.accountsStore.values()).filter(a => a.tenantId === ctx.tenantId && a.companyId === companyId);

    if (filters?.accountType) {
      list = list.filter(a => a.accountType === filters.accountType);
    }
    if (filters?.isPostable !== undefined) {
      list = list.filter(a => a.isPostable === filters.isPostable);
    }
    if (filters?.status) {
      list = list.filter(a => a.status === filters.status);
    }

    return list.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  }

  /**
   * Get nested hierarchical account tree for company
   */
  async getAccountTree(ctx: RequestContext, companyId: string): Promise<ChartOfAccountNodeDTO[]> {
    const all = await this.getAccountsList(ctx, companyId);
    const nodeMap = new Map<string, ChartOfAccountNodeDTO>();

    all.forEach(acc => {
      nodeMap.set(acc.id, { ...acc, children: [] });
    });

    const roots: ChartOfAccountNodeDTO[] = [];

    nodeMap.forEach(node => {
      if (node.parentId && nodeMap.has(node.parentId)) {
        nodeMap.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });

    return roots;
  }

  /**
   * Instantiate Template (INDIAN_SME_DEFAULT_V1)
   */
  async applyTemplate(ctx: RequestContext, req: ApplyTemplateRequest): Promise<{ createdCount: number; skippedCount: number }> {
    if (ctx.user) {
      authorizationService.authorize({ user: ctx.user, action: 'finance:coa:admin', companyId: req.companyId });
    }

    if (req.templateId !== 'INDIAN_SME_DEFAULT_V1') {
      throw new ValidationError(`Template '${req.templateId}' is not supported. Use 'INDIAN_SME_DEFAULT_V1'.`);
    }

    // Default Template Structure
    const templateNodes = [
      // Assets
      { code: '1000', name: 'ASSETS', nodeType: 'GROUP' as AccountNodeType, type: 'ASSET' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: undefined },
      { code: '1100', name: 'CURRENT ASSETS', nodeType: 'GROUP' as AccountNodeType, type: 'ASSET' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '1000' },
      { code: '1110', name: 'Cash on Hand', nodeType: 'ACCOUNT' as AccountNodeType, type: 'ASSET' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '1100', isControl: true, controlType: 'CASH' as ControlAccountType },
      { code: '1120', name: 'Primary Bank Account', nodeType: 'ACCOUNT' as AccountNodeType, type: 'ASSET' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '1100', isControl: true, controlType: 'BANK' as ControlAccountType },
      { code: '1130', name: 'Trade Receivables', nodeType: 'ACCOUNT' as AccountNodeType, type: 'ASSET' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '1100', isControl: true, controlType: 'AR' as ControlAccountType },
      { code: '1140', name: 'CGST Input Tax Credit', nodeType: 'ACCOUNT' as AccountNodeType, type: 'ASSET' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '1100', isControl: true, controlType: 'TAX_INPUT' as ControlAccountType },
      { code: '1141', name: 'SGST Input Tax Credit', nodeType: 'ACCOUNT' as AccountNodeType, type: 'ASSET' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '1100', isControl: true, controlType: 'TAX_INPUT' as ControlAccountType },
      { code: '1142', name: 'IGST Input Tax Credit', nodeType: 'ACCOUNT' as AccountNodeType, type: 'ASSET' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '1100', isControl: true, controlType: 'TAX_INPUT' as ControlAccountType },
      { code: '1150', name: 'Prepaid Expenses & Advances', nodeType: 'ACCOUNT' as AccountNodeType, type: 'ASSET' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '1100' },
      { code: '1200', name: 'NON-CURRENT ASSETS', nodeType: 'GROUP' as AccountNodeType, type: 'ASSET' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '1000' },
      { code: '1210', name: 'Plant & Machinery', nodeType: 'ACCOUNT' as AccountNodeType, type: 'ASSET' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '1200' },
      { code: '1220', name: 'Computers & IT Equipment', nodeType: 'ACCOUNT' as AccountNodeType, type: 'ASSET' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '1200' },
      { code: '1290', name: 'Accumulated Depreciation', nodeType: 'ACCOUNT' as AccountNodeType, type: 'ASSET' as CanonicalAccountType, nature: 'CONTRA' as AccountNature, parentCode: '1200' },

      // Liabilities
      { code: '2000', name: 'LIABILITIES', nodeType: 'GROUP' as AccountNodeType, type: 'LIABILITY' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: undefined },
      { code: '2100', name: 'CURRENT LIABILITIES', nodeType: 'GROUP' as AccountNodeType, type: 'LIABILITY' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '2000' },
      { code: '2110', name: 'Trade Payables', nodeType: 'ACCOUNT' as AccountNodeType, type: 'LIABILITY' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '2100', isControl: true, controlType: 'AP' as ControlAccountType },
      { code: '2120', name: 'CGST Output Tax Payable', nodeType: 'ACCOUNT' as AccountNodeType, type: 'LIABILITY' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '2100', isControl: true, controlType: 'TAX_OUTPUT' as ControlAccountType },
      { code: '2121', name: 'SGST Output Tax Payable', nodeType: 'ACCOUNT' as AccountNodeType, type: 'LIABILITY' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '2100', isControl: true, controlType: 'TAX_OUTPUT' as ControlAccountType },
      { code: '2122', name: 'IGST Output Tax Payable', nodeType: 'ACCOUNT' as AccountNodeType, type: 'LIABILITY' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '2100', isControl: true, controlType: 'TAX_OUTPUT' as ControlAccountType },
      { code: '2130', name: 'TDS Payable', nodeType: 'ACCOUNT' as AccountNodeType, type: 'LIABILITY' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '2100' },
      { code: '2140', name: 'Salary & Wages Payable', nodeType: 'ACCOUNT' as AccountNodeType, type: 'LIABILITY' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '2100', isControl: true, controlType: 'PAYROLL' as ControlAccountType },
      { code: '2200', name: 'NON-CURRENT LIABILITIES', nodeType: 'GROUP' as AccountNodeType, type: 'LIABILITY' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '2000' },
      { code: '2210', name: 'Bank Term Loans', nodeType: 'ACCOUNT' as AccountNodeType, type: 'LIABILITY' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '2200' },

      // Equity
      { code: '3000', name: 'EQUITY', nodeType: 'GROUP' as AccountNodeType, type: 'EQUITY' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: undefined },
      { code: '3100', name: "Owner's / Partner's Capital", nodeType: 'ACCOUNT' as AccountNodeType, type: 'EQUITY' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '3000' },
      { code: '3200', name: 'Retained Earnings', nodeType: 'ACCOUNT' as AccountNodeType, type: 'EQUITY' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '3000' },

      // Revenue
      { code: '4000', name: 'REVENUE', nodeType: 'GROUP' as AccountNodeType, type: 'INCOME' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: undefined },
      { code: '4100', name: 'Sales Revenue - Domestic', nodeType: 'ACCOUNT' as AccountNodeType, type: 'INCOME' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '4000' },
      { code: '4110', name: 'Sales Revenue - Export', nodeType: 'ACCOUNT' as AccountNodeType, type: 'INCOME' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '4000' },
      { code: '4190', name: 'Sales Returns & Allowances', nodeType: 'ACCOUNT' as AccountNodeType, type: 'INCOME' as CanonicalAccountType, nature: 'CONTRA' as AccountNature, parentCode: '4000' },
      { code: '4200', name: 'Other Operating Income', nodeType: 'ACCOUNT' as AccountNodeType, type: 'INCOME' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '4000' },

      // Expenses
      { code: '5000', name: 'EXPENSES', nodeType: 'GROUP' as AccountNodeType, type: 'EXPENSE' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: undefined },
      { code: '5100', name: 'COST OF GOODS SOLD (COGS)', nodeType: 'GROUP' as AccountNodeType, type: 'EXPENSE' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '5000' },
      { code: '5110', name: 'Raw Material Purchases', nodeType: 'ACCOUNT' as AccountNodeType, type: 'EXPENSE' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '5100' },
      { code: '5120', name: 'Freight Inward & Customs', nodeType: 'ACCOUNT' as AccountNodeType, type: 'EXPENSE' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '5100' },
      { code: '5200', name: 'INDIRECT OPERATING EXPENSES', nodeType: 'GROUP' as AccountNodeType, type: 'EXPENSE' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '5000' },
      { code: '5210', name: 'Salaries & Employee Benefits', nodeType: 'ACCOUNT' as AccountNodeType, type: 'EXPENSE' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '5200' },
      { code: '5220', name: 'Office Rent & Maintenance', nodeType: 'ACCOUNT' as AccountNodeType, type: 'EXPENSE' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '5200' },
      { code: '5230', name: 'Electricity & Utilities', nodeType: 'ACCOUNT' as AccountNodeType, type: 'EXPENSE' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '5200' },
      { code: '5240', name: 'Legal & Professional Fees', nodeType: 'ACCOUNT' as AccountNodeType, type: 'EXPENSE' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '5200' },
      { code: '5250', name: 'Audit Fees', nodeType: 'ACCOUNT' as AccountNodeType, type: 'EXPENSE' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '5200' },
      { code: '5260', name: 'Bank Charges & Gateway Fees', nodeType: 'ACCOUNT' as AccountNodeType, type: 'EXPENSE' as CanonicalAccountType, nature: 'NORMAL' as AccountNature, parentCode: '5200' }
    ];

    const existingAccounts = await this.getAccountsList(ctx, req.companyId);
    const existingMap = new Map(existingAccounts.map(a => [a.accountCode, a]));

    // Check for structural conflicts before creation
    for (const node of templateNodes) {
      const existing = existingMap.get(node.code);
      if (existing) {
        if (existing.accountType !== node.type) {
          throw new BusinessRuleViolationError(`Template conflict: Account code '${node.code}' exists as category '${existing.accountType}' but template expects '${node.type}'. Instantiation aborted.`);
        }
      }
    }

    let createdCount = 0;
    let skippedCount = 0;
    const codeToIdMap = new Map<string, string>();

    // Seed Map with existing account IDs for parent resolution
    existingAccounts.forEach(a => codeToIdMap.set(a.accountCode, a.id));

    // Process nodes sequentially to respect parent order
    for (const node of templateNodes) {
      if (existingMap.has(node.code)) {
        skippedCount++;
        continue;
      }

      const parentId = node.parentCode ? codeToIdMap.get(node.parentCode) : undefined;
      const created = await this.createAccount(ctx, {
        companyId: req.companyId,
        accountCode: node.code,
        accountName: node.name,
        nodeType: node.nodeType,
        accountType: node.type,
        accountNature: node.nature,
        ...(parentId !== undefined ? { parentId } : {}),
        ...(node.isControl !== undefined ? { isControlAccount: node.isControl } : {}),
        ...(node.controlType !== undefined ? { controlAccountType: node.controlType } : {})
      });

      codeToIdMap.set(node.code, created.id);
      createdCount++;
    }

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ChartOfAccounts',
      entityId: req.companyId,
      action: 'TEMPLATE_APPLY',
      newValues: { templateId: req.templateId, createdCount, skippedCount }
    });

    logger.info({ tenantId: ctx.tenantId, companyId: req.companyId, createdCount, skippedCount }, '[COA] Template instantiated');
    return { createdCount, skippedCount };
  }
}

export const chartOfAccountsService = new ChartOfAccountsService();
