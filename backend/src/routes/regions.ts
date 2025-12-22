import { FastifyInstance } from 'fastify';
import { query } from '../db/connection.js';

interface RegionsQuery {
  parent?: string;
  level?: string;
}

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

export async function regionsRoutes(fastify: FastifyInstance) {
  // GET /regions
  fastify.get<{ Querystring: RegionsQuery }>('/regions', async (request, reply) => {
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
}
