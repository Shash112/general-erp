import { describe, it, expect, beforeEach } from 'vitest';
import {
  RequestContext,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ExactDecimal
} from '@general-erp/core';
import { masterDataService } from '../src/platform/master-data/master-data.service.js';
import { chartOfAccountsService } from '../src/modules/finance/chart-of-accounts.service.js';
import { fiscalPeriodService } from '../src/modules/finance/fiscal-period.service.js';
import { accountingConfigurationService } from '../src/modules/finance/accounting-core.service.js';
import { arDocumentService } from '../src/modules/finance/ar/ar-document.service.js';
import { arReceiptService } from '../src/modules/finance/ar/ar-receipt.service.js';
import { arAllocationService } from '../src/modules/finance/ar/ar-allocation.service.js';
import { arSettlementService } from '../src/modules/finance/ar/ar-settlement.service.js';
import {
  CreateArDocumentInput,
  CreateArReceiptInput
} from '../src/modules/finance/ar/index.js';

describe('Phase 2.6.5 — AR Settlement & Reconciliation Engine', () => {
  const tenantId = 'tenant_settle_test';
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
        id: 'usr_ar_settle_admin',
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
      name: 'Alpha Settlement Company',
      legalName: 'Alpha Settlement Company Ltd',
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

  describe('1. Open Item Settlement State Determination', () => {
    it('evaluates OPEN status for unallocated open item', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const settlement = await arSettlementService.getOpenItemSettlement(ctx, openItemId);

      expect(settlement.settlementStatus).toBe('OPEN');
      expect(settlement.originalAmount).toBe('1000.00');
      expect(settlement.activeAllocationsTotal).toBe('0.00');
      expect(settlement.outstandingAmount).toBe('1000.00');
    });

    it('evaluates PARTIALLY_SETTLED status for partially allocated open item', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const receiptId = await createPostedReceipt('1000.00');

      await arAllocationService.allocate(ctx, {
        allocationSourceType: 'RECEIPT',
        receiptId,
        openItemId,
        allocatedAmount: '400.00'
      });

      const settlement = await arSettlementService.getOpenItemSettlement(ctx, openItemId);

      expect(settlement.settlementStatus).toBe('PARTIALLY_SETTLED');
      expect(settlement.activeAllocationsTotal).toBe('400.00');
      expect(settlement.outstandingAmount).toBe('600.00');
    });

    it('evaluates SETTLED status for fully allocated open item', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const receiptId = await createPostedReceipt('1000.00');

      await arAllocationService.allocate(ctx, {
        allocationSourceType: 'RECEIPT',
        receiptId,
        openItemId,
        allocatedAmount: '1000.00'
      });

      const settlement = await arSettlementService.getOpenItemSettlement(ctx, openItemId);

      expect(settlement.settlementStatus).toBe('SETTLED');
      expect(settlement.activeAllocationsTotal).toBe('1000.00');
      expect(settlement.outstandingAmount).toBe('0.00');
    });

    it('restores OPEN settlement status after allocation reversal', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const receiptId = await createPostedReceipt('1000.00');

      const alloc = await arAllocationService.allocate(ctx, {
        allocationSourceType: 'RECEIPT',
        receiptId,
        openItemId,
        allocatedAmount: '1000.00'
      });

      await arAllocationService.reverseAllocation(ctx, { allocationId: alloc.id });

      const settlement = await arSettlementService.getOpenItemSettlement(ctx, openItemId);

      expect(settlement.settlementStatus).toBe('OPEN');
      expect(settlement.activeAllocationsTotal).toBe('0.00');
      expect(settlement.outstandingAmount).toBe('1000.00');
    });
  });

  describe('2. Source Utilization Determination', () => {
    it('evaluates FULLY_UNAPPLIED utilization for unallocated receipt', async () => {
      const receiptId = await createPostedReceipt('1500.00');
      const util = await arSettlementService.getSourceUtilization(ctx, 'RECEIPT', receiptId);

      expect(util.utilizationStatus).toBe('FULLY_UNAPPLIED');
      expect(util.totalOrGrossAmount).toBe('1500.00');
      expect(util.activeAllocationsTotal).toBe('0.00');
      expect(util.unappliedAmount).toBe('1500.00');
    });

    it('evaluates PARTIALLY_APPLIED utilization for partially allocated receipt', async () => {
      const openItemId = await createPostedInvoice('1000.00');
      const receiptId = await createPostedReceipt('1500.00');

      await arAllocationService.allocate(ctx, {
        allocationSourceType: 'RECEIPT',
        receiptId,
        openItemId,
        allocatedAmount: '500.00'
      });

      const util = await arSettlementService.getSourceUtilization(ctx, 'RECEIPT', receiptId);

      expect(util.utilizationStatus).toBe('PARTIALLY_APPLIED');
      expect(util.activeAllocationsTotal).toBe('500.00');
      expect(util.unappliedAmount).toBe('1000.00');
    });

    it('evaluates FULLY_APPLIED utilization for fully allocated credit note', async () => {
      const openItemId = await createPostedInvoice('500.00');
      const creditNoteId = await createPostedCreditNote('500.00');

      await arAllocationService.allocate(ctx, {
        allocationSourceType: 'CREDIT_NOTE',
        creditNoteId,
        openItemId,
        allocatedAmount: '500.00'
      });

      const util = await arSettlementService.getSourceUtilization(ctx, 'CREDIT_NOTE', creditNoteId);

      expect(util.utilizationStatus).toBe('FULLY_APPLIED');
      expect(util.activeAllocationsTotal).toBe('500.00');
      expect(util.unappliedAmount).toBe('0.00');
    });
  });

  describe('3. Customer-Level Receivable Settlement Aggregation', () => {
    it('calculates gross receivables, unapplied credits, and net balance using ExactDecimal', async () => {
      // Invoices: 2000.00 + 3000.00 = 5000.00 gross
      await createPostedInvoice('2000.00', customerIdA);
      const item2Id = await createPostedInvoice('3000.00', customerIdA);

      // Receipt: 1500.00 (allocate 500.00 to item2 -> unapplied 1000.00)
      const receiptId = await createPostedReceipt('1500.00', customerIdA);
      await arAllocationService.allocate(ctx, {
        allocationSourceType: 'RECEIPT',
        receiptId,
        openItemId: item2Id,
        allocatedAmount: '500.00'
      });

      // Credit Note: 500.00 (unapplied 500.00)
      await createPostedCreditNote('500.00', customerIdA);

      const summary = await arSettlementService.getCustomerSettlementSummary(ctx, companyId, customerIdA);

      // Gross receivables: 2000.00 + (3000.00 - 500.00) = 4500.00
      expect(summary.totalGrossReceivables).toBe('4500.00');
      // Unapplied credits: 1000.00 (receipt) + 500.00 (credit note) = 1500.00
      expect(summary.totalUnappliedCredits).toBe('1500.00');
      // Net outstanding: 4500.00 - 1500.00 = 3000.00
      expect(summary.netOutstandingReceivable).toBe('3000.00');
      expect(summary.openItemsCount).toBe(2);
    });
  });

  describe('4. Non-Destructive Subledger Reconciliation Engine', () => {
    it('returns PASS status for consistent subledger records', async () => {
      const openItemId = await createPostedInvoice('2000.00');
      const receiptId = await createPostedReceipt('2000.00');

      await arAllocationService.allocate(ctx, {
        allocationSourceType: 'RECEIPT',
        receiptId,
        openItemId,
        allocatedAmount: '1200.00'
      });

      const result = await arSettlementService.reconcileCompanyAR(ctx, companyId);

      expect(result.status).toBe('PASS');
      expect(result.exceptions.length).toBe(0);
      expect(result.openItemsChecked).toBeGreaterThan(0);
      expect(result.receiptsChecked).toBeGreaterThan(0);
    });

    it('detects SOURCE_BALANCE_MISMATCH when receipt unapplied amount is corrupted', async () => {
      const receiptId = await createPostedReceipt('1000.00');

      // Corrupt receipt unapplied balance directly in service store (simulating data corruption)
      await arReceiptService.updateReceiptBalance(ctx, receiptId, '999.00', '0.00');

      const result = await arSettlementService.reconcileCompanyAR(ctx, companyId);

      expect(result.status).toBe('FAIL');
      expect(result.exceptions.some(e => e.code === 'SOURCE_BALANCE_MISMATCH' && e.entityId === receiptId)).toBe(true);
    });

    it('detects OPEN_ITEM_BALANCE_MISMATCH when open item outstanding amount is corrupted', async () => {
      const openItemId = await createPostedInvoice('1000.00');

      // Corrupt open item outstanding balance directly in service store
      await arDocumentService.updateOpenItemBalance(ctx, openItemId, '888.00', 'PARTIALLY_SETTLED');

      const result = await arSettlementService.reconcileCompanyAR(ctx, companyId);

      expect(result.status).toBe('FAIL');
      expect(result.exceptions.some(e => e.code === 'OPEN_ITEM_BALANCE_MISMATCH' && e.entityId === openItemId)).toBe(true);
    });

    it('verifies No Silent Repair rule — surfaced exception leaves corrupted store untouched', async () => {
      const receiptId = await createPostedReceipt('1000.00');
      await arReceiptService.updateReceiptBalance(ctx, receiptId, '777.00', '0.00');

      const result = await arSettlementService.reconcileCompanyAR(ctx, companyId);
      expect(result.status).toBe('FAIL');

      // Verify the receipt remains corrupted (no silent repair happened)
      const receiptAfter = await arReceiptService.getReceipt(ctx, receiptId);
      expect(receiptAfter.unappliedAmount).toBe('777.00');
    });
  });

  describe('5. High-Concurrency Stress & Reconciliation Safety', () => {
    it('executes 100 allocations, 100 settlement reads, and 100 reconciliation calls concurrently without errors', async () => {
      const openItemId = await createPostedInvoice('10000.00');

      const receiptIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        receiptIds.push(await createPostedReceipt('1000.00'));
      }

      const tasks: Promise<any>[] = [];

      // 100 allocations (each 50.00)
      for (let i = 0; i < 100; i++) {
        const rId = receiptIds[i % receiptIds.length]!;
        tasks.push(
          arAllocationService.allocate(ctx, {
            allocationSourceType: 'RECEIPT',
            receiptId: rId,
            openItemId,
            allocatedAmount: '50.00'
          }).catch(err => err)
        );
      }

      // 100 settlement reads
      for (let i = 0; i < 100; i++) {
        tasks.push(arSettlementService.getOpenItemSettlement(ctx, openItemId));
      }

      // 100 reconciliation calls
      for (let i = 0; i < 100; i++) {
        tasks.push(arSettlementService.reconcileCompanyAR(ctx, companyId));
      }

      const results = await Promise.all(tasks);
      const errors = results.filter(r => r instanceof Error && !(r instanceof BusinessRuleViolationError));
      expect(errors.length).toBe(0);

      const finalRecon = await arSettlementService.reconcileCompanyAR(ctx, companyId);
      expect(finalRecon.status).toBe('PASS');
    });
  });

  describe('6. Security & Tenant Isolation', () => {
    it('enforces tenant isolation for settlement queries', async () => {
      const openItemId = await createPostedInvoice('1000.00');

      const otherTenantCtx: RequestContext = {
        tenantId: 'tenant_other_hacker',
        companyId,
        user: { id: 'usr_hacker', tenantId: 'tenant_other_hacker', roles: ['ADMIN'], permissions: ['*'] }
      };

      await expect(arSettlementService.getOpenItemSettlement(otherTenantCtx, openItemId)).rejects.toThrow(NotFoundError);
    });

    it('enforces RBAC permissions for reconciliation', async () => {
      const restrictedCtx: RequestContext = {
        tenantId,
        companyId,
        user: {
          id: 'usr_view_only',
          tenantId,
          roles: ['VIEWER'],
          permissions: ['ar:settlement:read']
        }
      };

      await expect(arSettlementService.reconcileCompanyAR(restrictedCtx, companyId)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('7. Randomized Settlement & Reconciliation Verification (200 Scenarios)', () => {
    it('executes 200 randomized settlement flows and asserts 100% reconciliation pass', async () => {
      for (let i = 0; i < 200; i++) {
        const invoiceAmt = (Math.floor(Math.random() * 5000) + 1000).toFixed(2);
        const receiptAmt = (Math.floor(Math.random() * 5000) + 1000).toFixed(2);
        const allocAmt = (Math.floor(Math.random() * 500) + 10).toFixed(2);

        const openItemId = await createPostedInvoice(invoiceAmt);
        const receiptId = await createPostedReceipt(receiptAmt);

        await arAllocationService.allocate(ctx, {
          allocationSourceType: 'RECEIPT',
          receiptId,
          openItemId,
          allocatedAmount: allocAmt
        });

        const recon = await arSettlementService.reconcileCompanyAR(ctx, companyId);
        expect(recon.status).toBe('PASS');
        expect(recon.exceptions.length).toBe(0);
      }
    });
  });
});
