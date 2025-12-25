/**
 * @fileoverview Address assignment service for Community Address system.
 * Implements the algorithm for generating community addresses for buildings
 * that lack official addresses in OpenStreetMap data. Uses a deterministic
 * approach based on geographic location to ensure consistent address assignment.
 *
 * House Number Allocation Rules (v2.0):
 * - Numbers are allocated in multiples of 5 (5, 10, 15, 20, ...)
 * - Buildings on the LEFT side of the road receive ODD multiples (5, 15, 25, 35, ...)
 * - Buildings on the RIGHT side of the road receive EVEN multiples (10, 20, 30, 40, ...)
 * - Numbers increase progressively from the start to the end of the road
 * - Side determination uses cross product of road direction and building position
 */

import { queryOne } from '../db/connection.js';

/** Spacing between consecutive house numbers on a street (multiples of 5) */
const HOUSE_NUMBER_SPACING = 5;

/** Maximum distance in meters to associate a building with a named street */
const MAX_STREET_DISTANCE_METERS = 100;

/** Grid cell size in degrees for placeholder street generation (~200m at equator) */
const GRID_SIZE = 0.002;

/** Current version of the address assignment algorithm */
const ALGORITHM_VERSION = 'v3.0';

/**
 * Country configuration for the addressing system.
 */
const COUNTRY = {
  name: 'Uganda',
  code: 'UG',
};

/**
 * Regions based on major population centers.
 * Each region has a 3-letter code, center coordinates, and radius.
 */
const REGIONS: Record<string, { name: string; center: [number, number]; radius_km: number }> = {
  KAM: { name: 'Kampala', center: [32.5825, 0.3476], radius_km: 35 },
  JIN: { name: 'Jinja', center: [33.2041, 0.4244], radius_km: 40 },
  MBA: { name: 'Mbarara', center: [30.6545, -0.6072], radius_km: 50 },
  GUL: { name: 'Gulu', center: [32.2997, 2.7747], radius_km: 55 },
  ARU: { name: 'Arua', center: [30.9110, 3.0303], radius_km: 50 },
  MBL: { name: 'Mbale', center: [34.1750, 1.0821], radius_km: 45 },
  LIR: { name: 'Lira', center: [32.5400, 2.2347], radius_km: 50 },
  FTP: { name: 'Fort Portal', center: [30.2750, 0.6710], radius_km: 45 },
  MSK: { name: 'Masaka', center: [31.7350, -0.3136], radius_km: 40 },
  SOR: { name: 'Soroti', center: [33.6173, 1.7147], radius_km: 45 },
  HMA: { name: 'Hoima', center: [31.3522, 1.4331], radius_km: 50 },
  KBL: { name: 'Kabale', center: [29.9833, -1.2500], radius_km: 40 },
};

/**
 * Subregion codes (directional) for each region.
 * C=Central, N=North, S=South, E=East, W=West, NW/NE/SW/SE for diagonals.
 */
type SubregionCode = 'C' | 'N' | 'S' | 'E' | 'W' | 'NW' | 'NE' | 'SW' | 'SE';

/**
 * Calculates the distance between two coordinates in kilometers.
 * Uses the Haversine formula for accuracy.
 */
function haversineDistance(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Determines the region code for a given coordinate.
 * Returns the closest region if within any region's radius, otherwise defaults to nearest.
 */
function determineRegion(lon: number, lat: number): string {
  let closestRegion = 'KAM';
  let closestDistance = Infinity;

  for (const [code, info] of Object.entries(REGIONS)) {
    const distance = haversineDistance(lon, lat, info.center[0], info.center[1]);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestRegion = code;
    }
  }

  return closestRegion;
}

/**
 * Determines the subregion code based on position relative to region center.
 * Uses 8 directional zones plus central zone.
 */
