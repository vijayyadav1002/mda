import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
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
import { backfillCaptureDates } from './services/capture-date.js';
import { startMediaWatcher } from './services/media-watcher.js';
import { startWorkers, addToCompressionQueue, addToTranscodeQueue, encodingQueue, compressionQueue, activeCompressionAborts } from './services/queue.js';
import { redis } from './services/redis.js';
import { getWebCompatibleVideo, markTranscodeAccessed, deleteTranscodedVideo, ensureHLS, checkVideoCompatibility } from './services/video-transcode.js';
import { startCacheMaintenance } from './services/cache-maintenance.js';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { ZipArchive } from 'archiver';
import { indexFile } from './services/media-indexer.js';
import { canCompressFile, classifyFile } from './services/file-types.js';
import { isValidAssetId, resolveWithinRoot } from './lib/media-path.js';

let workerHandles: ReturnType<typeof startWorkers> | null = null;
let cacheMaintenanceTimer: ReturnType<typeof setInterval> | null = null;

const fastify = Fastify({
  logger: true
});

async function authenticateRequest(request: any) {
  const authHeader = request.headers.authorization as string | undefined;
  const queryToken = typeof request.query?.token === 'string' ? request.query.token : undefined;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;
  if (!token) return null;

  try {
    const decoded = fastify.jwt.verify<any>(token);
    const userResult = await db.query('SELECT id, role FROM users WHERE id = $1', [decoded.id]);
    if (userResult.rows.length === 0) return null;
    return { id: String(userResult.rows[0].id), role: userResult.rows[0].role as string };
  } catch {
    return null;
  }
}

async function requirePreviewAsset(request: any, reply: any) {
  const user = await authenticateRequest(request);
  if (!user) {
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }

  const { id } = request.params as { id: string };
  const result = await db.query(
    'SELECT file_path, file_name, mime_type FROM media_assets WHERE id = $1',
    [id]
  );
  if (result.rows.length === 0) {
    reply.code(404).send({ error: 'Asset not found' });
    return null;
  }

  const row = result.rows[0];
  const absPath = path.resolve(row.file_path as string);
  const mediaRoot = path.resolve(config.mediaLibraryPath);
  if (absPath !== mediaRoot && !absPath.startsWith(`${mediaRoot}${path.sep}`)) {
    reply.code(403).send({ error: 'File is outside the media library' });
    return null;
  }
  try {
    await fs.promises.access(absPath);
  } catch {
    reply.code(404).send({ error: 'File not found on disk' });
    return null;
  }

  return {
    filePath: absPath,
    fileName: row.file_name as string,
    mimeType: row.mime_type as string,
    classification: classifyFile(row.file_name as string, row.mime_type as string),
  };
}

// Register plugins
await fastify.register(cors, {
  origin: true,
  credentials: true
});

await fastify.register(rateLimit, {
  max: 300,
  timeWindow: '1 minute',
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

// Force-download endpoint — streams original file with Content-Disposition: attachment
fastify.get('/download/:id', async (request, reply) => {
  const { id } = request.params as { id: string };

  const result = await db.query(
    'SELECT file_path, file_name, mime_type FROM media_assets WHERE id = $1',
    [id]
  );
  if (result.rows.length === 0) {
    return reply.code(404).send({ error: 'Asset not found' });
  }

  const { file_path: filePathRaw, file_name: fileName, mime_type: mimeType } = result.rows[0];
  const absPath = path.resolve(filePathRaw as string);

  try {
    await fs.promises.access(absPath);
  } catch {
    return reply.code(404).send({ error: 'File not found on disk' });
  }

  const stat = await fs.promises.stat(absPath);
  const safeName = encodeURIComponent(fileName as string).replace(/'/g, "%27");

  reply.raw.writeHead(200, {
    'Content-Type': mimeType as string,
    'Content-Length': stat.size,
    'Content-Disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${safeName}`,
    'Cache-Control': 'no-store',
  });

  const stream = fs.createReadStream(absPath);
  stream.pipe(reply.raw);
  await new Promise<void>((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
  });
});

fastify.get('/file-preview/:id/pdf', async (request, reply) => {
  const target = await requirePreviewAsset(request, reply);
  if (!target) return;

  if (target.classification.category !== 'pdf') {
    return reply.code(415).send({ error: 'PDF preview is not available for this file type' });
  }

  const stat = await fs.promises.stat(target.filePath);
  const safeName = encodeURIComponent(target.fileName).replace(/'/g, "%27");
  reply.raw.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Length': stat.size,
    'Content-Disposition': `inline; filename="${safeName}"; filename*=UTF-8''${safeName}`,
    'Cache-Control': 'no-store',
  });
  const stream = fs.createReadStream(target.filePath);
  stream.pipe(reply.raw);
  await new Promise<void>((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
  });
});

fastify.get('/file-preview/:id/content', async (request, reply) => {
  const target = await requirePreviewAsset(request, reply);
  if (!target) return;

  const MAX_TEXT_BYTES = 1024 * 1024;
  const MAX_ROWS = 200;
  const MAX_COLS = 40;

  if (target.classification.category === 'text' || target.classification.category === 'markdown') {
    const handle = await fs.promises.open(target.filePath, 'r');
    try {
      const buffer = Buffer.alloc(MAX_TEXT_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, MAX_TEXT_BYTES + 1, 0);
      const truncated = bytesRead > MAX_TEXT_BYTES;
      return reply.send({
        kind: target.classification.category,
        text: buffer.subarray(0, Math.min(bytesRead, MAX_TEXT_BYTES)).toString('utf8'),
        truncated,
      });
    } finally {
      await handle.close();
    }
  }

  if (target.classification.category === 'word') {
    const mammoth = await import('mammoth');
    const sanitizeHtml = (await import('sanitize-html')).default;
    const converted = await mammoth.convertToHtml({ path: target.filePath });
    return reply.send({
      kind: 'word',
      html: sanitizeHtml(converted.value, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2']),
        allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, img: ['src', 'alt'] },
      }),
      messages: converted.messages.map((message) => message.message),
    });
  }

  if (target.classification.category === 'excel') {
    const { readExcelPreview } = await import('./services/excel.js');
    const sheets = await readExcelPreview(target.filePath, {
      maxSheets: Infinity,
      maxRows: MAX_ROWS,
      maxCols: MAX_COLS,
    });
    return reply.send({ kind: 'excel', sheets, maxRows: MAX_ROWS, maxCols: MAX_COLS });
  }

  return reply.code(415).send({ error: 'Preview is not available for this file type' });
});

