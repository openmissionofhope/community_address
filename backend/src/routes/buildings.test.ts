import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { buildingsRoutes } from './buildings.js';

vi.mock('../db/connection.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('../services/address.js', () => ({
  getBuildingWithAddress: vi.fn(),
  assignCommunityAddress: vi.fn(),
}));

import { query } from '../db/connection.js';
import { getBuildingWithAddress, assignCommunityAddress } from '../services/address.js';

const mockQuery = vi.mocked(query);
const mockGetBuildingWithAddress = vi.mocked(getBuildingWithAddress);
const mockAssignCommunityAddress = vi.mocked(assignCommunityAddress);

describe('Buildings Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(buildingsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /buildings', () => {
    it('should return 400 when bbox is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/buildings',
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.payload)).toEqual({ error: 'bbox parameter is required' });
    });

    it('should return 400 when bbox format is invalid', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/buildings?bbox=invalid',
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return buildings within bbox', async () => {
      const mockBuildings = [
        {
          osm_id: 123,
          osm_type: 'way',
          geometry: '{"type":"Polygon","coordinates":[[[32.58,0.34],[32.59,0.34],[32.59,0.35],[32.58,0.35],[32.58,0.34]]]}',
          centroid: '{"type":"Point","coordinates":[32.585,0.345]}',
          addr_housenumber: '42',
          addr_street: 'Main St',
          addr_city: 'Kampala',
        },
      ];

      mockQuery.mockResolvedValueOnce(mockBuildings);

      const response = await app.inject({
        method: 'GET',
        url: '/buildings?bbox=32.5,0.3,32.6,0.4',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.type).toBe('FeatureCollection');
      expect(payload.features).toHaveLength(1);
    });
  });

  describe('GET /buildings/:osm_type/:osm_id', () => {
    it('should return 400 for invalid osm_type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/buildings/invalid/123',
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 404 when building not found', async () => {
      mockGetBuildingWithAddress.mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'GET',
        url: '/buildings/way/999999',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
