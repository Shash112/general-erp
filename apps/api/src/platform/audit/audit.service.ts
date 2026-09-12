import crypto from 'crypto';
import { RequestContext } from '@general-erp/core';
import { logger } from '../../config/logger.js';

export interface AuditLogEntry {
  id?: string;
  tenantId: string;
  actorId: string;
  actorIp: string;
  userAgent: string;
  module: string;
  entityName: string;
  entityId: string;
  action: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  reason?: string;
  traceId: string;
  prevHash?: string;
  hash?: string;
  timestamp?: string;
}

export interface ChainVerificationResult {
  isValid: boolean;
  brokenIndex?: number;
  reason?: string;
}

export class AuditService {
  private lastHash: string = 'GENESIS_HASH';
  private auditLogs: AuditLogEntry[] = [];

  public clear(): void {
    this.auditLogs = [];
    this.lastHash = 'GENESIS_HASH';
  }

  public async queryLogs(ctx: RequestContext, filter?: { entityName?: string }): Promise<AuditLogEntry[]> {
    return this.auditLogs.filter(l => {
      if (ctx.tenantId && l.tenantId !== ctx.tenantId) return false;
      if (filter?.entityName && l.entityName !== filter.entityName) return false;
      return true;
    });
  }

  /**
   * Log immutable audit record with cryptographic hash calculation
   */
  async logEvent(ctx: RequestContext, entry: Omit<AuditLogEntry, 'tenantId' | 'actorId' | 'actorIp' | 'userAgent' | 'traceId' | 'prevHash'>): Promise<{ hash: string; prevHash: string; timestamp: string }> {
    const timestamp = new Date().toISOString();
    const prevHash = this.lastHash;
    
    // Hash chain: SHA256(prevHash + tenantId + module + entity + action + timestamp)
    const hash = this.calculateHash(prevHash, ctx.tenantId, entry.module, entry.entityName, entry.entityId, entry.action, timestamp);
    this.lastHash = hash;

    const fullLog: AuditLogEntry & { timestamp: string; hash: string; prevHash: string } = {
      tenantId: ctx.tenantId,
      actorId: ctx.user?.userId || 'system',
      actorIp: ctx.ip,
      userAgent: ctx.userAgent,
      traceId: ctx.requestId,
      ...entry,
      prevHash,
      hash,
      timestamp
    };

    this.auditLogs.push(fullLog);

    logger.info({ audit: fullLog }, `[AUDIT] ${entry.module}::${entry.entityName}::${entry.action}`);

    return { hash, prevHash, timestamp };
  }

  /**
   * Calculate SHA-256 hash for audit record payload
   */
  calculateHash(prevHash: string, tenantId: string, module: string, entityName: string, entityId: string, action: string, timestamp: string): string {
    const payloadToHash = `${prevHash}:${tenantId}:${module}:${entityName}:${entityId}:${action}:${timestamp}`;
    return crypto.createHash('sha256').update(payloadToHash).digest('hex');
  }

  /**
   * Verify integrity of an entire sequence of audit log records
   */
  verifyAuditChain(logs: AuditLogEntry[], expectedRootHash: string = 'GENESIS_HASH'): ChainVerificationResult {
    if (logs.length === 0) {
      return { isValid: true };
    }

    let expectedPrevHash = expectedRootHash;

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      if (!log) continue;

      // 1. Check previous hash linkage
      if (log.prevHash !== expectedPrevHash) {
        return {
          isValid: false,
          brokenIndex: i,
          reason: `Chain broken at index ${i}: prevHash mismatch. Expected '${expectedPrevHash}', got '${log.prevHash}'.`
        };
      }

      // 2. Re-calculate payload hash
      const computedHash = this.calculateHash(
        log.prevHash,
        log.tenantId,
        log.module,
        log.entityName,
        log.entityId,
        log.action,
        log.timestamp || ''
      );

      if (log.hash !== computedHash) {
        return {
          isValid: false,
          brokenIndex: i,
          reason: `Payload tampered at index ${i}: hash mismatch. Expected '${computedHash}', got '${log.hash}'.`
        };
      }

      expectedPrevHash = log.hash;
    }

    return { isValid: true };
  }
}

export const auditService = new AuditService();