fastify.put('/file-preview/:id/content', async (request, reply) => {
  const user = await authenticateRequest(request);
  if (!user) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  if (user.role !== 'admin' && user.role !== 'editor') {
    return reply.code(403).send({ error: 'Forbidden' });
  }

  const target = await requirePreviewAsset(request, reply);
  if (!target) return;

  if (target.classification.category !== 'text' && target.classification.category !== 'markdown') {
    return reply.code(415).send({ error: 'Only text and markdown files can be edited' });
  }

  const body = request.body as { text?: unknown } | undefined;
  if (typeof body?.text !== 'string') {
    return reply.code(400).send({ error: 'Request body must include text' });
  }

  const MAX_TEXT_BYTES = 1024 * 1024;
  const encoded = Buffer.from(body.text, 'utf8');
  if (encoded.length > MAX_TEXT_BYTES) {
    return reply.code(413).send({ error: 'Edited content is too large' });
  }

  const currentStat = await fs.promises.stat(target.filePath);
  const tempPath = path.join(
    path.dirname(target.filePath),
    `.${path.basename(target.filePath)}.${crypto.randomUUID()}.tmp`
  );
  const assetId = (request.params as { id: string }).id;

  // The filesystem watcher can observe the replace before this handler finishes.
  // Move updated_at slightly ahead first so the indexer keeps this asset row stable.
  const watcherGuardTimestamp = new Date(Date.now() + 10_000);
  await db.query('UPDATE media_assets SET updated_at = $1 WHERE id = $2', [watcherGuardTimestamp, assetId]);

  try {
    await fs.promises.writeFile(tempPath, encoded, { mode: currentStat.mode });
    await fs.promises.rename(tempPath, target.filePath);
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }

  const stat = await fs.promises.stat(target.filePath);
  const updated = await db.query(
    'UPDATE media_assets SET file_size = $1, updated_at = NOW() WHERE id = $2 RETURNING file_size, updated_at',
    [stat.size, assetId]
  );

  return reply.send({
    kind: target.classification.category,
    text: body.text,
    truncated: false,
    fileSize: String(updated.rows[0].file_size),
    updatedAt: updated.rows[0].updated_at.toISOString(),
  });
});

