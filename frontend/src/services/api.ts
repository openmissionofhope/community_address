import type { BuildingCollection, Region, SuggestionPayload } from '../types';

const API_BASE = '/api';

export async function fetchBuildings(bbox: [number, number, number, number]): Promise<BuildingCollection> {
  const bboxStr = bbox.join(',');
  const response = await fetch(`${API_BASE}/buildings?bbox=${bboxStr}`);
  if (!response.ok) {
    throw new Error('Failed to fetch buildings');
  }
  return response.json();
}

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
