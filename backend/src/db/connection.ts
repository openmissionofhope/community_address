/**
 * @fileoverview Database connection module for PostgreSQL with PostGIS support.
 * Provides a connection pool and helper functions for executing SQL queries.
 */

import { Pool } from 'pg';

/**
 * PostgreSQL connection pool configuration.
 * Uses environment variables for connection settings with sensible defaults.
 *
 * @property {string} host - Database host (default: 'localhost')
 * @property {number} port - Database port (default: 5432)
 * @property {string} database - Database name (default: 'community_address')
 * @property {string} user - Database user (default: 'postgres')
 * @property {string} password - Database password (default: 'postgres')
 * @property {number} max - Maximum number of connections in the pool (20)
 * @property {number} idleTimeoutMillis - Time before idle connections are closed (30000ms)
 * @property {number} connectionTimeoutMillis - Time to wait for a connection (2000ms)
 */
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'community_address',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

/**
 * Executes a SQL query and returns all matching rows.
 *
 * @template T - The expected type of each row in the result set
 * @param {string} text - The SQL query string with optional $1, $2, etc. placeholders
 * @param {unknown[]} [params] - Optional array of parameter values for the query
 * @returns {Promise<T[]>} A promise that resolves to an array of rows
 *
 * @example
 * // Simple query
 * const buildings = await query<Building>('SELECT * FROM buildings LIMIT 10');
 *
 * @example
 * // Query with parameters
 * const building = await query<Building>(
 *   'SELECT * FROM buildings WHERE osm_id = $1',
 *   [12345]
 * );
 */
export async function query<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

/**
 * Executes a SQL query and returns the first matching row or null.
 *
 * @template T - The expected type of the row
 * @param {string} text - The SQL query string with optional $1, $2, etc. placeholders
 * @param {unknown[]} [params] - Optional array of parameter values for the query
 * @returns {Promise<T | null>} A promise that resolves to the first row or null if no rows match
 *
 * @example
 * const building = await queryOne<Building>(
 *   'SELECT * FROM buildings WHERE osm_id = $1',
 *   [12345]
 * );
 * if (building) {
 *   console.log(building.osm_type);
 * }
 */
export async function queryOne<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

/**
 * Checks if the database connection is healthy.
 * Executes a simple query to verify the connection pool is working.
 *
 * @returns {Promise<boolean>} A promise that resolves to true if the connection is healthy, false otherwise
 *
 * @example
 * const isHealthy = await healthCheck();
 * if (!isHealthy) {
 *   console.error('Database connection failed');
 * }
 */
export async function healthCheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export { pool };
