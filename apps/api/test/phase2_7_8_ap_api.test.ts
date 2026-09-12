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
  apAgingService,
  apStatementService
} from '../src/modules/finance/ap/index.js';
import { RequestContext } from '@general-erp/core';

describe('Phase 2.7.8 — AP REST API & External Interface Tests', () => {
  let app: ReturnType<typeof buildApp>;
  let supplierAId: string;
  let supplierBId: string;
  let bankAccId: string;
  let apAccId: string;
  let expenseAccId: string;
  let writeOffAccId: string;

  const ctxCompanyA: RequestContext = {
    requestId: 'req_ap_api_test_a',
    tenantId: 'tenant_ap_api_test',
    companyId: 'company_hq_ap',
    ip: '127.0.0.1',
    userAgent: 'test-agent',
    timestamp: new Date()
  };

  const headersTenantA = {
    'x-tenant-id': 'tenant_ap_api_test',
    'x-company-id': 'company_hq_ap',
    'x-user-id': 'usr_ap_admin',
    'x-user-roles': 'ap_admin',
    'x-user-permissions': '*'
  };

  const headersTenantB = {
    'x-tenant-id': 'tenant_other_ap',
    'x-company-id': 'company_other_ap',
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

    // 1. Seed Company & Create Fiscal Year
    await masterDataService.createCompany(ctxCompanyA, {
      id: 'company_hq_ap',
      name: 'HQ AP Company',
      legalName: 'HQ AP Company Ltd',
      currency: 'INR'
    });

    await fiscalPeriodService.createFiscalYear(ctxCompanyA, {
      companyId: 'company_hq_ap',
      name: 'FY 2026-27',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2027-03-31')
    });

    // 2. Create Master Data Suppliers & Accounts
    const suppA = await masterDataService.createSupplier(ctxCompanyA, {
      companyId: 'company_hq_ap',
      code: 'SUPP-A',
      name: 'Apex Supplies Ltd',
      currency: 'INR'
    });
    supplierAId = suppA.id;

    const suppB = await masterDataService.createSupplier(ctxCompanyA, {
      companyId: 'company_hq_ap',
      code: 'SUPP-B',
      name: 'Beta Hardware Corp',
      currency: 'INR'
    });
    supplierBId = suppB.id;

    const apAcc = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId: 'company_hq_ap',
      accountCode: '2100',
      accountName: 'Accounts Payable Control',
      nodeType: 'ACCOUNT',
      accountType: 'LIABILITY'
    });
    apAccId = apAcc.id;

    const expenseAcc = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId: 'company_hq_ap',
      accountCode: '5000',
      accountName: 'Operating Expenses',
      nodeType: 'ACCOUNT',
      accountType: 'EXPENSE'
    });
    expenseAccId = expenseAcc.id;

    const bankAcc = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId: 'company_hq_ap',
      accountCode: '1000',
      accountName: 'HDFC Bank Disbursement',
      nodeType: 'ACCOUNT',
      accountType: 'ASSET'
    });
    bankAccId = bankAcc.id;

    const writeOffAcc = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId: 'company_hq_ap',
      accountCode: '5600',
      accountName: 'Vendor Write Off Income',
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
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_ap', eventType: et, lineRole: 'AP_CONTROL', accountId: apAccId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_ap', eventType: et, lineRole: 'AP_PAYABLE', accountId: apAccId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_ap', eventType: et, lineRole: 'PURCHASE_EXPENSE', accountId: expenseAccId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_ap', eventType: et, lineRole: 'EXPENSE', accountId: expenseAccId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_ap', eventType: et, lineRole: 'BANK_ACCOUNT', accountId: bankAccId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_ap', eventType: et, lineRole: 'UNAPPLIED_CASH', accountId: apAccId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_ap', eventType: et, lineRole: 'CASH_BANK', accountId: bankAccId });
    }

    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_ap', eventType: 'AP_DISCOUNT', lineRole: 'AP_CONTROL', accountId: apAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_ap', eventType: 'AP_DISCOUNT', lineRole: 'PURCHASE_DISCOUNT_INCOME', accountId: writeOffAccId });

    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_ap', eventType: 'AP_ADJUSTMENT', lineRole: 'WRITE_OFF_OFFSET', accountId: writeOffAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_ap', eventType: 'AP_ADJUSTMENT', lineRole: 'CREDIT_ADJUSTMENT_OFFSET', accountId: writeOffAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_ap', eventType: 'AP_ADJUSTMENT', lineRole: 'DEBIT_ADJUSTMENT_OFFSET', accountId: writeOffAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_ap', eventType: 'AP_ADJUSTMENT', lineRole: 'AP_CONTROL', accountId: apAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_ap', eventType: 'AP_ADJUSTMENT', lineRole: 'AP_PAYABLE', accountId: apAccId });

    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_ap', eventType: 'AP_ADJUSTMENT_REVERSAL', lineRole: 'WRITE_OFF_OFFSET', accountId: writeOffAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_ap', eventType: 'AP_ADJUSTMENT_REVERSAL', lineRole: 'CREDIT_ADJUSTMENT_OFFSET', accountId: writeOffAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_ap', eventType: 'AP_ADJUSTMENT_REVERSAL', lineRole: 'DEBIT_ADJUSTMENT_OFFSET', accountId: writeOffAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_ap', eventType: 'AP_ADJUSTMENT_REVERSAL', lineRole: 'AP_CONTROL', accountId: apAccId });
    await accountingConfigurationService.setMapping(ctxCompanyA, { companyId: 'company_hq_ap', eventType: 'AP_ADJUSTMENT_REVERSAL', lineRole: 'AP_PAYABLE', accountId: apAccId });
  });

  // ==========================================
  // SECTION 1: AP DOCUMENTS REST APIs
  // ==========================================
  describe('AP Documents REST APIs', () => {
    it('creates, retrieves, updates, lists, posts, reverses, and cancels AP documents via REST', async () => {
      // 1. Create Draft Document
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ap/documents',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq_ap',
          supplierId: supplierAId,
          documentType: 'SUPPLIER_BILL',
          documentDate: '2026-05-01',
          dueDate: '2026-05-31',
          currency: 'INR',
          lines: [
            {
              description: 'Raw Materials Batch 1',
              expenseAccountId: expenseAccId,
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
        url: `/api/v1/finance/ap/documents/${doc.id}`,
        headers: headersTenantA
      });
      expect(getRes.statusCode).toBe(200);
      expect(JSON.parse(getRes.payload).data.id).toBe(doc.id);

      // 3. Update Draft Document
      const updateRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/finance/ap/documents/${doc.id}`,
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
        url: `/api/v1/finance/ap/documents?companyId=company_hq_ap&page=1&limit=10`,
        headers: headersTenantA
      });
      expect(listRes.statusCode).toBe(200);
      const listJson = JSON.parse(listRes.payload);
      expect(listJson.data).toHaveLength(1);
      expect(listJson.meta.total).toBe(1);

      // 5. Post Document
      const postRes = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/ap/documents/${doc.id}/post`,
        headers: {
          ...headersTenantA,
          'idempotency-key': 'idemp_ap_post_doc_01'
        }
      });
      expect(postRes.statusCode).toBe(200);
      const postedDoc = JSON.parse(postRes.payload).data;
      expect(postedDoc.status).toBe('POSTED');

      // 6. Attempt update on posted document -> Reject
      const patchPostedRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/finance/ap/documents/${doc.id}`,
        headers: headersTenantA,
        payload: { narration: 'Modified posted document' }
      });
      expect([409, 422]).toContain(patchPostedRes.statusCode);

      // 7. Reverse Posted Document
      const reverseRes = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/ap/documents/${doc.id}/reverse`,
        headers: headersTenantA,
        payload: { reason: 'Incorrect vendor invoice amount', reversalDate: '2026-05-15' }
      });
      expect(reverseRes.statusCode).toBe(200);
      expect(JSON.parse(reverseRes.payload).data.status).toBe('REVERSED');
    });

    it('cancels draft AP document via POST /api/v1/finance/ap/documents/:id/cancel', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ap/documents',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq_ap',
          supplierId: supplierAId,
          documentType: 'SUPPLIER_BILL',
          documentDate: '2026-05-01',
          dueDate: '2026-05-31',
          currency: 'INR',
          lines: [{ description: 'Draft item', expenseAccountId: expenseAccId, quantity: '1.00', unitPrice: '500.00', taxability: 'EXEMPT' }]
        }
      });
      const doc = JSON.parse(createRes.payload).data;

      const cancelRes = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/ap/documents/${doc.id}/cancel`,
        headers: headersTenantA,
        payload: { reason: 'Duplicate entry cancelled' }
      });
      expect(cancelRes.statusCode).toBe(200);
      expect(JSON.parse(cancelRes.payload).data.status).toBe('CANCELLED');
    });
  });

  // ==========================================
  // SECTION 2: AP PAYMENTS REST APIs
  // ==========================================
  describe('AP Payments REST APIs', () => {
    it('creates, retrieves, updates, lists, posts, and reverses AP payments via REST', async () => {
      // 1. Create Payment Draft
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ap/payments',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq_ap',
          supplierId: supplierAId,
          paymentType: 'SUPPLIER_PAYMENT',
          paymentDate: '2026-05-10',
          disbursementAccountId: bankAccId,
          amount: '5000.00',
          currency: 'INR',
          paymentMode: 'BANK_TRANSFER'
        }
      });

      expect(createRes.statusCode).toBe(201);
      const payment = JSON.parse(createRes.payload).data;
      expect(payment.id).toBeDefined();
      expect(payment.status).toBe('DRAFT');
      expect(payment.totalAmount).toBe('5000.00');

      // 2. Get Payment by ID
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ap/payments/${payment.id}`,
        headers: headersTenantA
      });
      expect(getRes.statusCode).toBe(200);
      expect(JSON.parse(getRes.payload).data.id).toBe(payment.id);

      // 3. Update Draft Payment
      const updateRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/finance/ap/payments/${payment.id}`,
        headers: headersTenantA,
        payload: { referenceNumber: 'UTRN-987654' }
      });
      expect(updateRes.statusCode).toBe(200);
      expect(JSON.parse(updateRes.payload).data.referenceNumber).toBe('UTRN-987654');

      // 4. List Payments
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/finance/ap/payments?companyId=company_hq_ap',
        headers: headersTenantA
      });
      expect(listRes.statusCode).toBe(200);
      expect(JSON.parse(listRes.payload).data).toHaveLength(1);

      // 5. Post Payment
      const postRes = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/ap/payments/${payment.id}/post`,
        headers: {
          ...headersTenantA,
          'idempotency-key': 'idemp_ap_post_pmt_01'
        }
      });
      expect(postRes.statusCode).toBe(200);
      expect(JSON.parse(postRes.payload).data.status).toBe('POSTED');

      // 6. Reverse Payment
      const revRes = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/ap/payments/${payment.id}/reverse`,
        headers: headersTenantA,
        payload: { reason: 'Wire transfer returned' }
      });
      expect(revRes.statusCode).toBe(200);
      expect(JSON.parse(revRes.payload).data.status).toBe('REVERSED');
    });
  });

  // ==========================================
  // SECTION 3: AP ALLOCATIONS REST APIs
  // ==========================================
  describe('AP Allocations REST APIs', () => {
    it('creates, retrieves, lists, and reverses AP allocations via REST', async () => {
      // Create and post document
      const doc = await apDocumentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq_ap',
        supplierId: supplierAId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2026-05-01',
        dueDate: '2026-05-31',
        currency: 'INR',
        lines: [{ description: 'Components', expenseAccountId: expenseAccId, quantity: '1.00', unitPrice: '4000.00', taxability: 'EXEMPT' }]
      });
      const postedDoc = await apDocumentService.postDocument(ctxCompanyA, doc.id);
      const openItems = await apDocumentService.getOpenItems(ctxCompanyA, 'company_hq_ap', { supplierId: supplierAId });
      const openItemId = openItems.find(i => i.apDocumentId === postedDoc.id)!.id;

      // Create and post payment
      const payment = await apPaymentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq_ap',
        supplierId: supplierAId,
        paymentType: 'SUPPLIER_PAYMENT',
        paymentDate: '2026-05-10',
        bankAccountId: bankAccId,
        totalAmount: '4000.00',
        currency: 'INR',
        paymentMode: 'BANK_TRANSFER'
      });
      await apPaymentService.postPayment(ctxCompanyA, payment.id);

      // 1. Create Allocation via REST
      const allocRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ap/allocations',
        headers: {
          ...headersTenantA,
          'idempotency-key': 'idemp_ap_alloc_01'
        },
        payload: {
          companyId: 'company_hq_ap',
          sourceType: 'PAYMENT',
          sourceId: payment.id,
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
        url: `/api/v1/finance/ap/allocations/${alloc.id}`,
        headers: headersTenantA
      });
      expect(getRes.statusCode).toBe(200);
      expect(JSON.parse(getRes.payload).data.id).toBe(alloc.id);

      // 3. List Allocations
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ap/allocations?companyId=company_hq_ap&supplierId=${supplierAId}`,
        headers: headersTenantA
      });
      expect(listRes.statusCode).toBe(200);
      expect(JSON.parse(listRes.payload).data).toHaveLength(1);

      // 4. Reverse Allocation
      const revRes = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/ap/allocations/${alloc.id}/reverse`,
        headers: headersTenantA,
        payload: { reason: 'Incorrect bill allocation' }
      });
      expect(revRes.statusCode).toBe(200);
      expect(JSON.parse(revRes.payload).data.status).toBe('REVERSED');
    });

    it('rejects over-allocation via REST API', async () => {
      const doc = await apDocumentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq_ap',
        supplierId: supplierAId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2026-05-01',
        dueDate: '2026-05-31',
        currency: 'INR',
        lines: [{ description: 'Hardware', expenseAccountId: expenseAccId, quantity: '1.00', unitPrice: '1000.00', taxability: 'EXEMPT' }]
      });
      const postedDoc = await apDocumentService.postDocument(ctxCompanyA, doc.id);
      const overOpenItems = await apDocumentService.getOpenItems(ctxCompanyA, 'company_hq_ap', { supplierId: supplierAId });
      const overOpenItemId = overOpenItems.find(i => i.apDocumentId === postedDoc.id)!.id;

      const payment = await apPaymentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq_ap',
        supplierId: supplierAId,
        paymentType: 'SUPPLIER_PAYMENT',
        paymentDate: '2026-05-10',
        bankAccountId: bankAccId,
        totalAmount: '500.00',
        currency: 'INR',
        paymentMode: 'BANK_TRANSFER'
      });
      await apPaymentService.postPayment(ctxCompanyA, payment.id);

      // Try allocating 800.00 when payment is only 500.00
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ap/allocations',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq_ap',
          sourceType: 'PAYMENT',
          sourceId: payment.id,
          targetOpenItemId: overOpenItemId,
          allocatedAmount: '800.00',
          allocationDate: '2026-05-10'
        }
      });

      expect([409, 422]).toContain(res.statusCode);
    });
  });

  // ==========================================
  // SECTION 4: AP ADJUSTMENTS REST APIs
  // ==========================================
  describe('AP Adjustments REST APIs', () => {
    it('creates, retrieves, lists, posts, reverses, and cancels AP write-offs via REST', async () => {
      const doc = await apDocumentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq_ap',
        supplierId: supplierAId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2026-05-01',
        dueDate: '2026-05-31',
        currency: 'INR',
        lines: [{ description: 'Services', expenseAccountId: expenseAccId, quantity: '1.00', unitPrice: '1500.00', taxability: 'EXEMPT' }]
      });
      const postedDoc = await apDocumentService.postDocument(ctxCompanyA, doc.id);
      const adjOpenItems = await apDocumentService.getOpenItems(ctxCompanyA, 'company_hq_ap', { supplierId: supplierAId });
      const adjOpenItemId = adjOpenItems.find(i => i.apDocumentId === postedDoc.id)!.id;

      // 1. Create Write-off Draft
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ap/adjustments',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq_ap',
          supplierId: supplierAId,
          adjustmentType: 'WRITE_OFF',
          openItemId: adjOpenItemId,
          adjustmentDate: '2026-05-15',
          amount: '1500.00',
          reason: 'Vendor waiver agreed'
        }
      });

      expect(createRes.statusCode).toBe(201);
      const adj = JSON.parse(createRes.payload).data;
      expect(adj.id).toBeDefined();
      expect(adj.status).toBe('DRAFT');

      // 2. Get Adjustment by ID
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ap/adjustments/${adj.id}`,
        headers: headersTenantA
      });
      expect(getRes.statusCode).toBe(200);
      expect(JSON.parse(getRes.payload).data.id).toBe(adj.id);

      // 3. List Adjustments
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/finance/ap/adjustments?companyId=company_hq_ap',
        headers: headersTenantA
      });
      expect(listRes.statusCode).toBe(200);
      expect(JSON.parse(listRes.payload).data).toHaveLength(1);

      // 4. Post Adjustment
      const postRes = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/ap/adjustments/${adj.id}/post`,
        headers: {
          ...headersTenantA,
          'idempotency-key': 'idemp_ap_post_adj_01'
        }
      });
      expect(postRes.statusCode).toBe(200);
      expect(JSON.parse(postRes.payload).data.status).toBe('POSTED');

      // 5. Reverse Adjustment
      const revRes = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/ap/adjustments/${adj.id}/reverse`,
        headers: headersTenantA,
        payload: { reason: 'Reopening vendor waiver', reversalDate: '2026-05-15' }
      });
      expect(revRes.statusCode).toBe(200);
      expect(JSON.parse(revRes.payload).data.status).toBe('REVERSED');
    });

    it('cancels draft AP adjustment via POST /api/v1/finance/ap/adjustments/:id/cancel', async () => {
      const doc = await apDocumentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq_ap',
        supplierId: supplierAId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2026-05-01',
        dueDate: '2026-05-31',
        currency: 'INR',
        lines: [{ description: 'Services', expenseAccountId: expenseAccId, quantity: '1.00', unitPrice: '1000.00', taxability: 'EXEMPT' }]
      });
      const postedDoc = await apDocumentService.postDocument(ctxCompanyA, doc.id);
      const openItems = await apDocumentService.getOpenItems(ctxCompanyA, 'company_hq_ap', { supplierId: supplierAId });
      const openItemId = openItems.find(i => i.apDocumentId === postedDoc.id)!.id;

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ap/adjustments',
        headers: headersTenantA,
        payload: {
          companyId: 'company_hq_ap',
          supplierId: supplierAId,
          adjustmentType: 'WRITE_OFF',
          openItemId,
          adjustmentDate: '2026-05-15',
          amount: '200.00',
          reason: 'Draft adjustment to cancel'
        }
      });
      const adj = JSON.parse(createRes.payload).data;

      const cancelRes = await app.inject({
        method: 'POST',
        url: `/api/v1/finance/ap/adjustments/${adj.id}/cancel`,
        headers: headersTenantA,
        payload: { reason: 'Created by mistake' }
      });
      expect(cancelRes.statusCode).toBe(200);
      expect(JSON.parse(cancelRes.payload).data.status).toBe('CANCELLED');
    });
  });

  // ==========================================
  // SECTION 5: AP SETTLEMENT & RECONCILIATION REST APIs
  // ==========================================
  describe('AP Settlement & Reconciliation REST APIs', () => {
    it('retrieves open item settlement, source utilization, supplier summary, and performs company reconciliation', async () => {
      const doc = await apDocumentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq_ap',
        supplierId: supplierAId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2026-05-01',
        dueDate: '2026-05-31',
        currency: 'INR',
        lines: [{ description: 'Tools', expenseAccountId: expenseAccId, quantity: '1.00', unitPrice: '3000.00', taxability: 'EXEMPT' }]
      });
      const postedDoc = await apDocumentService.postDocument(ctxCompanyA, doc.id);
      const setOpenItems = await apDocumentService.getOpenItems(ctxCompanyA, 'company_hq_ap', { supplierId: supplierAId });
      const setOpenItemId = setOpenItems.find(i => i.apDocumentId === postedDoc.id)!.id;

      const payment = await apPaymentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq_ap',
        supplierId: supplierAId,
        paymentType: 'SUPPLIER_PAYMENT',
        paymentDate: '2026-05-10',
        bankAccountId: bankAccId,
        totalAmount: '3000.00',
        currency: 'INR',
        paymentMode: 'BANK_TRANSFER'
      });
      await apPaymentService.postPayment(ctxCompanyA, payment.id);

      await apAllocationService.allocate(ctxCompanyA, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: setOpenItemId,
        allocatedAmount: '3000.00',
        allocationDate: '2026-05-10'
      });

      // 1. Open Item Settlement Details (Live & Historical)
      const openItemRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ap/settlement/open-items/${setOpenItemId}`,
        headers: headersTenantA
      });
      expect(openItemRes.statusCode).toBe(200);
      const openItemSettlement = JSON.parse(openItemRes.payload).data;
      expect(openItemSettlement.settlementStatus).toBe('SETTLED');
      expect(openItemSettlement.outstandingAmount).toBe('0.00');

      const openItemHistRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ap/settlement/open-items/${setOpenItemId}?mode=HISTORICAL&asOfDate=2026-05-05`,
        headers: headersTenantA
      });
      expect(openItemHistRes.statusCode).toBe(200);
      const histSettlement = JSON.parse(openItemHistRes.payload).data;
      expect(histSettlement.outstandingAmount).toBe('3000.00');

      // 2. Source Utilization (Live & Historical)
      const srcRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ap/settlement/sources/${payment.id}?sourceType=PAYMENT`,
        headers: headersTenantA
      });
      expect(srcRes.statusCode).toBe(200);
      const srcUtil = JSON.parse(srcRes.payload).data;
      expect(srcUtil.allocatedAmount).toBe('3000.00');
      expect(srcUtil.unappliedAmount).toBe('0.00');

      // 3. Supplier Settlement Summary (Live & Historical)
      const suppSummaryRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ap/settlement/suppliers/${supplierAId}?companyId=company_hq_ap`,
        headers: headersTenantA
      });
      expect(suppSummaryRes.statusCode).toBe(200);
      const suppSummary = JSON.parse(suppSummaryRes.payload).data;
      expect(suppSummary.netPayableAmount).toBe('0.00');

      // 4. Company AP Reconciliation (POST and GET)
      const reconPostRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ap/reconciliation',
        headers: headersTenantA,
        payload: { companyId: 'company_hq_ap', asOfDate: '2026-05-31' }
      });
      expect(reconPostRes.statusCode).toBe(200);
      const reconPost = JSON.parse(reconPostRes.payload).data;
      expect(reconPost.reconciliationStatus).toBe('PASS');

      const reconGetRes = await app.inject({
        method: 'GET',
        url: '/api/v1/finance/ap/reconciliation?companyId=company_hq_ap&asOfDate=2026-05-31',
        headers: headersTenantA
      });
      expect(reconGetRes.statusCode).toBe(200);
      expect(JSON.parse(reconGetRes.payload).data.reconciliationStatus).toBe('PASS');
    });
  });

  // ==========================================
  // SECTION 6: AP AGING REST APIs
  // ==========================================
  describe('AP Aging REST APIs', () => {
    it('fetches company, supplier, and open item aging via REST', async () => {
      const doc = await apDocumentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq_ap',
        supplierId: supplierAId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2026-04-01',
        dueDate: '2026-04-15',
        currency: 'INR',
        lines: [{ description: 'Old Bill', expenseAccountId: expenseAccId, quantity: '1.00', unitPrice: '2000.00', taxability: 'EXEMPT' }]
      });
      const postedDoc = await apDocumentService.postDocument(ctxCompanyA, doc.id);
      const agingOpenItems = await apDocumentService.getOpenItems(ctxCompanyA, 'company_hq_ap', { supplierId: supplierAId });
      const agingOpenItemId = agingOpenItems.find(i => i.apDocumentId === postedDoc.id)!.id;

      // 1. Company Aging
      const companyRes = await app.inject({
        method: 'GET',
        url: '/api/v1/finance/ap/aging?companyId=company_hq_ap&asOfDate=2026-05-01',
        headers: headersTenantA
      });
      expect(companyRes.statusCode).toBe(200);
      const companyAging = JSON.parse(companyRes.payload).data;
      expect(companyAging.totalOutstanding).toBe('2000.00');

      // 2. Supplier Aging
      const suppRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ap/aging/suppliers/${supplierAId}?companyId=company_hq_ap&asOfDate=2026-05-01`,
        headers: headersTenantA
      });
      expect(suppRes.statusCode).toBe(200);
      const suppAging = JSON.parse(suppRes.payload).data;
      expect(suppAging.supplierId).toBe(supplierAId);
      expect(suppAging.totalOutstanding).toBe('2000.00');

      // 3. Open Item Aging
      const itemRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ap/aging/open-items?openItemId=${agingOpenItemId}&asOfDate=2026-05-01`,
        headers: headersTenantA
      });
      expect(itemRes.statusCode).toBe(200);
      const itemAging = JSON.parse(itemRes.payload).data;
      expect(itemAging.daysOverdue).toBe(16);
      expect(itemAging.bucket).toBe('1_30');
    });
  });

  // ==========================================
  // SECTION 7: SUPPLIER STATEMENTS REST APIs
  // ==========================================
  describe('Supplier Account Statements REST APIs', () => {
    it('generates supplier account statement with running balances via REST', async () => {
      const doc = await apDocumentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq_ap',
        supplierId: supplierAId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2026-05-05',
        dueDate: '2026-05-20',
        currency: 'INR',
        lines: [{ description: 'Equipment Repair', expenseAccountId: expenseAccId, quantity: '1.00', unitPrice: '6000.00', taxability: 'EXEMPT' }]
      });
      await apDocumentService.postDocument(ctxCompanyA, doc.id);

      const stmtRes = await app.inject({
        method: 'GET',
        url: `/api/v1/finance/ap/statements/suppliers/${supplierAId}?companyId=company_hq_ap&fromDate=2026-05-01&toDate=2026-05-31`,
        headers: headersTenantA
      });

      expect(stmtRes.statusCode).toBe(200);
      const stmt = JSON.parse(stmtRes.payload).data;
      expect(stmt.supplierId).toBe(supplierAId);
      expect(stmt.openingBalance).toBe('0.00');
      expect(stmt.totalDebits).toBe('6000.00');
      expect(stmt.closingBalance).toBe('6000.00');
    });
  });

  // ==========================================
  // SECTION 8: TENANT, COMPANY & SUPPLIER ISOLATION
  // ==========================================
  describe('Tenant, Company & Supplier Security Isolation', () => {
    it('rejects cross-tenant company access attempts', async () => {
      const docRes = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ap/documents',
        headers: headersTenantB, // Tenant B attempting to operate on Tenant A company
        payload: {
          companyId: 'company_hq_ap',
          supplierId: supplierAId,
          documentType: 'SUPPLIER_BILL',
          documentDate: '2026-05-01',
          dueDate: '2026-05-31',
          currency: 'INR',
          lines: [{ description: 'Cross tenant attempt', expenseAccountId: expenseAccId, quantity: '1.00', unitPrice: '100.00', taxability: 'EXEMPT' }]
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
      const doc = await apDocumentService.createDraft(ctxCompanyA, {
        companyId: 'company_hq_ap',
        supplierId: supplierAId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2026-05-01',
        dueDate: '2026-05-31',
        currency: 'INR',
        lines: [{ description: 'Supplies', expenseAccountId: expenseAccId, quantity: '1.00', unitPrice: '1000.00', taxability: 'EXEMPT' }]
      });

      const key = 'idemp_ap_concurrent_doc_key';

      // Send 2 identical POST postDocument requests
      const [res1, res2] = await Promise.all([
        app.inject({
          method: 'POST',
          url: `/api/v1/finance/ap/documents/${doc.id}/post`,
          headers: { ...headersTenantA, 'idempotency-key': key }
        }),
        app.inject({
          method: 'POST',
          url: `/api/v1/finance/ap/documents/${doc.id}/post`,
          headers: { ...headersTenantA, 'idempotency-key': key }
        })
      ]);

      expect(res1.statusCode).toBe(200);
      expect(res2.statusCode).toBe(200);
      expect(JSON.parse(res1.payload).data.id).toBe(JSON.parse(res2.payload).data.id);
    });
  });

  // ==========================================
  // SECTION 10: VALIDATION & ERROR RESPONSES
  // ==========================================
  describe('Validation & Error Response Formatting', () => {
    it('returns structured validation errors for missing payload or invalid fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/finance/ap/documents',
        headers: headersTenantA,
        payload: null
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(json.error).toBeDefined();
      expect(json.error.message).toMatch(/Request body is required/);
    });
  });
});
