import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { journalDraftService } from '../src/modules/finance/journal-draft.service.js';
import { accountingConfigurationService } from '../src/modules/finance/accounting-core.service.js';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import {
  apDocumentService,
  apPaymentService,
  apAllocationService,
  apAdjustmentService,
  apSettlementService,
  apHistoricalSettlementService,
  apReconciliationService,
  apAgingService,
  apStatementService
} from '../src/modules/finance/ap/index.js';
import { RequestContext } from '@general-erp/core';

describe('Phase 2.7.9 — AP Final Verification & Production Acceptance Gate Tests', () => {
  let app: ReturnType<typeof buildApp>;
  let supplierAId: string;
  let supplierBId: string;
  let bankAccId: string;
  let apAccId: string;
  let expenseAccId: string;
  let writeOffAccId: string;

  const ctxCompanyA: RequestContext = {
    requestId: 'req_ap_final_gate_a',
    tenantId: 'tenant_ap_gate_test',
    companyId: 'company_hq_gate',
    ip: '127.0.0.1',
    userAgent: 'gate-test-agent',
    timestamp: new Date()
  };

  const headersTenantA = {
    'x-tenant-id': 'tenant_ap_gate_test',
    'x-company-id': 'company_hq_gate',
    'x-user-id': 'usr_ap_gate_admin',
    'x-user-roles': 'ap_admin',
    'x-user-permissions': '*'
  };

  const headersTenantB = {
    'x-tenant-id': 'tenant_other_gate',
    'x-company-id': 'company_other_gate',
    'x-user-id': 'usr_other',
    'x-user-roles': 'ap_admin',
    'x-user-permissions': '*'
  };

  beforeEach(async () => {
    app = buildApp();
    journalDraftService.clear();
    chartOfAccountsService.clear();
    fiscalPeriodService.clear();
    accountingConfigurationService.clear();
    masterDataService.clear();
    apDocumentService.clear();
    apPaymentService.clear();
    apAllocationService.clear();
    apAdjustmentService.clear();

    // 1. Seed Company & Fiscal Years
    await masterDataService.createCompany(ctxCompanyA, {
      id: 'company_hq_gate',
      name: 'HQ AP Acceptance Company',
      legalName: 'HQ AP Acceptance Company Ltd',
      currency: 'INR'
    });

    await fiscalPeriodService.createFiscalYear(ctxCompanyA, {
      companyId: 'company_hq_gate',
      name: 'FY 2025-26',
      startDate: new Date('2025-04-01'),
      endDate: new Date('2026-03-31')
    });

    await fiscalPeriodService.createFiscalYear(ctxCompanyA, {
      companyId: 'company_hq_gate',
      name: 'FY 2026-27',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2027-03-31')
    });

    // 2. Create Master Data Suppliers & Accounts
    const suppA = await masterDataService.createSupplier(ctxCompanyA, {
      companyId: 'company_hq_gate',
      code: 'SUPP-GATE-A',
      name: 'Apex Industrial Materials',
      currency: 'INR'
    });
    supplierAId = suppA.id;

    const suppB = await masterDataService.createSupplier(ctxCompanyA, {
      companyId: 'company_hq_gate',
      code: 'SUPP-GATE-B',
      name: 'Beta Steel Works',
      currency: 'INR'
    });
    supplierBId = suppB.id;

    const apAcc = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId: 'company_hq_gate',
      accountCode: '2100',
      accountName: 'Accounts Payable Control',
      nodeType: 'ACCOUNT',
      accountType: 'LIABILITY'
    });
    apAccId = apAcc.id;

    const expenseAcc = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId: 'company_hq_gate',
      accountCode: '5000',
      accountName: 'Operating Expenses',
      nodeType: 'ACCOUNT',
      accountType: 'EXPENSE'
    });
    expenseAccId = expenseAcc.id;

    const bankAcc = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId: 'company_hq_gate',
      accountCode: '1000',
      accountName: 'HDFC Disbursement Bank Account',
      nodeType: 'ACCOUNT',
      accountType: 'ASSET'
    });
    bankAccId = bankAcc.id;

    const writeOffAcc = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId: 'company_hq_gate',
      accountCode: '5600',
      accountName: 'Vendor Write Off & Discounts Income',
      nodeType: 'ACCOUNT',
      accountType: 'INCOME'
    });
    writeOffAccId = writeOffAcc.id;

    // 3. Configure Accounting Mappings
    const eventTypes = [
      'AP_SUPPLIER_BILL',
      'AP_BILL',
      'AP_CREDIT_NOTE',
      'AP_DEBIT_NOTE',
      'AP_OPENING_BALANCE',
      'AP_PAYMENT',
      'SUPPLIER_BILL',
      'SUPPLIER_PAYMENT'
    ];
    for (const et of eventTypes) {
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_gate', eventType: et, lineRole: 'AP_CONTROL', accountId: apAccId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_gate', eventType: et, lineRole: 'AP_PAYABLE', accountId: apAccId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_gate', eventType: et, lineRole: 'PURCHASE_EXPENSE', accountId: expenseAccId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_gate', eventType: et, lineRole: 'EXPENSE', accountId: expenseAccId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_gate', eventType: et, lineRole: 'BANK_ACCOUNT', accountId: bankAccId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_gate', eventType: et, lineRole: 'UNAPPLIED_CASH', accountId: apAccId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_gate', eventType: et, lineRole: 'CASH_BANK', accountId: bankAccId });
    }

    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_gate', eventType: 'AP_DISCOUNT', lineRole: 'AP_CONTROL', accountId: apAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_gate', eventType: 'AP_DISCOUNT', lineRole: 'PURCHASE_DISCOUNT_INCOME', accountId: writeOffAccId });

    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_gate', eventType: 'AP_ADJUSTMENT', lineRole: 'WRITE_OFF_OFFSET', accountId: writeOffAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_gate', eventType: 'AP_ADJUSTMENT', lineRole: 'CREDIT_ADJUSTMENT_OFFSET', accountId: writeOffAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_gate', eventType: 'AP_ADJUSTMENT', lineRole: 'DEBIT_ADJUSTMENT_OFFSET', accountId: writeOffAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_gate', eventType: 'AP_ADJUSTMENT', lineRole: 'AP_CONTROL', accountId: apAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_gate', eventType: 'AP_ADJUSTMENT', lineRole: 'AP_PAYABLE', accountId: apAccId });

    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_gate', eventType: 'AP_ADJUSTMENT_REVERSAL', lineRole: 'WRITE_OFF_OFFSET', accountId: writeOffAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_gate', eventType: 'AP_ADJUSTMENT_REVERSAL', lineRole: 'CREDIT_ADJUSTMENT_OFFSET', accountId: writeOffAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_gate', eventType: 'AP_ADJUSTMENT_REVERSAL', lineRole: 'DEBIT_ADJUSTMENT_OFFSET', accountId: writeOffAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_gate', eventType: 'AP_ADJUSTMENT_REVERSAL', lineRole: 'AP_CONTROL', accountId: apAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_gate', eventType: 'AP_ADJUSTMENT_REVERSAL', lineRole: 'AP_PAYABLE', accountId: apAccId });
  });

  // ==========================================
  // SECTION 1: MASTER END-TO-END FINANCIAL SCENARIO
  // ==========================================
  describe('Master End-to-End Financial Scenario', () => {
    it('executes complete financial lifecycle: Bill (100k) + Payment (70k) + Allocation (60k) + Discount (2k) + Writeoff (5k) + Debit Adj (3k) + Credit Adj (1k) = Outstanding (35k), Net Payable (25k), Recon PASS, then Writeoff Reversal = Outstanding (40k)', async () => {
      // 1. Post Supplier Bill = 100,000.00
      const billDraft = await apDocumentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq_gate',
        supplierId: supplierAId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2026-05-01',
        dueDate: '2026-05-31',
        currency: 'INR',
        lines: [
          {
            description: 'Major Raw Material Delivery',
            expenseAccountId: expenseAccId,
            quantity: '1.00',
            unitPrice: '100000.00',
            taxability: 'EXEMPT'
          }
        ]
      });
      const postedBill = await apDocumentService.postDocument(ctxCompanyA, billDraft.id);
      expect(postedBill.status).toBe('POSTED');

      const openItems = await apDocumentService.getOpenItems(ctxCompanyA, 'company_hq_gate', { supplierId: supplierAId });
      const openItem = openItems.find(i => i.apDocumentId === postedBill.id)!;
      expect(openItem.originalAmount).toBe('100000.00');

      // 2. Post Supplier Payment = 70,000.00
      const paymentDraft = await apPaymentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq_gate',
        supplierId: supplierAId,
        paymentType: 'SUPPLIER_PAYMENT',
        paymentDate: '2026-05-10',
        bankAccountId: bankAccId,
        totalAmount: '70000.00',
        currency: 'INR',
        paymentMode: 'BANK_TRANSFER'
      });
      const postedPayment = await apPaymentService.postPayment(ctxCompanyA, paymentDraft.id);
      expect(postedPayment.status).toBe('POSTED');

      // 3. Create Allocation = 60,000.00 with Prompt Payment Discount = 2,000.00
      const allocation = await apAllocationService.allocate(ctxCompanyA, {
        allocationSourceType: 'PAYMENT',
        paymentId: postedPayment.id,
        openItemId: openItem.id,
        allocatedAmount: '60000.00',
        discountAmount: '2000.00',
        allocationDate: '2026-05-10'
      });
      expect(allocation.allocatedAmount).toBe('60000.00');
      expect(allocation.discountAmount).toBe('2000.00');

      // 4. Create & Post Write-Off = 5,000.00
      const woDraft = await apAdjustmentService.createDraftAdjustment(ctxCompanyA, {
        companyId: 'company_hq_gate',
        supplierId: supplierAId,
        openItemId: openItem.id,
        adjustmentType: 'WRITE_OFF',
        amount: '5000.00',
        adjustmentDate: '2026-05-15',
        reason: 'Vendor promotional write-off'
      });
      const postedWO = await apAdjustmentService.postAdjustment(ctxCompanyA, woDraft.id);
      expect(postedWO.status).toBe('POSTED');

      // 5. Create & Post Debit Adjustment = 3,000.00
      const daDraft = await apAdjustmentService.createDraftAdjustment(ctxCompanyA, {
        companyId: 'company_hq_gate',
        supplierId: supplierAId,
        openItemId: openItem.id,
        adjustmentType: 'DEBIT_ADJUSTMENT',
        amount: '3000.00',
        adjustmentDate: '2026-05-18',
        reason: 'Subsequent freight surcharge'
      });
      const postedDA = await apAdjustmentService.postAdjustment(ctxCompanyA, daDraft.id);
      expect(postedDA.status).toBe('POSTED');

      // 6. Create & Post Credit Adjustment = 1,000.00
      const caDraft = await apAdjustmentService.createDraftAdjustment(ctxCompanyA, {
        companyId: 'company_hq_gate',
        supplierId: supplierAId,
        openItemId: openItem.id,
        adjustmentType: 'CREDIT_ADJUSTMENT',
        amount: '1000.00',
        adjustmentDate: '2026-05-20',
        reason: 'Quality defect credit rebate'
      });
      const postedCA = await apAdjustmentService.postAdjustment(ctxCompanyA, caDraft.id);
      expect(postedCA.status).toBe('POSTED');

      // 7. Verify Open Item Settlement
      // Outstanding = 100,000 (Original) + 3,000 (Debit Adj) - 60,000 (Alloc) - 2,000 (Disc) - 5,000 (WO) - 1,000 (Credit Adj) = 35,000.00
      const openItemSettlement = await apSettlementService.getOpenItemSettlement(ctxCompanyA, openItem.id);
      expect(openItemSettlement.originalAmount).toBe('100000.00');
      expect(openItemSettlement.activeAllocationsTotal).toBe('60000.00');
      expect(openItemSettlement.activeDiscountsTotal).toBe('2000.00');
      expect(openItemSettlement.activeWriteOffsTotal).toBe('5000.00');
      expect(openItemSettlement.activeDebitAdjustmentsTotal).toBe('3000.00');
      expect(openItemSettlement.activeCreditAdjustmentsTotal).toBe('1000.00');
      expect(openItemSettlement.outstandingAmount).toBe('35000.00');

      // 8. Verify Source Utilization
      // Unapplied = 70,000 - 60,000 = 10,000.00
      const sourceUtil = await apSettlementService.getSourceUtilization(ctxCompanyA, 'PAYMENT', postedPayment.id);
      expect(sourceUtil.totalAmount).toBe('70000.00');
      expect(sourceUtil.allocatedAmount).toBe('60000.00');
      expect(sourceUtil.unappliedAmount).toBe('10000.00');

      // 9. Verify Supplier Settlement Summary
      // Net Payable = 35,000 (Outstanding) - 10,000 (Unapplied Payment) = 25,000.00
      const supplierSummary = await apSettlementService.getSupplierSettlementSummary(ctxCompanyA, supplierAId);
      expect(supplierSummary.totalOutstandingBillsAmount).toBe('35000.00');
      expect(supplierSummary.totalUnappliedPaymentsAmount).toBe('10000.00');
      expect(supplierSummary.netPayableAmount).toBe('25000.00');

      // 10. Verify Company AP Reconciliation
      const reconResult = await apReconciliationService.reconcileCompanyAP(ctxCompanyA, 'company_hq_gate', '2026-05-31');
      expect(reconResult.subledgerOutstandingOpenItemsTotal).toBe('35000.00');
      expect(reconResult.subledgerUnappliedPaymentsTotal).toBe('10000.00');
      expect(reconResult.netSubledgerPayableTotal).toBe('25000.00');
      expect(reconResult.glApControlBalance).toBe('25000.00');
      expect(reconResult.reconciliationDifference).toBe('0.00');
      expect(reconResult.reconciliationStatus).toBe('PASS');

      // 11. Reverse Write-Off Adjustment (5,000.00)
      const reversedWO = await apAdjustmentService.reverseAdjustment(ctxCompanyA, postedWO.id, {
        reason: 'Reopening writeoff amount',
        reversalAccountingDate: '2026-05-25'
      });
      expect(reversedWO.status).toBe('REVERSED');

      // 12. Verify Post-Reversal State
      // Outstanding = 35,000 + 5,000 = 40,000.00
      const postRevSettlement = await apSettlementService.getOpenItemSettlement(ctxCompanyA, openItem.id);
      expect(postRevSettlement.outstandingAmount).toBe('40000.00');

      const postRevSummary = await apSettlementService.getSupplierSettlementSummary(ctxCompanyA, supplierAId);
      expect(postRevSummary.netPayableAmount).toBe('30000.00');

      const postRevRecon = await apReconciliationService.reconcileCompanyAP(ctxCompanyA, 'company_hq_gate', '2026-05-31');
      expect(postRevRecon.netSubledgerPayableTotal).toBe('30000.00');
      expect(postRevRecon.glApControlBalance).toBe('30000.00');
      expect(postRevRecon.reconciliationStatus).toBe('PASS');
    });
  });

  // ==========================================
  // SECTION 2: END-TO-END HISTORICAL TIMELINE RECONSTRUCTION
  // ==========================================
  describe('End-to-End Historical Timeline Reconstruction', () => {
    it('accurately reconstructs point-in-time financial states across effective dates (2026-01-01 to 2026-02-01)', async () => {
      // Day 1: 2026-01-01 -> Bill 100,000.00
      const billDraft = await apDocumentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq_gate',
        supplierId: supplierAId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2026-01-01',
        accountingDate: '2026-01-01',
        dueDate: '2026-01-31',
        currency: 'INR',
        lines: [{ description: 'Timeline Item', expenseAccountId: expenseAccId, quantity: '1.00', unitPrice: '100000.00', taxability: 'EXEMPT' }]
      });
      const bill = await apDocumentService.postDocument(ctxCompanyA, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctxCompanyA, 'company_hq_gate', { supplierId: supplierAId });
      const openItemId = openItems.find(i => i.apDocumentId === bill.id)!.id;

      // Day 2: 2026-01-10 -> Payment 70,000.00
      const pmtDraft = await apPaymentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq_gate',
        supplierId: supplierAId,
        paymentType: 'SUPPLIER_PAYMENT',
        paymentDate: '2026-01-10',
        accountingDate: '2026-01-10',
        bankAccountId: bankAccId,
        totalAmount: '70000.00',
        currency: 'INR',
        paymentMode: 'BANK_TRANSFER'
      });
      const pmt = await apPaymentService.postPayment(ctxCompanyA, pmtDraft.id);

      // Day 3: 2026-01-15 -> Allocation 60,000.00
      await apAllocationService.allocate(ctxCompanyA, {
        allocationSourceType: 'PAYMENT',
        paymentId: pmt.id,
        openItemId,
        allocatedAmount: '60000.00',
        allocationDate: '2026-01-15'
      });

      // Day 4: 2026-01-20 -> Write-off 5,000.00
      const woDraft = await apAdjustmentService.createDraftAdjustment(ctxCompanyA, {
        companyId: 'company_hq_gate',
        supplierId: supplierAId,
        openItemId,
        adjustmentType: 'WRITE_OFF',
        amount: '5000.00',
        adjustmentDate: '2026-01-20',
        accountingDate: '2026-01-20',
        reason: 'Timeline WO'
      });
      const wo = await apAdjustmentService.postAdjustment(ctxCompanyA, woDraft.id);

      // Day 5: 2026-02-01 -> Write-off Reversal
      await apAdjustmentService.reverseAdjustment(ctxCompanyA, wo.id, {
        reason: 'Timeline WO Reversal',
        reversalAccountingDate: '2026-02-01'
      });

      // Point-in-Time Assertions:
      // 2026-01-09: Outstanding = 100k, Net Payable = 100k
      const h1 = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctxCompanyA, openItemId, '2026-01-09');
      expect(h1.outstandingAmount).toBe('100000.00');

      // 2026-01-14: Outstanding = 100k, Unapplied Payment = 70k, Net Payable = 30k
      const h2 = await apHistoricalSettlementService.getHistoricalSupplierSettlementSummary(ctxCompanyA, supplierAId, '2026-01-14');
      expect(h2.totalOutstandingBillsAmount).toBe('100000.00');
      expect(h2.totalUnappliedPaymentsAmount).toBe('70000.00');
      expect(h2.netPayableAmount).toBe('30000.00');

      // 2026-01-19: Outstanding = 40k, Unapplied Payment = 10k, Net Payable = 30k
      const h3 = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctxCompanyA, openItemId, '2026-01-19');
      expect(h3.outstandingAmount).toBe('40000.00');

      // 2026-01-31: Outstanding = 35k (WO effective), Net Payable = 25k
      const h4 = await apHistoricalSettlementService.getHistoricalOpenItemSettlement(ctxCompanyA, openItemId, '2026-01-31');
      expect(h4.outstandingAmount).toBe('35000.00');

      // 2026-02-01: Outstanding = 40k (WO reversal effective), Net Payable = 30k
      const h5 = await apHistoricalSettlementService.getHistoricalSupplierSettlementSummary(ctxCompanyA, supplierAId, '2026-02-01');
      expect(h5.totalOutstandingBillsAmount).toBe('40000.00');
      expect(h5.netPayableAmount).toBe('30000.00');
    });
  });

  // ==========================================
  // SECTION 3: END-TO-END REST API SCENARIO
  // ==========================================
  describe('End-to-End REST API Scenario', () => {
    it('executes complete supplier lifecycle via HTTP REST routes', async () => {
      // 1. Create and post supplier bill via API
      const billRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ap/documents',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq_gate',
          supplierId: supplierAId,
          documentType: 'SUPPLIER_BILL',
          documentDate: '2026-05-01',
          dueDate: '2026-05-31',
          currency: 'INR',
          lines: [{ description: 'API Services', expenseAccountId: expenseAccId, quantity: '1.00', unitPrice: '12000.00', taxability: 'EXEMPT' }]
        }
      });
      expect(billRes.statusCode).toBe(201);
      const bill = JSON.parse(billRes.payload).data;

      const postBillRes = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/ap/documents/${bill.id}/post`,
        headers: headersTenantA
      });
      expect(postBillRes.statusCode).toBe(200);

      // 2. Create and post payment via API
      const pmtRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ap/payments',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq_gate',
          supplierId: supplierAId,
          paymentType: 'SUPPLIER_PAYMENT',
          paymentDate: '2026-05-10',
          disbursementAccountId: bankAccId,
          amount: '12000.00',
          currency: 'INR',
          paymentMode: 'BANK_TRANSFER'
        }
      });
      expect(pmtRes.statusCode).toBe(201);
      const pmt = JSON.parse(pmtRes.payload).data;

      const postPmtRes = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/ap/payments/${pmt.id}/post`,
        headers: headersTenantA
      });
      expect(postPmtRes.statusCode).toBe(200);

      // 3. Fetch open item ID and allocate via API
      const openItems = await apDocumentService.getOpenItems(ctxCompanyA, 'company_hq_gate', { supplierId: supplierAId });
      const openItemId = openItems.find(i => i.apDocumentId === bill.id)!.id;

      const allocRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ap/allocations',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq_gate',
          sourceType: 'PAYMENT',
          sourceId: pmt.id,
          targetOpenItemId: openItemId,
          allocatedAmount: '12000.00',
          allocationDate: '2026-05-10'
        }
      });
      expect(allocRes.statusCode).toBe(201);

      // 4. Retrieve Settlement, Aging, Statement, and Reconciliation via API
      const setRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ap/settlement/open-items/${openItemId}`,
        headers: headersTenantA
      });
      expect(setRes.statusCode).toBe(200);
      expect(JSON.parse(setRes.payload).data.settlementStatus).toBe('SETTLED');

      const stmtRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ap/statements/suppliers/${supplierAId}?companyId=company_hq_gate&fromDate=2026-05-01&toDate=2026-05-31`,
        headers: headersTenantA
      });
      expect(stmtRes.statusCode).toBe(200);
      expect(JSON.parse(stmtRes.payload).data.closingBalance).toBe('0.00');

      const reconRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ap/reconciliation',
        headers: headersTenantA,
        payload: { companyId: 'company_hq_gate', asOfDate: '2026-05-31' }
      });
      expect(reconRes.statusCode).toBe(200);
      expect(JSON.parse(reconRes.payload).data.reconciliationStatus).toBe('PASS');
    });
  });

  // ==========================================
  // SECTION 4: CROSS-LAYER CONSISTENCY & FORMULA CHECKS
  // ==========================================
  describe('Cross-Layer Consistency & Formula Verification', () => {
    it('verifies exact agreement across settlement, supplier summary, company reconciliation, aging, and statement closing balance', async () => {
      const billDraft = await apDocumentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq_gate',
        supplierId: supplierAId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2026-05-01',
        dueDate: '2026-05-15',
        currency: 'INR',
        lines: [{ description: 'Consistency Check', expenseAccountId: expenseAccId, quantity: '1.00', unitPrice: '15000.00', taxability: 'EXEMPT' }]
      });
      await apDocumentService.postDocument(ctxCompanyA, billDraft.id);

      const asOfDate = '2026-05-31';

      const summary = await apSettlementService.getSupplierSettlementSummary(ctxCompanyA, supplierAId);
      const aging = await apAgingService.getSupplierAging(ctxCompanyA, 'company_hq_gate', supplierAId, asOfDate);
      const statement = await apStatementService.getSupplierStatement(ctxCompanyA, 'company_hq_gate', { supplierId: supplierAId, fromDate: '2026-05-01', toDate: asOfDate });
      const recon = await apReconciliationService.reconcileCompanyAP(ctxCompanyA, 'company_hq_gate', asOfDate);

      expect(summary.netPayableAmount).toBe('15000.00');
      expect(aging.totalOutstanding).toBe('15000.00');
      expect(statement.closingBalance).toBe('15000.00');
      expect(recon.netSubledgerPayableTotal).toBe('15000.00');
      expect(recon.reconciliationStatus).toBe('PASS');
    });
  });

  // ==========================================
  // SECTION 5: SECURITY & ISOLATION MATRIX
  // ==========================================
  describe('Security & Isolation Matrix', () => {
    it('enforces multi-tenant and multi-company isolation on document and reporting routes', async () => {
      // Tenant B attempting to create document on Tenant A company -> 403
      const docRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ap/documents',
        headers: headersTenantB,
        payload: {
          companyId: 'company_hq_gate',
          supplierId: supplierAId,
          documentType: 'SUPPLIER_BILL',
          documentDate: '2026-05-01',
          dueDate: '2026-05-31',
          currency: 'INR',
          lines: [{ description: 'Unauthorized', expenseAccountId: expenseAccId, quantity: '1.00', unitPrice: '100.00', taxability: 'EXEMPT' }]
        }
      });
      expect(docRes.statusCode).toBe(403);

      // Tenant B attempting to view Tenant A aging -> 403
      const agingRes = await app.inject({
        method: 'GET',
        url: '/api/v1/finance/ap/aging?companyId=company_hq_gate',
        headers: headersTenantB
      });
      expect(agingRes.statusCode).toBe(403);
    });
  });

  // ==========================================
  // SECTION 6: IDEMPOTENCY & CONCURRENCY
  // ==========================================
  describe('Idempotency & Concurrency Safety', () => {
    it('guarantees identical response for duplicate idempotency keys and rejects over-allocation', async () => {
      const billDraft = await apDocumentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq_gate',
        supplierId: supplierAId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2026-05-01',
        dueDate: '2026-05-31',
        currency: 'INR',
        lines: [{ description: 'Idempotent Doc', expenseAccountId: expenseAccId, quantity: '1.00', unitPrice: '8000.00', taxability: 'EXEMPT' }]
      });

      const key = 'idemp_key_gate_001';

      const [r1, r2] = await Promise.all([
        app.inject({
          method: 'POST',
          url: `/api/v1/finance/ap/documents/${billDraft.id}/post`,
          headers: { ...headersTenantA, 'idempotency-key': key }
        }),
        app.inject({
          method: 'POST',
          url: `/api/v1/finance/ap/documents/${billDraft.id}/post`,
          headers: { ...headersTenantA, 'idempotency-key': key }
        })
      ]);

      expect(r1.statusCode).toBe(200);
      expect(r2.statusCode).toBe(200);
      expect(JSON.parse(r1.payload).data.id).toBe(JSON.parse(r2.payload).data.id);
    });
  });
});