function determineSubregion(
  lon: number,
  lat: number,
  regionCode: string
): SubregionCode {
  const region = REGIONS[regionCode];
  if (!region) return 'C';

  const [centerLon, centerLat] = region.center;
  const dLon = lon - centerLon;
  const dLat = lat - centerLat;

  // Calculate distance from center as fraction of region radius
  const distanceKm = haversineDistance(lon, lat, centerLon, centerLat);
  const distanceFraction = distanceKm / region.radius_km;

  // If within 30% of center, it's Central
  if (distanceFraction < 0.3) {
    return 'C';
  }

  // Determine direction based on angle
  const angle = Math.atan2(dLat, dLon) * (180 / Math.PI);

  // Map angle to subregion (angle 0 = East, 90 = North, etc.)
  if (angle >= -22.5 && angle < 22.5) return 'E';
  if (angle >= 22.5 && angle < 67.5) return 'NE';
  if (angle >= 67.5 && angle < 112.5) return 'N';
  if (angle >= 112.5 && angle < 157.5) return 'NW';
  if (angle >= 157.5 || angle < -157.5) return 'W';
  if (angle >= -157.5 && angle < -112.5) return 'SW';
  if (angle >= -112.5 && angle < -67.5) return 'S';
  if (angle >= -67.5 && angle < -22.5) return 'SE';

  return 'C';
}

/**
 * Generates a street number for a placeholder street.
 * Numbers are multiples of 5, with no leading zeros.
 * The number is deterministic based on grid position within the subregion.
 */
function generateStreetNumber(
  lon: number,
  lat: number,
  regionCode: string,
  _subregionCode: SubregionCode
): number {
  const region = REGIONS[regionCode];
  if (!region) return 100;

  const [centerLon, centerLat] = region.center;

  // Create a grid within the subregion
  // Each subregion can have up to ~20,000 streets (100-99995 in multiples of 5)
  const gridX = Math.floor((lon - centerLon + 2) * 1000) % 200;
  const gridY = Math.floor((lat - centerLat + 2) * 1000) % 100;

  // Generate a base number from grid position (1-19999)
  const baseNumber = gridX * 100 + gridY + 1;

  // Convert to multiple of 5 and ensure minimum of 100
  const streetNumber = Math.max(100, baseNumber * 5);

  return streetNumber;
}

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
 * Uses the new Uganda addressing system with format: <SUBREGION>-<STREET_NUMBER>
 *
 * @param {Coordinate} centroid - The building's geographic center point
 * @returns {Promise<PlaceholderStreet & { region_code: string; subregion_code: string }>}
 *          The existing or newly created placeholder street with region info
 *
 * @example
 * const placeholder = await getOrCreatePlaceholderStreet({ lon: 32.5814, lat: 0.3476 });
 * // Returns: { placeholder_id: 'KAM-C-105', display_name: 'C-105', region_code: 'KAM', ... }
 */
