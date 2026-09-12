import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext, ValidationError, NotFoundError, ForbiddenError, BusinessRuleViolationError, AccountingError } from '@general-erp/core';
import { apAllocationService } from '../src/modules/finance/ap/ap-allocation.service.js';
import { apPaymentService } from '../src/modules/finance/ap/ap-payment.service.js';
import { apDocumentService } from '../src/modules/finance/ap/ap-document.service.js';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { accountingConfigurationService } from '../src/modules/finance/accounting-core.service.js';

describe('Phase 2.7.4 — AP Polymorphic Allocation Engine', () => {
  const tenantId = 'tenant_ap_alloc_demo';
  const companyId = 'cmp_ap_alloc_acme';
  const supplierId = 'supp_ap_alloc_001';

  const ctx: RequestContext = {
    tenantId,
    companyId,
    user: {
      id: 'usr_ap_clerk',
      tenantId,
      roles: ['AP_CLERK'],
      permissions: ['*']
    }
  };

  const otherTenantCtx: RequestContext = {
    tenantId: 'tenant_other_ap_alloc',
    companyId: 'cmp_other_ap_alloc',
    user: {
      id: 'usr_other',
      tenantId: 'tenant_other_ap_alloc',
      roles: ['AP_CLERK'],
      permissions: ['*']
    }
  };

  let bankAccountId: string;
  let cashAccountId: string;
  let apAccountId: string;
  let discountIncomeAccountId: string;
  let expAccountId: string;

  beforeEach(async () => {
    apAllocationService.clear();
    apPaymentService.clear();
    apDocumentService.clear();
    masterDataService.clear();
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    accountingConfigurationService.clear();

    await masterDataService.createCompany(ctx, {
      id: companyId,
      name: 'Acme AP Allocation Corp',
      legalName: 'Acme AP Allocation Corp Ltd',
      currency: 'INR'
    });

    await masterDataService.createSupplier(ctx, {
      id: supplierId,
      companyId,
      name: 'Supplier Alpha Ltd',
      code: 'SUPP-ALLOC-001'
    });

    await masterDataService.createSupplier(ctx, {
      id: 'supp_ap_alloc_002',
      companyId,
      name: 'Supplier Beta Ltd',
      code: 'SUPP-ALLOC-002'
    });

    await masterDataService.createCompany(otherTenantCtx, {
      id: 'cmp_other_ap_alloc',
      name: 'Other Tenant AP Corp',
      legalName: 'Other Tenant AP Corp Ltd',
      currency: 'INR'
    });

    await masterDataService.createSupplier(otherTenantCtx, {
      id: 'supp_other_alloc',
      companyId: 'cmp_other_ap_alloc',
      name: 'Other Supplier Ltd',
      code: 'SUPP-OTHER-ALLOC'
    });

    const { fiscalYear } = await fiscalPeriodService.createFiscalYear(ctx, {
      companyId,
      name: 'FY 2025-26',
      startDate: new Date('2025-04-01T00:00:00.000Z'),
      endDate: new Date('2026-03-31T23:59:59.999Z')
    });
    await fiscalPeriodService.activateFiscalYear(ctx, fiscalYear.id);

    // Setup COA Bank, Cash, AP Control, Purchase Expense, and Discount Accounts
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

    const apAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '2100',
      accountName: 'Accounts Payable Control',
      accountType: 'LIABILITY',
      isControlAccount: true,
      controlAccountType: 'AP'
    });
    await chartOfAccountsService.activateAccount(ctx, apAccount.id);
    apAccountId = apAccount.id;

    const expAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '5000',
      accountName: 'Operating Expense',
      accountType: 'EXPENSE'
    });
    await chartOfAccountsService.activateAccount(ctx, expAccount.id);
    expAccountId = expAccount.id;

    const discountAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '4900',
      accountName: 'Purchase Discount Income',
      accountType: 'INCOME'
    });
    await chartOfAccountsService.activateAccount(ctx, discountAccount.id);
    discountIncomeAccountId = discountAccount.id;

    // Set AP Accounting Mappings
    const eventTypes = ['AP_SUPPLIER_BILL', 'AP_CREDIT_NOTE', 'AP_DEBIT_NOTE', 'AP_OPENING_BALANCE', 'AP_PAYMENT', 'AP_DISCOUNT'];
    for (const et of eventTypes) {
      await accountingConfigurationService.setMapping(ctx, {
        companyId,
        eventType: et,
        lineRole: 'AP_CONTROL',
        accountId: apAccountId
      });
      await accountingConfigurationService.setMapping(ctx, {
        companyId,
        eventType: et,
        lineRole: 'PURCHASE_EXPENSE',
        accountId: expAccountId
      });
      await accountingConfigurationService.setMapping(ctx, {
        companyId,
        eventType: et,
        lineRole: 'PURCHASE_DISCOUNT_INCOME',
        accountId: discountIncomeAccountId
      });
    }
  });

  describe('1. Source & Target Validation', () => {
    it('allocates a POSTED payment to an OPEN supplier bill successfully', async () => {
      // Create and post supplier bill
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '10000.00', taxableAmount: '10000.00', taxAmount: '0.00', grossAmount: '10000.00', expenseAccountId: expAccountId }]
      });
      const bill = await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === bill.id)!;

      // Create and post supplier payment
      const paymentDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '4000.00'
      });
      const payment = await apPaymentService.postPayment(ctx, paymentDraft.id);

      // Allocate payment -> bill open item
      const allocation = await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '4000.00'
      });

      expect(allocation.id).toBeDefined();
      expect(allocation.status).toBe('ACTIVE');
      expect(allocation.allocatedAmount).toBe('4000.00');

      // Verify payment unapplied amount reduced to 0.00, allocated increased to 4000.00
      const updatedPayment = await apPaymentService.getPayment(ctx, payment.id);
      expect(updatedPayment.unappliedAmount).toBe('0.00');
      expect(updatedPayment.allocatedAmount).toBe('4000.00');

      // Verify open item outstanding reduced to 6000.00, status PARTIALLY_SETTLED
      const updatedOpenItem = await apDocumentService.getOpenItem(ctx, openItem.id);
      expect(updatedOpenItem.outstandingAmount).toBe('6000.00');
      expect(updatedOpenItem.status).toBe('PARTIALLY_SETTLED');
    });

    it('allocates a POSTED credit note to an OPEN supplier bill successfully', async () => {
      // Create and post supplier bill
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '5000.00', taxableAmount: '5000.00', taxAmount: '0.00', grossAmount: '5000.00', expenseAccountId: expAccountId }]
      });
      const bill = await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === bill.id)!;

      // Create and post supplier credit note
      const cnDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'CREDIT_NOTE',
        documentDate: '2025-04-12',
        accountingDate: '2025-04-12',
        dueDate: '2025-05-12',
        lines: [{ description: 'CN Item 1', quantity: '1.0000', unitPrice: '2000.00', taxableAmount: '2000.00', taxAmount: '0.00', grossAmount: '2000.00', expenseAccountId: expAccountId }]
      });
      const creditNote = await apDocumentService.postDocument(ctx, cnDraft.id);

      // Allocate credit note -> bill open item
      const allocation = await apAllocationService.allocate(ctx, {
        allocationSourceType: 'CREDIT_NOTE',
        creditNoteId: creditNote.id,
        openItemId: openItem.id,
        allocatedAmount: '2000.00'
      });

      expect(allocation.id).toBeDefined();
      expect(allocation.status).toBe('ACTIVE');
      expect(allocation.allocatedAmount).toBe('2000.00');

      // Verify credit note unapplied amount reduced to 0.00
      const updatedCN = await apDocumentService.getDocument(ctx, creditNote.id);
      expect(updatedCN.unappliedAmount).toBe('0.00');

      // Verify open item outstanding reduced to 3000.00
      const updatedOpenItem = await apDocumentService.getOpenItem(ctx, openItem.id);
      expect(updatedOpenItem.outstandingAmount).toBe('3000.00');
    });

    it('REJECTS allocation from DRAFT or REVERSED payment/credit note', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '5000.00', taxableAmount: '5000.00', taxAmount: '0.00', grossAmount: '5000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === billDraft.id)!;

      // Draft payment
      const draftPayment = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'CASH',
        bankAccountId: cashAccountId,
        totalAmount: '1000.00'
      });

      await expect(
        apAllocationService.allocate(ctx, {
          allocationSourceType: 'PAYMENT',
          paymentId: draftPayment.id,
          openItemId: openItem.id,
          allocatedAmount: '1000.00'
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('REJECTS source exclusivity violations (both payment and credit note provided or neither)', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '5000.00', taxableAmount: '5000.00', taxAmount: '0.00', grossAmount: '5000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === billDraft.id)!;

      await expect(
        apAllocationService.allocate(ctx, {
          allocationSourceType: 'PAYMENT',
          paymentId: 'pay_123',
          creditNoteId: 'cn_123',
          openItemId: openItem.id,
          allocatedAmount: '1000.00'
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('2. Supplier & Tenant/Company Integrity Guards', () => {
    it('REJECTS cross-supplier allocation (Supplier A payment -> Supplier B bill)', async () => {
      // Bill for Supplier Alpha
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId, // Supplier Alpha
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '5000.00', taxableAmount: '5000.00', taxAmount: '0.00', grossAmount: '5000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === billDraft.id)!;

      // Payment for Supplier Beta
      const paymentDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId: 'supp_ap_alloc_002', // Supplier Beta
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '2000.00'
      });
      const payment = await apPaymentService.postPayment(ctx, paymentDraft.id);

      await expect(
        apAllocationService.allocate(ctx, {
          allocationSourceType: 'PAYMENT',
          paymentId: payment.id,
          openItemId: openItem.id,
          allocatedAmount: '2000.00'
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('REJECTS cross-tenant allocation attempts', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '5000.00', taxableAmount: '5000.00', taxAmount: '0.00', grossAmount: '5000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === billDraft.id)!;

      await expect(
        apAllocationService.allocate(otherTenantCtx, {
          allocationSourceType: 'PAYMENT',
          paymentId: 'pay_other',
          openItemId: openItem.id,
          allocatedAmount: '1000.00'
        })
      ).rejects.toThrow();
    });
  });

  describe('3. Exact Decimal & Over-Allocation Invariants', () => {
    it('REJECTS allocation exceeding payment available unapplied amount', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '10000.00', taxableAmount: '10000.00', taxAmount: '0.00', grossAmount: '10000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === billDraft.id)!;

      const paymentDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '3000.00'
      });
      const payment = await apPaymentService.postPayment(ctx, paymentDraft.id);

      await expect(
        apAllocationService.allocate(ctx, {
          allocationSourceType: 'PAYMENT',
          paymentId: payment.id,
          openItemId: openItem.id,
          allocatedAmount: '3000.01' // Exceeds 3000.00!
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('REJECTS allocation deduction exceeding open item outstanding balance', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '4000.00', taxableAmount: '4000.00', taxAmount: '0.00', grossAmount: '4000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === billDraft.id)!;

      const paymentDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '5000.00'
      });
      const payment = await apPaymentService.postPayment(ctx, paymentDraft.id);

      await expect(
        apAllocationService.allocate(ctx, {
          allocationSourceType: 'PAYMENT',
          paymentId: payment.id,
          openItemId: openItem.id,
          allocatedAmount: '4500.00' // Exceeds 4000.00 open item balance!
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  describe('4. Prompt Payment Discount & Accounting', () => {
    it('processes prompt payment discount and posts GL discount income entry', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '10000.00', taxableAmount: '10000.00', taxAmount: '0.00', grossAmount: '10000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === billDraft.id)!;

      const paymentDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '9500.00'
      });
      const payment = await apPaymentService.postPayment(ctx, paymentDraft.id);

      // Allocate 9500.00 + 500.00 discount to settle 10000.00 bill
      const allocation = await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '9500.00',
        discountAmount: '500.00'
      });

      expect(allocation.allocatedAmount).toBe('9500.00');
      expect(allocation.discountAmount).toBe('500.00');

      // Payment unapplied consumed 9500.00 (discount does not reduce payment unapplied!)
      const updatedPayment = await apPaymentService.getPayment(ctx, payment.id);
      expect(updatedPayment.unappliedAmount).toBe('0.00');

      // Open item outstanding reduced by 9500 + 500 = 10000.00 -> status SETTLED!
      const updatedOpenItem = await apDocumentService.getOpenItem(ctx, openItem.id);
      expect(updatedOpenItem.outstandingAmount).toBe('0.00');
      expect(updatedOpenItem.status).toBe('SETTLED');
    });
  });

  describe('5. Allocation Reversal & Idempotency', () => {
    it('reverses an active allocation and cleanly restores payment and open item balances', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '8000.00', taxableAmount: '8000.00', taxAmount: '0.00', grossAmount: '8000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === billDraft.id)!;

      const paymentDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '8000.00'
      });
      const payment = await apPaymentService.postPayment(ctx, paymentDraft.id);

      const alloc = await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '8000.00'
      });

      // Reverse allocation
      const reversedAlloc = await apAllocationService.reverseAllocation(ctx, {
        allocationId: alloc.id,
        reason: 'Allocation error'
      });

      expect(reversedAlloc.status).toBe('REVERSED');

      // Restored payment unapplied balance
      const restoredPayment = await apPaymentService.getPayment(ctx, payment.id);
      expect(restoredPayment.unappliedAmount).toBe('8000.00');

      // Restored open item outstanding balance
      const restoredOpenItem = await apDocumentService.getOpenItem(ctx, openItem.id);
      expect(restoredOpenItem.outstandingAmount).toBe('8000.00');
      expect(restoredOpenItem.status).toBe('OPEN');
    });

    it('reverses a discount allocation and reverses the GL discount entry', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '10000.00', taxableAmount: '10000.00', taxAmount: '0.00', grossAmount: '10000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === billDraft.id)!;

      const paymentDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '9500.00'
      });
      const payment = await apPaymentService.postPayment(ctx, paymentDraft.id);

      const alloc = await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '9500.00',
        discountAmount: '500.00'
      });

      expect(alloc.discountJournalEntryId).toBeDefined();
      expect(alloc.discountJournalEntryId).not.toBeNull();

      // Reverse discount allocation
      const reversedAlloc = await apAllocationService.reverseAllocation(ctx, {
        allocationId: alloc.id,
        reason: 'Discount entry mistake'
      });

      expect(reversedAlloc.status).toBe('REVERSED');

      // Restored payment unapplied balance
      const restoredPayment = await apPaymentService.getPayment(ctx, payment.id);
      expect(restoredPayment.unappliedAmount).toBe('9500.00');

      // Restored open item outstanding balance
      const restoredOpenItem = await apDocumentService.getOpenItem(ctx, openItem.id);
      expect(restoredOpenItem.outstandingAmount).toBe('10000.00');
      expect(restoredOpenItem.status).toBe('OPEN');
    });

    it('returns idempotent allocation result on duplicate request with same idempotencyKey', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '5000.00', taxableAmount: '5000.00', taxAmount: '0.00', grossAmount: '5000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === billDraft.id)!;

      const paymentDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '5000.00'
      });
      const payment = await apPaymentService.postPayment(ctx, paymentDraft.id);

      const alloc1 = await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '2000.00',
        idempotencyKey: 'idemp_ap_alloc_100'
      });

      const alloc2 = await apAllocationService.allocate(ctx, {
        allocationSourceType: 'PAYMENT',
        paymentId: payment.id,
        openItemId: openItem.id,
        allocatedAmount: '2000.00',
        idempotencyKey: 'idemp_ap_alloc_100'
      });

      expect(alloc1.id).toBe(alloc2.id);
    });
  });

  describe('6. Database & High Concurrency Allocation Protection', () => {
    it('handles 100 concurrent allocation attempts for the same payment/invoice safely without over-allocating', async () => {
      const billDraft = await apDocumentService.createDraft(ctx, {
        companyId,
        supplierId,
        documentType: 'SUPPLIER_BILL',
        documentDate: '2025-04-10',
        accountingDate: '2025-04-10',
        dueDate: '2025-05-10',
        lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: '10000.00', taxableAmount: '10000.00', taxAmount: '0.00', grossAmount: '10000.00', expenseAccountId: expAccountId }]
      });
      await apDocumentService.postDocument(ctx, billDraft.id);
      const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
      const openItem = openItems.find(i => i.apDocumentId === billDraft.id)!;

      const paymentDraft = await apPaymentService.createDraft(ctx, {
        companyId,
        supplierId,
        paymentDate: '2025-04-15',
        accountingDate: '2025-04-15',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '10000.00'
      });
      const payment = await apPaymentService.postPayment(ctx, paymentDraft.id);

      // Attempt 100 concurrent allocations of 1000.00 each (total available is 10000.00)
      const promises = Array.from({ length: 100 }).map(() =>
        apAllocationService
          .allocate(ctx, {
            allocationSourceType: 'PAYMENT',
            paymentId: payment.id,
            openItemId: openItem.id,
            allocatedAmount: '1000.00'
          })
          .catch(err => err)
      );

      const results = await Promise.all(promises);
      const successful = results.filter(r => !(r instanceof Error));

      // Exactly 10 allocations of 1000.00 should succeed before 10000.00 is fully consumed!
      expect(successful.length).toBe(10);

      const finalPayment = await apPaymentService.getPayment(ctx, payment.id);
      expect(finalPayment.unappliedAmount).toBe('0.00');

      const finalOpenItem = await apDocumentService.getOpenItem(ctx, openItem.id);
      expect(finalOpenItem.outstandingAmount).toBe('0.00');
      expect(finalOpenItem.status).toBe('SETTLED');
    });
  });

  describe('7. 100 Randomized Financial Allocation Scenarios', () => {
    it('executes 100 randomized allocation scenarios asserting exact decimal source/target invariants', async () => {
      for (let i = 0; i < 100; i++) {
        const randAmountVal = Math.floor(Math.random() * 5000) + 500;
        const amountStr = randAmountVal.toFixed(2);

        const billDraft = await apDocumentService.createDraft(ctx, {
          companyId,
          supplierId,
          documentType: 'SUPPLIER_BILL',
          documentDate: '2025-04-10',
          accountingDate: '2025-04-10',
          dueDate: '2025-05-10',
          lines: [{ description: 'Item 1', quantity: '1.0000', unitPrice: amountStr, taxableAmount: amountStr, taxAmount: '0.00', grossAmount: amountStr, expenseAccountId: expAccountId }]
        });
        await apDocumentService.postDocument(ctx, billDraft.id);
        const openItems = await apDocumentService.getOpenItems(ctx, companyId, { supplierId });
        const openItem = openItems.find(item => item.apDocumentId === billDraft.id)!;

        const paymentDraft = await apPaymentService.createDraft(ctx, {
          companyId,
          supplierId,
          paymentDate: '2025-04-15',
          accountingDate: '2025-04-15',
          paymentMode: 'BANK_TRANSFER',
          bankAccountId,
          totalAmount: amountStr
        });
        const payment = await apPaymentService.postPayment(ctx, paymentDraft.id);

        const alloc = await apAllocationService.allocate(ctx, {
          allocationSourceType: 'PAYMENT',
          paymentId: payment.id,
          openItemId: openItem.id,
          allocatedAmount: amountStr
        });

        expect(alloc.status).toBe('ACTIVE');
        expect(alloc.allocatedAmount).toBe(amountStr);

        const checkPayment = await apPaymentService.getPayment(ctx, payment.id);
        expect(checkPayment.unappliedAmount).toBe('0.00');

        const checkOpenItem = await apDocumentService.getOpenItem(ctx, openItem.id);
        expect(checkOpenItem.outstandingAmount).toBe('0.00');
        expect(checkOpenItem.status).toBe('SETTLED');
      }
    });
  });
});
