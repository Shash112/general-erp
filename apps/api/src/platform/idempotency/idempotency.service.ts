import crypto from 'node:crypto';
import { logger } from '../../config/logger.js';
import { RequestContext, ConflictError } from '@general-erp/core';
import type pg from 'pg';

export interface IdempotencyRecord {
  id?: string;
  tenantId: string;
  companyId: string;
  key: string;
  requestHash: string;
  responseStatus: number;
  responseBody: any;
  expiresAt: Date;
  createdAt: Date;
}

export interface CheckIdempotencyResult {
  isDuplicate: boolean;
  requestHash: string;
  responseStatus?: number;
  responseBody?: any;
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export class IdempotencyService {
  private inMemoryStore = new Map<string, IdempotencyRecord>();
  private inFlightClaims = new Map<string, Deferred<CheckIdempotencyResult>>();
  private dbPool?: pg.Pool | undefined;

  public setDbPool(pool: pg.Pool): void {
    this.dbPool = pool;
  }

  public clear(): void {
    this.inMemoryStore.clear();
    this.inFlightClaims.clear();
  }

  public async getRecord(ctx: RequestContext, key: string): Promise<IdempotencyRecord | undefined> {
    if (!ctx.tenantId || !ctx.companyId) return undefined;
    const storeKey = this.getStoreKey(ctx.tenantId, ctx.companyId, key);
    return this.inMemoryStore.get(storeKey);
  }

  /**
   * Generates a deterministic SHA-256 fingerprint hash of canonical request payloads.
   * Sorts object keys recursively to ensure key ordering does not alter the hash.
   */
  public computeFingerprint(payload: unknown): string {
    const canonicalJson = JSON.stringify(this.canonicalize(payload));
    return crypto.createHash('sha256').update(canonicalJson).digest('hex');
  }

  private canonicalize(val: any): any {
    if (val === null || typeof val !== 'object') {
      return val;
    }
    if (val instanceof Date) {
      return val.toISOString();
    }
    if (Array.isArray(val)) {
      return val.map(item => this.canonicalize(item));
    }

    const sortedObj: Record<string, any> = {};
    const keys = Object.keys(val).sort();

    for (const key of keys) {
      // Omit volatile runtime metadata fields from payload fingerprinting
      if (['requestId', 'timestamp', 'expectedVersion'].includes(key)) {
        continue;
      }
      sortedObj[key] = this.canonicalize(val[key]);
    }
    return sortedObj;
  }

  private getStoreKey(tenantId: string, companyId: string, key: string): string {
    return `${tenantId}:${companyId}:${key}`;
  }

  /**
   * Layer 1 Request Idempotency Check / Claim.
   * Returns cached response if key exists and request payload hash matches.
   * Awaits in-flight request if another concurrent request with the same key is currently executing.
   * Throws ConflictError if key exists but payload hash differs (IDEMPOTENCY_KEY_REUSE_CONFLICT).
   */
  public async checkOrClaim(
    ctx: RequestContext,
    key: string,
    payload: unknown,
    clientOrPool?: pg.Pool | pg.PoolClient
  ): Promise<CheckIdempotencyResult> {
    if (!ctx.tenantId || !ctx.companyId) {
      return { isDuplicate: false, requestHash: '' };
    }

    const storeKey = this.getStoreKey(ctx.tenantId, ctx.companyId, key);
    const requestHash = this.computeFingerprint(payload);

    // If another concurrent request with the SAME idempotencyKey is currently executing, wait for its result
    if (this.inFlightClaims.has(storeKey)) {
      const deferred = this.inFlightClaims.get(storeKey)!;
      logger.info({
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        key,
        msg: '[IDEMPOTENCY] Concurrent request detected. Awaiting in-flight execution result'
      });
      return await deferred.promise;
    }

    const activePool = clientOrPool || this.dbPool;

    if (activePool) {
      const res = await activePool.query(
        `SELECT key, request_hash, response_status, response_body, expires_at
         FROM idempotency_keys
         WHERE tenant_id = $1 AND key = $2
         FOR UPDATE`,
        [ctx.tenantId, key]
      );

      if (res.rows.length > 0) {
        const row = res.rows[0];
        if (row.request_hash !== requestHash) {
          logger.warn({
            tenantId: ctx.tenantId,
            companyId: ctx.companyId,
            key,
            msg: '[IDEMPOTENCY] Key reuse conflict detected with mismatched payload fingerprint'
          });
          throw new ConflictError(
            `IDEMPOTENCY_KEY_REUSE_CONFLICT: Idempotency key '${key}' was previously used with a different request payload.`
          );
        }

        logger.info({
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          key,
          msg: '[IDEMPOTENCY] Returning cached idempotent result from database'
        });

        return {
          isDuplicate: true,
          requestHash,
          responseStatus: Number(row.response_status),
          responseBody: row.response_body
        };
      }

      // First request: Register in-flight claim
      const deferred = createDeferred<CheckIdempotencyResult>();
      deferred.promise.catch(() => {}); // Prevent unhandled rejection warning when releaseClaim rejects
      this.inFlightClaims.set(storeKey, deferred);

      return { isDuplicate: false, requestHash };
    }

    // In-memory Fallback
    const existing = this.inMemoryStore.get(storeKey);

    if (existing) {
      if (existing.requestHash !== requestHash) {
        logger.warn({
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          key,
          msg: '[IDEMPOTENCY] Key reuse conflict detected in memory'
        });
        throw new ConflictError(
          `IDEMPOTENCY_KEY_REUSE_CONFLICT: Idempotency key '${key}' was previously used with a different request payload.`
        );
      }

      logger.info({
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        key,
        msg: '[IDEMPOTENCY] Returning cached idempotent result from memory'
      });

      return {
        isDuplicate: true,
        requestHash,
        responseStatus: existing.responseStatus,
        responseBody: existing.responseBody
      };
    }

    // Register in-flight claim for first request
    const deferred = createDeferred<CheckIdempotencyResult>();
    deferred.promise.catch(() => {}); // Prevent unhandled rejection warning when releaseClaim rejects
    this.inFlightClaims.set(storeKey, deferred);

    return { isDuplicate: false, requestHash };
  }

  /**
   * Saves the completed API execution result associated with an idempotency key and resolves waiting promises.
   */
  public async saveResult(
    ctx: RequestContext,
    key: string,
    payload: unknown,
    responseStatus: number,
    responseBody: unknown,
    clientOrPool?: pg.Pool | pg.PoolClient
  ): Promise<void> {
    if (!ctx.tenantId || !ctx.companyId) {
      return;
    }

    const requestHash = this.computeFingerprint(payload);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours retention
    const activePool = clientOrPool || this.dbPool;

    if (activePool) {
      await activePool.query(
        `INSERT INTO idempotency_keys (tenant_id, key, request_hash, response_status, response_body, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (tenant_id, key)
         DO UPDATE SET response_status = $4, response_body = $5, expires_at = $6`,
        [ctx.tenantId, key, requestHash, responseStatus, JSON.stringify(responseBody), expiresAt]
      );
    } else {
      const storeKey = this.getStoreKey(ctx.tenantId, ctx.companyId, key);
      this.inMemoryStore.set(storeKey, {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        key,
        requestHash,
        responseStatus,
        responseBody,
        expiresAt,
        createdAt: new Date()
      });
    }

    // Resolve waiting in-flight promises for concurrent requests with the same key
    const storeKey = this.getStoreKey(ctx.tenantId, ctx.companyId, key);
    const deferred = this.inFlightClaims.get(storeKey);
    if (deferred) {
      deferred.resolve({
        isDuplicate: true,
        requestHash,
        responseStatus,
        responseBody
      });
      this.inFlightClaims.delete(storeKey);
    }
  }

  /**
   * Releases an in-flight claim when an operation fails or rolls back.
   */
  public releaseClaim(ctx: RequestContext, key: string, error?: any): void {
    if (!ctx.tenantId || !ctx.companyId) return;
    const storeKey = this.getStoreKey(ctx.tenantId, ctx.companyId, key);
    const deferred = this.inFlightClaims.get(storeKey);
    if (deferred) {
      if (error) {
        deferred.reject(error);
      }
      this.inFlightClaims.delete(storeKey);
    }
  }
}

export const idempotencyService = new IdempotencyService();
