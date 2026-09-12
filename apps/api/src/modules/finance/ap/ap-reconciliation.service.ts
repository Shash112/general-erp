import {
  RequestContext,
  ValidationError,
  ExactDecimal
} from '@general-erp/core';
import { authorizationService } from '../../../platform/authorization/authorization.service.js';
import { apDocumentService } from './ap-document.service.js';
import { apPaymentService } from './ap-payment.service.js';
import { apSettlementService } from './ap-settlement.service.js';
import { chartOfAccountsService } from '../chart-of-accounts.service.js';
import { accountingConfigurationService } from '../accounting-core.service.js';
import { journalDraftService } from '../journal-draft.service.js';
import { JournalEntryDTO, JournalLineDTO } from '../journal-model.js';
import { apHistoricalSettlementService } from './ap-historical-settlement.service.js';
import {
  ApReconciliationResultDTO,
  ApReconciliationDiagnosticDTO,
  ApReconciliationStatus,
  ApCalculationMode
} from './ap-settlement-model.js';
import { ApSettlementValidator } from './ap-settlement-validator.js';
import { ApSettlementFoundation } from './ap-settlement-foundation.js';
import type pg from 'pg';

export class ApReconciliationService {
  private dbPool?: pg.Pool | undefined;

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
    apSettlementService.setDbPool(pool);
    apHistoricalSettlementService.setDbPool(pool);
  }

  public getDbPool(): pg.Pool | undefined {
    return this.dbPool;
  }

  private authorize(ctx: RequestContext, action: string, companyId: string): void {
    if (ctx.user) {
      const isWildcard = ctx.user.permissions.some(
        p => p === '*' || p === action || p.startsWith('ap:reconciliation:') || p.startsWith('ap:settlement:')
      );
      if (!isWildcard) {
        authorizationService.authorize({ user: ctx.user, action, companyId });
      }
    }
  }

  /**
   * Reconciles AP Subledger Net Payable against GL AP_CONTROL Signed Balance for a company.
   */
  public async reconcileCompanyAP(
    ctx: RequestContext,
    companyId: string,
    asOfDate?: string | undefined,
    mode?: ApCalculationMode
  ): Promise<ApReconciliationResultDTO> {
    ApSettlementValidator.validateCompanyContext(ctx, companyId);
    ApSettlementValidator.validateAsOfDate(asOfDate);
    this.authorize(ctx, 'ap:settlement:reconcile', companyId);

    const calcMode = mode || (asOfDate ? 'HISTORICAL' : 'LIVE');
    if (calcMode === 'HISTORICAL') {
      if (!asOfDate || asOfDate.trim() === '') {
        throw new ValidationError('asOfDate is required for HISTORICAL calculation mode.');
      }
      return apHistoricalSettlementService.reconcileHistoricalCompanyAP(ctx, companyId, asOfDate);
    }

    const effectiveAsOfDate = new Date().toISOString().substring(0, 10);

    const executeRead = async (): Promise<ApReconciliationResultDTO> => {
      const diagnostics: ApReconciliationDiagnosticDTO[] = [];

      // 1. AP Subledger Total Calculation
      let subledgerOutstandingDec = ExactDecimal.ZERO;
      let subledgerUnappliedPayDec = ExactDecimal.ZERO;
      let subledgerUnappliedCnDec = ExactDecimal.ZERO;

      // Fetch all posted/eligible open items for company
      const allOpenItems = await apDocumentService.getOpenItems(ctx, companyId);
      const eligibleOpenItems = allOpenItems.filter(i => i.documentType !== 'CREDIT_NOTE' && i.status !== 'CANCELLED');

      for (const item of eligibleOpenItems) {
        try {
          const settlement = await apSettlementService.getOpenItemSettlement(ctx, item.id);
          subledgerOutstandingDec = subledgerOutstandingDec.add(ExactDecimal.parse(settlement.outstandingAmount, 2));
        } catch (err: any) {
          diagnostics.push({
            code: 'OPEN_ITEM_BALANCE_MISMATCH',
            severity: 'ERROR',
            message: `Open item '${item.id}' balance evaluation failed: ${err.message}`,
            details: { openItemId: item.id }
          });
        }
      }

      // Fetch all posted payment sources for company
      const allPayments = await apPaymentService.listPayments(ctx, companyId, { status: 'POSTED' });
      for (const payment of allPayments) {
        try {
          const util = await apSettlementService.getSourceUtilization(ctx, 'PAYMENT', payment.id);
          subledgerUnappliedPayDec = subledgerUnappliedPayDec.add(ExactDecimal.parse(util.unappliedAmount, 2));
        } catch (err: any) {
          diagnostics.push({
            code: 'SOURCE_BALANCE_MISMATCH',
            severity: 'ERROR',
            message: `Payment source '${payment.id}' utilization evaluation failed: ${err.message}`,
            details: { sourceId: payment.id, sourceType: 'PAYMENT' }
          });
        }
      }

      // Fetch all posted credit note sources for company
      const allCreditNotes = await apDocumentService.listDocuments(ctx, companyId, { documentType: 'CREDIT_NOTE', status: 'POSTED' });
      for (const cn of allCreditNotes) {
        try {
          const util = await apSettlementService.getSourceUtilization(ctx, 'CREDIT_NOTE', cn.id);
          subledgerUnappliedCnDec = subledgerUnappliedCnDec.add(ExactDecimal.parse(util.unappliedAmount, 2));
        } catch (err: any) {
          diagnostics.push({
            code: 'SOURCE_BALANCE_MISMATCH',
            severity: 'ERROR',
            message: `Credit Note source '${cn.id}' utilization evaluation failed: ${err.message}`,
            details: { sourceId: cn.id, sourceType: 'CREDIT_NOTE' }
          });
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

      // 2. Identify AP_CONTROL Account(s)
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

      // 3. GL AP_CONTROL Signed Balance Calculation (Credits - Debits)
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
          `;
          const params: any[] = [ctx.tenantId, companyId, accountIdArray];

          const res = await this.dbPool.query(sql, params);
          if (res.rows.length > 0) {
            glTotalCreditsDec = ExactDecimal.parse(String(res.rows[0].total_credits || '0.00'), 2);
            glTotalDebitsDec = ExactDecimal.parse(String(res.rows[0].total_debits || '0.00'), 2);
          }
        } else {
          // In-memory fallback
          const store = (journalDraftService as any).journalsStore as Map<string, JournalEntryDTO> | undefined;
          const linesStore = (journalDraftService as any).linesStore as Map<string, JournalLineDTO[]> | undefined;

          if (store) {
            for (const [storeKey, journal] of store.entries()) {
              if (
                journal.tenantId === ctx.tenantId &&
                journal.companyId === companyId &&
                journal.status === 'POSTED'
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

      // 4. Reconciliation Comparison & Status
      const { difference: reconciliationDifference, status: diffStatus } =
        ApSettlementFoundation.calculateReconciliationDifference(netSubledgerPayableTotal, glApControlBalanceStr);

      if (diffStatus === 'FAIL' && apControlAccountIds.size > 0 && diagnostics.length === 0) {
        diagnostics.push({
          code: 'SUBLEDGER_GL_DISCREPANCY',
          severity: 'ERROR',
          message: `Subledger net payable ('${netSubledgerPayableTotal}') does not reconcile with GL AP_CONTROL signed balance ('${glApControlBalanceStr}'). Difference: '${reconciliationDifference}'.`,
          details: {
            subledgerNetPayable: netSubledgerPayableTotal,
            glApControlBalance: glApControlBalanceStr,
            difference: reconciliationDifference
          }
        });
      }

      const reconciliationStatus: ApReconciliationStatus = diagnostics.length === 0 && diffStatus === 'PASS' ? 'PASS' : 'FAIL';

      return {
        tenantId: ctx.tenantId,
        companyId,
        asOfDate: effectiveAsOfDate,
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

export const apReconciliationService = new ApReconciliationService();
