import { describe, it, expect, beforeEach } from 'vitest';
import {
  RequestContext,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  BusinessRuleViolationError,
  AccountingError,
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
import { arAdjustmentService } from '../src/modules/finance/ar/ar-adjustment.service.js';
import {
  CreateArDocumentInput,
  CreateArReceiptInput,
  CreateArAdjustmentInput
} from '../src/modules/finance/ar/index.js';

describe('Phase 2.6.6 — AR Adjustments & Write-offs', () => {
  const tenantId = 'tenant_adj_test';
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
        id: 'usr_ar_adj_admin',
        tenantId,
        roles: ['ACCOUNTANT'],
        permissions: ['*']
      }
    };

    arDocumentService.clear();
    arReceiptService.clear();
    arAllocationService.clear();
    arAdjustmentService.clear();
    fiscalPeriodService.clear();
    chartOfAccountsService.clear();
    accountingConfigurationService.clear();
    masterDataService.clear();

    // Seed Company
    await masterDataService.createCompany(ctx, {
      id: companyId,
      name: 'Alpha Adjustment Company',
      legalName: 'Alpha Adjustment Company Ltd',
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

    const badDebtAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '5200',
      accountName: 'Bad Debt Expense',
      accountType: 'EXPENSE'
    });
    await chartOfAccountsService.activateAccount(ctx, badDebtAccount.id);

    const creditAdjAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '4900',
      accountName: 'AR Credit Adjustment Account',
      accountType: 'INCOME'
    });
    await chartOfAccountsService.activateAccount(ctx, creditAdjAccount.id);

    const debitAdjAccount = await chartOfAccountsService.createAccount(ctx, {
      companyId,
      accountCode: '4100',
      accountName: 'AR Debit Adjustment Revenue',
      accountType: 'INCOME'
    });
    await chartOfAccountsService.activateAccount(ctx, debitAdjAccount.id);

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
      await accountingConfigurationService.setMapping(ctx, {
        companyId,
        eventType: et,
        lineRole: 'REVENUE',
        accountId: revAccount.id
      });
      await accountingConfigurationService.setMapping(ctx, {
        companyId,
        eventType: et,
        lineRole: 'CASH_BANK',
        accountId: bankAccountId
      });
    }

    // Set Adjustment Accounting Mappings
    await accountingConfigurationService.setMapping(ctx, { companyId, eventType: 'AR_ADJUSTMENT', lineRole: 'WRITE_OFF_EXPENSE', accountId: badDebtAccount.id });
    await accountingConfigurationService.setMapping(ctx, { companyId, eventType: 'AR_ADJUSTMENT', lineRole: 'CREDIT_ADJUSTMENT', accountId: creditAdjAccount.id });
    await accountingConfigurationService.setMapping(ctx, { companyId, eventType: 'AR_ADJUSTMENT', lineRole: 'DEBIT_ADJUSTMENT', accountId: debitAdjAccount.id });
    await accountingConfigurationService.setMapping(ctx, { companyId, eventType: 'AR_ADJUSTMENT', lineRole: 'AR_CONTROL', accountId: arAccount.id });

    await accountingConfigurationService.setMapping(ctx, { companyId, eventType: 'AR_ADJUSTMENT_REVERSAL', lineRole: 'WRITE_OFF_EXPENSE', accountId: badDebtAccount.id });
    await accountingConfigurationService.setMapping(ctx, { companyId, eventType: 'AR_ADJUSTMENT_REVERSAL', lineRole: 'CREDIT_ADJUSTMENT', accountId: creditAdjAccount.id });
    await accountingConfigurationService.setMapping(ctx, { companyId, eventType: 'AR_ADJUSTMENT_REVERSAL', lineRole: 'DEBIT_ADJUSTMENT', accountId: debitAdjAccount.id });
    await accountingConfigurationService.setMapping(ctx, { companyId, eventType: 'AR_ADJUSTMENT_REVERSAL', lineRole: 'AR_CONTROL', accountId: arAccount.id });

    // Open Fiscal Periods for 2025-26 and 2026-27
    const { fiscalYear: fy2025 } = await fiscalPeriodService.createFiscalYear(ctx, {
      companyId,
      name: 'FY 2025-26',
      startDate: new Date('2025-04-01T00:00:00.000Z'),
      endDate: new Date('2026-03-31T23:59:59.999Z')
    });
    await fiscalPeriodService.activateFiscalYear(ctx, fy2025.id);

    const { fiscalYear: fy2026 } = await fiscalPeriodService.createFiscalYear(ctx, {
      companyId,
      name: 'FY 2026-27',
      startDate: new Date('2026-04-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T23:59:59.999Z')
    });
    await fiscalPeriodService.activateFiscalYear(ctx, fy2026.id);
  });

  async function createAndPostInvoice(cust: string, grossAmt: string): Promise<string> {
    const input: CreateArDocumentInput = {
      companyId,
      customerId: cust,
      documentType: 'INVOICE',
      documentDate: '2025-05-05',
      accountingDate: '2025-05-05',
      dueDate: '2025-05-25',
      currency: 'INR',
      placeOfSupplyStateCode: '27',
      lines: [
        {
          description: 'Consulting Services',
          quantity: '1.0000',
          unitPrice: grossAmt,
          taxableAmount: grossAmt,
          taxRatePercent: '0.000000',
          cgstAmount: '0.00',
          sgstAmount: '0.00',
          igstAmount: '0.00',
          utgstAmount: '0.00',
          cessAmount: '0.00',
          taxAmount: '0.00',
          grossAmount: grossAmt
        }
      ]
    };
    const draft = await arDocumentService.createDraft(ctx, input);
    const posted = await arDocumentService.postDocument(ctx, draft.id);
    const openItems = await arDocumentService.getOpenItems(ctx, companyId, { customerId: cust });
    const item = openItems.find(i => i.arDocumentId === posted.id);
    return item!.id;
  }

  // ==========================================
  // 1. WRITE-OFF TESTS
  // ==========================================
  describe('Write-Off Processing', () => {
    it('should successfully perform partial write-off on an open item', async () => {
      const openItemId = await createAndPostInvoice(customerIdA, '10000.00');

      const adjInput: CreateArAdjustmentInput = {
        companyId,
        customerId: customerIdA,
        openItemId,
        adjustmentType: 'WRITE_OFF',
        amount: '1000.00',
        reason: 'Uncollectible small balance write-off'
      };

      const draft = await arAdjustmentService.createDraftAdjustment(ctx, adjInput);
      expect(draft.status).toBe('DRAFT');

      const posted = await arAdjustmentService.postAdjustment(ctx, draft.id);
      expect(posted.status).toBe('POSTED');
      expect(posted.journalEntryId).toBeDefined();

      const openItem = await arDocumentService.getOpenItem(ctx, openItemId);
      expect(openItem.outstandingAmount).toBe('9000.00');
      expect(openItem.originalAmount).toBe('10000.00');
      expect(openItem.status).toBe('PARTIALLY_SETTLED');
    });

    it('should successfully perform full write-off and mark open item as SETTLED', async () => {
      const openItemId = await createAndPostInvoice(customerIdA, '5000.00');

      const draft = await arAdjustmentService.createDraftAdjustment(ctx, {
        companyId,
        customerId: customerIdA,
        openItemId,
        adjustmentType: 'WRITE_OFF',
        amount: '5000.00',
        reason: 'Customer bankruptcy full write-off'
      });

      await arAdjustmentService.postAdjustment(ctx, draft.id);

      const openItem = await arDocumentService.getOpenItem(ctx, openItemId);
      expect(openItem.outstandingAmount).toBe('0.00');
      expect(openItem.status).toBe('SETTLED');
    });

    it('should reject write-off exceeding outstanding balance', async () => {
      const openItemId = await createAndPostInvoice(customerIdA, '1000.00');

      await expect(
        arAdjustmentService.createDraftAdjustment(ctx, {
          companyId,
          customerId: customerIdA,
          openItemId,
          adjustmentType: 'WRITE_OFF',
          amount: '1500.00',
          reason: 'Excess write-off attempt'
        })
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('should reject zero, negative, or invalid scale write-offs', async () => {
      const openItemId = await createAndPostInvoice(customerIdA, '1000.00');

      // Zero amount
      await expect(
        arAdjustmentService.createDraftAdjustment(ctx, {
          companyId,
          customerId: customerIdA,
          openItemId,
          adjustmentType: 'WRITE_OFF',
          amount: '0.00',
          reason: 'Zero amount'
        })
      ).rejects.toThrow(ValidationError);

      // Negative amount
      await expect(
        arAdjustmentService.createDraftAdjustment(ctx, {
          companyId,
          customerId: customerIdA,
          openItemId,
          adjustmentType: 'WRITE_OFF',
          amount: '-500.00',
          reason: 'Negative amount'
        })
      ).rejects.toThrow(ValidationError);

      // Scale > 2
      await expect(
        arAdjustmentService.createDraftAdjustment(ctx, {
          companyId,
          customerId: customerIdA,
          openItemId,
          adjustmentType: 'WRITE_OFF',
          amount: '100.005',
          reason: 'Excess scale'
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should enforce customer, tenant, and company isolation', async () => {
      const openItemId = await createAndPostInvoice(customerIdA, '2000.00');

      // Customer mismatch
      await expect(
        arAdjustmentService.createDraftAdjustment(ctx, {
          companyId,
          customerId: customerIdB, // Customer B for Customer A's open item
          openItemId,
          adjustmentType: 'WRITE_OFF',
          amount: '500.00',
          reason: 'Cross-customer test'
        })
      ).rejects.toThrow(BusinessRuleViolationError);

      // Tenant mismatch
      const foreignCtx: RequestContext = {
        ...ctx,
        tenantId: 'tenant_foreign'
      };

      await expect(
        arAdjustmentService.createDraftAdjustment(foreignCtx, {
          companyId,
          customerId: customerIdA,
          openItemId,
          adjustmentType: 'WRITE_OFF',
          amount: '500.00',
          reason: 'Cross-tenant test'
        })
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ==========================================
  // 2. CREDIT & DEBIT ADJUSTMENT TESTS
  // ==========================================
  describe('Credit & Debit Adjustments', () => {
    it('should reduce balance with credit adjustment without mutating original document', async () => {
      const openItemId = await createAndPostInvoice(customerIdA, '3000.00');

      const draft = await arAdjustmentService.createDraftAdjustment(ctx, {
        companyId,
        customerId: customerIdA,
        openItemId,
        adjustmentType: 'CREDIT_ADJUSTMENT',
        amount: '500.00',
        reason: 'Price dispute credit adjustment'
      });

      await arAdjustmentService.postAdjustment(ctx, draft.id);

      const openItem = await arDocumentService.getOpenItem(ctx, openItemId);
      expect(openItem.outstandingAmount).toBe('2500.00');
      expect(openItem.originalAmount).toBe('3000.00');

      // Original document gross amount remains unchanged
      const doc = await arDocumentService.getDocument(ctx, openItem.arDocumentId);
      expect(doc.grossAmount).toBe('3000.00');
    });

    it('should increase balance with debit adjustment', async () => {
      const openItemId = await createAndPostInvoice(customerIdA, '4000.00');

      const draft = await arAdjustmentService.createDraftAdjustment(ctx, {
        companyId,
        customerId: customerIdA,
        openItemId,
        adjustmentType: 'DEBIT_ADJUSTMENT',
        amount: '250.00',
        reason: 'Late payment fee debit adjustment'
      });

      await arAdjustmentService.postAdjustment(ctx, draft.id);

      const openItem = await arDocumentService.getOpenItem(ctx, openItemId);
      expect(openItem.outstandingAmount).toBe('4250.00');
      expect(openItem.originalAmount).toBe('4000.00');
    });
  });

  // ==========================================
  // 3. LIFECYCLE & REVERSAL TESTS
  // ==========================================
  describe('Adjustment Lifecycle & Reversal', () => {
    it('should support posting and append-only reversal of a posted adjustment', async () => {
      const openItemId = await createAndPostInvoice(customerIdA, '8000.00');

      const draft = await arAdjustmentService.createDraftAdjustment(ctx, {
        companyId,
        customerId: customerIdA,
        openItemId,
        adjustmentType: 'WRITE_OFF',
        amount: '2000.00',
        reason: 'Initial write-off'
      });

      const posted = await arAdjustmentService.postAdjustment(ctx, draft.id);
      expect(posted.status).toBe('POSTED');

      let openItem = await arDocumentService.getOpenItem(ctx, openItemId);
      expect(openItem.outstandingAmount).toBe('6000.00');

      const reversed = await arAdjustmentService.reverseAdjustment(ctx, draft.id, {
        adjustmentId: draft.id,
        reason: 'Write-off issued in error'
      });

      expect(reversed.status).toBe('REVERSED');
      expect(reversed.reversedAt).toBeDefined();

      // Original adjustment object status is updated to REVERSED, but record remains append-only
      openItem = await arDocumentService.getOpenItem(ctx, openItemId);
      expect(openItem.outstandingAmount).toBe('8000.00');
      expect(openItem.status).toBe('OPEN');
    });

    it('should return idempotent result on re-posting or re-reversing', async () => {
      const openItemId = await createAndPostInvoice(customerIdA, '1000.00');

      const draft = await arAdjustmentService.createDraftAdjustment(ctx, {
        companyId,
        customerId: customerIdA,
        openItemId,
        adjustmentType: 'CREDIT_ADJUSTMENT',
        amount: '200.00',
        reason: 'Idempotency test'
      });

      const posted1 = await arAdjustmentService.postAdjustment(ctx, draft.id);
      const posted2 = await arAdjustmentService.postAdjustment(ctx, draft.id);
      expect(posted1.id).toBe(posted2.id);

      const reversed1 = await arAdjustmentService.reverseAdjustment(ctx, draft.id, { adjustmentId: draft.id, reason: 'Reversal' });
      const reversed2 = await arAdjustmentService.reverseAdjustment(ctx, draft.id, { adjustmentId: draft.id, reason: 'Reversal' });
      expect(reversed1.id).toBe(reversed2.id);
    });
  });

  // ==========================================
  // 4. ALLOCATION & SETTLEMENT INTERACTION
  // ==========================================
  describe('Allocation & Settlement Interaction', () => {
    it('should calculate derived settlement status correctly after allocation and write-off', async () => {
      const openItemId = await createAndPostInvoice(customerIdA, '1000.00');

      // Create & Post Receipt of 600
      const receiptInput: CreateArReceiptInput = {
        companyId,
        customerId: customerIdA,
        receiptDate: '2025-05-06',
        accountingDate: '2025-05-06',
        paymentMode: 'BANK_TRANSFER',
        bankAccountId,
        totalAmount: '600.00'
      };
      const draftReceipt = await arReceiptService.createDraft(ctx, receiptInput);
      const receipt = await arReceiptService.postReceipt(ctx, draftReceipt.id);

      // Allocate 600 to invoice -> Outstanding = 400
      await arAllocationService.allocate(ctx, {
        allocationSourceType: 'RECEIPT',
        receiptId: receipt.id,
        openItemId,
        allocatedAmount: '600.00'
      });

      let openItem = await arDocumentService.getOpenItem(ctx, openItemId);
      expect(openItem.outstandingAmount).toBe('400.00');

      // Write-off 400 -> Outstanding = 0.00
      const adjDraft = await arAdjustmentService.createDraftAdjustment(ctx, {
        companyId,
        customerId: customerIdA,
        openItemId,
        adjustmentType: 'WRITE_OFF',
        amount: '400.00',
        reason: 'Final settlement write-off'
      });
      await arAdjustmentService.postAdjustment(ctx, adjDraft.id);

      openItem = await arDocumentService.getOpenItem(ctx, openItemId);
      expect(openItem.outstandingAmount).toBe('0.00');
      expect(openItem.status).toBe('SETTLED');

      // Verify ArSettlementService
      const settlement = await arSettlementService.getOpenItemSettlement(ctx, openItemId);
      expect(settlement.outstandingAmount).toBe('0.00');
      expect(settlement.settlementStatus).toBe('SETTLED');

      // Verify Reconciliation passes
      const recon = await arSettlementService.reconcileCompanyAR(ctx, companyId);
      expect(recon.status).toBe('PASS');
      expect(recon.exceptions.length).toBe(0);
    });
  });

  // ==========================================
  // 5. ATOMIC ROLLBACK TEST
  // ==========================================
  describe('Transactional Atomic Rollback', () => {
    it('should roll back open item state and accounting when post fails', async () => {
      const openItemId = await createAndPostInvoice(customerIdA, '5000.00');

      const draft = await arAdjustmentService.createDraftAdjustment(ctx, {
        companyId,
        customerId: customerIdA,
        openItemId,
        adjustmentType: 'WRITE_OFF',
        amount: '1000.00',
        reason: 'Rollback test write-off'
      });

      await expect(
        arAdjustmentService.postAdjustment(ctx, draft.id, {
          adjustmentId: draft.id,
          simulateFailure: true
        })
      ).rejects.toThrow(AccountingError);

      // Open item outstanding remains unchanged
      const openItem = await arDocumentService.getOpenItem(ctx, openItemId);
      expect(openItem.outstandingAmount).toBe('5000.00');

      // Adjustment status remains DRAFT
      const adj = await arAdjustmentService.getAdjustment(ctx, draft.id);
      expect(adj.status).toBe('DRAFT');
    });
  });

  // ==========================================
  // 6. CONCURRENCY STRESS TEST (100 CONCURRENT WRITE-OFFS)
  // ==========================================
  describe('Concurrency Stress Testing', () => {
    it('should safely process 100 concurrent write-offs without over-adjusting or negative balance', async () => {
      const openItemId = await createAndPostInvoice(customerIdA, '1000.00');

      // 100 concurrent write-offs of 20.00 each (Total attempted: 2000.00 against 1000.00 balance)
      const attempts = Array.from({ length: 100 }, (_, i) => i);
      let successCount = 0;
      let failureCount = 0;

      await Promise.all(
        attempts.map(async (i) => {
          try {
            const draft = await arAdjustmentService.createDraftAdjustment(ctx, {
              companyId,
              customerId: customerIdA,
              openItemId,
              adjustmentType: 'WRITE_OFF',
              amount: '20.00',
              reason: `Concurrent write-off #${i}`
            });
            await arAdjustmentService.postAdjustment(ctx, draft.id);
            successCount++;
          } catch (err) {
            failureCount++;
          }
        })
      );

      const openItem = await arDocumentService.getOpenItem(ctx, openItemId);
      const outDec = ExactDecimal.parse(openItem.outstandingAmount, 2);

      // Out of 100 attempts of 20.00, exactly 50 must succeed (50 * 20.00 = 1000.00)
      expect(successCount).toBe(50);
      expect(failureCount).toBe(50);
      expect(outDec.toString()).toBe('0.00');
      expect(outDec.isNegative()).toBe(false);

      // Subledger reconciliation must pass
      const recon = await arSettlementService.reconcileCompanyAR(ctx, companyId);
      expect(recon.status).toBe('PASS');
    });
  });

  // ==========================================
  // 7. 200 RANDOMIZED FINANCIAL SCENARIOS
  // ==========================================
  describe('200 Randomized Financial Scenarios', () => {
    it('should satisfy unified outstanding formula and non-negative invariant across 200 randomized adjustment sequences', async () => {
      for (let i = 0; i < 200; i++) {
        // Generate random original amount between 100.00 and 10000.00
        const origInt = Math.floor(Math.random() * 9900) + 100;
        const origStr = `${origInt}.00`;

        const openItemId = await createAndPostInvoice(customerIdA, origStr);

        let expectedOutstanding = ExactDecimal.parse(origStr, 2);
        let activeAllocations = ExactDecimal.ZERO;
        let activeWriteOffs = ExactDecimal.ZERO;
        let activeCreditAdjs = ExactDecimal.ZERO;
        let activeDebitAdjs = ExactDecimal.ZERO;

        // Perform 3-5 random operations
        const opCount = Math.floor(Math.random() * 3) + 3;
        for (let op = 0; op < opCount; op++) {
          const randType = Math.random();

          if (randType < 0.4 && expectedOutstanding.isPositive()) {
            // WRITE_OFF
            const maxAmt = Math.floor(parseFloat(expectedOutstanding.toString()));
            if (maxAmt > 0) {
              const amt = Math.floor(Math.random() * maxAmt) + 1;
              const amtStr = `${amt}.00`;
              const draft = await arAdjustmentService.createDraftAdjustment(ctx, {
                companyId,
                customerId: customerIdA,
                openItemId,
                adjustmentType: 'WRITE_OFF',
                amount: amtStr,
                reason: `Rand WO ${i}-${op}`
              });
              await arAdjustmentService.postAdjustment(ctx, draft.id);
              const amtDec = ExactDecimal.parse(amtStr, 2);
              expectedOutstanding = expectedOutstanding.sub(amtDec);
              activeWriteOffs = activeWriteOffs.add(amtDec);
            }
          } else if (randType < 0.7 && expectedOutstanding.isPositive()) {
            // CREDIT_ADJUSTMENT
            const maxAmt = Math.floor(parseFloat(expectedOutstanding.toString()));
            if (maxAmt > 0) {
              const amt = Math.floor(Math.random() * maxAmt) + 1;
              const amtStr = `${amt}.00`;
              const draft = await arAdjustmentService.createDraftAdjustment(ctx, {
                companyId,
                customerId: customerIdA,
                openItemId,
                adjustmentType: 'CREDIT_ADJUSTMENT',
                amount: amtStr,
                reason: `Rand Credit ${i}-${op}`
              });
              await arAdjustmentService.postAdjustment(ctx, draft.id);
              const amtDec = ExactDecimal.parse(amtStr, 2);
              expectedOutstanding = expectedOutstanding.sub(amtDec);
              activeCreditAdjs = activeCreditAdjs.add(amtDec);
            }
          } else {
            // DEBIT_ADJUSTMENT
            const amt = Math.floor(Math.random() * 500) + 1;
            const amtStr = `${amt}.00`;
            const draft = await arAdjustmentService.createDraftAdjustment(ctx, {
              companyId,
              customerId: customerIdA,
              openItemId,
              adjustmentType: 'DEBIT_ADJUSTMENT',
              amount: amtStr,
              reason: `Rand Debit ${i}-${op}`
            });
            await arAdjustmentService.postAdjustment(ctx, draft.id);
            const amtDec = ExactDecimal.parse(amtStr, 2);
            expectedOutstanding = expectedOutstanding.add(amtDec);
            activeDebitAdjs = activeDebitAdjs.add(amtDec);
          }
        }

        // Verify Invariants
        const openItem = await arDocumentService.getOpenItem(ctx, openItemId);
        const actualDec = ExactDecimal.parse(openItem.outstandingAmount, 2);

        expect(actualDec.isNegative()).toBe(false);
        expect(actualDec.equals(expectedOutstanding)).toBe(true);

        const calculatedFormula = ExactDecimal.parse(origStr, 2)
          .sub(activeAllocations)
          .sub(activeWriteOffs)
          .sub(activeCreditAdjs)
          .add(activeDebitAdjs);

        expect(actualDec.equals(calculatedFormula)).toBe(true);
      }
    });
  });
});
