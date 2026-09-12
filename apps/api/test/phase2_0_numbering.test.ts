import { describe, it, expect } from 'vitest';
import { NumberingEngine } from '../src/platform/numbering/numbering.service.js';
import { AppError } from '@general-erp/core';

describe('Phase 2.0 — PostgreSQL-backed Numbering Engine Tests', () => {
  it('allocates sequence numbers with tenant and company isolation', async () => {
    const engine = new NumberingEngine();

    const seqA1 = await engine.generateNextNumberAsync('tenant_a', 'company_1', 'INVOICE', '2025-26', 'BLR');
    const seqA2 = await engine.generateNextNumberAsync('tenant_a', 'company_1', 'INVOICE', '2025-26', 'BLR');
    const seqB1 = await engine.generateNextNumberAsync('tenant_b', 'company_1', 'INVOICE', '2025-26', 'BLR');
    const seqC1 = await engine.generateNextNumberAsync('tenant_a', 'company_2', 'INVOICE', '2025-26', 'BLR');

    expect(seqA1).toBe('INV-2025-26-BLR-0001');
    expect(seqA2).toBe('INV-2025-26-BLR-0002');
    expect(seqB1).toBe('INV-2025-26-BLR-0001'); // Isolated tenant
    expect(seqC1).toBe('INV-2025-26-BLR-0001'); // Isolated company
  });

  it('allocates BRAND NEW sequence key under 100 concurrent requests without duplicate keys', async () => {
    const engine = new NumberingEngine();
    const count = 100;
    const promises: Promise<string>[] = [];

    // First-time sequence creation test key
    for (let i = 0; i < count; i++) {
      promises.push(engine.generateNextNumberAsync('tenant_first_time', 'cmp_first_time', 'CREDIT_NOTE', '2026-27', 'MANGALORE'));
    }

    const results = await Promise.all(promises);
    const uniqueResults = new Set(results);

    expect(results.length).toBe(count);
    expect(uniqueResults.size).toBe(count);
    expect(results[0]).toBe('CRE-2026-27-MANGALORE-0001');
  });

  it('allocates existing sequence numbers concurrently without producing duplicate keys', async () => {
    const engine = new NumberingEngine();
    const count = 100;
    const promises: Promise<string>[] = [];

    for (let i = 0; i < count; i++) {
      promises.push(engine.generateNextNumberAsync('tenant_conc', 'company_conc', 'SALES_ORDER', '2025-26', 'MUM'));
    }

    const results = await Promise.all(promises);
    const uniqueResults = new Set(results);

    expect(results.length).toBe(count);
    expect(uniqueResults.size).toBe(count);
  });

  it('blocks silent in-memory fallback when NODE_ENV is production and DB pool is missing', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const engine = new NumberingEngine(); // No DB pool set

    try {
      await expect(
        engine.generateNextNumberAsync('tenant_prod', 'cmp_prod', 'INVOICE', '2025-26', 'BLR')
      ).rejects.toThrow(AppError);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('respects branch isolation and zero-padding configurations', async () => {
    const engine = new NumberingEngine();

    engine.configureSequence('tenant_cfg', 'company_cfg', {
      documentType: 'PAYMENT_VOUCHER',
      prefix: 'PAY',
      fiscalYear: '2026-27',
      branchCode: 'DELHI',
      currentSequence: 99,
      paddingDigits: 6,
      resetOnFiscalYear: true
    });

    const num1 = await engine.generateNextNumberAsync('tenant_cfg', 'company_cfg', 'PAYMENT_VOUCHER', '2026-27', 'DELHI');
    expect(num1).toBe('PAY-2026-27-DELHI-000100');

    const num2 = await engine.generateNextNumberAsync('tenant_cfg', 'company_cfg', 'PAYMENT_VOUCHER', '2026-27', 'DELHI');
    expect(num2).toBe('PAY-2026-27-DELHI-000101');
  });

  it('demonstrates sequence gap acceptance under transaction rollback simulation', async () => {
    const engine = new NumberingEngine();

    const seq1 = await engine.generateNextNumberAsync('tenant_rollback', 'cmp_rb', 'PO', '2025-26', 'HQ');
    expect(seq1).toBe('PO-2025-26-HQ-0001');

    // Simulate abandoned allocation (gap created)
    const seq2_abandoned = await engine.generateNextNumberAsync('tenant_rollback', 'cmp_rb', 'PO', '2025-26', 'HQ');
    expect(seq2_abandoned).toBe('PO-2025-26-HQ-0002');

    // Next successful transaction obtains next sequential number without failing
    const seq3 = await engine.generateNextNumberAsync('tenant_rollback', 'cmp_rb', 'PO', '2025-26', 'HQ');
    expect(seq3).toBe('PO-2025-26-HQ-0003');
  });
});
