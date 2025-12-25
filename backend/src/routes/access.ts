/**
 * @fileoverview Access notes and points routes for the Community Address API.
 * Handles freeform directions and access point locations.
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db/connection.js';

const noteSchema = z.object({
  building_id: z.number(),
  note: z.string().min(5).max(500),
  user_id: z.string().uuid().optional(),
});

const accessPointSchema = z.object({
  building_id: z.number(),
  lon: z.number(),
  lat: z.number(),
  road_id: z.number().optional(),
  road_type: z.enum(['osm', 'placeholder']).optional(),
  access_note: z.string().max(255).optional(),
  user_id: z.string().uuid().optional(),
});

const voteSchema = z.object({
  user_id: z.string().uuid(),
  vote: z.enum(['affirm', 'reject']),
});

interface AccessNote {
  id: string;
  building_id: number;
  note: string;
  affirmation_count: number;
  created_at: string;
  decay_at: string;
}

interface AccessPoint {
  id: string;
  building_id: number;
  lon: number;
  lat: number;
  road_id: number | null;
  road_type: string | null;
  access_note: string | null;
  status: string;
}

export async function accessRoutes(fastify: FastifyInstance) {
  // ==================== ACCESS NOTES ====================

  /**
   * GET /access/notes
   * Get access notes for a building.
   */
  fastify.get<{ Querystring: { building_id: string } }>(
    '/access/notes',
    async (request, reply) => {
      const { building_id } = request.query;

      if (!building_id) {
        return reply.status(400).send({ error: 'building_id is required' });
      }

      const notes = await query<AccessNote>(
        `SELECT id, building_id, note, affirmation_count, created_at, decay_at
         FROM access_notes
         WHERE building_id = $1 AND decay_at > NOW()
         ORDER BY affirmation_count DESC, created_at DESC`,
        [parseInt(building_id)]
      );

      return { notes };
    }
  );

  /**
   * POST /access/notes
   * Submit a new access note (Tier 0 - anonymous allowed).
   */
  fastify.post<{ Body: z.infer<typeof noteSchema> }>(
    '/access/notes',
    async (request, reply) => {
      const parsed = noteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid note data', details: parsed.error.issues });
      }

      const { building_id, note, user_id } = parsed.data;

      // Check if building exists
      const building = await queryOne<{ id: number }>(
        `SELECT id FROM buildings WHERE id = $1`,
        [building_id]
      );

      if (!building) {
        return reply.status(404).send({ error: 'Building not found' });
      }

      const accessNote = await queryOne<AccessNote>(
        `INSERT INTO access_notes (building_id, note, submitted_by)
         VALUES ($1, $2, $3)
         RETURNING id, building_id, note, affirmation_count, created_at, decay_at`,
        [building_id, note, user_id]
      );

      return reply.status(201).send(accessNote);
    }
  );

  /**
   * POST /access/notes/:id/vote
   * Vote on an access note.
   */
  fastify.post<{ Params: { id: string }; Body: z.infer<typeof voteSchema> }>(
    '/access/notes/:id/vote',
    async (request, reply) => {
      const { id } = request.params;
      const parsed = voteSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid vote data' });
      }

      const { user_id, vote } = parsed.data;

      // Only affirm votes for notes (no reject)
      if (vote !== 'affirm') {
        return reply.status(400).send({ error: 'Access notes can only be affirmed' });
      }

      // Check note exists
      const note = await queryOne<{ id: string }>(
        `SELECT id FROM access_notes WHERE id = $1`,
        [id]
      );

      if (!note) {
        return reply.status(404).send({ error: 'Note not found' });
      }

      // Check if user already voted
      const existingVote = await queryOne<{ id: string }>(
        `SELECT id FROM affirmations
         WHERE user_id = $1 AND target_type = 'access_note' AND target_id = $2`,
        [user_id, id]
      );

      if (existingVote) {
        return reply.status(409).send({ error: 'You have already affirmed this note' });
      }

      // Cast vote
      await query(
        `INSERT INTO affirmations (user_id, target_type, target_id, vote)
         VALUES ($1, 'access_note', $2, $3)`,
        [user_id, id, vote]
      );

      // Get updated note
      const updated = await queryOne<AccessNote>(
        `SELECT id, affirmation_count, decay_at FROM access_notes WHERE id = $1`,
        [id]
      );

      return { success: true, note: updated };
    }
  );

  // ==================== ACCESS POINTS ====================

  /**
   * GET /access/points
   * Get access points for a building.
   */
  fastify.get<{ Querystring: { building_id: string } }>(
    '/access/points',
    async (request, reply) => {
      const { building_id } = request.query;

      if (!building_id) {
        return reply.status(400).send({ error: 'building_id is required' });
      }

      const points = await query<AccessPoint>(
        `SELECT
          id, building_id,
          ST_X(geometry) as lon, ST_Y(geometry) as lat,
          road_id, road_type, access_note, status
         FROM access_points
         WHERE building_id = $1 AND status != 'decayed'
         ORDER BY affirmation_count DESC`,
        [parseInt(building_id)]
      );

      return { points };
    }
  );

  /**
   * POST /access/points
   * Submit a new access point location.
   */
  fastify.post<{ Body: z.infer<typeof accessPointSchema> }>(
    '/access/points',
    async (request, reply) => {
      const parsed = accessPointSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid access point data', details: parsed.error.issues });
      }

      const { building_id, lon, lat, road_id, road_type, access_note, user_id } = parsed.data;

      // Check if building exists
      const building = await queryOne<{ id: number }>(
        `SELECT id FROM buildings WHERE id = $1`,
        [building_id]
      );

      if (!building) {
        return reply.status(404).send({ error: 'Building not found' });
      }

      const point = await queryOne<AccessPoint>(
        `INSERT INTO access_points
          (building_id, geometry, road_id, road_type, access_note, submitted_by)
         VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, $5, $6, $7)
         RETURNING id, building_id, ST_X(geometry) as lon, ST_Y(geometry) as lat,
                   road_id, road_type, access_note, status`,
        [building_id, lon, lat, road_id, road_type, access_note, user_id]
      );

      return reply.status(201).send(point);
    }
  );

  // ==================== BUILDING ADDRESSES VIEW ====================

  /**
   * GET /access/addresses/:building_id
   * Get all addresses for a building (official + claims + notes).
   */
  fastify.get<{ Params: { building_id: string } }>(
    '/access/addresses/:building_id',
    async (request, reply) => {
      const { building_id } = request.params;
      const buildingIdNum = parseInt(building_id);

      // Get from unified view
      const addresses = await query<{
        address_type: string;
        house_number: string;
        street_name: string;
        source: string;
        access_type: string;
        confidence: number;
      }>(
        `SELECT address_type, house_number, street_name, source, access_type, confidence
         FROM building_addresses
         WHERE building_id = $1
         ORDER BY confidence DESC`,
        [buildingIdNum]
      );

      // Get access notes
      const notes = await query<AccessNote>(
        `SELECT id, note, affirmation_count, created_at
         FROM access_notes
         WHERE building_id = $1 AND decay_at > NOW()
         ORDER BY affirmation_count DESC
         LIMIT 5`,
        [buildingIdNum]
      );

      // Get access points
      const points = await query<AccessPoint>(
        `SELECT id, ST_X(geometry) as lon, ST_Y(geometry) as lat, access_note
         FROM access_points
         WHERE building_id = $1 AND status = 'accepted'`,
        [buildingIdNum]
      );

      return { addresses, notes, points };
    }
  );
}
