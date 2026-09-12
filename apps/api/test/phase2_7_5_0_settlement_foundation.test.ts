import { describe, it, expect } from 'vitest';
import { RequestContext, ValidationError, ForbiddenError, ExactDecimal } from '@general-erp/core';
import { ApSettlementValidator } from '../src/modules/finance/ap/ap-settlement-validator.js';
import { ApSettlementFoundation } from '../src/modules/finance/ap/ap-settlement-foundation.js';

describe('Phase 2.7.5.0 — Settlement & Reconciliation Foundation', () => {
  const tenantId = 'tenant_ap_settle_found';
  const companyId = 'cmp_ap_settle_acme';

  const ctx: RequestContext = {
    tenantId,
    companyId,
    user: {
      id: 'usr_ap_auditor',
      tenantId,
      roles: ['AP_CLERK'],
      permissions: ['ap:settlement:read', 'ap:reconcile:read']
    }
  };

  describe('1. Open Item Settlement Status Primitive', () => {
    it('evaluates OPEN when outstanding equals original amount', () => {
      const status = ApSettlementFoundation.calculateSettlementStatus('10000.00', '10000.00');
      expect(status).toBe('OPEN');
    });

    it('evaluates PARTIALLY_SETTLED when 0 < outstanding < original', () => {
      const status = ApSettlementFoundation.calculateSettlementStatus('10000.00', '4000.00');
      expect(status).toBe('PARTIALLY_SETTLED');
    });

    it('evaluates SETTLED when outstanding is 0.00', () => {
      const status = ApSettlementFoundation.calculateSettlementStatus('10000.00', '0.00');
      expect(status).toBe('SETTLED');
    });

    it('rejects outstanding > original amount', () => {
      expect(() =>
        ApSettlementFoundation.calculateSettlementStatus('10000.00', '10000.01')
      ).toThrow(ValidationError);
    });

    it('rejects negative outstanding amount', () => {
      expect(() =>
        ApSettlementFoundation.calculateSettlementStatus('10000.00', '-1.00')
      ).toThrow(ValidationError);
    });

    it('rejects non-positive original amount', () => {
      expect(() =>
        ApSettlementFoundation.calculateSettlementStatus('0.00', '0.00')
      ).toThrow(ValidationError);
    });
  });

  describe('2. Source Utilization Primitive', () => {
    it('evaluates FULLY_UNAPPLIED when allocated is 0.00', () => {
      const status = ApSettlementFoundation.calculateSourceUtilization('0.00', '5000.00', '5000.00');
      expect(status).toBe('FULLY_UNAPPLIED');
    });

    it('evaluates PARTIALLY_APPLIED when both allocated and unapplied are positive', () => {
      const status = ApSettlementFoundation.calculateSourceUtilization('2000.00', '3000.00', '5000.00');
      expect(status).toBe('PARTIALLY_APPLIED');
    });

    it('evaluates FULLY_APPLIED when unapplied is 0.00', () => {
      const status = ApSettlementFoundation.calculateSourceUtilization('5000.00', '0.00', '5000.00');
      expect(status).toBe('FULLY_APPLIED');
    });

    it('rejects invalid sum invariant (allocated + unapplied != total)', () => {
      expect(() =>
        ApSettlementFoundation.calculateSourceUtilization('2000.00', '2000.00', '5000.00')
      ).toThrow(ValidationError);
    });

    it('rejects negative allocated or unapplied amounts', () => {
      expect(() =>
        ApSettlementFoundation.calculateSourceUtilization('-100.00', '5100.00', '5000.00')
      ).toThrow(ValidationError);
    });
  });

  describe('3. Signed Net Supplier Payable & Reconciliation Primitives', () => {
    it('calculates positive net payable when bills exceed payments and credit notes', () => {
      const netPayable = ApSettlementFoundation.calculateNetSupplierPayable('10000.00', '3000.00', '1000.00');
      expect(netPayable).toBe('6000.00');
    });

    it('calculates zero net payable when open bills equal unapplied credits', () => {
      const netPayable = ApSettlementFoundation.calculateNetSupplierPayable('5000.00', '3000.00', '2000.00');
      expect(netPayable).toBe('0.00');
    });

    it('calculates SIGNED NEGATIVE net payable when advances/credits exceed open bills (never clamped)', () => {
      const netPayable = ApSettlementFoundation.calculateNetSupplierPayable('2000.00', '5000.00', '1000.00');
      expect(netPayable).toBe('-4000.00');
    });

    it('reconciles balanced GL AP_CONTROL liability (Subledger = GL -> PASS)', () => {
      const result = ApSettlementFoundation.calculateReconciliationDifference('10000.00', '10000.00');
      expect(result.difference).toBe('0.00');
      expect(result.status).toBe('PASS');
    });

    it('reconciles mismatched GL AP_CONTROL liability (Subledger != GL -> FAIL)', () => {
      const result = ApSettlementFoundation.calculateReconciliationDifference('10000.00', '9000.00');
      expect(result.difference).toBe('1000.00');
      expect(result.status).toBe('FAIL');
    });

    it('reconciles SIGNED NEGATIVE supplier credit balances (Subledger = -2000, GL = -2000 -> PASS)', () => {
      // Worked Supplier Credit Note Example from Specification:
      // Credit Note 2000 -> GL: DR AP_CONTROL 2000 (signed balance: -2000.00)
      // Subledger: 0 - 0 - 2000 = -2000.00
      const result = ApSettlementFoundation.calculateReconciliationDifference('-2000.00', '-2000.00');
      expect(result.difference).toBe('0.00');
      expect(result.status).toBe('PASS');
    });

    it('flags reconciliation mismatch for signed negative credit balances', () => {
      const result = ApSettlementFoundation.calculateReconciliationDifference('-2000.00', '-1500.00');
      expect(result.difference).toBe('-500.00');
      expect(result.status).toBe('FAIL');
    });
  });

  describe('4. Financial Effective Date & Reversal Semantics', () => {
    it('evaluates transaction effectiveness based on accountingDate vs asOfDate', () => {
      expect(ApSettlementFoundation.isTransactionEffectiveAsOf('2025-04-10', '2025-04-15')).toBe(true);
      expect(ApSettlementFoundation.isTransactionEffectiveAsOf('2025-04-10', '2025-04-10')).toBe(true);
      expect(ApSettlementFoundation.isTransactionEffectiveAsOf('2025-04-10', '2025-04-05')).toBe(false);
      expect(ApSettlementFoundation.isTransactionEffectiveAsOf('2025-04-10')).toBe(true); // Live mode
    });

    it('evaluates allocation effectiveness based on allocationDate vs asOfDate', () => {
      expect(ApSettlementFoundation.isAllocationEffectiveAsOf('2025-04-12', '2025-04-15')).toBe(true);
      expect(ApSettlementFoundation.isAllocationEffectiveAsOf('2025-04-12', '2025-04-10')).toBe(false);
    });

    it('evaluates reversal effectiveness strictly based on reversalAccountingDate', () => {
      const reversalAccountingDate = '2025-04-20';

      // Before reversal accounting date -> reversal NOT effective (transaction active)
      expect(ApSettlementFoundation.isReversalEffectiveAsOf(reversalAccountingDate, '2025-04-15')).toBe(false);

      // On or after reversal accounting date -> reversal IS effective (transaction reversed)
      expect(ApSettlementFoundation.isReversalEffectiveAsOf(reversalAccountingDate, '2025-04-20')).toBe(true);
      expect(ApSettlementFoundation.isReversalEffectiveAsOf(reversalAccountingDate, '2025-04-25')).toBe(true);

      // Unreversed transaction -> reversal NOT effective
      expect(ApSettlementFoundation.isReversalEffectiveAsOf(null, '2025-04-25')).toBe(false);
    });

    it('evaluates net entity inclusion as of a historical cutoff', () => {
      const accountingDate = '2025-04-05';
      const reversalAccountingDate = '2025-04-20';

      // 1. As of 2025-04-01 (before posting) -> EXCLUDED (not posted yet)
      expect(ApSettlementFoundation.isEntityIncludedAsOf(accountingDate, reversalAccountingDate, '2025-04-01')).toBe(false);

      // 2. As of 2025-04-10 (after posting, before reversal) -> INCLUDED (active)
      expect(ApSettlementFoundation.isEntityIncludedAsOf(accountingDate, reversalAccountingDate, '2025-04-10')).toBe(true);

      // 3. As of 2025-04-25 (after reversal date) -> EXCLUDED (reversed)
      expect(ApSettlementFoundation.isEntityIncludedAsOf(accountingDate, reversalAccountingDate, '2025-04-25')).toBe(false);
    });
  });

  describe('5. Context & Validator Protection', () => {
    it('validates tenant and company context matching', () => {
      expect(() => ApSettlementValidator.validateCompanyContext(ctx, companyId)).not.toThrow();
    });

    it('rejects missing tenantId', () => {
      const invalidCtx: RequestContext = { ...ctx, tenantId: '' };
      expect(() => ApSettlementValidator.validateCompanyContext(invalidCtx, companyId)).toThrow(ValidationError);
    });

    it('rejects missing companyId', () => {
      expect(() => ApSettlementValidator.validateCompanyContext(ctx, '')).toThrow(ValidationError);
    });

    it('rejects companyId context mismatch', () => {
      expect(() => ApSettlementValidator.validateCompanyContext(ctx, 'cmp_other')).toThrow(ForbiddenError);
    });

    it('validates supplier context', () => {
      expect(() => ApSettlementValidator.validateSupplierContext('supp_123')).not.toThrow();
      expect(() => ApSettlementValidator.validateSupplierContext('')).toThrow(ValidationError);
    });

    it('validates asOfDate format', () => {
      expect(() => ApSettlementValidator.validateAsOfDate('2025-04-15')).not.toThrow();
      expect(() => ApSettlementValidator.validateAsOfDate('15-04-2025')).toThrow(ValidationError);
    });
  });

  describe('6. Read-Only Transaction Snapshot Helper', () => {
    it('executes callback inside a REPEATABLE READ READ ONLY transaction and commits on success', async () => {
      const queryCalls: string[] = [];
      let released = false;

      const mockPool: any = {
        connect: async () => ({
          query: async (sql: string) => {
            queryCalls.push(sql);
            return { rows: [] };
          },
          release: () => {
            released = true;
          }
        })
      };

      const result = await ApSettlementFoundation.withReadOnlySnapshot(mockPool, async (client) => {
        await client.query('SELECT 1');
        return 'snapshot_success';
      });

      expect(result).toBe('snapshot_success');
      expect(queryCalls).toContain('BEGIN');
      expect(queryCalls).toContain('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      expect(queryCalls).toContain('SELECT 1');
      expect(queryCalls).toContain('COMMIT');
      expect(released).toBe(true);
    });

    it('rolls back transaction and releases client on error', async () => {
      const queryCalls: string[] = [];
      let released = false;

      const mockPool: any = {
        connect: async () => ({
          query: async (sql: string) => {
            queryCalls.push(sql);
            return { rows: [] };
          },
          release: () => {
            released = true;
          }
        })
      };

      await expect(
        ApSettlementFoundation.withReadOnlySnapshot(mockPool, async () => {
          throw new Error('Simulated query failure');
        })
      ).rejects.toThrow('Simulated query failure');

      expect(queryCalls).toContain('BEGIN');
      expect(queryCalls).toContain('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      expect(queryCalls).toContain('ROLLBACK');
      expect(released).toBe(true);
    });
  });

  describe('7. 200 Randomized Financial Calculation Scenarios', () => {
    it('executes 200 randomized scenarios asserting exact decimal balance conservation and signed reconciliation invariants', () => {
      for (let i = 0; i < 200; i++) {
        const totalVal = Math.floor(Math.random() * 10000) + 100;
        const allocVal = Math.floor(Math.random() * totalVal);
        const unappVal = totalVal - allocVal;

        const totalStr = totalVal.toFixed(2);
        const allocStr = allocVal.toFixed(2);
        const unappStr = unappVal.toFixed(2);

        // 1. Source Utilization Invariant
        const utilStatus = ApSettlementFoundation.calculateSourceUtilization(allocStr, unappStr, totalStr);
        expect(['FULLY_UNAPPLIED', 'PARTIALLY_APPLIED', 'FULLY_APPLIED']).toContain(utilStatus);

        // 2. Open Item Settlement Invariant
        const settStatus = ApSettlementFoundation.calculateSettlementStatus(totalStr, unappStr);
        expect(['OPEN', 'PARTIALLY_SETTLED', 'SETTLED']).toContain(settStatus);

        // 3. Signed Net Supplier Payable
        const randBills = (Math.floor(Math.random() * 15000)).toFixed(2);
        const randPayments = (Math.floor(Math.random() * 10000)).toFixed(2);
        const randCNs = (Math.floor(Math.random() * 5000)).toFixed(2);

        const netPayableStr = ApSettlementFoundation.calculateNetSupplierPayable(randBills, randPayments, randCNs);
        const expectedNetPayableDec = ExactDecimal.parse(randBills, 2)
          .sub(ExactDecimal.parse(randPayments, 2))
          .sub(ExactDecimal.parse(randCNs, 2));

        expect(netPayableStr).toBe(expectedNetPayableDec.toString());

        // 4. Signed Reconciliation Invariant
        const glSignedStr = expectedNetPayableDec.toString(); // Exact match
        const reconResult = ApSettlementFoundation.calculateReconciliationDifference(netPayableStr, glSignedStr);

        expect(reconResult.difference).toBe('0.00');
        expect(reconResult.status).toBe('PASS');
      }
    });
  });
});
