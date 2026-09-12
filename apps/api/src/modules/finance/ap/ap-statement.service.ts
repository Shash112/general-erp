import {
  RequestContext,
  ExactDecimal
} from '@general-erp/core';
import { logger } from '../../../config/logger.js';
import { authorizationService } from '../../../platform/authorization/authorization.service.js';
import { masterDataService } from '../../../platform/master-data/master-data.service.js';
import { apDocumentService } from './ap-document.service.js';
import { apPaymentService } from './ap-payment.service.js';
import { apAllocationService } from './ap-allocation.service.js';
import { apAdjustmentService } from './ap-adjustment.service.js';
import { ApSettlementFoundation } from './ap-settlement-foundation.js';
import {
  SupplierStatementDTO,
  SupplierStatementLineDTO,
  SupplierStatementQueryInput
} from './ap-aging-model.js';
import { ApAgingValidator } from './ap-aging-validator.js';
import type pg from 'pg';

export class ApStatementService {
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
        p => p === '*' || p === action || p.startsWith('ap:statement:') || p.startsWith('ap:aging:')
      );
      if (!isWildcard) {
        authorizationService.authorize({ user: ctx.user, action, companyId });
      }
    }
  }

  /**
   * Helper: Calculate previous YYYY-MM-DD date string
   */
  private getPreviousDate(dateStr: string): string {
    const d = new Date(dateStr);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().split('T')[0]!;
  }

  /**
   * Generates a supplier account statement for a date range (fromDate -> toDate)
   */
  public async getSupplierStatement(
    ctx: RequestContext,
    companyId: string,
    input: SupplierStatementQueryInput
  ): Promise<SupplierStatementDTO> {
    ApAgingValidator.validateStatementQuery(ctx, companyId, input);
    this.authorize(ctx, 'ap:statement:read', companyId);

    const { supplierId, fromDate, toDate } = input;
    const prevDateStr = this.getPreviousDate(fromDate);

    const executeRead = async (): Promise<SupplierStatementDTO> => {
      const supplier = await masterDataService.getSupplier(ctx, supplierId);

      const documents = await apDocumentService.listDocuments(ctx, companyId, { supplierId });
      const payments = await apPaymentService.listPayments(ctx, companyId, { supplierId });
      const allAllocations = await apAllocationService.listAllocations(ctx, companyId);
      const adjustments = await apAdjustmentService.listAdjustments(ctx, companyId, { supplierId });

      // Filter allocations relevant to this supplier's open items or payments
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItemIds = new Set(openItems.map(i => i.id));
      const paymentIds = new Set(payments.map(p => p.id));
      const allocations = allAllocations.filter(
        a => openItemIds.has(a.openItemId) || (a.paymentId && paymentIds.has(a.paymentId))
      );

      // 1. Opening Balance Calculation (effective as of fromDate - 1 day)
      let openingDebitDec = ExactDecimal.ZERO;
      let openingCreditDec = ExactDecimal.ZERO;

      for (const doc of documents) {
        if (doc.status === 'DRAFT' || doc.status === 'CANCELLED') continue;
        const revDate = (doc as any).reversalAccountingDate || (doc.status === 'REVERSED' ? doc.updatedAt.toISOString().substring(0, 10) : null);
        if (ApSettlementFoundation.isEntityIncludedAsOf(doc.accountingDate, revDate, prevDateStr)) {
          const amtDec = ExactDecimal.parse(doc.grossAmount, 2);
          if (doc.documentType === 'SUPPLIER_BILL' || doc.documentType === 'DEBIT_NOTE' || doc.documentType === 'OPENING_BALANCE') {
            openingDebitDec = openingDebitDec.add(amtDec);
          } else if (doc.documentType === 'CREDIT_NOTE') {
            openingCreditDec = openingCreditDec.add(amtDec);
          }
        }
      }

      for (const p of payments) {
        if (p.status === 'DRAFT') continue;
        const revDate = (p as any).reversalAccountingDate || (p.status === 'REVERSED' ? p.updatedAt.toISOString().substring(0, 10) : null);
        if (ApSettlementFoundation.isEntityIncludedAsOf(p.accountingDate, revDate, prevDateStr)) {
          openingCreditDec = openingCreditDec.add(ExactDecimal.parse(p.totalAmount, 2));
        }
      }

      for (const adj of adjustments) {
        if (adj.status !== 'POSTED' && adj.status !== 'REVERSED') continue;
        const revDate = adj.reversalAccountingDate || (adj.status === 'REVERSED' && adj.reversedAt ? adj.reversedAt.toISOString().substring(0, 10) : null);
        if (ApSettlementFoundation.isEntityIncludedAsOf(adj.accountingDate, revDate, prevDateStr)) {
          const amtDec = ExactDecimal.parse(adj.amount, 2);
          if (adj.adjustmentType === 'WRITE_OFF' || adj.adjustmentType === 'CREDIT_ADJUSTMENT') {
            openingCreditDec = openingCreditDec.add(amtDec);
          } else if (adj.adjustmentType === 'DEBIT_ADJUSTMENT') {
            openingDebitDec = openingDebitDec.add(amtDec);
          }
        }
      }

      for (const alloc of allocations) {
        const discDec = ExactDecimal.parse(alloc.discountAmount, 2);
        if (discDec.isPositive()) {
          const revDate = (alloc as any).reversalAccountingDate || (alloc.status === 'REVERSED' && alloc.reversedAt ? alloc.reversedAt.toISOString().substring(0, 10) : null);
          if (ApSettlementFoundation.isEntityIncludedAsOf(alloc.allocationDate, revDate, prevDateStr)) {
            openingCreditDec = openingCreditDec.add(discDec);
          }
        }
      }

      const openingBalanceDec = openingDebitDec.sub(openingCreditDec);

      // 2. Period Transactions Collection (effective in fromDate..toDate)
      const rawTxList: {
        id: string;
        date: string;
        documentType: string;
        documentNumber: string;
        referenceNumber?: string | null | undefined;
        narration: string;
        debitAmount: string;
        creditAmount: string;
      }[] = [];

      // A. Document Postings & Reversals
      for (const doc of documents) {
        if (doc.status === 'DRAFT' || doc.status === 'CANCELLED') continue;
        const revDate = (doc as any).reversalAccountingDate || (doc.status === 'REVERSED' ? doc.updatedAt.toISOString().substring(0, 10) : null);

        // Document Posting in period
        if (ApSettlementFoundation.isTransactionEffectiveAsOf(doc.accountingDate, toDate) && doc.accountingDate >= fromDate) {
          const isDebitType = doc.documentType === 'SUPPLIER_BILL' || doc.documentType === 'DEBIT_NOTE' || doc.documentType === 'OPENING_BALANCE';
          rawTxList.push({
            id: `POST_${doc.id}`,
            date: doc.accountingDate,
            documentType: doc.documentType,
            documentNumber: doc.documentNumber || doc.id,
            referenceNumber: doc.supplierInvoiceNumber || null,
            narration: `${doc.documentType} #${doc.documentNumber || doc.id}`,
            debitAmount: isDebitType ? doc.grossAmount : '0.00',
            creditAmount: isDebitType ? '0.00' : doc.grossAmount
          });
        }

        // Document Reversal in period
        if (revDate && ApSettlementFoundation.isReversalEffectiveAsOf(revDate, toDate) && revDate >= fromDate) {
          const isDebitType = doc.documentType === 'SUPPLIER_BILL' || doc.documentType === 'DEBIT_NOTE' || doc.documentType === 'OPENING_BALANCE';
          rawTxList.push({
            id: `REV_${doc.id}`,
            date: revDate,
            documentType: `${doc.documentType}_REVERSAL`,
            documentNumber: doc.documentNumber || doc.id,
            referenceNumber: doc.supplierInvoiceNumber || null,
            narration: `Reversal of ${doc.documentType} #${doc.documentNumber || doc.id}`,
            debitAmount: isDebitType ? '0.00' : doc.grossAmount,
            creditAmount: isDebitType ? doc.grossAmount : '0.00'
          });
        }
      }

      // B. Payment Postings & Reversals
      for (const p of payments) {
        if (p.status === 'DRAFT') continue;
        const revDate = (p as any).reversalAccountingDate || (p.status === 'REVERSED' ? p.updatedAt.toISOString().substring(0, 10) : null);

        if (ApSettlementFoundation.isTransactionEffectiveAsOf(p.accountingDate, toDate) && p.accountingDate >= fromDate) {
          rawTxList.push({
            id: `POST_${p.id}`,
            date: p.accountingDate,
            documentType: 'PAYMENT',
            documentNumber: p.paymentNumber || p.id,
            referenceNumber: p.referenceNumber || null,
            narration: `Supplier Payment (${p.paymentMode}) #${p.paymentNumber || p.id}`,
            debitAmount: '0.00',
            creditAmount: p.totalAmount
          });
        }

        if (revDate && ApSettlementFoundation.isReversalEffectiveAsOf(revDate, toDate) && revDate >= fromDate) {
          rawTxList.push({
            id: `REV_${p.id}`,
            date: revDate,
            documentType: 'PAYMENT_REVERSAL',
            documentNumber: p.paymentNumber || p.id,
            referenceNumber: p.referenceNumber || null,
            narration: `Reversal of Payment #${p.paymentNumber || p.id}`,
            debitAmount: p.totalAmount,
            creditAmount: '0.00'
          });
        }
      }

      // C. Adjustment Postings & Reversals
      for (const adj of adjustments) {
        if (adj.status !== 'POSTED' && adj.status !== 'REVERSED') continue;
        const revDate = adj.reversalAccountingDate || (adj.status === 'REVERSED' && adj.reversedAt ? adj.reversedAt.toISOString().substring(0, 10) : null);

        if (ApSettlementFoundation.isTransactionEffectiveAsOf(adj.accountingDate, toDate) && adj.accountingDate >= fromDate) {
          const isDebit = adj.adjustmentType === 'DEBIT_ADJUSTMENT';
          rawTxList.push({
            id: `POST_${adj.id}`,
            date: adj.accountingDate,
            documentType: adj.adjustmentType,
            documentNumber: adj.adjustmentNumber || adj.id,
            referenceNumber: adj.adjustmentNumber || null,
            narration: `${adj.adjustmentType} - ${adj.reason}`,
            debitAmount: isDebit ? adj.amount : '0.00',
            creditAmount: isDebit ? '0.00' : adj.amount
          });
        }

        if (revDate && ApSettlementFoundation.isReversalEffectiveAsOf(revDate, toDate) && revDate >= fromDate) {
          const isDebit = adj.adjustmentType === 'DEBIT_ADJUSTMENT';
          rawTxList.push({
            id: `REV_${adj.id}`,
            date: revDate,
            documentType: `${adj.adjustmentType}_REVERSAL`,
            documentNumber: adj.adjustmentNumber || adj.id,
            referenceNumber: adj.adjustmentNumber || null,
            narration: `Reversal of ${adj.adjustmentType} - ${adj.reason}`,
            debitAmount: isDebit ? '0.00' : adj.amount,
            creditAmount: isDebit ? adj.amount : '0.00'
          });
        }
      }

      // D. Prompt Payment Discount Postings & Reversals
      for (const alloc of allocations) {
        const discDec = ExactDecimal.parse(alloc.discountAmount, 2);
        if (discDec.isPositive()) {
          const revDate = (alloc as any).reversalAccountingDate || (alloc.status === 'REVERSED' && alloc.reversedAt ? alloc.reversedAt.toISOString().substring(0, 10) : null);

          if (ApSettlementFoundation.isAllocationEffectiveAsOf(alloc.allocationDate, toDate) && alloc.allocationDate >= fromDate) {
            rawTxList.push({
              id: `DISC_${alloc.id}`,
              date: alloc.allocationDate,
              documentType: 'PROMPT_PAYMENT_DISCOUNT',
              documentNumber: alloc.id,
              narration: `Prompt Payment Discount on Allocation #${alloc.id}`,
              debitAmount: '0.00',
              creditAmount: alloc.discountAmount
            });
          }

          if (revDate && ApSettlementFoundation.isReversalEffectiveAsOf(revDate, toDate) && revDate >= fromDate) {
            rawTxList.push({
              id: `DISC_REV_${alloc.id}`,
              date: revDate,
              documentType: 'DISCOUNT_REVERSAL',
              documentNumber: alloc.id,
              narration: `Reversal of Prompt Payment Discount on Allocation #${alloc.id}`,
              debitAmount: alloc.discountAmount,
              creditAmount: '0.00'
            });
          }
        }
      }

      // 3. Deterministic Transaction Sorting
      rawTxList.sort((a, b) => {
        if (a.date !== b.date) {
          return a.date.localeCompare(b.date);
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

      const statementLines: SupplierStatementLineDTO[] = [];

      for (const tx of rawTxList) {
        const dDec = ExactDecimal.parse(tx.debitAmount, 2);
        const cDec = ExactDecimal.parse(tx.creditAmount, 2);

        periodTotalDebitsDec = periodTotalDebitsDec.add(dDec);
        periodTotalCreditsDec = periodTotalCreditsDec.add(cDec);

        currentBalanceDec = currentBalanceDec.add(dDec).sub(cDec);

        statementLines.push({
          id: tx.id,
          date: tx.date,
          documentType: tx.documentType,
          documentNumber: tx.documentNumber,
          referenceNumber: tx.referenceNumber,
          narration: tx.narration,
          debitAmount: tx.debitAmount,
          creditAmount: tx.creditAmount,
          runningBalance: currentBalanceDec.toString()
        });
      }

      const closingBalanceDec = currentBalanceDec;

      logger.info(
        { tenantId: ctx.tenantId, companyId, supplierId, fromDate, toDate, lineCount: statementLines.length },
        '[AP] Generated supplier account statement'
      );

      return {
        tenantId: ctx.tenantId,
        companyId,
        supplierId,
        supplierCode: (supplier as any).supplierCode || undefined,
        supplierName: supplier.name,
        fromDate,
        toDate,
        openingBalance: openingBalanceDec.toString(),
        totalDebits: periodTotalDebitsDec.toString(),
        totalCredits: periodTotalCreditsDec.toString(),
        closingBalance: closingBalanceDec.toString(),
        lines: statementLines
      };
    };

    if (this.dbPool) {
      return ApSettlementFoundation.withReadOnlySnapshot(this.dbPool, executeRead);
    }
    return executeRead();
  }
}

export const apStatementService = new ApStatementService();
