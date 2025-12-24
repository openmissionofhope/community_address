/**
 * @fileoverview Main application component for Community Address.
 * Renders an interactive map interface for viewing buildings and their
 * addresses. Users can click buildings to view addresses, copy/share
 * addresses, and share direct links to buildings.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMapEvents, useMap } from 'react-leaflet';
import type { LatLngBounds } from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { BuildingLayer } from './components/BuildingLayer';
import { Toast } from './components/Toast';
import { fetchBuilding } from './services/api';
import type { BuildingFeature } from './types';

/** Default map center coordinates (Kampala, Uganda) */
const DEFAULT_CENTER: [number, number] = [0.3476, 32.5814];

/** Default map zoom level */
const DEFAULT_ZOOM = 15;

/** Zoom level for viewing a specific building */
const BUILDING_ZOOM = 18;

/**
 * Parses the URL hash to extract building ID.
 * Format: #/b/{osm_type}/{osm_id}
 */
function parseUrlHash(): { osmType: string; osmId: number } | null {
  const hash = window.location.hash;
  const match = hash.match(/^#\/b\/(node|way|relation)\/(\d+)$/);
  if (match) {
    return { osmType: match[1], osmId: parseInt(match[2]) };
  }
  return null;
}

/**
 * Generates a shareable URL for a building.
 */
function getBuildingUrl(building: BuildingFeature): string {
  const [osmType, osmId] = building.id.split('/');
  return `${window.location.origin}${window.location.pathname}#/b/${osmType}/${osmId}`;
}

/**
 * Gets the centroid of a building geometry.
 */
function getBuildingCentroid(building: BuildingFeature): [number, number] {
  const coords = building.geometry.coordinates[0];
  let lat = 0, lon = 0;
  for (const [x, y] of coords) {
    lon += x;
    lat += y;
  }
  return [lat / coords.length, lon / coords.length];
}

/**
 * Internal component that listens to map movement events.
 */
function MapEventHandler({
  onBoundsChange,
}: {
  onBoundsChange: (bounds: LatLngBounds) => void;
}) {
  const map = useMapEvents({
    moveend: () => {
      onBoundsChange(map.getBounds());
    },
    zoomend: () => {
      onBoundsChange(map.getBounds());
    },
  });
  return null;
}

/**
 * Component that handles flying to a building location.
 */
function FlyToBuilding({ building, onComplete }: { building: BuildingFeature | null; onComplete: () => void }) {
  const map = useMap();
  const hasFlown = useRef(false);

  useEffect(() => {
    if (building && !hasFlown.current) {
      const [lat, lon] = getBuildingCentroid(building);
      map.flyTo([lat, lon], BUILDING_ZOOM, { duration: 1 });
      hasFlown.current = true;
      onComplete();
    }
  }, [building, map, onComplete]);

  return null;
}

/**
 * Main application component for Community Address.
 */
export default function App() {
  const [bounds, setBounds] = useState<LatLngBounds | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingFeature | null>(null);
  const [linkedBuilding, setLinkedBuilding] = useState<BuildingFeature | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Load building from URL hash on mount
  useEffect(() => {
    const loadLinkedBuilding = async () => {
      const parsed = parseUrlHash();
      if (parsed) {
        try {
          const building = await fetchBuilding(parsed.osmType, parsed.osmId);
          setLinkedBuilding(building);
          setSelectedBuilding(building);
        } catch {
          setToast('Building not found');
          setTimeout(() => setToast(null), 3000);
          // Clear invalid hash
          window.history.replaceState(null, '', window.location.pathname);
        }
      }
    };
    loadLinkedBuilding();
  }, []);

  // Update URL hash when building is selected
  useEffect(() => {
    if (selectedBuilding) {
      const url = getBuildingUrl(selectedBuilding);
      window.history.replaceState(null, '', url.replace(window.location.origin, ''));
    }
  }, [selectedBuilding]);

  const handleBoundsChange = useCallback((newBounds: LatLngBounds) => {
    setBounds(newBounds);
  }, []);

  const handleBuildingClick = useCallback((building: BuildingFeature) => {
    setSelectedBuilding(building);
  }, []);

  const handleCopyAddress = useCallback(() => {
    if (selectedBuilding) {
      // Copy short address (house number + street)
      const addr = selectedBuilding.properties.address;
      const shortAddr = `${addr.house_number} ${addr.street}`;
      navigator.clipboard.writeText(shortAddr);
      setToast('Address copied');
      setTimeout(() => setToast(null), 2000);
    }
  }, [selectedBuilding]);

  const handleShareAddress = useCallback(async () => {
    if (selectedBuilding) {
      const url = getBuildingUrl(selectedBuilding);
      const addr = selectedBuilding.properties.address;
      const shortAddr = `${addr.house_number} ${addr.street}`;

      if (navigator.share) {
        try {
          await navigator.share({
            title: 'Community Address',
            text: shortAddr,
            url: url,
          });
        } catch {
          // User cancelled or share failed - fall back to copy
          navigator.clipboard.writeText(url);
          setToast('Link copied');
          setTimeout(() => setToast(null), 2000);
        }
      } else {
        navigator.clipboard.writeText(url);
        setToast('Link copied');
        setTimeout(() => setToast(null), 2000);
      }
    }
  }, [selectedBuilding]);

  const handleLinkedBuildingLoaded = useCallback(() => {
    setLinkedBuilding(null);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Community Address</h1>
        <span className="disclaimer">Unofficial addresses</span>
      </header>

      <div className="map-container">
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          scrollWheelZoom={true}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapEventHandler onBoundsChange={handleBoundsChange} />
          <FlyToBuilding building={linkedBuilding} onComplete={handleLinkedBuildingLoaded} />
          {bounds && (
            <BuildingLayer
              bounds={bounds}
              onBuildingClick={handleBuildingClick}
              selectedBuilding={selectedBuilding}
              onCopyAddress={handleCopyAddress}
              onShareAddress={handleShareAddress}
            />
          )}
        </MapContainer>
      </div>

      {toast && <Toast message={toast} />}
    </div>
  );
}
