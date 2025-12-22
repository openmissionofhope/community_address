import crypto from 'crypto';
import { query, queryOne } from '../db/connection.js';

const HOUSE_NUMBER_SPACING = 10;
const MAX_STREET_DISTANCE_METERS = 100;
const GRID_SIZE = 0.002; // ~200m at equator
const ALGORITHM_VERSION = 'v1.0';

interface Coordinate {
  lon: number;
  lat: number;
}

interface Street {
  osm_id: number;
  name: string;
  geometry: string;
  distance_m: number;
}

interface PlaceholderStreet {
  placeholder_id: string;
  display_name: string;
  geometry: string;
}

export interface CommunityAddress {
  house_number: number;
  street_name: string;
  street_source: 'osm' | 'placeholder';
  street_id: string;
  full_address: string;
  algorithm_version: string;
}

export interface BuildingAddress {
  osm_id: number;
  osm_type: string;
  address_type: 'official' | 'community';
  address: {
    house_number: string | number;
    street: string;
    city?: string;
    postcode?: string;
    full: string;
    source: 'osm' | 'placeholder';
    algorithm_version?: string;
  };
  geometry: unknown;
}

export async function findNearestOsmStreet(
  centroid: Coordinate
): Promise<Street | null> {
  const result = await queryOne<Street>(
    `SELECT
      osm_id,
      name,
      ST_AsGeoJSON(geometry) as geometry,
      ST_Distance(
        geometry::geography,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
      ) as distance_m
    FROM streets
    WHERE name IS NOT NULL
    ORDER BY geometry <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
    LIMIT 1`,
    [centroid.lon, centroid.lat]
  );
  return result;
}

export async function getOrCreatePlaceholderStreet(
  centroid: Coordinate,
  regionCode: string
): Promise<PlaceholderStreet> {
  const gridX = Math.floor(centroid.lon / GRID_SIZE);
  const gridY = Math.floor(centroid.lat / GRID_SIZE);

  const placeholderId = `${regionCode}-${gridX.toString(16).toUpperCase().padStart(4, '0')}${gridY.toString(16).toUpperCase().padStart(4, '0')}`;

  const existing = await queryOne<PlaceholderStreet>(
    'SELECT placeholder_id, display_name, ST_AsGeoJSON(geometry) as geometry FROM placeholder_streets WHERE placeholder_id = $1',
    [placeholderId]
  );

  if (existing) {
    return existing;
  }

  const displayName = `Community Placeholder ${placeholderId}`;
  const cellCenterX = (gridX + 0.5) * GRID_SIZE;
  const cellCenterY = (gridY + 0.5) * GRID_SIZE;

  await query(
    `INSERT INTO placeholder_streets (placeholder_id, geometry, display_name, region_code)
     VALUES ($1, ST_GeomFromText($2, 4326), $3, $4)`,
    [
      placeholderId,
      `LINESTRING(${cellCenterX} ${cellCenterY - GRID_SIZE / 2}, ${cellCenterX} ${cellCenterY + GRID_SIZE / 2})`,
      displayName,
      regionCode,
    ]
  );

  return {
    placeholder_id: placeholderId,
    display_name: displayName,
    geometry: JSON.stringify({
      type: 'LineString',
      coordinates: [
        [cellCenterX, cellCenterY - GRID_SIZE / 2],
        [cellCenterX, cellCenterY + GRID_SIZE / 2],
      ],
    }),
  };
}

export async function calculateHouseNumber(
  centroid: Coordinate,
  streetGeometry: string,
  streetId: string,
  streetSource: 'osm' | 'placeholder'
): Promise<number> {
  const positionResult = await queryOne<{ position: number }>(
    `SELECT ST_LineLocatePoint(
      ST_GeomFromGeoJSON($1),
      ST_SetSRID(ST_MakePoint($2, $3), 4326)
    ) as position`,
    [streetGeometry, centroid.lon, centroid.lat]
  );

  const position = positionResult?.position ?? 0.5;

  // Deterministic hash for tie-breaking
  const hashInput = `${centroid.lon.toFixed(8)},${centroid.lat.toFixed(8)}`;
  const hash = crypto.createHash('md5').update(hashInput).digest('hex');
  const hashSuffix = parseInt(hash.substring(0, 4), 16) % 10;

  // Base slot from position (0-99), then spacing
  const baseSlot = Math.floor(position * 100);
  const houseNumber = (baseSlot + 1) * HOUSE_NUMBER_SPACING;

  return Math.max(10, houseNumber);
}

