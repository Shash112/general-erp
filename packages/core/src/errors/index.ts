/**
 * General ERP Standard Domain Error Hierarchy
 */

export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION',
  ACCOUNTING_INVARIANT_VIOLATED = 'ACCOUNTING_INVARIANT_VIOLATED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  IDEMPOTENCY_CONFLICT = 'IDEMPOTENCY_CONFLICT',
  SEGREGATION_OF_DUTIES_VIOLATION = 'SEGREGATION_OF_DUTIES_VIOLATION'
}

export interface ErrorDetail {
  field?: string;
  message: string;
  code?: string;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details: ErrorDetail[];
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number = 500,
    code: ErrorCode = ErrorCode.INTERNAL_ERROR,
    details: ErrorDetail[] = [],
    isOperational: boolean = true
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details: ErrorDetail[] = []) {
    super(message, 400, ErrorCode.VALIDATION_ERROR, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, ErrorCode.UNAUTHORIZED);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Permission denied') {
    super(message, 403, ErrorCode.FORBIDDEN);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const msg = id ? `${resource} with ID '${id}' was not found.` : `${resource} was not found.`;
    super(msg, 404, ErrorCode.NOT_FOUND);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, ErrorCode.CONFLICT);
  }
}

export class BusinessRuleViolationError extends AppError {
  constructor(message: string, details: ErrorDetail[] = []) {
    super(message, 422, ErrorCode.BUSINESS_RULE_VIOLATION, details);
  }
}

export class AccountingError extends AppError {
  constructor(message: string, details: ErrorDetail[] = []) {
    super(message, 422, ErrorCode.ACCOUNTING_INVARIANT_VIOLATED, details);
  }
}

export class IdempotencyConflictError extends AppError {
  constructor(message: string = 'Request with this Idempotency-Key is currently processing or completed') {
    super(message, 409, ErrorCode.IDEMPOTENCY_CONFLICT);
  }
}
