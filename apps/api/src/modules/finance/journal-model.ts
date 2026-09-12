import { ValidationError, AccountingError, ExactDecimal } from '@general-erp/core';

export type JournalEntryStatus = 'DRAFT' | 'POSTED' | 'CANCELLED';

export interface JournalLineDTO {
  id?: string | undefined;
  tenantId: string;
  companyId: string;
  journalEntryId?: string | undefined;
  accountId: string;
  lineSequence: number;
  debitAmount: string;          // Formatted decimal e.g. "100.00"
  creditAmount: string;         // Formatted decimal e.g. "0.00"
  currency?: string | undefined; // ISO-4217, default 'INR'
  exchangeRate?: string | undefined; // Default '1.000000'
  baseDebitAmount?: string | undefined;
  baseCreditAmount?: string | undefined;
  narration?: string | null | undefined;
  partyType?: string | null | undefined;
  partyId?: string | null | undefined;
  branchId?: string | null | undefined;
  departmentId?: string | null | undefined;
  createdAt?: Date | undefined;
}

export interface JournalEntryDTO {
  id?: string | undefined;
  tenantId: string;
  companyId: string;
  voucherNumber?: string | null | undefined; // NULL for DRAFT, allocated on POSTED
  fiscalYearId: string;
  fiscalPeriodId: string;
  accountingDate: string;       // SQL DATE format "YYYY-MM-DD"
  postingDate?: Date | null | undefined;
  sourceModule: string;        // e.g. 'MANUAL', 'SALES', 'PROCUREMENT'
  sourceDocumentType?: string | null | undefined;
  sourceDocumentId?: string | null | undefined;
  originalJournalId?: string | null | undefined;
  status: JournalEntryStatus;
  totalDebit: string;
  totalCredit: string;
  currency: string;
  exchangeRate: string;
  narration?: string | null | undefined;
  createdBy: string;
  postedBy?: string | null | undefined;
  postedAt?: Date | null | undefined;
  version: number;
  createdAt?: Date | undefined;
  updatedAt?: Date | undefined;
  lines: JournalLineDTO[];
}

export interface JournalValidationResult {
  isValid: boolean;
  totalDebit: string;
  totalCredit: string;
  lineCount: number;
}

export class JournalModel {
  /**
   * Calculates exact sum of line debits and credits without floating-point operations.
   */
  public static calculateTotals(lines: JournalLineDTO[]): { totalDebit: ExactDecimal; totalCredit: ExactDecimal } {
    let totalDebit = new ExactDecimal(0n, 2);
    let totalCredit = new ExactDecimal(0n, 2);

    for (const line of lines) {
      ExactDecimal.validateScale(line.debitAmount, 2);
      ExactDecimal.validateScale(line.creditAmount, 2);

      const debit = ExactDecimal.parse(line.debitAmount, 2);
      const credit = ExactDecimal.parse(line.creditAmount, 2);

      totalDebit = totalDebit.add(debit);
      totalCredit = totalCredit.add(credit);
    }

    return { totalDebit, totalCredit };
  }

