import { describe, it, expect } from 'vitest';
import { getBuildingDisplayInfo, getBuildingCentroid } from './building';
import type { BuildingFeature } from '../types';

// Helper to create a valid building feature
function createBuilding(overrides: Partial<BuildingFeature> = {}): BuildingFeature {
  return {
    type: 'Feature',
    id: 'way/123',
    geometry: {
      type: 'MultiPolygon',
      coordinates: [[[[32.58, 0.34], [32.59, 0.34], [32.59, 0.35], [32.58, 0.35], [32.58, 0.34]]]],
    },
    properties: {
      osm_id: 123,
      address_type: 'community',
      address: {
        house_number: 100,
        street: 'Test Street',
        full: '100 Test Street',
        source: 'osm',
      },
    },
    ...overrides,
  };
}

describe('getBuildingDisplayInfo', () => {
  it('returns null for null building', () => {
    expect(getBuildingDisplayInfo(null)).toBeNull();
  });

  it('returns null for undefined building', () => {
    expect(getBuildingDisplayInfo(undefined)).toBeNull();
  });

  it('returns null for building without properties', () => {
    const building = createBuilding();
    // @ts-expect-error - Testing invalid data
    building.properties = undefined;
    expect(getBuildingDisplayInfo(building)).toBeNull();
  });

  it('returns null for building without address', () => {
    const building = createBuilding();
    // @ts-expect-error - Testing invalid data
    building.properties.address = undefined;
    expect(getBuildingDisplayInfo(building)).toBeNull();
  });

  it('returns null for building with empty address fields', () => {
    const building = createBuilding();
    building.properties.address.house_number = '';
    building.properties.address.street = '';
    expect(getBuildingDisplayInfo(building)).toBeNull();
  });

  it('extracts info from valid community building', () => {
    const building = createBuilding();
    const info = getBuildingDisplayInfo(building);

    expect(info).not.toBeNull();
    expect(info!.houseNumber).toBe('100');
    expect(info!.street).toBe('Test Street');
    expect(info!.shortAddress).toBe('100 Test Street');
    expect(info!.addressType).toBe('community');
    expect(info!.isOfficial).toBe(false);
  });

  it('extracts info from valid official building', () => {
    const building = createBuilding();
    building.properties.address_type = 'official';
    const info = getBuildingDisplayInfo(building);

    expect(info).not.toBeNull();
    expect(info!.addressType).toBe('official');
    expect(info!.isOfficial).toBe(true);
  });

  it('handles numeric house number', () => {
    const building = createBuilding();
    building.properties.address.house_number = 42;
    const info = getBuildingDisplayInfo(building);

    expect(info).not.toBeNull();
    expect(info!.houseNumber).toBe('42');
  });

  it('handles string house number', () => {
    const building = createBuilding();
    building.properties.address.house_number = '42A';
    const info = getBuildingDisplayInfo(building);

    expect(info).not.toBeNull();
    expect(info!.houseNumber).toBe('42A');
  });

  it('handles missing house number with valid street', () => {
    const building = createBuilding();
    // @ts-expect-error - Testing edge case
    building.properties.address.house_number = null;
    const info = getBuildingDisplayInfo(building);

    expect(info).not.toBeNull();
    expect(info!.houseNumber).toBe('');
    expect(info!.shortAddress).toBe('Test Street');
  });

  it('handles missing street with valid house number', () => {
    const building = createBuilding();
    // @ts-expect-error - Testing edge case
    building.properties.address.street = null;
    const info = getBuildingDisplayInfo(building);

    expect(info).not.toBeNull();
    expect(info!.street).toBe('');
    expect(info!.shortAddress).toBe('100');
  });

  it('defaults to community when address_type is missing', () => {
    const building = createBuilding();
    // @ts-expect-error - Testing edge case
    building.properties.address_type = undefined;
    const info = getBuildingDisplayInfo(building);

    expect(info).not.toBeNull();
    expect(info!.addressType).toBe('community');
    expect(info!.isOfficial).toBe(false);
  });
});

