import { useState, useCallback } from 'react';
import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import type { LatLngBounds } from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { BuildingLayer } from './components/BuildingLayer';
import { SuggestionModal } from './components/SuggestionModal';
import { Toast } from './components/Toast';
import type { BuildingFeature } from './types';

// Default center: Kampala, Uganda
const DEFAULT_CENTER: [number, number] = [0.3476, 32.5814];
const DEFAULT_ZOOM = 15;

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

export default function App() {
  const [bounds, setBounds] = useState<LatLngBounds | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingFeature | null>(null);
  const [showSuggestionModal, setShowSuggestionModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const handleBoundsChange = useCallback((newBounds: LatLngBounds) => {
    setBounds(newBounds);
  }, []);

  const handleBuildingClick = useCallback((building: BuildingFeature) => {
    setSelectedBuilding(building);
  }, []);

  const handleCopyAddress = useCallback(() => {
    if (selectedBuilding) {
      navigator.clipboard.writeText(selectedBuilding.properties.address.full);
      setToast('Address copied to clipboard');
      setTimeout(() => setToast(null), 2000);
    }
  }, [selectedBuilding]);

  const handleShareAddress = useCallback(async () => {
    if (selectedBuilding && navigator.share) {
      try {
        await navigator.share({
          title: 'Address',
          text: selectedBuilding.properties.address.full,
        });
      } catch {
        // User cancelled or share failed
      }
    } else if (selectedBuilding) {
      handleCopyAddress();
    }
  }, [selectedBuilding, handleCopyAddress]);

  const handleSuggestCorrection = useCallback(() => {
    setShowSuggestionModal(true);
  }, []);

  const handleSuggestionSubmitted = useCallback(() => {
    setShowSuggestionModal(false);
    setToast('Suggestion submitted successfully');
    setTimeout(() => setToast(null), 3000);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Community Address</h1>
        <span className="disclaimer">Unofficial addresses only</span>
      </header>

      <div className="map-container">
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          scrollWheelZoom={true}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapEventHandler onBoundsChange={handleBoundsChange} />
          {bounds && (
            <BuildingLayer
              bounds={bounds}
              onBuildingClick={handleBuildingClick}
              selectedBuilding={selectedBuilding}
              onCopyAddress={handleCopyAddress}
              onShareAddress={handleShareAddress}
              onSuggestCorrection={handleSuggestCorrection}
            />
          )}
        </MapContainer>
      </div>

      {showSuggestionModal && selectedBuilding && (
        <SuggestionModal
          building={selectedBuilding}
          onClose={() => setShowSuggestionModal(false)}
          onSubmitted={handleSuggestionSubmitted}
        />
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}
