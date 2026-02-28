import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import mercurius from 'mercurius';
import { config } from './config.js';
import { schema } from './graphql/schema.js';
import { resolvers } from './graphql/resolvers.js';
import { buildContext } from './graphql/context.js';
import { db } from './db/index.js';
import { ensureAdminExists } from './services/auth.js';
import { indexMediaLibrary } from './services/media-indexer.js';
import { startMediaWatcher } from './services/media-watcher.js';
import { startWorkers } from './services/queue.js';
import { getWebCompatibleVideo, markTranscodeAccessed, startTranscodeCleanup, deleteTranscodedVideo, ensureHLS } from './services/video-transcode.js';
import { startCacheMaintenance } from './services/cache-maintenance.js';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

let workerHandles: ReturnType<typeof startWorkers> | null = null;
let cacheMaintenanceTimer: ReturnType<typeof setInterval> | null = null;

const fastify = Fastify({
  logger: true
});

// Register plugins
await fastify.register(cors, {
  origin: true,
  credentials: true
});

await fastify.register(jwt, {
  secret: config.jwtSecret
});

await fastify.register(multipart, {
  limits: {
    fileSize: 1024 * 1024 * 1024 // 1GB
  }
});

// Serve thumbnails
await fs.promises.mkdir(path.resolve(config.thumbnailCachePath), { recursive: true });
await fastify.register(fastifyStatic, {
  root: path.resolve(config.thumbnailCachePath),
  prefix: '/thumbnails/'
});

const previewCachePath = path.resolve(path.dirname(config.thumbnailCachePath), 'previews');
await fs.promises.mkdir(previewCachePath, { recursive: true });

// Serve media files
await fastify.register(fastifyStatic, {
  root: path.resolve(config.mediaLibraryPath),
  prefix: '/media/',
  decorateReply: false,
  acceptRanges: true,
  cacheControl: true,
  maxAge: '1d'
});

// Serve HLS segments
const hlsCachePath = path.resolve(path.dirname(config.thumbnailCachePath), 'hls');
await fs.promises.mkdir(hlsCachePath, { recursive: true });

await fastify.register(fastifyStatic, {
  root: hlsCachePath,
  prefix: '/hls/',
  decorateReply: false
});

// Web-compatible image endpoint (HEIC -> JPEG).
fastify.get('/image/:id', async (request, reply) => {
  const { id } = request.params as { id: string };

  const result = await db.query('SELECT file_path, mime_type FROM media_assets WHERE id = $1', [id]);
  if (result.rows.length === 0) {
    return reply.code(404).send({ error: 'Image not found' });
  }

  const filePathRaw = result.rows[0].file_path as string;
  const mimeType = result.rows[0].mime_type as string;

  if (!mimeType.startsWith('image/')) {
    return reply.code(400).send({ error: 'Not an image file' });
  }

  const absPath = path.resolve(filePathRaw);
  const ext = path.extname(filePathRaw).toLowerCase();

  // Most browsers don't support image/heic. Convert on-demand and cache.
  if (mimeType === 'image/heic' || ext === '.heic') {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(absPath);
    } catch {
      return reply.code(404).send({ error: 'Image not found on disk' });
    }

    const cacheKey = crypto
      .createHash('md5')
      .update(`${absPath}:${stat.mtimeMs}`)
      .digest('hex');
    const cachedPath = path.join(previewCachePath, `${cacheKey}.jpg`);

    try {
      await fs.promises.access(cachedPath);
    } catch {
      const { renderHeicToJpeg } = await import('./services/thumbnail.js');
      await renderHeicToJpeg(absPath, cachedPath, {
        kind: 'inside',
        maxWidth: config.previewMaxDimension,
        maxHeight: config.previewMaxDimension,
        quality: config.previewQuality
      });
    }

    reply.header('Content-Type', 'image/jpeg');
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(fs.createReadStream(cachedPath));
  }

  // For non-HEIC images, stream the original from disk with its mime type.
  reply.header('Content-Type', mimeType);
  reply.header('Cache-Control', 'public, max-age=86400');
  return reply.send(fs.createReadStream(absPath));
});

// On-demand video transcoding endpoint
fastify.get('/video/:id', async (request, reply) => {
  const { id } = request.params as { id: string };

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

fastify.get('/video/:id/hls', async (request, reply) => {
  const { id } = request.params as { id: string };

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
fastify.delete('/video/:id/cleanup', async (request, reply) => {
  const { id } = request.params as { id: string };

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

// GraphQL
// @ts-ignore
await fastify.register(mercurius, {
  schema,
  resolvers,
  context: buildContext,
  graphiql: process.env.NODE_ENV !== 'production'
});

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

fastify.get('/health/queues', async (_request, reply) => {
  try {
    const { encodingQueue, thumbnailQueue } = await import('./services/queue.js');
    const [encoding, thumbnail] = await Promise.all([
      encodingQueue.getJobCounts(),
      thumbnailQueue.getJobCounts()
    ]);
    return { status: 'ok', queues: { encoding, thumbnail } };
  } catch (error: any) {
    return reply.code(503).send({
      status: 'degraded',
      error: error?.message ?? String(error)
    });
  }
});

// Startup
const start = async () => {
  try {
    // Check database connection
    await db.query('SELECT NOW()');
    fastify.log.info('Database connected');

    // Ensure admin exists (first-time setup)
    await ensureAdminExists();

    // Index existing media library
    fastify.log.info('Starting initial media library indexing...');
    await indexMediaLibrary();
    fastify.log.info('Initial media library indexed');

    // Start file system watcher
    fastify.log.info('Starting media file watcher...');
    startMediaWatcher();

    // Start transcode cleanup service
    startTranscodeCleanup();

    // Start cache maintenance service
    cacheMaintenanceTimer = startCacheMaintenance();

    // Start background queue workers
    workerHandles = startWorkers();

    await fastify.listen({
      port: config.port,
      host: config.host
    });

    fastify.log.info(`Server listening on ${config.host}:${config.port}`);
    fastify.log.info(`GraphiQL available at http://${config.host}:${config.port}/graphiql`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