describe('getBuildingCentroid', () => {
  it('returns null for null building', () => {
    expect(getBuildingCentroid(null)).toBeNull();
  });

  it('returns null for undefined building', () => {
    expect(getBuildingCentroid(undefined)).toBeNull();
  });

  it('returns null for building without geometry', () => {
    const building = createBuilding();
    // @ts-expect-error - Testing invalid data
    building.geometry = undefined;
    expect(getBuildingCentroid(building)).toBeNull();
  });

  it('returns null for building with empty coordinates', () => {
    const building = createBuilding();
    building.geometry.coordinates = [];
    expect(getBuildingCentroid(building)).toBeNull();
  });

  it('returns null for building with null coordinates', () => {
    const building = createBuilding();
    // @ts-expect-error - Testing invalid data
    building.geometry.coordinates = null;
    expect(getBuildingCentroid(building)).toBeNull();
  });

  it('calculates centroid for MultiPolygon', () => {
    const building = createBuilding();
    building.geometry.type = 'MultiPolygon';
    // Square from (0,0) to (2,2)
    building.geometry.coordinates = [[[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]];

    const centroid = getBuildingCentroid(building);

    expect(centroid).not.toBeNull();
    // Centroid of square corners: (0+2+2+0+0)/5, (0+0+2+2+0)/5 = (0.8, 0.8)
    expect(centroid!.lon).toBeCloseTo(0.8, 5);
    expect(centroid!.lat).toBeCloseTo(0.8, 5);
  });

  it('calculates centroid for Polygon', () => {
    const building = createBuilding();
    building.geometry.type = 'Polygon';
    // Square from (0,0) to (2,2)
    building.geometry.coordinates = [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]];

    const centroid = getBuildingCentroid(building);

    expect(centroid).not.toBeNull();
    expect(centroid!.lon).toBeCloseTo(0.8, 5);
    expect(centroid!.lat).toBeCloseTo(0.8, 5);
  });

  it('handles MultiPolygon with invalid first polygon', () => {
    const building = createBuilding();
    building.geometry.type = 'MultiPolygon';
    // @ts-expect-error - Testing invalid data
    building.geometry.coordinates = [null];
    expect(getBuildingCentroid(building)).toBeNull();
  });

  it('handles Polygon with invalid ring', () => {
    const building = createBuilding();
    building.geometry.type = 'Polygon';
    // @ts-expect-error - Testing invalid data
    building.geometry.coordinates = [null];
    expect(getBuildingCentroid(building)).toBeNull();
  });

  it('handles ring with invalid points', () => {
    const building = createBuilding();
    building.geometry.type = 'Polygon';
    // @ts-expect-error - Testing invalid data
    building.geometry.coordinates = [[null, 'invalid', [1], [1, 2]]];

    const centroid = getBuildingCentroid(building);

    // Should only count the valid point [1, 2]
    expect(centroid).not.toBeNull();
    expect(centroid!.lon).toBe(1);
    expect(centroid!.lat).toBe(2);
  });

  it('returns null when all points are invalid', () => {
    const building = createBuilding();
    building.geometry.type = 'Polygon';
    // @ts-expect-error - Testing invalid data
    building.geometry.coordinates = [[null, 'invalid', [1]]];
    expect(getBuildingCentroid(building)).toBeNull();
  });

  it('handles real-world coordinate values', () => {
    const building = createBuilding();
    // Real coordinates from Kampala, Uganda
    building.geometry.coordinates = [[[[32.5822368, 0.3496385], [32.5820933, 0.349649], [32.5820887, 0.349586], [32.5822323, 0.3495756], [32.5822368, 0.3496385]]]];

    const centroid = getBuildingCentroid(building);

    expect(centroid).not.toBeNull();
    expect(centroid!.lon).toBeGreaterThan(32);
    expect(centroid!.lon).toBeLessThan(33);
    expect(centroid!.lat).toBeGreaterThan(0);
    expect(centroid!.lat).toBeLessThan(1);
  });
});
