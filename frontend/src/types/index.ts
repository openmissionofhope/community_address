export interface Address {
  house_number: string | number;
  street: string;
  city?: string;
  postcode?: string;
  full: string;
  source: 'osm' | 'placeholder';
  algorithm_version?: string;
}

export interface BuildingFeature {
  type: 'Feature';
  id: string;
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    id: number;
    osm_id: number;
    address_type: 'official' | 'community';
    address: Address;
  };
}

export interface BuildingCollection {
  type: 'FeatureCollection';
  features: BuildingFeature[];
  metadata: {
    bbox: [number, number, number, number];
    total: number;
    generated_at: string;
  };
}

export interface Region {
  code: string;
  name: string;
  level: number;
  parent_code: string | null;
  centroid: [number, number] | null;
  building_count: number;
  community_address_count: number;
}

export interface SuggestionPayload {
  building_osm_id?: number;
  suggestion_type: 'geometry_error' | 'name_correction' | 'address_correction' | 'missing_building' | 'other';
  description: string;
  suggested_value?: string;
  contact_info?: string;
}

export interface RegionFeature {
  type: 'Feature';
  id: string;
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    code: string;
    name: string;
    level: number;
    parent_code: string | null;
  };
}

export interface RegionCollection {
  type: 'FeatureCollection';
  features: RegionFeature[];
}

export interface PlaceholderStreetFeature {
  type: 'Feature';
  id: string;
  geometry: {
    type: 'LineString';
    coordinates: number[][];
  };
  properties: {
    id: string;
    name: string;
    region: string;
    centroid: [number, number];
  };
}

export interface PlaceholderStreetCollection {
  type: 'FeatureCollection';
  features: PlaceholderStreetFeature[];
  metadata: {
    bbox: [number, number, number, number];
    total: number;
  };
}
