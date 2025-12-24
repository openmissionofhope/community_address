/**
 * @fileoverview Address assignment service for Community Address system.
 * Implements the algorithm for generating community addresses for buildings
 * that lack official addresses in OpenStreetMap data. Uses a deterministic
 * approach based on geographic location to ensure consistent address assignment.
 */

import crypto from 'crypto';
import { query, queryOne } from '../db/connection.js';

/** Spacing between consecutive house numbers on a street */
const HOUSE_NUMBER_SPACING = 10;

/** Maximum distance in meters to associate a building with a named street */
const MAX_STREET_DISTANCE_METERS = 100;

/** Grid cell size in degrees for placeholder street generation (~200m at equator) */
const GRID_SIZE = 0.002;

/** Current version of the address assignment algorithm */
const ALGORITHM_VERSION = 'v1.0';

/**
 * Represents a geographic coordinate point.
 * @interface Coordinate
 * @property {number} lon - Longitude in degrees (-180 to 180)
 * @property {number} lat - Latitude in degrees (-90 to 90)
 */
interface Coordinate {
  lon: number;
  lat: number;
}

/**
 * Represents a street from OpenStreetMap data.
 * @interface Street
 * @property {number} osm_id - OpenStreetMap unique identifier
 * @property {string} name - Street name
 * @property {string} geometry - GeoJSON representation of the street geometry
 * @property {number} distance_m - Distance from the query point in meters
 */
interface Street {
  osm_id: number;
  name: string;
  geometry: string;
  distance_m: number;
}

/**
 * Represents a placeholder street for areas without named OSM streets.
 * @interface PlaceholderStreet
 * @property {string} placeholder_id - Unique identifier based on grid cell
 * @property {string} display_name - Human-readable name for the placeholder
 * @property {string} geometry - GeoJSON representation of the placeholder geometry
 */
interface PlaceholderStreet {
  placeholder_id: string;
  display_name: string;
  geometry: string;
}

/**
 * Represents a generated community address for a building.
 * @interface CommunityAddress
 * @property {number} house_number - The assigned house number
 * @property {string} street_name - Name of the associated street
 * @property {'osm' | 'placeholder'} street_source - Whether the street came from OSM or was generated
 * @property {string} street_id - Unique identifier for the street
 * @property {string} full_address - Complete formatted address string
 * @property {string} algorithm_version - Version of the algorithm used to generate the address
 */
export interface CommunityAddress {
  house_number: number;
  street_name: string;
  street_source: 'osm' | 'placeholder';
  street_id: string;
  full_address: string;
  algorithm_version: string;
}

/**
 * Represents a building with its address information.
 * @interface BuildingAddress
 * @property {number} osm_id - OpenStreetMap unique identifier
 * @property {string} osm_type - Type of OSM element (node, way, or relation)
 * @property {'official' | 'community'} address_type - Whether the address is from OSM or community-generated
 * @property {object} address - The address details
 * @property {string|number} address.house_number - House or building number
 * @property {string} address.street - Street name
 * @property {string} [address.city] - City name (optional)
 * @property {string} [address.postcode] - Postal code (optional)
 * @property {string} address.full - Full formatted address string
 * @property {'osm' | 'placeholder'} address.source - Source of the street name
 * @property {string} [address.algorithm_version] - Algorithm version for community addresses
 * @property {unknown} geometry - GeoJSON geometry of the building
 */
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

/**
 * Finds the nearest named street from OpenStreetMap data to a given coordinate.
 * Uses PostGIS spatial indexing for efficient nearest-neighbor search.
 *
 * @param {Coordinate} centroid - The geographic point to search from
 * @returns {Promise<Street | null>} The nearest street with distance, or null if none found
 *
 * @example
 * const street = await findNearestOsmStreet({ lon: 32.5814, lat: 0.3476 });
 * if (street && street.distance_m < 100) {
 *   console.log(`Nearest street: ${street.name} at ${street.distance_m}m`);
 * }
 */
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

/**
 * Gets or creates a placeholder street for buildings not near any named OSM street.
 * Placeholder streets are virtual streets based on a grid system, ensuring
 * consistent addressing within geographic cells.
 *
 * @param {Coordinate} centroid - The building's geographic center point
 * @param {string} regionCode - The region code to include in the placeholder ID (e.g., 'KLA')
 * @returns {Promise<PlaceholderStreet>} The existing or newly created placeholder street
 *
 * @example
 * const placeholder = await getOrCreatePlaceholderStreet(
 *   { lon: 32.5814, lat: 0.3476 },
 *   'KLA'
 * );
 * // Returns: { placeholder_id: 'KLA-3F9A00AB', display_name: 'Community Placeholder KLA-3F9A00AB', ... }
 */
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

/**
 * Calculates a deterministic house number for a building based on its
 * position along a street. Uses linear referencing to determine the
 * building's relative position and applies consistent spacing.
 *
 * @param {Coordinate} centroid - The building's geographic center point
 * @param {string} streetGeometry - GeoJSON string of the street geometry
 * @param {string} streetId - Identifier of the street (for future use)
 * @param {'osm' | 'placeholder'} streetSource - Source of the street data
 * @returns {Promise<number>} A house number (minimum 10, in increments of HOUSE_NUMBER_SPACING)
 *
 * @example
 * const houseNumber = await calculateHouseNumber(
 *   { lon: 32.5814, lat: 0.3476 },
 *   '{"type":"LineString","coordinates":[[32.58,0.34],[32.59,0.35]]}',
 *   '12345',
 *   'osm'
 * );
 * // Returns a number like 340, 350, 360, etc.
 */
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

/**
 * Assigns a community address to a building that lacks an official address.
 * This is the main entry point for the address assignment algorithm.
 *
 * Algorithm steps:
 * 1. Find the nearest named OSM street within MAX_STREET_DISTANCE_METERS
 * 2. If no street found, create/get a placeholder street based on grid cell
 * 3. Calculate a deterministic house number based on position along the street
 * 4. Format and return the complete address
 *
 * @param {Coordinate} buildingCentroid - The building's geographic center point
 * @param {string} [regionCode='KLA'] - Region code for placeholder street naming
 * @returns {Promise<CommunityAddress>} The generated community address
 *
 * @example
 * const address = await assignCommunityAddress({ lon: 32.5814, lat: 0.3476 });
 * console.log(address.full_address);
 * // Output: "340 Kampala Road [Unofficial / Community Address]"
 */
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

/**
 * Retrieves a building by its OSM identifier and returns it with address information.
 * If the building has an official OSM address, returns that. Otherwise,
 * generates and returns a community address.
 *
 * @param {string} osmType - The OSM element type ('node', 'way', or 'relation')
 * @param {number} osmId - The OSM unique identifier
 * @returns {Promise<BuildingAddress | null>} Building with address info, or null if not found
 *
 * @example
 * const building = await getBuildingWithAddress('way', 123456789);
 * if (building) {
 *   console.log(building.address_type); // 'official' or 'community'
 *   console.log(building.address.full);
 * }
 */
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
