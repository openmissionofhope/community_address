/**
 * @fileoverview API service functions for the Community Address frontend.
 * Provides typed fetch wrappers for communicating with the backend API.
 * All functions handle errors by throwing descriptive Error objects.
 */

import type { BuildingCollection, BuildingFeature, Region, RegionCollection, SuggestionPayload, PlaceholderStreetCollection } from '../types';

/** Base URL for all API requests */
const API_BASE = '/api';

/**
 * Fetches a single building by OSM type and ID.
 *
 * @param {string} osmType - OSM element type ('node', 'way', or 'relation')
 * @param {number} osmId - OSM unique identifier
 * @returns {Promise<BuildingFeature>} The building feature with address
 * @throws {Error} When the API request fails or building not found
 */
export async function fetchBuilding(osmType: string, osmId: number): Promise<BuildingFeature> {
  const response = await fetch(`${API_BASE}/buildings/${osmType}/${osmId}`);
  if (!response.ok) {
    throw new Error(response.status === 404 ? 'Building not found' : 'Failed to fetch building');
  }
  return response.json();
}

/**
 * Fetches buildings within a geographic bounding box.
 * Returns buildings as a GeoJSON FeatureCollection with address information.
 *
 * @param {[number, number, number, number]} bbox - Bounding box as [minLon, minLat, maxLon, maxLat]
 * @returns {Promise<BuildingCollection>} GeoJSON FeatureCollection of buildings
 * @throws {Error} When the API request fails
 *
 * @example
 * const buildings = await fetchBuildings([32.5, 0.3, 32.6, 0.4]);
 * console.log(`Found ${buildings.features.length} buildings`);
 */
export async function fetchBuildings(bbox: [number, number, number, number]): Promise<BuildingCollection> {
  const bboxStr = bbox.join(',');
  const response = await fetch(`${API_BASE}/buildings?bbox=${bboxStr}`);
  if (!response.ok) {
    throw new Error('Failed to fetch buildings');
  }
  return response.json();
}

/**
 * Fetches geographic regions from the API.
 * Optionally filters by parent region code to get child regions.
 *
 * @param {string} [parent] - Parent region code to filter by (e.g., 'KLA' for Kampala)
 * @returns {Promise<{ regions: Region[] }>} Object containing array of regions
 * @throws {Error} When the API request fails
 *
 * @example
 * // Get all top-level regions
 * const { regions } = await fetchRegions();
 *
 * @example
 * // Get child regions of Kampala
 * const { regions } = await fetchRegions('KLA');
 */
export async function fetchRegions(parent?: string): Promise<{ regions: Region[] }> {
  const url = parent
    ? `${API_BASE}/regions?parent=${parent}`
    : `${API_BASE}/regions`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch regions');
  }
  return response.json();
}

/**
 * Fetches regions as GeoJSON for map display.
 *
 * @param {string} [country='UG'] - Country code to filter regions
 * @param {number} [level=1] - Level to return (1=regions, 2=subregions)
 * @returns {Promise<RegionCollection>} GeoJSON FeatureCollection of regions
 * @throws {Error} When the API request fails
 */
export async function fetchRegionsGeoJson(
  country: string = 'UG',
  level: number = 1
): Promise<RegionCollection> {
  const response = await fetch(`${API_BASE}/regions/geojson?country=${country}&level=${level}`);
  if (!response.ok) {
    throw new Error('Failed to fetch regions GeoJSON');
  }
  return response.json();
}

/**
 * Submits a user suggestion or correction for a building address.
 *
 * @param {SuggestionPayload} payload - The suggestion data to submit
 * @param {number} [payload.building_osm_id] - OSM ID of the building (optional)
 * @param {string} payload.suggestion_type - Type of suggestion
 * @param {string} payload.description - Description of the issue
 * @param {string} [payload.suggested_value] - Suggested correction
 * @param {string} [payload.contact_info] - Contact email for follow-up
 * @returns {Promise<{ id: number; message: string }>} Confirmation with suggestion ID
 * @throws {Error} When the API request fails
 *
 * @example
 * const result = await submitSuggestion({
 *   building_osm_id: 123456,
 *   suggestion_type: 'address_correction',
 *   description: 'The house number should be 42, not 24',
 *   suggested_value: '42',
 * });
 * console.log(result.message);
 */