// Bulk ZIP download — streams a zip of the requested asset IDs
fastify.get('/download-zip', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
  const query = request.query as { ids?: string; name?: string };
  const rawIds = (query.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (rawIds.length === 0) {
    return reply.code(400).send({ error: 'No ids provided' });
  }

  const numericIds = rawIds
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (numericIds.length === 0) {
    return reply.code(400).send({ error: 'No valid ids provided' });
  }

  const result = await db.query(
    'SELECT id, file_path, file_name FROM media_assets WHERE id = ANY($1::int[])',
    [numericIds]
  );
  if (result.rows.length === 0) {
    return reply.code(404).send({ error: 'No assets found' });
  }

  // Preserve the requested order and resolve duplicate filenames by prefixing.
  const byId = new Map<number, { file_path: string; file_name: string }>();
  for (const row of result.rows) {
    byId.set(Number(row.id), { file_path: row.file_path as string, file_name: row.file_name as string });
  }

  const archive = new ZipArchive({ zlib: { level: 0 } });
  const zipName = (query.name && query.name.trim()) || `media-${new Date().toISOString().slice(0, 10)}.zip`;
  const safeZipName = encodeURIComponent(zipName).replace(/'/g, '%27');

  reply.raw.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${safeZipName}"; filename*=UTF-8''${safeZipName}`,
    'Cache-Control': 'no-store',
  });

  archive.on('warning', (err) => {
    fastify.log.warn(`zip archive warning: ${err.message}`);
  });
  archive.on('error', (err) => {
    fastify.log.error(`zip archive error: ${err.message}`);
    reply.raw.destroy(err);
  });

  archive.pipe(reply.raw);

  const usedNames = new Set<string>();
  for (const id of numericIds) {
    const row = byId.get(id);
    if (!row) continue;
    const absPath = path.resolve(row.file_path);
    try {
      await fs.promises.access(absPath);
    } catch {
      fastify.log.warn(`skip missing file in zip: ${absPath}`);
      continue;
    }

    let entryName = row.file_name;
    if (usedNames.has(entryName)) {
      const ext = path.extname(entryName);
      const base = entryName.slice(0, entryName.length - ext.length);
      let i = 1;
      while (usedNames.has(`${base} (${i})${ext}`)) i++;
      entryName = `${base} (${i})${ext}`;
    }
    usedNames.add(entryName);
    archive.file(absPath, { name: entryName });
  }

  await archive.finalize();
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

    let cacheExists = false;
    try {
      await fs.promises.access(cachedPath);
      cacheExists = true;
    } catch {
      // Not cached yet, try to generate
    }

    if (!cacheExists) {
      // Attempt 1: renderHeicToJpeg (libheif-js / heif-convert)
      try {
        const { renderHeicToJpeg } = await import('./services/thumbnail.js');
        await renderHeicToJpeg(absPath, cachedPath, {
          kind: 'inside',
          maxWidth: config.previewMaxDimension,
          maxHeight: config.previewMaxDimension,
          quality: config.previewQuality
        });
        cacheExists = true;
      } catch (heicError) {
        fastify.log.warn(`HEIC conversion via renderHeicToJpeg failed for ${path.basename(absPath)}: ${heicError instanceof Error ? heicError.message : String(heicError)}`);
      }

      // Attempt 2: Try sharp directly (newer libvips can handle HEIC natively)
      if (!cacheExists) {
        try {
          const sharp = (await import('sharp')).default;
          await sharp(absPath)
            .rotate()
            .resize(config.previewMaxDimension, config.previewMaxDimension, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: config.previewQuality })
            .toFile(cachedPath);
          cacheExists = true;
          fastify.log.info(`HEIC converted via sharp fallback: ${path.basename(absPath)}`);
        } catch (sharpError) {
          fastify.log.warn(`HEIC conversion via sharp also failed for ${path.basename(absPath)}: ${sharpError instanceof Error ? sharpError.message : String(sharpError)}`);
        }
      }
    }

    if (cacheExists) {
      reply.header('Content-Type', 'image/jpeg');
      reply.header('Cache-Control', 'public, max-age=86400');
      return reply.send(fs.createReadStream(cachedPath));
    }

    // All conversions failed — serve the raw HEIC file so the client gets something
    fastify.log.warn(`All HEIC conversions failed for ${path.basename(absPath)}, serving raw file`);
    reply.header('Content-Type', 'image/heic');
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(fs.createReadStream(absPath));
  }

  // For non-HEIC images, stream the original from disk with its mime type.
  reply.header('Content-Type', mimeType);
  reply.header('Cache-Control', 'public, max-age=86400');
  return reply.send(fs.createReadStream(absPath));
});

// Lightweight playback negotiation — does not block on transcoding
fastify.get('/video/:id/prepare', async (request, reply) => {
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

    const playlistPath = path.resolve(
      path.dirname(config.thumbnailCachePath),
      'hls',
      id,
      'master.m3u8'
    );
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
fastify.get('/video/:id/progress', async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!isValidAssetId(id)) {
    return reply.code(400).send({ error: 'Invalid asset id' });
  }
  const playlistPath = path.resolve(
    path.dirname(config.thumbnailCachePath),
    'hls',
    id,
    'master.m3u8'
  );
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

// Streaming compress preview endpoint with progress events
fastify.post('/api/compress/preview', async (request, reply) => {
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
fastify.post('/api/compress/cancel', async (request, reply) => {
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
fastify.get('/api/queue-state', async (request, reply) => {
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
fastify.put('/api/queue-state', async (request, reply) => {
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
fastify.post('/api/upload', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
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
