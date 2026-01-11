/**
 * @fileoverview Database connection module for PostgreSQL with PostGIS support.
 * Provides a connection pool with monitoring, retry logic, and query timeouts.
 */

import { Pool, PoolClient } from 'pg';
import { classifyDatabaseError } from '../utils/errors.js';

/** Pool metrics for monitoring */
interface PoolMetrics {
  totalConnections: number;
  idleConnections: number;
  waitingClients: number;
  lastError: Error | null;
  lastErrorTime: Date | null;
}

/** Health check result with detailed information */
export interface HealthCheckResult {
  healthy: boolean;
  latencyMs: number;
  poolStats: PoolMetrics;
}

/** Query options for timeout and retry behavior */
export interface QueryOptions {
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

// Pool metrics tracking
const poolMetrics: PoolMetrics = {
  totalConnections: 0,
  idleConnections: 0,
  waitingClients: 0,
  lastError: null,
  lastErrorTime: null,
};

// Pool instance - initialized lazily
let pool: Pool | null = null;

// Default query timeout (30 seconds)
const DEFAULT_QUERY_TIMEOUT_MS = 30000;

/**
 * Initialize the database connection pool.
 * Must be called before any database operations.
 */
export function initializePool(config: {
  databaseUrl: string;
  ssl?: string;
  poolMax?: number;
  queryTimeoutMs?: number;
}): Pool {
  if (pool) {
    return pool;
  }

  const poolConfig = {
    connectionString: config.databaseUrl,
    ssl: config.ssl !== 'false' ? { rejectUnauthorized: false } : false,
    max: config.poolMax || 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    allowExitOnIdle: false,
  };

  pool = new Pool(poolConfig);

  // Pool event handlers for monitoring
  pool.on('connect', () => {
    updatePoolMetrics();
  });

  pool.on('acquire', () => {
    updatePoolMetrics();
  });

  pool.on('release', () => {
    updatePoolMetrics();
  });

  pool.on('remove', () => {
    updatePoolMetrics();
  });

  pool.on('error', (err) => {
    poolMetrics.lastError = err;
    poolMetrics.lastErrorTime = new Date();
    console.error('[DB Pool Error]', err.message);
  });

  return pool;
}

/**
 * Update pool metrics from the current pool state.
 */
function updatePoolMetrics(): void {
  if (pool) {
    poolMetrics.totalConnections = pool.totalCount;
    poolMetrics.idleConnections = pool.idleCount;
    poolMetrics.waitingClients = pool.waitingCount;
  }
}

/**
 * Get the current pool instance.
 * Throws if pool is not initialized.
 */
export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initializePool() first.');
  }
  return pool;
}

/**
 * Get current pool metrics for monitoring.
 */
export function getPoolMetrics(): PoolMetrics {
  updatePoolMetrics();
  return { ...poolMetrics };
}

/**
 * Executes a SQL query with timeout support.
 *
 * @template T - The expected type of each row in the result set
 * @param text - The SQL query string with optional $1, $2, etc. placeholders
 * @param params - Optional array of parameter values for the query
 * @param options - Optional query options (timeout)
 * @returns A promise that resolves to an array of rows
 */
export async function query<T = unknown>(
  text: string,
  params?: unknown[],
  options: QueryOptions = {}
): Promise<T[]> {
  const p = getPool();
  const timeoutMs = options.timeoutMs || DEFAULT_QUERY_TIMEOUT_MS;

  const client = await p.connect();
  try {
    // Set statement timeout for this connection
    await client.query(`SET statement_timeout = ${timeoutMs}`);
    const result = await client.query(text, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}

/**
 * Executes a SQL query and returns the first matching row or null.
 *
 * @template T - The expected type of the row
 * @param text - The SQL query string with optional $1, $2, etc. placeholders
 * @param params - Optional array of parameter values for the query
 * @param options - Optional query options
 * @returns A promise that resolves to the first row or null if no rows match
 */
export async function queryOne<T = unknown>(
  text: string,
  params?: unknown[],
  options: QueryOptions = {}
): Promise<T | null> {
  const rows = await query<T>(text, params, options);
  return rows[0] || null;
}

/**
 * Executes a SQL query with retry logic for transient failures.
 * Use for critical operations that should be resilient to temporary issues.
 *
 * @template T - The expected type of each row in the result set
 * @param text - The SQL query string
 * @param params - Optional parameter values
 * @param options - Query options including retry settings
 * @returns A promise that resolves to an array of rows
 */
export async function queryWithRetry<T = unknown>(
  text: string,
  params?: unknown[],
  options: QueryOptions = {}
): Promise<T[]> {
  const { maxRetries = 3, retryDelayMs = 100 } = options;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await query<T>(text, params, options);
    } catch (err) {
      lastError = err as Error;
      const classified = classifyDatabaseError(lastError);

      // Only retry on retryable errors
      if (!classified.isRetryable) {
        throw err;
      }

      // Log retry attempt
      console.warn(
        `[DB Retry] Attempt ${attempt + 1}/${maxRetries} failed: ${lastError.message}`
      );

      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelayMs * Math.pow(2, attempt))
        );
      }
    }
  }

  throw lastError;
}

/**
 * Execute multiple queries in a transaction.
 *
 * @param callback - Function that receives a client and executes queries
 * @returns The result of the callback
 */
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const p = getPool();
  const client = await p.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Enhanced health check with latency and pool statistics.
 *
 * @returns Detailed health check result
 */
export async function healthCheck(): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    const p = getPool();
    await p.query('SELECT 1');
    return {
      healthy: true,
      latencyMs: Date.now() - start,
      poolStats: getPoolMetrics(),
    };
  } catch {
    return {
      healthy: false,
      latencyMs: Date.now() - start,
      poolStats: getPoolMetrics(),
    };
  }
}

/**
 * Simple health check returning boolean (for backward compatibility).
 */
export async function isHealthy(): Promise<boolean> {
  const result = await healthCheck();
  return result.healthy;
}

/**
 * Gracefully close the database pool.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// Export pool getter for direct access when needed
export { pool };
