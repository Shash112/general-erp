import {
  RequestContext,
  ExactDecimal
} from '@general-erp/core';
import { logger } from '../../../config/logger.js';
import { authorizationService } from '../../../platform/authorization/authorization.service.js';
import { arDocumentService } from './ar-document.service.js';
import { arReceiptService } from './ar-receipt.service.js';
import { arAllocationService } from './ar-allocation.service.js';
import { arAdjustmentService } from './ar-adjustment.service.js';
import {
  ArAgingBucket,
  ArOpenItemAgingDTO,
  CustomerAgingSummaryDTO,
  CompanyAgingSummaryDTO,
  ArStatementTransactionDTO,
  CustomerStatementDTO,
  CustomerStatementQueryInput
} from './ar-aging-model.js';
import { ArAgingValidator } from './ar-aging-validator.js';
import type pg from 'pg';

export class ArAgingService {
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
      const isWildcard = ctx.user.permissions.some(p => p === '*' || p === action || p.startsWith('ar:aging:') || p.startsWith('ar:statement:'));
      if (!isWildcard) {
        authorizationService.authorize({ user: ctx.user, action, companyId });
      }
    }
  }

  /**
   * Helper: Calculate Days Overdue and Aging Bucket based on asOfDate and dueDate
   */
  public calculateBucket(asOfDate: string, dueDate: string): { daysOverdue: number; bucket: ArAgingBucket } {
    const asOfMs = new Date(asOfDate).getTime();
    const dueMs = new Date(dueDate).getTime();
    const daysOverdue = Math.floor((asOfMs - dueMs) / (1000 * 60 * 60 * 24));

    let bucket: ArAgingBucket = 'CURRENT';
    if (daysOverdue <= 0) {
      bucket = 'CURRENT';
    } else if (daysOverdue >= 1 && daysOverdue <= 30) {
      bucket = '1_30';
    } else if (daysOverdue >= 31 && daysOverdue <= 60) {
      bucket = '31_60';
    } else if (daysOverdue >= 61 && daysOverdue <= 90) {
      bucket = '61_90';
    } else if (daysOverdue >= 91 && daysOverdue <= 120) {
      bucket = '91_120';
    } else if (daysOverdue >= 121 && daysOverdue <= 180) {
      bucket = '121_180';
    } else {
      bucket = 'OVER_180';
    }

    return { daysOverdue, bucket };
  }

  /**
   * Evaluates historical aging for a single open item as of a target date
   */
  public async getOpenItemAging(ctx: RequestContext, openItemId: string, asOfDate?: string): Promise<ArOpenItemAgingDTO> {
    const openItem = await arDocumentService.getOpenItem(ctx, openItemId);
    this.authorize(ctx, 'ar:aging:read', openItem.companyId);

    const asOfDateStr = asOfDate || new Date().toISOString().split('T')[0]!;
    ArAgingValidator.validateDate(asOfDateStr, 'asOfDate');

    // Fetch active allocations effective by asOfDate
    const allAllocations = await arAllocationService.listAllocations(ctx, openItem.companyId, {
      openItemId,
      status: 'ACTIVE'
    });
    const effectiveAllocations = allAllocations.filter(a => a.allocationDate <= asOfDateStr);

    let activeAllocTotalDec = ExactDecimal.ZERO;
    for (const alloc of effectiveAllocations) {
      const allocDec = ExactDecimal.parse(alloc.allocatedAmount, 2);
      const discDec = ExactDecimal.parse(alloc.discountAmount, 2);
      activeAllocTotalDec = activeAllocTotalDec.add(allocDec).add(discDec);
    }

    // Fetch posted adjustments effective by asOfDate
    const allAdjustments = await arAdjustmentService.listAdjustments(ctx, openItem.companyId, {
      openItemId,
      status: 'POSTED'
    });
    const effectiveAdjustments = allAdjustments.filter(adj => {
      const adjDateStr = adj.createdAt.toISOString().split('T')[0]!;
      return adjDateStr <= asOfDateStr;
    });

    let writeOffsDec = ExactDecimal.ZERO;
    let creditAdjsDec = ExactDecimal.ZERO;
    let debitAdjsDec = ExactDecimal.ZERO;
    for (const adj of effectiveAdjustments) {
      const amtDec = ExactDecimal.parse(adj.amount, 2);
      if (adj.adjustmentType === 'WRITE_OFF') {
        writeOffsDec = writeOffsDec.add(amtDec);
      } else if (adj.adjustmentType === 'CREDIT_ADJUSTMENT') {
        creditAdjsDec = creditAdjsDec.add(amtDec);
      } else if (adj.adjustmentType === 'DEBIT_ADJUSTMENT') {
        debitAdjsDec = debitAdjsDec.add(amtDec);
      }
    }

    const origDec = ExactDecimal.parse(openItem.originalAmount, 2);
    const outstandingDec = origDec.sub(activeAllocTotalDec).sub(writeOffsDec).sub(creditAdjsDec).add(debitAdjsDec);
    const totalAdjDec = writeOffsDec.add(creditAdjsDec).sub(debitAdjsDec);

    const { daysOverdue, bucket } = this.calculateBucket(asOfDateStr, openItem.dueDate);

    return {
      openItemId: openItem.id,
      arDocumentId: openItem.arDocumentId,
      customerId: openItem.customerId,
      documentType: openItem.documentType,
      documentNumber: openItem.documentNumber,
      documentDate: openItem.documentDate,
      dueDate: openItem.dueDate,
      asOfDate: asOfDateStr,
      daysOverdue,
      originalAmount: openItem.originalAmount,
      allocatedAmount: activeAllocTotalDec.toString(),
      adjustmentAmount: totalAdjDec.toString(),
      outstandingAmount: outstandingDec.toString(),
      bucket
    };
  }

  /**
   * Evaluates customer-level aging summary as of a target date
   */
  public async getCustomerAging(
    ctx: RequestContext,
    companyId: string,
    customerId: string,
    asOfDate?: string
  ): Promise<CustomerAgingSummaryDTO> {
    ArAgingValidator.validateCompanyContext(ctx, companyId);
    this.authorize(ctx, 'ar:aging:read', companyId);

    const asOfDateStr = asOfDate || new Date().toISOString().split('T')[0]!;
    ArAgingValidator.validateDate(asOfDateStr, 'asOfDate');

    const openItems = await arDocumentService.getOpenItems(ctx, companyId, { customerId });
    const eligibleItems = openItems.filter(i => i.documentDate <= asOfDateStr);

    let currentDec = ExactDecimal.ZERO;
    let b1_30Dec = ExactDecimal.ZERO;
    let b31_60Dec = ExactDecimal.ZERO;
    let b61_90Dec = ExactDecimal.ZERO;
    let b91_120Dec = ExactDecimal.ZERO;
    let b121_180Dec = ExactDecimal.ZERO;
    let bOver180Dec = ExactDecimal.ZERO;
    let totalOutstandingDec = ExactDecimal.ZERO;

    for (const item of eligibleItems) {
      const aging = await this.getOpenItemAging(ctx, item.id, asOfDateStr);
      const outDec = ExactDecimal.parse(aging.outstandingAmount, 2);

      if (outDec.isZero()) continue;

      totalOutstandingDec = totalOutstandingDec.add(outDec);

      switch (aging.bucket) {
        case 'CURRENT':
          currentDec = currentDec.add(outDec);
          break;
        case '1_30':
          b1_30Dec = b1_30Dec.add(outDec);
          break;
        case '31_60':
          b31_60Dec = b31_60Dec.add(outDec);
          break;
        case '61_90':
          b61_90Dec = b61_90Dec.add(outDec);
          break;
        case '91_120':
          b91_120Dec = b91_120Dec.add(outDec);
          break;
        case '121_180':
          b121_180Dec = b121_180Dec.add(outDec);
          break;
        case 'OVER_180':
          bOver180Dec = bOver180Dec.add(outDec);
          break;
      }
    }

    return {
      tenantId: ctx.tenantId,
      companyId,
      customerId,
      asOfDate: asOfDateStr,
      current: currentDec.toString(),
      bucket1_30: b1_30Dec.toString(),
      bucket31_60: b31_60Dec.toString(),
      bucket61_90: b61_90Dec.toString(),
      bucket91_120: b91_120Dec.toString(),
      bucket121_180: b121_180Dec.toString(),
      bucketOver180: bOver180Dec.toString(),
      totalOutstanding: totalOutstandingDec.toString()
    };
  }

  /**
   * Evaluates company-level aggregated aging as of a target date
   */
  public async getCompanyAging(
    ctx: RequestContext,
    companyId: string,
    asOfDate?: string
  ): Promise<CompanyAgingSummaryDTO> {
    ArAgingValidator.validateCompanyContext(ctx, companyId);
    this.authorize(ctx, 'ar:aging:read', companyId);

    const asOfDateStr = asOfDate || new Date().toISOString().split('T')[0]!;
    ArAgingValidator.validateDate(asOfDateStr, 'asOfDate');

    const openItems = await arDocumentService.getOpenItems(ctx, companyId);
    const customerIds = [...new Set(openItems.map(i => i.customerId))];

    const customerSummaries: CustomerAgingSummaryDTO[] = [];
    let companyCurrentDec = ExactDecimal.ZERO;
    let companyB1_30Dec = ExactDecimal.ZERO;
    let companyB31_60Dec = ExactDecimal.ZERO;
    let companyB61_90Dec = ExactDecimal.ZERO;
    let companyB91_120Dec = ExactDecimal.ZERO;
    let companyB121_180Dec = ExactDecimal.ZERO;
    let companyBOver180Dec = ExactDecimal.ZERO;
    let companyTotalDec = ExactDecimal.ZERO;

    for (const custId of customerIds) {
      const custSummary = await this.getCustomerAging(ctx, companyId, custId, asOfDateStr);
      customerSummaries.push(custSummary);

      companyCurrentDec = companyCurrentDec.add(ExactDecimal.parse(custSummary.current, 2));
      companyB1_30Dec = companyB1_30Dec.add(ExactDecimal.parse(custSummary.bucket1_30, 2));
      companyB31_60Dec = companyB31_60Dec.add(ExactDecimal.parse(custSummary.bucket31_60, 2));
      companyB61_90Dec = companyB61_90Dec.add(ExactDecimal.parse(custSummary.bucket61_90, 2));
      companyB91_120Dec = companyB91_120Dec.add(ExactDecimal.parse(custSummary.bucket91_120, 2));
      companyB121_180Dec = companyB121_180Dec.add(ExactDecimal.parse(custSummary.bucket121_180, 2));
      companyBOver180Dec = companyBOver180Dec.add(ExactDecimal.parse(custSummary.bucketOver180, 2));
      companyTotalDec = companyTotalDec.add(ExactDecimal.parse(custSummary.totalOutstanding, 2));
    }

    return {
      tenantId: ctx.tenantId,
      companyId,
      asOfDate: asOfDateStr,
      current: companyCurrentDec.toString(),
      bucket1_30: companyB1_30Dec.toString(),
      bucket31_60: companyB31_60Dec.toString(),
      bucket61_90: companyB61_90Dec.toString(),
      bucket91_120: companyB91_120Dec.toString(),
      bucket121_180: companyB121_180Dec.toString(),
      bucketOver180: companyBOver180Dec.toString(),
      totalOutstanding: companyTotalDec.toString(),
      customerSummaries
    };
  }

  /**
   * Generates a customer account statement for a date range (fromDate -> toDate)
   */
  public async getCustomerStatement(
    ctx: RequestContext,
    companyId: string,
    input: CustomerStatementQueryInput
  ): Promise<CustomerStatementDTO> {
    ArAgingValidator.validateStatementQuery(ctx, companyId, input);
    this.authorize(ctx, 'ar:statement:read', companyId);

    const { customerId, fromDate, toDate } = input;

    const documents = await arDocumentService.listDocuments(ctx, companyId, { customerId });
    const receipts = await arReceiptService.listReceipts(ctx, companyId, { customerId, status: 'POSTED' });
    const adjustments = await arAdjustmentService.listAdjustments(ctx, companyId, { customerId, status: 'POSTED' });

    // 1. Opening Balance Calculation (< fromDate)
    let openingDebitDec = ExactDecimal.ZERO;
    let openingCreditDec = ExactDecimal.ZERO;

    for (const doc of documents) {
      if (doc.status !== 'POSTED' && doc.status !== 'PARTIALLY_SETTLED' && doc.status !== 'SETTLED') continue;
      if (doc.documentDate < fromDate) {
        if (doc.documentType === 'INVOICE' || doc.documentType === 'DEBIT_NOTE' || doc.documentType === 'OPENING_BALANCE') {
          openingDebitDec = openingDebitDec.add(ExactDecimal.parse(doc.grossAmount, 2));
        } else if (doc.documentType === 'CREDIT_NOTE') {
          openingCreditDec = openingCreditDec.add(ExactDecimal.parse(doc.grossAmount, 2));
        }
      }
    }

    for (const r of receipts) {
      if (r.receiptDate < fromDate) {
        openingCreditDec = openingCreditDec.add(ExactDecimal.parse(r.totalAmount, 2));
      }
    }

    for (const adj of adjustments) {
      const adjDateStr = adj.createdAt.toISOString().split('T')[0]!;
      if (adjDateStr < fromDate) {
        const amtDec = ExactDecimal.parse(adj.amount, 2);
        if (adj.adjustmentType === 'WRITE_OFF' || adj.adjustmentType === 'CREDIT_ADJUSTMENT') {
          openingCreditDec = openingCreditDec.add(amtDec);
        } else if (adj.adjustmentType === 'DEBIT_ADJUSTMENT') {
          openingDebitDec = openingDebitDec.add(amtDec);
        }
      }
    }

    const openingBalanceDec = openingDebitDec.sub(openingCreditDec);

    // 2. Period Transactions Collection (fromDate <= date <= toDate)
    const rawTxList: {
      id: string;
      transactionDate: string;
      documentType: string;
      documentNumber: string;
      narration: string;
      debitAmount: string;
      creditAmount: string;
    }[] = [];

    for (const doc of documents) {
      if (doc.status !== 'POSTED' && doc.status !== 'PARTIALLY_SETTLED' && doc.status !== 'SETTLED') continue;
      if (doc.documentDate >= fromDate && doc.documentDate <= toDate) {
        if (doc.documentType === 'INVOICE' || doc.documentType === 'DEBIT_NOTE' || doc.documentType === 'OPENING_BALANCE') {
          rawTxList.push({
            id: doc.id,
            transactionDate: doc.documentDate,
            documentType: doc.documentType,
            documentNumber: doc.documentNumber || doc.id,
            narration: `${doc.documentType} #${doc.documentNumber || doc.id}`,
            debitAmount: doc.grossAmount,
            creditAmount: '0.00'
          });
        } else if (doc.documentType === 'CREDIT_NOTE') {
          rawTxList.push({
            id: doc.id,
            transactionDate: doc.documentDate,
            documentType: doc.documentType,
            documentNumber: doc.documentNumber || doc.id,
            narration: `Credit Note #${doc.documentNumber || doc.id}`,
            debitAmount: '0.00',
            creditAmount: doc.grossAmount
          });
        }
      }
    }

    for (const r of receipts) {
      if (r.receiptDate >= fromDate && r.receiptDate <= toDate) {
        rawTxList.push({
          id: r.id,
          transactionDate: r.receiptDate,
          documentType: 'RECEIPT',
          documentNumber: r.receiptNumber || r.id,
          narration: `Customer Receipt (${r.paymentMode}) #${r.receiptNumber || r.id}`,
          debitAmount: '0.00',
          creditAmount: r.totalAmount
        });
      }
    }

    for (const adj of adjustments) {
      const adjDateStr = adj.createdAt.toISOString().split('T')[0]!;
      if (adjDateStr >= fromDate && adjDateStr <= toDate) {
        if (adj.adjustmentType === 'WRITE_OFF') {
          rawTxList.push({
            id: adj.id,
            transactionDate: adjDateStr,
            documentType: 'WRITE_OFF',
            documentNumber: adj.id,
            narration: `Write-Off Adjustment - ${adj.reason}`,
            debitAmount: '0.00',
            creditAmount: adj.amount
          });
        } else if (adj.adjustmentType === 'CREDIT_ADJUSTMENT') {
          rawTxList.push({
            id: adj.id,
            transactionDate: adjDateStr,
            documentType: 'CREDIT_ADJUSTMENT',
            documentNumber: adj.id,
            narration: `Credit Adjustment - ${adj.reason}`,
            debitAmount: '0.00',
            creditAmount: adj.amount
          });
        } else if (adj.adjustmentType === 'DEBIT_ADJUSTMENT') {
          rawTxList.push({
            id: adj.id,
            transactionDate: adjDateStr,
            documentType: 'DEBIT_ADJUSTMENT',
            documentNumber: adj.id,
            narration: `Debit Adjustment - ${adj.reason}`,
            debitAmount: adj.amount,
            creditAmount: '0.00'
          });
        }
      }
    }

    // 3. Deterministic Transaction Sorting
    rawTxList.sort((a, b) => {
      if (a.transactionDate !== b.transactionDate) {
        return a.transactionDate.localeCompare(b.transactionDate);
      }
      if (a.documentType !== b.documentType) {
        return a.documentType.localeCompare(b.documentType);
      }
      return a.id.localeCompare(b.id);
    });

    // 4. Running Balance & Totals Calculation
    let currentBalanceDec = openingBalanceDec;
    let periodTotalDebitsDec = ExactDecimal.ZERO;
    let periodTotalCreditsDec = ExactDecimal.ZERO;

    const statementTransactions: ArStatementTransactionDTO[] = [];

    for (const tx of rawTxList) {
      const dDec = ExactDecimal.parse(tx.debitAmount, 2);
      const cDec = ExactDecimal.parse(tx.creditAmount, 2);

      periodTotalDebitsDec = periodTotalDebitsDec.add(dDec);
      periodTotalCreditsDec = periodTotalCreditsDec.add(cDec);

      currentBalanceDec = currentBalanceDec.add(dDec).sub(cDec);

      statementTransactions.push({
        ...tx,
        runningBalance: currentBalanceDec.toString()
      });
    }

    const closingBalanceDec = currentBalanceDec;

    logger.info(
      { tenantId: ctx.tenantId, companyId, customerId, fromDate, toDate, txCount: statementTransactions.length },
      '[AR] Generated customer account statement'
    );

    return {
      tenantId: ctx.tenantId,
      companyId,
      customerId,
      fromDate,
      toDate,
      openingBalance: openingBalanceDec.toString(),
      totalDebits: periodTotalDebitsDec.toString(),
      totalCredits: periodTotalCreditsDec.toString(),
      closingBalance: closingBalanceDec.toString(),
      transactions: statementTransactions
    };
  }
}

export const arAgingService = new ArAgingService();
