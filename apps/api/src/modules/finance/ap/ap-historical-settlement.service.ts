import {
  RequestContext,
  ValidationError,
  BusinessRuleViolationError,
  ExactDecimal
} from '@general-erp/core';
import { authorizationService } from '../../../platform/authorization/authorization.service.js';
import { masterDataService } from '../../../platform/master-data/master-data.service.js';
import { apDocumentService } from './ap-document.service.js';
import { apPaymentService } from './ap-payment.service.js';
import { apAllocationService } from './ap-allocation.service.js';
import { apAdjustmentService } from './ap-adjustment.service.js';
import { chartOfAccountsService } from '../chart-of-accounts.service.js';
import { accountingConfigurationService } from '../accounting-core.service.js';
import { journalDraftService } from '../journal-draft.service.js';
import { JournalEntryDTO, JournalLineDTO } from '../journal-model.js';
import {
  ApOpenItemSettlementDTO,
  ApSourceUtilizationDTO,
  SupplierSettlementSummaryDTO,
  ApReconciliationResultDTO,
  ApReconciliationDiagnosticDTO,
  ApReconciliationStatus,
  ApSourceUtilizationType
} from './ap-settlement-model.js';
import { ApSettlementValidator } from './ap-settlement-validator.js';
import { ApSettlementFoundation } from './ap-settlement-foundation.js';
import type pg from 'pg';