export async function submitSuggestion(payload: SuggestionPayload): Promise<{ id: number; message: string }> {
  const response = await fetch(`${API_BASE}/suggestions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error('Failed to submit suggestion');
  }
  return response.json();
}

/**
 * Gets OpenStreetMap edit URLs for issues that should be fixed directly in OSM.
 * Used for geometry errors, name corrections, and missing buildings.
 *
 * @param {number} osmId - The OSM ID of the building
 * @param {'geometry_error' | 'name_correction' | 'missing_building'} issueType - Type of OSM issue
 * @param {string} description - Description of the issue (min 10 chars)
 * @returns {Promise<{ osm_edit_url: string; osm_note_url: string; message: string }>} URLs for OSM editing
 * @throws {Error} When the API request fails
 *
 * @example
 * const result = await getOsmRedirect(
 *   123456,
 *   'geometry_error',
 *   'Building outline is shifted about 10 meters to the east'
 * );
 * window.open(result.osm_edit_url, '_blank');
 */
export async function getOsmRedirect(
  osmId: number,
  issueType: 'geometry_error' | 'name_correction' | 'missing_building',
  description: string
): Promise<{ osm_edit_url: string; osm_note_url: string; message: string }> {
  const response = await fetch(`${API_BASE}/suggestions/osm-redirect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      building_osm_id: osmId,
      issue_type: issueType,
      description,
    }),
  });
  if (!response.ok) {
    throw new Error('Failed to get OSM redirect');
  }
  return response.json();
}

/**
 * Fetches placeholder (community) streets within a bounding box.
 */
export async function fetchPlaceholderStreets(bbox: [number, number, number, number]): Promise<PlaceholderStreetCollection> {
  const bboxStr = bbox.join(',');
  const response = await fetch(`${API_BASE}/streets/placeholder?bbox=${bboxStr}`);
  if (!response.ok) {
    throw new Error('Failed to fetch placeholder streets');
  }
  return response.json();
}

// ==================== ADDRESS CLAIMS ====================

export interface AddressClaim {
  id: string;
  building_id: number;
  road_id: number;
  road_type: 'osm' | 'placeholder';
  house_number: string;
  street_name?: string;
  source: 'osm' | 'community' | 'official_reported';
  access_type: 'primary' | 'alternative' | 'historical';
  affirmation_count: number;
  rejection_count: number;
  status: 'pending' | 'accepted' | 'disputed' | 'decayed';
  created_at: string;
}

export interface AccessNote {
  id: string;
  building_id: number;
  note: string;
  affirmation_count: number;
  created_at: string;
  decay_at: string;
}

export interface BuildingAddresses {
  addresses: {
    address_type: string;
    house_number: string;
    street_name: string;
    source: string;
    access_type: string;
    confidence: number;
  }[];
  notes: AccessNote[];
  points: { id: string; lon: number; lat: number; access_note: string | null }[];
}

/**
 * Fetches all addresses for a building (official + claims).
 */
export async function fetchBuildingAddresses(buildingId: number): Promise<BuildingAddresses> {
  const response = await fetch(`${API_BASE}/access/addresses/${buildingId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch building addresses');
  }
  return response.json();
}

/**
 * Fetches address claims for a building.
 */
export async function fetchClaims(buildingId: number): Promise<{ claims: AddressClaim[] }> {
  const response = await fetch(`${API_BASE}/claims?building_id=${buildingId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch claims');
  }
  return response.json();
}

/**
 * Submits a new address claim.
 */
export async function submitClaim(claim: {
  building_id: number;
  road_id: number;
  road_type: 'osm' | 'placeholder';
  house_number: string;
  source?: 'community' | 'official_reported';
  access_type?: 'primary' | 'alternative' | 'historical';
  user_id?: string;
}): Promise<AddressClaim> {
  const response = await fetch(`${API_BASE}/claims`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(claim),
  });
  if (!response.ok) {
    throw new Error('Failed to submit claim');
  }
  return response.json();
}

/**
 * Votes on an address claim.
 */
export async function voteClaim(claimId: string, userId: string, vote: 'affirm' | 'reject'): Promise<void> {
  const response = await fetch(`${API_BASE}/claims/${claimId}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, vote }),
  });
  if (!response.ok) {
    throw new Error('Failed to vote on claim');
  }
}

/**
 * Fetches access notes for a building.
 */
export async function fetchAccessNotes(buildingId: number): Promise<{ notes: AccessNote[] }> {
  const response = await fetch(`${API_BASE}/access/notes?building_id=${buildingId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch access notes');
  }
  return response.json();
}

/**
 * Submits a new access note.
 */
export async function submitAccessNote(note: {
  building_id: number;
  note: string;
  user_id?: string;
}): Promise<AccessNote> {
  const response = await fetch(`${API_BASE}/access/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note),
  });
  if (!response.ok) {
    throw new Error('Failed to submit access note');
  }
  return response.json();
}

/**
 * Affirms an access note.
 */
export async function affirmAccessNote(noteId: string, userId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/access/notes/${noteId}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, vote: 'affirm' }),
  });
  if (!response.ok) {
    throw new Error('Failed to affirm note');
  }
}

// ==================== USERS ====================

export interface User {
  id: string;
  trust_score: number;
  contribution_count: number;
}

/**
 * Creates or gets a user by phone number.
 */
export async function loginUser(phone: string): Promise<User & { is_new: boolean }> {
  const response = await fetch(`${API_BASE}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  if (!response.ok) {
    throw new Error('Failed to login');
  }
  return response.json();
}
