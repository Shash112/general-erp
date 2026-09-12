import { describe, it, expect } from 'vitest';
import { ExactDecimal, ValidationError, AccountingError, ErrorCode } from '@general-erp/core';
import { JournalModel, JournalEntryDTO, JournalLineDTO } from '../src/modules/finance/journal-model.js';
import { journalEntries, journalLines, chartOfAccounts, fiscalYears, fiscalPeriods, createDatabaseClient } from '@general-erp/database';
import { eq } from 'drizzle-orm';

describe('Phase 2.3.1 — Journal Model & Scale Validation Tests', () => {

  // 1. ExactDecimal Unit & Precision Tests
  describe('ExactDecimal Arithmetic & Scale Validation', () => {
    it('parses valid 2-decimal scale values correctly', () => {
      const validValues = ['0.00', '0.01', '0.10', '1.00', '1.99', '10.50', '999999999999999999.99'];
      for (const val of validValues) {
        const dec = ExactDecimal.parse(val, 2);
        expect(dec.toString()).toBe(val.includes('.') ? val : `${val}.00`);
      }
    });

    it('rejects values exceeding maxScale = 2 without silent rounding', () => {
      const invalidValues = ['0.001', '1.001', '10.123', '999.999', '12.3456'];
      for (const val of invalidValues) {
        expect(() => ExactDecimal.parse(val, 2)).toThrow(ValidationError);
        expect(() => ExactDecimal.validateScale(val, 2)).toThrow(/exceeds maximum scale of 2 decimal places/);
      }
    });

    it('performs exact addition without floating-point artifacts (0.10 + 0.20 = 0.30)', () => {
      const a = ExactDecimal.parse('0.10', 2);
      const b = ExactDecimal.parse('0.20', 2);
      const sum = a.add(b);
      expect(sum.toString()).toBe('0.30');

      const c = ExactDecimal.parse('100.10', 2);
      const d = ExactDecimal.parse('200.20', 2);
      expect(c.add(d).toString()).toBe('300.30');
    });

    it('supports exact equality comparison', () => {
      const a = ExactDecimal.parse('150.50', 2);
      const b = ExactDecimal.parse('150.50', 2);
      const c = ExactDecimal.parse('150.51', 2);

      expect(a.equals(b)).toBe(true);
      expect(a.equals(c)).toBe(false);
    });
  });

  // 2. Valid Journal Model Validation
  describe('Valid Journal Model Entries', () => {
    const validHeaderBase: Omit<JournalEntryDTO, 'lines' | 'totalDebit' | 'totalCredit'> = {
      tenantId: 'tenant_acme',
      companyId: 'company_hq',
      fiscalYearId: 'fy_2026_27',
      fiscalPeriodId: 'fp_2026_04',
      accountingDate: '2026-04-15',
      sourceModule: 'MANUAL',
      status: 'DRAFT',
      currency: 'INR',
      exchangeRate: '1.000000',
      createdBy: 'user_fin_admin',
      version: 1
    };

    it('validates a standard 1-debit / 1-credit balanced journal entry', () => {
      const journal: JournalEntryDTO = {
        ...validHeaderBase,
        totalDebit: '100.00',
        totalCredit: '100.00',
        lines: [
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_cash_101',
            lineSequence: 1,
            debitAmount: '100.00',
            creditAmount: '0.00'
          },
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_sales_401',
            lineSequence: 2,
            debitAmount: '0.00',
            creditAmount: '100.00'
          }
        ]
      };

      const result = JournalModel.validate(journal);
      expect(result.isValid).toBe(true);
      expect(result.totalDebit).toBe('100.00');
      expect(result.totalCredit).toBe('100.00');
      expect(result.lineCount).toBe(2);
    });

    it('validates a multi-debit / 1-credit balanced journal entry', () => {
      const journal: JournalEntryDTO = {
        ...validHeaderBase,
        totalDebit: '300.50',
        totalCredit: '300.50',
        lines: [
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_bank_102',
            lineSequence: 1,
            debitAmount: '100.00',
            creditAmount: '0.00'
          },
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_tax_103',
            lineSequence: 2,
            debitAmount: '200.50',
            creditAmount: '0.00'
          },
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_revenue_402',
            lineSequence: 3,
            debitAmount: '0.00',
            creditAmount: '300.50'
          }
        ]
      };

      const result = JournalModel.validate(journal);
      expect(result.isValid).toBe(true);
      expect(result.totalDebit).toBe('300.50');
      expect(result.totalCredit).toBe('300.50');
    });

    it('validates balanced lines with precise 2-decimal fractional amounts (12.34 + 87.66 = 100.00)', () => {
      const journal: JournalEntryDTO = {
        ...validHeaderBase,
        totalDebit: '100.00',
        totalCredit: '100.00',
        lines: [
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_expense_501',
            lineSequence: 1,
            debitAmount: '12.34',
            creditAmount: '0.00'
          },
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_expense_502',
            lineSequence: 2,
            debitAmount: '87.66',
            creditAmount: '0.00'
          },
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_payable_201',
            lineSequence: 3,
            debitAmount: '0.00',
            creditAmount: '100.00'
          }
        ]
      };

      const result = JournalModel.validate(journal);
      expect(result.isValid).toBe(true);
      expect(result.totalDebit).toBe('100.00');
    });
  });

  // 3. Invalid Journal Model Rejections
  describe('Invalid Journal Rejections & Invariants Protection', () => {
    const validHeaderBase: Omit<JournalEntryDTO, 'lines' | 'totalDebit' | 'totalCredit'> = {
      tenantId: 'tenant_acme',
      companyId: 'company_hq',
      fiscalYearId: 'fy_2026_27',
      fiscalPeriodId: 'fp_2026_04',
      accountingDate: '2026-04-15',
      sourceModule: 'MANUAL',
      status: 'DRAFT',
      currency: 'INR',
      exchangeRate: '1.000000',
      createdBy: 'user_fin_admin',
      version: 1
    };

    it('rejects an unbalanced journal entry throwing AccountingError', () => {
      const journal: JournalEntryDTO = {
        ...validHeaderBase,
        totalDebit: '300.50',
        totalCredit: '300.49',
        lines: [
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_1',
            lineSequence: 1,
            debitAmount: '300.50',
            creditAmount: '0.00'
          },
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_2',
            lineSequence: 2,
            debitAmount: '0.00',
            creditAmount: '300.49'
          }
        ]
      };

      expect(() => JournalModel.validate(journal)).toThrow(AccountingError);
      try {
        JournalModel.validate(journal);
      } catch (err: any) {
        expect(err.code).toBe(ErrorCode.ACCOUNTING_INVARIANT_VIOLATED);
        expect(err.message).toContain('Unbalanced journal entry');
      }
    });

    it('rejects journal with zero lines', () => {
      const journal: JournalEntryDTO = {
        ...validHeaderBase,
        totalDebit: '0.00',
        totalCredit: '0.00',
        lines: []
      };

      expect(() => JournalModel.validate(journal)).toThrow(ValidationError);
    });

    it('rejects journal line with scale > 2 (0.001) without silent rounding', () => {
      const journal: JournalEntryDTO = {
        ...validHeaderBase,
        totalDebit: '100.00',
        totalCredit: '100.00',
        lines: [
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_1',
            lineSequence: 1,
            debitAmount: '100.001',
            creditAmount: '0.00'
          },
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_2',
            lineSequence: 2,
            debitAmount: '0.00',
            creditAmount: '100.001'
          }
        ]
      };

      expect(() => JournalModel.validate(journal)).toThrow(ValidationError);
      expect(() => JournalModel.validate(journal)).toThrow(/exceeds maximum scale of 2 decimal places/);
    });

    it('rejects negative debit/credit amounts', () => {
      const journal: JournalEntryDTO = {
        ...validHeaderBase,
        totalDebit: '100.00',
        totalCredit: '100.00',
        lines: [
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_1',
            lineSequence: 1,
            debitAmount: '-100.00',
            creditAmount: '0.00'
          },
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_2',
            lineSequence: 2,
            debitAmount: '0.00',
            creditAmount: '-100.00'
          }
        ]
      };

      expect(() => JournalModel.validate(journal)).toThrow(ValidationError);
      expect(() => JournalModel.validate(journal)).toThrow(/cannot be negative/);
    });

    it('rejects zero-value line (both debit and credit zero)', () => {
      const journal: JournalEntryDTO = {
        ...validHeaderBase,
        totalDebit: '0.00',
        totalCredit: '0.00',
        lines: [
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_1',
            lineSequence: 1,
            debitAmount: '0.00',
            creditAmount: '0.00'
          }
        ]
      };

      expect(() => JournalModel.validate(journal)).toThrow(ValidationError);
      expect(() => JournalModel.validate(journal)).toThrow(/both debit and credit amounts equal to zero/);
    });

    it('rejects line with both debit > 0 and credit > 0 simultaneously', () => {
      const journal: JournalEntryDTO = {
        ...validHeaderBase,
        totalDebit: '100.00',
        totalCredit: '100.00',
        lines: [
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_1',
            lineSequence: 1,
            debitAmount: '50.00',
            creditAmount: '50.00'
          }
        ]
      };

      expect(() => JournalModel.validate(journal)).toThrow(ValidationError);
      expect(() => JournalModel.validate(journal)).toThrow(/both debit and credit amounts simultaneously/);
    });

    it('rejects invalid accountingDate format (non-SQL DATE)', () => {
      const journal: JournalEntryDTO = {
        ...validHeaderBase,
        accountingDate: '15/04/2026',
        totalDebit: '100.00',
        totalCredit: '100.00',
        lines: [
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_1',
            lineSequence: 1,
            debitAmount: '100.00',
            creditAmount: '0.00'
          },
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_2',
            lineSequence: 2,
            debitAmount: '0.00',
            creditAmount: '100.00'
          }
        ]
      };

      expect(() => JournalModel.validate(journal)).toThrow(ValidationError);
      expect(() => JournalModel.validate(journal)).toThrow(/Expected SQL DATE format/);
    });

    it('rejects non-INR currency in Phase 2.3 single-currency scope', () => {
      const journal: JournalEntryDTO = {
        ...validHeaderBase,
        currency: 'USD',
        totalDebit: '100.00',
        totalCredit: '100.00',
        lines: [
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_1',
            lineSequence: 1,
            debitAmount: '100.00',
            creditAmount: '0.00'
          },
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_2',
            lineSequence: 2,
            debitAmount: '0.00',
            creditAmount: '100.00'
          }
        ]
      };

      expect(() => JournalModel.validate(journal)).toThrow(ValidationError);
      expect(() => JournalModel.validate(journal)).toThrow(/single-currency mode/);
    });
  });

  // 4. Property & Randomized Balancing Tests
  describe('Randomized Balanced Journal Invariant Property Tests', () => {
    it('verifies 100 randomly generated balanced multi-line journals pass validation', () => {
      for (let run = 0; run < 100; run++) {
        const lineCount = 2 + Math.floor(Math.random() * 6); // 2 to 7 lines
        const lines: JournalLineDTO[] = [];
        let runningDebit = ExactDecimal.ZERO;

        // Generate debit lines
        for (let i = 1; i < lineCount; i++) {
          const randInt = 1 + Math.floor(Math.random() * 50000); // 0.01 to 500.00
          const dec = new ExactDecimal(BigInt(randInt), 2);
          runningDebit = runningDebit.add(dec);

          lines.push({
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: `acc_rand_d_${i}`,
            lineSequence: i,
            debitAmount: dec.toString(),
            creditAmount: '0.00'
          });
        }

        // Single balancing credit line
        lines.push({
          tenantId: 'tenant_acme',
          companyId: 'company_hq',
          accountId: `acc_rand_c_final`,
          lineSequence: lineCount,
          debitAmount: '0.00',
          creditAmount: runningDebit.toString()
        });

        const journal: JournalEntryDTO = {
          tenantId: 'tenant_acme',
          companyId: 'company_hq',
          fiscalYearId: 'fy_2026_27',
          fiscalPeriodId: 'fp_2026_04',
          accountingDate: '2026-04-15',
          sourceModule: 'MANUAL',
          status: 'DRAFT',
          totalDebit: runningDebit.toString(),
          totalCredit: runningDebit.toString(),
          currency: 'INR',
          exchangeRate: '1.000000',
          createdBy: 'prop_test',
          version: 1,
          lines
        };

        const res = JournalModel.validate(journal);
        expect(res.isValid).toBe(true);

        // Mutate credit line by 0.01 and verify rejection
        const mutatedCredit = runningDebit.add(ExactDecimal.parse('0.01', 2));
        journal.lines[lines.length - 1]!.creditAmount = mutatedCredit.toString();
        expect(() => JournalModel.validate(journal)).toThrow(AccountingError);
      }
    });
  });

  // 5. Maximum Precision Boundary & Schema Round-Trip
  describe('Maximum Monetary Precision Boundary numeric(20,2)', () => {
    it('validates maximum supported numeric(20,2) boundary (999999999999999999.99)', () => {
      const maxVal = '999999999999999999.99';
      const dec = ExactDecimal.parse(maxVal, 2);
      expect(dec.toString()).toBe(maxVal);

      const journal: JournalEntryDTO = {
        tenantId: 'tenant_acme',
        companyId: 'company_hq',
        fiscalYearId: 'fy_2026_27',
        fiscalPeriodId: 'fp_2026_04',
        accountingDate: '2026-04-15',
        sourceModule: 'MANUAL',
        status: 'DRAFT',
        totalDebit: maxVal,
        totalCredit: maxVal,
        currency: 'INR',
        exchangeRate: '1.000000',
        createdBy: 'boundary_test',
        version: 1,
        lines: [
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_max_d',
            lineSequence: 1,
            debitAmount: maxVal,
            creditAmount: '0.00'
          },
          {
            tenantId: 'tenant_acme',
            companyId: 'company_hq',
            accountId: 'acc_max_c',
            lineSequence: 2,
            debitAmount: '0.00',
            creditAmount: maxVal
          }
        ]
      };

      const res = JournalModel.validate(journal);
      expect(res.isValid).toBe(true);
      expect(res.totalDebit).toBe(maxVal);
    });
  });
});
