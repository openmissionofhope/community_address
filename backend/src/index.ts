import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { healthCheck, pool } from './db/connection.js';
import { buildingsRoutes } from './routes/buildings.js';
import { suggestionsRoutes } from './routes/suggestions.js';
import { regionsRoutes } from './routes/regions.js';
import { usersRoutes } from './routes/users.js';
import { claimsRoutes } from './routes/claims.js';
import { accessRoutes } from './routes/access.js';
import {
  isBanned,
  recordViolation,
  cleanupExpiredRecords,
  getBanStats,
  getBannedIps,
  unbanIp,
  BAN_DURATION_MS,
} from './utils/ban-store.js';

const ALGORITHM_VERSION = 'v1.0';
const API_VERSION = '1.0.0';

async function main() {
  const fastify = Fastify({
    logger: true,
  });

  // Register plugins
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN || '*',
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  });

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

  // Ban check middleware - runs before rate limiting
  fastify.addHook('onRequest', async (request, reply) => {
    const ip = request.ip;
    const bannedUntil = isBanned(ip);

    if (bannedUntil) {
      const remainingSeconds = Math.ceil((bannedUntil - Date.now()) / 1000);
      reply.header('Retry-After', remainingSeconds.toString());
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Your IP has been temporarily banned due to repeated rate limit violations.',
        retry_after_seconds: remainingSeconds,
      });
    }
  });

  // Health check (Fly.io expects /healthz)
  fastify.get('/healthz', async (request, reply) => {
    const dbHealthy = await healthCheck();
    if (!dbHealthy) {
      return reply.status(503).send({ status: 'unhealthy', database: 'disconnected' });
    }
    return { status: 'healthy', database: 'connected' };
  });

  // Legacy health endpoint
  fastify.get('/health', async () => {
    const dbHealthy = await healthCheck();
    return {
      status: dbHealthy ? 'healthy' : 'degraded',
      database: dbHealthy ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    };
  });

  // API metadata
  fastify.get('/meta', async () => {
    return {
      api_version: API_VERSION,
      algorithm_version: ALGORITHM_VERSION,
      osm_data_timestamp: process.env.OSM_DATA_TIMESTAMP || 'unknown',
      supported_regions: ['UG'],
      disclaimer: 'Community addresses are unofficial and temporary.',
    };
  });

  // Admin endpoints (protected by ADMIN_SECRET)
  const adminSecret = process.env.ADMIN_SECRET;

  fastify.get('/admin/bans', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!adminSecret || authHeader !== `Bearer ${adminSecret}`) {
      return reply.status(401).send({ error: 'Unauthorized' });
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

  fastify.delete<{ Params: { ip: string } }>('/admin/bans/:ip', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!adminSecret || authHeader !== `Bearer ${adminSecret}`) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { ip } = request.params;
    const unbanned = unbanIp(decodeURIComponent(ip));

    if (unbanned) {
      return { message: `IP ${ip} has been unbanned` };
    }
    return reply.status(404).send({ error: 'IP not found in ban list' });
  });

  // Register routes
  await fastify.register(buildingsRoutes);
  await fastify.register(suggestionsRoutes);
  await fastify.register(regionsRoutes);
  await fastify.register(usersRoutes);
  await fastify.register(claimsRoutes);
  await fastify.register(accessRoutes);

  // Start server
  const port = parseInt(process.env.PORT || '3000');
  const host = process.env.HOST || '0.0.0.0';

  try {
    await fastify.listen({ port, host });
    console.log(`Server running at http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  // Periodic cleanup of expired ban records (every 10 minutes)
  const cleanupInterval = setInterval(() => {
    const cleaned = cleanupExpiredRecords();
    if (cleaned > 0) {
      fastify.log.info({ cleaned }, 'Cleaned up expired ban records');
    }
  }, 10 * 60 * 1000);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down...`);
    clearInterval(cleanupInterval);
    await fastify.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