export async function assignCommunityAddress(
  buildingCentroid: Coordinate,
  regionCode: string = 'KLA'
): Promise<CommunityAddress> {
  // Step 1: Find nearest OSM street
  const street = await findNearestOsmStreet(buildingCentroid);

  let streetName: string;
  let streetSource: 'osm' | 'placeholder';
  let streetId: string;
  let streetGeometry: string;

  if (street && street.distance_m <= MAX_STREET_DISTANCE_METERS && street.name) {
    streetName = street.name;
    streetSource = 'osm';
    streetId = street.osm_id.toString();
    streetGeometry = street.geometry;
  } else {
    // Step 2: Get or create placeholder street
    const placeholder = await getOrCreatePlaceholderStreet(
      buildingCentroid,
      regionCode
    );
    streetName = placeholder.display_name;
    streetSource = 'placeholder';
    streetId = placeholder.placeholder_id;
    streetGeometry = placeholder.geometry;
  }

  // Step 3: Calculate house number
  const houseNumber = await calculateHouseNumber(
    buildingCentroid,
    streetGeometry,
    streetId,
    streetSource
  );

  // Step 4: Format address
  const fullAddress = `${houseNumber} ${streetName} [Unofficial / Community Address]`;

  return {
    house_number: houseNumber,
    street_name: streetName,
    street_source: streetSource,
    street_id: streetId,
    full_address: fullAddress,
    algorithm_version: ALGORITHM_VERSION,
  };
}

export async function getBuildingWithAddress(
  osmType: string,
  osmId: number
): Promise<BuildingAddress | null> {
  interface BuildingRow {
    osm_id: number;
    osm_type: string;
    geometry: string;
    centroid: string;
    addr_housenumber: string | null;
    addr_street: string | null;
    addr_city: string | null;
    addr_postcode: string | null;
  }

  const building = await queryOne<BuildingRow>(
    `SELECT
      osm_id,
      osm_type,
      ST_AsGeoJSON(geometry) as geometry,
      ST_AsGeoJSON(centroid) as centroid,
      addr_housenumber,
      addr_street,
      addr_city,
      addr_postcode
    FROM buildings
    WHERE osm_type = $1 AND osm_id = $2`,
    [osmType, osmId]
  );

  if (!building) {
    return null;
  }

  // If official address exists, return it
  if (building.addr_housenumber && building.addr_street) {
    const parts = [
      building.addr_housenumber,
      building.addr_street,
      building.addr_city,
    ].filter(Boolean);

    return {
      osm_id: building.osm_id,
      osm_type: building.osm_type,
      address_type: 'official',
      address: {
        house_number: building.addr_housenumber,
        street: building.addr_street,
        city: building.addr_city ?? undefined,
        postcode: building.addr_postcode ?? undefined,
        full: parts.join(', '),
        source: 'osm',
      },
      geometry: JSON.parse(building.geometry),
    };
  }

  // Generate community address
  const centroid = JSON.parse(building.centroid);
  const coords: Coordinate = {
    lon: centroid.coordinates[0],
    lat: centroid.coordinates[1],
  };

  const communityAddr = await assignCommunityAddress(coords);

  return {
    osm_id: building.osm_id,
    osm_type: building.osm_type,
    address_type: 'community',
    address: {
      house_number: communityAddr.house_number,
      street: communityAddr.street_name,
      full: communityAddr.full_address,
      source: communityAddr.street_source,
      algorithm_version: communityAddr.algorithm_version,
    },
    geometry: JSON.parse(building.geometry),
  };
}
