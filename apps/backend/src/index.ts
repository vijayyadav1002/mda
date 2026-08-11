import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import mercurius from 'mercurius';
import { config } from './config.js';
import { schema } from './graphql/schema/index.js';
import { resolvers } from './graphql/resolvers/index.js';
import { buildContext } from './graphql/context.js';
import { db } from './db/index.js';
import { ensureAdminExists } from './services/auth.js';
import { indexMediaLibrary } from './services/media-indexer.js';
import { backfillCaptureDates } from './services/capture-date.js';
import { startMediaWatcher } from './services/media-watcher.js';
import { startWorkers, addToCompressionQueue, addToTranscodeQueue, compressionQueue, activeCompressionAborts } from './services/queue.js';
import { redis } from './services/redis.js';
import { startCacheMaintenance } from './services/cache-maintenance.js';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { indexFile } from './services/media-indexer.js';
import { canCompressFile } from './services/file-types.js';
import { resolveWithinRoot } from './lib/media-path.js';
import downloadRoutes from './routes/download.routes.js';
import filePreviewRoutes from './routes/file-preview.routes.js';
import imageRoutes from './routes/image.routes.js';
import videoRoutes from './routes/video.routes.js';

let workerHandles: ReturnType<typeof startWorkers> | null = null;
let cacheMaintenanceTimer: ReturnType<typeof setInterval> | null = null;

const fastify = Fastify({
  logger: true,
  trustProxy: true
});

// Register plugins
await fastify.register(cors, {
  origin: true,
  credentials: true
});

await fastify.register(rateLimit, {
  max: 300,
  timeWindow: '1 minute',
  allowList: (request) => {
    return request.url.startsWith('/thumbnails/')
      || request.url.startsWith('/compress-preview/')
      || request.url.startsWith('/media/')
      || request.url.startsWith('/hls/');
  }
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

const compressPreviewPath = path.resolve(path.dirname(config.thumbnailCachePath), 'compress-preview');
await fs.promises.mkdir(compressPreviewPath, { recursive: true });

// Serve compress preview files
await fastify.register(fastifyStatic, {
  root: compressPreviewPath,
  prefix: '/compress-preview/',
  decorateReply: false,
  cacheControl: false
});

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

// Register route plugins
await fastify.register(downloadRoutes);
await fastify.register(filePreviewRoutes);
await fastify.register(imageRoutes);
await fastify.register(videoRoutes);

// Streaming compress preview endpoint with progress events
fastify.post('/api/compress/preview', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
  // Auth check
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);
  let userId: string;
  try {
    const decoded = fastify.jwt.verify<any>(token);
    userId = decoded.id;
    const userResult = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0 || !['admin', 'editor'].includes(userResult.rows[0].role)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  } catch {
    return reply.code(401).send({ error: 'Invalid token' });
  }

  const { ids, options } = request.body as { ids: string[]; options: { resolution?: string; quality?: number } };
  if (!ids?.length) {
    return reply.code(400).send({ error: 'No asset IDs provided' });
  }

  const previewDir = path.resolve(path.dirname(config.thumbnailCachePath), 'compress-preview');
  await fs.promises.mkdir(previewDir, { recursive: true });

  // Set up NDJSON streaming response
  reply.raw.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const send = (event: Record<string, any>) => {
    reply.raw.write(JSON.stringify(event) + '\n');
  };

  send({ type: 'start', total: ids.length });

  const fileStartTimes: number[] = [];

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const fileStartTime = Date.now();

    try {
      const result = await db.query('SELECT * FROM media_assets WHERE id = $1', [id]);
      if (result.rows.length === 0) {
        send({ type: 'file_error', assetId: id, error: 'Asset not found' });
        continue;
      }

      const asset = result.rows[0];
      const ext = path.extname(asset.file_path).toLowerCase();
      const previewExt = ext === '.heic' ? '.jpg' : ext;
      const previewFileName = `${id}_preview${previewExt}`;
      const previewPath = path.join(previewDir, previewFileName);
      const originalStats = await fs.promises.stat(asset.file_path);

      send({
        type: 'file_start',
        assetId: id,
        fileName: asset.file_name,
        index: i,
        total: ids.length,
        originalSize: originalStats.size.toString(),
        isVideo: asset.mime_type.startsWith('video/')
      });

      if (asset.mime_type.startsWith('image/')) {
        const { compressImageAdvanced } = await import('./services/thumbnail.js');
        await compressImageAdvanced(asset.file_path, previewPath, {
          resolution: options.resolution,
          quality: options.quality
        });
        send({ type: 'file_progress', assetId: id, percent: 100 });
      } else if (asset.mime_type.startsWith('video/')) {
        const { compressVideoAdvanced } = await import('./services/thumbnail.js');
        let lastSent = 0;
        await compressVideoAdvanced(asset.file_path, previewPath, {
          resolution: options.resolution,
          quality: options.quality,
          onProgress: (percent: number) => {
            // Throttle: only send every 2% change
            if (percent - lastSent >= 2 || percent >= 100) {
              lastSent = percent;
              const elapsed = (Date.now() - fileStartTime) / 1000;
              const etaSeconds = percent > 0 ? Math.round((elapsed / percent) * (100 - percent)) : null;
              send({ type: 'file_progress', assetId: id, percent, etaSeconds });
            }
          }
        });
      } else {
        send({ type: 'file_error', assetId: id, error: `Unsupported type: ${asset.mime_type}` });
        continue;
      }

      const compressedStats = await fs.promises.stat(previewPath);
      const elapsed = (Date.now() - fileStartTime) / 1000;
      fileStartTimes.push(elapsed);

      // Calculate overall ETA for remaining files
      const avgTimePerFile = fileStartTimes.reduce((a, b) => a + b, 0) / fileStartTimes.length;
      const remainingFiles = ids.length - (i + 1);
      const overallEtaSeconds = Math.round(avgTimePerFile * remainingFiles);

      send({
        type: 'file_complete',
        assetId: id,
        originalSize: originalStats.size.toString(),
        compressedSize: compressedStats.size.toString(),
        previewUrl: `/compress-preview/${previewFileName}`,
        elapsedSeconds: Math.round(elapsed),
        overallEtaSeconds
      });
    } catch (err: any) {
      send({ type: 'file_error', assetId: id, error: err.message || 'Compression failed' });
    }
  }

  send({ type: 'done' });
  reply.raw.end();
});

