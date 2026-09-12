import {
  RequestContext,
  ValidationError,
  NotFoundError,
  BusinessRuleViolationError,
  ConflictError,
  AccountingError,
  ExactDecimal
} from '@general-erp/core';
import { logger } from '../../config/logger.js';
import { JournalModel, JournalEntryDTO, JournalLineDTO } from './journal-model.js';
import { journalDraftService } from './journal-draft.service.js';
import { fiscalPeriodService } from './fiscal-period.service.js';
import { chartOfAccountsService } from './chart-of-accounts.service.js';
import { numberingEngine } from '../../platform/numbering/numbering.service.js';
import { idempotencyService } from '../../platform/idempotency/idempotency.service.js';
import { glPostedTransactionLookupAdapter } from './gl-posted-transaction-lookup.adapter.js';
import { authorizationService } from '../../platform/authorization/authorization.service.js';
import { auditService } from '../../platform/audit/audit.service.js';
import type pg from 'pg';

export interface PostJournalInput {
  journalEntryId: string;
  idempotencyKey?: string | undefined;
}

export interface ReverseJournalInput {
  originalJournalId: string;
  reason: string;
  reversalAccountingDate?: string | undefined;
  idempotencyKey?: string | undefined;
}

export class GLEngine {
  private dbPool?: pg.Pool | undefined;

