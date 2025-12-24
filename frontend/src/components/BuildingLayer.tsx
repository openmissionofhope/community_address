/**
 * @fileoverview Building layer component for rendering buildings on the map.
 * Displays buildings as GeoJSON polygons with color-coded styling based on
 * address type (official vs community). Includes simplified popup for
 * viewing and sharing addresses.
 */

import { useEffect, useState, useCallback, memo } from 'react';
import { GeoJSON, Popup, useMap } from 'react-leaflet';
import type { LatLngBounds, Layer } from 'leaflet';
import type { BuildingFeature, BuildingCollection } from '../types';
import { fetchBuildings } from '../services/api';

/**
 * Props for the BuildingLayer component.
 */
interface BuildingLayerProps {
  bounds: LatLngBounds;
  onBuildingClick: (building: BuildingFeature) => void;
  selectedBuilding: BuildingFeature | null;
  onCopyAddress: () => void;
  onShareAddress: () => void;
}

/**
 * Renders buildings on the map as interactive GeoJSON polygons.
 * Simplified popup shows short address with copy/share buttons.
 */
function BuildingLayerComponent({
  bounds,
  onBuildingClick,
  selectedBuilding,
  onCopyAddress,
  onShareAddress,
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

  // Get short address (house number + street only)
  const getShortAddress = (building: BuildingFeature) => {
    const addr = building.properties.address;
    return `${addr.house_number} ${addr.street}`;
  };

  // Safely get centroid of building geometry (handles Polygon and MultiPolygon)
  const getCentroid = (building: BuildingFeature): [number, number] => {
    try {
      let ring: number[][];
      if (building.geometry.type === 'MultiPolygon') {
        ring = (building.geometry.coordinates as number[][][][])[0][0];
      } else {
        ring = (building.geometry.coordinates as number[][][])[0];
      }

      if (!ring || ring.length === 0) {
        return [0, 0];
      }

      let sumLat = 0, sumLon = 0;
      for (const [lon, lat] of ring) {
        sumLon += lon;
        sumLat += lat;
      }
      return [sumLat / ring.length, sumLon / ring.length];
    } catch {
      return [0, 0];
    }
  };

  return (
    <>
      <GeoJSON
        key={JSON.stringify(buildings.metadata.bbox)}
        data={buildings as unknown as GeoJSON.GeoJsonObject}
        style={getStyle as unknown as L.StyleFunction}
        onEachFeature={onEachFeature as unknown as (feature: GeoJSON.Feature, layer: L.Layer) => void}
      />
      {selectedBuilding && (
        <Popup position={getCentroid(selectedBuilding)}>
          <div className="address-popup">
            <div className="address-short">
              {getShortAddress(selectedBuilding)}
            </div>
            <span className={`address-type ${selectedBuilding.properties.address_type}`}>
              {selectedBuilding.properties.address_type === 'official'
                ? 'Official'
                : 'Community'}
            </span>
            <div className="actions">
              <button className="copy-btn" onClick={onCopyAddress}>
                Copy
              </button>
              <button className="share-btn" onClick={onShareAddress}>
                Share
              </button>
            </div>
          </div>
        </Popup>
      )}
      {loading && (
        <div className="loading-indicator">Loading...</div>
      )}
    </>
  );
}

/**
 * Memoized version of BuildingLayerComponent.
 */
export const BuildingLayer = memo(BuildingLayerComponent);
