/**
 * @fileoverview Main entry point for the Community Address API.
 * Production-hardened Fastify server with comprehensive error handling,
 * structured logging, and graceful shutdown support.
 */

import { randomUUID } from 'crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';

import { loadConfig, getConfig } from './config.js';
import {
  initializePool,
  healthCheck,
  getPoolMetrics,
  closePool,
} from './db/connection.js';
import {
  AppError,
  classifyDatabaseError,
  isPostgresError,
  ErrorResponse,
} from './utils/errors.js';
import {
  isBanned,
  recordViolation,
  cleanupExpiredRecords,
  getBanStats,
  getBannedIps,
  unbanIp,
  BAN_DURATION_MS,
} from './utils/ban-store.js';

import { buildingsRoutes } from './routes/buildings.js';
import { suggestionsRoutes } from './routes/suggestions.js';
import { regionsRoutes } from './routes/regions.js';
import { usersRoutes } from './routes/users.js';
import { claimsRoutes } from './routes/claims.js';
import { accessRoutes } from './routes/access.js';

const ALGORITHM_VERSION = 'v1.0';
const API_VERSION = '1.0.0';

// Shutdown state
let isShuttingDown = false;
let cleanupInterval: NodeJS.Timeout | null = null;

async function main() {
  // Load and validate configuration (fails fast if invalid)
  const config = loadConfig();

  // Initialize database pool
  initializePool({
    databaseUrl: config.DATABASE_URL,
    ssl: config.DATABASE_SSL,
    poolMax: config.DB_POOL_MAX,
    queryTimeoutMs: config.DB_QUERY_TIMEOUT_MS,
  });

  // Create Fastify instance with production settings
  const fastify = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
    genReqId: () => randomUUID(),
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    bodyLimit: 1048576, // 1MB
    connectionTimeout: 30000, // 30s
  });

  // Global error handler
  fastify.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    // Handle Zod validation errors
    if (error instanceof ZodError) {
      request.log.warn({ err: error, requestId }, 'Validation error');
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          requestId,
          details: error.issues,
        },
      } satisfies ErrorResponse);
    }

    // Handle application errors
    if (error instanceof AppError) {
      const level = error.statusCode >= 500 ? 'error' : 'warn';
      request.log[level]({ err: error, requestId }, error.message);
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId,
        },
      } satisfies ErrorResponse);
    }

    // Handle PostgreSQL errors
    if (isPostgresError(error)) {
      const classified = classifyDatabaseError(error);
      request.log.error(
        { err: error, requestId, pgCode: error.code },
        'Database error'
      );
      return reply.status(503).send({
        error: {
          code: 'DATABASE_ERROR',
          message: classified.userMessage,
          requestId,
        },
      } satisfies ErrorResponse);
    }

    // Handle rate limit errors (from @fastify/rate-limit)
    const errorWithStatus = error as { statusCode?: number; message?: string };
    if (errorWithStatus.statusCode === 429) {
      return reply.status(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: errorWithStatus.message || 'Too many requests',
          requestId,
        },
      } satisfies ErrorResponse);
    }

    // Unhandled errors - log full details but don't expose
    request.log.error({ err: error, requestId }, 'Unhandled error');
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        requestId,
      },
    } satisfies ErrorResponse);
  });

  // Request/response logging with timing
  fastify.addHook('onResponse', (request, reply, done) => {
    request.log.info(
      {
        responseTime: reply.elapsedTime,
        statusCode: reply.statusCode,
      },
      'request completed'
    );
    done();
  });

  // Reject requests during shutdown
  fastify.addHook('onRequest', async (request, reply) => {
    if (isShuttingDown) {
      reply.header('Connection', 'close');
      return reply.status(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Server is shutting down',
          requestId: request.id,
        },
      } satisfies ErrorResponse);
    }
  });

  // CORS with production hardening
  const allowedOrigins = config.CORS_ORIGIN.split(',').map((o) => o.trim());
  await fastify.register(cors, {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        callback(null, true);
      } else {
        fastify.log.warn({ origin }, 'CORS rejection');
        callback(new Error('Not allowed by CORS'), false);
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID', 'Retry-After'],
    credentials: true,
    maxAge: 86400, // 24 hours preflight cache
  });

  // Security headers
  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  });

  // Rate limiting with ban integration
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    onExceeded: (request) => {
      const ip = request.ip;
      const shouldBan = recordViolation(ip);
      if (shouldBan) {
        request.log.warn({ ip }, 'IP banned for repeated rate limit violations');
      }
    },
  });

  // Ban check middleware
  fastify.addHook('onRequest', async (request, reply) => {
    const ip = request.ip;
    const bannedUntil = isBanned(ip);

    if (bannedUntil) {
      const remainingSeconds = Math.ceil((bannedUntil - Date.now()) / 1000);
      reply.header('Retry-After', remainingSeconds.toString());
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message:
            'Your IP has been temporarily banned due to repeated rate limit violations.',
          requestId: request.id,
        },
        retry_after_seconds: remainingSeconds,
      });
    }
  });

  // ============================================
  // Health & Observability Endpoints
  // ============================================

  // Liveness probe - is the process alive?
  fastify.get('/livez', async () => {
    return { status: 'alive', timestamp: new Date().toISOString() };
  });

  // Readiness probe - can we serve traffic?
  fastify.get('/readyz', async (_request, reply) => {
    const db = await healthCheck();

    if (!db.healthy) {
      return reply.status(503).send({
        status: 'not_ready',
        checks: {
          database: { healthy: false, latencyMs: db.latencyMs },
        },
      });
    }

    return {
      status: 'ready',
      checks: {
        database: { healthy: true, latencyMs: db.latencyMs },
      },
    };
  });

  // Deep health check (Fly.io compatible)
  fastify.get('/healthz', async (_request, reply) => {
    const db = await healthCheck();
    const isHealthy = db.healthy;

    return reply.status(isHealthy ? 200 : 503).send({
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      version: API_VERSION,
      checks: {
        database: {
          healthy: db.healthy,
          latencyMs: db.latencyMs,
          pool: db.poolStats,
        },
      },
    });
  });

  // Legacy health endpoint
  fastify.get('/health', async () => {
    const db = await healthCheck();
    return {
      status: db.healthy ? 'healthy' : 'degraded',
      database: db.healthy ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    };
  });

  // Metrics endpoint (admin protected)
  fastify.get('/metrics', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (authHeader !== `Bearer ${config.ADMIN_SECRET}`) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Unauthorized', requestId: request.id },
      });
    }

    const db = await healthCheck();
    const banStats = getBanStats();
    const memUsage = process.memoryUsage();

    return {
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      memory: {
        rss_mb: Math.round(memUsage.rss / 1024 / 1024),
        heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
      },
      database: {
        healthy: db.healthy,
        latency_ms: db.latencyMs,
        pool_total: db.poolStats.totalConnections,
        pool_idle: db.poolStats.idleConnections,
        pool_waiting: db.poolStats.waitingClients,
      },
      rate_limiting: {
        tracked_ips: banStats.totalTracked,
        currently_banned: banStats.currentlyBanned,
        recent_violators: banStats.recentViolators,
        at_capacity: banStats.atCapacity,
        max_capacity: banStats.maxCapacity,
      },
    };
  });

  // API metadata
  fastify.get('/meta', async () => {
    return {
      api_version: API_VERSION,
      algorithm_version: ALGORITHM_VERSION,
      osm_data_timestamp: config.OSM_DATA_TIMESTAMP || 'unknown',
      supported_regions: ['UG'],
      disclaimer: 'Community addresses are unofficial and temporary.',
    };
  });

  // ============================================
  // Admin Endpoints
  // ============================================

  fastify.get('/admin/bans', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (authHeader !== `Bearer ${config.ADMIN_SECRET}`) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Unauthorized', requestId: request.id },
      });
    }

    return {
      stats: getBanStats(),
      banned_ips: getBannedIps().map((b) => ({
        ip: b.ip,
        banned_until: new Date(b.bannedUntil).toISOString(),
        violations: b.violations,
      })),
      ban_duration_minutes: BAN_DURATION_MS / 60000,
    };
  });

  fastify.delete<{ Params: { ip: string } }>(
    '/admin/bans/:ip',
    async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (authHeader !== `Bearer ${config.ADMIN_SECRET}`) {
        return reply.status(401).send({
          error: { code: 'UNAUTHORIZED', message: 'Unauthorized', requestId: request.id },
        });
      }

      const { ip } = request.params;
      const unbanned = unbanIp(decodeURIComponent(ip));

      if (unbanned) {
        return { message: `IP ${ip} has been unbanned` };
      }
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'IP not found in ban list', requestId: request.id },
      });
    }
  );

  // ============================================
  // Application Routes
  // ============================================

  await fastify.register(buildingsRoutes);
  await fastify.register(suggestionsRoutes);
  await fastify.register(regionsRoutes);
  await fastify.register(usersRoutes);
  await fastify.register(claimsRoutes);
  await fastify.register(accessRoutes);

  // ============================================
  // Server Startup
  // ============================================

  try {
    await fastify.listen({ port: config.PORT, host: config.HOST });
    fastify.log.info(
      { port: config.PORT, host: config.HOST, env: config.NODE_ENV },
      'Server started'
    );
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  // Periodic cleanup of expired ban records (every 10 minutes)
  cleanupInterval = setInterval(() => {
    const cleaned = cleanupExpiredRecords();
    if (cleaned > 0) {
      fastify.log.info({ cleaned }, 'Cleaned up expired ban records');
    }
  }, 10 * 60 * 1000);

  // ============================================
  // Graceful Shutdown
  // ============================================

  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      fastify.log.warn('Shutdown already in progress');
      return;
    }
    isShuttingDown = true;

    fastify.log.info({ signal }, 'Shutdown signal received, starting graceful shutdown');

    // Set a timeout for graceful shutdown
    const shutdownTimeout = setTimeout(() => {
      fastify.log.error('Graceful shutdown timeout, forcing exit');
      process.exit(1);
    }, 30000); // 30s max

    try {
      // Clear cleanup interval
      if (cleanupInterval) {
        clearInterval(cleanupInterval);
      }

      // Close Fastify (waits for in-flight requests)
      await fastify.close();
      fastify.log.info('Fastify server closed');

      // Close database pool
      await closePool();
      fastify.log.info('Database pool closed');

      clearTimeout(shutdownTimeout);
      fastify.log.info('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      fastify.log.error({ err }, 'Error during shutdown');
      clearTimeout(shutdownTimeout);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Unhandled rejection handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection:', { reason, promise });
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception - shutting down:', error);
  process.exit(1);
});

main();
