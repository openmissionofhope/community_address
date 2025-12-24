/**
 * @fileoverview Modal component for submitting address corrections and suggestions.
 * Handles both local suggestions (stored in database) and OSM issues (redirects
 * to OpenStreetMap editor).
 */

import { useState } from 'react';
import type { BuildingFeature, SuggestionPayload } from '../types';
import { submitSuggestion, getOsmRedirect } from '../services/api';

/**
 * Props for the SuggestionModal component.
 * @interface SuggestionModalProps
 * @property {BuildingFeature} building - The building being corrected
 * @property {function} onClose - Callback to close the modal
 * @property {function} onSubmitted - Callback after successful submission
 */
interface SuggestionModalProps {
  building: BuildingFeature;
  onClose: () => void;
  onSubmitted: () => void;
}

/** Type alias for suggestion types from the payload schema */
type SuggestionType = SuggestionPayload['suggestion_type'];

/**
 * Modal form for submitting address corrections and suggestions.
 *
 * Handles two types of submissions:
 * 1. Address corrections - Stored locally for moderator review
 * 2. OSM issues (geometry, name, missing building) - Redirects to OpenStreetMap
 *
 * Features:
 * - Form validation with minimum description length
 * - Visual indicator for OSM-related issues
 * - Loading state during submission
 * - Error handling with user feedback
 *
 * @component
 * @param {SuggestionModalProps} props - Component props
 * @returns {JSX.Element} The rendered modal
 *
 * @example
 * <SuggestionModal
 *   building={selectedBuilding}
 *   onClose={() => setShowModal(false)}
 *   onSubmitted={() => showSuccessToast()}
 * />
 */
export function SuggestionModal({ building, onClose, onSubmitted }: SuggestionModalProps) {
  const [type, setType] = useState<SuggestionType>('address_correction');
  const [description, setDescription] = useState('');
  const [suggestedValue, setSuggestedValue] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOsmIssue = type === 'geometry_error' || type === 'name_correction' || type === 'missing_building';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (isOsmIssue) {
        const result = await getOsmRedirect(
          building.properties.osm_id,
          type as 'geometry_error' | 'name_correction' | 'missing_building',
          description
        );
        // Open OSM in new tab
        window.open(result.osm_note_url, '_blank');
        onSubmitted();
      } else {
        await submitSuggestion({
          building_osm_id: building.properties.osm_id,
          suggestion_type: type,
          description,
          suggested_value: suggestedValue || undefined,
          contact_info: contactInfo || undefined,
        });
        onSubmitted();
      }
    } catch (_err) {
      setError('Failed to submit suggestion. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Suggest a Correction</h2>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="type">Issue Type</label>
            <select
              id="type"
              value={type}
              onChange={(e) => setType(e.target.value as SuggestionType)}
            >
              <option value="address_correction">Address is incorrect</option>
              <option value="geometry_error">Building shape is wrong (OSM)</option>
              <option value="name_correction">Street name is wrong (OSM)</option>
              <option value="missing_building">Building is missing (OSM)</option>
              <option value="other">Other</option>
            </select>
          </div>

          {isOsmIssue && (
            <div style={{
              background: '#fef3c7',
              padding: '12px',
              borderRadius: '6px',
              marginBottom: '16px',
              fontSize: '13px',
              color: '#92400e'
            }}>
              This issue should be fixed directly in OpenStreetMap.
              We'll open the OSM editor for you after you submit.
            </div>
          )}

          <div className="form-group">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the issue..."
              required
              minLength={10}
            />
          </div>

          {!isOsmIssue && (
            <div className="form-group">
              <label htmlFor="suggested">Suggested Correction (optional)</label>
              <input
                type="text"
                id="suggested"
                value={suggestedValue}
                onChange={(e) => setSuggestedValue(e.target.value)}
                placeholder="e.g., House number should be 31"
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="contact">Email (optional, for follow-up)</label>
            <input
              type="email"
              id="contact"
              value={contactInfo}
              onChange={(e) => setContactInfo(e.target.value)}
              placeholder="your@email.com"
            />
          </div>

          {error && (
            <div style={{ color: '#dc2626', fontSize: '14px', marginBottom: '12px' }}>
              {error}
            </div>
          )}

          <div className="button-group">
            <button type="button" className="cancel-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="submit-btn" disabled={submitting}>
              {submitting ? 'Submitting...' : (isOsmIssue ? 'Open OSM Editor' : 'Submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
