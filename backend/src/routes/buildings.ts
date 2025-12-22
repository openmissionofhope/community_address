import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query } from '../db/connection.js';
import { getBuildingWithAddress, assignCommunityAddress } from '../services/address.js';

const bboxSchema = z.string().regex(/^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/);

interface BboxQuery {
  bbox: string;
  limit?: string;
  include_official?: string;
}

interface BuildingParams {
  osm_type: string;
  osm_id: string;
}

export async function buildingsRoutes(fastify: FastifyInstance) {
  // GET /buildings?bbox=minLon,minLat,maxLon,maxLat
  fastify.get<{ Querystring: BboxQuery }>(
    '/buildings',
    async (request, reply) => {
      const { bbox, limit = '500', include_official = 'true' } = request.query;

      if (!bbox) {
        return reply.status(400).send({ error: 'bbox parameter is required' });
      }

      const parsed = bboxSchema.safeParse(bbox);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid bbox format. Use: minLon,minLat,maxLon,maxLat' });
      }

      const [minLon, minLat, maxLon, maxLat] = bbox.split(',').map(Number);
      const limitNum = Math.min(parseInt(limit), 2000);

      interface BuildingRow {
        osm_id: number;
        osm_type: string;
        geometry: string;
        centroid: string;
        addr_housenumber: string | null;
        addr_street: string | null;
        addr_city: string | null;
      }

      const buildings = await query<BuildingRow>(
        `SELECT
          osm_id,
          osm_type,
          ST_AsGeoJSON(geometry) as geometry,
          ST_AsGeoJSON(centroid) as centroid,
          addr_housenumber,
          addr_street,
          addr_city
        FROM buildings
        WHERE geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326)
        ${include_official === 'false' ? 'AND addr_housenumber IS NULL' : ''}
        LIMIT $5`,
        [minLon, minLat, maxLon, maxLat, limitNum]
      );

      const features = await Promise.all(
        buildings.map(async (b) => {
          const centroid = JSON.parse(b.centroid);

          let addressInfo;
          if (b.addr_housenumber && b.addr_street) {
            const parts = [b.addr_housenumber, b.addr_street, b.addr_city].filter(Boolean);
            addressInfo = {
              address_type: 'official',
              address: {
                house_number: b.addr_housenumber,
                street: b.addr_street,
                city: b.addr_city,
                full: parts.join(', '),
                source: 'osm',
              },
            };
          } else {
            const communityAddr = await assignCommunityAddress({
              lon: centroid.coordinates[0],
              lat: centroid.coordinates[1],
            });
            addressInfo = {
              address_type: 'community',
              address: {
                house_number: communityAddr.house_number,
                street: communityAddr.street_name,
                full: communityAddr.full_address,
                source: communityAddr.street_source,
                algorithm_version: communityAddr.algorithm_version,
              },
            };
          }

          return {
            type: 'Feature',
            id: `${b.osm_type}/${b.osm_id}`,
            geometry: JSON.parse(b.geometry),
            properties: {
              osm_id: b.osm_id,
              ...addressInfo,
            },
          };
        })
      );

      return {
        type: 'FeatureCollection',
        features,
        metadata: {
          bbox: [minLon, minLat, maxLon, maxLat],
          total: features.length,
          generated_at: new Date().toISOString(),
        },
      };
    }
  );

  // GET /buildings/:osm_type/:osm_id
  fastify.get<{ Params: BuildingParams }>(
    '/buildings/:osm_type/:osm_id',
    async (request, reply) => {
      const { osm_type, osm_id } = request.params;

      if (!['node', 'way', 'relation'].includes(osm_type)) {
        return reply.status(400).send({ error: 'Invalid osm_type. Must be node, way, or relation.' });
      }

      const osmIdNum = parseInt(osm_id);
      if (isNaN(osmIdNum)) {
        return reply.status(400).send({ error: 'Invalid osm_id' });
      }

      const building = await getBuildingWithAddress(osm_type, osmIdNum);

      if (!building) {
        return reply.status(404).send({ error: 'Building not found' });
      }

      return {
        type: 'Feature',
        id: `${osm_type}/${osm_id}`,
        geometry: building.geometry,
        properties: {
          osm_id: building.osm_id,
          address_type: building.address_type,
          address: building.address,
        },
      };
    }
  );
}
