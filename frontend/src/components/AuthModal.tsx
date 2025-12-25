/**
 * @fileoverview Modal for phone-based authentication.
 */

import { useState } from 'react';
import { useUser } from '../context/UserContext';

interface AuthModalProps {
  onClose: () => void;
  onSuccess?: () => void;
}

export function AuthModal({ onClose, onSuccess }: AuthModalProps) {
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login } = useUser();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Basic phone validation
    const cleaned = phone.replace(/\s/g, '');
    if (!/^\+?[1-9]\d{6,14}$/.test(cleaned)) {
      setError('Enter a valid phone number (e.g., +256700123456)');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await login(cleaned);
      onSuccess?.();
      onClose();
    } catch {
      setError('Failed to login. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Sign In</h2>
        <p className="modal-description">
          Enter your phone number to contribute addresses and notes.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+256700123456"
            disabled={submitting}
            autoFocus
          />
          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={submitting}>
              {submitting ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
