/**
 * @fileoverview Suggestion routes for the Community Address API.
 * Provides endpoints for users to submit address corrections and other
 * suggestions, as well as redirect users to OpenStreetMap for map data issues.
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import { query, queryOne } from '../db/connection.js';

/** Schema for validating suggestion submission requests */
const suggestionSchema = z.object({
  building_osm_id: z.number().optional(),
  suggestion_type: z.enum([
    'geometry_error',
    'name_correction',
    'address_correction',
    'missing_building',
    'other',
  ]),
  description: z.string().min(10).max(1000),
  suggested_value: z.string().max(500).optional(),
  contact_info: z.string().email().max(255).optional(),
  location: z
    .object({
      lon: z.number().min(-180).max(180),
      lat: z.number().min(-90).max(90),
    })
    .optional(),
});

/** Schema for validating OSM redirect requests */
const osmRedirectSchema = z.object({
  building_osm_id: z.number(),
  issue_type: z.enum(['geometry_error', 'name_correction', 'missing_building']),
  description: z.string().min(10).max(1000),
});

type SuggestionBody = z.infer<typeof suggestionSchema>;
type OsmRedirectBody = z.infer<typeof osmRedirectSchema>;

/**
 * Registers suggestion-related routes with the Fastify instance.
 *
 * Routes:
 * - POST /suggestions - Submit a new suggestion or correction
 * - POST /suggestions/osm-redirect - Get OSM edit URLs for map data issues
 *
 * @param {FastifyInstance} fastify - The Fastify server instance
 * @returns {Promise<void>}
 *
 * @example
 * // Register routes
 * await fastify.register(suggestionsRoutes);
 */
export async function suggestionsRoutes(fastify: FastifyInstance) {
  /**
   * POST /suggestions
   * Submits a new suggestion or correction for a building address.
   * The submitter's IP is hashed for rate limiting while preserving privacy.
   *
   * @bodyParam {number} [building_osm_id] - OSM ID of the building (optional)
   * @bodyParam {string} suggestion_type - Type of suggestion (geometry_error, name_correction, address_correction, missing_building, other)
   * @bodyParam {string} description - Description of the issue (10-1000 chars)
   * @bodyParam {string} [suggested_value] - Suggested correction (max 500 chars)
   * @bodyParam {string} [contact_info] - Email for follow-up (optional)
   * @bodyParam {Object} [location] - Geographic location { lon, lat }
   * @returns {Object} Confirmation with suggestion ID and status
   * @throws {400} Invalid request body
   */
  fastify.post<{ Body: SuggestionBody }>('/suggestions', async (request, reply) => {
    const parsed = suggestionSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid request body',
        details: parsed.error.issues,
      });
    }

    const data = parsed.data;

    // Hash IP for rate limiting (privacy-preserving)
    const ip = request.ip || 'unknown';
    const ipHash = crypto.createHash('sha256').update(ip).digest('hex');

    // Get building ID if osm_id provided
    let buildingId: number | null = null;
    if (data.building_osm_id) {
      const building = await queryOne<{ id: number }>(
        'SELECT id FROM buildings WHERE osm_id = $1',
        [data.building_osm_id]
      );
      buildingId = building?.id ?? null;
    }

    // Insert suggestion
    interface InsertResult {
      id: number;
      status: string;
    }

    const result = await queryOne<InsertResult>(
      `INSERT INTO suggestions (
        building_id,
        suggestion_type,
        description,
        suggested_value,
        contact_info,
        location,
        ip_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, status`,
      [
        buildingId,
        data.suggestion_type,
        data.description,
        data.suggested_value ?? null,
        data.contact_info ?? null,
        data.location
          ? `SRID=4326;POINT(${data.location.lon} ${data.location.lat})`
          : null,
        ipHash,
      ]
    );

    return reply.status(201).send({
      id: result?.id,
      status: result?.status ?? 'pending',
      message: 'Thank you! Your suggestion has been submitted for review.',
      next_steps: 'Our volunteer moderators will review within 7 days.',
    });
  });

  /**
   * POST /suggestions/osm-redirect
   * Generates OpenStreetMap edit and note URLs for issues that should be
   * fixed directly in OSM (geometry errors, name corrections, missing buildings).
   * Also logs the redirect for tracking purposes.
   *
   * @bodyParam {number} building_osm_id - OSM ID of the building
   * @bodyParam {string} issue_type - Type of OSM issue (geometry_error, name_correction, missing_building)
   * @bodyParam {string} description - Description of the issue (10-1000 chars)
   * @returns {Object} OSM edit URL, note URL, and instructions
   * @throws {400} Invalid request body
   */
  fastify.post<{ Body: OsmRedirectBody }>(
    '/suggestions/osm-redirect',
    async (request, reply) => {
      const parsed = osmRedirectSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const { building_osm_id, issue_type, description } = parsed.data;

      // Get building info for coordinates
      interface BuildingInfo {
        osm_type: string;
        centroid_lon: number;
        centroid_lat: number;
      }

      const building = await queryOne<BuildingInfo>(
        `SELECT
          osm_type,
          ST_X(centroid) as centroid_lon,
          ST_Y(centroid) as centroid_lat
        FROM buildings WHERE osm_id = $1`,
        [building_osm_id]
      );

      let osmEditUrl: string;
      let osmNoteUrl: string;

      if (building) {
        osmEditUrl = `https://www.openstreetmap.org/edit?${building.osm_type}=${building_osm_id}`;
        const zoom = 19;
        osmNoteUrl = `https://www.openstreetmap.org/note/new#map=${zoom}/${building.centroid_lat.toFixed(4)}/${building.centroid_lon.toFixed(4)}`;
      } else {
        osmEditUrl = `https://www.openstreetmap.org/`;
        osmNoteUrl = `https://www.openstreetmap.org/note/new`;
      }

      // Log the redirect for tracking
      const ip = request.ip || 'unknown';
      const ipHash = crypto.createHash('sha256').update(ip).digest('hex');

      await query(
        `INSERT INTO suggestions (
          building_id,
          suggestion_type,
          description,
          status,
          ip_hash
        ) VALUES (
          (SELECT id FROM buildings WHERE osm_id = $1),
          $2,
          $3,
          'redirected_to_osm',
          $4
        )`,
        [building_osm_id, issue_type, description, ipHash]
      );

      return {
        message: 'This issue should be fixed in OpenStreetMap directly.',
        osm_edit_url: osmEditUrl,
        osm_note_url: osmNoteUrl,
        instructions:
          'Click the link above to edit in OSM. Your changes help everyone!',
      };
    }
  );
}
