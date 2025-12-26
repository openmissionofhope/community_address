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
import { RegionLayer } from './components/RegionLayer';
import { Toast } from './components/Toast';
import { NoteModal } from './components/NoteModal';
import { CorrectionModal } from './components/CorrectionModal';
import { AuthModal } from './components/AuthModal';
import { UserProvider, useUser } from './context/UserContext';
import { fetchBuilding, affirmAccessNote } from './services/api';
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
 * Gets the centroid of a building geometry (handles Polygon and MultiPolygon).
 */
function getBuildingCentroid(building: BuildingFeature): [number, number] {
  try {
    const coords = building?.geometry?.coordinates;
    if (!coords || !Array.isArray(coords) || coords.length === 0) {
      return [0, 0];
    }

    let ring: number[][] | undefined;
    if (building.geometry.type === 'MultiPolygon') {
      const poly = (coords as number[][][][])[0];
      ring = poly?.[0];
    } else {
      ring = (coords as number[][][])[0];
    }

    if (!ring || !Array.isArray(ring) || ring.length === 0) {
      return [0, 0];
    }

    let sumLat = 0, sumLon = 0, count = 0;
    for (const point of ring) {
      if (Array.isArray(point) && point.length >= 2) {
        sumLon += point[0];
        sumLat += point[1];
        count++;
      }
    }
    if (count === 0) return [0, 0];
    return [sumLat / count, sumLon / count];
  } catch {
    return [0, 0];
  }
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

  // Set initial bounds on mount
  useEffect(() => {
    onBoundsChange(map.getBounds());
  }, [map, onBoundsChange]);

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
 * Inner app content with access to user context.
 */
function AppContent() {
  const { user, logout } = useUser();
  const [bounds, setBounds] = useState<LatLngBounds | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingFeature | null>(null);
  const [linkedBuilding, setLinkedBuilding] = useState<BuildingFeature | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [noteModalBuildingId, setNoteModalBuildingId] = useState<number | null>(null);
  const [correctionModal, setCorrectionModal] = useState<{
    buildingId: number;
    currentAddress?: { house_number?: string; street?: string };
  } | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<'note' | 'correction' | null>(null);

  // Listen for custom events from popup buttons
  useEffect(() => {
    const handleAddNote = (e: CustomEvent<{ buildingId: number }>) => {
      setNoteModalBuildingId(e.detail.buildingId);
    };

    const handleSuggestCorrection = (e: CustomEvent<{ buildingId: number }>) => {
      const addr = selectedBuilding?.properties?.address;
      setCorrectionModal({
        buildingId: e.detail.buildingId,
        currentAddress: addr ? {
          house_number: String(addr.house_number || ''),
          street: addr.street,
        } : undefined,
      });
    };

    const handleAffirmNote = async (e: CustomEvent<{ noteId: string }>) => {
      if (!user) {
        setShowAuthModal(true);
        setToast('Sign in to affirm notes');
        setTimeout(() => setToast(null), 3000);
        return;
      }
      try {
        await affirmAccessNote(e.detail.noteId, user.id);
        setToast('Note affirmed!');
        setTimeout(() => setToast(null), 2000);
        // Re-select building to refresh notes
        if (selectedBuilding) {
          setSelectedBuilding({ ...selectedBuilding });
        }
      } catch {
        setToast('Already affirmed or error occurred');
        setTimeout(() => setToast(null), 3000);
      }
    };

    window.addEventListener('addNote', handleAddNote as unknown as EventListener);
    window.addEventListener('suggestCorrection', handleSuggestCorrection as unknown as EventListener);
    window.addEventListener('affirmNote', handleAffirmNote as unknown as EventListener);

    return () => {
      window.removeEventListener('addNote', handleAddNote as unknown as EventListener);
      window.removeEventListener('suggestCorrection', handleSuggestCorrection as unknown as EventListener);
      window.removeEventListener('affirmNote', handleAffirmNote as unknown as EventListener);
    };
  }, [selectedBuilding, user]);

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
      try {
        const url = getBuildingUrl(selectedBuilding);
        // Only update URL if we have a valid building ID (not null)
        if (!url.includes('/null')) {
          window.history.replaceState(null, '', url.replace(window.location.origin, ''));
        }
      } catch {
        // Ignore URL update errors
      }
    }
  }, [selectedBuilding]);

  const handleBoundsChange = useCallback((newBounds: LatLngBounds) => {
    setBounds(newBounds);
  }, []);

  const handleBuildingClick = useCallback((building: BuildingFeature) => {
    setSelectedBuilding(building);
  }, []);

  const handleLinkedBuildingLoaded = useCallback(() => {
    setLinkedBuilding(null);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Community Address</h1>
        <div className="header-right">
          <span className="disclaimer">Unofficial addresses</span>
          {user ? (
            <div className="user-info">
              <span className="contribution-count">{user.contribution_count}</span>
              <button className="logout-btn" onClick={logout}>
                Sign out
              </button>
            </div>
          ) : (
            <button className="login-btn" onClick={() => setShowAuthModal(true)}>
              Sign in
            </button>
          )}
        </div>
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
          <RegionLayer country="UG" />
          <MapEventHandler onBoundsChange={handleBoundsChange} />
          <FlyToBuilding building={linkedBuilding} onComplete={handleLinkedBuildingLoaded} />
          {bounds && (
            <BuildingLayer
              bounds={bounds}
              onBuildingClick={handleBuildingClick}
              selectedBuilding={selectedBuilding}
            />
          )}
        </MapContainer>
      </div>

      {toast && <Toast message={toast} />}

      {noteModalBuildingId && (
        <NoteModal
          buildingId={noteModalBuildingId}
          onClose={() => setNoteModalBuildingId(null)}
          onSuccess={() => {
            setToast('Note added successfully!');
            setTimeout(() => setToast(null), 3000);
          }}
        />
      )}

      {correctionModal && (
        <CorrectionModal
          buildingId={correctionModal.buildingId}
          currentAddress={correctionModal.currentAddress}
          onClose={() => setCorrectionModal(null)}
          onSuccess={() => {
            setToast('Correction submitted!');
            setTimeout(() => setToast(null), 3000);
          }}
          onNeedAuth={() => {
            setPendingAction('correction');
            setShowAuthModal(true);
          }}
        />
      )}

      {showAuthModal && (
        <AuthModal
          onClose={() => {
            setShowAuthModal(false);
            setPendingAction(null);
          }}
          onSuccess={() => {
            if (pendingAction === 'correction' && correctionModal) {
              // Modal stays open, user can now submit
            }
            setPendingAction(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Main application component wrapped with UserProvider.
 */
export default function App() {
  return (
    <UserProvider>
      <AppContent />
    </UserProvider>
  );
}
