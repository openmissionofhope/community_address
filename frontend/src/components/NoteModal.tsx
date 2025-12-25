/**
 * @fileoverview Modal for adding access notes to buildings.
 */

import { useState } from 'react';
import { submitAccessNote } from '../services/api';

interface NoteModalProps {
  buildingId: number;
  onClose: () => void;
  onSuccess: () => void;
}

export function NoteModal({ buildingId, onClose, onSuccess }: NoteModalProps) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (note.trim().length < 5) {
      setError('Note must be at least 5 characters');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await submitAccessNote({
        building_id: buildingId,
        note: note.trim(),
      });
      onSuccess();
      onClose();
    } catch {
      setError('Failed to submit note. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Add Access Note</h2>
        <p className="modal-description">
          Help others find this building by describing how to access it.
        </p>
        <form onSubmit={handleSubmit}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g., 'Blue gate after MTN kiosk' or 'Enter via back road, main gate is locked'"
            rows={3}
            maxLength={500}
            disabled={submitting}
          />
          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Add Note'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