export async function getOrCreatePlaceholderStreet(
  centroid: Coordinate
): Promise<PlaceholderStreet & { region_code: string; subregion_code: string }> {
  // Determine region and subregion from coordinates
  const regionCode = determineRegion(centroid.lon, centroid.lat);
  const subregionCode = determineSubregion(centroid.lon, centroid.lat, regionCode);

  // Generate street number based on position
  const streetNumber = generateStreetNumber(
    centroid.lon,
    centroid.lat,
    regionCode,
    subregionCode
  );

  // New format: <SUBREGION>-<STREET_NUMBER> (e.g., "C-105", "N-1320")
  const displayName = `${subregionCode}-${streetNumber}`;
  const placeholderId = `${regionCode}-${displayName}`;

  const gridX = Math.floor(centroid.lon / GRID_SIZE);
  const gridY = Math.floor(centroid.lat / GRID_SIZE);
  const cellCenterX = (gridX + 0.5) * GRID_SIZE;
  const cellCenterY = (gridY + 0.5) * GRID_SIZE;

  // Use upsert to handle concurrent requests safely
  const result = await queryOne<PlaceholderStreet & { region_code: string; subregion_code: string }>(
    `INSERT INTO placeholder_streets (placeholder_id, geometry, display_name, region_code, subregion_code)
     VALUES ($1, ST_GeomFromText($2, 4326), $3, $4, $5)
     ON CONFLICT (placeholder_id) DO UPDATE SET placeholder_id = EXCLUDED.placeholder_id
     RETURNING placeholder_id, display_name, ST_AsGeoJSON(geometry) as geometry, region_code, $5::text as subregion_code`,
    [
      placeholderId,
      `LINESTRING(${cellCenterX} ${cellCenterY - GRID_SIZE / 2}, ${cellCenterX} ${cellCenterY + GRID_SIZE / 2})`,
      displayName,
      regionCode,
      subregionCode,
    ]
  );

  if (result) {
    return result;
  }

  // Fallback: return without database (shouldn't happen)
  return {
    placeholder_id: placeholderId,
    display_name: displayName,
    region_code: regionCode,
    subregion_code: subregionCode,
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
 * Determines which side of a street a building is on.
 * Uses cross product of the road direction vector and the vector to the building.
 *
 * @param {Coordinate} centroid - The building's geographic center point
 * @param {string} streetGeometry - GeoJSON string of the street geometry
 * @returns {Promise<'left' | 'right'>} The side of the street the building is on
 */
async function determineSideOfStreet(
  centroid: Coordinate,
  streetGeometry: string
): Promise<'left' | 'right'> {
  // Use PostGIS to calculate the cross product to determine side
  // The sign of the cross product indicates which side of the line the point is on
  const result = await queryOne<{ side: number }>(
    `WITH line AS (
      SELECT ST_GeomFromGeoJSON($1) AS geom
    ),
    building_point AS (
      SELECT ST_SetSRID(ST_MakePoint($2, $3), 4326) AS geom
    ),
    closest_position AS (
      SELECT ST_LineLocatePoint(line.geom, building_point.geom) AS pos
      FROM line, building_point
    ),
    line_points AS (
      -- Get two points on the line to determine direction
      -- Use a small offset to get the direction at the closest point
      SELECT
        ST_LineInterpolatePoint(line.geom, GREATEST(0, pos - 0.01)) AS p1,
        ST_LineInterpolatePoint(line.geom, LEAST(1, pos + 0.01)) AS p2
      FROM line, closest_position
    )
    -- Calculate cross product: (p2 - p1) × (building - p1)
    -- Positive = left side, Negative = right side
    SELECT
      SIGN(
        (ST_X(p2) - ST_X(p1)) * (ST_Y(building_point.geom) - ST_Y(p1)) -
        (ST_Y(p2) - ST_Y(p1)) * (ST_X(building_point.geom) - ST_X(p1))
      ) AS side
    FROM line_points, building_point`,
    [streetGeometry, centroid.lon, centroid.lat]
  );

  // Positive cross product means left side, negative means right side
  // If exactly on the line (0), default to left
  return (result?.side ?? 0) >= 0 ? 'left' : 'right';
}

/**
 * Calculates a deterministic house number for a building based on its
 * position along a street and which side of the street it's on.
 *
 * House number allocation rules:
 * - Numbers are multiples of 5 (5, 10, 15, 20, ...)
 * - Buildings on the left side of the road get odd multiples (5, 15, 25, 35, ...)
 * - Buildings on the right side of the road get even multiples (10, 20, 30, 40, ...)
 * - Numbers are allocated from the start to the end of the road based on position
 *
 * @param {Coordinate} centroid - The building's geographic center point
 * @param {string} streetGeometry - GeoJSON string of the street geometry
 * @returns {Promise<number>} A house number (multiples of 5, odd for left, even for right)
 *
 * @example
 * const houseNumber = await calculateHouseNumber(
 *   { lon: 32.5814, lat: 0.3476 },
 *   '{"type":"LineString","coordinates":[[32.58,0.34],[32.59,0.35]]}'
 * );
 * // Returns 15 (left side) or 20 (right side) depending on building position
 */
export async function calculateHouseNumber(
  centroid: Coordinate,
  streetGeometry: string
): Promise<number> {
  // Get position along the street (0.0 = start, 1.0 = end)
  const positionResult = await queryOne<{ position: number }>(
    `SELECT ST_LineLocatePoint(
      ST_GeomFromGeoJSON($1),
      ST_SetSRID(ST_MakePoint($2, $3), 4326)
    ) as position`,
    [streetGeometry, centroid.lon, centroid.lat]
  );

  const position = positionResult?.position ?? 0.5;

  // Determine which side of the street the building is on
  const side = await determineSideOfStreet(centroid, streetGeometry);

  // Calculate base slot from position (0-99)
  // This gives us the sequential position along the street
  const baseSlot = Math.floor(position * 100);

  // Calculate house number:
  // - Left side (odd): 5, 15, 25, 35, ... → (slot * 2 + 1) * 5 = 5, 15, 25, ...
  // - Right side (even): 10, 20, 30, 40, ... → (slot * 2 + 2) * 5 = 10, 20, 30, ...
  let houseNumber: number;
  if (side === 'left') {
    // Odd multiples of 5: 5, 15, 25, 35, ...
    houseNumber = (baseSlot * 2 + 1) * HOUSE_NUMBER_SPACING;
  } else {
    // Even multiples of 5: 10, 20, 30, 40, ...
    houseNumber = (baseSlot * 2 + 2) * HOUSE_NUMBER_SPACING;
  }

  // Ensure minimum house number of 5
  return Math.max(HOUSE_NUMBER_SPACING, houseNumber);
}

/**
 * Assigns a community address to a building that lacks an official address.
 * Uses the Uganda community addressing system.
 *
 * Algorithm steps:
 * 1. Determine region and subregion from coordinates
 * 2. Find the nearest named OSM street within MAX_STREET_DISTANCE_METERS
 * 3. If no street found, create/get a placeholder street with format: <SUBREGION>-<NUMBER>
 * 4. Determine which side of the road the building is on (left or right)
 * 5. Calculate a deterministic house number based on position and side:
 *    - Left side: odd multiples of 5 (5, 15, 25, ...)
 *    - Right side: even multiples of 5 (10, 20, 30, ...)
 * 6. Format and return the complete address in Uganda format
 *
 * @param {Coordinate} buildingCentroid - The building's geographic center point
 * @returns {Promise<CommunityAddress>} The generated community address
 *
 * @example
 * // Building in central Kampala with no nearby named street
 * const address = await assignCommunityAddress({ lon: 32.5814, lat: 0.3476 });
 * console.log(address.full_address);
 * // Output: "15 C-105, KAM, Uganda"
 *
 * @example
 * // Building near a named OSM street
 * const address = await assignCommunityAddress({ lon: 32.5820, lat: 0.3470 });
 * console.log(address.full_address);
 * // Output: "310 Kampala Road, KAM, Uganda"
 */
export async function assignCommunityAddress(
  buildingCentroid: Coordinate
): Promise<CommunityAddress> {
  // Step 1: Determine region from coordinates
  const regionCode = determineRegion(buildingCentroid.lon, buildingCentroid.lat);

  // Step 2: Find nearest OSM street
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
    // Step 3: Get or create placeholder street with new format
    const placeholder = await getOrCreatePlaceholderStreet(buildingCentroid);
    streetName = placeholder.display_name;
    streetSource = 'placeholder';
    streetId = placeholder.placeholder_id;
    streetGeometry = placeholder.geometry;
  }

  // Step 4: Calculate house number
  const houseNumber = await calculateHouseNumber(
    buildingCentroid,
    streetGeometry
  );

  // Step 5: Format address in community format
  // Format: <HOUSE_NUMBER> <STREET_NAME>, <REGION_NAME>, <COUNTRY>
  const regionName = REGIONS[regionCode]?.name ?? regionCode;
  const fullAddress = `${houseNumber} ${streetName}, ${regionName}, ${COUNTRY.name}`;

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

  // Generate community address using Uganda addressing system
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