  /**
   * Configure database pool for atomic PostgreSQL transactions and session variable authorization
   */
  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
    numberingEngine.setDbPool(pool);
    idempotencyService.setDbPool(pool);
    glPostedTransactionLookupAdapter.setDbPool(pool);
    chartOfAccountsService.setPostedTransactionLookup(glPostedTransactionLookupAdapter);
  }

  /**
   * Retrieves the active database pool if set
   */
  public getDbPool(): pg.Pool | undefined {
    return this.dbPool;
  }

  /**
   * Atomically posts a draft journal entry (DRAFT -> POSTED).
   * 
   * Transaction Sequence:
   * 1. BEGIN DB Transaction
   * 2. SET LOCAL app.posting_authorized = 'true'
   * 3. Layer 1 Request Idempotency Check (idempotency_keys)
   * 4. SELECT * FROM journal_entries WHERE id = $1 FOR UPDATE (Row Lock)
   * 5. Verify Status == 'DRAFT' & Revalidate Journal Invariants
   * 6. Layer 2 Business Source Document Idempotency Check (idx_je_tenant_comp_src_doc)
   * 7. Resolve & Lock Fiscal Period (SELECT ... FOR UPDATE OF fp) -> Assert OPEN
   * 8. Retrieve & Validate COA Account Eligibility for every line (Active, Postable ACCOUNT)
   * 9. Allocate Voucher Number Transactionally
   * 10. UPDATE journal_entries SET status = 'POSTED', voucher_number, posted_at, posted_by
   * 11. Persist Layer 1 Idempotency Result
   * 12. COMMIT DB Transaction (resets app.posting_authorized automatically)
   */
  public async postJournal(ctx: RequestContext, input: string | PostJournalInput): Promise<JournalEntryDTO> {
    if (!ctx.tenantId || !ctx.companyId) {
      throw new ValidationError('RequestContext tenantId and companyId are required.');
    }

    const journalEntryId = typeof input === 'string' ? input : input.journalEntryId;
    const idempotencyKey = typeof input === 'string' ? undefined : input.idempotencyKey;

    if (!journalEntryId || journalEntryId.trim() === '') {
      throw new ValidationError('Journal entry ID is required for posting.');
    }

    // Execute via real PostgreSQL transaction if DB pool is set
    if (this.dbPool) {
      return this.postJournalDb(ctx, journalEntryId, idempotencyKey);
    } else {
      return this.postJournalInMemory(ctx, journalEntryId, idempotencyKey);
    }
  }

  /**
   * Database-backed atomic posting transaction with Fiscal Period & COA In-Transaction Validation
   */
  private async postJournalDb(ctx: RequestContext, journalId: string, idempotencyKey?: string): Promise<JournalEntryDTO> {
    const client = await this.dbPool!.connect();

    try {
      await client.query('BEGIN');

      // 1. Set Local Transaction Posting Authorization Guard (PostgreSQL Trigger Requirement)
      await client.query("SET LOCAL app.posting_authorized = 'true'");

      // 2. Layer 1 Request Idempotency Check
      if (idempotencyKey && idempotencyKey.trim() !== '') {
        const check = await idempotencyService.checkOrClaim(
          ctx,
          idempotencyKey,
          { journalEntryId: journalId, idempotencyKey },
          client
        );
        if (check.isDuplicate) {
          await client.query('COMMIT');
          return check.responseBody as JournalEntryDTO;
        }
      }

      // 3. Lock Row FOR UPDATE & Retrieve Header
      const headerRes = await client.query(
        `SELECT id, tenant_id, company_id, voucher_number, fiscal_year_id, fiscal_period_id, 
                accounting_date, posting_date, source_module, source_document_type, 
                source_document_id, original_journal_id, status, total_debit, total_credit, 
                currency, exchange_rate, narration, created_by, posted_by, posted_at, version, 
                created_at, updated_at
         FROM journal_entries 
         WHERE id = $1 AND tenant_id = $2 AND company_id = $3
         FOR UPDATE`,
        [journalId, ctx.tenantId, ctx.companyId]
      );

      if (headerRes.rows.length === 0) {
        throw new NotFoundError('JournalEntry', journalId);
      }

      const row = headerRes.rows[0];

      // Security / Ownership Check
      if (row.tenant_id !== ctx.tenantId) {
        throw new ValidationError(`Tenant access denied for journal '${journalId}'.`);
      }

      if (row.company_id !== ctx.companyId) {
        throw new ValidationError(`Company access denied for journal '${journalId}'.`);
      }

      if (ctx.user) {
        authorizationService.authorize({
          user: ctx.user,
          action: 'finance:gl:post',
          companyId: row.company_id,
          ...(row.source_module === 'MANUAL' && row.created_by ? { creatorId: row.created_by } : {})
        });
      }

      // Status Guard
      if (row.status === 'POSTED') {
        throw new BusinessRuleViolationError(`Cannot post journal '${journalId}'. Journal is already POSTED.`);
      }

      if (row.status === 'CANCELLED') {
        throw new BusinessRuleViolationError(`Cannot post journal '${journalId}'. Journal is CANCELLED.`);
      }

      if (row.status !== 'DRAFT') {
        throw new BusinessRuleViolationError(`Cannot post journal '${journalId}' with status '${row.status}'. Only DRAFT journals can be posted.`);
      }

      // 4. Layer 2 Business Source Document Idempotency Check
      const sourceModule = row.source_module;
      const sourceDocumentType = row.source_document_type || null;
      const sourceDocumentId = row.source_document_id || null;

      if (sourceDocumentId && sourceDocumentId.trim() !== '') {
        const existingSourceRes = await client.query(
          `SELECT id, voucher_number
           FROM journal_entries
           WHERE tenant_id = $1 AND company_id = $2
             AND source_module = $3
             AND (source_document_type = $4 OR ($4 IS NULL AND source_document_type IS NULL))
             AND source_document_id = $5
             AND status = 'POSTED'
             AND id != $6
           FOR UPDATE`,
          [ctx.tenantId, ctx.companyId, sourceModule, sourceDocumentType, sourceDocumentId, journalId]
        );

        if (existingSourceRes.rows.length > 0) {
          const existingVoucher = existingSourceRes.rows[0].voucher_number;
          throw new BusinessRuleViolationError(
            `SOURCE_DOCUMENT_ALREADY_POSTED: Source document '${sourceDocumentId}' from module '${sourceModule}' has already been posted to GL under voucher '${existingVoucher}'.`
          );
        }
      }

      // 3. Retrieve Lines
      const linesRes = await client.query(
        `SELECT id, tenant_id, company_id, journal_entry_id, account_id, line_sequence,
                debit_amount, credit_amount, currency, exchange_rate, base_debit_amount,
                base_credit_amount, narration, party_type, party_id, branch_id, department_id,
                created_at
         FROM journal_lines
         WHERE journal_entry_id = $1 AND tenant_id = $2 AND company_id = $3
         ORDER BY line_sequence ASC`,
        [journalId, ctx.tenantId, ctx.companyId]
      );

      const lines: JournalLineDTO[] = linesRes.rows.map(l => ({
        id: l.id,
        tenantId: l.tenant_id,
        companyId: l.company_id,
        journalEntryId: l.journal_entry_id,
        accountId: l.account_id,
        lineSequence: Number(l.line_sequence),
        debitAmount: String(l.debit_amount),
        creditAmount: String(l.credit_amount),
        currency: l.currency,
        exchangeRate: String(l.exchange_rate),
        baseDebitAmount: String(l.base_debit_amount),
        baseCreditAmount: String(l.base_credit_amount),
        narration: l.narration || null,
        partyType: l.party_type || null,
        partyId: l.party_id || null,
        branchId: l.branch_id || null,
        departmentId: l.department_id || null,
        createdAt: l.created_at
      }));

      // Format Accounting Date string "YYYY-MM-DD"
      const acctDateStr = typeof row.accounting_date === 'string' 
        ? row.accounting_date.substring(0, 10)
        : row.accounting_date instanceof Date 
          ? row.accounting_date.toISOString().substring(0, 10)
          : String(row.accounting_date).substring(0, 10);

      const journalDto: JournalEntryDTO = {
        id: row.id,
        tenantId: row.tenant_id,
        companyId: row.company_id,
        voucherNumber: row.voucher_number || null,
        fiscalYearId: row.fiscal_year_id,
        fiscalPeriodId: row.fiscal_period_id,
        accountingDate: acctDateStr,
        postingDate: row.posting_date || null,
        sourceModule: row.source_module,
        sourceDocumentType: row.source_document_type || null,
        sourceDocumentId: row.source_document_id || null,
        originalJournalId: row.original_journal_id || null,
        status: row.status,
        totalDebit: String(row.total_debit),
        totalCredit: String(row.total_credit),
        currency: row.currency,
        exchangeRate: String(row.exchange_rate),
        narration: row.narration || null,
        createdBy: row.created_by,
        postedBy: row.posted_by || null,
        postedAt: row.posted_at || null,
        version: Number(row.version),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lines
      };

      // 4. Domain Validation Rules (Reusing Phase 2.3.1 Model Contract)
      JournalModel.validate(journalDto);

      // Reconcile line-derived totals with persisted header totals
      const { totalDebit, totalCredit } = JournalModel.calculateTotals(lines);
      if (totalDebit.toString() !== journalDto.totalDebit || totalCredit.toString() !== journalDto.totalCredit) {
        throw new AccountingError(
          `Journal header totals (${journalDto.totalDebit}/${journalDto.totalCredit}) do not reconcile with line totals (${totalDebit.toString()}/${totalCredit.toString()}).`
        );
      }

      // 5. In-Transaction Fiscal Period Validation & Period-Close Race Protection Lock
      const periodRes = await client.query(
        `SELECT fp.id as period_id, fp.name as period_name, fp.status as period_status, fp.is_closed as period_is_closed,
                fy.id as year_id, fy.name as year_name, fy.status as year_status, fy.is_closed as year_is_closed
         FROM fiscal_periods fp
         JOIN fiscal_years fy ON fp.fiscal_year_id = fy.id
         WHERE fp.tenant_id = $1 AND fp.company_id = $2
           AND $3::date >= fp.start_date AND $3::date <= fp.end_date
           AND fp.period_type = 'STANDARD'
         FOR UPDATE OF fp`,
        [ctx.tenantId, ctx.companyId, acctDateStr]
      );

      if (periodRes.rows.length === 0) {
        throw new NotFoundError('FiscalPeriod for date', acctDateStr);
      }

      const periodRow = periodRes.rows[0];

      if (periodRow.period_status === 'CLOSED' || periodRow.period_status === 'CLOSING' || periodRow.period_is_closed) {
        throw new BusinessRuleViolationError(`Financial posting rejected: Accounting period '${periodRow.period_name}' is CLOSED.`);
      }

      if (periodRow.year_status === 'CLOSED' || periodRow.year_is_closed) {
        throw new BusinessRuleViolationError(`Financial posting rejected: Fiscal year '${periodRow.year_name}' is CLOSED.`);
      }

      // 6. In-Transaction Chart of Accounts Line Eligibility Validation
      for (const line of lines) {
        const coaRes = await client.query(
          `SELECT id, tenant_id, company_id, account_code, account_name, node_type, is_postable, status
           FROM chart_of_accounts
           WHERE id = $1 AND tenant_id = $2 AND company_id = $3`,
          [line.accountId, ctx.tenantId, ctx.companyId]
        );

        if (coaRes.rows.length === 0) {
          throw new NotFoundError('ChartOfAccount', line.accountId);
        }

        const coaRow = coaRes.rows[0];

        // Tenant / Company Scope Protection
        if (coaRow.tenant_id !== ctx.tenantId) {
          throw new ValidationError(`Account tenant mismatch for account '${coaRow.account_code}'.`);
        }

        if (coaRow.company_id !== ctx.companyId) {
          throw new ValidationError(`Company access denied for account '${coaRow.account_code}'.`);
        }

        // Status Protection: Account must be ACTIVE
        if (coaRow.status !== 'ACTIVE') {
          throw new BusinessRuleViolationError(`Account '${coaRow.account_code}' is not ACTIVE (current status: ${coaRow.status}).`);
        }

        // Postability Protection: Node type must be ACCOUNT and is_postable true
        if (coaRow.node_type !== 'ACCOUNT' || !coaRow.is_postable) {
          throw new BusinessRuleViolationError(`Account '${coaRow.account_code}' is a GROUP node and cannot receive journal postings.`);
        }
      }

      // 7. Transactional Voucher Allocation via Numbering Engine
      const fiscalYearStr = journalDto.accountingDate.substring(0, 4);
      const lineBranch = lines.find(l => l.branchId && l.branchId.trim() !== '')?.branchId || undefined;
      numberingEngine.configureSequence(ctx.tenantId, ctx.companyId, {
        documentType: 'JOURNAL_ENTRY',
        prefix: 'JV',
        fiscalYear: fiscalYearStr,
        branchCode: lineBranch,
        currentSequence: 0,
        paddingDigits: 4,
        resetOnFiscalYear: true
      });
      const voucherNumber = await numberingEngine.generateNextNumberAsync(
        ctx.tenantId,
        ctx.companyId,
        'JOURNAL_ENTRY',
        fiscalYearStr,
        lineBranch,
        client
      );

      const now = new Date();
      const postedBy = ctx.user?.userId || 'system';

      // 8. Update Status to POSTED inside the transaction
      const updateRes = await client.query(
        `UPDATE journal_entries
         SET status = 'POSTED',
             voucher_number = $1,
             fiscal_year_id = $2,
             fiscal_period_id = $3,
             posting_date = accounting_date,
             posted_by = $4,
             posted_at = $5,
             version = version + 1,
             updated_at = $5
         WHERE id = $6 AND tenant_id = $7 AND company_id = $8 AND status = 'DRAFT'
         RETURNING version, updated_at`,
        [voucherNumber, periodRow.year_id, periodRow.period_id, postedBy, now, journalId, ctx.tenantId, ctx.companyId]
      );

      const postedDto: JournalEntryDTO = {
        ...journalDto,
        fiscalYearId: periodRow.year_id,
        fiscalPeriodId: periodRow.period_id,
        status: 'POSTED',
        voucherNumber,
        postingDate: now,
        postedBy,
        postedAt: now,
        version: updateRes.rows[0].version,
        updatedAt: updateRes.rows[0].updated_at
      };

      if (idempotencyKey && idempotencyKey.trim() !== '') {
        await idempotencyService.saveResult(
          ctx,
          idempotencyKey,
          { journalEntryId: journalId, idempotencyKey },
          200,
          postedDto,
          client
        );
      }

      await client.query('COMMIT');

      logger.info({
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        journalId,
        voucherNumber,
        totalDebit: totalDebit.toString(),
        msg: '[GL] Draft journal posted successfully with Fiscal Period & COA validation'
      });

      await auditService.logEvent(ctx, {
        module: 'finance',
        entityName: 'JournalEntry',
        entityId: journalId,
        action: 'POST',
        newValues: {
          voucherNumber: postedDto.voucherNumber,
          totalDebit: postedDto.totalDebit,
          totalCredit: postedDto.totalCredit,
          sourceModule: postedDto.sourceModule,
          status: postedDto.status
        }
      });

      return postedDto;

    } catch (err) {
      await client.query('ROLLBACK');
      if (idempotencyKey && idempotencyKey.trim() !== '') {
        idempotencyService.releaseClaim(ctx, idempotencyKey, err);
      }
      if ((err as any).code === '23505' && (err as any).constraint === 'idx_je_tenant_comp_src_doc') {
        throw new BusinessRuleViolationError(
          `SOURCE_DOCUMENT_ALREADY_POSTED: Source document has already been posted to GL.`
        );
      }
      logger.warn({
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        journalId,
        error: (err as Error).message,
        msg: '[GL] Journal posting transaction rolled back'
      });
      throw err;
    } finally {
      client.release();
    }
  }

  private postingLocks = new Set<string>();
  private inFlightSourceDocs = new Set<string>();

  /**
   * In-memory store fallback for unit testing without PostgreSQL pool
   */
  private async postJournalInMemory(ctx: RequestContext, journalId: string, idempotencyKey?: string): Promise<JournalEntryDTO> {
    // 1. Layer 1 Request Idempotency Check
    if (idempotencyKey && idempotencyKey.trim() !== '') {
      const check = await idempotencyService.checkOrClaim(
        ctx,
        idempotencyKey,
        { journalEntryId: journalId, idempotencyKey }
      );
      if (check.isDuplicate) {
        return check.responseBody as JournalEntryDTO;
      }
    }

    const lockKey = `${ctx.tenantId}:${ctx.companyId}:${journalId}`;
    if (this.postingLocks.has(lockKey)) {
      throw new ConflictError(`Concurrent modification or status change during posting of journal '${journalId}'.`);
    }
    this.postingLocks.add(lockKey);

    try {
      const draft = await journalDraftService.getDraftById(ctx, journalId);

      if (draft.status === 'POSTED') {
        throw new BusinessRuleViolationError(`Cannot post journal '${journalId}'. Journal is already POSTED.`);
      }

      if (draft.status === 'CANCELLED') {
        throw new BusinessRuleViolationError(`Cannot post journal '${journalId}'. Journal is CANCELLED.`);
      }

      if (draft.status !== 'DRAFT') {
        throw new BusinessRuleViolationError(`Cannot post journal '${journalId}' with status '${draft.status}'. Only DRAFT journals can be posted.`);
      }

      return await this.executePostInMemory(ctx, journalId, draft, idempotencyKey);
    } catch (err) {
      if (idempotencyKey && idempotencyKey.trim() !== '') {
        idempotencyService.releaseClaim(ctx, idempotencyKey, err);
      }
      throw err;
    } finally {
      this.postingLocks.delete(lockKey);
    }
  }

  private async executePostInMemory(ctx: RequestContext, journalId: string, draft: JournalEntryDTO, idempotencyKey?: string): Promise<JournalEntryDTO> {
    if (ctx.user) {
      authorizationService.authorize({
        user: ctx.user,
        action: 'finance:gl:post',
        companyId: draft.companyId,
        ...(draft.sourceModule === 'MANUAL' && draft.createdBy ? { creatorId: draft.createdBy } : {})
      });
    }

    // Full Domain Model Validation
    JournalModel.validate(draft);

    let sourceKey: string | undefined;
    // 2. Layer 2 Business Source Document Idempotency Check
    if (draft.sourceDocumentId && draft.sourceDocumentId.trim() !== '') {
      sourceKey = `${ctx.tenantId}:${ctx.companyId}:${draft.sourceModule}:${draft.sourceDocumentType || ''}:${draft.sourceDocumentId}`;
      if (this.inFlightSourceDocs.has(sourceKey)) {
        throw new BusinessRuleViolationError(
          `SOURCE_DOCUMENT_ALREADY_POSTED: Source document '${draft.sourceDocumentId}' from module '${draft.sourceModule}' is already being posted to GL.`
        );
      }

      const store = (journalDraftService as any).journalsStore as Map<string, JournalEntryDTO> | undefined;
      if (store) {
        for (const [_, existing] of store.entries()) {
          if (
            existing.tenantId === ctx.tenantId &&
            existing.companyId === ctx.companyId &&
            existing.status === 'POSTED' &&
            existing.id !== draft.id &&
            existing.sourceModule === draft.sourceModule &&
            (existing.sourceDocumentType || null) === (draft.sourceDocumentType || null) &&
            existing.sourceDocumentId === draft.sourceDocumentId
          ) {
            throw new BusinessRuleViolationError(
              `SOURCE_DOCUMENT_ALREADY_POSTED: Source document '${draft.sourceDocumentId}' from module '${draft.sourceModule}' has already been posted to GL under voucher '${existing.voucherNumber}'.`
            );
          }
        }
      }
      this.inFlightSourceDocs.add(sourceKey);
    }

    try {
      // 1. Fiscal Period Resolution & Openness Assertions
      const acctDate = new Date(draft.accountingDate);
      const { fiscalYear, fiscalPeriod } = await fiscalPeriodService.resolvePeriod(ctx, draft.companyId, acctDate);
      await fiscalPeriodService.assertPeriodOpen(ctx, fiscalPeriod.id);

      // 2. COA Line Eligibility Validation
      for (const line of draft.lines) {
        const eligibility = await chartOfAccountsService.assertAccountEligibilityForPosting(ctx, line.accountId);
        
        if (eligibility.companyId !== ctx.companyId) {
          throw new ValidationError(`Company access denied for account '${eligibility.accountCode}'.`);
        }

        if (!eligibility.isEligibleForPosting) {
          throw new BusinessRuleViolationError(
            eligibility.ineligibilityReason || `Account '${eligibility.accountCode}' is not eligible for posting.`
          );
        }
      }

      const fiscalYearStr = draft.accountingDate.substring(0, 4);
      const lineBranch = draft.lines.find(l => l.branchId && l.branchId.trim() !== '')?.branchId || undefined;
      numberingEngine.configureSequence(ctx.tenantId!, ctx.companyId!, {
        documentType: 'JOURNAL_ENTRY',
        prefix: 'JV',
        fiscalYear: fiscalYearStr,
        branchCode: lineBranch,
        currentSequence: 0,
        paddingDigits: 4,
        resetOnFiscalYear: true
      });
      const voucherNumber = numberingEngine.generateNextNumber(
        ctx.tenantId!,
        ctx.companyId!,
        'JOURNAL_ENTRY',
        fiscalYearStr,
        lineBranch
      );

      const now = new Date();
      const postedBy = ctx.user?.userId || 'system';

      const postedDto: JournalEntryDTO = {
        ...draft,
        fiscalYearId: fiscalYear.id,
        fiscalPeriodId: fiscalPeriod.id,
        status: 'POSTED',
        voucherNumber,
        postingDate: now,
        postedBy,
        postedAt: now,
        version: draft.version + 1,
        updatedAt: now
      };

      // Update in-memory draft service store
      const storeKey = `${ctx.tenantId}:${ctx.companyId}:${journalId}`;
      (journalDraftService as any).journalsStore?.set(storeKey, postedDto);
      (journalDraftService as any).linesStore?.set(storeKey, postedDto.lines);

      // Save Layer 1 Request Idempotency Result
      if (idempotencyKey && idempotencyKey.trim() !== '') {
        await idempotencyService.saveResult(ctx, idempotencyKey, { journalEntryId: journalId, idempotencyKey }, 200, postedDto);
      }

      logger.info({
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        journalId,
        voucherNumber,
        msg: '[GL] Draft journal posted successfully (in-memory)'
      });

      await auditService.logEvent(ctx, {
        module: 'finance',
        entityName: 'JournalEntry',
        entityId: journalId,
        action: 'POST',
        newValues: {
          voucherNumber: postedDto.voucherNumber,
          totalDebit: postedDto.totalDebit,
          totalCredit: postedDto.totalCredit,
          sourceModule: postedDto.sourceModule,
          status: postedDto.status
        }
      });

      return postedDto;
    } finally {
      if (sourceKey) {
        this.inFlightSourceDocs.delete(sourceKey);
      }
    }
  }

  /**
   * Reverses a posted journal entry (Append-Only Reversal Engine).
   * Creates a new POSTED journal linked via originalJournalId with swapped debit/credit amounts.
   */
  public async reverseJournal(ctx: RequestContext, input: ReverseJournalInput): Promise<JournalEntryDTO> {
    if (!ctx.tenantId || !ctx.companyId) {
      throw new ValidationError('RequestContext tenantId and companyId are required.');
    }
    if (!input.originalJournalId || input.originalJournalId.trim() === '') {
      throw new ValidationError('Original journal ID is required for reversal.');
    }
    if (!input.reason || input.reason.trim() === '') {
      throw new ValidationError('Reversal reason is required.');
    }

    if (this.dbPool) {
      return this.reverseJournalDb(ctx, input);
    } else {
      return this.reverseJournalInMemory(ctx, input);
    }
  }

  private async reverseJournalDb(ctx: RequestContext, input: ReverseJournalInput): Promise<JournalEntryDTO> {
    const client = await this.dbPool!.connect();

    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.posting_authorized = 'true'");

      if (input.idempotencyKey && input.idempotencyKey.trim() !== '') {
        const check = await idempotencyService.checkOrClaim(
          ctx,
          input.idempotencyKey,
          { originalJournalId: input.originalJournalId, reason: input.reason, reversalAccountingDate: input.reversalAccountingDate },
          client
        );
        if (check.isDuplicate) {
          await client.query('COMMIT');
          return check.responseBody as JournalEntryDTO;
        }
      }

      const origRes = await client.query(
        `SELECT id, tenant_id, company_id, voucher_number, fiscal_year_id, fiscal_period_id, 
                accounting_date, posting_date, source_module, source_document_type, 
                source_document_id, original_journal_id, status, total_debit, total_credit, 
                currency, exchange_rate, narration, created_by, posted_by, posted_at, version
         FROM journal_entries 
         WHERE id = $1 AND tenant_id = $2 AND company_id = $3
         FOR UPDATE`,
        [input.originalJournalId, ctx.tenantId, ctx.companyId]
      );

      if (origRes.rows.length === 0) {
        throw new NotFoundError('JournalEntry', input.originalJournalId);
      }

      const orig = origRes.rows[0];

      if (ctx.user) {
        authorizationService.authorize({
          user: ctx.user,
          action: 'finance:gl:reverse',
          companyId: orig.company_id
        });
      }

      if (orig.status !== 'POSTED') {
        throw new BusinessRuleViolationError(
          `Cannot reverse journal '${input.originalJournalId}' with status '${orig.status}'. Only POSTED journals can be reversed.`
        );
      }

      if (orig.original_journal_id) {
        throw new BusinessRuleViolationError('Reversal of a reversal journal is strictly prohibited.');
      }

      const existingRevRes = await client.query(
        `SELECT id, voucher_number
         FROM journal_entries
         WHERE tenant_id = $1 AND company_id = $2 AND original_journal_id = $3 AND status = 'POSTED'
         FOR UPDATE`,
        [ctx.tenantId, ctx.companyId, input.originalJournalId]
      );

      if (existingRevRes.rows.length > 0) {
        const existingVoucher = existingRevRes.rows[0].voucher_number;
        throw new BusinessRuleViolationError(
          `Journal '${input.originalJournalId}' has already been reversed under voucher '${existingVoucher}'.`
        );
      }

      const linesRes = await client.query(
        `SELECT id, tenant_id, company_id, journal_entry_id, account_id, line_sequence,
                debit_amount, credit_amount, currency, exchange_rate, base_debit_amount,
                base_credit_amount, narration, party_type, party_id, branch_id, department_id
         FROM journal_lines
         WHERE journal_entry_id = $1 AND tenant_id = $2 AND company_id = $3
         ORDER BY line_sequence ASC`,
        [input.originalJournalId, ctx.tenantId, ctx.companyId]
      );

      let acctDateStr = input.reversalAccountingDate || orig.accounting_date;
      const acctDateObj = new Date(acctDateStr);

      const { fiscalYear, fiscalPeriod } = await fiscalPeriodService.resolvePeriod(ctx, ctx.companyId, acctDateObj);
      await fiscalPeriodService.assertPeriodOpen(ctx, fiscalPeriod.id);

      for (const lineRow of linesRes.rows) {
        const eligibility = await chartOfAccountsService.assertAccountEligibilityForPosting(ctx, lineRow.account_id);
        if (!eligibility.isEligibleForPosting) {
          throw new BusinessRuleViolationError(
            eligibility.ineligibilityReason || `Account '${eligibility.accountCode}' is not eligible for posting.`
          );
        }
      }

      const fiscalYearStr = acctDateStr.substring(0, 4);
      const lineBranch = linesRes.rows.find((l: any) => l.branch_id && l.branch_id.trim() !== '')?.branch_id || undefined;
      numberingEngine.configureSequence(ctx.tenantId!, ctx.companyId!, {
        documentType: 'JOURNAL_ENTRY',
        prefix: 'REV',
        fiscalYear: fiscalYearStr,
        branchCode: lineBranch,
        currentSequence: 0,
        paddingDigits: 4,
        resetOnFiscalYear: true
      });
      const voucherNumber = numberingEngine.generateNextNumber(
        ctx.tenantId!,
        ctx.companyId!,
        'JOURNAL_ENTRY',
        fiscalYearStr,
        lineBranch
      );

      const revJournalId = `je_rev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const now = new Date();
      const user = ctx.user?.userId || 'system';
      const narration = `Reversal of voucher ${orig.voucher_number || orig.id}: ${input.reason}`;

      try {
        await client.query(
          `INSERT INTO journal_entries (
            id, tenant_id, company_id, voucher_number, fiscal_year_id, fiscal_period_id,
            accounting_date, posting_date, source_module, source_document_type,
            source_document_id, original_journal_id, status, total_debit, total_credit,
            currency, exchange_rate, narration, created_by, posted_by, posted_at, version,
            created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, 'MANUAL', 'REVERSAL',
            NULL, $9, 'POSTED', $10, $11,
            $12, $13, $14, $15, $16, $17, 1,
            $18, $19
          )`,
          [
            revJournalId, ctx.tenantId, ctx.companyId, voucherNumber, fiscalYear.id, fiscalPeriod.id,
            acctDateStr, now, input.originalJournalId, orig.total_credit, orig.total_debit,
            orig.currency, orig.exchange_rate, narration, user, user, now,
            now, now
          ]
        );
      } catch (dbErr: any) {
        if (dbErr.code === '23505' && dbErr.constraint?.includes('original_journal')) {
          throw new BusinessRuleViolationError(`Journal '${input.originalJournalId}' has already been reversed.`);
        }
        throw dbErr;
      }

      const reversalLines: JournalLineDTO[] = [];
      for (const lineRow of linesRes.rows) {
        const lineId = `jl_rev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const swappedDebit = lineRow.credit_amount;
        const swappedCredit = lineRow.debit_amount;
        const swappedBaseDebit = lineRow.base_credit_amount;
        const swappedBaseCredit = lineRow.base_debit_amount;

        await client.query(
          `INSERT INTO journal_lines (
            id, tenant_id, company_id, journal_entry_id, account_id, line_sequence,
            debit_amount, credit_amount, currency, exchange_rate, base_debit_amount,
            base_credit_amount, narration, party_type, party_id, branch_id, department_id,
            created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11,
            $12, $13, $14, $15, $16, $17,
            $18
          )`,
          [
            lineId, ctx.tenantId, ctx.companyId, revJournalId, lineRow.account_id, lineRow.line_sequence,
            swappedDebit, swappedCredit, lineRow.currency, lineRow.exchange_rate, swappedBaseDebit,
            swappedBaseCredit, lineRow.narration || null, lineRow.party_type || null, lineRow.party_id || null,
            lineRow.branch_id || null, lineRow.department_id || null, now
          ]
        );

        reversalLines.push({
          id: lineId,
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          journalEntryId: revJournalId,
          accountId: lineRow.account_id,
          lineSequence: Number(lineRow.line_sequence),
          debitAmount: String(swappedDebit),
          creditAmount: String(swappedCredit),
          currency: lineRow.currency,
          exchangeRate: String(lineRow.exchange_rate),
          baseDebitAmount: String(swappedBaseDebit),
          baseCreditAmount: String(swappedBaseCredit),
          narration: lineRow.narration || null,
          partyType: lineRow.party_type || null,
          partyId: lineRow.party_id || null,
          branchId: lineRow.branch_id || null,
          departmentId: lineRow.department_id || null,
          createdAt: now
        });
      }

      const reversalDto: JournalEntryDTO = {
        id: revJournalId,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        voucherNumber,
        fiscalYearId: fiscalYear.id,
        fiscalPeriodId: fiscalPeriod.id,
        accountingDate: acctDateStr,
        postingDate: now,
        sourceModule: 'MANUAL',
        sourceDocumentType: 'REVERSAL',
        sourceDocumentId: null,
        originalJournalId: input.originalJournalId,
        status: 'POSTED',
        totalDebit: String(orig.total_credit),
        totalCredit: String(orig.total_debit),
        currency: orig.currency,
        exchangeRate: String(orig.exchange_rate),
        narration,
        createdBy: user,
        postedBy: user,
        postedAt: now,
        version: 1,
        createdAt: now,
        updatedAt: now,
        lines: reversalLines
      };

      if (input.idempotencyKey && input.idempotencyKey.trim() !== '') {
        await idempotencyService.saveResult(ctx, input.idempotencyKey, { originalJournalId: input.originalJournalId, reason: input.reason }, 200, reversalDto, client);
      }

      await client.query('COMMIT');

      logger.info({
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        originalJournalId: input.originalJournalId,
        reversalJournalId: revJournalId,
        voucherNumber,
        msg: '[GL] Reversal journal posted successfully'
      });

      await auditService.logEvent(ctx, {
        module: 'finance',
        entityName: 'JournalEntry',
        entityId: revJournalId,
        action: 'REVERSE',
        newValues: {
          originalJournalId: input.originalJournalId,
          voucherNumber: reversalDto.voucherNumber,
          totalDebit: reversalDto.totalDebit,
          totalCredit: reversalDto.totalCredit,
          status: reversalDto.status
        }
      });

      return reversalDto;
    } catch (err) {
      await client.query('ROLLBACK');
      if (input.idempotencyKey && input.idempotencyKey.trim() !== '') {
        idempotencyService.releaseClaim(ctx, input.idempotencyKey, err);
      }
      throw err;
    } finally {
      client.release();
    }
  }

  private async reverseJournalInMemory(ctx: RequestContext, input: ReverseJournalInput): Promise<JournalEntryDTO> {
    const lockKey = `${ctx.tenantId}:${ctx.companyId}:${input.originalJournalId}:reverse`;
    if (this.postingLocks.has(lockKey)) {
      throw new ConflictError(`Reversal operation for journal '${input.originalJournalId}' is already in progress.`);
    }
    this.postingLocks.add(lockKey);

    try {
      if (input.idempotencyKey && input.idempotencyKey.trim() !== '') {
        const check = await idempotencyService.checkOrClaim(ctx, input.idempotencyKey, input);
        if (check.isDuplicate) {
          return check.responseBody as JournalEntryDTO;
        }
      }

      const store = (journalDraftService as any).journalsStore as Map<string, JournalEntryDTO> | undefined;
      const linesStore = (journalDraftService as any).linesStore as Map<string, JournalLineDTO[]> | undefined;
      const storeKey = `${ctx.tenantId}:${ctx.companyId}:${input.originalJournalId}`;
      const origHeader = store?.get(storeKey);

      if (!origHeader) {
        throw new NotFoundError('JournalEntry', input.originalJournalId);
      }

      const origLines = (linesStore?.get(storeKey) || origHeader.lines || []).slice().sort((a, b) => a.lineSequence - b.lineSequence);
      const orig: JournalEntryDTO = { ...origHeader, lines: origLines };

      if (ctx.user) {
        authorizationService.authorize({
          user: ctx.user,
          action: 'finance:gl:reverse',
          companyId: orig.companyId
        });
      }

      if (orig.status !== 'POSTED') {
        throw new BusinessRuleViolationError(
          `Cannot reverse journal '${input.originalJournalId}' with status '${orig.status}'. Only POSTED journals can be reversed.`
        );
      }

      if (orig.originalJournalId) {
        throw new BusinessRuleViolationError('Reversal of a reversal journal is strictly prohibited.');
      }

      if (store) {
        for (const [_, existing] of store.entries()) {
          if (
            existing.tenantId === ctx.tenantId &&
            existing.companyId === ctx.companyId &&
            existing.status === 'POSTED' &&
            existing.originalJournalId === orig.id
          ) {
            throw new BusinessRuleViolationError(
              `Journal '${input.originalJournalId}' has already been reversed under voucher '${existing.voucherNumber}'.`
            );
          }
        }
      }

      const acctDateStr = input.reversalAccountingDate || orig.accountingDate;
      const acctDateObj = new Date(acctDateStr);
      const { fiscalYear, fiscalPeriod } = await fiscalPeriodService.resolvePeriod(ctx, ctx.companyId, acctDateObj);
      await fiscalPeriodService.assertPeriodOpen(ctx, fiscalPeriod.id);

      for (const line of orig.lines) {
        const eligibility = await chartOfAccountsService.assertAccountEligibilityForPosting(ctx, line.accountId);
        if (!eligibility.isEligibleForPosting) {
          throw new BusinessRuleViolationError(
            eligibility.ineligibilityReason || `Account '${eligibility.accountCode}' is not eligible for posting.`
          );
        }
      }

      const fiscalYearStr = acctDateStr.substring(0, 4);
      const lineBranch = orig.lines.find(l => l.branchId && l.branchId.trim() !== '')?.branchId || undefined;
      numberingEngine.configureSequence(ctx.tenantId!, ctx.companyId!, {
        documentType: 'JOURNAL_ENTRY',
        prefix: 'REV',
        fiscalYear: fiscalYearStr,
        branchCode: lineBranch,
        currentSequence: 0,
        paddingDigits: 4,
        resetOnFiscalYear: true
      });
      const voucherNumber = numberingEngine.generateNextNumber(
        ctx.tenantId!,
        ctx.companyId!,
        'JOURNAL_ENTRY',
        fiscalYearStr,
        lineBranch
      );

      const revId = `je_rev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const now = new Date();
      const user = ctx.user?.userId || 'system';
      const narration = `Reversal of voucher ${orig.voucherNumber || orig.id}: ${input.reason}`;

      const reversalLines: JournalLineDTO[] = orig.lines.map(line => ({
        id: `jl_rev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        journalEntryId: revId,
        accountId: line.accountId,
        lineSequence: line.lineSequence,
        debitAmount: line.creditAmount,
        creditAmount: line.debitAmount,
        currency: line.currency,
        exchangeRate: line.exchangeRate,
        baseDebitAmount: line.baseCreditAmount,
        baseCreditAmount: line.baseDebitAmount,
        narration: line.narration || null,
        partyType: line.partyType || null,
        partyId: line.partyId || null,
        branchId: line.branchId || null,
        departmentId: line.departmentId || null,
        createdAt: now
      }));

      const reversalDto: JournalEntryDTO = {
        id: revId,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        voucherNumber,
        fiscalYearId: fiscalYear.id,
        fiscalPeriodId: fiscalPeriod.id,
        accountingDate: acctDateStr,
        postingDate: now,
        sourceModule: 'MANUAL',
        sourceDocumentType: 'REVERSAL',
        sourceDocumentId: null,
        originalJournalId: orig.id,
        status: 'POSTED',
        totalDebit: orig.totalCredit,
        totalCredit: orig.totalDebit,
        currency: orig.currency,
        exchangeRate: orig.exchangeRate,
        narration,
        createdBy: user,
        postedBy: user,
        postedAt: now,
        version: 1,
        createdAt: now,
        updatedAt: now,
        lines: reversalLines
      };

      const newStoreKey = `${ctx.tenantId}:${ctx.companyId}:${revId}`;
      store?.set(newStoreKey, reversalDto);
      linesStore?.set(newStoreKey, reversalLines);

      if (input.idempotencyKey && input.idempotencyKey.trim() !== '') {
        await idempotencyService.saveResult(ctx, input.idempotencyKey, input, 200, reversalDto);
      }

      logger.info({
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        originalJournalId: orig.id,
        reversalJournalId: revId,
        voucherNumber,
        msg: '[GL] Reversal journal posted successfully (in-memory)'
      });

      await auditService.logEvent(ctx, {
        module: 'finance',
        entityName: 'JournalEntry',
        entityId: revId,
        action: 'REVERSE',
        newValues: {
          originalJournalId: input.originalJournalId,
          voucherNumber: reversalDto.voucherNumber,
          totalDebit: reversalDto.totalDebit,
          totalCredit: reversalDto.totalCredit,
          status: reversalDto.status
        }
      });

      return reversalDto;
    } catch (err) {
      if (input.idempotencyKey && input.idempotencyKey.trim() !== '') {
        idempotencyService.releaseClaim(ctx, input.idempotencyKey, err);
      }
      throw err;
    } finally {
      this.postingLocks.delete(lockKey);
    }
  }

  /**
   * Retrieves a journal entry by ID (draft or posted).
   */
  public async getJournalById(ctx: RequestContext, id: string): Promise<JournalEntryDTO> {
    if (!ctx.tenantId || !ctx.companyId) {
      throw new ValidationError('RequestContext tenantId and companyId are required.');
    }

    if (ctx.user) {
      const isAuthorized = ctx.user.permissions.some(p => 
        p === '*' || p.startsWith('finance:gl:') || p.startsWith('finance:draft:')
      );
      if (!isAuthorized) {
        authorizationService.authorize({ user: ctx.user, action: 'finance:gl:read', companyId: ctx.companyId });
      }
    }

    if (this.dbPool) {
      const entryRes = await this.dbPool.query(
        `SELECT * FROM journal_entries WHERE tenant_id = $1 AND company_id = $2 AND id = $3`,
        [ctx.tenantId, ctx.companyId, id]
      );
      if (entryRes.rows.length === 0) {
        throw new NotFoundError('JournalEntry', id);
      }
      const e = entryRes.rows[0];
      const linesRes = await this.dbPool.query(
        `SELECT * FROM journal_lines WHERE tenant_id = $1 AND company_id = $2 AND journal_entry_id = $3 ORDER BY line_sequence ASC`,
        [ctx.tenantId, ctx.companyId, id]
      );
      return {
        id: e.id,
        tenantId: e.tenant_id,
        companyId: e.company_id,
        voucherNumber: e.voucher_number,
        fiscalYearId: e.fiscal_year_id,
        fiscalPeriodId: e.fiscal_period_id,
        accountingDate: typeof e.accounting_date === 'string' ? e.accounting_date : e.accounting_date.toISOString().split('T')[0],
        postingDate: e.posting_date,
        sourceModule: e.source_module,
        sourceDocumentType: e.source_document_type,
        sourceDocumentId: e.source_document_id,
        originalJournalId: e.original_journal_id,
        status: e.status,
        totalDebit: e.total_debit.toString(),
        totalCredit: e.total_credit.toString(),
        currency: e.currency,
        exchangeRate: e.exchange_rate,
        narration: e.narration,
        createdBy: e.created_by,
        postedBy: e.posted_by,
        postedAt: e.posted_at,
        version: e.version,
        createdAt: e.created_at,
        updatedAt: e.updated_at,
        lines: linesRes.rows.map(l => ({
          id: l.id,
          tenantId: l.tenant_id,
          companyId: l.company_id,
          journalEntryId: l.journal_entry_id,
          accountId: l.account_id,
          lineSequence: l.line_sequence,
          debitAmount: l.debit_amount.toString(),
          creditAmount: l.credit_amount.toString(),
          currency: l.currency,
          exchangeRate: l.exchange_rate,
          baseDebitAmount: l.base_debit_amount.toString(),
          baseCreditAmount: l.base_credit_amount.toString(),
          narration: l.narration,
          partyType: l.party_type,
          partyId: l.party_id,
          branchId: l.branch_id,
          departmentId: l.department_id,
          createdAt: l.created_at
        }))
      };
    } else {
      return journalDraftService.getDraftById(ctx, id);
    }
  }

  /**
   * Retrieves GL transaction ledger view filtered by company, account, and date range.
   * Includes historical postings even for inactive accounts.
   */
  public async getLedgerView(ctx: RequestContext, query: { companyId?: string; accountId?: string; startDate?: string; endDate?: string; includeInactive?: boolean }): Promise<{
    companyId: string;
    entries: Array<{
      journalEntryId: string;
      voucherNumber: string | null;
      accountingDate: string;
      accountId: string;
      lineSequence: number;
      debitAmount: string;
      creditAmount: string;
      narration: string | null;
      sourceModule: string;
      sourceDocumentId: string | null;
      runningBalance: string;
    }>;
    totalDebit: string;
    totalCredit: string;
  }> {
    const targetCompanyId = query.companyId || ctx.companyId;
    if (!ctx.tenantId || !targetCompanyId) {
      throw new ValidationError('RequestContext tenantId and companyId are required.');
    }

    if (ctx.user) {
      const isAuthorized = ctx.user.permissions.some(p => 
        p === '*' || p.startsWith('finance:gl:') || p.startsWith('finance:draft:')
      );
      if (!isAuthorized) {
        authorizationService.authorize({ user: ctx.user, action: 'finance:gl:read', companyId: targetCompanyId });
      }
    }

    const entries: Array<{
      journalEntryId: string;
      voucherNumber: string | null;
      accountingDate: string;
      accountId: string;
      lineSequence: number;
      debitAmount: string;
      creditAmount: string;
      narration: string | null;
      sourceModule: string;
      sourceDocumentId: string | null;
      runningBalance: string;
    }> = [];

    let totalDebitDecimal = ExactDecimal.ZERO;
    let totalCreditDecimal = ExactDecimal.ZERO;
    let runningBalanceDecimal = ExactDecimal.ZERO;

    if (this.dbPool) {
      let sql = `
        SELECT jl.*, je.voucher_number, je.accounting_date, je.source_module, je.source_document_id
        FROM journal_lines jl
        JOIN journal_entries je ON jl.journal_entry_id = je.id
        WHERE jl.tenant_id = $1 AND jl.company_id = $2 AND je.status = 'POSTED'
      `;
      const params: any[] = [ctx.tenantId, targetCompanyId];
      if (query.accountId) {
        params.push(query.accountId);
        sql += ` AND jl.account_id = $${params.length}`;
      }
      if (query.startDate) {
        params.push(query.startDate);
        sql += ` AND je.accounting_date >= $${params.length}`;
      }
      if (query.endDate) {
        params.push(query.endDate);
        sql += ` AND je.accounting_date <= $${params.length}`;
      }
      sql += ` ORDER BY je.accounting_date ASC, je.id ASC, jl.line_sequence ASC`;

      const res = await this.dbPool.query(sql, params);
      for (const row of res.rows) {
        const debit = ExactDecimal.parse(row.debit_amount.toString());
        const credit = ExactDecimal.parse(row.credit_amount.toString());
        totalDebitDecimal = totalDebitDecimal.add(debit);
        totalCreditDecimal = totalCreditDecimal.add(credit);
        runningBalanceDecimal = runningBalanceDecimal.add(debit).sub(credit);

        entries.push({
          journalEntryId: row.journal_entry_id,
          voucherNumber: row.voucher_number,
          accountingDate: typeof row.accounting_date === 'string' ? row.accounting_date : row.accounting_date.toISOString().split('T')[0],
          accountId: row.account_id,
          lineSequence: row.line_sequence,
          debitAmount: debit.toString(),
          creditAmount: credit.toString(),
          narration: row.narration,
          sourceModule: row.source_module,
          sourceDocumentId: row.source_document_id,
          runningBalance: runningBalanceDecimal.toString()
        });
      }
    } else {
      const store = (journalDraftService as any).journalsStore as Map<string, JournalEntryDTO> | undefined;
      const linesStore = (journalDraftService as any).linesStore as Map<string, JournalLineDTO[]> | undefined;
      if (store) {
        const postedJournals: JournalEntryDTO[] = [];
        for (const [storeKey, journal] of store.entries()) {
          if (
            journal.tenantId === ctx.tenantId &&
            journal.companyId === targetCompanyId &&
            journal.status === 'POSTED'
          ) {
            if (query.startDate && journal.accountingDate < query.startDate) continue;
            if (query.endDate && journal.accountingDate > query.endDate) continue;
            const lines = linesStore?.get(storeKey) || journal.lines || [];
            postedJournals.push({ ...journal, lines });
          }
        }
        postedJournals.sort((a, b) => a.accountingDate.localeCompare(b.accountingDate));

        for (const j of postedJournals) {
          for (const line of j.lines) {
            if (query.accountId && line.accountId !== query.accountId) continue;

            const debit = ExactDecimal.parse(line.debitAmount);
            const credit = ExactDecimal.parse(line.creditAmount);
            totalDebitDecimal = totalDebitDecimal.add(debit);
            totalCreditDecimal = totalCreditDecimal.add(credit);
            runningBalanceDecimal = runningBalanceDecimal.add(debit).sub(credit);

            entries.push({
              journalEntryId: j.id!,
              voucherNumber: j.voucherNumber ?? null,
              accountingDate: j.accountingDate,
              accountId: line.accountId,
              lineSequence: line.lineSequence,
              debitAmount: debit.toString(),
              creditAmount: credit.toString(),
              narration: line.narration || null,
              sourceModule: j.sourceModule,
              sourceDocumentId: j.sourceDocumentId || null,
              runningBalance: runningBalanceDecimal.toString()
            });
          }
        }
      }
    }

    return {
      companyId: targetCompanyId,
      entries,
      totalDebit: totalDebitDecimal.toString(),
      totalCredit: totalCreditDecimal.toString()
    };
  }

  /**
   * Retrieves Trial Balance as of a given date.
   * Aggregates posted account balances and includes historical inactive accounts with transaction history.
   */
  public async getTrialBalance(ctx: RequestContext, query: { companyId?: string; asOfDate?: string; includeInactive?: boolean }): Promise<{
    companyId: string;
    asOfDate: string;
    rows: Array<{
      accountId: string;
      accountCode: string;
      accountName: string;
      accountType: string;
      status: string;
      totalDebit: string;
      totalCredit: string;
      netBalance: string;
    }>;
    summary: {
      totalDebit: string;
      totalCredit: string;
      isBalanced: boolean;
    };
  }> {
    const targetCompanyId = query.companyId || ctx.companyId;
    if (!ctx.tenantId || !targetCompanyId) {
      throw new ValidationError('RequestContext tenantId and companyId are required.');
    }

    if (ctx.user) {
      const isAuthorized = ctx.user.permissions.some(p => 
        p === '*' || p.startsWith('finance:gl:') || p.startsWith('finance:draft:')
      );
      if (!isAuthorized) {
        authorizationService.authorize({ user: ctx.user, action: 'finance:gl:read', companyId: targetCompanyId });
      }
    }

    const targetAsOfDate: string = query.asOfDate || new Date().toISOString().split('T')[0]!;

    const accounts = await chartOfAccountsService.getAccountsList(ctx, targetCompanyId, {
      isPostable: true,
      ...(query.includeInactive !== true ? { status: 'ACTIVE' } : {})
    });

    const accountMap = new Map<string, {
      account: typeof accounts[0];
      debit: ExactDecimal;
      credit: ExactDecimal;
    }>();

    for (const acc of accounts) {
      accountMap.set(acc.id, {
        account: acc,
        debit: ExactDecimal.ZERO,
        credit: ExactDecimal.ZERO
      });
    }

    if (this.dbPool) {
      const sql = `
        SELECT jl.account_id, SUM(jl.debit_amount)::numeric(20,2) as sum_debit, SUM(jl.credit_amount)::numeric(20,2) as sum_credit
        FROM journal_lines jl
        JOIN journal_entries je ON jl.journal_entry_id = je.id
        WHERE jl.tenant_id = $1 AND jl.company_id = $2 AND je.status = 'POSTED' AND je.accounting_date <= $3
        GROUP BY jl.account_id
      `;
      const res = await this.dbPool.query(sql, [ctx.tenantId, targetCompanyId, targetAsOfDate]);
      for (const row of res.rows) {
        const accId = row.account_id;
        let entry = accountMap.get(accId);
        if (!entry) {
          const fullAcc = await chartOfAccountsService.getAccountById(ctx, accId).catch(() => null);
          if (fullAcc) {
            entry = { account: fullAcc, debit: ExactDecimal.ZERO, credit: ExactDecimal.ZERO };
            accountMap.set(accId, entry);
          }
        }
        if (entry) {
          entry.debit = ExactDecimal.parse(row.sum_debit.toString());
          entry.credit = ExactDecimal.parse(row.sum_credit.toString());
        }
      }
    } else {
      const store = (journalDraftService as any).journalsStore as Map<string, JournalEntryDTO> | undefined;
      const linesStore = (journalDraftService as any).linesStore as Map<string, JournalLineDTO[]> | undefined;
      if (store) {
        for (const [storeKey, journal] of store.entries()) {
          if (
            journal.tenantId === ctx.tenantId &&
            journal.companyId === targetCompanyId &&
            journal.status === 'POSTED' &&
            journal.accountingDate <= targetAsOfDate
          ) {
            const lines = linesStore?.get(storeKey) || journal.lines || [];
            for (const line of lines) {
              let entry = accountMap.get(line.accountId);
              if (!entry) {
                const fullAcc = await chartOfAccountsService.getAccountById(ctx, line.accountId).catch(() => null);
                if (fullAcc) {
                  entry = { account: fullAcc, debit: ExactDecimal.ZERO, credit: ExactDecimal.ZERO };
                  accountMap.set(line.accountId, entry);
                }
              }
              if (entry) {
                entry.debit = entry.debit.add(ExactDecimal.parse(line.debitAmount));
                entry.credit = entry.credit.add(ExactDecimal.parse(line.creditAmount));
              }
            }
          }
        }
      }
    }

    const rows: Array<{
      accountId: string;
      accountCode: string;
      accountName: string;
      accountType: string;
      status: string;
      totalDebit: string;
      totalCredit: string;
      netBalance: string;
    }> = [];

    let overallDebit = ExactDecimal.ZERO;
    let overallCredit = ExactDecimal.ZERO;

    for (const [accId, entry] of accountMap.entries()) {
      if (query.includeInactive !== true && entry.account.status === 'INACTIVE' && entry.debit.isZero() && entry.credit.isZero()) {
        continue;
      }
      overallDebit = overallDebit.add(entry.debit);
      overallCredit = overallCredit.add(entry.credit);
      const net = entry.debit.sub(entry.credit);

      rows.push({
        accountId: accId,
        accountCode: entry.account.accountCode,
        accountName: entry.account.accountName,
        accountType: entry.account.accountType,
        status: entry.account.status,
        totalDebit: entry.debit.toString(),
        totalCredit: entry.credit.toString(),
        netBalance: net.toString()
      });
    }

    rows.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    return {
      companyId: targetCompanyId,
      asOfDate: targetAsOfDate,
      rows,
      summary: {
        totalDebit: overallDebit.toString(),
        totalCredit: overallCredit.toString(),
        isBalanced: overallDebit.equals(overallCredit)
      }
    };
  }
}

export const glEngine = new GLEngine();
