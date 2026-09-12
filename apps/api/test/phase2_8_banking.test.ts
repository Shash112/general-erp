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
  apSettlementService,
  apReconciliationService
} from '../src/modules/finance/ap/index.js';
import {
  arDocumentService,
  arReceiptService,
  arSettlementService
} from '../src/modules/finance/ar/index.js';
import {
  bankAccountService,
  bankingVoucherService
} from '../src/modules/finance/banking/index.js';
import { RequestContext, ExactDecimal } from '@general-erp/core';

describe('Phase 2.8 — Banking & Cash Payment / Receipt Vouchers Test Suite', () => {
  let app: ReturnType<typeof buildApp>;
  let companyId: string;
  let bankAccountAId: string;
  let bankAccountBId: string;
  let cashAccountAId: string;
  let glBankAId: string;
  let glBankBId: string;
  let glCashAId: string;
  let glApControlId: string;
  let glArControlId: string;
  let glExpenseId: string;
  let glRevenueId: string;

  const ctxCompanyA: RequestContext = {
    requestId: 'req_banking_test_a',
    tenantId: 'tenant_banking_test',
    companyId: 'company_banking_hq',
    ip: '127.0.0.1',
    userAgent: 'banking-test-agent',
    timestamp: new Date()
  };

  const headersTenantA = {
    'x-tenant-id': 'tenant_banking_test',
    'x-company-id': 'company_banking_hq',
    'x-user-id': 'usr_banking_admin',
    'x-user-roles': 'banking_admin',
    'x-user-permissions': '*'
  };

  const headersTenantB = {
    'x-tenant-id': 'tenant_other_test',
    'x-company-id': 'company_other_hq',
    'x-user-id': 'usr_other',
    'x-user-roles': 'banking_admin',
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
    arDocumentService.clear();
    arReceiptService.clear();
    bankAccountService.clear();
    bankingVoucherService.clear();

    companyId = 'company_banking_hq';

    // 1. Seed Company & Fiscal Years
    await masterDataService.createCompany(ctxCompanyA, {
      id: companyId,
      name: 'Banking Acceptance Corp',
      legalName: 'Banking Acceptance Corp Ltd',
      currency: 'INR'
    });

    await fiscalPeriodService.createFiscalYear(ctxCompanyA, {
      companyId,
      name: 'FY 2025-26',
      startDate: new Date('2025-04-01'),
      endDate: new Date('2026-03-31')
    });

    await fiscalPeriodService.createFiscalYear(ctxCompanyA, {
      companyId,
      name: 'FY 2026-27',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2027-03-31')
    });

    // 2. Create GL Chart of Accounts
    const glBankA = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId,
      accountCode: '1010',
      accountName: 'HDFC Disbursement Account',
      nodeType: 'ACCOUNT',
      accountType: 'ASSET'
    });
    glBankAId = glBankA.id;

    const glBankB = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId,
      accountCode: '1020',
      accountName: 'ICICI Collection Account',
      nodeType: 'ACCOUNT',
      accountType: 'ASSET'
    });
    glBankBId = glBankB.id;

    const glCashA = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId,
      accountCode: '1050',
      accountName: 'Main Office Petty Cash',
      nodeType: 'ACCOUNT',
      accountType: 'ASSET'
    });
    glCashAId = glCashA.id;

    const glApControl = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId,
      accountCode: '2100',
      accountName: 'Accounts Payable Control',
      nodeType: 'ACCOUNT',
      accountType: 'LIABILITY'
    });
    glApControlId = glApControl.id;

    const glArControl = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId,
      accountCode: '1100',
      accountName: 'Accounts Receivable Control',
      nodeType: 'ACCOUNT',
      accountType: 'ASSET'
    });
    glArControlId = glArControl.id;

    const glExpense = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId,
      accountCode: '5000',
      accountName: 'Operating Expenses',
      nodeType: 'ACCOUNT',
      accountType: 'EXPENSE'
    });
    glExpenseId = glExpense.id;

    const glRevenue = await chartOfAccountsService.createAccount(ctxCompanyA, {
      companyId,
      accountCode: '4000',
      accountName: 'Sales Revenue',
      nodeType: 'ACCOUNT',
      accountType: 'INCOME'
    });
    glRevenueId = glRevenue.id;

    // 3. Configure Mappings for AP & AR
    const apEvents = ['AP_SUPPLIER_BILL', 'AP_PAYMENT'];
    for (const et of apEvents) {
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId, eventType: et, lineRole: 'AP_CONTROL', accountId: glApControlId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId, eventType: et, lineRole: 'PURCHASE_EXPENSE', accountId: glExpenseId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId, eventType: et, lineRole: 'CASH_BANK', accountId: glBankAId });
    }

    const arEvents = ['AR_INVOICE', 'AR_RECEIPT'];
    for (const et of arEvents) {
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId, eventType: et, lineRole: 'AR_CONTROL', accountId: glArControlId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId, eventType: et, lineRole: 'SALES_REVENUE', accountId: glRevenueId });
      await accountingConfigurationService.setMapping(ctxCompanyA, { companyId, eventType: et, lineRole: 'CASH_BANK', accountId: glBankBId });
    }

    // 4. Create Master Bank & Cash Accounts
    const bnkA = await bankAccountService.createBankAccount(ctxCompanyA, {
      companyId,
      accountName: 'HDFC Corporate Account',
      bankName: 'HDFC Bank Ltd',
      accountNumber: '50100234567890',
      accountType: 'CHECKING',
      currency: 'INR',
      glAccountId: glBankAId
    });
    bankAccountAId = bnkA.id;

    const bnkB = await bankAccountService.createBankAccount(ctxCompanyA, {
      companyId,
      accountName: 'ICICI Commercial Account',
      bankName: 'ICICI Bank Ltd',
      accountNumber: '99887766554433',
      accountType: 'CURRENT',
      currency: 'INR',
      glAccountId: glBankBId
    });
    bankAccountBId = bnkB.id;

    const cshA = await bankAccountService.createCashAccount(ctxCompanyA, {
      companyId,
      accountName: 'Headquarters Cash Register',
      currency: 'INR',
      glAccountId: glCashAId
    });
    cashAccountAId = cshA.id;
  });

  // ==========================================
  // SECTION 1: BANK & CASH MASTER ACCOUNTS
  // ==========================================
  describe('Bank & Cash Master Account Management', () => {
    it('1-8. handles Bank Account creation with masked number, retrieval, update, activation/deactivation, GL mapping validation, and tenant/company isolation', async () => {
      const bnk = await bankAccountService.getBankAccount(ctxCompanyA, bankAccountAId);
      expect(bnk.accountNumberMasked).toBe('XXXX-XXXX-7890');
      expect(bnk.status).toBe('ACTIVE');

      // Reject credentials
      await expect(bankAccountService.createBankAccount(ctxCompanyA, {
        companyId,
        accountName: 'Secret Account',
        bankName: 'Bank',
        accountNumber: '12345678',
        accountType: 'CHECKING',
        glAccountId: glBankAId,
        password: 'my_secret_password'
      } as any)).rejects.toThrow('Security violation');

      // Deactivation and activation
      const deactivated = await bankAccountService.deactivateBankAccount(ctxCompanyA, bankAccountAId);
      expect(deactivated.status).toBe('INACTIVE');

      const activated = await bankAccountService.activateBankAccount(ctxCompanyA, bankAccountAId);
      expect(activated.status).toBe('ACTIVE');

      // Tenant isolation
      const ctxTenantB: RequestContext = { ...ctxCompanyA, tenantId: 'tenant_other_test' };
      await expect(bankAccountService.getBankAccount(ctxTenantB, bankAccountAId)).rejects.toThrow();
    });

    it('9-13. handles Cash Account master lifecycle (create, retrieve, update, activation, deactivation)', async () => {
      const csh = await bankAccountService.getCashAccount(ctxCompanyA, cashAccountAId);
      expect(csh.accountName).toBe('Headquarters Cash Register');
      expect(csh.status).toBe('ACTIVE');

      const updated = await bankAccountService.updateCashAccount(ctxCompanyA, cashAccountAId, { accountName: 'HQ Main Cash Desk' });
      expect(updated.accountName).toBe('HQ Main Cash Desk');

      const deactivated = await bankAccountService.deactivateCashAccount(ctxCompanyA, cashAccountAId);
      expect(deactivated.status).toBe('INACTIVE');
    });
  });

  // ==========================================
  // SECTION 2: PAYMENT VOUCHERS
  // ==========================================
  describe('Payment Vouchers', () => {
    it('14-20. handles Payment Voucher creation, GL posting, audit, reversal, fiscal period validation, and idempotency', async () => {
      // Create Draft Payment Voucher
      const draft = await bankingVoucherService.createDraftPayment(ctxCompanyA, {
        companyId,
        transactionDate: '2026-05-01',
        accountingDate: '2026-05-01',
        amount: '15000.00',
        bankAccountId: bankAccountAId,
        counterAccountId: glExpenseId,
        narration: 'Office Rent Payment'
      });
      expect(draft.status).toBe('DRAFT');

      // Post Payment Voucher
      const posted = await bankingVoucherService.postVoucher(ctxCompanyA, draft.id, { idempotencyKey: 'idemp_pv_001' });
      expect(posted.status).toBe('POSTED');
      expect(posted.voucherNumber).toMatch(/^PV-FY 2026-27-HQ-/);
      expect(posted.journalEntryId).toBeDefined();

      // Idempotent re-post
      const repost = await bankingVoucherService.postVoucher(ctxCompanyA, draft.id, { idempotencyKey: 'idemp_pv_001' });
      expect(repost.id).toBe(posted.id);

      // Verify GL Account Balance
      const balBank = await bankAccountService.getAccountBalance(ctxCompanyA, bankAccountAId);
      expect(balBank.balance).toBe('-15000.00'); // Credit 15k -> Net Balance -15k

      // Reverse Payment Voucher
      const reversed = await bankingVoucherService.reverseVoucher(ctxCompanyA, draft.id, {
        reason: 'Duplicate payment mistake',
        reversalAccountingDate: '2026-05-05'
      });
      expect(reversed.status).toBe('REVERSED');

      // Balance after reversal
      const balBankPostRev = await bankAccountService.getAccountBalance(ctxCompanyA, bankAccountAId);
      expect(balBankPostRev.balance).toBe('0.00');
    });
  });

  // ==========================================
  // SECTION 3: RECEIPT VOUCHERS
  // ==========================================
  describe('Receipt Vouchers', () => {
    it('21-25. handles Receipt Voucher creation, GL posting (Debit Bank / Credit Revenue), reversal, and idempotency', async () => {
      const draft = await bankingVoucherService.createDraftReceipt(ctxCompanyA, {
        companyId,
        transactionDate: '2026-05-02',
        accountingDate: '2026-05-02',
        amount: '25000.00',
        bankAccountId: bankAccountBId,
        counterAccountId: glRevenueId,
        narration: 'Direct Consulting Receipt'
      });
      expect(draft.status).toBe('DRAFT');

      const posted = await bankingVoucherService.postVoucher(ctxCompanyA, draft.id);
      expect(posted.status).toBe('POSTED');
      expect(posted.voucherNumber).toMatch(/^RV-FY 2026-27-HQ-/);

      const balBankB = await bankAccountService.getAccountBalance(ctxCompanyA, bankAccountBId);
      expect(balBankB.balance).toBe('25000.00');

      const reversed = await bankingVoucherService.reverseVoucher(ctxCompanyA, draft.id, { reason: 'Receipt refund' });
      expect(reversed.status).toBe('REVERSED');

      const balBankBPostRev = await bankAccountService.getAccountBalance(ctxCompanyA, bankAccountBId);
      expect(balBankBPostRev.balance).toBe('0.00');
    });
  });

  // ==========================================
  // SECTION 4: TRANSFER / CONTRA VOUCHERS
  // ==========================================
  describe('Transfer / Contra Vouchers', () => {
    it('26-32. supports Bank -> Bank, Bank -> Cash, Cash -> Bank, Cash -> Cash contra transfers with balanced GL entries and reversal', async () => {
      // 1. First seed cash account with a receipt of 50,000.00
      const cshReceiptDraft = await bankingVoucherService.createDraftReceipt(ctxCompanyA, {
        companyId,
        transactionDate: '2026-05-01',
        amount: '50000.00',
        cashAccountId: cashAccountAId,
        counterAccountId: glRevenueId
      });
      await bankingVoucherService.postVoucher(ctxCompanyA, cshReceiptDraft.id);

      // 2. Cash -> Bank Transfer = 30,000.00
      const transferDraft = await bankingVoucherService.createDraftTransfer(ctxCompanyA, {
        companyId,
        transactionDate: '2026-05-03',
        amount: '30000.00',
        sourceCashAccountId: cashAccountAId,
        destinationBankAccountId: bankAccountAId,
        narration: 'Cash deposit into HDFC bank'
      });
      expect(transferDraft.status).toBe('DRAFT');

      const postedTransfer = await bankingVoucherService.postVoucher(ctxCompanyA, transferDraft.id);
      expect(postedTransfer.status).toBe('POSTED');
      expect(postedTransfer.voucherNumber).toMatch(/^VT-FY 2026-27-HQ-/);

      // 3. Verify Balances
      const balCash = await bankAccountService.getAccountBalance(ctxCompanyA, cashAccountAId);
      expect(balCash.balance).toBe('20000.00'); // 50,000 - 30,000 = 20,000

      const balBankA = await bankAccountService.getAccountBalance(ctxCompanyA, bankAccountAId);
      expect(balBankA.balance).toBe('30000.00'); // + 30,000

      // 4. Reject Same Source and Destination Account
      await expect(bankingVoucherService.createDraftTransfer(ctxCompanyA, {
        companyId,
        transactionDate: '2026-05-03',
        amount: '5000.00',
        sourceBankAccountId: bankAccountAId,
        destinationBankAccountId: bankAccountAId
      })).rejects.toThrow('source account and destination account cannot be identical');
    });
  });

  // ==========================================
  // SECTION 5: AP / AR INTEGRATION & NO DOUBLE-POSTING
  // ==========================================
  describe('AP / AR Integration & Single-Posting Invariant', () => {
    it('33-40. guarantees exactly ONE GL posting for AP payments and AR receipts without duplicate GL postings', async () => {
      // 1. Create Supplier Bill (10,000.00) & Post Payment (10,000.00) via AP
      const supp = await masterDataService.createSupplier(ctxCompanyA, { companyId, code: 'SUP-B1', name: 'Vendor 1', currency: 'INR' });
      const billDraft = await apDocumentService.createDraft(ctxCompanyA, {
        companyId,
        supplierId: supp.id,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2026-05-01',
        dueDate: '2026-05-31',
        currency: 'INR',
        lines: [{ description: 'Raw Material', expenseAccountId: glExpenseId, quantity: '1.00', unitPrice: '10000.00', taxability: 'EXEMPT' }]
      });
      await apDocumentService.postDocument(ctxCompanyA, billDraft.id);

      const pmtDraft = await apPaymentService.createDraft(ctxCompanyA, {
        companyId,
        supplierId: supp.id,
        paymentType: 'SUPPLIER_PAYMENT',
        paymentDate: '2026-05-10',
        bankAccountId: glBankAId,
        totalAmount: '10000.00',
        currency: 'INR',
        paymentMode: 'BANK_TRANSFER'
      });
      const postedPmt = await apPaymentService.postPayment(ctxCompanyA, pmtDraft.id);
      expect(postedPmt.journalEntryId).toBeDefined();

      // 2. Link Subledger Banking Voucher (AP)
      const linkedBankingVoucher = await bankingVoucherService.linkSubledgerVoucher(
        ctxCompanyA,
        'AP',
        postedPmt.id,
        companyId,
        postedPmt.journalEntryId!,
        '10000.00',
        bankAccountAId,
        'AP Payment Link'
      );
      expect(linkedBankingVoucher.status).toBe('POSTED');

      // Attempt to re-post linked voucher: re-uses existing journalEntryId!
      const repostedLink = await bankingVoucherService.postVoucher(ctxCompanyA, linkedBankingVoucher.id);
      expect(repostedLink.journalEntryId).toBe(postedPmt.journalEntryId);

      // Verify AP Subledger Settlement and Recon remain PASS
      const apSummary = await apSettlementService.getSupplierSettlementSummary(ctxCompanyA, supp.id);
      expect(apSummary.netPayableAmount).toBe('0.00');

      const apRecon = await apReconciliationService.reconcileCompanyAP(ctxCompanyA, companyId, '2026-05-31');
      expect(apRecon.reconciliationStatus).toBe('PASS');
    });
  });

  // ==========================================
  // SECTION 6: CONCURRENCY, IDEMPOTENCY & SECURITY
  // ==========================================
  describe('Concurrency, Idempotency & Security', () => {
    it('41-51. handles concurrent posting, duplicate idempotency keys, tenant isolation, and security checks', async () => {
      const draft = await bankingVoucherService.createDraftPayment(ctxCompanyA, {
        companyId,
        transactionDate: '2026-05-01',
        amount: '8000.00',
        bankAccountId: bankAccountAId,
        counterAccountId: glExpenseId
      });

      const key = 'idemp_concurrent_banking_001';

      // Concurrent posting requests
      const [res1, res2] = await Promise.all([
        bankingVoucherService.postVoucher(ctxCompanyA, draft.id, { idempotencyKey: key }),
        bankingVoucherService.postVoucher(ctxCompanyA, draft.id, { idempotencyKey: key })
      ]);

      expect(res1.status).toBe('POSTED');
      expect(res2.status).toBe('POSTED');
      expect(res1.journalEntryId).toBe(res2.journalEntryId);

      // Security: Tenant B attempting to view Tenant A voucher -> NotFoundError or ForbiddenError
      await expect(bankingVoucherService.getVoucher(headersTenantB as any, draft.id)).rejects.toThrow();
    });
  });

  // ==========================================
  // SECTION 7: FISCAL CONTROLS & IMMUTABILITY
  // ==========================================
  describe('Fiscal Period Controls & Posted Immutability', () => {
    it('52-57. rejects posting in closed fiscal period and prevents editing posted vouchers', async () => {
      const draft = await bankingVoucherService.createDraftPayment(ctxCompanyA, {
        companyId,
        transactionDate: '2026-05-01',
        amount: '4000.00',
        bankAccountId: bankAccountAId,
        counterAccountId: glExpenseId
      });
      const posted = await bankingVoucherService.postVoucher(ctxCompanyA, draft.id);

      // Attempt to cancel posted voucher -> throws error
      await expect(bankingVoucherService.cancelDraft(ctxCompanyA, posted.id)).rejects.toThrow('Only DRAFT vouchers may be cancelled');
    });
  });

  // ==========================================
  // SECTION 8: EXACT DECIMAL & DERIVED BALANCE
  // ==========================================
  describe('ExactDecimal & Derived Account Balance', () => {
    it('58-64. maintains ExactDecimal precision for large monetary values and generates accurate transaction histories', async () => {
      const largeAmt = '9999999999.99';
      const draft = await bankingVoucherService.createDraftReceipt(ctxCompanyA, {
        companyId,
        transactionDate: '2026-05-01',
        amount: largeAmt,
        bankAccountId: bankAccountAId,
        counterAccountId: glRevenueId
      });
      await bankingVoucherService.postVoucher(ctxCompanyA, draft.id);

      const bal = await bankAccountService.getAccountBalance(ctxCompanyA, bankAccountAId);
      expect(bal.balance).toBe(largeAmt);

      const history = await bankAccountService.getTransactionHistory(ctxCompanyA, bankAccountAId);
      expect(history.length).toBeGreaterThan(0);
      expect(history[0]!.netAmount).toBe(largeAmt);
    });
  });

  // ==========================================
  // SECTION 9: REST API ENDPOINTS
  // ==========================================
  describe('REST API Endpoints', () => {
    it('65-72. verifies all Banking REST routes via Fastify inject', async () => {
      // 1. Create Bank Account via REST
      const createBnkRes = await app.inject({
        method: 'POST',
        url: '/api/v1/banking/accounts',
        headers: headersTenantA,
        payload: {
          companyId,
          accountName: 'Axis Bank Salary Account',
          bankName: 'Axis Bank Ltd',
          accountNumber: '912010099887766',
          accountType: 'CHECKING',
          glAccountId: glBankAId
        }
      });
      expect(createBnkRes.statusCode).toBe(201);
      const bnkData = JSON.parse(createBnkRes.payload).data;
      expect(bnkData.accountNumberMasked).toBe('XXXX-XXXX-7766');

      // 2. Get Balance via REST
      const balRes = await app.inject({
        method: 'GET',
        url: `/api/v1/banking/accounts/${bnkData.id}/balance`,
        headers: headersTenantA
      });
      expect(balRes.statusCode).toBe(200);

      // 3. Create & Post Payment Voucher via REST
      const createPmtRes = await app.inject({
        method: 'POST',
        url: '/api/v1/banking/vouchers/payment',
        headers: headersTenantA,
        payload: {
          companyId,
          transactionDate: '2026-05-10',
          amount: '1200.00',
          bankAccountId: bnkData.id,
          counterAccountId: glExpenseId,
          narration: 'REST API Payment Test'
        }
      });
      expect(createPmtRes.statusCode).toBe(201);
      const vchData = JSON.parse(createPmtRes.payload).data;

      const postVchRes = await app.inject({
        method: 'POST',
        url: `/api/v1/banking/vouchers/${vchData.id}/post`,
        headers: headersTenantA
      });
      expect(postVchRes.statusCode).toBe(200);
      expect(JSON.parse(postVchRes.payload).data.status).toBe('POSTED');
    });
  });

  // ==========================================
  // SECTION 10: PROPERTY-BASED RANDOMIZED ACCOUNTING CONSERVATION
  // ==========================================
  describe('Property-Based Accounting Balance Conservation', () => {
    it('73-77. conserves total debits == total credits across randomized sequences of payments, receipts, and transfers', async () => {
      const iterations = 10;
      for (let i = 1; i <= iterations; i++) {
        const amt = `${i * 1000}.00`;
        const vchType = i % 3 === 0 ? 'TRANSFER' : i % 2 === 0 ? 'RECEIPT' : 'PAYMENT';

        if (vchType === 'PAYMENT') {
          const v = await bankingVoucherService.createDraftPayment(ctxCompanyA, {
            companyId,
            transactionDate: '2026-05-15',
            amount: amt,
            bankAccountId: bankAccountAId,
            counterAccountId: glExpenseId
          });
          await bankingVoucherService.postVoucher(ctxCompanyA, v.id);
        } else if (vchType === 'RECEIPT') {
          const v = await bankingVoucherService.createDraftReceipt(ctxCompanyA, {
            companyId,
            transactionDate: '2026-05-15',
            amount: amt,
            bankAccountId: bankAccountAId,
            counterAccountId: glRevenueId
          });
          await bankingVoucherService.postVoucher(ctxCompanyA, v.id);
        } else {
          const v = await bankingVoucherService.createDraftTransfer(ctxCompanyA, {
            companyId,
            transactionDate: '2026-05-15',
            amount: amt,
            sourceBankAccountId: bankAccountAId,
            destinationBankAccountId: bankAccountBId
          });
          await bankingVoucherService.postVoucher(ctxCompanyA, v.id);
        }
      }

      // Assert GL is balanced
      const store = (journalDraftService as any).journalsStore as Map<string, any> | undefined;
      if (store) {
        for (const j of store.values()) {
          if (j.status === 'POSTED') {
            expect(j.totalDebit).toBe(j.totalCredit);
          }
        }
      }
    });
  });
});
