/**
 * @fileoverview Modal for marking building entrances.
 * Uses geolocation to get user's current position as the entrance point.
 */

import { useState, useEffect } from 'react';
import { submitAccessPoint } from '../services/api';

interface EntranceModalProps {
  buildingId: number;
  onClose: () => void;
  onSuccess: () => void;
}

export function EntranceModal({ buildingId, onClose, onSuccess }: EntranceModalProps) {
  const [accessNote, setAccessNote] = useState('');
  const [location, setLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(true);

  // Get user's current location on mount
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation not supported by your browser');
      setGettingLocation(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
        setGettingLocation(false);
      },
      (error) => {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            setLocationError('Location permission denied');
            break;
          case error.POSITION_UNAVAILABLE:
            setLocationError('Location unavailable');
            break;
          case error.TIMEOUT:
            setLocationError('Location request timed out');
            break;
          default:
            setLocationError('Failed to get location');
        }
        setGettingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);

  const handleSubmit = async () => {
    if (!location) return;

    setSubmitting(true);
    try {
      await submitAccessPoint({
        building_id: buildingId,
        lat: location.lat,
        lon: location.lon,
        access_note: accessNote.trim() || undefined,
      });
      onSuccess();
      onClose();
    } catch {
      setLocationError('Failed to save entrance');
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content">
        <h2>Mark Entrance</h2>
        <p className="modal-description">
          Stand at the building entrance and mark your current location.
        </p>

        {gettingLocation ? (
          <div style={{ textAlign: 'center', padding: '20px', color: '#6b7280' }}>
            Getting your location...
          </div>
        ) : locationError ? (
          <div className="error" style={{ textAlign: 'center', padding: '20px' }}>
            {locationError}
          </div>
        ) : location ? (
          <>
            <div className="info" style={{ marginBottom: '16px' }}>
              Location: {location.lat.toFixed(6)}, {location.lon.toFixed(6)}
            </div>

            <label>
              Note (optional)
              <input
                type="text"
                value={accessNote}
                onChange={(e) => setAccessNote(e.target.value)}
                placeholder="e.g., Blue gate, back entrance"
                maxLength={200}
              />
            </label>
          </>
        ) : null}

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            onClick={handleSubmit}
            disabled={!location || submitting}
          >
            {submitting ? 'Saving...' : 'Save Entrance'}
          </button>
        </div>
      </div>
    </div>
  );
}
