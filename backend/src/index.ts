import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { healthCheck } from './db/connection.js';
import { buildingsRoutes } from './routes/buildings.js';
import { suggestionsRoutes } from './routes/suggestions.js';
import { regionsRoutes } from './routes/regions.js';

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
  });

  // Health check
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

  // Register routes
  await fastify.register(buildingsRoutes);
  await fastify.register(suggestionsRoutes);
  await fastify.register(regionsRoutes);

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
}

main();
