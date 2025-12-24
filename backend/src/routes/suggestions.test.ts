import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { suggestionsRoutes } from './suggestions.js';

vi.mock('../db/connection.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { query, queryOne } from '../db/connection.js';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);

describe('Suggestions Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(suggestionsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /suggestions', () => {
    it('should return 400 when request body is invalid', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/suggestions',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('should create suggestion successfully', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ id: 100 })
        .mockResolvedValueOnce({ id: 1, status: 'pending' });

      const response = await app.inject({
        method: 'POST',
        url: '/suggestions',
        payload: {
          building_osm_id: 100,
          suggestion_type: 'address_correction',
          description: 'The house number should be 42, not 41.',
          suggested_value: '42',
        },
      });

      expect(response.statusCode).toBe(201);
      const payload = JSON.parse(response.payload);
      expect(payload.id).toBe(1);
    });
  });

  describe('POST /suggestions/osm-redirect', () => {
    it('should return OSM URLs for existing building', async () => {
      mockQueryOne.mockResolvedValueOnce({
        osm_type: 'way',
        centroid_lon: 32.5814,
        centroid_lat: 0.3476,
      });
      mockQuery.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: 'POST',
        url: '/suggestions/osm-redirect',
        payload: {
          building_osm_id: 123456,
          issue_type: 'geometry_error',
          description: 'The building outline is incorrect.',
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.osm_edit_url).toContain('openstreetmap.org');
    });
  });
});
