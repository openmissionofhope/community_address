/**
 * @fileoverview Application-specific error classes for standardized error handling.
 */

/**
 * Base application error class.
 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public isOperational = true
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Resource not found error.
 */
export class NotFoundError extends AppError {
  constructor(resource: string, id?: string | number) {
    super(404, 'NOT_FOUND', `${resource}${id ? ` with ID ${id}` : ''} not found`);
    this.name = 'NotFoundError';
  }
}

/**
 * Validation error for invalid input data.
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    public details?: unknown
  ) {
    super(400, 'VALIDATION_ERROR', message);
    this.name = 'ValidationError';
  }
}

/**
 * Database operation error.
 */
export class DatabaseError extends AppError {
  constructor(operation: string, cause?: Error) {
    super(503, 'DATABASE_ERROR', `Database operation failed: ${operation}`);
    this.name = 'DatabaseError';
    this.cause = cause;
  }
}

/**
 * Unauthorized access error.
 */
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Forbidden access error.
 */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Conflict error (e.g., duplicate resource).
 */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
    this.name = 'ConflictError';
  }
}

/**
 * Standardized error response format.
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

/**
 * Database error classification result.
 */
export interface DatabaseErrorClassification {
  isRetryable: boolean;
  isConnectionError: boolean;
  userMessage: string;
}

/**
 * Classifies PostgreSQL errors for appropriate handling.
 * @param err - The error to classify
 * @returns Classification with retry and user message info
 */
export function classifyDatabaseError(
  err: Error & { code?: string }
): DatabaseErrorClassification {
  const code = err.code || '';

  // Connection errors (retryable)
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET'].includes(code)) {
    return {
      isRetryable: true,
      isConnectionError: true,
      userMessage: 'Database temporarily unavailable',
    };
  }

  // PostgreSQL server shutdown/restart (retryable)
  if (['57P01', '57P02', '57P03'].includes(code)) {
    return {
      isRetryable: true,
      isConnectionError: true,
      userMessage: 'Database restarting, please retry',
    };
  }

  // Query timeout
  if (code === '57014') {
    return {
      isRetryable: true,
      isConnectionError: false,
      userMessage: 'Query timeout, please try a smaller request',
    };
  }

  // Unique constraint violation
  if (code === '23505') {
    return {
      isRetryable: false,
      isConnectionError: false,
      userMessage: 'Duplicate entry',
    };
  }

  // Foreign key violation
  if (code === '23503') {
    return {
      isRetryable: false,
      isConnectionError: false,
      userMessage: 'Referenced record not found',
    };
  }

  // Not null violation
  if (code === '23502') {
    return {
      isRetryable: false,
      isConnectionError: false,
      userMessage: 'Required field missing',
    };
  }

  // Check constraint violation
  if (code === '23514') {
    return {
      isRetryable: false,
      isConnectionError: false,
      userMessage: 'Invalid data value',
    };
  }

  // Pool exhausted
  if (err.message?.includes('timeout') && err.message?.includes('pool')) {
    return {
      isRetryable: true,
      isConnectionError: true,
      userMessage: 'Server busy, please retry',
    };
  }

  // Default: unknown database error
  return {
    isRetryable: false,
    isConnectionError: false,
    userMessage: 'Database operation failed',
  };
}

/**
 * Check if an error is a PostgreSQL error (has 5-char code).
 */
export function isPostgresError(err: unknown): err is Error & { code: string } {
  return (
    err instanceof Error &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    (err as { code: string }).code.length === 5
  );
}
