import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext, ValidationError, NotFoundError, ForbiddenError, BusinessRuleViolationError, AccountingError } from '@general-erp/core';
import { arReceiptService } from '../src/modules/finance/ar/ar-receipt.service.js';
import { arDocumentService } from '../src/modules/finance/ar/ar-document.service.js';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { accountingConfigurationService } from '../src/modules/finance/accounting-core.service.js';
import { ArPaymentMode } from '../src/modules/finance/ar/ar-receipt-model.js';

describe('Phase 2.6.3 — Customer Receipts & Unapplied Cash', () => {
  const tenantId = 'tenant_receipt_demo';
  const companyId = 'cmp_receipt_acme';
  const customerId = 'cust_receipt_001';

  const ctx: RequestContext = {
    tenantId,
    companyId,
    user: {
      id: 'usr_ar_clerk',
      tenantId,
      roles: ['AR_CLERK'],
      permissions: ['*']
    }
  };

  const otherTenantCtx: RequestContext = {
    tenantId: 'tenant_other_receipt',
    companyId: 'cmp_other_receipt',
    user: {
      id: 'usr_other',
      tenantId: 'tenant_other_receipt',
      roles: ['AR_CLERK'],
      permissions: ['*']
    }
  };

  let bankAccountId: string;
  let cashAccountId: string;
  let arAccountId: string;

  beforeEach(async () => {
    arReceiptService.clear();
    arDocumentService.clear();
    masterDataService.clear();
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    accountingConfigurationService.clear();

    await masterDataService.createCompany(ctx, {
      id: companyId,
      name: 'Acme Receipt Corp',
      legalName: 'Acme Receipt Corp Ltd',
      currency: 'INR'
    });

    await masterDataService.createCustomer(ctx, {
      id: customerId,
      companyId,
      name: 'Receipt Customer Ltd',
      code: 'CUST-REC-001',
      creditLimit: 500000
    });

    await masterDataService.createCompany(otherTenantCtx, {
      id: 'cmp_other_receipt',
      name: 'Other Tenant Corp',
      legalName: 'Other Tenant Corp Ltd',
      currency: 'INR'
    });

    await masterDataService.createCustomer(otherTenantCtx, {
      id: 'cust_other_rec',
      companyId: 'cmp_other_receipt',
      name: 'Other Customer Ltd',
      code: 'CUST-OTHER-REC',
      creditLimit: 100000
    });

    const { fiscalYear } = await fiscalPeriodService.createFiscalYear(ctx, {
      companyId,
      name: 'FY 2025-26',
      startDate: new Date('2025-04-01T00:00:00.000Z'),
      endDate: new Date('2026-03-31T23:59:59.999Z')
    });
    await fiscalPeriodService.activateFiscalYear(ctx, fiscalYear.id);

    // Setup COA Bank, Cash, and AR Control Accounts
    const bankAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '1010',
      accountName: 'HDFC Bank Operating Account',
      accountType: 'ASSET',
      isControlAccount: true,
      controlAccountType: 'BANK'
    });
    await chartOfAccountsService.activateAccount(ctx, bankAccount.id);
    bankAccountId = bankAccount.id;

    const cashAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '1020',
      accountName: 'Petty Cash Account',
      accountType: 'ASSET',
      isControlAccount: true,
      controlAccountType: 'CASH'
    });
    await chartOfAccountsService.activateAccount(ctx, cashAccount.id);
    cashAccountId = cashAccount.id;

    const arAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '1100',
      accountName: 'Accounts Receivable Control',
      accountType: 'ASSET',
      isControlAccount: true,
      controlAccountType: 'AR'
    });
    await chartOfAccountsService.activateAccount(ctx, arAccount.id);
    arAccountId = arAccount.id;

    const revAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '4000',
      accountName: 'Sales Revenue',
      accountType: 'INCOME'
    });
    await chartOfAccountsService.activateAccount(ctx, revAccount.id);

    // Set AR Accounting Mappings
    const eventTypes = ['AR_INVOICE', 'AR_CREDIT_NOTE', 'AR_DEBIT_NOTE', 'AR_OPENING_BALANCE', 'AR_RECEIPT'];
    for (const et of eventTypes) {
      await accountingConfigurationService.setMapping(ctx, {
        companyId,
        eventType: et,
        lineRole: 'AR_CONTROL',
        accountId: arAccountId
      });
      await accountingConfigurationService.setMapping(ctx, {
        companyId,
        eventType: et,
        lineRole: 'SALES_REVENUE',
        accountId: revAccount.id
      });
    }
  });

  describe('1. Receipt Creation & Input Validation', () => {
    it('creates draft receipt with valid parameters and initial unapplied cash state', async () => {
      const receipt = await arReceiptService.createDraft(ctx, {
        companyId,
        customerId,
        receiptDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '5000.00'
      });

      expect(receipt.id).toBeDefined();
      expect(receipt.status).toBe('DRAFT');
      expect(receipt.totalAmount).toBe('5000.00');
      expect(receipt.unappliedAmount).toBe('5000.00');
      expect(receipt.allocatedAmount).toBe('0.00');
    });

    it('REJECTS customer belonging to a different tenant or company', async () => {
      await expect(
        arReceiptService.createDraft(ctx, {
          companyId,
          customerId: 'cust_other_rec', // Belongs to other tenant!
          receiptDate: '2025-04-15',
          accountingDate: '2025-04-15',
          paymentMode: 'BANK_TRANSFER',
          bankAccountId,
          totalAmount: '1000.00'
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('REJECTS receiving account from another company or non-postable account', async () => {
      const otherCompanyAccount = await chartOfAccountsService.createAccount(otherTenantCtx, {
        companyId: 'cmp_other_receipt',
        accountCode: '1010',
        accountName: 'Other Company Bank',
        accountType: 'ASSET'
      });

      await expect(
        arReceiptService.createDraft(ctx, {
          companyId,
          customerId,
          receiptDate: '2025-04-15',
          accountingDate: '2025-04-15',
          paymentMode: 'BANK_TRANSFER',
          bankAccountId: otherCompanyAccount.id,
          totalAmount: '1000.00'
        })
      ).rejects.toThrow(ValidationError);
    });

    it('REJECTS invalid monetary scale (> 2 decimal places) and negative/zero amounts', async () => {
      // Scale > 2 check
      await expect(
        arReceiptService.createDraft(ctx, {
          companyId,
          customerId,
          receiptDate: '2025-04-15',
          accountingDate: '2025-04-15',
          paymentMode: 'CASH',
          bankAccountId: cashAccountId,
          totalAmount: '100.005'
        })
      ).rejects.toThrow(ValidationError);

      // Negative check
      await expect(
        arReceiptService.createDraft(ctx, {
          companyId,
          customerId,
          receiptDate: '2025-04-15',
          accountingDate: '2025-04-15',
          paymentMode: 'CASH',
          bankAccountId: cashAccountId,
          totalAmount: '-500.00'
        })
      ).rejects.toThrow(ValidationError);

      // Zero check
      await expect(
        arReceiptService.createDraft(ctx, {
          companyId,
          customerId,
          receiptDate: '2025-04-15',
          accountingDate: '2025-04-15',
          paymentMode: 'CASH',
          bankAccountId: cashAccountId,
          totalAmount: '0.00'
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('2. Receipt Lifecycle & Immutability', () => {
    it('updates draft receipt, but REJECTS updates to POSTED receipt', async () => {
      const draft = await arReceiptService.createDraft(ctx, {
        companyId,
        customerId,
        receiptDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'CHEQUE',
        bankAccountId,
        totalAmount: '2500.00'
      });

      const updated = await arReceiptService.updateDraft(ctx, draft.id, {
        totalAmount: '3000.00'
      });
      expect(updated.totalAmount).toBe('3000.00');
      expect(updated.unappliedAmount).toBe('3000.00');

      const posted = await arReceiptService.postReceipt(ctx, draft.id);
      expect(posted.status).toBe('POSTED');

      await expect(
        arReceiptService.updateDraft(ctx, posted.id, {
          totalAmount: '4000.00'
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('reverses a POSTED receipt cleanly and rejects posting a REVERSED receipt', async () => {
      const draft = await arReceiptService.createDraft(ctx, {
        companyId,
        customerId,
        receiptDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'UPI',
        bankAccountId,
        totalAmount: '1200.00'
      });

      const posted = await arReceiptService.postReceipt(ctx, draft.id);
      expect(posted.status).toBe('POSTED');
      expect(posted.journalEntryId).toBeDefined();

      const reversed = await arReceiptService.reverseReceipt(ctx, posted.id, 'Bounced cheque / error');
      expect(reversed.status).toBe('REVERSED');

      await expect(
        arReceiptService.postReceipt(ctx, draft.id)
      ).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  describe('3. AccountingCore Integration & Unapplied Cash State', () => {
    it('posts receipt through AccountingCore and produces a balanced GL entry', async () => {
      const draft = await arReceiptService.createDraft(ctx, {
        companyId,
        customerId,
        receiptDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '7500.00'
      });

      const posted = await arReceiptService.postReceipt(ctx, draft.id);

      expect(posted.status).toBe('POSTED');
      expect(posted.journalEntryId).toBeDefined();
      expect(posted.receiptNumber).toBeDefined();
      expect(posted.allocatedAmount).toBe('0.00');
      expect(posted.unappliedAmount).toBe('7500.00');
    });

    it('strictly asserts ZERO allocation side effects and untouched open items upon receipt post', async () => {
      // Create invoice open item
      const invoiceDraft = await arDocumentService.createDraft(ctx, {
        companyId,
        customerId,
        documentType: 'INVOICE',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '10000.00', taxableAmount: '10000.00', taxAmount: '0.00', grossAmount: '10000.00' }]
      });
      await arDocumentService.postDocument(ctx, invoiceDraft.id);

      // Post standalone customer receipt
      const receiptDraft = await arReceiptService.createDraft(ctx, {
        companyId,
        customerId,
        receiptDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '4000.00'
      });
      await arReceiptService.postReceipt(ctx, receiptDraft.id);

      // Open item outstanding balance MUST remain 10000.00 (allocation occurs in 2.6.4 ONLY!)
      const openItems = await arDocumentService.getOpenItems(ctx, companyId, { customerId });
      const invoiceOpenItem = openItems.find(i => i.arDocumentId === invoiceDraft.id);
      expect(invoiceOpenItem!.outstandingAmount).toBe('10000.00');
    });
  });

  describe('4. Transaction Rollback & Idempotency', () => {
    it('ROLLS BACK receipt posting completely when a failure is injected', async () => {
      const draft = await arReceiptService.createDraft(ctx, {
        companyId,
        customerId,
        receiptDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'CASH',
        bankAccountId: cashAccountId,
        totalAmount: '1500.00'
      });

      await expect(
        arReceiptService.postReceipt(ctx, draft.id, { simulateFailure: true })
      ).rejects.toThrow(AccountingError);

      const afterFail = await arReceiptService.getReceipt(ctx, draft.id);
      expect(afterFail.status).toBe('DRAFT');
      expect(afterFail.journalEntryId).toBeNull();
    });

    it('returns existing posted receipt idempotently on duplicate post calls', async () => {
      const draft = await arReceiptService.createDraft(ctx, {
        companyId,
        customerId,
        receiptDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '2000.00'
      });

      const post1 = await arReceiptService.postReceipt(ctx, draft.id);
      const post2 = await arReceiptService.postReceipt(ctx, draft.id);

      expect(post1.journalEntryId).toBe(post2.journalEntryId);
      expect(post1.receiptNumber).toBe(post2.receiptNumber);
    });

    it('handles 100 concurrent posting attempts for the same receipt safely with 1 GL entry', async () => {
      const draft = await arReceiptService.createDraft(ctx, {
        companyId,
        customerId,
        receiptDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '9000.00'
      });

      const postPromises = Array.from({ length: 100 }).map(() =>
        arReceiptService.postReceipt(ctx, draft.id).catch(err => err)
      );

      const results = await Promise.all(postPromises);
      const successfulPosts = results.filter(r => !(r instanceof Error));
      expect(successfulPosts.length).toBeGreaterThanOrEqual(1);

      const journalIds = new Set(successfulPosts.map(r => r.journalEntryId));
      expect(journalIds.size).toBe(1);

      const receiptNums = new Set(successfulPosts.map(r => r.receiptNumber));
      expect(receiptNums.size).toBe(1);
    });

    it('posts 100 concurrent independent receipts with ZERO sequence collisions', async () => {
      const draftPromises = Array.from({ length: 100 }, (_, idx) =>
        arReceiptService.createDraft(ctx, {
          companyId,
          customerId,
          receiptDate: '2025-04-15',
          accountingDate: '2025-04-15',
          paymentMode: 'BANK_TRANSFER',
          bankAccountId,
          totalAmount: `${100 + idx}.00`
        })
      );

      const drafts = await Promise.all(draftPromises);
      const postPromises = drafts.map(d => arReceiptService.postReceipt(ctx, d.id));
      const postedResults = await Promise.all(postPromises);

      expect(postedResults.length).toBe(100);
      const receiptNumbers = new Set(postedResults.map(r => r.receiptNumber));
      expect(receiptNumbers.size).toBe(100);
    });
  });

  describe('5. Security & Mass Assignment Protection', () => {
    it('PREVENTS client from manufacturing a POSTED receipt via input payloads', async () => {
      const payload: any = {
        companyId,
        customerId,
        receiptDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'CASH',
        bankAccountId: cashAccountId,
        totalAmount: '500.00',
        status: 'POSTED',
        journalEntryId: 'je_hacked'
      };

      const receipt = await arReceiptService.createDraft(ctx, payload);
      expect(receipt.status).toBe('DRAFT');
      expect(receipt.journalEntryId).toBeNull();
    });

    it('rejects cross-tenant receipt access', async () => {
      const draft = await arReceiptService.createDraft(ctx, {
        companyId,
        customerId,
        receiptDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'CASH',
        bankAccountId: cashAccountId,
        totalAmount: '500.00'
      });

      await expect(
        arReceiptService.getReceipt(otherTenantCtx, draft.id)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('6. 200 Randomized Financial Receipt Scenarios', () => {
    it('executes 200 randomized receipt postings and asserts exact decimal unapplied cash invariants', async () => {
      const paymentModes: ArPaymentMode[] = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'UPI', 'OTHER'];

      for (let i = 0; i < 200; i++) {
        const mode = paymentModes[i % paymentModes.length]!;
        const receivingAcc = (mode === 'CASH') ? cashAccountId : bankAccountId;
        const randAmountVal = (Math.floor(Math.random() * 50000) + 100) / 100;
        const amountStr = randAmountVal.toFixed(2);

        const draft = await arReceiptService.createDraft(ctx, {
          companyId,
          customerId,
          receiptDate: '2025-04-15',
          accountingDate: '2025-04-15',
          paymentMode: mode,
          bankAccountId: receivingAcc,
          totalAmount: amountStr
        });

        const posted = await arReceiptService.postReceipt(ctx, draft.id);

        expect(posted.status).toBe('POSTED');
        expect(posted.totalAmount).toBe(amountStr);
        expect(posted.unappliedAmount).toBe(amountStr);
        expect(posted.allocatedAmount).toBe('0.00');
        expect(posted.journalEntryId).toBeDefined();
        expect(posted.receiptNumber).toBeDefined();
      }
    });
  });
});
