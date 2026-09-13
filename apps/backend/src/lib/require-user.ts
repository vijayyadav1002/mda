import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db/index.js';

export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  try {
    await request.jwtVerify();
    const payload = request.user as { id?: unknown };
    const result = await db.query(
      'SELECT id, username, role FROM users WHERE id = $1',
      [payload.id]
    );
    if (result.rows.length === 0) {
      reply.code(401).send({ error: 'Unauthorized' });
      return false;
    }
    request.user = result.rows[0];
    return true;
  } catch {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
}
