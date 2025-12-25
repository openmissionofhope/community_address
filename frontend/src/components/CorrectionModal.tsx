/**
 * @fileoverview Modal for suggesting address corrections.
 */

import { useState } from 'react';
import { submitClaim } from '../services/api';
import { useUser } from '../context/UserContext';

interface CorrectionModalProps {
  buildingId: number;
  currentAddress?: {
    house_number?: string;
    street?: string;
  };
  onClose: () => void;
  onSuccess: () => void;
  onNeedAuth: () => void;
}

export function CorrectionModal({
  buildingId,
  currentAddress,
  onClose,
  onSuccess,
  onNeedAuth,
}: CorrectionModalProps) {
  const { user } = useUser();
  const [houseNumber, setHouseNumber] = useState(currentAddress?.house_number || '');
  const [streetName, setStreetName] = useState(currentAddress?.street || '');
  const [source, setSource] = useState<'community' | 'official_reported'>('community');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      onNeedAuth();
      return;
    }

    if (!houseNumber.trim()) {
      setError('House number is required');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await submitClaim({
        building_id: buildingId,
        road_id: 0, // Will use placeholder
        road_type: 'placeholder',
        house_number: houseNumber.trim(),
        source,
        access_type: 'primary',
        user_id: user.id,
      });
      onSuccess();
      onClose();
    } catch {
      setError('Failed to submit correction. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Suggest Address</h2>
        <p className="modal-description">
          Know the correct address for this building? Submit it here.
        </p>
        <form onSubmit={handleSubmit}>
          <label>
            House Number *
            <input
              type="text"
              value={houseNumber}
              onChange={(e) => setHouseNumber(e.target.value)}
              placeholder="e.g., 42 or 42A"
              disabled={submitting}
            />
          </label>
          <label>
            Street Name
            <input
              type="text"
              value={streetName}
              onChange={(e) => setStreetName(e.target.value)}
              placeholder="e.g., Tank Hill Road"
              disabled={submitting}
            />
          </label>
          <label>
            Source
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as 'community' | 'official_reported')}
              disabled={submitting}
            >
              <option value="community">Community knowledge</option>
              <option value="official_reported">Official (e.g., utility bill)</option>
            </select>
          </label>
          {error && <p className="error">{error}</p>}
          {!user && (
            <p className="info">You need to sign in to submit corrections.</p>
          )}
          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={submitting}>
              {submitting ? 'Submitting...' : user ? 'Submit' : 'Sign in to Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
