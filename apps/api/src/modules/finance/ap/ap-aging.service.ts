import {
  RequestContext,
  ExactDecimal,
  BusinessRuleViolationError
} from '@general-erp/core';
import { logger } from '../../../config/logger.js';
import { authorizationService } from '../../../platform/authorization/authorization.service.js';
import { apDocumentService } from './ap-document.service.js';
import { apSettlementService } from './ap-settlement.service.js';
import { apHistoricalSettlementService } from './ap-historical-settlement.service.js';
import { ApSettlementFoundation } from './ap-settlement-foundation.js';
import {
  ApAgingBucket,
  OpenItemApAgingDTO,
  SupplierApAgingDTO,
  CompanyApAgingSummaryDTO
} from './ap-aging-model.js';
import { ApAgingValidator } from './ap-aging-validator.js';
import { ApCalculationMode } from './ap-settlement-model.js';
import type pg from 'pg';

export class ApAgingService {
  private dbPool?: pg.Pool | undefined;

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
    apDocumentService.setDbPool(pool);
    apSettlementService.setDbPool(pool);
    apHistoricalSettlementService.setDbPool(pool);
  }

  public getDbPool(): pg.Pool | undefined {
    return this.dbPool;
  }

  private authorize(ctx: RequestContext, action: string, companyId: string): void {
    if (ctx.user) {
      const isWildcard = ctx.user.permissions.some(
        p => p === '*' || p === action || p.startsWith('ap:aging:') || p.startsWith('ap:statement:')
      );
      if (!isWildcard) {
        authorizationService.authorize({ user: ctx.user, action, companyId });
      }
    }
  }

  /**
   * Helper: Calculate Days Overdue and Aging Bucket based on asOfDate and dueDate
   */
  public calculateBucket(asOfDate: string, dueDate: string): { daysOverdue: number; bucket: ApAgingBucket } {
    const asOfMs = new Date(asOfDate).getTime();
    const dueMs = new Date(dueDate).getTime();
    const daysOverdue = Math.floor((asOfMs - dueMs) / (1000 * 60 * 60 * 24));

    let bucket: ApAgingBucket = 'CURRENT';
    if (daysOverdue <= 0) {
      bucket = 'CURRENT';
    } else if (daysOverdue >= 1 && daysOverdue <= 30) {
      bucket = '1_30';
    } else if (daysOverdue >= 31 && daysOverdue <= 60) {
      bucket = '31_60';
    } else if (daysOverdue >= 61 && daysOverdue <= 90) {
      bucket = '61_90';
    } else {
      bucket = '90_PLUS';
    }

    return { daysOverdue, bucket };
  }

  /**
   * Evaluates aging for a single open item as of a target date
   */
  public async getOpenItemAging(
    ctx: RequestContext,
    openItemId: string,
    asOfDate?: string,
    mode?: ApCalculationMode
  ): Promise<OpenItemApAgingDTO> {
    const asOfDateStr = asOfDate || new Date().toISOString().split('T')[0]!;
    ApAgingValidator.validateDate(asOfDateStr, 'asOfDate');

    const openItem = await apDocumentService.getOpenItem(ctx, openItemId);
    ApAgingValidator.validateCompanyContext(ctx, openItem.companyId);
    this.authorize(ctx, 'ap:aging:read', openItem.companyId);

    if (openItem.documentType === 'CREDIT_NOTE') {
      throw new BusinessRuleViolationError(`Open item '${openItemId}' is a CREDIT_NOTE, which cannot be aged as a debit item.`);
    }

    const calcMode = mode || (asOfDate ? 'HISTORICAL' : 'LIVE');
    const settlement = await apSettlementService.getOpenItemSettlement(ctx, openItemId, asOfDateStr, calcMode);

    const outDec = ExactDecimal.parse(settlement.outstandingAmount, 2);
    if (outDec.isNegative()) {
      throw new BusinessRuleViolationError(`Open item '${openItemId}' outstanding amount '${settlement.outstandingAmount}' is negative.`);
    }

    const { daysOverdue, bucket } = this.calculateBucket(asOfDateStr, settlement.dueDate);

    return {
      openItemId: settlement.openItemId,
      apDocumentId: settlement.apDocumentId,
      supplierId: settlement.supplierId,
      documentType: settlement.documentType,
      documentNumber: settlement.documentNumber,
      documentDate: settlement.documentDate,
      dueDate: settlement.dueDate,
      asOfDate: asOfDateStr,
      originalAmount: settlement.originalAmount,
      outstandingAmount: settlement.outstandingAmount,
      daysOverdue,
      bucket
    };
  }

  /**
   * Evaluates supplier-level aging summary as of a target date
   */
  public async getSupplierAging(
    ctx: RequestContext,
    companyId: string,
    supplierId: string,
    asOfDate?: string,
    mode?: ApCalculationMode
  ): Promise<SupplierApAgingDTO> {
    ApAgingValidator.validateCompanyContext(ctx, companyId);
    ApAgingValidator.validateSupplierContext(supplierId);
    this.authorize(ctx, 'ap:aging:read', companyId);

    const asOfDateStr = asOfDate || new Date().toISOString().split('T')[0]!;
    ApAgingValidator.validateDate(asOfDateStr, 'asOfDate');

    const executeRead = async (): Promise<SupplierApAgingDTO> => {
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const eligibleItems = openItems.filter(
        i => i.documentType !== 'CREDIT_NOTE' && ApSettlementFoundation.isTransactionEffectiveAsOf(i.documentDate, asOfDateStr)
      );

      let currentDec = ExactDecimal.ZERO;
      let b1To30Dec = ExactDecimal.ZERO;
      let b31To60Dec = ExactDecimal.ZERO;
      let b61To90Dec = ExactDecimal.ZERO;
      let b90PlusDec = ExactDecimal.ZERO;
      let totalOutstandingDec = ExactDecimal.ZERO;

      const itemDTOs: OpenItemApAgingDTO[] = [];

      for (const item of eligibleItems) {
        const aging = await this.getOpenItemAging(ctx, item.id, asOfDateStr, mode);
        const outDec = ExactDecimal.parse(aging.outstandingAmount, 2);

        if (outDec.isZero()) continue;

        totalOutstandingDec = totalOutstandingDec.add(outDec);
        itemDTOs.push(aging);

        switch (aging.bucket) {
          case 'CURRENT':
            currentDec = currentDec.add(outDec);
            break;
          case '1_30':
            b1To30Dec = b1To30Dec.add(outDec);
            break;
          case '31_60':
            b31To60Dec = b31To60Dec.add(outDec);
            break;
          case '61_90':
            b61To90Dec = b61To90Dec.add(outDec);
            break;
          case '90_PLUS':
            b90PlusDec = b90PlusDec.add(outDec);
            break;
        }
      }

      // Fetch signed net payable for complete context
      let signedNetPayableStr = '0.00';
      try {
        const summary = await apSettlementService.getSupplierSettlementSummary(ctx, supplierId, asOfDateStr, mode);
        signedNetPayableStr = summary.netPayableAmount;
      } catch {
        signedNetPayableStr = totalOutstandingDec.toString();
      }

      return {
        tenantId: ctx.tenantId,
        companyId,
        supplierId,
        asOfDate: asOfDateStr,
        totalOutstanding: totalOutstandingDec.toString(),
        currentAmount: currentDec.toString(),
        bucket1To30: b1To30Dec.toString(),
        bucket31To60: b31To60Dec.toString(),
        bucket61To90: b61To90Dec.toString(),
        bucket90Plus: b90PlusDec.toString(),
        openItems: itemDTOs,
        signedNetPayable: signedNetPayableStr
      };
    };

    if (this.dbPool) {
      return ApSettlementFoundation.withReadOnlySnapshot(this.dbPool, executeRead);
    }
    return executeRead();
  }

  /**
   * Evaluates company-level aggregated aging as of a target date
   */
  public async getCompanyAging(
    ctx: RequestContext,
    companyId: string,
    asOfDate?: string,
    mode?: ApCalculationMode
  ): Promise<CompanyApAgingSummaryDTO> {
    ApAgingValidator.validateCompanyContext(ctx, companyId);
    this.authorize(ctx, 'ap:aging:read', companyId);

    const asOfDateStr = asOfDate || new Date().toISOString().split('T')[0]!;
    ApAgingValidator.validateDate(asOfDateStr, 'asOfDate');

    const executeRead = async (): Promise<CompanyApAgingSummaryDTO> => {
      const openItems = await apDocumentService.getOpenItems(ctx, companyId);
      const supplierIds = [...new Set(openItems.map(i => i.supplierId))];

      const supplierSummaries: SupplierApAgingDTO[] = [];
      let companyCurrentDec = ExactDecimal.ZERO;
      let companyB1To30Dec = ExactDecimal.ZERO;
      let companyB31To60Dec = ExactDecimal.ZERO;
      let companyB61To90Dec = ExactDecimal.ZERO;
      let companyB90PlusDec = ExactDecimal.ZERO;
      let companyTotalDec = ExactDecimal.ZERO;

      for (const suppId of supplierIds) {
        const suppSummary = await this.getSupplierAging(ctx, companyId, suppId, asOfDateStr, mode);
        supplierSummaries.push(suppSummary);

        companyCurrentDec = companyCurrentDec.add(ExactDecimal.parse(suppSummary.currentAmount, 2));
        companyB1To30Dec = companyB1To30Dec.add(ExactDecimal.parse(suppSummary.bucket1To30, 2));
        companyB31To60Dec = companyB31To60Dec.add(ExactDecimal.parse(suppSummary.bucket31To60, 2));
        companyB61To90Dec = companyB61To90Dec.add(ExactDecimal.parse(suppSummary.bucket61To90, 2));
        companyB90PlusDec = companyB90PlusDec.add(ExactDecimal.parse(suppSummary.bucket90Plus, 2));
        companyTotalDec = companyTotalDec.add(ExactDecimal.parse(suppSummary.totalOutstanding, 2));
      }

      logger.info(
        { tenantId: ctx.tenantId, companyId, asOfDate: asOfDateStr, supplierCount: supplierSummaries.length },
        '[AP] Evaluated company aging summary'
      );

      return {
        tenantId: ctx.tenantId,
        companyId,
        asOfDate: asOfDateStr,
        totalOutstanding: companyTotalDec.toString(),
        currentAmount: companyCurrentDec.toString(),
        bucket1To30: companyB1To30Dec.toString(),
        bucket31To60: companyB31To60Dec.toString(),
        bucket61To90: companyB61To90Dec.toString(),
        bucket90Plus: companyB90PlusDec.toString(),
        supplierCount: supplierSummaries.length,
        suppliers: supplierSummaries
      };
    };

    if (this.dbPool) {
      return ApSettlementFoundation.withReadOnlySnapshot(this.dbPool, executeRead);
    }
    return executeRead();
  }
}

export const apAgingService = new ApAgingService();
