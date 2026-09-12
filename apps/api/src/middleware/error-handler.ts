import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { AppError, ErrorCode } from '@general-erp/core';
import { logger } from '../config/logger.js';

export function setupErrorHandler(error: FastifyError | AppError, request: FastifyRequest, reply: FastifyReply) {
  const requestId = (request.headers['x-request-id'] as string) || request.id || 'unknown';
  const timestamp = new Date().toISOString();

  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error({ err: error, requestId }, `[AppError ${error.code}] ${error.message}`);
    } else {
      logger.warn({ err: error, requestId }, `[AppError ${error.code}] ${error.message}`);
    }

    return reply.status(error.statusCode).send({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details.length > 0 ? error.details : undefined
      },
      meta: {
        requestId,
        timestamp
      }
    });
  }

  // Handle Fastify Validation Errors
  if (error.validation) {
    logger.warn({ err: error, requestId }, '[FastifyValidationError] Input validation failed');
    return reply.status(400).send({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Input validation failed. Please check field requirements.',
        details: error.validation.map(v => ({
          field: v.instancePath || v.params?.issue || 'body',
          message: v.message || 'Invalid value'
        }))
      },
      meta: {
        requestId,
        timestamp
      }
    });
  }

  // Unhandled / Internal Errors
  logger.error({ err: error, requestId }, '[UnhandledError] Unexpected system error');

  return reply.status(500).send({
    success: false,
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'An unexpected internal error occurred. Please contact system administrator.'
    },
    meta: {
      requestId,
      timestamp
    }
  });
}
