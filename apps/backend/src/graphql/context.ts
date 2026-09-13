import type { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/index.js';

export interface GraphQLContext {
  request: FastifyRequest;
  reply: FastifyReply;
  user?: any;
}

export async function buildContext(request: FastifyRequest, reply: FastifyReply): Promise<GraphQLContext> {
  let user = null;

  try {
    await request.jwtVerify();
    const payload = request.user as { id?: unknown };
    const result = await db.query(
      'SELECT id, username, role FROM users WHERE id = $1',
      [payload.id]
    );
    if (result.rows.length > 0) {
      user = result.rows[0];
    }
  } catch (err) {
    // Not authenticated, that's ok for some queries
  }

  return {
    request,
    reply,
    user
  };
}
