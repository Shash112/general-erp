import { logger } from '../../config/logger.js';
import { AppError, ErrorCode } from '@general-erp/core';
import type pg from 'pg';

export interface SequenceConfig {
  documentType: string;         // e.g. 'INVOICE', 'QUOTATION', 'JOURNAL_ENTRY'
  prefix: string;               // e.g. 'INV', 'QT', 'JV'
  suffix?: string | undefined;
  fiscalYear: string;           // e.g. '2025-26' or '2026'
  branchCode?: string | undefined; // e.g. 'BLR', 'MUM'
  currentSequence: number;
  paddingDigits: number;        // e.g. 4 -> '0001'
  resetOnFiscalYear: boolean;
}

export class NumberingEngine {
  private sequenceStore = new Map<string, SequenceConfig>();
  private dbPool?: pg.Pool | undefined;

  /**
   * Set database pool for atomic PostgreSQL sequence allocation
   */
  setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
  }

  /**
   * Register or configure document sequence format
   */
  configureSequence(tenantId: string, companyId: string, config: SequenceConfig): void {
    const key = this.getSequenceKey(tenantId, companyId, config.documentType, config.fiscalYear, config.branchCode);
    const existing = this.sequenceStore.get(key);
    if (existing) {
      this.sequenceStore.set(key, {
        ...existing,
        ...config,
        currentSequence: existing.currentSequence
      });
    } else {
      this.sequenceStore.set(key, config);
    }
  }

  /**
   * Reset in-memory sequence store (useful for unit tests)
   */
  clear(): void {
    this.sequenceStore.clear();
  }

  /**
   * Concurrency-safe sequence number allocation (Synchronous / In-Memory fallback)
   */
  generateNextNumber(tenantId: string, companyId: string, documentType: string, fiscalYear: string, branchCode?: string): string {
    const key = this.getSequenceKey(tenantId, companyId, documentType, fiscalYear, branchCode);
    let config = this.sequenceStore.get(key);

    if (!config) {
      // Auto-initialize default sequence format if not explicitly configured
      const defaultPrefix = documentType.slice(0, 3).toUpperCase();
      config = {
        documentType,
        prefix: defaultPrefix,
        fiscalYear,
        branchCode,
        currentSequence: 0,
        paddingDigits: 4,
        resetOnFiscalYear: true
      };
      this.sequenceStore.set(key, config);
    }

    // Increment current sequence atomically
    config.currentSequence += 1;
    return this.formatNumber(config, config.currentSequence, tenantId, companyId);
  }

  /**
   * Atomic PostgreSQL-backed sequence number allocation (Production persistence)
   */
  async generateNextNumberAsync(
    tenantId: string,
    companyId: string,
    documentType: string,
    fiscalYear: string,
    branchCode?: string,
    clientOrPool?: pg.Pool | pg.PoolClient
  ): Promise<string> {
    const activePool = clientOrPool || this.dbPool;

    // Production Fallback Guard: Block silent in-memory fallback when in production environment
    if (!activePool) {
      if (process.env.NODE_ENV === 'production') {
        logger.error({ tenantId, companyId, documentType }, '[NUMBERING_CRITICAL] Production database pool unavailable. In-memory fallback strictly blocked.');
        throw new AppError(
          `Production numbering failure: Database pool is required for sequence allocation in production environment. In-memory fallback is disabled.`,
          500,
          ErrorCode.INTERNAL_ERROR
        );
      }
      return this.generateNextNumber(tenantId, companyId, documentType, fiscalYear, branchCode);
    }


    const effectiveBranch = branchCode || 'DEFAULT';
    const key = this.getSequenceKey(tenantId, companyId, documentType, fiscalYear, branchCode);
    const config = this.sequenceStore.get(key) || {
      documentType,
      prefix: documentType.slice(0, 3).toUpperCase(),
      fiscalYear,
      branchCode,
      currentSequence: 0,
      paddingDigits: 4,
      resetOnFiscalYear: true
    };

    // Atomic SQL sequence allocation: ON CONFLICT DO UPDATE SET current_sequence = current_sequence + 1
    const queryText = `
      INSERT INTO numbering_sequences (tenant_id, company_id, document_type, fiscal_year, branch_code, current_sequence, updated_at)
      VALUES ($1, $2, $3, $4, $5, 1, NOW())
      ON CONFLICT (tenant_id, company_id, document_type, fiscal_year, branch_code)
      DO UPDATE SET current_sequence = numbering_sequences.current_sequence + 1, updated_at = NOW()
      RETURNING current_sequence;
    `;

    const res = await activePool.query(queryText, [tenantId, companyId, documentType, fiscalYear, effectiveBranch]);
    const nextSeq = Number(res.rows[0].current_sequence);

    return this.formatNumber(config, nextSeq, tenantId, companyId);
  }

  private formatNumber(config: SequenceConfig, seqNum: number, tenantId: string, companyId: string): string {
    const seqStr = String(seqNum).padStart(config.paddingDigits, '0');

    const parts = [config.prefix];
    if (config.fiscalYear) parts.push(config.fiscalYear);
    if (config.branchCode) parts.push(config.branchCode);
    parts.push(seqStr);

    if (config.suffix) parts.push(config.suffix);

    const generatedNumber = parts.join('-');
    logger.info({ tenantId, companyId, documentType: config.documentType, generatedNumber }, '[NUMBERING] Generated sequence number');

    return generatedNumber;
  }

  private getSequenceKey(tenantId: string, companyId: string, documentType: string, fiscalYear: string, branchCode?: string): string {
    return `${tenantId}:${companyId}:${documentType}:${fiscalYear}:${branchCode || 'DEFAULT'}`;
  }
}

export const numberingEngine = new NumberingEngine();
