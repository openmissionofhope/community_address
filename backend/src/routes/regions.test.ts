import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { regionsRoutes } from './regions.js';

vi.mock('../db/connection.js', () => ({
  query: vi.fn(),
}));

import { query } from '../db/connection.js';

const mockQuery = vi.mocked(query);

describe('Regions Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(regionsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /regions', () => {
    it('should return all regions', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          code: 'UG',
          name: 'Uganda',
          level: 0,
          parent_code: null,
          centroid_lon: 32.29,
          centroid_lat: 1.37,
          building_count: '1000',
          community_address_count: '800',
        },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/regions',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.regions).toHaveLength(1);
      expect(payload.regions[0].code).toBe('UG');
    });

    it('should return empty array when no regions found', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: 'GET',
        url: '/regions',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.regions).toEqual([]);
    });
  });
});