export class ApHistoricalSettlementService {
  private dbPool?: pg.Pool | undefined;

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
    apDocumentService.setDbPool(pool);
    apPaymentService.setDbPool(pool);
    apAllocationService.setDbPool(pool);
    apAdjustmentService.setDbPool(pool);
  }

  public getDbPool(): pg.Pool | undefined {
    return this.dbPool;
  }

  private authorize(ctx: RequestContext, action: string, companyId: string): void {
    if (ctx.user) {
      const isWildcard = ctx.user.permissions.some(
        p => p === '*' || p === action || p.startsWith('ap:settlement:') || p.startsWith('ap:reconciliation:')
      );
      if (!isWildcard) {
        authorizationService.authorize({ user: ctx.user, action, companyId });
      }
    }
  }

  /**
   * Reconstructs historical open item settlement position as of YYYY-MM-DD.
   */
  public async getHistoricalOpenItemSettlement(
    ctx: RequestContext,
    openItemId: string,
    asOfDate: string
  ): Promise<ApOpenItemSettlementDTO> {
    ApSettlementValidator.validateAsOfDate(asOfDate);
    if (!asOfDate || asOfDate.trim() === '') {
      throw new ValidationError('asOfDate is required for historical open item settlement calculation.');
    }

    const openItem = await apDocumentService.getOpenItem(ctx, openItemId);
    ApSettlementValidator.validateCompanyContext(ctx, openItem.companyId);
    this.authorize(ctx, 'ap:settlement:read', openItem.companyId);

    const executeRead = async (): Promise<ApOpenItemSettlementDTO> => {
      const doc = await apDocumentService.getDocument(ctx, openItem.apDocumentId);
      const docRevDate = (doc as any).reversalAccountingDate || (doc.status === 'REVERSED' ? doc.updatedAt.toISOString().substring(0, 10) : null);

      const isPostedAsOf = ApSettlementFoundation.isTransactionEffectiveAsOf(doc.accountingDate, asOfDate);
      if (!isPostedAsOf) {
        throw new BusinessRuleViolationError(
          `Open item '${openItemId}' was posted on accountingDate '${doc.accountingDate}', which is after requested asOfDate '${asOfDate}'.`
        );
      }

      const isDocReversedAsOf = ApSettlementFoundation.isReversalEffectiveAsOf(docRevDate, asOfDate);
      if (isDocReversedAsOf) {
        throw new BusinessRuleViolationError(
          `Open item '${openItemId}' parent document was reversed on reversalAccountingDate '${docRevDate}', which is on or before requested asOfDate '${asOfDate}'.`
        );
      }

      const allAllocations = await apAllocationService.listAllocations(ctx, openItem.companyId, { openItemId });
      const allAdjustments = await apAdjustmentService.listAdjustments(ctx, openItem.companyId, { openItemId });

      let activeAllocDec = ExactDecimal.ZERO;
      let activeDiscDec = ExactDecimal.ZERO;
      let activeWriteOffsDec = ExactDecimal.ZERO;
      let activeCreditAdjDec = ExactDecimal.ZERO;
      let activeDebitAdjDec = ExactDecimal.ZERO;

      for (const alloc of allAllocations) {
        const isAllocEffective = ApSettlementFoundation.isAllocationEffectiveAsOf(alloc.allocationDate, asOfDate);
        const allocRevDate = (alloc as any).reversalAccountingDate || (alloc.reversedAt ? alloc.reversedAt.toISOString().substring(0, 10) : null);
        const isRevEffective = ApSettlementFoundation.isReversalEffectiveAsOf(allocRevDate, asOfDate);

        if (isAllocEffective && !isRevEffective) {
          activeAllocDec = activeAllocDec.add(ExactDecimal.parse(alloc.allocatedAmount, 2));
          activeDiscDec = activeDiscDec.add(ExactDecimal.parse(alloc.discountAmount, 2));
        }
      }

      for (const adj of allAdjustments) {
        const isAdjEffective = ApSettlementFoundation.isTransactionEffectiveAsOf(adj.accountingDate, asOfDate);
        const adjRevDate = adj.reversalAccountingDate || (adj.status === 'REVERSED' && adj.reversedAt ? adj.reversedAt.toISOString().substring(0, 10) : null);
        const isRevEffective = ApSettlementFoundation.isReversalEffectiveAsOf(adjRevDate, asOfDate);

        if (isAdjEffective && !isRevEffective && (adj.status === 'POSTED' || adj.status === 'REVERSED')) {
          const adjAmtDec = ExactDecimal.parse(adj.amount, 2);
          if (adj.adjustmentType === 'WRITE_OFF') {
            activeWriteOffsDec = activeWriteOffsDec.add(adjAmtDec);
          } else if (adj.adjustmentType === 'CREDIT_ADJUSTMENT') {
            activeCreditAdjDec = activeCreditAdjDec.add(adjAmtDec);
          } else if (adj.adjustmentType === 'DEBIT_ADJUSTMENT') {
            activeDebitAdjDec = activeDebitAdjDec.add(adjAmtDec);
          }
        }
      }

      const origAmountDec = ExactDecimal.parse(openItem.originalAmount, 2);
      const totalDeductionDec = activeAllocDec.add(activeDiscDec).add(activeWriteOffsDec).add(activeCreditAdjDec);
      const effectiveOriginalDec = origAmountDec.add(activeDebitAdjDec);

      if (totalDeductionDec.compare(effectiveOriginalDec) > 0) {
        throw new BusinessRuleViolationError(
          `Open item '${openItemId}' historical balance corrupted: total deductions (${totalDeductionDec.toString()}) exceed effective total original amount (${effectiveOriginalDec.toString()}) as of '${asOfDate}'.`
        );
      }

      const outstandingDec = effectiveOriginalDec.sub(totalDeductionDec);
      if (outstandingDec.isNegative()) {
        throw new BusinessRuleViolationError(
          `Open item '${openItemId}' historical balance corrupted: outstanding amount '${outstandingDec.toString()}' is negative as of '${asOfDate}'.`
        );
      }

      const outstandingStr = outstandingDec.toString();
      const settlementStatus = ApSettlementFoundation.calculateSettlementStatus(effectiveOriginalDec.toString(), outstandingStr);

      return {
        openItemId: openItem.id,
        tenantId: ctx.tenantId,
        companyId: openItem.companyId,
        supplierId: openItem.supplierId,
        apDocumentId: openItem.apDocumentId,
        documentNumber: doc.documentNumber || '',
        documentType: openItem.documentType,
        documentDate: doc.documentDate,
        accountingDate: doc.accountingDate,
        dueDate: openItem.dueDate,
        originalAmount: openItem.originalAmount,
        activeAllocationsTotal: activeAllocDec.toString(),
        activeDiscountsTotal: activeDiscDec.toString(),
        activeWriteOffsTotal: activeWriteOffsDec.toString(),
        activeCreditAdjustmentsTotal: activeCreditAdjDec.toString(),
        activeDebitAdjustmentsTotal: activeDebitAdjDec.toString(),
        outstandingAmount: outstandingStr,
        settlementStatus,
        asOfDate
      };
    };

    if (this.dbPool) {
      return ApSettlementFoundation.withReadOnlySnapshot(this.dbPool, executeRead);
    }
    return executeRead();
  }

  /**
   * Reconstructs historical credit source utilization (Payment or Credit Note) as of YYYY-MM-DD.
   */
  public async getHistoricalSourceUtilization(
    ctx: RequestContext,
    sourceType: ApSourceUtilizationType,
    sourceId: string,
    asOfDate: string
  ): Promise<ApSourceUtilizationDTO> {
    ApSettlementValidator.validateAsOfDate(asOfDate);
    if (!asOfDate || asOfDate.trim() === '') {
      throw new ValidationError('asOfDate is required for historical source utilization calculation.');
    }

    if (sourceType !== 'PAYMENT' && sourceType !== 'CREDIT_NOTE') {
      throw new ValidationError(`Invalid sourceType '${sourceType}'. Allowed values: 'PAYMENT', 'CREDIT_NOTE'.`);
    }

    const executeRead = async (): Promise<ApSourceUtilizationDTO> => {
      let companyId = '';
      let supplierId = '';
      let sourceNumber = '';
      let sourceDate = '';
      let accountingDate = '';
      let totalAmountStr = '0.00';
      let reversalAccountingDate: string | null = null;

      if (sourceType === 'PAYMENT') {
        const payment = await apPaymentService.getPayment(ctx, sourceId);
        ApSettlementValidator.validateCompanyContext(ctx, payment.companyId);
        this.authorize(ctx, 'ap:settlement:read', payment.companyId);

        companyId = payment.companyId;
        supplierId = payment.supplierId;
        sourceNumber = payment.paymentNumber || '';
        sourceDate = payment.paymentDate;
        accountingDate = payment.accountingDate;
        totalAmountStr = payment.totalAmount;
        reversalAccountingDate = (payment as any).reversalAccountingDate || (payment.status === 'REVERSED' ? payment.updatedAt.toISOString().substring(0, 10) : null);
      } else {
        const creditNote = await apDocumentService.getDocument(ctx, sourceId);
        if (creditNote.documentType !== 'CREDIT_NOTE') {
          throw new ValidationError(`Document '${sourceId}' is a '${creditNote.documentType}', not a CREDIT_NOTE.`);
        }
        ApSettlementValidator.validateCompanyContext(ctx, creditNote.companyId);
        this.authorize(ctx, 'ap:settlement:read', creditNote.companyId);

        companyId = creditNote.companyId;
        supplierId = creditNote.supplierId;
        sourceNumber = creditNote.documentNumber || '';
        sourceDate = creditNote.documentDate;
        accountingDate = creditNote.accountingDate;
        totalAmountStr = creditNote.grossAmount;
        reversalAccountingDate = (creditNote as any).reversalAccountingDate || (creditNote.status === 'REVERSED' ? creditNote.updatedAt.toISOString().substring(0, 10) : null);
      }

      const isPostedAsOf = ApSettlementFoundation.isTransactionEffectiveAsOf(accountingDate, asOfDate);
      if (!isPostedAsOf) {
        throw new BusinessRuleViolationError(
          `Source '${sourceId}' was posted on accountingDate '${accountingDate}', which is after requested asOfDate '${asOfDate}'.`
        );
      }

      const isReversedAsOf = ApSettlementFoundation.isReversalEffectiveAsOf(reversalAccountingDate, asOfDate);
      if (isReversedAsOf) {
        throw new BusinessRuleViolationError(
          `Source '${sourceId}' was reversed on reversalAccountingDate '${reversalAccountingDate}', which is on or before requested asOfDate '${asOfDate}'.`
        );
      }

      const filterInput = sourceType === 'PAYMENT' ? { paymentId: sourceId } : { creditNoteId: sourceId };
      const allAllocations = await apAllocationService.listAllocations(ctx, companyId, filterInput);

      let allocatedDec = ExactDecimal.ZERO;

      for (const alloc of allAllocations) {
        const isAllocEffective = ApSettlementFoundation.isAllocationEffectiveAsOf(alloc.allocationDate, asOfDate);
        const allocRevDate = (alloc as any).reversalAccountingDate || (alloc.reversedAt ? alloc.reversedAt.toISOString().substring(0, 10) : null);
        const isRevEffective = ApSettlementFoundation.isReversalEffectiveAsOf(allocRevDate, asOfDate);

        if (isAllocEffective && !isRevEffective) {
          allocatedDec = allocatedDec.add(ExactDecimal.parse(alloc.allocatedAmount, 2));
        }
      }

      const totalDec = ExactDecimal.parse(totalAmountStr, 2);
      if (allocatedDec.compare(totalDec) > 0) {
        throw new BusinessRuleViolationError(
          `Source '${sourceId}' historical utilization corrupted: allocated amount '${allocatedDec.toString()}' exceeds total amount '${totalAmountStr}' as of '${asOfDate}'.`
        );
      }

      const unappliedDec = totalDec.sub(allocatedDec);
      const allocatedStr = allocatedDec.toString();
      const unappliedStr = unappliedDec.toString();

      const utilizationStatus = ApSettlementFoundation.calculateSourceUtilization(allocatedStr, unappliedStr, totalAmountStr);

      return {
        sourceId,
        sourceType,
        tenantId: ctx.tenantId,
        companyId,
        supplierId,
        sourceNumber,
        sourceDate,
        accountingDate,
        totalAmount: totalAmountStr,
        allocatedAmount: allocatedStr,
        unappliedAmount: unappliedStr,
        utilizationStatus,
        asOfDate
      };
    };

    if (this.dbPool) {
      return ApSettlementFoundation.withReadOnlySnapshot(this.dbPool, executeRead);
    }
    return executeRead();
  }

  /**
   * Reconstructs historical supplier settlement summary as of YYYY-MM-DD.
   */
  public async getHistoricalSupplierSettlementSummary(
    ctx: RequestContext,
    supplierId: string,
    asOfDate: string
  ): Promise<SupplierSettlementSummaryDTO> {
    ApSettlementValidator.validateSupplierContext(supplierId);
    ApSettlementValidator.validateAsOfDate(asOfDate);
    if (!asOfDate || asOfDate.trim() === '') {
      throw new ValidationError('asOfDate is required for historical supplier settlement summary.');
    }

    const companyId = ctx.companyId;
    if (!companyId || companyId.trim() === '') {
      throw new ValidationError('RequestContext companyId is required for historical supplier settlement summary.');
    }
    ApSettlementValidator.validateCompanyContext(ctx, companyId);
    this.authorize(ctx, 'ap:settlement:read', companyId);

    const supplier = await masterDataService.getSupplier(ctx, supplierId);
    if (supplier.companyId !== companyId) {
      throw new ValidationError(
        `Supplier '${supplierId}' belongs to company '${supplier.companyId}', not request company '${companyId}'.`
      );
    }

    const executeRead = async (): Promise<SupplierSettlementSummaryDTO> => {
      // 1. Historical Open Items Aggregation
      const allOpenItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const eligibleOpenItems = allOpenItems.filter(item => item.documentType !== 'CREDIT_NOTE');

      let totalPostedBillsDec = ExactDecimal.ZERO;
      let totalOutstandingBillsDec = ExactDecimal.ZERO;
      let totalActiveAllocDec = ExactDecimal.ZERO;
      let totalPromptDiscDec = ExactDecimal.ZERO;
      let openItemsCount = 0;

      for (const item of eligibleOpenItems) {
        const doc = await apDocumentService.getDocument(ctx, item.apDocumentId);
        const revDate = (doc as any).reversalAccountingDate || (doc.status === 'REVERSED' ? doc.updatedAt.toISOString().substring(0, 10) : null);
        const isIncluded = ApSettlementFoundation.isEntityIncludedAsOf(doc.accountingDate, revDate, asOfDate);

        if (isIncluded) {
          const settlement = await this.getHistoricalOpenItemSettlement(ctx, item.id, asOfDate);
          const origDec = ExactDecimal.parse(settlement.originalAmount, 2);
          const outDec = ExactDecimal.parse(settlement.outstandingAmount, 2);
          const allocDec = ExactDecimal.parse(settlement.activeAllocationsTotal, 2);
          const discDec = ExactDecimal.parse(settlement.activeDiscountsTotal, 2);

          totalPostedBillsDec = totalPostedBillsDec.add(origDec);
          totalOutstandingBillsDec = totalOutstandingBillsDec.add(outDec);
          totalActiveAllocDec = totalActiveAllocDec.add(allocDec);
          totalPromptDiscDec = totalPromptDiscDec.add(discDec);

          if (outDec.isPositive()) {
            openItemsCount++;
          }
        }
      }

      // 2. Historical Payment Credit Sources Aggregation
      const allPayments = await apPaymentService.listPayments(ctx, companyId, { supplierId });
      let totalPaymentsDec = ExactDecimal.ZERO;
      let totalUnappliedPayDec = ExactDecimal.ZERO;

      for (const payment of allPayments) {
        const revDate = (payment as any).reversalAccountingDate || (payment.status === 'REVERSED' ? payment.updatedAt.toISOString().substring(0, 10) : null);
        const isIncluded = ApSettlementFoundation.isEntityIncludedAsOf(payment.accountingDate, revDate, asOfDate);

        if (isIncluded) {
          const util = await this.getHistoricalSourceUtilization(ctx, 'PAYMENT', payment.id, asOfDate);
          totalPaymentsDec = totalPaymentsDec.add(ExactDecimal.parse(util.totalAmount, 2));
          totalUnappliedPayDec = totalUnappliedPayDec.add(ExactDecimal.parse(util.unappliedAmount, 2));
        }
      }

      // 3. Historical Credit Note Sources Aggregation
      const allCreditNotes = await apDocumentService.listDocuments(ctx, companyId, { supplierId, documentType: 'CREDIT_NOTE' });
      let totalCreditNotesDec = ExactDecimal.ZERO;
      let totalUnappliedCnDec = ExactDecimal.ZERO;

      for (const cn of allCreditNotes) {
        const revDate = (cn as any).reversalAccountingDate || (cn.status === 'REVERSED' ? cn.updatedAt.toISOString().substring(0, 10) : null);
        const isIncluded = ApSettlementFoundation.isEntityIncludedAsOf(cn.accountingDate, revDate, asOfDate);

        if (isIncluded) {
          const util = await this.getHistoricalSourceUtilization(ctx, 'CREDIT_NOTE', cn.id, asOfDate);
          totalCreditNotesDec = totalCreditNotesDec.add(ExactDecimal.parse(util.totalAmount, 2));
          totalUnappliedCnDec = totalUnappliedCnDec.add(ExactDecimal.parse(util.unappliedAmount, 2));
        }
      }

      const totalOutstandingBillsStr = totalOutstandingBillsDec.toString();
      const totalUnappliedPaymentsStr = totalUnappliedPayDec.toString();
      const totalUnappliedCreditNotesStr = totalUnappliedCnDec.toString();

      const netPayableStr = ApSettlementFoundation.calculateNetSupplierPayable(
        totalOutstandingBillsStr,
        totalUnappliedPaymentsStr,
        totalUnappliedCreditNotesStr
      );

      return {
        tenantId: ctx.tenantId,
        companyId,
        supplierId,
        supplierName: supplier.name,
        totalPostedBillsAmount: totalPostedBillsDec.toString(),
        totalOutstandingBillsAmount: totalOutstandingBillsStr,
        openItemsCount,
        totalPaymentsAmount: totalPaymentsDec.toString(),
        totalUnappliedPaymentsAmount: totalUnappliedPaymentsStr,
        totalCreditNotesAmount: totalCreditNotesDec.toString(),
        totalUnappliedCreditNotesAmount: totalUnappliedCreditNotesStr,
        totalActiveAllocationsAmount: totalActiveAllocDec.toString(),
        totalPromptPaymentDiscountsAmount: totalPromptDiscDec.toString(),
        netPayableAmount: netPayableStr,
        asOfDate
      };
    };

    if (this.dbPool) {
      return ApSettlementFoundation.withReadOnlySnapshot(this.dbPool, executeRead);
    }
    return executeRead();
  }

  /**
   * Reconciles historical AP Subledger Net Payable against GL AP_CONTROL Signed Balance as of YYYY-MM-DD.
   */
  public async reconcileHistoricalCompanyAP(
    ctx: RequestContext,
    companyId: string,
    asOfDate: string
  ): Promise<ApReconciliationResultDTO> {
    ApSettlementValidator.validateCompanyContext(ctx, companyId);
    ApSettlementValidator.validateAsOfDate(asOfDate);
    if (!asOfDate || asOfDate.trim() === '') {
      throw new ValidationError('asOfDate is required for historical company AP reconciliation.');
    }
    this.authorize(ctx, 'ap:settlement:reconcile', companyId);

    const executeRead = async (): Promise<ApReconciliationResultDTO> => {
      const diagnostics: ApReconciliationDiagnosticDTO[] = [];

      let subledgerOutstandingDec = ExactDecimal.ZERO;
      let subledgerUnappliedPayDec = ExactDecimal.ZERO;
      let subledgerUnappliedCnDec = ExactDecimal.ZERO;

      // 1. Historical Open Items Aggregation
      const allOpenItems = await apDocumentService.getOpenItems(ctx, companyId);
      const eligibleOpenItems = allOpenItems.filter(i => i.documentType !== 'CREDIT_NOTE');

      for (const item of eligibleOpenItems) {
        const doc = await apDocumentService.getDocument(ctx, item.apDocumentId);
        const revDate = (doc as any).reversalAccountingDate || (doc.status === 'REVERSED' ? doc.updatedAt.toISOString().substring(0, 10) : null);
        const isIncluded = ApSettlementFoundation.isEntityIncludedAsOf(doc.accountingDate, revDate, asOfDate);

        if (isIncluded) {
          try {
            const settlement = await this.getHistoricalOpenItemSettlement(ctx, item.id, asOfDate);
            subledgerOutstandingDec = subledgerOutstandingDec.add(ExactDecimal.parse(settlement.outstandingAmount, 2));
          } catch (err: any) {
            diagnostics.push({
              code: 'OPEN_ITEM_BALANCE_MISMATCH',
              severity: 'ERROR',
              message: `Historical open item '${item.id}' balance evaluation failed as of '${asOfDate}': ${err.message}`,
              details: { openItemId: item.id, asOfDate }
            });
          }
        }
      }

      // 2. Historical Payment Credit Sources Aggregation
      const allPayments = await apPaymentService.listPayments(ctx, companyId);
      for (const payment of allPayments) {
        const revDate = (payment as any).reversalAccountingDate || (payment.status === 'REVERSED' ? payment.updatedAt.toISOString().substring(0, 10) : null);
        const isIncluded = ApSettlementFoundation.isEntityIncludedAsOf(payment.accountingDate, revDate, asOfDate);

        if (isIncluded) {
          try {
            const util = await this.getHistoricalSourceUtilization(ctx, 'PAYMENT', payment.id, asOfDate);
            subledgerUnappliedPayDec = subledgerUnappliedPayDec.add(ExactDecimal.parse(util.unappliedAmount, 2));
          } catch (err: any) {
            diagnostics.push({
              code: 'SOURCE_BALANCE_MISMATCH',
              severity: 'ERROR',
              message: `Historical payment source '${payment.id}' utilization evaluation failed as of '${asOfDate}': ${err.message}`,
              details: { sourceId: payment.id, sourceType: 'PAYMENT', asOfDate }
            });
          }
        }
      }

      // 3. Historical Credit Note Sources Aggregation
      const allCreditNotes = await apDocumentService.listDocuments(ctx, companyId, { documentType: 'CREDIT_NOTE' });
      for (const cn of allCreditNotes) {
        const revDate = (cn as any).reversalAccountingDate || (cn.status === 'REVERSED' ? cn.updatedAt.toISOString().substring(0, 10) : null);
        const isIncluded = ApSettlementFoundation.isEntityIncludedAsOf(cn.accountingDate, revDate, asOfDate);

        if (isIncluded) {
          try {
            const util = await this.getHistoricalSourceUtilization(ctx, 'CREDIT_NOTE', cn.id, asOfDate);
            subledgerUnappliedCnDec = subledgerUnappliedCnDec.add(ExactDecimal.parse(util.unappliedAmount, 2));
          } catch (err: any) {
            diagnostics.push({
              code: 'SOURCE_BALANCE_MISMATCH',
              severity: 'ERROR',
              message: `Historical credit note source '${cn.id}' utilization evaluation failed as of '${asOfDate}': ${err.message}`,
              details: { sourceId: cn.id, sourceType: 'CREDIT_NOTE', asOfDate }
            });
          }
        }
      }

      const subledgerOutstandingStr = subledgerOutstandingDec.toString();
      const subledgerUnappliedPayStr = subledgerUnappliedPayDec.toString();
      const subledgerUnappliedCnStr = subledgerUnappliedCnDec.toString();

      const netSubledgerPayableTotal = ApSettlementFoundation.calculateNetSupplierPayable(
        subledgerOutstandingStr,
        subledgerUnappliedPayStr,
        subledgerUnappliedCnStr
      );

      // 4. Identify AP_CONTROL Account(s)
      const apControlAccountIds = new Set<string>();

      const eventTypes = [
        'AP_SUPPLIER_BILL',
        'AP_PAYMENT',
        'AP_CREDIT_NOTE',
        'AP_DEBIT_NOTE',
        'AP_OPENING_BALANCE',
        'AP_DISCOUNT',
        'AP_ADJUSTMENT',
        'AP_ADJUSTMENT_REVERSAL',
        'AP_WRITE_OFF',
        'AP_CREDIT_ADJUSTMENT',
        'AP_DEBIT_ADJUSTMENT'
      ];
      for (const et of eventTypes) {
        const mapping = await accountingConfigurationService.getMapping(ctx, companyId, et, 'AP_CONTROL');
        if (mapping && mapping.isActive) {
          apControlAccountIds.add(mapping.accountId);
        }
      }

      const coaAccounts = await chartOfAccountsService.getAccountsList(ctx, companyId);
      for (const acc of coaAccounts) {
        if (acc.isControlAccount && (acc.controlAccountType === 'AP' || (acc.controlAccountType as any) === 'PAYABLE')) {
          apControlAccountIds.add(acc.id);
        }
      }

      if (apControlAccountIds.size === 0) {
        diagnostics.push({
          code: 'UNMAPPED_GL_CONTROL_ACCOUNT',
          severity: 'ERROR',
          message: `No active AP_CONTROL account mapping or control account found for company '${companyId}'.`
        });
      }

      // 5. GL AP_CONTROL Signed Balance Calculation (Credits - Debits) as of asOfDate
      let glTotalCreditsDec = ExactDecimal.ZERO;
      let glTotalDebitsDec = ExactDecimal.ZERO;

      if (apControlAccountIds.size > 0) {
        if (this.dbPool) {
          const accountIdArray = Array.from(apControlAccountIds);
          const sql = `
            SELECT COALESCE(SUM(jl.credit_amount), 0) as total_credits,
                   COALESCE(SUM(jl.debit_amount), 0) as total_debits
            FROM journal_lines jl
            JOIN journal_entries je ON jl.journal_entry_id = je.id
            WHERE jl.tenant_id = $1 AND jl.company_id = $2
              AND jl.account_id = ANY($3::text[])
              AND je.status = 'POSTED'
              AND je.accounting_date <= $4
          `;
          const params: any[] = [ctx.tenantId, companyId, accountIdArray, asOfDate];

          const res = await this.dbPool.query(sql, params);
          if (res.rows.length > 0) {
            glTotalCreditsDec = ExactDecimal.parse(String(res.rows[0].total_credits || '0.00'), 2);
            glTotalDebitsDec = ExactDecimal.parse(String(res.rows[0].total_debits || '0.00'), 2);
          }
        } else {
          // In-memory store fallback
          const store = (journalDraftService as any).journalsStore as Map<string, JournalEntryDTO> | undefined;
          const linesStore = (journalDraftService as any).linesStore as Map<string, JournalLineDTO[]> | undefined;

          if (store) {
            for (const [storeKey, journal] of store.entries()) {
              if (
                journal.tenantId === ctx.tenantId &&
                journal.companyId === companyId &&
                journal.status === 'POSTED' &&
                journal.accountingDate <= asOfDate
              ) {
                const lines = linesStore?.get(storeKey) || journal.lines || [];
                for (const line of lines) {
                  if (apControlAccountIds.has(line.accountId)) {
                    glTotalCreditsDec = glTotalCreditsDec.add(ExactDecimal.parse(line.creditAmount, 2));
                    glTotalDebitsDec = glTotalDebitsDec.add(ExactDecimal.parse(line.debitAmount, 2));
                  }
                }
              }
            }
          }
        }
      }

      const glApControlBalanceDec = glTotalCreditsDec.sub(glTotalDebitsDec);
      const glApControlBalanceStr = glApControlBalanceDec.toString();

      // 6. Reconciliation Comparison & Status
      const { difference: reconciliationDifference, status: diffStatus } =
        ApSettlementFoundation.calculateReconciliationDifference(netSubledgerPayableTotal, glApControlBalanceStr);

      if (diffStatus === 'FAIL' && apControlAccountIds.size > 0 && diagnostics.length === 0) {
        diagnostics.push({
          code: 'SUBLEDGER_GL_DISCREPANCY',
          severity: 'ERROR',
          message: `Historical subledger net payable ('${netSubledgerPayableTotal}') does not reconcile with GL AP_CONTROL signed balance ('${glApControlBalanceStr}') as of '${asOfDate}'. Difference: '${reconciliationDifference}'.`,
          details: {
            subledgerNetPayable: netSubledgerPayableTotal,
            glApControlBalance: glApControlBalanceStr,
            difference: reconciliationDifference,
            asOfDate
          }
        });
      }

      const reconciliationStatus: ApReconciliationStatus = diagnostics.length === 0 && diffStatus === 'PASS' ? 'PASS' : 'FAIL';

      return {
        tenantId: ctx.tenantId,
        companyId,
        asOfDate,
        reconciliationStatus,
        subledgerOutstandingOpenItemsTotal: subledgerOutstandingStr,
        subledgerUnappliedPaymentsTotal: subledgerUnappliedPayStr,
        subledgerUnappliedCreditNotesTotal: subledgerUnappliedCnStr,
        netSubledgerPayableTotal,
        glApControlBalance: glApControlBalanceStr,
        reconciliationDifference,
        diagnostics,
        reconciledAt: new Date()
      };
    };

    if (this.dbPool) {
      return ApSettlementFoundation.withReadOnlySnapshot(this.dbPool, executeRead);
    }
    return executeRead();
  }
}

export const apHistoricalSettlementService = new ApHistoricalSettlementService();
