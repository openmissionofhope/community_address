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
import { fetchBuildings, fetchAccessNotes, fetchClaims, AccessNote, AddressClaim } from '../services/api';

/**
 * Formats time remaining until decay as a human-readable string.
 */
function formatTimeUntilDecay(decayAt: string): string {
  const now = new Date().getTime();
  const decay = new Date(decayAt).getTime();
  const diff = decay - now;

  if (diff <= 0) return 'Expired';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h left`;

  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${mins}m left`;
}

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
  const [notes, setNotes] = useState<AccessNote[]>([]);
  const [claims, setClaims] = useState<AddressClaim[]>([]);
  const map = useMap();
  const popupRef = useRef<L.Popup | null>(null);

  // Fetch notes and claims when building is selected
  useEffect(() => {
    if (!selectedBuilding?.properties?.id) {
      setNotes([]);
      setClaims([]);
      return;
    }
    const buildingId = selectedBuilding.properties.id;
    fetchAccessNotes(buildingId)
      .then((result) => setNotes(result.notes))
      .catch(() => setNotes([]));
    fetchClaims(buildingId)
      .then((result) => setClaims(result.claims))
      .catch(() => setClaims([]));
  }, [selectedBuilding?.properties?.id]);

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
      const isOsmStreet = addr?.source === 'osm';

      // Extract region/country from full address (after street name)
      const streetPart = `${houseNum} ${street}`.trim();
      const locationPart = fullAddress.replace(streetPart, '').replace(/^,\s*/, '');

      // Color logic:
      // - Official address: green number, green street
      // - Community address + OSM street: orange number, green street
      // - Community address + placeholder street: orange number, orange street
      const numberColor = isOfficial ? '#16a34a' : '#d97706';
      const streetColor = isOsmStreet ? '#16a34a' : '#d97706';

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

      // Get internal building ID for actions (use 0 as fallback for valid JS)
      const buildingId = selectedBuilding.properties?.id ?? 0;

      // Build claims HTML (alternative addresses)
      const claimsHtml = claims.length > 0
        ? `<div style="border-top:1px solid #e5e7eb;margin-top:12px;padding-top:12px;text-align:left">
            <div style="font-size:12px;font-weight:600;color:#6b7280;margin-bottom:8px">COMMUNITY ADDRESSES</div>
            ${claims.slice(0, 3).map(c => {
              const statusColor = c.status === 'accepted' ? '#16a34a' : (c.status === 'disputed' ? '#dc2626' : '#d97706');
              const statusBg = c.status === 'accepted' ? '#d1fae5' : (c.status === 'disputed' ? '#fee2e2' : '#fef3c7');
              return `
              <div style="background:#f9fafb;padding:8px;border-radius:6px;margin-bottom:6px;font-size:13px">
                <div style="color:#374151;font-weight:500">${c.house_number}${c.street_name ? ' ' + c.street_name : ''}</div>
                <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
                  <span style="font-size:11px;padding:2px 6px;border-radius:4px;background:${statusBg};color:${statusColor}">${c.status}</span>
                  <span style="font-size:11px;color:#16a34a">+${c.affirmation_count}</span>
                  <span style="font-size:11px;color:#dc2626">-${c.rejection_count}</span>
                  <button onclick="window.dispatchEvent(new CustomEvent('voteClaim', {detail:{claimId:'${c.id}',vote:'affirm'}}))" style="padding:2px 6px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;font-size:11px">+1</button>
                </div>
              </div>
            `}).join('')}
            ${claims.length > 3 ? `<div style="color:#6b7280;font-size:12px">+${claims.length - 3} more</div>` : ''}
          </div>`
        : '';

      // Build notes HTML with expiry countdown
      const notesHtml = notes.length > 0
        ? `<div style="border-top:1px solid #e5e7eb;margin-top:12px;padding-top:12px;text-align:left">
            <div style="font-size:12px;font-weight:600;color:#6b7280;margin-bottom:8px">ACCESS NOTES</div>
            ${notes.slice(0, 3).map(n => {
              const timeLeft = formatTimeUntilDecay(n.decay_at);
              const isExpiring = timeLeft.includes('h left') || timeLeft.includes('m left');
              const isExpired = timeLeft === 'Expired';
              return `
              <div style="background:#f9fafb;padding:8px;border-radius:6px;margin-bottom:6px;font-size:13px${isExpired ? ';opacity:0.5' : ''}">
                <div style="color:#374151">${n.note}</div>
                <div style="display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap">
                  <span style="font-size:11px;color:${isExpired ? '#dc2626' : (isExpiring ? '#d97706' : '#6b7280')}">${timeLeft}</span>
                  ${n.affirmation_count > 0 ? `<span style="font-size:11px;color:#16a34a">+${n.affirmation_count}</span>` : ''}
                  ${!isExpired ? `<button onclick="window.dispatchEvent(new CustomEvent('affirmNote', {detail:{noteId:'${n.id}'}}))" style="padding:2px 6px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;font-size:11px">+1</button>` : ''}
                </div>
              </div>
            `}).join('')}
            ${notes.length > 3 ? `<div style="color:#6b7280;font-size:12px">+${notes.length - 3} more</div>` : ''}
          </div>`
        : '';

      // Create popup with correction options
      const popup = L.popup({ maxWidth: 300 })
        .setLatLng([lat, lon])
        .setContent(`
          <div style="padding:12px;min-width:220px;text-align:center">
            <div style="font-weight:600;font-size:20px;margin-bottom:4px">
              <span style="color:${numberColor}">${houseNum}</span>
              <span style="color:${streetColor}">${street ? ' ' + street : ''}</span>
            </div>
            ${locationPart ? `<div style="font-size:16px;color:#6b7280;margin-bottom:8px">${locationPart}</div>` : ''}
            <div style="display:inline-block;padding:4px 12px;border-radius:4px;font-size:14px;font-weight:500;margin-bottom:12px;background:${isOfficial ? '#d1fae5' : '#fef3c7'};color:${isOfficial ? '#065f46' : '#92400e'}">
              ${isOfficial ? 'Official' : 'Community'}
            </div>
            ${claimsHtml}
            ${notesHtml}
            <div style="border-top:1px solid #e5e7eb;padding-top:12px;display:flex;gap:8px;justify-content:center">
              <button onclick="window.dispatchEvent(new CustomEvent('addNote', {detail:{buildingId:${buildingId}}}))" style="padding:6px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:13px">
                Add note
              </button>
              <button onclick="window.dispatchEvent(new CustomEvent('suggestCorrection', {detail:{buildingId:${buildingId}}}))" style="padding:6px 12px;border:none;border-radius:6px;background:#3b82f6;color:#fff;cursor:pointer;font-size:13px">
                Suggest correction
              </button>
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
  }, [selectedBuilding, map, notes, claims]);

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
