import type { FastifyRequest, FastifyReply } from 'fastify';

export interface GraphQLContext {
  request: FastifyRequest;
  reply: FastifyReply;
  user?: any;
}

export async function buildContext(request: FastifyRequest, reply: FastifyReply): Promise<GraphQLContext> {
  let user = null;
  
  try {
    await request.jwtVerify();
    user = request.user;
  } catch (err) {
    // Not authenticated, that's ok for some queries
  }

  return {
    request,
    reply,
    user
  };
}
