/**
 * @fileoverview Region routes for the Community Address API.
 * Provides endpoints for querying geographic regions with building statistics.
 * Regions are organized hierarchically (country, district, city, etc.).
 */

import { FastifyInstance } from 'fastify';
import { query } from '../db/connection.js';

/**
 * Query parameters for the regions endpoint.
 * @interface RegionsQuery
 */
interface RegionsQuery {
  parent?: string;
  level?: string;
}

/**
 * Query parameters for the regions GeoJSON endpoint.
 * @interface RegionsGeoJsonQuery
 */
interface RegionsGeoJsonQuery {
  country?: string;
  level?: string;
}

/**
 * Database row structure for region queries.
 * @interface RegionRow
 */
interface RegionRow {
  code: string;
  name: string;
  level: number;
  parent_code: string | null;
  centroid_lon: number;
  centroid_lat: number;
  building_count: string;
  community_address_count: string;
}

/**
 * Registers region-related routes with the Fastify instance.
 *
 * Routes:
 * - GET /regions - Retrieve regions with optional filtering
 *
 * @param {FastifyInstance} fastify - The Fastify server instance
 * @returns {Promise<void>}
 *
 * @example
 * // Register routes
 * await fastify.register(regionsRoutes);
 *
 * @example
 * // Query child regions of a parent
 * // GET /regions?parent=KLA
 *
 * @example
 * // Query regions at a specific level
 * // GET /regions?level=2
 */
export async function regionsRoutes(fastify: FastifyInstance) {
  /**
   * GET /regions
   * Retrieves a list of geographic regions with building statistics.
   * Regions can be filtered by parent code and/or administrative level.
   *
   * @queryParam {string} [parent] - Filter by parent region code
   * @queryParam {string} [level] - Filter by administrative level (0=country, 1=district, etc.)
   * @returns {Object} Object containing array of regions with statistics
   */
  fastify.get<{ Querystring: RegionsQuery }>('/regions', async (request, _reply) => {
    const { parent, level } = request.query;

    let whereClause = '';
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (parent) {
      whereClause += ` AND r.parent_code = $${paramIndex}`;
      params.push(parent);
      paramIndex++;
    }

    if (level !== undefined) {
      whereClause += ` AND r.level = $${paramIndex}`;
      params.push(parseInt(level));
      paramIndex++;
    }

    const regions = await query<RegionRow>(
      `SELECT
        r.code,
        r.name,
        r.level,
        r.parent_code,
        ST_X(r.centroid) as centroid_lon,
        ST_Y(r.centroid) as centroid_lat,
        COALESCE(
          (SELECT COUNT(*) FROM buildings b
           WHERE r.geometry IS NULL OR ST_Contains(r.geometry, b.centroid)),
          0
        ) as building_count,
        COALESCE(
          (SELECT COUNT(*) FROM buildings b
           WHERE b.addr_housenumber IS NULL
           AND (r.geometry IS NULL OR ST_Contains(r.geometry, b.centroid))),
          0
        ) as community_address_count
      FROM regions r
      WHERE 1=1 ${whereClause}
      ORDER BY r.level, r.name`,
      params
    );

    return {
      regions: regions.map((r) => ({
        code: r.code,
        name: r.name,
        level: r.level,
        parent_code: r.parent_code,
        centroid: r.centroid_lon && r.centroid_lat
          ? [r.centroid_lon, r.centroid_lat]
          : null,
        building_count: parseInt(r.building_count),
        community_address_count: parseInt(r.community_address_count),
      })),
    };
  });

  /**
   * GET /regions/geojson
   * Retrieves regions as GeoJSON FeatureCollection for map display.
   * Creates circular boundaries from region centroids.
   *
   * @queryParam {string} [country='UG'] - Country code to filter regions
   * @queryParam {string} [level='1'] - Level to return (1=regions, 2=subregions)
   * @returns {Object} GeoJSON FeatureCollection with region polygons
   */
  fastify.get<{ Querystring: RegionsGeoJsonQuery }>(
    '/regions/geojson',
    async (request, _reply) => {
      const { country = 'UG', level = '1' } = request.query;
      const levelNum = parseInt(level);

      interface RegionGeoRow {
        code: string;
        name: string;
        level: number;
        parent_code: string | null;
        centroid_lon: number;
        centroid_lat: number;
        geometry_json: string | null;
      }

      // Default radius in km based on level
      const radiusKm = levelNum === 1 ? 40 : 15;

      const regions = await query<RegionGeoRow>(
        `SELECT
          r.code,
          r.name,
          r.level,
          r.parent_code,
          ST_X(r.centroid) as centroid_lon,
          ST_Y(r.centroid) as centroid_lat,
          CASE
            WHEN r.geometry IS NOT NULL THEN ST_AsGeoJSON(r.geometry)
            ELSE NULL
          END as geometry_json
        FROM regions r
        WHERE r.level = $1
          AND (
            r.parent_code = $2
            OR EXISTS (
              SELECT 1 FROM regions p
              WHERE p.code = r.parent_code
              AND p.parent_code = $2
            )
          )
        ORDER BY r.name`,
        [levelNum, country]
      );

      // Create circular polygon from centroid
      const createCircle = (lon: number, lat: number, radiusKm: number): number[][][] => {
        const coords: number[][] = [];
        const numPoints = 32;
        // Convert km to degrees (approximate)
        const radiusDeg = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

        for (let i = 0; i <= numPoints; i++) {
          const angle = (2 * Math.PI * i) / numPoints;
          coords.push([
            Math.round((lon + radiusDeg * Math.cos(angle)) * 1000000) / 1000000,
            Math.round((lat + radiusDeg * Math.sin(angle) * 0.9) * 1000000) / 1000000,
          ]);
        }
        return [coords];
      };

      const features = regions
        .filter((r) => r.centroid_lon && r.centroid_lat)
        .map((r) => {
          let geometry;
          if (r.geometry_json) {
            geometry = JSON.parse(r.geometry_json);
          } else {
            geometry = {
              type: 'Polygon',
              coordinates: createCircle(r.centroid_lon, r.centroid_lat, radiusKm),
            };
          }

          return {
            type: 'Feature',
            id: r.code,
            properties: {
              code: r.code,
              name: r.name,
              level: r.level,
              parent_code: r.parent_code,
            },
            geometry,
          };
        });

      return {
        type: 'FeatureCollection',
        features,
      };
    }
  );
}
