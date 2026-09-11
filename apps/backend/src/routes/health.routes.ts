import type { FastifyInstance } from 'fastify';
import { getIndexingStatus } from '../lib/indexing-status.js';

export default async function healthRoutes(fastify: FastifyInstance) {
  // Health check
  fastify.get('/health', async () => {
    const indexing = getIndexingStatus();
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      indexing: indexing.indexing,
      indexError: indexing.indexError,
    };
  });

  fastify.get('/health/queues', async (_request, reply) => {
    try {
      const { encodingQueue, thumbnailQueue, mediaRefreshQueue } = await import('../services/queue/index.js');
      const [encoding, thumbnail, mediaRefresh] = await Promise.all([
        encodingQueue.getJobCounts(),
        thumbnailQueue.getJobCounts(),
        mediaRefreshQueue.getJobCounts()
      ]);
      return { status: 'ok', queues: { encoding, thumbnail, mediaRefresh } };
    } catch (error: any) {
      return reply.code(503).send({
        status: 'degraded',
        error: error?.message ?? String(error)
      });
    }
  });
}
