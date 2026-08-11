import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { redis } from '../services/redis.js';

export default async function queueStateRoutes(fastify: FastifyInstance) {
  // Get current compression queue state for authenticated user
  fastify.get('/api/queue-state', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    const token = authHeader.slice(7);
    let userId: string;
    try {
      const decoded = fastify.jwt.verify<any>(token);
      userId = String(decoded.id);
      const userResult = await db.query('SELECT id FROM users WHERE id = $1', [userId]);
      if (userResult.rows.length === 0) return reply.code(401).send({ error: 'Invalid token' });
    } catch {
      return reply.code(401).send({ error: 'Invalid token' });
    }

    const raw = await redis.get(`compress_queue:${userId}`);
    return reply.send({ queue: raw ? JSON.parse(raw) : [] });
  });

  // Persist queue state (for dismiss / clear completed operations)
  fastify.put('/api/queue-state', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    const token = authHeader.slice(7);
    let userId: string;
    try {
      const decoded = fastify.jwt.verify<any>(token);
      userId = String(decoded.id);
      const userResult = await db.query('SELECT id FROM users WHERE id = $1', [userId]);
      if (userResult.rows.length === 0) return reply.code(401).send({ error: 'Invalid token' });
    } catch {
      return reply.code(401).send({ error: 'Invalid token' });
    }

    const { queue } = request.body as { queue: unknown[] };
    await redis.set(`compress_queue:${userId}`, JSON.stringify(queue ?? []), 'EX', 604800);
    return reply.send({ ok: true });
  });
}
