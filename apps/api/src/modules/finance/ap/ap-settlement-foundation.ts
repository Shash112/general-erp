import {
  ValidationError,
  ExactDecimal
} from '@general-erp/core';
import {
  ApOpenItemSettlementStatus,
  ApSourceUtilizationStatus,
  ApReconciliationStatus
} from './ap-settlement-model.js';
import type pg from 'pg';

export class ApSettlementFoundation {
  /**
   * Pure primitive to calculate derived open item settlement status from ExactDecimal amounts.
   */
  public static calculateSettlementStatus(originalAmount: string, outstandingAmount: string): ApOpenItemSettlementStatus {
    ExactDecimal.validateScale(originalAmount, 2);
    ExactDecimal.validateScale(outstandingAmount, 2);

    const origDec = ExactDecimal.parse(originalAmount, 2);
    const outDec = ExactDecimal.parse(outstandingAmount, 2);

    if (!origDec.isPositive()) {
      throw new ValidationError(`Original amount must be positive (> 0.00). Provided: '${originalAmount}'.`);
    }

    if (outDec.isNegative()) {
      throw new ValidationError(`Outstanding amount cannot be negative (< 0.00). Provided: '${outstandingAmount}'.`);
    }

    if (outDec.compare(origDec) > 0) {
      throw new ValidationError(
        `Outstanding amount '${outstandingAmount}' cannot exceed original amount '${originalAmount}'.`
      );
    }

    if (outDec.equals(origDec)) {
      return 'OPEN';
    }

    if (outDec.isZero()) {
      return 'SETTLED';
    }

    return 'PARTIALLY_SETTLED';
  }

  /**
   * Pure primitive to calculate derived source utilization status for payments & credit notes.
   */
  public static calculateSourceUtilization(
    allocatedAmount: string,
    unappliedAmount: string,
    totalAmount: string
  ): ApSourceUtilizationStatus {
    ExactDecimal.validateScale(allocatedAmount, 2);
    ExactDecimal.validateScale(unappliedAmount, 2);
    ExactDecimal.validateScale(totalAmount, 2);

    const allocDec = ExactDecimal.parse(allocatedAmount, 2);
    const unappDec = ExactDecimal.parse(unappliedAmount, 2);
    const totalDec = ExactDecimal.parse(totalAmount, 2);

    if (allocDec.isNegative() || unappDec.isNegative()) {
      throw new ValidationError(
        `Allocated ('${allocatedAmount}') and unapplied ('${unappliedAmount}') amounts cannot be negative.`
      );
    }

    const sumDec = allocDec.add(unappDec);
    if (!sumDec.equals(totalDec)) {
      throw new ValidationError(
        `Source utilization invariant failed: allocated ('${allocatedAmount}') + unapplied ('${unappliedAmount}') != total ('${totalAmount}').`
      );
    }

    if (allocDec.isZero()) {
      return 'FULLY_UNAPPLIED';
    }

    if (unappDec.isZero()) {
      return 'FULLY_APPLIED';
    }

    return 'PARTIALLY_APPLIED';
  }

  /**
   * Pure primitive to calculate signed net supplier payable exposure.
   * Net Payable = Outstanding Bills - Unapplied Payments - Unapplied Credit Notes
   * Returns signed exact-decimal string (> 0 = Net Payable, = 0 = Balanced, < 0 = Supplier Credit/Advance).
   */
  public static calculateNetSupplierPayable(
    totalOutstandingBills: string,
    totalUnappliedPayments: string,
    totalUnappliedCreditNotes: string
  ): string {
    ExactDecimal.validateScale(totalOutstandingBills, 2);
    ExactDecimal.validateScale(totalUnappliedPayments, 2);
    ExactDecimal.validateScale(totalUnappliedCreditNotes, 2);

    const outDec = ExactDecimal.parse(totalOutstandingBills, 2);
    const payDec = ExactDecimal.parse(totalUnappliedPayments, 2);
    const cnDec = ExactDecimal.parse(totalUnappliedCreditNotes, 2);

    const netPayableDec = outDec.sub(payDec).sub(cnDec);
    return netPayableDec.toString();
  }

  /**
   * Pure primitive to calculate signed reconciliation difference & status between subledger and GL.
   * Difference = Subledger Net Payable - GL AP_CONTROL Signed Balance (Credits - Debits)
   */
  public static calculateReconciliationDifference(
    subledgerNetPayable: string,
    glApControlSignedBalance: string
  ): { difference: string; status: ApReconciliationStatus } {
    ExactDecimal.validateScale(subledgerNetPayable, 2);
    ExactDecimal.validateScale(glApControlSignedBalance, 2);

    const subledgerDec = ExactDecimal.parse(subledgerNetPayable, 2);
    const glSignedDec = ExactDecimal.parse(glApControlSignedBalance, 2);

    const diffDec = subledgerDec.sub(glSignedDec);
    const status: ApReconciliationStatus = diffDec.isZero() ? 'PASS' : 'FAIL';

    return {
      difference: diffDec.toString(),
      status
    };
  }

  /**
   * Helper to check if a transaction accounting date is effective on or before asOfDate.
   */
  public static isTransactionEffectiveAsOf(accountingDate: string, asOfDate?: string | undefined): boolean {
    if (!asOfDate || asOfDate.trim() === '') {
      return true;
    }
    return accountingDate <= asOfDate;
  }

  /**
   * Helper to check if an allocation date is effective on or before asOfDate.
   */
  public static isAllocationEffectiveAsOf(allocationDate: string, asOfDate?: string | undefined): boolean {
    if (!asOfDate || asOfDate.trim() === '') {
      return true;
    }
    return allocationDate <= asOfDate;
  }

  /**
   * Helper to check if a reversal accounting date has taken effect on or before asOfDate.
   * For asOfDate < reversalAccountingDate: Reversal is NOT effective yet (returns false).
   * For asOfDate >= reversalAccountingDate: Reversal IS effective (returns true).
   */
  public static isReversalEffectiveAsOf(
    reversalAccountingDate?: string | null | undefined,
    asOfDate?: string | undefined
  ): boolean {
    if (!reversalAccountingDate || reversalAccountingDate.trim() === '') {
      return false;
    }
    if (!asOfDate || asOfDate.trim() === '') {
      return true; // Live mode: if reversal accounting date is set, it is active now
    }
    return reversalAccountingDate <= asOfDate;
  }

  /**
   * Helper to determine if an entity is financially included for asOfDate:
   * Accounting date <= asOfDate AND NOT (Reversal accounting date <= asOfDate).
   */
  public static isEntityIncludedAsOf(
    accountingDate: string,
    reversalAccountingDate?: string | null | undefined,
    asOfDate?: string | undefined
  ): boolean {
    const isPostedAsOf = ApSettlementFoundation.isTransactionEffectiveAsOf(accountingDate, asOfDate);
    if (!isPostedAsOf) {
      return false;
    }
    const isReversedAsOf = ApSettlementFoundation.isReversalEffectiveAsOf(reversalAccountingDate, asOfDate);
    return !isReversedAsOf;
  }

  /**
   * Reusable read-only PostgreSQL transaction snapshot helper.
   * Executes queries within a consistent REPEATABLE READ READ ONLY transaction snapshot without acquiring FOR UPDATE locks.
   */
  public static async withReadOnlySnapshot<T>(
    pool: pg.Pool,
    fn: (client: pg.PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

      const result = await fn(client);

      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
