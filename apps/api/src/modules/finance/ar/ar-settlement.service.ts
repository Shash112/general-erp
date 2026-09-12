import {
  RequestContext,
  ExactDecimal
} from '@general-erp/core';
import { logger } from '../../../config/logger.js';
import { authorizationService } from '../../../platform/authorization/authorization.service.js';
import { auditService } from '../../../platform/audit/audit.service.js';
import { arDocumentService } from './ar-document.service.js';
import { arReceiptService } from './ar-receipt.service.js';
import { arAllocationService } from './ar-allocation.service.js';
import { arAdjustmentService } from './ar-adjustment.service.js';
import {
  ArOpenItemSettlementDTO,
  ArSourceUtilizationDTO,
  CustomerSettlementSummaryDTO,
  ReconciliationResultDTO,
  ReconciliationException
} from './ar-settlement-model.js';
import { ArSettlementValidator } from './ar-settlement-validator.js';
import type pg from 'pg';

export class ArSettlementService {
  private dbPool?: pg.Pool | undefined;

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
    arDocumentService.setDbPool(pool);
    arReceiptService.setDbPool(pool);
    arAllocationService.setDbPool(pool);
    arAdjustmentService.setDbPool(pool);
  }

  public getDbPool(): pg.Pool | undefined {
    return this.dbPool;
  }

  private authorize(ctx: RequestContext, action: string, companyId: string): void {
    if (ctx.user) {
      const isWildcard = ctx.user.permissions.some(p => p === '*' || p === action || p.startsWith('ar:settlement:'));
      if (!isWildcard) {
        authorizationService.authorize({ user: ctx.user, action, companyId });
      }
    }
  }

  /**
   * Evaluates the derived settlement state of a single debit open item
   */
  public async getOpenItemSettlement(ctx: RequestContext, openItemId: string): Promise<ArOpenItemSettlementDTO> {
    const openItem = await arDocumentService.getOpenItem(ctx, openItemId);
    this.authorize(ctx, 'ar:settlement:read', openItem.companyId);

    const activeAllocations = await arAllocationService.listAllocations(ctx, openItem.companyId, {
      openItemId,
      status: 'ACTIVE'
    });

    let activeAllocTotalDec = ExactDecimal.ZERO;
    for (const alloc of activeAllocations) {
      const allocDec = ExactDecimal.parse(alloc.allocatedAmount, 2);
      const discDec = ExactDecimal.parse(alloc.discountAmount, 2);
      activeAllocTotalDec = activeAllocTotalDec.add(allocDec).add(discDec);
    }

    const activeAdjustments = await arAdjustmentService.listAdjustments(ctx, openItem.companyId, {
      openItemId,
      status: 'POSTED'
    });

    let writeOffsDec = ExactDecimal.ZERO;
    let creditAdjsDec = ExactDecimal.ZERO;
    let debitAdjsDec = ExactDecimal.ZERO;
    for (const adj of activeAdjustments) {
      const amtDec = ExactDecimal.parse(adj.amount, 2);
      if (adj.adjustmentType === 'WRITE_OFF') {
        writeOffsDec = writeOffsDec.add(amtDec);
      } else if (adj.adjustmentType === 'CREDIT_ADJUSTMENT') {
        creditAdjsDec = creditAdjsDec.add(amtDec);
      } else if (adj.adjustmentType === 'DEBIT_ADJUSTMENT') {
        debitAdjsDec = debitAdjsDec.add(amtDec);
      }
    }

    const origAmountDec = ExactDecimal.parse(openItem.originalAmount, 2);
    const outstandingDec = origAmountDec.sub(activeAllocTotalDec).sub(writeOffsDec).sub(creditAdjsDec).add(debitAdjsDec);
    const outstandingStr = outstandingDec.toString();

    let settlementStatus: 'OPEN' | 'PARTIALLY_SETTLED' | 'SETTLED' = 'PARTIALLY_SETTLED';
    if (outstandingDec.equals(origAmountDec)) {
      settlementStatus = 'OPEN';
    } else if (outstandingDec.isZero()) {
      settlementStatus = 'SETTLED';
    }

    return {
      openItemId: openItem.id,
      arDocumentId: openItem.arDocumentId,
      customerId: openItem.customerId,
      documentType: openItem.documentType,
      documentNumber: openItem.documentNumber,
      originalAmount: openItem.originalAmount,
      activeAllocationsTotal: activeAllocTotalDec.toString(),
      outstandingAmount: outstandingStr,
      settlementStatus
    };
  }

  /**
   * Evaluates the derived utilization state of a credit source (Receipt or Credit Note)
   */
  public async getSourceUtilization(
    ctx: RequestContext,
    sourceType: 'RECEIPT' | 'CREDIT_NOTE',
    sourceId: string
  ): Promise<ArSourceUtilizationDTO> {
    let customerId = '';
    let totalOrGrossStr = '0.00';
    let companyId = '';

    if (sourceType === 'RECEIPT') {
      const receipt = await arReceiptService.getReceipt(ctx, sourceId);
      companyId = receipt.companyId;
      this.authorize(ctx, 'ar:settlement:read', companyId);
      customerId = receipt.customerId;
      totalOrGrossStr = receipt.totalAmount;
    } else {
      const creditNote = await arDocumentService.getDocument(ctx, sourceId);
      companyId = creditNote.companyId;
      this.authorize(ctx, 'ar:settlement:read', companyId);
      customerId = creditNote.customerId;
      totalOrGrossStr = creditNote.grossAmount;
    }

    const filters = sourceType === 'RECEIPT'
      ? { receiptId: sourceId, status: 'ACTIVE' as const }
      : { creditNoteId: sourceId, status: 'ACTIVE' as const };

    const activeAllocations = await arAllocationService.listAllocations(ctx, companyId, filters);

    let activeAllocTotalDec = ExactDecimal.ZERO;
    for (const alloc of activeAllocations) {
      activeAllocTotalDec = activeAllocTotalDec.add(ExactDecimal.parse(alloc.allocatedAmount, 2));
    }

    const totalOrGrossDec = ExactDecimal.parse(totalOrGrossStr, 2);
    const unappliedDec = totalOrGrossDec.sub(activeAllocTotalDec);

    let utilizationStatus: 'FULLY_UNAPPLIED' | 'PARTIALLY_APPLIED' | 'FULLY_APPLIED' = 'PARTIALLY_APPLIED';
    if (activeAllocTotalDec.isZero()) {
      utilizationStatus = 'FULLY_UNAPPLIED';
    } else if (unappliedDec.isZero()) {
      utilizationStatus = 'FULLY_APPLIED';
    }

    return {
      sourceId,
      sourceType,
      customerId,
      totalOrGrossAmount: totalOrGrossStr,
      activeAllocationsTotal: activeAllocTotalDec.toString(),
      unappliedAmount: unappliedDec.toString(),
      utilizationStatus
    };
  }

  /**
   * Aggregates customer-level gross receivables, unapplied credits, and net balance
   */
  public async getCustomerSettlementSummary(
    ctx: RequestContext,
    companyId: string,
    customerId: string
  ): Promise<CustomerSettlementSummaryDTO> {
    ArSettlementValidator.validateCompanyContext(ctx, companyId);
    ArSettlementValidator.validateCustomerContext(customerId);
    this.authorize(ctx, 'ar:settlement:read', companyId);

    const openItems = await arDocumentService.getOpenItems(ctx, companyId, { customerId });
    const receipts = await arReceiptService.listReceipts(ctx, companyId, { customerId, status: 'POSTED' });
    const creditNotes = await arDocumentService.listDocuments(ctx, companyId, { customerId, documentType: 'CREDIT_NOTE', status: 'POSTED' });

    let grossReceivablesDec = ExactDecimal.ZERO;
    let openItemsCount = 0;
    let settledItemsCount = 0;

    for (const item of openItems) {
      const outDec = ExactDecimal.parse(item.outstandingAmount, 2);
      grossReceivablesDec = grossReceivablesDec.add(outDec);
      if (item.status === 'SETTLED' || outDec.isZero()) {
        settledItemsCount++;
      } else {
        openItemsCount++;
      }
    }

    let unappliedCreditsDec = ExactDecimal.ZERO;
    for (const receipt of receipts) {
      unappliedCreditsDec = unappliedCreditsDec.add(ExactDecimal.parse(receipt.unappliedAmount, 2));
    }
    for (const cn of creditNotes) {
      unappliedCreditsDec = unappliedCreditsDec.add(ExactDecimal.parse(cn.unappliedAmount, 2));
    }

    const netOutstandingDec = grossReceivablesDec.sub(unappliedCreditsDec);

    return {
      tenantId: ctx.tenantId,
      companyId,
      customerId,
      totalGrossReceivables: grossReceivablesDec.toString(),
      totalUnappliedCredits: unappliedCreditsDec.toString(),
      netOutstandingReceivable: netOutstandingDec.toString(),
      openItemsCount,
      settledItemsCount
    };
  }

  /**
   * Comprehensive Non-Destructive Subledger Reconciliation Engine
   */
  public async reconcileCompanyAR(
    ctx: RequestContext,
    companyId: string,
    customerId?: string
  ): Promise<ReconciliationResultDTO> {
    ArSettlementValidator.validateCompanyContext(ctx, companyId);
    this.authorize(ctx, 'ar:settlement:reconcile', companyId);

    const documents = await arDocumentService.listDocuments(ctx, companyId, customerId ? { customerId } : undefined);
    const openItems = await arDocumentService.getOpenItems(ctx, companyId, customerId ? { customerId } : undefined);
    const receipts = await arReceiptService.listReceipts(ctx, companyId, customerId ? { customerId } : undefined);
    const allocations = await arAllocationService.listAllocations(ctx, companyId);
    const adjustments = await arAdjustmentService.listAdjustments(ctx, companyId, customerId ? { customerId } : undefined);

    const exceptions: ReconciliationException[] = [];

    // 1. Reconcile Receipts
    for (const receipt of receipts) {
      if (receipt.status !== 'POSTED') continue;

      const activeReceiptAllocations = allocations.filter(a => a.receiptId === receipt.id && a.status === 'ACTIVE');
      let sumAllocDec = ExactDecimal.ZERO;
      for (const a of activeReceiptAllocations) {
        sumAllocDec = sumAllocDec.add(ExactDecimal.parse(a.allocatedAmount, 2));
      }

      const totalDec = ExactDecimal.parse(receipt.totalAmount, 2);
      const expectedUnappliedDec = totalDec.sub(sumAllocDec);
      const actualUnappliedDec = ExactDecimal.parse(receipt.unappliedAmount, 2);
      const actualAllocatedDec = ExactDecimal.parse(receipt.allocatedAmount, 2);

      if (!actualUnappliedDec.equals(expectedUnappliedDec)) {
        exceptions.push({
          code: 'SOURCE_BALANCE_MISMATCH',
          entityType: 'AR_RECEIPT',
          entityId: receipt.id,
          tenantId: ctx.tenantId,
          companyId,
          expectedAmount: expectedUnappliedDec.toString(),
          actualAmount: receipt.unappliedAmount,
          message: `Receipt '${receipt.id}' unapplied amount mismatch. Expected '${expectedUnappliedDec.toString()}', found '${receipt.unappliedAmount}'.`,
          severity: 'ERROR'
        });
      }

      if (!actualAllocatedDec.equals(sumAllocDec)) {
        exceptions.push({
          code: 'SOURCE_BALANCE_MISMATCH',
          entityType: 'AR_RECEIPT',
          entityId: receipt.id,
          tenantId: ctx.tenantId,
          companyId,
          expectedAmount: sumAllocDec.toString(),
          actualAmount: receipt.allocatedAmount,
          message: `Receipt '${receipt.id}' allocated amount mismatch. Expected '${sumAllocDec.toString()}', found '${receipt.allocatedAmount}'.`,
          severity: 'ERROR'
        });
      }

      if (actualUnappliedDec.isNegative()) {
        exceptions.push({
          code: 'NEGATIVE_BALANCE',
          entityType: 'AR_RECEIPT',
          entityId: receipt.id,
          tenantId: ctx.tenantId,
          companyId,
          expectedAmount: '>= 0.00',
          actualAmount: receipt.unappliedAmount,
          message: `Receipt '${receipt.id}' has negative unapplied amount '${receipt.unappliedAmount}'.`,
          severity: 'CRITICAL'
        });
      }
    }

    // 2. Reconcile Credit Notes
    const creditNotes = documents.filter(d => d.documentType === 'CREDIT_NOTE' && d.status === 'POSTED');
    for (const cn of creditNotes) {
      const activeCnAllocations = allocations.filter(a => a.creditNoteId === cn.id && a.status === 'ACTIVE');
      let sumAllocDec = ExactDecimal.ZERO;
      for (const a of activeCnAllocations) {
        sumAllocDec = sumAllocDec.add(ExactDecimal.parse(a.allocatedAmount, 2));
      }

      const grossDec = ExactDecimal.parse(cn.grossAmount, 2);
      const expectedUnappliedDec = grossDec.sub(sumAllocDec);
      const actualUnappliedDec = ExactDecimal.parse(cn.unappliedAmount, 2);
      const actualAllocatedDec = ExactDecimal.parse(cn.allocatedAmount, 2);

      if (!actualUnappliedDec.equals(expectedUnappliedDec)) {
        exceptions.push({
          code: 'SOURCE_BALANCE_MISMATCH',
          entityType: 'AR_DOCUMENT',
          entityId: cn.id,
          tenantId: ctx.tenantId,
          companyId,
          expectedAmount: expectedUnappliedDec.toString(),
          actualAmount: cn.unappliedAmount,
          message: `Credit Note '${cn.id}' unapplied amount mismatch. Expected '${expectedUnappliedDec.toString()}', found '${cn.unappliedAmount}'.`,
          severity: 'ERROR'
        });
      }

      if (!actualAllocatedDec.equals(sumAllocDec)) {
        exceptions.push({
          code: 'SOURCE_BALANCE_MISMATCH',
          entityType: 'AR_DOCUMENT',
          entityId: cn.id,
          tenantId: ctx.tenantId,
          companyId,
          expectedAmount: sumAllocDec.toString(),
          actualAmount: cn.allocatedAmount,
          message: `Credit Note '${cn.id}' allocated amount mismatch. Expected '${sumAllocDec.toString()}', found '${cn.allocatedAmount}'.`,
          severity: 'ERROR'
        });
      }

      if (actualUnappliedDec.isNegative()) {
        exceptions.push({
          code: 'NEGATIVE_BALANCE',
          entityType: 'AR_DOCUMENT',
          entityId: cn.id,
          tenantId: ctx.tenantId,
          companyId,
          expectedAmount: '>= 0.00',
          actualAmount: cn.unappliedAmount,
          message: `Credit Note '${cn.id}' has negative unapplied amount '${cn.unappliedAmount}'.`,
          severity: 'CRITICAL'
        });
      }
    }

    // 3. Reconcile Open Items
    for (const item of openItems) {
      const activeItemAllocations = allocations.filter(a => a.openItemId === item.id && a.status === 'ACTIVE');
      let totalDeductionDec = ExactDecimal.ZERO;
      for (const a of activeItemAllocations) {
        const allocDec = ExactDecimal.parse(a.allocatedAmount, 2);
        const discDec = ExactDecimal.parse(a.discountAmount, 2);
        totalDeductionDec = totalDeductionDec.add(allocDec).add(discDec);
      }

      const activeItemAdjustments = adjustments.filter(adj => adj.openItemId === item.id && (adj.status === 'POSTED' || adj.status === 'ACTIVE'));
      let writeOffsDec = ExactDecimal.ZERO;
      let creditAdjsDec = ExactDecimal.ZERO;
      let debitAdjsDec = ExactDecimal.ZERO;
      for (const adj of activeItemAdjustments) {
        const amtDec = ExactDecimal.parse(adj.amount, 2);
        if (adj.adjustmentType === 'WRITE_OFF') {
          writeOffsDec = writeOffsDec.add(amtDec);
        } else if (adj.adjustmentType === 'CREDIT_ADJUSTMENT') {
          creditAdjsDec = creditAdjsDec.add(amtDec);
        } else if (adj.adjustmentType === 'DEBIT_ADJUSTMENT') {
          debitAdjsDec = debitAdjsDec.add(amtDec);
        }
      }

      const origDec = ExactDecimal.parse(item.originalAmount, 2);
      const expectedOutstandingDec = origDec.sub(totalDeductionDec).sub(writeOffsDec).sub(creditAdjsDec).add(debitAdjsDec);
      const actualOutstandingDec = ExactDecimal.parse(item.outstandingAmount, 2);

      if (!actualOutstandingDec.equals(expectedOutstandingDec)) {
        exceptions.push({
          code: 'OPEN_ITEM_BALANCE_MISMATCH',
          entityType: 'AR_OPEN_ITEM',
          entityId: item.id,
          tenantId: ctx.tenantId,
          companyId,
          expectedAmount: expectedOutstandingDec.toString(),
          actualAmount: item.outstandingAmount,
          message: `Open item '${item.id}' outstanding amount mismatch. Expected '${expectedOutstandingDec.toString()}', found '${item.outstandingAmount}'.`,
          severity: 'ERROR'
        });
      }

      if (actualOutstandingDec.isNegative()) {
        exceptions.push({
          code: 'NEGATIVE_BALANCE',
          entityType: 'AR_OPEN_ITEM',
          entityId: item.id,
          tenantId: ctx.tenantId,
          companyId,
          expectedAmount: '>= 0.00',
          actualAmount: item.outstandingAmount,
          message: `Open item '${item.id}' has negative outstanding amount '${item.outstandingAmount}'.`,
          severity: 'CRITICAL'
        });
      }
    }

    // 4. Reconcile Allocations
    for (const alloc of allocations) {
      if (alloc.status !== 'ACTIVE') continue;

      if (alloc.tenantId !== ctx.tenantId) {
        exceptions.push({
          code: 'TENANT_SCOPE_MISMATCH',
          entityType: 'AR_ALLOCATION',
          entityId: alloc.id,
          tenantId: ctx.tenantId,
          companyId,
          message: `Allocation '${alloc.id}' tenant '${alloc.tenantId}' does not match context tenant '${ctx.tenantId}'.`,
          severity: 'CRITICAL'
        });
      }

      if (alloc.companyId !== companyId) {
        exceptions.push({
          code: 'COMPANY_SCOPE_MISMATCH',
          entityType: 'AR_ALLOCATION',
          entityId: alloc.id,
          tenantId: ctx.tenantId,
          companyId,
          message: `Allocation '${alloc.id}' company '${alloc.companyId}' does not match target company '${companyId}'.`,
          severity: 'CRITICAL'
        });
      }

      // Customer Matching Check
      const targetOpenItem = openItems.find(i => i.id === alloc.openItemId);
      let sourceCustId = '';
      if (alloc.allocationSourceType === 'RECEIPT') {
        const r = receipts.find(rc => rc.id === alloc.receiptId);
        if (r) sourceCustId = r.customerId;
      } else {
        const cn = creditNotes.find(c => c.id === alloc.creditNoteId);
        if (cn) sourceCustId = cn.customerId;
      }

      if (targetOpenItem && sourceCustId && sourceCustId !== targetOpenItem.customerId) {
        exceptions.push({
          code: 'CUSTOMER_MISMATCH',
          entityType: 'AR_ALLOCATION',
          entityId: alloc.id,
          tenantId: ctx.tenantId,
          companyId,
          message: `Allocation '${alloc.id}' source customer '${sourceCustId}' does not match open item customer '${targetOpenItem.customerId}'.`,
          severity: 'CRITICAL'
        });
      }
    }

    // 5. Reconcile Adjustments
    for (const adj of adjustments) {
      if (adj.tenantId !== ctx.tenantId) {
        exceptions.push({
          code: 'ADJUSTMENT_TENANT_MISMATCH',
          entityType: 'AR_ADJUSTMENT',
          entityId: adj.id,
          tenantId: ctx.tenantId,
          companyId,
          message: `Adjustment '${adj.id}' tenant '${adj.tenantId}' does not match context tenant '${ctx.tenantId}'.`,
          severity: 'CRITICAL'
        });
      }

      if (adj.companyId !== companyId) {
        exceptions.push({
          code: 'ADJUSTMENT_COMPANY_MISMATCH',
          entityType: 'AR_ADJUSTMENT',
          entityId: adj.id,
          tenantId: ctx.tenantId,
          companyId,
          message: `Adjustment '${adj.id}' company '${adj.companyId}' does not match target company '${companyId}'.`,
          severity: 'CRITICAL'
        });
      }

      const targetOpenItem = openItems.find(i => i.id === adj.openItemId);
      if (!targetOpenItem) {
        exceptions.push({
          code: 'ADJUSTMENT_TARGET_INVALID',
          entityType: 'AR_ADJUSTMENT',
          entityId: adj.id,
          tenantId: ctx.tenantId,
          companyId,
          message: `Adjustment '${adj.id}' target open item '${adj.openItemId}' does not exist or is inaccessible.`,
          severity: 'ERROR'
        });
      } else if (targetOpenItem.customerId !== adj.customerId) {
        exceptions.push({
          code: 'ADJUSTMENT_CUSTOMER_MISMATCH',
          entityType: 'AR_ADJUSTMENT',
          entityId: adj.id,
          tenantId: ctx.tenantId,
          companyId,
          message: `Adjustment '${adj.id}' customer '${adj.customerId}' does not match target open item customer '${targetOpenItem.customerId}'.`,
          severity: 'CRITICAL'
        });
      }
    }

    const reconResult: ReconciliationResultDTO = {
      status: exceptions.length === 0 ? 'PASS' : 'FAIL',
      tenantId: ctx.tenantId,
      companyId,
      reconciledAt: new Date(),
      documentsChecked: documents.length,
      openItemsChecked: openItems.length,
      receiptsChecked: receipts.length,
      allocationsChecked: allocations.length,
      exceptions
    };

    await auditService.logEvent(ctx, {
      module: 'finance',
      entityName: 'ArSettlement',
      entityId: companyId,
      action: 'RECONCILE',
      newValues: {
        status: reconResult.status,
        exceptionCount: exceptions.length,
        documentsChecked: reconResult.documentsChecked,
        openItemsChecked: reconResult.openItemsChecked
      }
    });

    logger.info(
      { tenantId: ctx.tenantId, companyId, status: reconResult.status, exceptionsCount: exceptions.length },
      '[AR] Settlement reconciliation completed'
    );

    return reconResult;
  }
}

export const arSettlementService = new ArSettlementService();
