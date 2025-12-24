import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchBuildings, fetchRegions, submitSuggestion, getOsmRedirect } from './api';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('API Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchBuildings', () => {
    it('should fetch buildings with bbox parameter', async () => {
      const mockResponse = {
        type: 'FeatureCollection',
        features: [],
        metadata: { bbox: [32.5, 0.3, 32.6, 0.4], total: 0 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await fetchBuildings([32.5, 0.3, 32.6, 0.4]);

      expect(mockFetch).toHaveBeenCalledWith('/api/buildings?bbox=32.5,0.3,32.6,0.4');
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      await expect(fetchBuildings([32.5, 0.3, 32.6, 0.4])).rejects.toThrow('Failed to fetch buildings');
    });
  });

  describe('fetchRegions', () => {
    it('should fetch all regions when no parent specified', async () => {
      const mockResponse = { regions: [{ code: 'UG', name: 'Uganda', level: 0 }] };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await fetchRegions();

      expect(mockFetch).toHaveBeenCalledWith('/api/regions');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('submitSuggestion', () => {
    it('should submit suggestion successfully', async () => {
      const mockResponse = { id: 1, message: 'Suggestion submitted' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const payload = {
        suggestion_type: 'address_correction' as const,
        description: 'The address is wrong',
      };

      const result = await submitSuggestion(payload);

      expect(mockFetch).toHaveBeenCalledWith('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getOsmRedirect', () => {
    it('should get OSM redirect URLs', async () => {
      const mockResponse = {
        osm_edit_url: 'https://www.openstreetmap.org/edit?way=123',
        osm_note_url: 'https://www.openstreetmap.org/note/new',
        message: 'Fix in OSM',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await getOsmRedirect(123, 'geometry_error', 'Shape is wrong');

      expect(result).toEqual(mockResponse);
    });
  });
});
