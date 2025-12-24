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

  // Store callbacks in refs to avoid effect re-runs
  const onCopyAddressRef = useRef(onCopyAddress);
  const onShareAddressRef = useRef(onShareAddress);
  useEffect(() => {
    onCopyAddressRef.current = onCopyAddress;
    onShareAddressRef.current = onShareAddress;
  }, [onCopyAddress, onShareAddress]);

  // Show popup for selected building
  useEffect(() => {
    if (!selectedBuilding || !map) {
      return;
    }

    // Close existing popup
    if (popupRef.current) {
      map.closePopup(popupRef.current);
      popupRef.current = null;
    }

    // Safely get address info
    const addr = selectedBuilding.properties?.address;
    if (!addr) {
      console.error('Building has no address:', selectedBuilding);
      return;
    }

    const houseNum = addr.house_number ?? '';
    const street = addr.street ?? '';
    const addressType = selectedBuilding.properties?.address_type ?? 'community';
    const isOfficial = addressType === 'official';

    const popupContent = document.createElement('div');
    popupContent.className = 'address-popup';
    popupContent.innerHTML = `
      <div class="address-short">${houseNum} ${street}</div>
      <span class="address-type ${addressType}">
        ${isOfficial ? 'Official' : 'Community'}
      </span>
      <div class="actions">
        <button class="copy-btn">Copy</button>
        <button class="share-btn">Share</button>
      </div>
    `;

    // Add event listeners using refs
    const copyBtn = popupContent.querySelector('.copy-btn');
    const shareBtn = popupContent.querySelector('.share-btn');
    if (copyBtn) copyBtn.addEventListener('click', () => onCopyAddressRef.current());
    if (shareBtn) shareBtn.addEventListener('click', () => onShareAddressRef.current());

    // Calculate centroid
    let lat = 0, lon = 0, count = 0;
    try {
      const coords = selectedBuilding.geometry?.coordinates;
      if (!coords) throw new Error('No coordinates');

      const geoType = selectedBuilding.geometry?.type;
      let ring: number[][];

      if (geoType === 'MultiPolygon') {
        const firstPolygon = (coords as number[][][][])[0];
        if (!firstPolygon?.[0]) throw new Error('Invalid MultiPolygon');
        ring = firstPolygon[0];
      } else {
        ring = (coords as number[][][])[0];
        if (!ring) throw new Error('Invalid Polygon');
      }

      for (const point of ring) {
        if (Array.isArray(point) && point.length >= 2) {
          lon += point[0];
          lat += point[1];
          count++;
        }
      }
    } catch (e) {
      console.error('Failed to calculate centroid:', e, selectedBuilding.geometry);
    }

    if (count > 0) {
      const popup = L.popup()
        .setLatLng([lat / count, lon / count])
        .setContent(popupContent)
        .openOn(map);

      popupRef.current = popup;
    }

    return () => {
      if (popupRef.current) {
        map.closePopup(popupRef.current);
        popupRef.current = null;
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
