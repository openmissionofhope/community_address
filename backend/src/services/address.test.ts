import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  findNearestOsmStreet,
  getOrCreatePlaceholderStreet,
  calculateHouseNumber,
  assignCommunityAddress,
  getBuildingWithAddress,
} from './address.js';

// Mock the database connection
vi.mock('../db/connection.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { query, queryOne } from '../db/connection.js';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);

describe('Address Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findNearestOsmStreet', () => {
    it('should return the nearest street when found', async () => {
      const mockStreet = {
        osm_id: 123456,
        name: 'Kampala Road',
        geometry: '{"type":"LineString","coordinates":[[32.58,0.34],[32.59,0.35]]}',
        distance_m: 50,
      };

      mockQueryOne.mockResolvedValueOnce(mockStreet);

      const result = await findNearestOsmStreet({ lon: 32.5814, lat: 0.3476 });

      expect(result).toEqual(mockStreet);
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
    });

    it('should return null when no streets exist', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await findNearestOsmStreet({ lon: 32.5814, lat: 0.3476 });

      expect(result).toBeNull();
    });
  });

  describe('getOrCreatePlaceholderStreet', () => {
    it('should return existing placeholder street', async () => {
      const existingPlaceholder = {
        placeholder_id: 'KLA-3F9A00AC',
        display_name: 'Community Placeholder KLA-3F9A00AC',
        geometry: '{"type":"LineString","coordinates":[[32.58,0.34],[32.58,0.35]]}',
      };

      mockQueryOne.mockResolvedValueOnce(existingPlaceholder);

      const result = await getOrCreatePlaceholderStreet({ lon: 32.5814, lat: 0.3476 }, 'KLA');

      expect(result).toEqual(existingPlaceholder);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should create new placeholder street when none exists', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      mockQuery.mockResolvedValueOnce([]);

      const result = await getOrCreatePlaceholderStreet({ lon: 32.5814, lat: 0.3476 }, 'KLA');

      expect(result.placeholder_id).toMatch(/^KLA-[0-9A-F]+$/);
      expect(result.display_name).toContain('Community Placeholder');
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('calculateHouseNumber', () => {
    it('should calculate house number based on position', async () => {
      mockQueryOne.mockResolvedValueOnce({ position: 0.5 });

      const result = await calculateHouseNumber(
        { lon: 32.5814, lat: 0.3476 },
        '{"type":"LineString","coordinates":[[32.58,0.34],[32.59,0.35]]}',
        '123456',
        'osm'
      );

      expect(result).toBe(510);
    });

    it('should return minimum house number 10', async () => {
      mockQueryOne.mockResolvedValueOnce({ position: 0 });

      const result = await calculateHouseNumber(
        { lon: 32.5814, lat: 0.3476 },
        '{"type":"LineString","coordinates":[[32.58,0.34],[32.59,0.35]]}',
        '123456',
        'osm'
      );

      expect(result).toBe(10);
    });

    it('should handle null position result', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await calculateHouseNumber(
        { lon: 32.5814, lat: 0.3476 },
        '{"type":"LineString","coordinates":[[32.58,0.34],[32.59,0.35]]}',
        '123456',
        'osm'
      );

      expect(result).toBe(510);
    });
  });

  describe('assignCommunityAddress', () => {
    it('should use OSM street when within 100m', async () => {
      const mockStreet = {
        osm_id: 123456,
        name: 'Kampala Road',
        geometry: '{"type":"LineString","coordinates":[[32.58,0.34],[32.59,0.35]]}',
        distance_m: 50,
      };

      mockQueryOne
        .mockResolvedValueOnce(mockStreet)
        .mockResolvedValueOnce({ position: 0.3 });

      const result = await assignCommunityAddress({ lon: 32.5814, lat: 0.3476 });

      expect(result.street_source).toBe('osm');
      expect(result.street_name).toBe('Kampala Road');
      expect(result.street_id).toBe('123456');
      expect(result.algorithm_version).toBe('v1.0');
      expect(result.full_address).toContain('[Unofficial / Community Address]');
    });

    it('should use placeholder street when OSM street is too far', async () => {
      const mockStreet = {
        osm_id: 123456,
        name: 'Far Road',
        geometry: '{"type":"LineString","coordinates":[[32.58,0.34],[32.59,0.35]]}',
        distance_m: 150,
      };

      mockQueryOne
        .mockResolvedValueOnce(mockStreet)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ position: 0.5 });

      mockQuery.mockResolvedValueOnce([]);

      const result = await assignCommunityAddress({ lon: 32.5814, lat: 0.3476 });

      expect(result.street_source).toBe('placeholder');
      expect(result.street_name).toContain('Community Placeholder');
    });
  });

  describe('getBuildingWithAddress', () => {
    it('should return official address when building has one', async () => {
      const mockBuilding = {
        osm_id: 987654,
        osm_type: 'way',
        geometry: '{"type":"Polygon","coordinates":[[[32.58,0.34],[32.59,0.34],[32.59,0.35],[32.58,0.35],[32.58,0.34]]]}',
        centroid: '{"type":"Point","coordinates":[32.585,0.345]}',
        addr_housenumber: '42',
        addr_street: 'Main Street',
        addr_city: 'Kampala',
        addr_postcode: null,
      };

      mockQueryOne.mockResolvedValueOnce(mockBuilding);

      const result = await getBuildingWithAddress('way', 987654);

      expect(result).not.toBeNull();
      expect(result!.address_type).toBe('official');
      expect(result!.address.house_number).toBe('42');
      expect(result!.address.street).toBe('Main Street');
    });

    it('should return null when building not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await getBuildingWithAddress('way', 999999);

      expect(result).toBeNull();
    });
  });
});
