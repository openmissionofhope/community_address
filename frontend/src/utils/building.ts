/**
 * @fileoverview Utility functions for safely handling building data.
 * These functions ensure null-safety when accessing building properties.
 */

import type { BuildingFeature } from '../types';

/**
 * Result of extracting building info for display.
 */
export interface BuildingDisplayInfo {
  houseNumber: string;
  street: string;
  shortAddress: string;
  addressType: 'official' | 'community';
  isOfficial: boolean;
}

/**
 * Safely extracts display information from a building feature.
 * Returns null if the building data is invalid or missing required fields.
 *
 * @param building - The building feature to extract info from
 * @returns Display info or null if invalid
 */
export function getBuildingDisplayInfo(building: BuildingFeature | null | undefined): BuildingDisplayInfo | null {
  if (!building) {
    return null;
  }

  if (!building.properties) {
    return null;
  }

  if (!building.properties.address) {
    return null;
  }

  const addr = building.properties.address;
  const houseNumber = String(addr.house_number ?? '');
  const street = String(addr.street ?? '');

  if (!houseNumber && !street) {
    return null;
  }

  const shortAddress = `${houseNumber} ${street}`.trim();
  const addressType = building.properties.address_type ?? 'community';
  const isOfficial = addressType === 'official';

  return {
    houseNumber,
    street,
    shortAddress,
    addressType,
    isOfficial,
  };
}

/**
 * Result of calculating building centroid.
 */
export interface BuildingCentroid {
  lat: number;
  lon: number;
}

/**
 * Safely calculates the centroid of a building geometry.
 * Handles both Polygon and MultiPolygon geometry types.
 * Returns null if the geometry is invalid or cannot be calculated.
 *
 * @param building - The building feature to calculate centroid for
 * @returns Centroid coordinates or null if invalid
 */
export function getBuildingCentroid(building: BuildingFeature | null | undefined): BuildingCentroid | null {
  if (!building) {
    return null;
  }

  if (!building.geometry) {
    return null;
  }

  const coords = building.geometry.coordinates;
  if (!coords || !Array.isArray(coords) || coords.length === 0) {
    return null;
  }

  try {
    const geoType = building.geometry.type;
    let ring: number[][];

    if (geoType === 'MultiPolygon') {
      // MultiPolygon: coordinates[polygon][ring][point]
      const firstPolygon = (coords as number[][][][])[0];
      if (!firstPolygon || !Array.isArray(firstPolygon) || firstPolygon.length === 0) {
        return null;
      }
      ring = firstPolygon[0];
    } else {
      // Polygon: coordinates[ring][point]
      ring = (coords as number[][][])[0];
    }

    if (!ring || !Array.isArray(ring) || ring.length === 0) {
      return null;
    }

    let sumLat = 0;
    let sumLon = 0;
    let count = 0;

    for (const point of ring) {
      if (Array.isArray(point) && point.length >= 2 && typeof point[0] === 'number' && typeof point[1] === 'number') {
        sumLon += point[0];
        sumLat += point[1];
        count++;
      }
    }

    if (count === 0) {
      return null;
    }

    return {
      lat: sumLat / count,
      lon: sumLon / count,
    };
  } catch {
    return null;
  }
}
