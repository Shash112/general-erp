import path from 'path';
import crypto from 'crypto';
import { ValidationError } from '@general-erp/core';

export interface FileMetadata {
  fileId: string;
  tenantId: string;
  module: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export class StorageService {
  /**
   * Resolve tenant-isolated storage path with Path Traversal protection
   */
  getStoragePath(tenantId: string, module: string, filename: string): string {
    // Path Traversal Security Guards
    if (filename.includes('..') || module.includes('..') || tenantId.includes('..')) {
      throw new ValidationError('Security violation: Path traversal detected in file path parameters.');
    }

    const sanitizedFilename = path.basename(filename);
    const sanitizedModule = module.replace(/[^a-zA-Z0-9_-]/g, '');
    const sanitizedTenant = tenantId.replace(/[^a-zA-Z0-9_-]/g, '');

    return path.join('tenants', sanitizedTenant, sanitizedModule, sanitizedFilename);
  }

  /**
   * Generate short-lived signed URL for file access
   */
  generateSignedUrl(tenantId: string, fileId: string, expiresInSeconds: number = 900): string {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const payload = `${tenantId}:${fileId}:${expiresAt}`;
    const signature = crypto.createHash('sha256').update(payload).digest('hex');
    
    return `/api/v1/files/download/${fileId}?expires=${expiresAt}&sig=${signature}`;
  }

  /**
   * Verify signature on signed URL
   */
  verifySignedUrl(tenantId: string, fileId: string, expiresAt: number, signature: string): boolean {
    const now = Math.floor(Date.now() / 1000);
    if (now > expiresAt) {
      return false; // Expired link
    }

    const payload = `${tenantId}:${fileId}:${expiresAt}`;
    const expectedSignature = crypto.createHash('sha256').update(payload).digest('hex');

    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  }
}

export const storageService = new StorageService();
