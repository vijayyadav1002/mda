import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { addToTranscodeQueue } from '../services/queue/index.js';
import { redis } from '../services/redis.js';

export default async function transcodeRoutes(fastify: FastifyInstance) {
  // Enqueue a batch video-transcode job (shares the queue panel + cancel endpoint
  // with compression jobs via the same per-user Redis queue)
  fastify.post('/api/transcode/enqueue', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = request.user as { id: string; role: string };
    if (!['admin', 'editor'].includes(user.role)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const userId = String(user.id);

    const { ids } = request.body as { ids: string[] };
    if (!ids?.length) return reply.code(400).send({ error: 'No asset IDs provided' });

    const rows = await Promise.all(
      ids.map(id =>
        db.query('SELECT id, file_name, file_size, mime_type, file_path FROM media_assets WHERE id = $1', [id])
          .then(r => r.rows[0] ?? null)
      )
    );
    const allAssets = rows.filter(Boolean).map(r => ({
      id: String(r.id),
      fileName: r.file_name as string,
      fileSize: String(r.file_size),
      mimeType: r.mime_type as string,
      filePath: r.file_path as string,
    }));
    const assets = allAssets.filter((asset) => asset.mimeType.startsWith('video/'));

    if (assets.length === 0) return reply.code(400).send({ error: 'No video assets found' });

    const jobId = crypto.randomUUID();
    const queueKey = `compress_queue:${userId}`;
    const raw = await redis.get(queueKey);
    const queue: any[] = raw ? JSON.parse(raw) : [];

    const newJob = {
      id: jobId,
      kind: 'transcode',
      assets: assets.map(({ filePath: _fp, ...a }) => a),
      status: 'pending',
      progress: {},
      currentFileId: null,
      previews: [],
      addedAt: Date.now(),
    };
    queue.push(newJob);
    await redis.set(queueKey, JSON.stringify(queue), 'EX', 604800);

    await addToTranscodeQueue({ userId, jobId, assets });
    return reply.send({ jobId, skippedCount: allAssets.length - assets.length });
  });
}
