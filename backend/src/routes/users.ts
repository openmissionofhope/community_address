/**
 * @fileoverview User routes for the Community Address API.
 * Handles user creation, verification, and profile management.
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db/connection.js';
import crypto from 'crypto';

const phoneSchema = z.string().regex(/^\+?[1-9]\d{6,14}$/);

interface User {
  id: string;
  phone_hash: string;
  trust_score: number;
  contribution_count: number;
  created_at: string;
}

/**
 * Hash a phone number for storage.
 */
function hashPhone(phone: string): string {
  return crypto.createHash('sha256').update(phone.trim()).digest('hex');
}

export async function usersRoutes(fastify: FastifyInstance) {
  /**
   * POST /users
   * Create or get a user by phone number.
   * In production, this would send an OTP; for now, simplified.
   */
  fastify.post<{ Body: { phone: string } }>(
    '/users',
    async (request, reply) => {
      const { phone } = request.body;

      const parsed = phoneSchema.safeParse(phone);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid phone number format' });
      }

      const phoneHash = hashPhone(phone);

      // Try to find existing user
      let user = await queryOne<User>(
        `SELECT id, phone_hash, trust_score, contribution_count, created_at
         FROM users WHERE phone_hash = $1`,
        [phoneHash]
      );

      if (!user) {
        // Create new user
        user = await queryOne<User>(
          `INSERT INTO users (phone_hash)
           VALUES ($1)
           RETURNING id, phone_hash, trust_score, contribution_count, created_at`,
          [phoneHash]
        );
      } else {
        // Update last active
        await query(
          `UPDATE users SET last_active_at = NOW() WHERE id = $1`,
          [user.id]
        );
      }

      return {
        id: user!.id,
        trust_score: user!.trust_score,
        contribution_count: user!.contribution_count,
        is_new: !user?.created_at,
      };
    }
  );

  /**
   * GET /users/:id
   * Get user profile.
   */
  fastify.get<{ Params: { id: string } }>(
    '/users/:id',
    async (request, reply) => {
      const { id } = request.params;

      const user = await queryOne<User>(
        `SELECT id, trust_score, contribution_count, created_at
         FROM users WHERE id = $1`,
        [id]
      );

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      return user;
    }
  );

  /**
   * GET /users/:id/contributions
   * Get user's contributions (claims, notes).
   */
  fastify.get<{ Params: { id: string } }>(
    '/users/:id/contributions',
    async (request, _reply) => {
      const { id } = request.params;

      const claims = await query<{ id: string; building_id: number; house_number: string; status: string; created_at: string }>(
        `SELECT id, building_id, house_number, status, created_at
         FROM address_claims
         WHERE submitted_by = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [id]
      );

      const notes = await query<{ id: string; building_id: number; note: string; affirmation_count: number; created_at: string }>(
        `SELECT id, building_id, note, affirmation_count, created_at
         FROM access_notes
         WHERE submitted_by = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [id]
      );

      return { claims, notes };
    }
  );
}
