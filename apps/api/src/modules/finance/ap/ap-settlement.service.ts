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
import { apHistoricalSettlementService } from './ap-historical-settlement.service.js';
import {
  ApOpenItemSettlementDTO,
  ApSourceUtilizationDTO,
  SupplierSettlementSummaryDTO,
  ApSourceUtilizationType,
  ApCalculationMode
} from './ap-settlement-model.js';
import { ApSettlementValidator } from './ap-settlement-validator.js';
import { ApSettlementFoundation } from './ap-settlement-foundation.js';
import type pg from 'pg';

export class ApSettlementService {
  private dbPool?: pg.Pool | undefined;

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
    apDocumentService.setDbPool(pool);
    apPaymentService.setDbPool(pool);
    apAllocationService.setDbPool(pool);
    apAdjustmentService.setDbPool(pool);
    apHistoricalSettlementService.setDbPool(pool);
  }

  public getDbPool(): pg.Pool | undefined {
    return this.dbPool;
  }

  private authorize(ctx: RequestContext, action: string, companyId: string): void {
    if (ctx.user) {
      const isWildcard = ctx.user.permissions.some(p => p === '*' || p === action || p.startsWith('ap:settlement:'));
      if (!isWildcard) {
        authorizationService.authorize({ user: ctx.user, action, companyId });
      }
    }
  }

  /**
   * Evaluates the derived settlement state of a single AP credit open item (SUPPLIER_BILL, DEBIT_NOTE, OPENING_BALANCE)
   */
  public async getOpenItemSettlement(
    ctx: RequestContext,
    openItemId: string,
    asOfDate?: string | undefined,
    mode?: ApCalculationMode
  ): Promise<ApOpenItemSettlementDTO> {
    ApSettlementValidator.validateAsOfDate(asOfDate);
    const calcMode = mode || (asOfDate ? 'HISTORICAL' : 'LIVE');

    if (calcMode === 'HISTORICAL') {
      if (!asOfDate || asOfDate.trim() === '') {
        throw new ValidationError('asOfDate is required for HISTORICAL calculation mode.');
      }
      return apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItemId, asOfDate);
    }

    const openItem = await apDocumentService.getOpenItem(ctx, openItemId);
    ApSettlementValidator.validateCompanyContext(ctx, openItem.companyId);
    this.authorize(ctx, 'ap:settlement:read', openItem.companyId);

    const executeRead = async (): Promise<ApOpenItemSettlementDTO> => {
      const doc = await apDocumentService.getDocument(ctx, openItem.apDocumentId);
      const allAllocations = await apAllocationService.listAllocations(ctx, openItem.companyId, { openItemId });
      const allAdjustments = await apAdjustmentService.listAdjustments(ctx, openItem.companyId, { openItemId });

      let activeAllocDec = ExactDecimal.ZERO;
      let activeDiscDec = ExactDecimal.ZERO;
      let activeWriteOffsDec = ExactDecimal.ZERO;
      let activeCreditAdjDec = ExactDecimal.ZERO;
      let activeDebitAdjDec = ExactDecimal.ZERO;

      for (const alloc of allAllocations) {
        if (alloc.status === 'ACTIVE') {
          const allocAmtDec = ExactDecimal.parse(alloc.allocatedAmount, 2);
          const discAmtDec = ExactDecimal.parse(alloc.discountAmount, 2);
          activeAllocDec = activeAllocDec.add(allocAmtDec);
          activeDiscDec = activeDiscDec.add(discAmtDec);
        }
      }

      for (const adj of allAdjustments) {
        if (adj.status === 'POSTED') {
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
          `Open item '${openItemId}' balance corrupted: total deductions (${totalDeductionDec.toString()}) exceed total original + debit adjustments (${effectiveOriginalDec.toString()}).`
        );
      }

      const outstandingDec = effectiveOriginalDec.sub(totalDeductionDec);
      if (outstandingDec.isNegative()) {
        throw new BusinessRuleViolationError(
          `Open item '${openItemId}' balance corrupted: outstanding amount '${outstandingDec.toString()}' is negative.`
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
        asOfDate: null
      };
    };

    if (this.dbPool) {
      return ApSettlementFoundation.withReadOnlySnapshot(this.dbPool, executeRead);
    }
    return executeRead();
  }

  /**
   * Evaluates the derived utilization state of a credit source (Payment or Credit Note)
   */
  public async getSourceUtilization(
    ctx: RequestContext,
    sourceType: ApSourceUtilizationType,
    sourceId: string,
    asOfDate?: string | undefined,
    mode?: ApCalculationMode
  ): Promise<ApSourceUtilizationDTO> {
    ApSettlementValidator.validateAsOfDate(asOfDate);
    const calcMode = mode || (asOfDate ? 'HISTORICAL' : 'LIVE');

    if (calcMode === 'HISTORICAL') {
      if (!asOfDate || asOfDate.trim() === '') {
        throw new ValidationError('asOfDate is required for HISTORICAL calculation mode.');
      }
      return apHistoricalSettlementService.getHistoricalSourceUtilization(ctx, sourceType, sourceId, asOfDate);
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
      }

      const filterInput = sourceType === 'PAYMENT' ? { paymentId: sourceId } : { creditNoteId: sourceId };
      const allAllocations = await apAllocationService.listAllocations(ctx, companyId, filterInput);

      let allocatedDec = ExactDecimal.ZERO;

      for (const alloc of allAllocations) {
        if (alloc.status === 'ACTIVE') {
          allocatedDec = allocatedDec.add(ExactDecimal.parse(alloc.allocatedAmount, 2));
        }
      }

      const totalDec = ExactDecimal.parse(totalAmountStr, 2);
      if (allocatedDec.compare(totalDec) > 0) {
        throw new BusinessRuleViolationError(
          `Source '${sourceId}' utilization corrupted: allocated amount '${allocatedDec.toString()}' exceeds total amount '${totalAmountStr}'.`
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
        asOfDate: null
      };
    };

    if (this.dbPool) {
      return ApSettlementFoundation.withReadOnlySnapshot(this.dbPool, executeRead);
    }
    return executeRead();
  }

  /**
   * Aggregates supplier-level derived settlement summary across all open items and credit sources
   */
  public async getSupplierSettlementSummary(
    ctx: RequestContext,
    supplierId: string,
    asOfDate?: string | undefined,
    mode?: ApCalculationMode
  ): Promise<SupplierSettlementSummaryDTO> {
    ApSettlementValidator.validateSupplierContext(supplierId);
    ApSettlementValidator.validateAsOfDate(asOfDate);

    const companyId = ctx.companyId;
    if (!companyId || companyId.trim() === '') {
      throw new ValidationError('RequestContext companyId is required for supplier settlement summary.');
    }
    ApSettlementValidator.validateCompanyContext(ctx, companyId);
    this.authorize(ctx, 'ap:settlement:read', companyId);

    const calcMode = mode || (asOfDate ? 'HISTORICAL' : 'LIVE');
    if (calcMode === 'HISTORICAL') {
      if (!asOfDate || asOfDate.trim() === '') {
        throw new ValidationError('asOfDate is required for HISTORICAL calculation mode.');
      }
      return apHistoricalSettlementService.getHistoricalSupplierSettlementSummary(ctx, supplierId, asOfDate);
    }

    const supplier = await masterDataService.getSupplier(ctx, supplierId);
    if (supplier.companyId !== companyId) {
      throw new ValidationError(
        `Supplier '${supplierId}' belongs to company '${supplier.companyId}', not request company '${companyId}'.`
      );
    }

    const executeRead = async (): Promise<SupplierSettlementSummaryDTO> => {
      // 1. Open items aggregation
      const allOpenItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const eligibleOpenItems = allOpenItems.filter(item => item.documentType !== 'CREDIT_NOTE' && item.status !== 'CANCELLED');

      let totalPostedBillsDec = ExactDecimal.ZERO;
      let totalOutstandingBillsDec = ExactDecimal.ZERO;
      let totalActiveAllocDec = ExactDecimal.ZERO;
      let totalPromptDiscDec = ExactDecimal.ZERO;
      let openItemsCount = 0;

      for (const item of eligibleOpenItems) {
        const settlement = await this.getOpenItemSettlement(ctx, item.id);
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

      // 2. Payment credit sources aggregation
      const allPayments = await apPaymentService.listPayments(ctx, companyId, { supplierId, status: 'POSTED' });
      let totalPaymentsDec = ExactDecimal.ZERO;
      let totalUnappliedPayDec = ExactDecimal.ZERO;

      for (const payment of allPayments) {
        const util = await this.getSourceUtilization(ctx, 'PAYMENT', payment.id);
        totalPaymentsDec = totalPaymentsDec.add(ExactDecimal.parse(util.totalAmount, 2));
        totalUnappliedPayDec = totalUnappliedPayDec.add(ExactDecimal.parse(util.unappliedAmount, 2));
      }

      // 3. Credit note sources aggregation
      const allCreditNotes = await apDocumentService.listDocuments(ctx, companyId, { supplierId, documentType: 'CREDIT_NOTE', status: 'POSTED' });
      let totalCreditNotesDec = ExactDecimal.ZERO;
      let totalUnappliedCnDec = ExactDecimal.ZERO;

      for (const cn of allCreditNotes) {
        const util = await this.getSourceUtilization(ctx, 'CREDIT_NOTE', cn.id);
        totalCreditNotesDec = totalCreditNotesDec.add(ExactDecimal.parse(util.totalAmount, 2));
        totalUnappliedCnDec = totalUnappliedCnDec.add(ExactDecimal.parse(util.unappliedAmount, 2));
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
        asOfDate: null
      };
    };

    if (this.dbPool) {
      return ApSettlementFoundation.withReadOnlySnapshot(this.dbPool, executeRead);
    }
    return executeRead();
  }
}

export const apSettlementService = new ApSettlementService();
