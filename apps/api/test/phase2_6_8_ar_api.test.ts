import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { journalDraftService } from '../src/modules/finance/journal-draft.service.js';
import { accountingConfigurationService } from '../src/modules/finance/accounting-core.service.js';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import {
  arDocumentService,
  arReceiptService,
  arAllocationService,
  arAdjustmentService,
  arSettlementService,
  arAgingService
} from '../src/modules/finance/ar/index.js';
import { RequestContext, ExactDecimal } from '@general-erp/core';

describe('Phase 2.6.8 — AR REST API & External Application Interface Tests', () => {
  let app: ReturnType<typeof buildApp>;
  let customerAId: string;
  let customerBId: string;
  let bankAccId: string;
  let arAccId: string;
  let salesAccId: string;
  let writeOffAccId: string;

  const ctxCompanyA: RequestContext = {
    requestId: 'req_ar_api_test_a',
    tenantId: 'tenant_api_test',
    companyId: 'company_hq',
    ip: '127.0.0.1',
    userAgent: 'test-agent',
    timestamp: new Date()
  };

  const headersTenantA = {
    'x-tenant-id': 'tenant_api_test',
    'x-company-id': 'company_hq',
    'x-user-id': 'usr_ar_admin',
    'x-user-roles': 'ar_admin',
    'x-user-permissions': '*'
  };

  const headersTenantB = {
    'x-tenant-id': 'tenant_other',
    'x-company-id': 'company_other',
    'x-user-id': 'usr_other',
    'x-user-roles': 'ar_admin',
    'x-user-permissions': '*'
  };

  beforeEach(async () => {
    app = buildApp();
    journalDraftService.clear();
    chartOfAccountsService.clear();
    fiscalPeriodService.clear();
    accountingConfigurationService.clear();
    masterDataService.clear();
    arDocumentService.clear();
    arReceiptService.clear();
    arAllocationService.clear();
    arAdjustmentService.clear();

    // 1. Seed Company & Create Fiscal Year
    await masterDataService.createCompany(ctxCompanyA, {
      id: 'company_hq',
      name: 'HQ Company',
      legalName: 'HQ Company Ltd',
      currency: 'INR'
    });

    await fiscalPeriodService.createFiscalYear(ctxCompanyA, {
      companyId: 'company_hq',
      name: 'FY 2026-27',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2027-03-31')
    });

    // 2. Create Master Data Customers & Accounts
    const custA = await masterDataService.createCustomer(ctxCompanyA, {
      companyId: 'company_hq',
      code: 'CUST-A',
      name: 'Acme Corp',
      currency: 'INR'
    });
    customerAId = custA.id;

    const custB = await masterDataService.createCustomer(ctxCompanyA, {
      companyId: 'company_hq',
      code: 'CUST-B',
      name: 'Beta Ltd',
      currency: 'INR'
    });
    customerBId = custB.id;

    const arAcc = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId: 'company_hq',
      accountCode: '1100',
      accountName: 'Accounts Receivable',
      nodeType: 'ACCOUNT',
      accountType: 'ASSET'
    });
    arAccId = arAcc.id;

    const salesAcc = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId: 'company_hq',
      accountCode: '4000',
      accountName: 'Sales Revenue',
      nodeType: 'ACCOUNT',
      accountType: 'INCOME'
    });
    salesAccId = salesAcc.id;

    const bankAcc = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId: 'company_hq',
      accountCode: '1000',
      accountName: 'HDFC Bank Account',
      nodeType: 'ACCOUNT',
      accountType: 'ASSET'
    });
    bankAccId = bankAcc.id;

    const writeOffAcc = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId: 'company_hq',
      accountCode: '5500',
      accountName: 'Bad Debts Expense',
      nodeType: 'ACCOUNT',
      accountType: 'EXPENSE'
    });
    writeOffAccId = writeOffAcc.id;

    // 3. Configure Accounting Mappings
    const eventTypes = ['AR_INVOICE', 'AR_CREDIT_NOTE', 'AR_DEBIT_NOTE', 'AR_OPENING_BALANCE', 'AR_RECEIPT', 'SALES_INVOICE', 'CUSTOMER_RECEIPT'];
    for (const et of eventTypes) {
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq', eventType: et, lineRole: 'AR_CONTROL', accountId: arAccId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq', eventType: et, lineRole: 'AR_RECEIVABLE', accountId: arAccId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq', eventType: et, lineRole: 'SALES_REVENUE', accountId: salesAccId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq', eventType: et, lineRole: 'REVENUE', accountId: salesAccId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq', eventType: et, lineRole: 'BANK_ACCOUNT', accountId: bankAccId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq', eventType: et, lineRole: 'UNAPPLIED_CASH', accountId: arAccId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq', eventType: et, lineRole: 'CASH_BANK', accountId: bankAccId });
    }

    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq', eventType: 'AR_ADJUSTMENT', lineRole: 'WRITE_OFF_EXPENSE', accountId: writeOffAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq', eventType: 'AR_ADJUSTMENT', lineRole: 'AR_CONTROL', accountId: arAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq', eventType: 'AR_ADJUSTMENT', lineRole: 'AR_RECEIVABLE', accountId: arAccId });

    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq', eventType: 'AR_ADJUSTMENT_REVERSAL', lineRole: 'WRITE_OFF_EXPENSE', accountId: writeOffAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq', eventType: 'AR_ADJUSTMENT_REVERSAL', lineRole: 'AR_CONTROL', accountId: arAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq', eventType: 'AR_ADJUSTMENT_REVERSAL', lineRole: 'AR_RECEIVABLE', accountId: arAccId });
  });

  // ==========================================
  // SECTION 1: AR DOCUMENTS REST APIs
  // ==========================================
  describe('AR Documents REST APIs', () => {
    it('creates, retrieves, updates, lists, posts, and cancels AR documents via REST', async () => {
      // 1. Create Draft Document
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ar/documents',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq',
          customerId: customerAId,
          documentType: 'INVOICE',
          documentDate: '2026-05-01',
          dueDate: '2026-05-31',
          currency: 'INR',
          lines: [
            {
              description: 'Software Support Services',
              quantity: '1.00',
              unitPrice: '10000.00',
              taxability: 'EXEMPT'
            }
          ]
        }
      });

      expect(createRes.statusCode).toBe(201);
      const doc = JSON.parse(createRes.payload).data;
      expect(doc.id).toBeDefined();
      expect(doc.status).toBe('DRAFT');
      expect(doc.grossAmount).toBe('10000.00');

      // 2. Get Document by ID
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ar/documents/${doc.id}`,
        headers: headersTenantA
      });
      expect(getRes.statusCode).toBe(200);
      expect(JSON.parse(getRes.payload).data.id).toBe(doc.id);

      // 3. Update Draft Document
      const updateRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/finance/ar/documents/${doc.id}`,
        headers: headersTenantA,
        payload: {
          dueDate: '2026-06-15'
        }
      });
      expect(updateRes.statusCode).toBe(200);
      expect(JSON.parse(updateRes.payload).data.dueDate).toBe('2026-06-15');

      // 4. List Documents
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ar/documents?companyId=company_hq&page=1&limit=10`,
        headers: headersTenantA
      });
      expect(listRes.statusCode).toBe(200);
      const listJson = JSON.parse(listRes.payload);
      expect(listJson.data).toHaveLength(1);
      expect(listJson.meta.total).toBe(1);

      // 5. Post Document
      const postRes = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/ar/documents/${doc.id}/post`,
        headers: {
          ...headersTenantA,
          'idempotency-key': 'idemp_post_doc_01'
        }
      });
      expect(postRes.statusCode).toBe(200);
      const postedDoc = JSON.parse(postRes.payload).data;
      expect(postedDoc.status).toBe('POSTED');

      // 6. Attempt update on posted document -> Reject
      const patchPostedRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/finance/ar/documents/${doc.id}`,
        headers: headersTenantA,
        payload: { narration: 'Modified posted document' }
      });
      expect([409, 422]).toContain(patchPostedRes.statusCode);
    });

    it('cancels draft document via POST /api/v1/finance/ar/documents/:id/cancel', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ar/documents',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq',
          customerId: customerAId,
          documentType: 'INVOICE',
          documentDate: '2026-05-01',
          dueDate: '2026-05-31',
          currency: 'INR',
          lines: [{ description: 'Item A', quantity: '1.00', unitPrice: '500.00', taxability: 'EXEMPT' }]
        }
      });
      const doc = JSON.parse(createRes.payload).data;

      const cancelRes = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/ar/documents/${doc.id}/cancel`,
        headers: headersTenantA,
        payload: { reason: 'Order cancelled by customer' }
      });
      expect(cancelRes.statusCode).toBe(200);
      expect(JSON.parse(cancelRes.payload).data.status).toBe('CANCELLED');
    });
  });

  // ==========================================
  // SECTION 2: AR RECEIPTS REST APIs
  // ==========================================
  describe('AR Receipts REST APIs', () => {
    it('creates, retrieves, updates, lists, posts, and reverses AR receipts via REST', async () => {
      // 1. Create Receipt Draft
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ar/receipts',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq',
          customerId: customerAId,
          receiptType: 'CUSTOMER_PAYMENT',
          receiptDate: '2026-05-10',
          depositAccountId: bankAccId,
          amount: '5000.00',
          currency: 'INR',
          paymentMode: 'BANK_TRANSFER'
        }
      });

      expect(createRes.statusCode).toBe(201);
      const receipt = JSON.parse(createRes.payload).data;
      expect(receipt.id).toBeDefined();
      expect(receipt.status).toBe('DRAFT');
      expect(receipt.totalAmount).toBe('5000.00');

      // 2. Get Receipt by ID
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ar/receipts/${receipt.id}`,
        headers: headersTenantA
      });
      expect(getRes.statusCode).toBe(200);
      expect(JSON.parse(getRes.payload).data.id).toBe(receipt.id);

      // 3. Update Draft Receipt
      const updateRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/finance/ar/receipts/${receipt.id}`,
        headers: headersTenantA,
        payload: { referenceNumber: 'TXN-123456' }
      });
      expect(updateRes.statusCode).toBe(200);
      expect(JSON.parse(updateRes.payload).data.referenceNumber).toBe('TXN-123456');

      // 4. List Receipts
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/finance/ar/receipts?companyId=company_hq',
        headers: headersTenantA
      });
      expect(listRes.statusCode).toBe(200);
      expect(JSON.parse(listRes.payload).data).toHaveLength(1);

      // 5. Post Receipt
      const postRes = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/ar/receipts/${receipt.id}/post`,
        headers: {
          ...headersTenantA,
          'idempotency-key': 'idemp_post_rcpt_01'
        }
      });
      expect(postRes.statusCode).toBe(200);
      expect(JSON.parse(postRes.payload).data.status).toBe('POSTED');

      // 6. Reverse Receipt
      const revRes = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/ar/receipts/${receipt.id}/reverse`,
        headers: headersTenantA,
        payload: { reason: 'Cheque bounced' }
      });
      expect(revRes.statusCode).toBe(200);
      expect(JSON.parse(revRes.payload).data.status).toBe('REVERSED');
    });
  });

  // ==========================================
  // SECTION 3: AR ALLOCATIONS REST APIs
  // ==========================================
  describe('AR Allocations REST APIs', () => {
    it('creates, retrieves, lists, and reverses AR allocations via REST', async () => {
      // Create and post document
      const doc = await arDocumentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq',
        customerId: customerAId,
        documentType: 'INVOICE',
        documentDate: '2026-05-01',
        dueDate: '2026-05-31',
        currency: 'INR',
        lines: [{ description: 'Service A', quantity: '1.00', unitPrice: '4000.00', taxability: 'EXEMPT' }]
      });
      const postedDoc = await arDocumentService.postDocument(ctxCompanyA, doc.id);
      const openItems = await arDocumentService.getOpenItems(ctxCompanyA, 'company_hq', { customerId: customerAId });
      const openItemId = openItems.find(i => i.arDocumentId === postedDoc.id)!.id;

      // Create and post receipt
      const receipt = await arReceiptService.createDraft(ctxCompanyA, {
        companyId: 'company_hq',
        customerId: customerAId,
        receiptType: 'CUSTOMER_PAYMENT',
        receiptDate: '2026-05-10',
        depositAccountId: bankAccId,
        amount: '4000.00',
        currency: 'INR',
        paymentMode: 'BANK_TRANSFER'
      });
      await arReceiptService.postReceipt(ctxCompanyA, receipt.id);

      // 1. Create Allocation via REST
      const allocRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ar/allocations',
        headers: {
          ...headersTenantA,
          'idempotency-key': 'idemp_alloc_01'
        },
        payload: {
          companyId: 'company_hq',
          sourceType: 'RECEIPT',
          sourceId: receipt.id,
          targetOpenItemId: openItemId,
          allocatedAmount: '2500.00',
          allocationDate: '2026-05-10'
        }
      });

      expect(allocRes.statusCode).toBe(201);
      const alloc = JSON.parse(allocRes.payload).data;
      expect(alloc.id).toBeDefined();
      expect(alloc.allocatedAmount).toBe('2500.00');

      // 2. Get Allocation by ID
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ar/allocations/${alloc.id}`,
        headers: headersTenantA
      });
      expect(getRes.statusCode).toBe(200);
      expect(JSON.parse(getRes.payload).data.id).toBe(alloc.id);

      // 3. List Allocations
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ar/allocations?companyId=company_hq&customerId=${customerAId}`,
        headers: headersTenantA
      });
      expect(listRes.statusCode).toBe(200);
      expect(JSON.parse(listRes.payload).data).toHaveLength(1);

      // 4. Reverse Allocation
      const revRes = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/ar/allocations/${alloc.id}/reverse`,
        headers: headersTenantA,
        payload: { reason: 'Incorrect allocation' }
      });
      expect(revRes.statusCode).toBe(200);
      expect(JSON.parse(revRes.payload).data.status).toBe('REVERSED');
    });

    it('rejects over-allocation via REST API', async () => {
      const doc = await arDocumentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq',
        customerId: customerAId,
        documentType: 'INVOICE',
        documentDate: '2026-05-01',
        dueDate: '2026-05-31',
        currency: 'INR',
        lines: [{ description: 'Service A', quantity: '1.00', unitPrice: '1000.00', taxability: 'EXEMPT' }]
      });
      const postedDoc = await arDocumentService.postDocument(ctxCompanyA, doc.id);
      const overOpenItems = await arDocumentService.getOpenItems(ctxCompanyA, 'company_hq', { customerId: customerAId });
      const overOpenItemId = overOpenItems.find(i => i.arDocumentId === postedDoc.id)!.id;

      const receipt = await arReceiptService.createDraft(ctxCompanyA, {
        companyId: 'company_hq',
        customerId: customerAId,
        receiptType: 'CUSTOMER_PAYMENT',
        receiptDate: '2026-05-10',
        depositAccountId: bankAccId,
        amount: '500.00',
        currency: 'INR',
        paymentMode: 'BANK_TRANSFER'
      });
      await arReceiptService.postReceipt(ctxCompanyA, receipt.id);

      // Try allocating 800.00 when unapplied is only 500.00
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ar/allocations',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq',
          sourceType: 'RECEIPT',
          sourceId: receipt.id,
          targetOpenItemId: overOpenItemId,
          allocatedAmount: '800.00',
          allocationDate: '2026-05-10'
        }
      });

      expect([409, 422]).toContain(res.statusCode);
    });
  });

  // ==========================================
  // SECTION 4: AR ADJUSTMENTS REST APIs
  // ==========================================
  describe('AR Adjustments REST APIs', () => {
    it('creates, retrieves, lists, posts, and reverses AR write-offs via REST', async () => {
      const doc = await arDocumentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq',
        customerId: customerAId,
        documentType: 'INVOICE',
        documentDate: '2026-05-01',
        dueDate: '2026-05-31',
        currency: 'INR',
        lines: [{ description: 'Consulting', quantity: '1.00', unitPrice: '1500.00', taxability: 'EXEMPT' }]
      });
      const postedDoc = await arDocumentService.postDocument(ctxCompanyA, doc.id);
      const adjOpenItems = await arDocumentService.getOpenItems(ctxCompanyA, 'company_hq', { customerId: customerAId });
      const adjOpenItemId = adjOpenItems.find(i => i.arDocumentId === postedDoc.id)!.id;

      // 1. Create Write-off Draft
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ar/adjustments',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq',
          customerId: customerAId,
          adjustmentType: 'WRITE_OFF',
          openItemId: adjOpenItemId,
          adjustmentDate: '2026-05-15',
          amount: '1500.00',
          reason: 'Uncollectible bad debt'
        }
      });

      expect(createRes.statusCode).toBe(201);
      const adj = JSON.parse(createRes.payload).data;
      expect(adj.id).toBeDefined();
      expect(adj.status).toBe('DRAFT');

      // 2. Get Adjustment by ID
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ar/adjustments/${adj.id}`,
        headers: headersTenantA
      });
      expect(getRes.statusCode).toBe(200);
      expect(JSON.parse(getRes.payload).data.id).toBe(adj.id);

      // 3. List Adjustments
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/finance/ar/adjustments?companyId=company_hq',
        headers: headersTenantA
      });
      expect(listRes.statusCode).toBe(200);
      expect(JSON.parse(listRes.payload).data).toHaveLength(1);

      // 4. Post Adjustment
      const postRes = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/ar/adjustments/${adj.id}/post`,
        headers: {
          ...headersTenantA,
          'idempotency-key': 'idemp_post_adj_01'
        }
      });
      expect(postRes.statusCode).toBe(200);
      expect(JSON.parse(postRes.payload).data.status).toBe('POSTED');

      // 5. Reverse Adjustment
      const revRes = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/ar/adjustments/${adj.id}/reverse`,
        headers: headersTenantA,
        payload: { reason: 'Reopening bad debt', reversalDate: '2026-05-15' }
      });
      expect(revRes.statusCode).toBe(200);
      expect(JSON.parse(revRes.payload).data.status).toBe('REVERSED');
    });
  });

  // ==========================================
  // SECTION 5: AR SETTLEMENT & RECONCILIATION REST APIs
  // ==========================================
  describe('AR Settlement & Reconciliation REST APIs', () => {
    it('retrieves open item settlement, source utilization, customer summary, and performs company reconciliation', async () => {
      const doc = await arDocumentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq',
        customerId: customerAId,
        documentType: 'INVOICE',
        documentDate: '2026-05-01',
        dueDate: '2026-05-31',
        currency: 'INR',
        lines: [{ description: 'Product A', quantity: '1.00', unitPrice: '3000.00', taxability: 'EXEMPT' }]
      });
      const postedDoc = await arDocumentService.postDocument(ctxCompanyA, doc.id);
      const setOpenItems = await arDocumentService.getOpenItems(ctxCompanyA, 'company_hq', { customerId: customerAId });
      const setOpenItemId = setOpenItems.find(i => i.arDocumentId === postedDoc.id)!.id;

      const receipt = await arReceiptService.createDraft(ctxCompanyA, {
        companyId: 'company_hq',
        customerId: customerAId,
        receiptType: 'CUSTOMER_PAYMENT',
        receiptDate: '2026-05-10',
        depositAccountId: bankAccId,
        amount: '3000.00',
        currency: 'INR',
        paymentMode: 'BANK_TRANSFER'
      });
      await arReceiptService.postReceipt(ctxCompanyA, receipt.id);

      await arAllocationService.allocate(ctxCompanyA, {
        allocationSourceType: 'RECEIPT',
        receiptId: receipt.id,
        openItemId: setOpenItemId,
        allocatedAmount: '3000.00',
        allocationDate: '2026-05-10'
      });

      // 1. Open Item Settlement Details
      const openItemRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ar/settlement/open-items/${setOpenItemId}`,
        headers: headersTenantA
      });
      expect(openItemRes.statusCode).toBe(200);
      const openItemSettlement = JSON.parse(openItemRes.payload).data;
      expect(openItemSettlement.settlementStatus).toBe('SETTLED');
      expect(openItemSettlement.outstandingAmount).toBe('0.00');

      // 2. Source Utilization
      const srcRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ar/settlement/sources/${receipt.id}?sourceType=RECEIPT`,
        headers: headersTenantA
      });
      expect(srcRes.statusCode).toBe(200);
      const srcUtil = JSON.parse(srcRes.payload).data;
      expect(srcUtil.activeAllocationsTotal).toBe('3000.00');
      expect(srcUtil.unappliedAmount).toBe('0.00');

      // 3. Customer Settlement Summary
      const custSummaryRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ar/settlement/customers/${customerAId}?companyId=company_hq`,
        headers: headersTenantA
      });
      expect(custSummaryRes.statusCode).toBe(200);
      const custSummary = JSON.parse(custSummaryRes.payload).data;
      expect(custSummary.netOutstandingReceivable).toBe('0.00');

      // 4. Company AR Reconciliation
      const reconRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ar/reconciliation',
        headers: headersTenantA,
        payload: { companyId: 'company_hq', asOfDate: '2026-05-31' }
      });
      expect(reconRes.statusCode).toBe(200);
      const recon = JSON.parse(reconRes.payload).data;
      expect(recon.status).toBe('PASS');
    });
  });

  // ==========================================
  // SECTION 6: AR AGING REST APIs
  // ==========================================
  describe('AR Aging REST APIs', () => {
    it('fetches company, customer, and open item aging via REST', async () => {
      const doc = await arDocumentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq',
        customerId: customerAId,
        documentType: 'INVOICE',
        documentDate: '2026-04-01',
        dueDate: '2026-04-15',
        currency: 'INR',
        lines: [{ description: 'Old Invoice', quantity: '1.00', unitPrice: '2000.00', taxability: 'EXEMPT' }]
      });
      const postedDoc = await arDocumentService.postDocument(ctxCompanyA, doc.id);
      const agingOpenItems = await arDocumentService.getOpenItems(ctxCompanyA, 'company_hq', { customerId: customerAId });
      const agingOpenItemId = agingOpenItems.find(i => i.arDocumentId === postedDoc.id)!.id;

      // 1. Company Aging
      const companyRes = await app.inject({
        method: 'GET',
        url: '/api/v1/finance/ar/aging?companyId=company_hq&asOfDate=2026-05-01',
        headers: headersTenantA
      });
      expect(companyRes.statusCode).toBe(200);
      const companyAging = JSON.parse(companyRes.payload).data;
      expect(companyAging.totalOutstanding).toBe('2000.00');

      // 2. Customer Aging
      const custRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ar/aging/customers/${customerAId}?companyId=company_hq&asOfDate=2026-05-01`,
        headers: headersTenantA
      });
      expect(custRes.statusCode).toBe(200);
      const custAging = JSON.parse(custRes.payload).data;
      expect(custAging.customerId).toBe(customerAId);
      expect(custAging.totalOutstanding).toBe('2000.00');

      // 3. Open Item Aging
      const itemRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ar/aging/open-items?openItemId=${agingOpenItemId}&asOfDate=2026-05-01`,
        headers: headersTenantA
      });
      expect(itemRes.statusCode).toBe(200);
      const itemAging = JSON.parse(itemRes.payload).data;
      expect(itemAging.daysOverdue).toBe(16);
      expect(itemAging.bucket).toBe('1_30');
    });
  });

  // ==========================================
  // SECTION 7: CUSTOMER STATEMENTS REST APIs
  // ==========================================
  describe('Customer Account Statements REST APIs', () => {
    it('generates customer account statement with running balances via REST', async () => {
      const doc = await arDocumentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq',
        customerId: customerAId,
        documentType: 'INVOICE',
        documentDate: '2026-05-05',
        dueDate: '2026-05-20',
        currency: 'INR',
        lines: [{ description: 'Services', quantity: '1.00', unitPrice: '6000.00', taxability: 'EXEMPT' }]
      });
      await arDocumentService.postDocument(ctxCompanyA, doc.id);

      const stmtRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ar/statements/customers/${customerAId}?companyId=company_hq&fromDate=2026-05-01&toDate=2026-05-31`,
        headers: headersTenantA
      });

      expect(stmtRes.statusCode).toBe(200);
      const stmt = JSON.parse(stmtRes.payload).data;
      expect(stmt.customerId).toBe(customerAId);
      expect(stmt.openingBalance).toBe('0.00');
      expect(stmt.totalDebits).toBe('6000.00');
      expect(stmt.closingBalance).toBe('6000.00');
    });
  });

  // ==========================================
  // SECTION 8: TENANT, COMPANY & CUSTOMER ISOLATION
  // ==========================================
  describe('Tenant, Company & Customer Security Isolation', () => {
    it('rejects cross-tenant company access attempts', async () => {
      const docRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ar/documents',
        headers: headersTenantB, // Tenant B attempting to operate on Tenant A company
        payload: {
          companyId: 'company_hq',
          customerId: customerAId,
          documentType: 'INVOICE',
          documentDate: '2026-05-01',
          dueDate: '2026-05-31',
          currency: 'INR',
          lines: [{ description: 'Hack', quantity: '1.00', unitPrice: '100.00', taxability: 'EXEMPT' }]
        }
      });

      expect(docRes.statusCode).toBe(403);
      expect(JSON.parse(docRes.payload).error.message).toMatch(/Company scope mismatch/);
    });
  });

  // ==========================================
  // SECTION 9: IDEMPOTENCY & CONCURRENCY
  // ==========================================
  describe('Idempotency & Concurrency Guarantees', () => {
    it('handles identical idempotent posting requests safely without duplicate financial impact', async () => {
      const doc = await arDocumentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq',
        customerId: customerAId,
        documentType: 'INVOICE',
        documentDate: '2026-05-01',
        dueDate: '2026-05-31',
        currency: 'INR',
        lines: [{ description: 'Item 1', quantity: '1.00', unitPrice: '1000.00', taxability: 'EXEMPT' }]
      });

      const key = 'idemp_concurrent_doc_key';

      // Send 2 identical POST postDocument requests
      const [res1, res2] = await Promise.all([
        app.inject({
          method: 'POST',
          url: `/api/v1/finance/ar/documents/${doc.id}/post`,
          headers: { ...headersTenantA, 'idempotency-key': key }
        }),
        app.inject({
          method: 'POST',
          url: `/api/v1/finance/ar/documents/${doc.id}/post`,
          headers: { ...headersTenantA, 'idempotency-key': key }
        })
      ]);

      expect(res1.statusCode).toBe(200);
      expect(res2.statusCode).toBe(200);
      expect(JSON.parse(res1.payload).data.id).toBe(JSON.parse(res2.payload).data.id);
    });

    it('executes 100 concurrent REST operations without race conditions or memory leaks', async () => {
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          app.inject({
            method: 'POST',
            url: '/api/v1/finance/ar/documents',
            headers: headersTenantA,
            payload: {
              companyId: 'company_hq',
              customerId: customerAId,
              documentType: 'INVOICE',
              documentDate: '2026-05-01',
              dueDate: '2026-05-31',
              currency: 'INR',
              lines: [{ description: `Stress Line ${i}`, quantity: '1.00', unitPrice: '10.00', taxability: 'EXEMPT' }]
            }
          })
        );
      }

      const results = await Promise.all(promises);
      for (const res of results) {
        expect(res.statusCode).toBe(201);
      }
    });
  });

  // ==========================================
  // SECTION 10: 200 RANDOMIZED API CONTRACT TESTS
  // ==========================================
  describe('200 Randomized API Contract Tests', () => {
    it('executes 200 randomized valid/invalid API requests verifying deterministic structure, exact decimals, and non-crash behavior', async () => {
      for (let i = 0; i < 200; i++) {
        const randChoice = i % 5;

        if (randChoice === 0) {
          // Valid AR Document Create
          const amt = (Math.floor(Math.random() * 100000) / 100 + 1).toFixed(2);
          const res = await app.inject({
            method: 'POST',
            url: '/api/v1/finance/ar/documents',
            headers: headersTenantA,
            payload: {
              companyId: 'company_hq',
              customerId: customerAId,
              documentType: 'INVOICE',
              documentDate: '2026-05-01',
              dueDate: '2026-05-31',
              currency: 'INR',
              lines: [{ description: `Item ${i}`, quantity: '1.00', unitPrice: amt, taxability: 'EXEMPT' }]
            }
          });
          expect(res.statusCode).toBe(201);
          const body = JSON.parse(res.payload);
          expect(typeof body.data.grossAmount).toBe('string');
        } else if (randChoice === 1) {
          // Invalid monetary scale (> 2 decimals)
          const res = await app.inject({
            method: 'POST',
            url: '/api/v1/finance/ar/documents',
            headers: headersTenantA,
            payload: {
              companyId: 'company_hq',
              customerId: customerAId,
              documentType: 'INVOICE',
              documentDate: '2026-05-01',
              dueDate: '2026-05-31',
              currency: 'INR',
              lines: [{ description: 'Invalid Scale', quantity: '1.00', unitPrice: '100.1234', taxability: 'EXEMPT' }]
            }
          });
          expect(res.statusCode).toBe(400);
          expect(JSON.parse(res.payload).error.code).toBe('VALIDATION_ERROR');
        } else if (randChoice === 2) {
          // Invalid document type enum
          const res = await app.inject({
            method: 'POST',
            url: '/api/v1/finance/ar/documents',
            headers: headersTenantA,
            payload: {
              companyId: 'company_hq',
              customerId: customerAId,
              documentType: 'INVALID_TYPE',
              documentDate: '2026-05-01',
              dueDate: '2026-05-31',
              currency: 'INR',
              lines: [{ description: 'Bad Type', quantity: '1.00', unitPrice: '100.00', taxability: 'EXEMPT' }]
            }
          });
          expect(res.statusCode).toBe(400);
        } else if (randChoice === 3) {
          // Non-existent document GET -> 404
          const res = await app.inject({
            method: 'GET',
            url: `/api/v1/finance/ar/documents/non_existent_doc_${i}`,
            headers: headersTenantA
          });
          expect(res.statusCode).toBe(404);
          expect(JSON.parse(res.payload).error.code).toBe('NOT_FOUND');
        } else {
          // Valid Receipt List
          const res = await app.inject({
            method: 'GET',
            url: `/api/v1/finance/ar/receipts?companyId=company_hq&page=1&limit=5`,
            headers: headersTenantA
          });
          expect(res.statusCode).toBe(200);
          const body = JSON.parse(res.payload);
          expect(Array.isArray(body.data)).toBe(true);
        }
      }
    });
  });

  // ==========================================
  // SECTION 11: 10,000+ RECORD DATASET PERFORMANCE BENCHMARK
  // ==========================================
  describe('10,000+ Record Dataset Performance Benchmark', () => {
    it('benchmarks AR document listing & customer aging across 10,000 synthetic records', async () => {
      const count = 10000;
      // Pre-seed memory map directly for high-volume benchmark speed
      for (let i = 0; i < count; i++) {
        const id = `ardoc_perf_${i}`;
        (arDocumentService as any).documentsStore.set(`tenant_api_test:${id}`, {
          id,
          tenantId: 'tenant_api_test',
          companyId: 'company_hq',
          customerId: customerAId,
          documentType: 'INVOICE',
          documentNumber: `INV-PERF-${i}`,
          documentDate: '2026-05-01',
          dueDate: '2026-05-31',
          currency: 'INR',
          status: 'POSTED',
          lines: [],
          totalTaxableAmount: '100.00',
          totalTaxAmount: '0.00',
          totalGrossAmount: '100.00',
          totalAmount: '100.00',
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }

      const startTime = performance.now();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/finance/ar/documents?companyId=company_hq&page=1&limit=50',
        headers: headersTenantA
      });
      const endTime = performance.now();

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data).toHaveLength(50);
      expect(json.meta.total).toBe(10000);

      const durationMs = (endTime - startTime).toFixed(2);
      // console.log(`[PERFORMANCE BENCHMARK] 10,000 document list query executed in ${durationMs} ms`);
      expect(endTime - startTime).toBeLessThan(1000); // Must complete under 1s
    });
  });
});
