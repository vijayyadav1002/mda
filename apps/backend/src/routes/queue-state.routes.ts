import type { FastifyInstance } from 'fastify';
import { redis } from '../services/redis.js';

export default async function queueStateRoutes(fastify: FastifyInstance) {
  // Get current compression queue state for authenticated user
  fastify.get('/api/queue-state', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = String((request.user as { id: string }).id);

    const raw = await redis.get(`compress_queue:${userId}`);
    return reply.send({ queue: raw ? JSON.parse(raw) : [] });
  });

  // Persist queue state (for dismiss / clear completed operations)
  fastify.put('/api/queue-state', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = String((request.user as { id: string }).id);

    const { queue } = request.body as { queue: unknown[] };
    await redis.set(`compress_queue:${userId}`, JSON.stringify(queue ?? []), 'EX', 604800);
    return reply.send({ ok: true });
  });
}