// Enqueue compression job — creates BullMQ job + initial Redis state
fastify.post('/api/compress/enqueue', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);
  let userId: string;
  try {
    const decoded = fastify.jwt.verify<any>(token);
    userId = String(decoded.id);
    const userResult = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0 || !['admin', 'editor'].includes(userResult.rows[0].role)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  } catch {
    return reply.code(401).send({ error: 'Invalid token' });
  }

  const { ids, options } = request.body as { ids: string[]; options: { resolution: string; quality: number } };
  if (!ids?.length) return reply.code(400).send({ error: 'No asset IDs provided' });

  // Resolve file paths and metadata from DB
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
  const assets = allAssets.filter((asset) => canCompressFile(asset.fileName, asset.mimeType));

  if (assets.length === 0) return reply.code(400).send({ error: 'No valid assets found' });

  const jobId = crypto.randomUUID();
  const queueKey = `compress_queue:${userId}`;
  const raw = await redis.get(queueKey);
  const queue: any[] = raw ? JSON.parse(raw) : [];

  // Store frontend-visible job data (no filePath)
  const newJob = {
    id: jobId,
    assets: assets.map(({ filePath: _fp, ...a }) => a),
    options,
    status: 'pending',
    progress: {},
    currentFileId: null,
    previews: [],
    addedAt: Date.now(),
  };
  queue.push(newJob);
  await redis.set(queueKey, JSON.stringify(queue), 'EX', 604800);

  // Enqueue BullMQ job with full asset data (including filePath for worker)
  await addToCompressionQueue({ userId, jobId, assets, options });
  return reply.send({ jobId, skippedCount: allAssets.length - assets.length });
});

// Enqueue a batch video-transcode job (shares the queue panel + cancel endpoint
// with compression jobs via the same per-user Redis queue)
fastify.post('/api/transcode/enqueue', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);
  let userId: string;
  try {
    const decoded = fastify.jwt.verify<any>(token);
    userId = String(decoded.id);
    const userResult = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0 || !['admin', 'editor'].includes(userResult.rows[0].role)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  } catch {
    return reply.code(401).send({ error: 'Invalid token' });
  }

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

