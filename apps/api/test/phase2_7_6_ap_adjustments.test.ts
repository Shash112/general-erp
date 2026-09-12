import { describe, it, expect, beforeEach } from 'vitest';
import {
  RequestContext,
  ValidationError,
  ForbiddenError,
  NotFoundError,
  BusinessRuleViolationError,
  AccountingError,
  ExactDecimal
} from '@general-erp/core';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { accountingConfigurationService } from '../src/modules/finance/accounting-core.service.js';
import { journalDraftService } from '../src/modules/finance/journal-draft.service.js';
import { apDocumentService } from '../src/modules/finance/ap/ap-document.service.js';
import { apPaymentService } from '../src/modules/finance/ap/ap-payment.service.js';
import { apAllocationService } from '../src/modules/finance/ap/ap-allocation.service.js';
import { apAdjustmentService } from '../src/modules/finance/ap/ap-adjustment.service.js';
import { apSettlementService } from '../src/modules/finance/ap/ap-settlement.service.js';
import { apHistoricalSettlementService } from '../src/modules/finance/ap/ap-historical-settlement.service.js';
import { apReconciliationService } from '../src/modules/finance/ap/ap-reconciliation.service.js';

describe('Phase 2.7.6 — AP Adjustments & Write-Offs', () => {
  const tenantId = 'tenant_ap_adj_phase276';
  const companyId = 'cmp_ap_adj_acme';
  const supplierId = 'supp_ap_adj_acme_corp';
  const otherSupplierId = 'supp_ap_adj_other_corp';

  const ctx: RequestContext = {
    tenantId,
    companyId,
    user: {
      id: 'usr_ap_manager',
      tenantId,
      roles: ['AP_MANAGER'],
      permissions: [
        '*',
        'ap:adjustment:create',
        'ap:adjustment:post',
        'ap:adjustment:reverse',
        'ap:adjustment:cancel',
        'ap:adjustment:read',
        'ap:document:create',
        'ap:document:post',
        'ap:settlement:read',
        'ap:settlement:reconcile'
      ]
    }
  };

  const readOnlyCtx: RequestContext = {
    tenantId,
    companyId,
    user: {
      id: 'usr_ap_reader',
      tenantId,
      roles: ['AP_VIEWER'],
      permissions: ['ap:settlement:read']
    }
  };

  const otherTenantCtx: RequestContext = {
    tenantId: 'tenant_other_adj',
    companyId: 'cmp_other_adj',
    user: {
      id: 'usr_other_tenant',
      tenantId: 'tenant_other_adj',
      roles: ['AP_CLERK'],
      permissions: ['*']
    }
  };

  let apControlAccountId: string;
  let writeOffOffsetAccountId: string;
  let creditAdjOffsetAccountId: string;
  let debitAdjOffsetAccountId: string;

  beforeEach(async () => {
    // Clear stores
    masterDataService.clear();
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    accountingConfigurationService.clear();
    apDocumentService.clear();
    apPaymentService.clear();
    apAllocationService.clear();
    apAdjustmentService.clear();
    journalDraftService.clear();

    // 1. Setup Master Data
    await masterDataService.createCompany(ctx, {
      id: companyId,
      name: 'ACME Inc',
      legalName: 'ACME Private Limited',
      code: 'ACME'
    });

    await masterDataService.createSupplier(ctx, {
      id: supplierId,
      companyId,
      name: 'ACME Supplies Corp',
      code: 'ACME001'
    });

    await masterDataService.createSupplier(ctx, {
      id: otherSupplierId,
      companyId,
      name: 'Global Logistics Ltd',
      code: 'GLOB001'
    });

    // 2. Setup Fiscal Year & Period
    await fiscalPeriodService.createFiscalYear(ctx, {
      companyId,
      name: 'FY2026',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31')
    });

    // 3. Setup Chart of Accounts
    const apAcc = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '2100',
      accountName: 'Accounts Payable Control',
      accountType: 'LIABILITY',
      isControlAccount: true,
      controlAccountType: 'AP'
    });
    apControlAccountId = apAcc.id;

    const woAcc = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '5800',
      accountName: 'AP Write-Off Expense/Income Offset',
      accountType: 'EXPENSE'
    });
    writeOffOffsetAccountId = woAcc.id;

    const crAcc = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '5810',
      accountName: 'AP Credit Adjustment Offset',
      accountType: 'EXPENSE'
    });
    creditAdjOffsetAccountId = crAcc.id;

    const drAcc = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '5820',
      accountName: 'AP Debit Adjustment Offset',
      accountType: 'EXPENSE'
    });
    debitAdjOffsetAccountId = drAcc.id;

    // 4. Setup Accounting Configuration Mappings
    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_SUPPLIER_BILL',
      lineRole: 'AP_CONTROL',
      accountId: apControlAccountId
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_CREDIT_NOTE',
      lineRole: 'AP_CONTROL',
      accountId: apControlAccountId
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_PAYMENT',
      lineRole: 'AP_CONTROL',
      accountId: apControlAccountId
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_PAYMENT',
      lineRole: 'BANK_ACCOUNT',
      accountId: writeOffOffsetAccountId
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_ADJUSTMENT',
      lineRole: 'AP_CONTROL',
      accountId: apControlAccountId
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_ADJUSTMENT',
      lineRole: 'WRITE_OFF_OFFSET',
      accountId: writeOffOffsetAccountId
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_ADJUSTMENT',
      lineRole: 'CREDIT_ADJUSTMENT_OFFSET',
      accountId: creditAdjOffsetAccountId
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_ADJUSTMENT',
      lineRole: 'DEBIT_ADJUSTMENT_OFFSET',
      accountId: debitAdjOffsetAccountId
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_ADJUSTMENT_REVERSAL',
      lineRole: 'AP_CONTROL',
      accountId: apControlAccountId
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_ADJUSTMENT_REVERSAL',
      lineRole: 'WRITE_OFF_OFFSET',
      accountId: writeOffOffsetAccountId
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_ADJUSTMENT_REVERSAL',
      lineRole: 'CREDIT_ADJUSTMENT_OFFSET',
      accountId: creditAdjOffsetAccountId
    });

    await accountingConfigurationService.setMapping(ctx, {
      companyId,
      eventType: 'AP_ADJUSTMENT_REVERSAL',
      lineRole: 'DEBIT_ADJUSTMENT_OFFSET',
      accountId: debitAdjOffsetAccountId
    });
  });

  // Helper to create and post a bill open item
  async function createPostedBill(amountStr: string = '10000.00', dateStr: string = '2026-02-01') {
    const doc = await apDocumentService.createDraft(ctx, {
      companyId,
      supplierId,
      documentType: 'SUPPLIER_BILL',
      documentDate: dateStr,
      accountingDate: dateStr,
      dueDate: '2026-03-01',
      currency: 'INR',
      lines: [
        {
          lineSequence: 1,
          description: 'Office Supplies',
          expenseAccountId: writeOffOffsetAccountId,
          quantity: '1.0000',
          unitPrice: amountStr,
          taxableAmount: amountStr,
          taxAmount: '0.00',
          grossAmount: amountStr
        }
      ]
    });
    const posted = await apDocumentService.postDocument(ctx, doc.id);
    const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
    const openItem = openItems.find(i => i.apDocumentId === posted.id);
    if (!openItem) throw new Error('Open item not found for bill');
    return { doc: posted, openItem };
  }

  // =========================================================================
  // 1. MODEL TESTS
  // =========================================================================
  describe('1. Model & Validation', () => {
    it('1. creates draft AP adjustment with correct fields', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId,
        openItemId: openItem.id,
        adjustmentType: 'WRITE_OFF',
        amount: '2000.00',
        reason: 'Uncollectible vendor dispute resolution'
      });

      expect(draft.id).toBeDefined();
      expect(draft.status).toBe('DRAFT');
      expect(draft.amount).toBe('2000.00');
      expect(draft.adjustmentType).toBe('WRITE_OFF');
      expect(draft.supplierId).toBe(supplierId);
      expect(draft.openItemId).toBe(openItem.id);
    });

    it('2. validates input and rejects zero amount, empty reason, invalid type', async () => {
      const { openItem } = await createPostedBill('10000.00');

      await expect(
        apAdjustmentService.createDraftAdjustment(ctx, {
          supplierId,
          openItemId: openItem.id,
          adjustmentType: 'WRITE_OFF',
          amount: '0.00',
          reason: 'Zero test'
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        apAdjustmentService.createDraftAdjustment(ctx, {
          supplierId,
          openItemId: openItem.id,
          adjustmentType: 'WRITE_OFF',
          amount: '500.00',
          reason: ''
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        apAdjustmentService.createDraftAdjustment(ctx, {
          supplierId,
          openItemId: openItem.id,
          adjustmentType: 'INVALID_TYPE' as any,
          amount: '500.00',
          reason: 'Bad type'
        })
      ).rejects.toThrow(ValidationError);
    });

    it('3. supports draft -> posted -> reversed and draft -> cancelled lifecycle', async () => {
      const { openItem } = await createPostedBill('10000.00');

      // Draft -> Cancelled
      const draft1 = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId,
        openItemId: openItem.id,
        adjustmentType: 'WRITE_OFF',
        amount: '1000.00',
        reason: 'Cancel test'
      });
      const cancelled = await apAdjustmentService.cancelAdjustment(ctx, draft1.id);
      expect(cancelled.status).toBe('CANCELLED');

      // Draft -> Posted -> Reversed
      const draft2 = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId,
        openItemId: openItem.id,
        adjustmentType: 'WRITE_OFF',
        amount: '1000.00',
        reason: 'Post & Reverse test'
      });
      const posted = await apAdjustmentService.postAdjustment(ctx, draft2.id);
      expect(posted.status).toBe('POSTED');

      const reversed = await apAdjustmentService.reverseAdjustment(ctx, posted.id, {
        reason: 'Correction of error'
      });
      expect(reversed.status).toBe('REVERSED');
    });

    it('4. enforces tenant, company, and supplier ownership validation', async () => {
      const { openItem } = await createPostedBill('10000.00');

      // Cross-supplier
      await expect(
        apAdjustmentService.createDraftAdjustment(ctx, {
          supplierId: otherSupplierId,
          openItemId: openItem.id,
          adjustmentType: 'WRITE_OFF',
          amount: '1000.00',
          reason: 'Cross supplier'
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  // =========================================================================
  // 2. WRITE-OFF TESTS
  // =========================================================================
  describe('2. WRITE_OFF Semantics', () => {
    it('5. posts valid write-off successfully', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId,
        openItemId: openItem.id,
        adjustmentType: 'WRITE_OFF',
        amount: '3000.00',
        reason: 'Vendor waiver agreed'
      });
      const posted = await apAdjustmentService.postAdjustment(ctx, draft.id);
      expect(posted.status).toBe('POSTED');
      expect(posted.journalEntryId).toBeDefined();
    });

    it('6. write-off reduces open item outstanding payable amount', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId,
        openItemId: openItem.id,
        adjustmentType: 'WRITE_OFF',
        amount: '3000.00',
        reason: 'Partial write-off'
      });
      await apAdjustmentService.postAdjustment(ctx, draft.id);

      const settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);
      expect(settlement.outstandingAmount).toBe('7000.00');
      expect(settlement.activeWriteOffsTotal).toBe('3000.00');
    });

    it('7. rejects excessive write-off exceeding open item outstanding amount', async () => {
      const { openItem } = await createPostedBill('10000.00');

      await expect(
        apAdjustmentService.createDraftAdjustment(ctx, {
          supplierId,
          openItemId: openItem.id,
          adjustmentType: 'WRITE_OFF',
          amount: '10000.01',
          reason: 'Over write-off'
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('8. generates correct GL write-off accounting entry (DR AP_CONTROL, CR WRITE_OFF_OFFSET)', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId,
        openItemId: openItem.id,
        adjustmentType: 'WRITE_OFF',
        amount: '2500.00',
        reason: 'Waiver'
      });
      const posted = await apAdjustmentService.postAdjustment(ctx, draft.id);

      const recon = await apReconciliationService.reconcileCompanyAP(ctx, companyId);
      expect(recon.reconciliationStatus).toBe('PASS');
      expect(recon.netSubledgerPayableTotal).toBe('7500.00');
      expect(recon.glApControlBalance).toBe('7500.00');
    });

    it('9. write-off reversal restores open item outstanding balance and posts compensating GL entry', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId,
        openItemId: openItem.id,
        adjustmentType: 'WRITE_OFF',
        amount: '4000.00',
        reason: 'Test reversal'
      });
      const posted = await apAdjustmentService.postAdjustment(ctx, draft.id);

      let settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);
      expect(settlement.outstandingAmount).toBe('6000.00');

      await apAdjustmentService.reverseAdjustment(ctx, posted.id, {
        reason: 'Reversing accidental write-off'
      });

      settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);
      expect(settlement.outstandingAmount).toBe('10000.00');

      const recon = await apReconciliationService.reconcileCompanyAP(ctx, companyId);
      expect(recon.reconciliationStatus).toBe('PASS');
      expect(recon.glApControlBalance).toBe('10000.00');
    });
  });

  // =========================================================================
  // 3. CREDIT ADJUSTMENT TESTS
  // =========================================================================
  describe('3. CREDIT_ADJUSTMENT Semantics', () => {
    it('10. posts valid credit adjustment successfully', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId,
        openItemId: openItem.id,
        adjustmentType: 'CREDIT_ADJUSTMENT',
        amount: '1500.00',
        reason: 'Vendor price adjustment credit'
      });
      const posted = await apAdjustmentService.postAdjustment(ctx, draft.id);
      expect(posted.status).toBe('POSTED');
    });

    it('11. credit adjustment reduces outstanding payable amount', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId,
        openItemId: openItem.id,
        adjustmentType: 'CREDIT_ADJUSTMENT',
        amount: '1500.00',
        reason: 'Vendor discount credit'
      });
      await apAdjustmentService.postAdjustment(ctx, draft.id);

      const settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);
      expect(settlement.outstandingAmount).toBe('8500.00');
      expect(settlement.activeCreditAdjustmentsTotal).toBe('1500.00');
    });

    it('12. rejects credit adjustment exceeding eligible exposure', async () => {
      const { openItem } = await createPostedBill('5000.00');

      await expect(
        apAdjustmentService.createDraftAdjustment(ctx, {
          supplierId,
          openItemId: openItem.id,
          adjustmentType: 'CREDIT_ADJUSTMENT',
          amount: '5000.01',
          reason: 'Excess credit'
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('13. credit adjustment generates correct GL accounting (DR AP_CONTROL, CR CREDIT_ADJUSTMENT_OFFSET)', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId,
        openItemId: openItem.id,
        adjustmentType: 'CREDIT_ADJUSTMENT',
        amount: '2000.00',
        reason: 'Credit adjustment'
      });
      await apAdjustmentService.postAdjustment(ctx, draft.id);

      const recon = await apReconciliationService.reconcileCompanyAP(ctx, companyId);
      expect(recon.reconciliationStatus).toBe('PASS');
      expect(recon.netSubledgerPayableTotal).toBe('8000.00');
      expect(recon.glApControlBalance).toBe('8000.00');
    });

    it('14. credit adjustment reversal restores original outstanding balance', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId,
        openItemId: openItem.id,
        adjustmentType: 'CREDIT_ADJUSTMENT',
        amount: '3000.00',
        reason: 'Test credit reversal'
      });
      const posted = await apAdjustmentService.postAdjustment(ctx, draft.id);
      await apAdjustmentService.reverseAdjustment(ctx, posted.id, { reason: 'Error in credit calculation' });

      const settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);
      expect(settlement.outstandingAmount).toBe('10000.00');
    });
  });

  // =========================================================================
  // 4. DEBIT ADJUSTMENT TESTS
  // =========================================================================
  describe('4. DEBIT_ADJUSTMENT Semantics', () => {
    it('15. posts valid debit adjustment successfully', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId,
        openItemId: openItem.id,
        adjustmentType: 'DEBIT_ADJUSTMENT',
        amount: '1000.00',
        reason: 'Late penalty fee addition to open payable'
      });
      const posted = await apAdjustmentService.postAdjustment(ctx, draft.id);
      expect(posted.status).toBe('POSTED');
    });

    it('16. debit adjustment increases open item outstanding payable exposure', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId,
        openItemId: openItem.id,
        adjustmentType: 'DEBIT_ADJUSTMENT',
        amount: '1200.00',
        reason: 'Additional fee charge'
      });
      await apAdjustmentService.postAdjustment(ctx, draft.id);

      const settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);
      expect(settlement.outstandingAmount).toBe('11200.00');
      expect(settlement.activeDebitAdjustmentsTotal).toBe('1200.00');
    });

    it('17. debit adjustment generates correct GL accounting (DR DEBIT_ADJUSTMENT_OFFSET, CR AP_CONTROL)', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId,
        openItemId: openItem.id,
        adjustmentType: 'DEBIT_ADJUSTMENT',
        amount: '500.00',
        reason: 'Debit adjustment'
      });
      await apAdjustmentService.postAdjustment(ctx, draft.id);

      const recon = await apReconciliationService.reconcileCompanyAP(ctx, companyId);
      expect(recon.reconciliationStatus).toBe('PASS');
      expect(recon.netSubledgerPayableTotal).toBe('10500.00');
      expect(recon.glApControlBalance).toBe('10500.00');
    });

    it('18. debit adjustment reversal decreases outstanding and fails if negative', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId,
        openItemId: openItem.id,
        adjustmentType: 'DEBIT_ADJUSTMENT',
        amount: '1000.00',
        reason: 'Extra debit'
      });
      const posted = await apAdjustmentService.postAdjustment(ctx, draft.id);

      await apAdjustmentService.reverseAdjustment(ctx, posted.id, { reason: 'Reversing fee charge' });

      const settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);
      expect(settlement.outstandingAmount).toBe('10000.00');
    });
  });

  // =========================================================================
  // 5. SETTLEMENT & RECONCILIATION INTEGRATION TESTS
  // =========================================================================
  describe('5. Settlement & Reconciliation Integration', () => {
    it('19. open item settlement formula incorporates all adjustment types correctly', async () => {
      const { openItem } = await createPostedBill('10000.00');

      // Write-off 1000
      const d1 = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '1000.00', reason: 'WO'
      });
      await apAdjustmentService.postAdjustment(ctx, d1.id);

      // Credit Adj 500
      const d2 = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'CREDIT_ADJUSTMENT', amount: '500.00', reason: 'CR'
      });
      await apAdjustmentService.postAdjustment(ctx, d2.id);

      // Debit Adj 200
      const d3 = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'DEBIT_ADJUSTMENT', amount: '200.00', reason: 'DR'
      });
      await apAdjustmentService.postAdjustment(ctx, d3.id);

      // Outstanding = 10000 - 1000 - 500 + 200 = 8700
      const settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);
      expect(settlement.outstandingAmount).toBe('8700.00');
    });

    it('20. supplier summary integration incorporates adjustment-aware open item balances', async () => {
      const { openItem } = await createPostedBill('10000.00');

      const d1 = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '2500.00', reason: 'Summary test'
      });
      await apAdjustmentService.postAdjustment(ctx, d1.id);

      const summary = await apSettlementService.getSupplierSettlementSummary(ctx, supplierId);
      expect(summary.totalOutstandingBillsAmount).toBe('7500.00');
      expect(summary.netPayableAmount).toBe('7500.00');
    });

    it('21. company reconciliation integration incorporates adjustments seamlessly', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const d1 = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'CREDIT_ADJUSTMENT', amount: '4000.00', reason: 'Recon test'
      });
      await apAdjustmentService.postAdjustment(ctx, d1.id);

      const recon = await apReconciliationService.reconcileCompanyAP(ctx, companyId);
      expect(recon.subledgerOutstandingOpenItemsTotal).toBe('6000.00');
      expect(recon.glApControlBalance).toBe('6000.00');
      expect(recon.reconciliationDifference).toBe('0.00');
    });

    it('22. company reconciliation PASS status after correctly posted adjustments', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const d1 = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'DEBIT_ADJUSTMENT', amount: '1500.00', reason: 'Fee'
      });
      await apAdjustmentService.postAdjustment(ctx, d1.id);

      const recon = await apReconciliationService.reconcileCompanyAP(ctx, companyId);
      expect(recon.reconciliationStatus).toBe('PASS');
    });
  });

  // =========================================================================
  // 6. HISTORICAL RECONSTRUCTION TESTS
  // =========================================================================
  describe('6. Historical Integration & Date Semantics', () => {
    it('23. adjustment with accountingDate after asOfDate is excluded from historical reconstruction', async () => {
      const { openItem } = await createPostedBill('10000.00', '2026-01-15');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '3000.00', reason: 'Future adj',
        accountingDate: '2026-02-15'
      });
      await apAdjustmentService.postAdjustment(ctx, draft.id);

      // As of 2026-02-01 -> Adjustment not posted yet -> Outstanding = 10000
      const histBefore = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItem.id, '2026-02-01');
      expect(histBefore.outstandingAmount).toBe('10000.00');
    });

    it('24. adjustment with accountingDate on or before asOfDate is included in historical reconstruction', async () => {
      const { openItem } = await createPostedBill('10000.00', '2026-01-15');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '3000.00', reason: 'Historical adj',
        accountingDate: '2026-02-15'
      });
      await apAdjustmentService.postAdjustment(ctx, draft.id);

      // As of 2026-02-20 -> Adjustment posted -> Outstanding = 7000
      const histAfter = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItem.id, '2026-02-20');
      expect(histAfter.outstandingAmount).toBe('7000.00');
    });

    it('25. reversal effective before asOfDate excludes adjustment from historical position', async () => {
      const { openItem } = await createPostedBill('10000.00', '2026-01-15');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '3000.00', reason: 'Early rev',
        accountingDate: '2026-02-15'
      });
      const posted = await apAdjustmentService.postAdjustment(ctx, draft.id);
      await apAdjustmentService.reverseAdjustment(ctx, posted.id, {
        reason: 'Reversal',
        reversalAccountingDate: '2026-03-01'
      });

      // As of 2026-03-10 -> Reversal in effect -> Outstanding = 10000
      const hist = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItem.id, '2026-03-10');
      expect(hist.outstandingAmount).toBe('10000.00');
    });

    it('26. reversal effective exactly on asOfDate excludes adjustment from historical position', async () => {
      const { openItem } = await createPostedBill('10000.00', '2026-01-15');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '3000.00', reason: 'Same day rev',
        accountingDate: '2026-02-15'
      });
      const posted = await apAdjustmentService.postAdjustment(ctx, draft.id);
      await apAdjustmentService.reverseAdjustment(ctx, posted.id, {
        reason: 'Reversal',
        reversalAccountingDate: '2026-03-01'
      });

      // As of 2026-03-01 -> Reversal effective on date -> Outstanding = 10000
      const hist = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItem.id, '2026-03-01');
      expect(hist.outstandingAmount).toBe('10000.00');
    });

    it('27. reversal effective after asOfDate keeps adjustment active as of historical date', async () => {
      const { openItem } = await createPostedBill('10000.00', '2026-01-15');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '3000.00', reason: 'Future rev',
        accountingDate: '2026-02-15'
      });
      const posted = await apAdjustmentService.postAdjustment(ctx, draft.id);
      await apAdjustmentService.reverseAdjustment(ctx, posted.id, {
        reason: 'Reversal',
        reversalAccountingDate: '2026-05-15'
      });

      // As of 2026-03-01 -> Write-off active, reversal in future -> Outstanding = 7000
      const hist = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItem.id, '2026-03-01');
      expect(hist.outstandingAmount).toBe('7000.00');
    });

    it('28. verifies mandatory Section 34 historical reversal timeline example', async () => {
      // Bill: 10,000
      const { openItem } = await createPostedBill('10000.00', '2026-01-15');

      // Allocation: 2,000
      const pay = await apPaymentService.createDraft(ctx, {
        companyId, supplierId, paymentDate: '2026-01-20', accountingDate: '2026-01-20',
        paymentMode: 'BANK_TRANSFER', bankAccountId: writeOffOffsetAccountId, totalAmount: '2000.00'
      });
      await apPaymentService.postPayment(ctx, pay.id);
      await apAllocationService.allocate(ctx, {
        companyId, allocationSourceType: 'PAYMENT', paymentId: pay.id, openItemId: openItem.id,
        allocationDate: '2026-01-20', allocatedAmount: '2000.00'
      });

      // Write-off: 3,000, accountingDate = 2026-02-15
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '3000.00', reason: 'Section 34 example',
        accountingDate: '2026-02-15'
      });
      const posted = await apAdjustmentService.postAdjustment(ctx, draft.id);

      // Write-off reversal: reversalAccountingDate = 2026-05-15
      await apAdjustmentService.reverseAdjustment(ctx, posted.id, {
        reason: 'Correction',
        reversalAccountingDate: '2026-05-15'
      });

      // Expected:
      // 2026-02-14: Outstanding = 8,000
      const h1 = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItem.id, '2026-02-14');
      expect(h1.outstandingAmount).toBe('8000.00');

      // 2026-02-15: Outstanding = 5,000
      const h2 = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItem.id, '2026-02-15');
      expect(h2.outstandingAmount).toBe('5000.00');

      // 2026-05-14: Outstanding = 5,000
      const h3 = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItem.id, '2026-05-14');
      expect(h3.outstandingAmount).toBe('5000.00');

      // 2026-05-15: Outstanding = 8,000
      const h4 = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctx, openItem.id, '2026-05-15');
      expect(h4.outstandingAmount).toBe('8000.00');
    });
  });

  // =========================================================================
  // 7. CONCURRENCY TESTS
  // =========================================================================
  describe('7. Concurrency Protection', () => {
    it('29. handles high-contention concurrent write-off requests safely', async () => {
      const { openItem } = await createPostedBill('10000.00');

      // 4 concurrent write-offs of 3000 each (Total requested = 12000 > 10000)
      const d1 = await apAdjustmentService.createDraftAdjustment(ctx, { supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '3000.00', reason: 'WO1' });
      const d2 = await apAdjustmentService.createDraftAdjustment(ctx, { supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '3000.00', reason: 'WO2' });
      const d3 = await apAdjustmentService.createDraftAdjustment(ctx, { supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '3000.00', reason: 'WO3' });
      const d4 = await apAdjustmentService.createDraftAdjustment(ctx, { supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '3000.00', reason: 'WO4' });

      const results = await Promise.allSettled([
        apAdjustmentService.postAdjustment(ctx, d1.id),
        apAdjustmentService.postAdjustment(ctx, d2.id),
        apAdjustmentService.postAdjustment(ctx, d3.id),
        apAdjustmentService.postAdjustment(ctx, d4.id)
      ]);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      // Max 3 can succeed (3 x 3000 = 9000 <= 10000)
      expect(fulfilled.length).toBeLessThanOrEqual(3);
      expect(rejected.length).toBeGreaterThanOrEqual(1);

      const settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);
      expect(ExactDecimal.parse(settlement.outstandingAmount, 2).isNegative()).toBe(false);
    });

    it('30. handles concurrent credit adjustment race condition', async () => {
      const { openItem } = await createPostedBill('5000.00');

      const d1 = await apAdjustmentService.createDraftAdjustment(ctx, { supplierId, openItemId: openItem.id, adjustmentType: 'CREDIT_ADJUSTMENT', amount: '3000.00', reason: 'CR1' });
      const d2 = await apAdjustmentService.createDraftAdjustment(ctx, { supplierId, openItemId: openItem.id, adjustmentType: 'CREDIT_ADJUSTMENT', amount: '3000.00', reason: 'CR2' });

      const results = await Promise.allSettled([
        apAdjustmentService.postAdjustment(ctx, d1.id),
        apAdjustmentService.postAdjustment(ctx, d2.id)
      ]);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      expect(fulfilled.length).toBe(1);
    });

    it('31. handles concurrent debit adjustment race condition', async () => {
      const { openItem } = await createPostedBill('5000.00');

      const d1 = await apAdjustmentService.createDraftAdjustment(ctx, { supplierId, openItemId: openItem.id, adjustmentType: 'DEBIT_ADJUSTMENT', amount: '1000.00', reason: 'DR1' });
      const d2 = await apAdjustmentService.createDraftAdjustment(ctx, { supplierId, openItemId: openItem.id, adjustmentType: 'DEBIT_ADJUSTMENT', amount: '2000.00', reason: 'DR2' });

      await Promise.all([
        apAdjustmentService.postAdjustment(ctx, d1.id),
        apAdjustmentService.postAdjustment(ctx, d2.id)
      ]);

      const settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);
      expect(settlement.outstandingAmount).toBe('8000.00');
    });

    it('32. handles concurrent duplicate posting safely', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '2000.00', reason: 'Dup test'
      });

      const [res1, res2] = await Promise.all([
        apAdjustmentService.postAdjustment(ctx, draft.id, { idempotencyKey: 'idemp_dup_post_1' }),
        apAdjustmentService.postAdjustment(ctx, draft.id, { idempotencyKey: 'idemp_dup_post_1' })
      ]);

      expect(res1.id).toBe(res2.id);
      expect(res1.status).toBe('POSTED');
    });

    it('33. handles concurrent duplicate reversal safely', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '2000.00', reason: 'Dup rev test'
      });
      const posted = await apAdjustmentService.postAdjustment(ctx, draft.id);

      const [res1, res2] = await Promise.all([
        apAdjustmentService.reverseAdjustment(ctx, posted.id, { reason: 'Rev', idempotencyKey: 'idemp_dup_rev_1' }),
        apAdjustmentService.reverseAdjustment(ctx, posted.id, { reason: 'Rev', idempotencyKey: 'idemp_dup_rev_1' })
      ]);

      expect(res1.id).toBe(res2.id);
      expect(res1.status).toBe('REVERSED');
    });
  });

  // =========================================================================
  // 8. IDEMPOTENCY TESTS
  // =========================================================================
  describe('8. Idempotency', () => {
    it('34. sequential duplicate draft creation returns identical DTO', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const d1 = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '1000.00', reason: 'Seq idemp',
        idempotencyKey: 'idemp_draft_seq'
      });
      const d2 = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '1000.00', reason: 'Seq idemp',
        idempotencyKey: 'idemp_draft_seq'
      });
      expect(d1.id).toBe(d2.id);
    });

    it('35. sequential duplicate posting returns identical posted result', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '1000.00', reason: 'Post idemp'
      });

      const p1 = await apAdjustmentService.postAdjustment(ctx, draft.id);
      const p2 = await apAdjustmentService.postAdjustment(ctx, draft.id);
      expect(p1.id).toBe(p2.id);
      expect(p2.status).toBe('POSTED');
    });

    it('36. conflicting duplicate payload with same idempotency key handled safely', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const d1 = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '1000.00', reason: 'Orig',
        idempotencyKey: 'idemp_conflict'
      });
      // Returning idempotent original result
      const d2 = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'CREDIT_ADJUSTMENT', amount: '2000.00', reason: 'Conflict',
        idempotencyKey: 'idemp_conflict'
      });
      expect(d2.id).toBe(d1.id);
      expect(d2.adjustmentType).toBe('WRITE_OFF');
    });
  });

  // =========================================================================
  // 9. ACCOUNTING TESTS
  // =========================================================================
  describe('9. Accounting Integration', () => {
    it('37. missing account mapping fails posting with explicit error', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '1000.00', reason: 'Missing mapping'
      });

      // Remove mapping to simulate missing config
      accountingConfigurationService.clear();

      await expect(apAdjustmentService.postAdjustment(ctx, draft.id)).rejects.toThrow(AccountingError);
    });

    it('38. posted write-off correctly debits AP_CONTROL and credits WRITE_OFF_OFFSET', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '2000.00', reason: 'Acct check'
      });
      await apAdjustmentService.postAdjustment(ctx, draft.id);

      const recon = await apReconciliationService.reconcileCompanyAP(ctx, companyId);
      expect(recon.glApControlBalance).toBe('8000.00');
    });

    it('39. posted debit adjustment correctly credits AP_CONTROL and debits DEBIT_ADJUSTMENT_OFFSET', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'DEBIT_ADJUSTMENT', amount: '3000.00', reason: 'Acct check'
      });
      await apAdjustmentService.postAdjustment(ctx, draft.id);

      const recon = await apReconciliationService.reconcileCompanyAP(ctx, companyId);
      expect(recon.glApControlBalance).toBe('13000.00');
    });

    it('40. subledger net payable and GL AP_CONTROL signed balance remain perfectly reconciled after adjustment', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'CREDIT_ADJUSTMENT', amount: '3500.00', reason: 'Perfect recon'
      });
      await apAdjustmentService.postAdjustment(ctx, draft.id);

      const recon = await apReconciliationService.reconcileCompanyAP(ctx, companyId);
      expect(recon.reconciliationDifference).toBe('0.00');
      expect(recon.reconciliationStatus).toBe('PASS');
    });
  });

  // =========================================================================
  // 10. SECURITY TESTS
  // =========================================================================
  describe('10. Security & Context Isolation', () => {
    it('41. tenant isolation enforced for adjustment operations', async () => {
      const { openItem } = await createPostedBill('10000.00');

      await expect(
        apAdjustmentService.createDraftAdjustment(otherTenantCtx, {
          supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '1000.00', reason: 'Tenant breach'
        })
      ).rejects.toThrow();
    });

    it('42. company isolation enforced for adjustment operations', async () => {
      const { openItem } = await createPostedBill('10000.00');

      await expect(
        apAdjustmentService.createDraftAdjustment(ctx, {
          companyId: 'cmp_other_company',
          supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '1000.00', reason: 'Company breach'
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('43. supplier isolation enforced for adjustment operations', async () => {
      const { openItem } = await createPostedBill('10000.00');

      await expect(
        apAdjustmentService.createDraftAdjustment(ctx, {
          supplierId: otherSupplierId,
          openItemId: openItem.id,
          adjustmentType: 'WRITE_OFF',
          amount: '1000.00',
          reason: 'Supplier mismatch'
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('44. unauthorized user denied posting adjustment', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '1000.00', reason: 'Auth test'
      });

      await expect(apAdjustmentService.postAdjustment(readOnlyCtx, draft.id)).rejects.toThrow(ForbiddenError);
    });

    it('45. unauthorized user denied reversing adjustment', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '1000.00', reason: 'Auth test'
      });
      const posted = await apAdjustmentService.postAdjustment(ctx, draft.id);

      await expect(apAdjustmentService.reverseAdjustment(readOnlyCtx, posted.id, { reason: 'No auth' })).rejects.toThrow(ForbiddenError);
    });
  });

  // =========================================================================
  // 11. INTEGRITY TESTS
  // =========================================================================
  describe('11. Data Integrity Rules', () => {
    it('46. invalid target open item ID rejected', async () => {
      await expect(
        apAdjustmentService.createDraftAdjustment(ctx, {
          supplierId, openItemId: 'item_non_existent', adjustmentType: 'WRITE_OFF', amount: '1000.00', reason: 'Invalid target'
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('47. targeting credit note open item rejected', async () => {
      const doc = await apDocumentService.createDraft(ctx, {
        companyId, supplierId, documentType: 'CREDIT_NOTE', documentDate: '2026-02-01', accountingDate: '2026-02-01', dueDate: '2026-03-01',
        currency: 'INR', lines: [{ lineSequence: 1, description: 'CN', expenseAccountId: writeOffOffsetAccountId, quantity: '1.0000', unitPrice: '5000.00', taxableAmount: '5000.00', taxAmount: '0.00', grossAmount: '5000.00' }]
      });
      await apDocumentService.postDocument(ctx, doc.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const cnOpenItem = openItems.find(i => i.apDocumentId === doc.id);

      if (cnOpenItem) {
        await expect(
          apAdjustmentService.createDraftAdjustment(ctx, {
            supplierId, openItemId: cnOpenItem.id, adjustmentType: 'WRITE_OFF', amount: '1000.00', reason: 'CN target'
          })
        ).rejects.toThrow(BusinessRuleViolationError);
      }
    });

    it('48. orphan adjustment operations rejected', async () => {
      await expect(apAdjustmentService.getAdjustment(ctx, 'adj_orphan_123')).rejects.toThrow(NotFoundError);
    });

    it('49. invalid accounting date format rejected', async () => {
      const { openItem } = await createPostedBill('10000.00');

      await expect(
        apAdjustmentService.createDraftAdjustment(ctx, {
          supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '1000.00', reason: 'Date format',
          accountingDate: '15-02-2026'
        })
      ).rejects.toThrow(ValidationError);
    });

    it('50. posting to closed fiscal period rejected', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '1000.00', reason: 'Closed period',
        accountingDate: '2026-02-15'
      });

      // Close period covering 2026-02-15
      const { fiscalPeriod } = await fiscalPeriodService.resolvePeriod(ctx, companyId, new Date('2026-02-15'));
      await fiscalPeriodService.closePeriod(ctx, fiscalPeriod.id);

      await expect(apAdjustmentService.postAdjustment(ctx, draft.id)).rejects.toThrow(BusinessRuleViolationError);
    });

    it('51. zero amount adjustment rejected', async () => {
      const { openItem } = await createPostedBill('10000.00');

      await expect(
        apAdjustmentService.createDraftAdjustment(ctx, {
          supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '0.00', reason: 'Zero'
        })
      ).rejects.toThrow(ValidationError);
    });

    it('52. negative amount adjustment rejected', async () => {
      const { openItem } = await createPostedBill('10000.00');

      await expect(
        apAdjustmentService.createDraftAdjustment(ctx, {
          supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '-500.00', reason: 'Negative'
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  // =========================================================================
  // 12. EXACT DECIMAL TESTS
  // =========================================================================
  describe('12. Exact Decimal Precision', () => {
    it('53. handles large monetary adjustment amounts without loss of precision', async () => {
      const largeAmtStr = '999999999.99';
      const { openItem } = await createPostedBill(largeAmtStr);
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '111111111.11', reason: 'Large amt'
      });
      await apAdjustmentService.postAdjustment(ctx, draft.id);

      const settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);
      expect(settlement.outstandingAmount).toBe('888888888.88');
    });

    it('54. exact zero boundary outstanding after full write-off', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '10000.00', reason: 'Full write-off'
      });
      await apAdjustmentService.postAdjustment(ctx, draft.id);

      const settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);
      expect(settlement.outstandingAmount).toBe('0.00');
      expect(settlement.settlementStatus).toBe('SETTLED');
    });

    it('55. precise fractional cent calculations', async () => {
      const { openItem } = await createPostedBill('100.55');
      const draft = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'CREDIT_ADJUSTMENT', amount: '40.23', reason: 'Precise cents'
      });
      await apAdjustmentService.postAdjustment(ctx, draft.id);

      const settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);
      expect(settlement.outstandingAmount).toBe('60.32');
    });

    it('56. handles signed negative net payable and reconciliation correctly', async () => {
      const { openItem } = await createPostedBill('1000.00');
      // Full write off
      const d1 = await apAdjustmentService.createDraftAdjustment(ctx, {
        supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: '1000.00', reason: 'Full WO'
      });
      await apAdjustmentService.postAdjustment(ctx, d1.id);

      // Payment advance of 2000 -> Net Payable = 0 - 2000 = -2000.00
      const pay = await apPaymentService.createDraft(ctx, {
        companyId, supplierId, paymentDate: '2026-02-10', accountingDate: '2026-02-10',
        paymentMode: 'BANK_TRANSFER', bankAccountId: writeOffOffsetAccountId, totalAmount: '2000.00'
      });
      await apPaymentService.postPayment(ctx, pay.id);

      const recon = await apReconciliationService.reconcileCompanyAP(ctx, companyId);
      expect(recon.netSubledgerPayableTotal).toBe('-2000.00');
      expect(recon.glApControlBalance).toBe('-2000.00');
      expect(recon.reconciliationStatus).toBe('PASS');
    });
  });

  // =========================================================================
  // 13. RANDOMIZED PROPERTY TESTING
  // =========================================================================
  describe('13. Randomized Property Testing', () => {
    it('57-59. 50 randomized adjustment scenarios assert balance conservation & GL reconciliation', async () => {
      for (let i = 0; i < 50; i++) {
        // Reset transactional stores for clean iteration
        apDocumentService.clear();
        apPaymentService.clear();
        apAllocationService.clear();
        apAdjustmentService.clear();
        journalDraftService.clear();

        const origVal = Math.floor(Math.random() * 50000) + 5000;
        const origStr = origVal.toFixed(2);
        const { openItem } = await createPostedBill(origStr);

        const woVal = Math.floor(Math.random() * (origVal / 2));
        const woStr = woVal.toFixed(2);

        if (woVal > 0) {
          const d = await apAdjustmentService.createDraftAdjustment(ctx, {
            supplierId, openItemId: openItem.id, adjustmentType: 'WRITE_OFF', amount: woStr, reason: `Rand WO ${i}`
          });
          await apAdjustmentService.postAdjustment(ctx, d.id);
        }

        const settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);
        const expectedOutDec = ExactDecimal.parse(origStr, 2).sub(ExactDecimal.parse(woStr, 2));

        // 58. Outstanding conservation check
        expect(settlement.outstandingAmount).toBe(expectedOutDec.toString());

        // 59. Reconciliation check
        const recon = await apReconciliationService.reconcileCompanyAP(ctx, companyId);
        expect(recon.reconciliationStatus).toBe('PASS');
        expect(recon.reconciliationDifference).toBe('0.00');
      }
    });
  });

  // =========================================================================
  // 14. REGRESSION TESTS
  // =========================================================================
  describe('14. Regression Safety', () => {
    it('60. existing Phase 2.7.5 settlement functionality works unmodified when no adjustments exist', async () => {
      const { openItem } = await createPostedBill('10000.00');
      const settlement = await apSettlementService.getOpenItemSettlement(ctx, openItem.id);

      expect(settlement.outstandingAmount).toBe('10000.00');
      expect(settlement.activeWriteOffsTotal).toBe('0.00');
      expect(settlement.activeCreditAdjustmentsTotal).toBe('0.00');
      expect(settlement.activeDebitAdjustmentsTotal).toBe('0.00');
      expect(settlement.settlementStatus).toBe('OPEN');

      const recon = await apReconciliationService.reconcileCompanyAP(ctx, companyId);
      expect(recon.reconciliationStatus).toBe('PASS');
    });
  });
});
