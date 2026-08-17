import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { isValidAssetId, resolveWithinRoot } from '../lib/media-path.js';
import { encodingQueue } from '../services/queue/index.js';
import { redis } from '../services/redis.js';
import { getWebCompatibleVideo, markTranscodeAccessed, deleteTranscodedVideo, ensureHLS, checkVideoCompatibility } from '../services/video-transcode/index.js';

export default async function videoRoutes(fastify: FastifyInstance) {
  // Lightweight playback negotiation — does not block on transcoding
  fastify.get('/video/:id/prepare', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isValidAssetId(id)) {
      return reply.code(400).send({ error: 'Invalid asset id' });
    }

    try {
      const result = await db.query(
        'SELECT file_path, mime_type, transcoded_path FROM media_assets WHERE id = $1',
        [id]
      );
      if (result.rows.length === 0) return reply.code(404).send({ error: 'Video not found' });

      const { file_path, mime_type, transcoded_path } = result.rows[0];
      if (!mime_type || !mime_type.startsWith('video/')) {
        return reply.code(400).send({ error: 'Not a video file' });
      }

      // Fast path: a batch/background transcode already produced a cached MP4.
      if (transcoded_path && fs.existsSync(transcoded_path)) {
        return reply.send({ type: 'mp4', url: `/video/${id}` });
      }

      try {
        const info = await checkVideoCompatibility(file_path);
        if (!info.needsTranscoding) {
          return reply.send({ type: 'mp4', url: `/video/${id}` });
        }
      } catch (err) {
        fastify.log.warn({ err }, '[prepare] checkVideoCompatibility failed, falling back to HLS');
      }

      const hlsRoot = path.resolve(path.dirname(config.thumbnailCachePath), 'hls');
      const playlistPath = resolveWithinRoot(hlsRoot, path.join(hlsRoot, id, 'master.m3u8'));
      if (!playlistPath) {
        return reply.code(400).send({ error: 'Invalid asset id' });
      }
      const alreadyCached = fs.existsSync(playlistPath);

      if (!alreadyCached) {
        const hlsJobId = `hls-${id}`;
        try {
          const existing = await encodingQueue.getJob(hlsJobId);
          let shouldEnqueue = !existing;
          if (existing) {
            const state = await existing.getState().catch(() => 'unknown');
            if (state === 'completed' || state === 'failed') {
              await existing.remove().catch(() => {});
              shouldEnqueue = true;
            }
          }
          if (shouldEnqueue) {
            await encodingQueue.add(
              'transcode',
              { filePath: file_path, assetId: id, type: 'hls' },
              { jobId: hlsJobId }
            );
            await redis.set(
              `video_progress:${id}`,
              JSON.stringify({ percent: 0, status: 'queued' }),
              'EX',
              3600
            );
          }
        } catch (err) {
          fastify.log.error({ err }, '[prepare] failed to enqueue HLS job');
        }
      }

      return reply.send({
        type: 'hls',
        playlistUrl: `/hls/${id}/master.m3u8`,
        progressUrl: `/video/${id}/progress`,
        ready: alreadyCached,
      });
    } catch (err) {
      fastify.log.error({ err }, '[prepare] unexpected error');
      return reply.code(500).send({ error: 'Prepare failed', detail: (err as Error)?.message });
    }
  });

  // Transcoding progress polling endpoint
  fastify.get('/video/:id/progress', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isValidAssetId(id)) {
      return reply.code(400).send({ error: 'Invalid asset id' });
    }
    const hlsRoot = path.resolve(path.dirname(config.thumbnailCachePath), 'hls');
    const playlistPath = resolveWithinRoot(hlsRoot, path.join(hlsRoot, id, 'master.m3u8'));
    if (!playlistPath) {
      return reply.code(400).send({ error: 'Invalid asset id' });
    }
    const playlistReady = fs.existsSync(playlistPath);
    const raw = await redis.get(`video_progress:${id}`);
    if (!raw) {
      if (playlistReady) {
        return reply.send({ percent: 100, status: 'ready', playlistReady: true });
      }
      return reply.send({ percent: 0, status: 'unknown', playlistReady: false });
    }
    const parsed = JSON.parse(raw);
    return reply.send({ ...parsed, playlistReady });
  });

  // On-demand video transcoding endpoint
  fastify.get('/video/:id', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isValidAssetId(id)) {
      return reply.code(400).send({ error: 'Invalid asset id' });
    }

    try {
      // Get video info from database
      const result = await db.query(
        'SELECT file_path, mime_type FROM media_assets WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Video not found' });
      }

      const { file_path, mime_type } = result.rows[0];

      if (!mime_type.startsWith('video/')) {
        return reply.code(400).send({ error: 'Not a video file' });
      }

      // Get web-compatible video (transcode if needed)
      const videoPath = await getWebCompatibleVideo(file_path, id);

      // Mark as accessed for cleanup tracking
      markTranscodeAccessed(videoPath);

      // Stream the video with range support
      const stat = fs.statSync(videoPath);
      const fileSize = stat.size;
      const range = request.headers.range;

      if (range) {
        const raw = range.replace(/bytes=/, '').split(',')[0].trim();
        const parts = raw.split('-');
        const startPart = parts[0]?.trim() ?? '';
        const endPart = parts[1]?.trim() ?? '';

        let start = 0;
        let end = fileSize - 1;

        if (!startPart && !endPart) {
          reply.code(416);
          reply.header('Content-Range', `bytes */${fileSize}`);
          return reply.send({ error: 'Invalid range header' });
        }

        if (!startPart) {
          // Suffix-byte range, e.g. bytes=-500
          const suffixLength = Number.parseInt(endPart, 10);
          if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
            reply.code(416);
            reply.header('Content-Range', `bytes */${fileSize}`);
            return reply.send({ error: 'Invalid range header' });
          }
          start = Math.max(fileSize - suffixLength, 0);
        } else {
          start = Number.parseInt(startPart, 10);
          if (!Number.isFinite(start) || start < 0) {
            reply.code(416);
            reply.header('Content-Range', `bytes */${fileSize}`);
            return reply.send({ error: 'Invalid range header' });
          }
        }

        if (endPart) {
          end = Number.parseInt(endPart, 10);
          if (!Number.isFinite(end) || end < 0) {
            reply.code(416);
            reply.header('Content-Range', `bytes */${fileSize}`);
            return reply.send({ error: 'Invalid range header' });
          }
        }

        if (start >= fileSize || start > end) {
          reply.code(416);
          reply.header('Content-Range', `bytes */${fileSize}`);
          return reply.send({ error: 'Range not satisfiable' });
        }

        end = Math.min(end, fileSize - 1);
        const chunksize = (end - start) + 1;
        const stream = fs.createReadStream(videoPath, { start, end });

        reply.code(206);
        reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        reply.header('Accept-Ranges', 'bytes');
        reply.header('Content-Length', chunksize);
        reply.header('Content-Type', 'video/mp4');

        return reply.send(stream);
      } else {
        reply.header('Content-Length', fileSize);
        reply.header('Content-Type', 'video/mp4');

        const stream = fs.createReadStream(videoPath);
        return reply.send(stream);
      }
    } catch (error) {
      fastify.log.error(error, 'Error serving video');
      return reply.code(500).send({ error: 'Error serving video' });
    }
  });

  fastify.get('/video/:id/hls', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isValidAssetId(id)) {
      return reply.code(400).send({ error: 'Invalid asset id' });
    }

    // Get file path from DB
    const result = await db.query('SELECT file_path FROM media_assets WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Video not found' });
    }

    try {
      await ensureHLS(result.rows[0].file_path, id);
      return reply.redirect(`/hls/${id}/master.m3u8`);
    } catch (error: any) {
      if (error.message.includes('started')) {
        return reply.code(202).send({ status: 'processing', message: 'HLS generation queued' });
      }
      fastify.log.error(error, 'Error generating HLS');
      return reply.code(500).send({ error: 'HLS generation failed ' + error.message });
    }
  });

  // Delete transcoded video endpoint (called when video dialog closes)
  fastify.delete('/video/:id/cleanup', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isValidAssetId(id)) {
      return reply.code(400).send({ error: 'Invalid asset id' });
    }

    try {
      // Get video info from database
      const result = await db.query(
        'SELECT file_path, mime_type FROM media_assets WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Video not found' });
      }

      const { file_path, mime_type } = result.rows[0];

      if (!mime_type.startsWith('video/')) {
        return reply.code(400).send({ error: 'Not a video file' });
      }

      // Delete transcoded video if it exists
      await deleteTranscodedVideo(file_path, id);

      return reply.send({ success: true, message: 'Transcoded video cleaned up' });
    } catch (error) {
      fastify.log.error(error, 'Error cleaning up transcoded video');
      return reply.code(500).send({ error: 'Error cleaning up transcoded video' });
    }
  });
}
