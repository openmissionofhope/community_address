/**
 * @fileoverview Building layer component for rendering buildings on the map.
 * Displays buildings as GeoJSON polygons with color-coded styling based on
 * address type (official vs community). Includes simplified popup for
 * viewing and sharing addresses.
 */

import { useEffect, useState, useCallback, memo, useRef } from 'react';
import { GeoJSON, useMap } from 'react-leaflet';
import type { LatLngBounds, Layer, LeafletMouseEvent } from 'leaflet';
import L from 'leaflet';
import type { BuildingFeature, BuildingCollection } from '../types';
import { fetchBuildings } from '../services/api';

/**
 * Props for the BuildingLayer component.
 */
interface BuildingLayerProps {
  bounds: LatLngBounds;
  onBuildingClick: (building: BuildingFeature) => void;
  selectedBuilding: BuildingFeature | null;
}

/**
 * Renders buildings on the map as interactive GeoJSON polygons.
 * Shows address popup when a building is selected.
 */
function BuildingLayerComponent({
  bounds,
  onBuildingClick,
  selectedBuilding,
}: BuildingLayerProps) {
  const [buildings, setBuildings] = useState<BuildingCollection | null>(null);
  const [loading, setLoading] = useState(false);
  const map = useMap();
  const popupRef = useRef<L.Popup | null>(null);

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

  // Show popup for selected building
  useEffect(() => {
    if (!selectedBuilding || !map) {
      return;
    }

    try {
      // Close existing popup
      if (popupRef.current) {
        map.closePopup(popupRef.current);
        popupRef.current = null;
      }

      // Get address safely
      const addr = selectedBuilding.properties?.address;
      const houseNum = addr?.house_number ?? '';
      const street = addr?.street ?? '';
      const fullAddress = addr?.full ?? '';
      const isOfficial = selectedBuilding.properties?.address_type === 'official';

      // Extract region/country from full address (after street name)
      const streetPart = `${houseNum} ${street}`.trim();
      const locationPart = fullAddress.replace(streetPart, '').replace(/^,\s*/, '');

      // Color for street name: green for official, orange for community
      const streetColor = isOfficial ? '#16a34a' : '#d97706';

      // Get centroid from geometry
      let lat = 0, lon = 0;
      try {
        const coords = selectedBuilding.geometry?.coordinates;
        if (coords && Array.isArray(coords) && coords.length > 0) {
          const ring = selectedBuilding.geometry?.type === 'MultiPolygon'
            ? (coords as number[][][][])[0]?.[0]
            : (coords as number[][][])[0];
          if (ring && ring.length > 0 && Array.isArray(ring[0]) && ring[0].length >= 2) {
            lon = ring[0][0];
            lat = ring[0][1];
          }
        }
      } catch {
        const center = map.getCenter();
        lat = center.lat;
        lon = center.lng;
      }

      if (lat === 0 && lon === 0) {
        const center = map.getCenter();
        lat = center.lat;
        lon = center.lng;
      }

      // Create popup
      const popup = L.popup()
        .setLatLng([lat, lon])
        .setContent(`
          <div style="padding:12px;min-width:180px;text-align:center">
            <div style="font-weight:600;font-size:20px;margin-bottom:4px">
              <span style="color:#111827">${houseNum}</span>
              <span style="color:${streetColor}">${street ? ' ' + street : ''}</span>
            </div>
            ${locationPart ? `<div style="font-size:16px;color:#6b7280;margin-bottom:8px">${locationPart}</div>` : ''}
            <div style="display:inline-block;padding:4px 12px;border-radius:4px;font-size:14px;font-weight:500;background:${isOfficial ? '#d1fae5' : '#fef3c7'};color:${isOfficial ? '#065f46' : '#92400e'}">
              ${isOfficial ? 'Official' : 'Community'}
            </div>
          </div>
        `)
        .openOn(map);

      popupRef.current = popup;
    } catch (err) {
      console.error('Popup error:', err);
    }

    return () => {
      try {
        if (popupRef.current) {
          map.closePopup(popupRef.current);
          popupRef.current = null;
        }
      } catch {
        // ignore cleanup errors
      }
    };
  }, [selectedBuilding, map]);

  const onEachFeature = useCallback(
    (feature: BuildingFeature, layer: Layer) => {
      layer.on({
        click: (e: LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
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
      const isOfficial = feature.properties?.address_type === 'official';

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