// Cancel an active or pending compression job
fastify.post('/api/compress/cancel', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);
  let userId: string;
  try {
    const decoded = fastify.jwt.verify<any>(token);
    userId = String(decoded.id);
    const userResult = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0 || !['admin', 'editor'].includes(userResult.rows[0].role)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  } catch {
    return reply.code(401).send({ error: 'Invalid token' });
  }

  const { jobId } = request.body as { jobId?: string };
  if (!jobId) return reply.code(400).send({ error: 'jobId is required' });

  const queueKey = `compress_queue:${userId}`;
  const raw = await redis.get(queueKey);
  const queue: any[] = raw ? JSON.parse(raw) : [];
  const idx = queue.findIndex((j: any) => j.id === jobId);
  if (idx < 0) return reply.code(404).send({ error: 'Job not found' });

  const jobEntry = queue[idx];
  const status = jobEntry.status as string;

  // Already settled — nothing to cancel.
  if (['done', 'error', 'cancelled', 'preview_ready', 'confirming'].includes(status)) {
    return reply.send({ ok: true, status });
  }

  // Mark cancelled in Redis first so the worker sees it on its next tick
  // and so the frontend reflects the state immediately.
  queue[idx] = { ...jobEntry, status: 'cancelled', currentFileId: null, progress: {} };
  await redis.set(queueKey, JSON.stringify(queue), 'EX', 604800);

  // If a worker is currently running this job, abort it (kills ffmpeg and breaks the loop).
  const controller = activeCompressionAborts.get(jobId);
  if (controller) {
    controller.abort();
  }

  // If the job is still waiting in BullMQ (not yet picked up), remove it.
  try {
    const waitingJobs = await compressionQueue.getJobs(['waiting', 'delayed', 'prioritized']);
    for (const bullJob of waitingJobs) {
      if (bullJob?.data?.jobId === jobId) {
        await bullJob.remove().catch((err) => {
          fastify.log.warn(`failed to remove waiting compression job ${jobId}: ${err?.message}`);
        });
      }
    }
  } catch (err: any) {
    fastify.log.warn(`error scanning compression queue for cancel: ${err?.message}`);
  }

  return reply.send({ ok: true, status: 'cancelled' });
});

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

// Upload endpoint
fastify.post('/api/upload', { config: { rateLimit: { max: 100, timeWindow: '1 minute' } } }, async (request, reply) => {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = fastify.jwt.verify<any>(token);
    const userResult = await db.query('SELECT role FROM users WHERE id = $1', [decoded.id]);
    if (userResult.rows.length === 0 || !['admin', 'editor'].includes(userResult.rows[0].role)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  } catch {
    return reply.code(401).send({ error: 'Invalid token' });
  }

  const { targetPath: rawTargetPath } = request.query as { targetPath?: string };
  const rootPath = path.resolve(config.mediaLibraryPath);
  let targetDir = rootPath;

  if (rawTargetPath) {
    const resolved = resolveWithinRoot(rootPath, rawTargetPath);
    if (resolved === null) {
      return reply.code(400).send({ error: 'Invalid target path' });
    }
    targetDir = resolved;
  }

  try {
    const stat = await fs.promises.stat(targetDir);
    if (!stat.isDirectory()) {
      return reply.code(400).send({ error: 'Target path is not a directory' });
    }
  } catch {
    return reply.code(400).send({ error: 'Target directory does not exist' });
  }

  const uploaded: { fileName: string; filePath: string }[] = [];

  const parts = request.parts();
  for await (const part of parts) {
    if (part.type !== 'file') continue;

    const safeName = path.basename(part.filename);
    const destPath = path.join(targetDir, safeName);

    await pipeline(part.file, fs.createWriteStream(destPath));
    uploaded.push({ fileName: safeName, filePath: destPath });
  }

  if (uploaded.length === 0) {
    return reply.code(400).send({ error: 'No file provided' });
  }

  for (const { filePath } of uploaded) {
    try {
      await indexFile(filePath, { queueThumbnails: true });
    } catch (err) {
      fastify.log.warn(`Failed to index uploaded file ${filePath}: ${err}`);
    }
  }

  return reply.send({ success: true, files: uploaded });
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
    const { encodingQueue, thumbnailQueue, mediaRefreshQueue } = await import('./services/queue.js');
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

    // Backfill capture dates for assets indexed before the timeline feature (non-blocking)
    void backfillCaptureDates().catch((error) => {
      fastify.log.error({ err: error }, 'Capture date backfill failed');
    });

    // Start file system watcher
    fastify.log.info('Starting media file watcher...');
    startMediaWatcher();

    // Transcoded videos are intentionally persistent: no inactivity cleanup.
    // Eviction is size-based only, handled by cache maintenance.

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
