/**
 * @fileoverview Address claims routes for the Community Address API.
 * Handles submitting, viewing, and voting on address claims.
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db/connection.js';

const claimSchema = z.object({
  building_id: z.number(),
  road_id: z.number(),
  road_type: z.enum(['osm', 'placeholder']),
  house_number: z.string().min(1).max(50),
  source: z.enum(['osm', 'community', 'official_reported']).default('community'),
  access_type: z.enum(['primary', 'alternative', 'historical']).default('primary'),
  user_id: z.string().uuid().optional(),
});

const voteSchema = z.object({
  user_id: z.string().uuid(),
  vote: z.enum(['affirm', 'reject']),
});

interface AddressClaim {
  id: string;
  building_id: number;
  road_id: number;
  road_type: string;
  house_number: string;
  source: string;
  access_type: string;
  affirmation_count: number;
  rejection_count: number;
  status: string;
  created_at: string;
  street_name?: string;
}

export async function claimsRoutes(fastify: FastifyInstance) {
  /**
   * GET /claims
   * Get claims for a building.
   */
  fastify.get<{ Querystring: { building_id: string } }>(
    '/claims',
    async (request, reply) => {
      const { building_id } = request.query;

      if (!building_id) {
        return reply.status(400).send({ error: 'building_id is required' });
      }

      const claims = await query<AddressClaim>(
        `SELECT
          ac.id, ac.building_id, ac.road_id, ac.road_type,
          ac.house_number, ac.source, ac.access_type,
          ac.affirmation_count, ac.rejection_count, ac.status,
          ac.created_at,
          COALESCE(rn.name, ps.display_name, s.name) as street_name
        FROM address_claims ac
        LEFT JOIN road_names rn ON rn.id = ac.road_name_id
        LEFT JOIN placeholder_streets ps ON ac.road_type = 'placeholder' AND ps.id = ac.road_id
        LEFT JOIN streets s ON ac.road_type = 'osm' AND s.id = ac.road_id
        WHERE ac.building_id = $1 AND ac.status != 'decayed'
        ORDER BY
          CASE ac.status WHEN 'accepted' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
          ac.affirmation_count DESC`,
        [parseInt(building_id)]
      );

      return { claims };
    }
  );

  /**
   * POST /claims
   * Submit a new address claim.
   */
  fastify.post<{ Body: z.infer<typeof claimSchema> }>(
    '/claims',
    async (request, reply) => {
      const parsed = claimSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid claim data', details: parsed.error.issues });
      }

      const { building_id, road_id, road_type, house_number, source, access_type, user_id } = parsed.data;

      // Check if building exists
      const building = await queryOne<{ id: number }>(
        `SELECT id FROM buildings WHERE id = $1`,
        [building_id]
      );

      if (!building) {
        return reply.status(404).send({ error: 'Building not found' });
      }

      // Check for duplicate claim
      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM address_claims
         WHERE building_id = $1 AND road_id = $2 AND road_type = $3 AND house_number = $4`,
        [building_id, road_id, road_type, house_number]
      );

      if (existing) {
        return reply.status(409).send({ error: 'This address claim already exists', claim_id: existing.id });
      }

      // Auto-accept if from trusted user
      let status = 'pending';
      if (user_id) {
        const user = await queryOne<{ trust_score: number }>(
          `SELECT trust_score FROM users WHERE id = $1`,
          [user_id]
        );
        if (user && user.trust_score >= 0.8) {
          status = 'accepted';
        }
      }

      const claim = await queryOne<AddressClaim>(
        `INSERT INTO address_claims
          (building_id, road_id, road_type, house_number, source, access_type, submitted_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, building_id, road_id, road_type, house_number, source, access_type,
                   affirmation_count, rejection_count, status, created_at`,
        [building_id, road_id, road_type, house_number, source, access_type, user_id, status]
      );

      return reply.status(201).send(claim);
    }
  );

  /**
   * POST /claims/:id/vote
   * Vote on an address claim.
   */
  fastify.post<{ Params: { id: string }; Body: z.infer<typeof voteSchema> }>(
    '/claims/:id/vote',
    async (request, reply) => {
      const { id } = request.params;
      const parsed = voteSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid vote data' });
      }

      const { user_id, vote } = parsed.data;

      // Check claim exists
      const claim = await queryOne<{ id: string; status: string }>(
        `SELECT id, status FROM address_claims WHERE id = $1`,
        [id]
      );

      if (!claim) {
        return reply.status(404).send({ error: 'Claim not found' });
      }

      // Check if user already voted
      const existingVote = await queryOne<{ id: string }>(
        `SELECT id FROM affirmations
         WHERE user_id = $1 AND target_type = 'address_claim' AND target_id = $2`,
        [user_id, id]
      );

      if (existingVote) {
        return reply.status(409).send({ error: 'You have already voted on this claim' });
      }

      // Cast vote (trigger will update counts)
      await query(
        `INSERT INTO affirmations (user_id, target_type, target_id, vote)
         VALUES ($1, 'address_claim', $2, $3)`,
        [user_id, id, vote]
      );

      // Get updated claim
      const updated = await queryOne<AddressClaim>(
        `SELECT id, affirmation_count, rejection_count, status
         FROM address_claims WHERE id = $1`,
        [id]
      );

      return { success: true, claim: updated };
    }
  );

  /**
   * GET /claims/:id
   * Get a single claim with details.
   */
  fastify.get<{ Params: { id: string } }>(
    '/claims/:id',
    async (request, reply) => {
      const { id } = request.params;

      const claim = await queryOne<AddressClaim & { submitted_by: string }>(
        `SELECT
          ac.*,
          COALESCE(rn.name, ps.display_name, s.name) as street_name
        FROM address_claims ac
        LEFT JOIN road_names rn ON rn.id = ac.road_name_id
        LEFT JOIN placeholder_streets ps ON ac.road_type = 'placeholder' AND ps.id = ac.road_id
        LEFT JOIN streets s ON ac.road_type = 'osm' AND s.id = ac.road_id
        WHERE ac.id = $1`,
        [id]
      );

      if (!claim) {
        return reply.status(404).send({ error: 'Claim not found' });
      }

      return claim;
    }
  );
}
