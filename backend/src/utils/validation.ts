/**
 * @fileoverview Shared validation utilities for request parameters.
 */

import { z } from 'zod';

/** Maximum bbox size in degrees (~11km at equator) */
export const MAX_BBOX_SIZE_DEG = 0.1;

/** Maximum number of results to return from bbox queries */
export const MAX_BBOX_RESULTS = 500;

/** Schema for validating bbox query parameter format */
export const bboxSchema = z.string().regex(/^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/);

/**
 * Parses and validates a bbox string.
 * Returns parsed coordinates or an error message.
 */
export function parseBbox(bbox: string): {
  valid: true;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
} | {
  valid: false;
  error: string;
} {
  const parsed = bboxSchema.safeParse(bbox);
  if (!parsed.success) {
    return { valid: false, error: 'Invalid bbox format. Use: minLon,minLat,maxLon,maxLat' };
  }

  const [minLon, minLat, maxLon, maxLat] = bbox.split(',').map(Number);

  // Validate coordinate ranges
  if (minLon < -180 || maxLon > 180) {
    return { valid: false, error: 'Longitude must be between -180 and 180' };
  }
  if (minLat < -90 || maxLat > 90) {
    return { valid: false, error: 'Latitude must be between -90 and 90' };
  }

  // Validate bbox is not inverted
  if (minLon >= maxLon || minLat >= maxLat) {
    return { valid: false, error: 'Invalid bbox: min values must be less than max values' };
  }

  // Validate bbox size
  const lonSize = maxLon - minLon;
  const latSize = maxLat - minLat;

  if (lonSize > MAX_BBOX_SIZE_DEG || latSize > MAX_BBOX_SIZE_DEG) {
    return {
      valid: false,
      error: `Bbox too large. Maximum size is ${MAX_BBOX_SIZE_DEG} degrees (~${Math.round(MAX_BBOX_SIZE_DEG * 111)}km). Zoom in further.`
    };
  }

  return { valid: true, minLon, minLat, maxLon, maxLat };
}
