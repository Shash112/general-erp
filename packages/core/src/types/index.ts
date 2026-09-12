/**
 * General ERP Standard API & Domain Types
 */

import { ErrorCode, ErrorDetail } from '../errors/index.js';

export interface ApiResponseMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  requestId: string;
  timestamp: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
  };
  meta: ApiResponseMeta;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta: ApiResponseMeta;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}

export interface UserSession {
  userId: string;
  email: string;
  roles: string[];
  permissions: string[];
  tenantId: string;
  companyId: string;
  branchId?: string;
  departmentId?: string;
}

export interface RequestContext {
  requestId: string;
  tenantId: string;
  companyId: string;
  branchId?: string;
  user?: UserSession;
  ip: string;
  userAgent: string;
  timestamp: Date;
}

export enum DataScope {
  GLOBAL = 'GLOBAL',
  COMPANY = 'COMPANY',
  BRANCH = 'BRANCH',
  DEPARTMENT = 'DEPARTMENT',
  SELF = 'SELF'
}
