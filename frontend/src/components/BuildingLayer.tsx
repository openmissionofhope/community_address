/**
 * @fileoverview Building layer component for rendering buildings on the map.
 * Displays buildings as GeoJSON polygons with color-coded styling based on
 * address type (official vs community). Includes popup functionality for
 * viewing and interacting with building addresses.
 */

import { useEffect, useState, useCallback, memo } from 'react';
import { GeoJSON, Popup, useMap } from 'react-leaflet';
import type { LatLngBounds, Layer } from 'leaflet';
import type { BuildingFeature, BuildingCollection } from '../types';
import { fetchBuildings } from '../services/api';

/**
 * Props for the BuildingLayer component.
 * @interface BuildingLayerProps
 * @property {LatLngBounds} bounds - Current map bounding box for fetching buildings
 * @property {function} onBuildingClick - Callback when a building is clicked
 * @property {BuildingFeature|null} selectedBuilding - Currently selected building
 * @property {function} onCopyAddress - Callback for copy address action
 * @property {function} onShareAddress - Callback for share address action
 * @property {function} onSuggestCorrection - Callback for suggest correction action
 */
interface BuildingLayerProps {
  bounds: LatLngBounds;
  onBuildingClick: (building: BuildingFeature) => void;
  selectedBuilding: BuildingFeature | null;
  onCopyAddress: () => void;
  onShareAddress: () => void;
  onSuggestCorrection: () => void;
}

/**
 * Renders buildings on the map as interactive GeoJSON polygons.
 *
 * Features:
 * - Fetches buildings within the current map bounds (zoom 15+)
 * - Color-codes buildings: green for official addresses, orange for community
 * - Highlights selected buildings with blue border
 * - Shows popup with address details and action buttons
 * - Debounces API requests by 300ms to prevent excessive calls
 *
 * @component
 * @param {BuildingLayerProps} props - Component props
 * @returns {JSX.Element|null} The building layer or null if no buildings
 */
function BuildingLayerComponent({
  bounds,
  onBuildingClick,
  selectedBuilding,
  onCopyAddress,
  onShareAddress,
  onSuggestCorrection,
}: BuildingLayerProps) {
  const [buildings, setBuildings] = useState<BuildingCollection | null>(null);
  const [loading, setLoading] = useState(false);
  const map = useMap();

  const loadBuildings = useCallback(async () => {
    const zoom = map.getZoom();
    // Only load buildings at zoom level 15+
    if (zoom < 15) {
      setBuildings(null);
      return;
    }

    const bbox: [number, number, number, number] = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];

    setLoading(true);
    try {
      const data = await fetchBuildings(bbox);
      setBuildings(data);
    } catch (error) {
      console.error('Failed to load buildings:', error);
    } finally {
      setLoading(false);
    }
  }, [bounds, map]);

  useEffect(() => {
    const timeoutId = setTimeout(loadBuildings, 300);
    return () => clearTimeout(timeoutId);
  }, [loadBuildings]);

  const onEachFeature = useCallback(
    (feature: BuildingFeature, layer: Layer) => {
      layer.on({
        click: () => {
          onBuildingClick(feature);
        },
      });
    },
    [onBuildingClick]
  );

  const getStyle = useCallback(
    (feature?: BuildingFeature) => {
      if (!feature) return {};

      const isSelected = selectedBuilding?.id === feature.id;
      const isOfficial = feature.properties.address_type === 'official';

      return {
        fillColor: isOfficial ? '#22c55e' : '#f59e0b',
        fillOpacity: isSelected ? 0.7 : 0.4,
        color: isSelected ? '#2563eb' : (isOfficial ? '#16a34a' : '#d97706'),
        weight: isSelected ? 3 : 1,
      };
    },
    [selectedBuilding]
  );

  if (!buildings || buildings.features.length === 0) {
    return null;
  }

  return (
    <>
      <GeoJSON
        key={JSON.stringify(buildings.metadata.bbox)}
        data={buildings as unknown as GeoJSON.GeoJsonObject}
        style={getStyle as unknown as L.StyleFunction}
        onEachFeature={onEachFeature as unknown as (feature: GeoJSON.Feature, layer: L.Layer) => void}
      />
      {selectedBuilding && (
        <Popup
          position={[
            (selectedBuilding.geometry.coordinates[0][0][1] +
              selectedBuilding.geometry.coordinates[0][2][1]) /
              2,
            (selectedBuilding.geometry.coordinates[0][0][0] +
              selectedBuilding.geometry.coordinates[0][2][0]) /
              2,
          ]}
        >
          <div className="address-popup">
            <h3>Address</h3>
            <div className="address-full">
              {selectedBuilding.properties.address.full}
            </div>
            <span
              className={`address-type ${selectedBuilding.properties.address_type}`}
            >
              {selectedBuilding.properties.address_type === 'official'
                ? 'Official (OSM)'
                : 'Community Address'}
            </span>
            <div className="actions">
              <button className="copy-btn" onClick={onCopyAddress}>
                Copy
              </button>
              <button className="share-btn" onClick={onShareAddress}>
                Share
              </button>
              <button className="suggest-btn" onClick={onSuggestCorrection}>
                Suggest Correction
              </button>
            </div>
          </div>
        </Popup>
      )}
      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
        </div>
      )}
    </>
  );
}

/**
 * Memoized version of BuildingLayerComponent to prevent unnecessary re-renders.
 * @type {React.MemoExoticComponent<typeof BuildingLayerComponent>}
 */
export const BuildingLayer = memo(BuildingLayerComponent);
