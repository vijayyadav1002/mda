import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db/index.js';

export default async function imageRoutes(fastify: FastifyInstance) {
  const previewCachePath = path.resolve(path.dirname(config.thumbnailCachePath), 'previews');

  // Web-compatible image endpoint (HEIC -> JPEG).
  fastify.get('/image/:id', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
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
          const { renderHeicToJpeg } = await import('../services/thumbnail.js');
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
}
