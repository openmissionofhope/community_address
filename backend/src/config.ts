/**
 * @fileoverview Centralized configuration with environment validation.
 * Fails fast at startup if required variables are missing.
 */

import { z } from 'zod';

const envSchema = z.object({
  // Required
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  ADMIN_SECRET: z.string().min(16, 'ADMIN_SECRET must be at least 16 characters'),

  // Required in production (validated separately)
  CORS_ORIGIN: z.string().min(1, 'CORS_ORIGIN is required'),

  // Optional with defaults
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default('3000'),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  // Database options
  DATABASE_SSL: z.string().optional(),
  DB_POOL_MAX: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive().max(50))
    .default('10'),
  DB_QUERY_TIMEOUT_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default('30000'),

  // Optional metadata
  OSM_DATA_TIMESTAMP: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

let config: Config | null = null;

/**
 * Load and validate configuration from environment variables.
 * Exits the process if validation fails.
 */
export function loadConfig(): Config {
  if (config) return config;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('');
    console.error('=== CONFIGURATION ERROR ===');
    console.error('Missing or invalid environment variables:');
    result.error.issues.forEach((issue) => {
      console.error(`  ${issue.path.join('.') || 'unknown'}: ${issue.message}`);
    });
    console.error('');
    console.error('Required variables:');
    console.error('  DATABASE_URL     - PostgreSQL connection string');
    console.error('  ADMIN_SECRET     - Admin API authentication (min 16 chars)');
    console.error('  CORS_ORIGIN      - Allowed origins (comma-separated or *)');
    console.error('===========================');
    console.error('');
    process.exit(1);
  }

  // Additional production checks
  if (result.data.NODE_ENV === 'production') {
    if (result.data.CORS_ORIGIN === '*') {
      console.error('');
      console.error('=== SECURITY ERROR ===');
      console.error('Wildcard CORS (*) is not allowed in production.');
      console.error('Set CORS_ORIGIN to specific allowed origins.');
      console.error('======================');
      console.error('');
      process.exit(1);
    }
  }

  config = result.data;
  return config;
}

/**
 * Get the loaded configuration.
 * Throws if loadConfig() has not been called.
 */
export function getConfig(): Config {
  if (!config) {
    throw new Error('Configuration not loaded. Call loadConfig() first.');
  }
  return config;
}

/**
 * Check if we're in production mode.
 */
export function isProduction(): boolean {
  return getConfig().NODE_ENV === 'production';
}
