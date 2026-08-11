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
import { startWorkers } from './services/queue.js';
import { redis } from './services/redis.js';
import { startCacheMaintenance } from './services/cache-maintenance.js';
import path from 'node:path';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { indexFile } from './services/media-indexer.js';
import { resolveWithinRoot } from './lib/media-path.js';
import downloadRoutes from './routes/download.routes.js';
import filePreviewRoutes from './routes/file-preview.routes.js';
import imageRoutes from './routes/image.routes.js';
import videoRoutes from './routes/video.routes.js';
import compressRoutes from './routes/compress.routes.js';
import transcodeRoutes from './routes/transcode.routes.js';

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
await fastify.register(compressRoutes);
await fastify.register(transcodeRoutes);

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
