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
    it('should return existing placeholder street with new format', async () => {
      const existingPlaceholder = {
        placeholder_id: 'KAM-C-105',
        display_name: 'C-105',
        region_code: 'KAM',
        subregion_code: 'C',
        geometry: '{"type":"LineString","coordinates":[[32.58,0.34],[32.58,0.35]]}',
      };

      mockQueryOne.mockResolvedValueOnce(existingPlaceholder);

      const result = await getOrCreatePlaceholderStreet({ lon: 32.5814, lat: 0.3476 });

      expect(result).toEqual(existingPlaceholder);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should create new placeholder street with subregion-number format', async () => {
      // Upsert returns the created placeholder with new format
      mockQueryOne.mockResolvedValueOnce({
        placeholder_id: 'KAM-C-99005',
        display_name: 'C-99005',
        region_code: 'KAM',
        subregion_code: 'C',
        geometry: '{"type":"LineString","coordinates":[[32.5815,0.347],[32.5815,0.349]]}',
      });

      const result = await getOrCreatePlaceholderStreet({ lon: 32.5814, lat: 0.3476 });

      // New format: <REGION>-<SUBREGION>-<NUMBER>
      expect(result.placeholder_id).toMatch(/^[A-Z]{3}-[A-Z]{1,2}-\d+$/);
      // Display name is just subregion-number
      expect(result.display_name).toMatch(/^[A-Z]{1,2}-\d+$/);
      expect(result.region_code).toBe('KAM');
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('calculateHouseNumber', () => {
    it('should calculate odd house number for left side of road', async () => {
      // First call: position along street
      mockQueryOne.mockResolvedValueOnce({ position: 0.5 });
      // Second call: side of street (positive = left)
      mockQueryOne.mockResolvedValueOnce({ side: 1 });

      const result = await calculateHouseNumber(
        { lon: 32.5814, lat: 0.3476 },
        '{"type":"LineString","coordinates":[[32.58,0.34],[32.59,0.35]]}'
      );

      // Left side at position 0.5: (50 * 2 + 1) * 5 = 505
      expect(result).toBe(505);
      // Verify it's an odd multiple of 5
      expect(result % 5).toBe(0);
      expect((result / 5) % 2).toBe(1);
    });

    it('should calculate even house number for right side of road', async () => {
      // First call: position along street
      mockQueryOne.mockResolvedValueOnce({ position: 0.5 });
      // Second call: side of street (negative = right)
      mockQueryOne.mockResolvedValueOnce({ side: -1 });

      const result = await calculateHouseNumber(
        { lon: 32.5814, lat: 0.3476 },
        '{"type":"LineString","coordinates":[[32.58,0.34],[32.59,0.35]]}'
      );

      // Right side at position 0.5: (50 * 2 + 2) * 5 = 510
      expect(result).toBe(510);
      // Verify it's an even multiple of 5
      expect(result % 5).toBe(0);
      expect((result / 5) % 2).toBe(0);
    });

    it('should return minimum house number 5 for left side', async () => {
      mockQueryOne.mockResolvedValueOnce({ position: 0 });
      mockQueryOne.mockResolvedValueOnce({ side: 1 });

      const result = await calculateHouseNumber(
        { lon: 32.5814, lat: 0.3476 },
        '{"type":"LineString","coordinates":[[32.58,0.34],[32.59,0.35]]}'
      );

      // Left side at position 0: (0 * 2 + 1) * 5 = 5
      expect(result).toBe(5);
    });

    it('should return minimum house number 10 for right side', async () => {
      mockQueryOne.mockResolvedValueOnce({ position: 0 });
      mockQueryOne.mockResolvedValueOnce({ side: -1 });

      const result = await calculateHouseNumber(
        { lon: 32.5814, lat: 0.3476 },
        '{"type":"LineString","coordinates":[[32.58,0.34],[32.59,0.35]]}'
      );

      // Right side at position 0: (0 * 2 + 2) * 5 = 10
      expect(result).toBe(10);
    });

    it('should handle null position result (defaults to left side)', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      mockQueryOne.mockResolvedValueOnce({ side: 0 }); // 0 defaults to left

      const result = await calculateHouseNumber(
        { lon: 32.5814, lat: 0.3476 },
        '{"type":"LineString","coordinates":[[32.58,0.34],[32.59,0.35]]}'
      );

      // Position defaults to 0.5, side 0 defaults to left: (50 * 2 + 1) * 5 = 505
      expect(result).toBe(505);
    });

    it('should allocate numbers progressively along the street', async () => {
      // Building near start of street (position 0.1)
      mockQueryOne.mockResolvedValueOnce({ position: 0.1 });
      mockQueryOne.mockResolvedValueOnce({ side: 1 }); // left

      const resultNearStart = await calculateHouseNumber(
        { lon: 32.58, lat: 0.34 },
        '{"type":"LineString","coordinates":[[32.58,0.34],[32.59,0.35]]}'
      );

      // Building near end of street (position 0.9)
      mockQueryOne.mockResolvedValueOnce({ position: 0.9 });
      mockQueryOne.mockResolvedValueOnce({ side: 1 }); // left

      const resultNearEnd = await calculateHouseNumber(
        { lon: 32.59, lat: 0.35 },
        '{"type":"LineString","coordinates":[[32.58,0.34],[32.59,0.35]]}'
      );

      // Start: (10 * 2 + 1) * 5 = 105, End: (90 * 2 + 1) * 5 = 905
      expect(resultNearStart).toBe(105);
      expect(resultNearEnd).toBe(905);
      expect(resultNearEnd).toBeGreaterThan(resultNearStart);
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
        .mockResolvedValueOnce(mockStreet)    // findNearestOsmStreet
        .mockResolvedValueOnce({ position: 0.3 })  // calculateHouseNumber position
        .mockResolvedValueOnce({ side: 1 });       // determineSideOfStreet

      const result = await assignCommunityAddress({ lon: 32.5814, lat: 0.3476 });

      expect(result.street_source).toBe('osm');
      expect(result.street_name).toBe('Kampala Road');
      expect(result.street_id).toBe('123456');
      expect(result.algorithm_version).toBe('v3.0');
      // Format: <HOUSE_NUMBER> <STREET_NAME>, <REGION_NAME>, Uganda
      expect(result.full_address).toContain('Kampala Road, Kampala, Uganda');
      // Position 0.3, left side: (30 * 2 + 1) * 5 = 305
      expect(result.house_number).toBe(305);
    });

    it('should use placeholder street when OSM street is too far', async () => {
      const mockStreet = {
        osm_id: 123456,
        name: 'Far Road',
        geometry: '{"type":"LineString","coordinates":[[32.58,0.34],[32.59,0.35]]}',
        distance_m: 150,
      };

      // Return placeholder with new format
      const mockPlaceholder = {
        placeholder_id: 'KAM-C-99005',
        display_name: 'C-99005',
        region_code: 'KAM',
        subregion_code: 'C',
        geometry: '{"type":"LineString","coordinates":[[32.58,0.34],[32.58,0.35]]}',
      };

      mockQueryOne
        .mockResolvedValueOnce(mockStreet)         // findNearestOsmStreet (too far)
        .mockResolvedValueOnce(mockPlaceholder)    // getOrCreatePlaceholderStreet upsert
        .mockResolvedValueOnce({ position: 0.5 })  // calculateHouseNumber position
        .mockResolvedValueOnce({ side: -1 });      // determineSideOfStreet (right)

      const result = await assignCommunityAddress({ lon: 32.5814, lat: 0.3476 });

      expect(result.street_source).toBe('placeholder');
      // New format: <SUBREGION>-<NUMBER> (e.g., "C-99005")
      expect(result.street_name).toMatch(/^[A-Z]{1,2}-\d+$/);
      // Position 0.5, right side: (50 * 2 + 2) * 5 = 510
      expect(result.house_number).toBe(510);
    });

    it('should assign odd numbers for left side and even for right side', async () => {
      const mockStreet = {
        osm_id: 123456,
        name: 'Test Road',
        geometry: '{"type":"LineString","coordinates":[[32.58,0.34],[32.59,0.35]]}',
        distance_m: 50,
      };

      // Building on left side
      mockQueryOne
        .mockResolvedValueOnce(mockStreet)
        .mockResolvedValueOnce({ position: 0.2 })
        .mockResolvedValueOnce({ side: 1 });  // left

      const leftResult = await assignCommunityAddress({ lon: 32.5814, lat: 0.3476 });

      // Building on right side
      mockQueryOne
        .mockResolvedValueOnce(mockStreet)
        .mockResolvedValueOnce({ position: 0.2 })
        .mockResolvedValueOnce({ side: -1 });  // right

      const rightResult = await assignCommunityAddress({ lon: 32.5814, lat: 0.3476 });

      // Left: (20 * 2 + 1) * 5 = 205 (odd multiple of 5)
      expect(leftResult.house_number).toBe(205);
      expect((leftResult.house_number / 5) % 2).toBe(1);

      // Right: (20 * 2 + 2) * 5 = 210 (even multiple of 5)
      expect(rightResult.house_number).toBe(210);
      expect((rightResult.house_number / 5) % 2).toBe(0);
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