  /**
   * Validates a complete JournalEntryDTO against Phase 2.3 monetary policy, line invariants,
   * tenant/company boundaries, single-currency scope, and exact debit/credit balancing.
   */
  public static validate(journal: JournalEntryDTO): JournalValidationResult {
    // 1. Header Basic Fields
    if (!journal.tenantId || journal.tenantId.trim() === '') {
      throw new ValidationError('Journal header tenantId must be non-empty.');
    }

    if (!journal.companyId || journal.companyId.trim() === '') {
      throw new ValidationError('Journal header companyId must be non-empty.');
    }

    if (!journal.accountingDate || !/^\d{4}-\d{2}-\d{2}$/.test(journal.accountingDate)) {
      throw new ValidationError(
        `Invalid accountingDate format: '${journal.accountingDate}'. Expected SQL DATE format 'YYYY-MM-DD'.`
      );
    }

    const validStatuses: JournalEntryStatus[] = ['DRAFT', 'POSTED', 'CANCELLED'];
    if (!validStatuses.includes(journal.status)) {
      throw new ValidationError(`Invalid journal status: '${journal.status}'. Expected DRAFT, POSTED, or CANCELLED.`);
    }

    // Phase 2.3 Single-Currency Boundary Check
    if (journal.currency !== 'INR') {
      throw new ValidationError(`Phase 2.3 General Ledger operates in single-currency mode. Currency must be 'INR', received '${journal.currency}'.`);
    }

    const rateDec = ExactDecimal.parse(journal.exchangeRate, 6);
    if (!rateDec.equals(ExactDecimal.parse('1.000000', 6))) {
      throw new ValidationError(`Phase 2.3 General Ledger operates in single-currency mode. Exchange rate must be '1.000000', received '${journal.exchangeRate}'.`);
    }

    // 2. Lines Array Boundary
    if (!Array.isArray(journal.lines) || journal.lines.length === 0) {
      throw new ValidationError('Journal entry must contain at least one journal line.');
    }

    const seenSequences = new Set<number>();

    // 3. Line-by-Line Invariants Verification
    for (let i = 0; i < journal.lines.length; i++) {
      const line = journal.lines[i]!;

      // Context Boundary Alignment
      if (line.tenantId !== journal.tenantId || line.companyId !== journal.companyId) {
        throw new ValidationError(
          `Journal line [index ${i}] tenantId/companyId (${line.tenantId}/${line.companyId}) does not match header context (${journal.tenantId}/${journal.companyId}).`
        );
      }

      // Line Sequence Validation
      if (!Number.isInteger(line.lineSequence) || line.lineSequence <= 0) {
        throw new ValidationError(`Journal line [index ${i}] lineSequence must be a positive integer.`);
      }

      if (seenSequences.has(line.lineSequence)) {
        throw new ValidationError(`Duplicate lineSequence ${line.lineSequence} found in journal lines.`);
      }
      seenSequences.add(line.lineSequence);

      if (!line.accountId || line.accountId.trim() === '') {
        throw new ValidationError(`Journal line [index ${i}] accountId must be non-empty.`);
      }

      // Scale Validation (Scale <= 2)
      ExactDecimal.validateScale(line.debitAmount, 2);
      ExactDecimal.validateScale(line.creditAmount, 2);

      const debit = ExactDecimal.parse(line.debitAmount, 2);
      const credit = ExactDecimal.parse(line.creditAmount, 2);

      // Non-Negative Check
      if (debit.isNegative()) {
        throw new ValidationError(`Journal line [index ${i}] debit amount cannot be negative: '${line.debitAmount}'.`);
      }
      if (credit.isNegative()) {
        throw new ValidationError(`Journal line [index ${i}] credit amount cannot be negative: '${line.creditAmount}'.`);
      }

      // Zero-Value Line Check
      if (debit.isZero() && credit.isZero()) {
        throw new ValidationError(`Journal line [index ${i}] cannot have both debit and credit amounts equal to zero.`);
      }

      // Debit/Credit XOR Check
      if (debit.isPositive() && credit.isPositive()) {
        throw new ValidationError(
          `Journal line [index ${i}] cannot contain both debit and credit amounts simultaneously (Debit: ${line.debitAmount}, Credit: ${line.creditAmount}).`
        );
      }
    }

    // 4. Exact Debit/Credit Balancing
    const { totalDebit, totalCredit } = JournalModel.calculateTotals(journal.lines);

    if (!totalDebit.equals(totalCredit)) {
      throw new AccountingError(
        `Unbalanced journal entry: Total debits (${totalDebit.toString()}) must equal total credits (${totalCredit.toString()}).`
      );
    }

    // 5. Header Totals Reconciliation
    if (journal.totalDebit) {
      ExactDecimal.validateScale(journal.totalDebit, 2);
      const headerTotalDebit = ExactDecimal.parse(journal.totalDebit, 2);
      if (!headerTotalDebit.equals(totalDebit)) {
        throw new AccountingError(
          `Header totalDebit (${journal.totalDebit}) does not match sum of line debits (${totalDebit.toString()}).`
        );
      }
    }

    if (journal.totalCredit) {
      ExactDecimal.validateScale(journal.totalCredit, 2);
      const headerTotalCredit = ExactDecimal.parse(journal.totalCredit, 2);
      if (!headerTotalCredit.equals(totalCredit)) {
        throw new AccountingError(
          `Header totalCredit (${journal.totalCredit}) does not match sum of line credits (${totalCredit.toString()}).`
        );
      }
    }

    return {
      isValid: true,
      totalDebit: totalDebit.toString(),
      totalCredit: totalCredit.toString(),
      lineCount: journal.lines.length
    };
  }
}
