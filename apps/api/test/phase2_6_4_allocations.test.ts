import { describe, it, expect, beforeEach } from 'vitest';
import {
  RequestContext,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  BusinessRuleViolationError,
  ExactDecimal
} from '@general-erp/core';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { accountingConfigurationService } from '../src/modules/finance/accounting-core.service.js';
import { arDocumentService } from '../src/modules/finance/ar/ar-document.service.js';
import { arReceiptService } from '../src/modules/finance/ar/ar-receipt.service.js';
import { arAllocationService } from '../src/modules/finance/ar/ar-allocation.service.js';
import {
  CreateArDocumentInput,
  CreateArReceiptInput,
  CreateArAllocationInput
} from '../src/modules/finance/ar/index.js';

describe('Phase 2.6.4 — AR Allocation Engine', () => {
  const tenantId = 'tenant_alloc_test';
  const companyId = '11111111-1111-4111-a111-111111111111';
  const customerIdA = '22222222-2222-4222-a222-222222222222';
  const customerIdB = '33333333-3333-4333-a333-333333333333';
  let bankAccountId: string;

  let ctx: RequestContext;

  beforeEach(async () => {
    ctx = {
      tenantId,
      companyId,
      user: {
        id: 'usr_ar_alloc_admin',
        tenantId,
        roles: ['ACCOUNTANT'],
        permissions: ['*']
      }
    };

    arDocumentService.clear();
    arReceiptService.clear();
    arAllocationService.clear();
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    accountingConfigurationService.clear();
    masterDataService.clear();

    // Seed Company
    await masterDataService.createCompany(ctx, {
      id: companyId,
      name: 'Alpha Allocation Company',
      legalName: 'Alpha Allocation Company Ltd',
      currency: 'INR'
    });

    // Seed Master Data Customer A & Customer B
    await masterDataService.createCustomer(ctx, {
      id: customerIdA,
      companyId,
      code: 'CUST-A',
      name: 'Alpha Traders Pvt Ltd',
      gstin: '27AAAAA0000A1Z5',
      stateCode: '27'
    });

    await masterDataService.createCustomer(ctx, {
      id: customerIdB,
      companyId,
      code: 'CUST-B',
      name: 'Beta Enterprises',
      gstin: '27BBBBB0000B1Z6',
      stateCode: '27'
    });

    // Seed COA Cash/Bank Receiving Account
    const bankAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '1001',
      accountName: 'HDFC Bank Operating Account',
      accountType: 'ASSET',
      accountGroup: 'CASH_AND_BANK',
      isPostable: true,
      isActive: true,
      isControlAccount: true,
      controlAccountType: 'BANK'
    });
    await chartOfAccountsService.activateAccount(ctx, bankAccount.id);
    bankAccountId = bankAccount.id;

    const arAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '1100',
      accountName: 'Accounts Receivable Control',
      accountType: 'ASSET',
      isControlAccount: true,
      controlAccountType: 'AR'
    });
    await chartOfAccountsService.activateAccount(ctx, arAccount.id);

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
        accountId: arAccount.id
      });
      await accountingConfigurationService.setMapping(ctx, {
        companyId,
        eventType: et,
        lineRole: 'SALES_REVENUE',
        accountId: revAccount.id
      });
    }

    // Seed Open Fiscal Year & Period
    const { fiscalYear } = await fiscalPeriodService.createFiscalYear(ctx, {
      companyId,
      name: 'FY 2025-26',
      startDate: new Date('2025-04-01T00:00:00.000Z'),
      endDate: new Date('2026-03-31T23:59:59.999Z')
    });
    await fiscalPeriodService.activateFiscalYear(ctx, fiscalYear.id);
  });

  // Helper: create & post an Invoice for Customer A
  async function createPostedInvoice(grossAmount: string, custId: string = customerIdA): Promise<string> {
    const input: CreateArDocumentInput = {
      companyId,
      customerId: custId,
      documentType: 'INVOICE',
      documentDate: '2025-05-10',
      accountingDate: '2025-05-10',
      dueDate: '2025-06-10',
      lines: [
        {
          description: 'Consulting Services',
          quantity: '1.0000',
          unitPrice: grossAmount,
          taxableAmount: grossAmount,
          taxRatePercent: '0.000000',
          cgstAmount: '0.00',
          sgstAmount: '0.00',
          igstAmount: '0.00',
          utgstAmount: '0.00',
          cessAmount: '0.00',
          taxAmount: '0.00',
          grossAmount
        }
      ]
    };
    const draft = await arDocumentService.createDraft(ctx, input);
    const posted = await arDocumentService.postDocument(ctx, draft.id);
    const openItems = await arDocumentService.getOpenItems(ctx, companyId, { customerId: custId });
    const targetItem = openItems.find(i => i.arDocumentId === posted.id);
    return targetItem!.id;
  }

  // Helper: create & post a Receipt for Customer A
  async function createPostedReceipt(totalAmount: string, custId: string = customerIdA): Promise<string> {
    const input: CreateArReceiptInput = {
      companyId,
      customerId: custId,
      receiptDate: '2025-05-15',
      accountingDate: '2025-05-15',
      paymentMode: 'BANK_TRANSFER',
      bankAccountId,
      totalAmount
    };
    const draft = await arReceiptService.createDraft(ctx, input);
    const posted = await arReceiptService.postReceipt(ctx, draft.id);
    return posted.id;
  }

  // Helper: create & post a Credit Note for Customer A
  async function createPostedCreditNote(grossAmount: string, custId: string = customerIdA): Promise<string> {
    const input: CreateArDocumentInput = {
      companyId,
      customerId: custId,
      documentType: 'CREDIT_NOTE',
      documentDate: '2025-05-20',
      accountingDate: '2025-05-20',
      dueDate: '2025-05-20',
      lines: [
        {
          description: 'Volume Discount Credit',
          quantity: '1.0000',
          unitPrice: grossAmount,
          taxableAmount: grossAmount,
          taxRatePercent: '0.000000',
          cgstAmount: '0.00',
          sgstAmount: '0.00',
          igstAmount: '0.00',
          utgstAmount: '0.00',
          cessAmount: '0.00',
          taxAmount: '0.00',
          grossAmount
        }
      ]
    };
    const draft = await arDocumentService.createDraft(ctx, input);
    const posted = await arDocumentService.postDocument(ctx, draft.id);
    return posted.id;
  }

  describe('1. Source Exclusivity & Input Validation', () => {
    it('rejects allocation missing source type', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const allocInput = {
        allocationSourceType: '' as any,
        openItemId,
        allocatedAmount: '500.00'
      };
      await expect(arAllocationService.allocate(ctx, allocInput)).rejects.toThrow(ValidationError);
    });

    it('rejects RECEIPT allocation with missing receiptId', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const allocInput: CreateArAllocationInput = {
        allocationSourceType: 'RECEIPT',
        openItemId,
        allocatedAmount: '500.00'
      };
      await expect(arAllocationService.allocate(ctx, allocInput)).rejects.toThrow(ValidationError);
    });

    it('rejects RECEIPT allocation when creditNoteId is also supplied', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const receiptId = await createPostedReceipt('1000.00');
      const allocInput: CreateArAllocationInput = {
        allocationSourceType: 'RECEIPT',
        receiptId,
        creditNoteId: 'some-cn-id',
        openItemId,
        allocatedAmount: '500.00'
      };
      await expect(arAllocationService.allocate(ctx, allocInput)).rejects.toThrow(ValidationError);
    });

    it('rejects CREDIT_NOTE allocation with missing creditNoteId', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const allocInput: CreateArAllocationInput = {
        allocationSourceType: 'CREDIT_NOTE',
        openItemId,
        allocatedAmount: '500.00'
      };
      await expect(arAllocationService.allocate(ctx, allocInput)).rejects.toThrow(ValidationError);
    });

    it('rejects CREDIT_NOTE allocation when receiptId is also supplied', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const creditNoteId = await createPostedCreditNote('500.00');
      const allocInput: CreateArAllocationInput = {
        allocationSourceType: 'CREDIT_NOTE',
        creditNoteId,
        receiptId: 'some-receipt-id',
        openItemId,
        allocatedAmount: '500.00'
      };
      await expect(arAllocationService.allocate(ctx, allocInput)).rejects.toThrow(ValidationError);
    });

    it('rejects non-positive allocation amounts', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const receiptId = await createPostedReceipt('1000.00');

      await expect(
        arAllocationService.allocate(ctx, {
          allocationSourceType: 'RECEIPT',
          receiptId,
          openItemId,
          allocatedAmount: '0.00'
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        arAllocationService.allocate(ctx, {
          allocationSourceType: 'RECEIPT',
          receiptId,
          openItemId,
          allocatedAmount: '-100.00'
        })
      ).rejects.toThrow(ValidationError);
    });

    it('rejects excessive decimal scale (> 2 decimal places)', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const receiptId = await createPostedReceipt('1000.00');

      await expect(
        arAllocationService.allocate(ctx, {
          allocationSourceType: 'RECEIPT',
          receiptId,
          openItemId,
          allocatedAmount: '100.005'
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('2. Receipt Allocation Lifecycle & Invariants', () => {
    it('allocates receipt fully against invoice open item', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const receiptId = await createPostedReceipt('1000.00');

      const alloc = await arAllocationService.allocate(ctx, {
        allocationSourceType: 'RECEIPT',
        receiptId,
        openItemId,
        allocatedAmount: '1000.00'
      });

      expect(alloc.status).toBe('ACTIVE');
      expect(alloc.allocatedAmount).toBe('1000.00');

      // Verify Receipt state
      const receipt = await arReceiptService.getReceipt(ctx, receiptId);
      expect(receipt.allocatedAmount).toBe('1000.00');
      expect(receipt.unappliedAmount).toBe('0.00');
      expect(ExactDecimal.parse(receipt.allocatedAmount, 2).add(ExactDecimal.parse(receipt.unappliedAmount, 2)).toString()).toBe(receipt.totalAmount);

      // Verify Open Item state
      const openItem = await arDocumentService.getOpenItem(ctx, openItemId);
      expect(openItem.outstandingAmount).toBe('0.00');
      expect(openItem.status).toBe('SETTLED');
    });

    it('allocates receipt partially against invoice open item', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const receiptId = await createPostedReceipt('1000.00');

      const alloc = await arAllocationService.allocate(ctx, {
        allocationSourceType: 'RECEIPT',
        receiptId,
        openItemId,
        allocatedAmount: '400.00'
      });

      expect(alloc.allocatedAmount).toBe('400.00');

      const receipt = await arReceiptService.getReceipt(ctx, receiptId);
      expect(receipt.allocatedAmount).toBe('400.00');
      expect(receipt.unappliedAmount).toBe('600.00');

      const openItem = await arDocumentService.getOpenItem(ctx, openItemId);
      expect(openItem.outstandingAmount).toBe('600.00');
      expect(openItem.status).toBe('PARTIALLY_SETTLED');
    });

    it('rejects over-allocation exceeding receipt unapplied amount', async () => {
      const openItemId = await createPostedInvoice('2000.00');
      const receiptId = await createPostedReceipt('500.00');

      await expect(
        arAllocationService.allocate(ctx, {
          allocationSourceType: 'RECEIPT',
          receiptId,
          openItemId,
          allocatedAmount: '600.00'
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('rejects over-allocation exceeding open item outstanding amount', async () => {
      const openItemId = await createPostedInvoice('500.00');
      const receiptId = await createPostedReceipt('1000.00');

      await expect(
        arAllocationService.allocate(ctx, {
          allocationSourceType: 'RECEIPT',
          receiptId,
          openItemId,
          allocatedAmount: '600.00'
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('allows sequential allocations from same receipt to multiple open items', async () => {
      const item1Id = await createPostedInvoice('400.00');
      const item2Id = await createPostedInvoice('600.00');
      const receiptId = await createPostedReceipt('1000.00');

      await arAllocationService.allocate(ctx, {
        allocationSourceType: 'RECEIPT',
        receiptId,
        openItemId: item1Id,
        allocatedAmount: '400.00'
      });

      let receipt = await arReceiptService.getReceipt(ctx, receiptId);
      expect(receipt.unappliedAmount).toBe('600.00');

      await arAllocationService.allocate(ctx, {
        allocationSourceType: 'RECEIPT',
        receiptId,
        openItemId: item2Id,
        allocatedAmount: '600.00'
      });

      receipt = await arReceiptService.getReceipt(ctx, receiptId);
      expect(receipt.allocatedAmount).toBe('1000.00');
      expect(receipt.unappliedAmount).toBe('0.00');

      const item1 = await arDocumentService.getOpenItem(ctx, item1Id);
      const item2 = await arDocumentService.getOpenItem(ctx, item2Id);
      expect(item1.status).toBe('SETTLED');
      expect(item2.status).toBe('SETTLED');
    });

    it('strictly rejects cross-customer receipt allocation', async () => {
      const itemAId = await createPostedInvoice('1000.00', customerIdA);
      const receiptBId = await createPostedReceipt('1000.00', customerIdB);

      await expect(
        arAllocationService.allocate(ctx, {
          allocationSourceType: 'RECEIPT',
          receiptId: receiptBId,
          openItemId: itemAId,
          allocatedAmount: '500.00'
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  describe('3. Credit Note Allocation Lifecycle & Invariants', () => {
    it('allocates credit note against invoice open item', async () => {
      const openItemId = await createPostedInvoice('1500.00');
      const creditNoteId = await createPostedCreditNote('500.00');

      const alloc = await arAllocationService.allocate(ctx, {
        allocationSourceType: 'CREDIT_NOTE',
        creditNoteId,
        openItemId,
        allocatedAmount: '500.00'
      });

      expect(alloc.status).toBe('ACTIVE');
      expect(alloc.allocatedAmount).toBe('500.00');

      // Verify Credit Note balance
      const creditNote = await arDocumentService.getDocument(ctx, creditNoteId);
      expect(creditNote.allocatedAmount).toBe('500.00');
      expect(creditNote.unappliedAmount).toBe('0.00');
      expect(creditNote.status).toBe('SETTLED');

      // Verify Open Item
      const openItem = await arDocumentService.getOpenItem(ctx, openItemId);
      expect(openItem.outstandingAmount).toBe('1000.00');
      expect(openItem.status).toBe('PARTIALLY_SETTLED');
    });

    it('rejects credit note allocation if document is DRAFT', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const draftCn = await arDocumentService.createDraft(ctx, {
        companyId,
        customerId: customerIdA,
        documentType: 'CREDIT_NOTE',
        documentDate: '2025-05-20',
        accountingDate: '2025-05-20',
        dueDate: '2025-05-20',
        lines: [{ description: 'Draft CN', quantity: '1.0000', unitPrice: '500.00', taxableAmount: '500.00', taxRatePercent: '0.000000', cgstAmount: '0.00', sgstAmount: '0.00', igstAmount: '0.00', utgstAmount: '0.00', cessAmount: '0.00', taxAmount: '0.00', grossAmount: '500.00' }]
      });

      await expect(
        arAllocationService.allocate(ctx, {
          allocationSourceType: 'CREDIT_NOTE',
          creditNoteId: draftCn.id,
          openItemId,
          allocatedAmount: '500.00'
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('rejects allocating an INVOICE as a credit note source', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const invoiceDocId = (await arDocumentService.getOpenItem(ctx, openItemId)).arDocumentId!;

      await expect(
        arAllocationService.allocate(ctx, {
          allocationSourceType: 'CREDIT_NOTE',
          creditNoteId: invoiceDocId,
          openItemId,
          allocatedAmount: '500.00'
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('asserts Credit Note does NOT create a row in ar_open_items', async () => {
      const beforeItems = await arDocumentService.getOpenItems(ctx, companyId, { customerId: customerIdA });
      const creditNoteId = await createPostedCreditNote('750.00');
      const afterItems = await arDocumentService.getOpenItems(ctx, companyId, { customerId: customerIdA });

      expect(afterItems.length).toBe(beforeItems.length);
      expect(afterItems.find(i => i.arDocumentId === creditNoteId)).toBeUndefined();
    });

    it('strictly rejects cross-customer credit note allocation', async () => {
      const openItemA = await createPostedInvoice('1000.00', customerIdA);
      const creditNoteB = await createPostedCreditNote('500.00', customerIdB);

      await expect(
        arAllocationService.allocate(ctx, {
          allocationSourceType: 'CREDIT_NOTE',
          creditNoteId: creditNoteB,
          openItemId: openItemA,
          allocatedAmount: '500.00'
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  describe('4. Allocation Reversal Lifecycle', () => {
    it('reverses receipt allocation and perfectly restores balances', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const receiptId = await createPostedReceipt('1000.00');

      const alloc = await arAllocationService.allocate(ctx, {
        allocationSourceType: 'RECEIPT',
        receiptId,
        openItemId,
        allocatedAmount: '600.00'
      });

      // Verify allocated state
      let receipt = await arReceiptService.getReceipt(ctx, receiptId);
      let openItem = await arDocumentService.getOpenItem(ctx, openItemId);
      expect(receipt.unappliedAmount).toBe('400.00');
      expect(openItem.outstandingAmount).toBe('400.00');

      // Reverse allocation
      const reversed = await arAllocationService.reverseAllocation(ctx, {
        allocationId: alloc.id,
        reason: 'Incorrect allocation target'
      });

      expect(reversed.status).toBe('REVERSED');
      expect(reversed.reversedAt).toBeDefined();

      // Verify restored state
      receipt = await arReceiptService.getReceipt(ctx, receiptId);
      openItem = await arDocumentService.getOpenItem(ctx, openItemId);
      expect(receipt.unappliedAmount).toBe('1000.00');
      expect(receipt.allocatedAmount).toBe('0.00');
      expect(openItem.outstandingAmount).toBe('1000.00');
      expect(openItem.status).toBe('OPEN');
    });

    it('reverses credit note allocation and restores balances', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const creditNoteId = await createPostedCreditNote('1000.00');

      const alloc = await arAllocationService.allocate(ctx, {
        allocationSourceType: 'CREDIT_NOTE',
        creditNoteId,
        openItemId,
        allocatedAmount: '1000.00'
      });

      let creditNote = await arDocumentService.getDocument(ctx, creditNoteId);
      let openItem = await arDocumentService.getOpenItem(ctx, openItemId);
      expect(creditNote.status).toBe('SETTLED');
      expect(openItem.status).toBe('SETTLED');

      const reversed = await arAllocationService.reverseAllocation(ctx, {
        allocationId: alloc.id,
        reason: 'Customer requested reversal'
      });

      expect(reversed.status).toBe('REVERSED');

      creditNote = await arDocumentService.getDocument(ctx, creditNoteId);
      openItem = await arDocumentService.getOpenItem(ctx, openItemId);
      expect(creditNote.unappliedAmount).toBe('1000.00');
      expect(creditNote.allocatedAmount).toBe('0.00');
      expect(creditNote.status).toBe('POSTED');
      expect(openItem.outstandingAmount).toBe('1000.00');
      expect(openItem.status).toBe('OPEN');
    });

    it('rejects duplicate reversal of an already reversed allocation', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const receiptId = await createPostedReceipt('1000.00');

      const alloc = await arAllocationService.allocate(ctx, {
        allocationSourceType: 'RECEIPT',
        receiptId,
        openItemId,
        allocatedAmount: '500.00'
      });

      await arAllocationService.reverseAllocation(ctx, { allocationId: alloc.id });

      await expect(
        arAllocationService.reverseAllocation(ctx, { allocationId: alloc.id })
      ).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  describe('5. Concurrency, Idempotency & Rollback', () => {
    it('handles 100 concurrent allocation attempts against the same receipt without over-allocating', async () => {
      const receiptId = await createPostedReceipt('1000.00');

      // Create 15 open items of 100.00 each (total capacity 1500.00)
      const openItemIds: string[] = [];
      for (let i = 0; i < 15; i++) {
        openItemIds.push(await createPostedInvoice('100.00'));
      }

      // Fire 100 concurrent requests of 100.00 each against the receipt
      const promises: Promise<any>[] = [];
      for (let i = 0; i < 100; i++) {
        const targetId = openItemIds[i % openItemIds.length]!;
        promises.push(
          arAllocationService.allocate(ctx, {
            allocationSourceType: 'RECEIPT',
            receiptId,
            openItemId: targetId,
            allocatedAmount: '100.00'
          }).catch(err => err)
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => !(r instanceof Error));
      expect(successful.length).toBe(10); // Exactly 10 x 100.00 = 1000.00 unapplied capacity

      const receipt = await arReceiptService.getReceipt(ctx, receiptId);
      expect(receipt.allocatedAmount).toBe('1000.00');
      expect(receipt.unappliedAmount).toBe('0.00');
      expect(ExactDecimal.parse(receipt.unappliedAmount, 2).isZero()).toBe(true);
    });

    it('handles 100 concurrent allocation attempts against the same open item without negative outstanding balance', async () => {
      const openItemId = await createPostedInvoice('500.00');

      // Create 10 receipts of 100.00 each (total credit capacity 1000.00)
      const receiptIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        receiptIds.push(await createPostedReceipt('100.00'));
      }

      // Fire 100 concurrent requests of 100.00 each against the open item
      const promises: Promise<any>[] = [];
      for (let i = 0; i < 100; i++) {
        const rId = receiptIds[i % receiptIds.length]!;
        promises.push(
          arAllocationService.allocate(ctx, {
            allocationSourceType: 'RECEIPT',
            receiptId: rId,
            openItemId,
            allocatedAmount: '100.00'
          }).catch(err => err)
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => !(r instanceof Error));
      expect(successful.length).toBe(5); // Exactly 5 x 100.00 = 500.00 open item capacity

      const openItem = await arDocumentService.getOpenItem(ctx, openItemId);
      expect(openItem.outstandingAmount).toBe('0.00');
      expect(openItem.status).toBe('SETTLED');
    });

    it('guarantees idempotency when re-submitting with identical idempotencyKey', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const receiptId = await createPostedReceipt('1000.00');
      const idempKey = `idemp_alloc_${Date.now()}`;

      const input: CreateArAllocationInput = {
        allocationSourceType: 'RECEIPT',
        receiptId,
        openItemId,
        allocatedAmount: '300.00',
        idempotencyKey: idempKey
      };

      const res1 = await arAllocationService.allocate(ctx, input);
      const res2 = await arAllocationService.allocate(ctx, input);

      expect(res1.id).toBe(res2.id);

      const receipt = await arReceiptService.getReceipt(ctx, receiptId);
      expect(receipt.allocatedAmount).toBe('300.00');
      expect(receipt.unappliedAmount).toBe('700.00');
    });
  });

  describe('6. Security, Isolation & Authorization', () => {
    it('enforces tenant isolation — rejecting cross-tenant allocation reads', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const receiptId = await createPostedReceipt('1000.00');

      const alloc = await arAllocationService.allocate(ctx, {
        allocationSourceType: 'RECEIPT',
        receiptId,
        openItemId,
        allocatedAmount: '500.00'
      });

      const otherTenantCtx: RequestContext = {
        tenantId: 'tenant_other_hacker',
        companyId,
        user: { id: 'usr_hacker', tenantId: 'tenant_other_hacker', roles: ['ADMIN'], permissions: ['*'] }
      };

      await expect(arAllocationService.getAllocation(otherTenantCtx, alloc.id)).rejects.toThrow(NotFoundError);
    });

    it('enforces RBAC permissions for allocation creation', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const receiptId = await createPostedReceipt('1000.00');

      const restrictedCtx: RequestContext = {
        tenantId,
        companyId,
        user: {
          id: 'usr_view_only',
          tenantId,
          roles: ['VIEWER'],
          permissions: ['ar:allocation:read']
        }
      };

      await expect(
        arAllocationService.allocate(restrictedCtx, {
          allocationSourceType: 'RECEIPT',
          receiptId,
          openItemId,
          allocatedAmount: '500.00'
        })
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('7. Randomized Financial Allocation Verification (200 Scenarios)', () => {
    it('executes 200 randomized allocation flows and maintains 100% exact-decimal invariants', async () => {
      for (let i = 0; i < 200; i++) {
        const grossVal = (Math.floor(Math.random() * 9000) + 1000).toFixed(2); // 1000.00 to 10000.00
        const allocVal = (Math.floor(Math.random() * 500) + 10).toFixed(2); // 10.00 to 510.00

        const isReceipt = i % 2 === 0;

        const openItemId = await createPostedInvoice(grossVal);
        let sourceId: string;

        if (isReceipt) {
          sourceId = await createPostedReceipt(grossVal);
        } else {
          sourceId = await createPostedCreditNote(grossVal);
        }

        const alloc = await arAllocationService.allocate(ctx, {
          allocationSourceType: isReceipt ? 'RECEIPT' : 'CREDIT_NOTE',
          receiptId: isReceipt ? sourceId : undefined,
          creditNoteId: !isReceipt ? sourceId : undefined,
          openItemId,
          allocatedAmount: allocVal
        });

        expect(alloc.allocatedAmount).toBe(allocVal);

        // Verify Invariants
        const openItem = await arDocumentService.getOpenItem(ctx, openItemId);
        const expectedOut = ExactDecimal.parse(grossVal, 2).sub(ExactDecimal.parse(allocVal, 2)).toString();
        expect(openItem.outstandingAmount).toBe(expectedOut);

        if (isReceipt) {
          const receipt = await arReceiptService.getReceipt(ctx, sourceId);
          expect(receipt.allocatedAmount).toBe(allocVal);
          expect(receipt.unappliedAmount).toBe(expectedOut);
          expect(ExactDecimal.parse(receipt.allocatedAmount, 2).add(ExactDecimal.parse(receipt.unappliedAmount, 2)).toString()).toBe(receipt.totalAmount);
        } else {
          const creditNote = await arDocumentService.getDocument(ctx, sourceId);
          expect(creditNote.allocatedAmount).toBe(allocVal);
          expect(creditNote.unappliedAmount).toBe(expectedOut);
          expect(ExactDecimal.parse(creditNote.allocatedAmount, 2).add(ExactDecimal.parse(creditNote.unappliedAmount, 2)).toString()).toBe(creditNote.grossAmount);
        }
      }
    });
  });
});
