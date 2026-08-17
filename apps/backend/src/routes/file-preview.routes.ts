import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { classifyFile } from '../services/file-types.js';

async function authenticateRequest(request: any) {
  const fastify = request.server;
  const authHeader = request.headers.authorization as string | undefined;
  const queryToken = typeof request.query?.token === 'string' ? request.query.token : undefined;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;
  if (!token) return null;

  try {
    const decoded = (fastify as any).jwt.verify(token) as any;
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

export default async function filePreviewRoutes(fastify: FastifyInstance) {
  fastify.get('/file-preview/:id/pdf', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
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

  fastify.get('/file-preview/:id/content', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
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
      const { readExcelPreview } = await import('../services/excel.js');
      const sheets = await readExcelPreview(target.filePath, {
        maxSheets: Infinity,
        maxRows: MAX_ROWS,
        maxCols: MAX_COLS,
      });
      return reply.send({ kind: 'excel', sheets, maxRows: MAX_ROWS, maxCols: MAX_COLS });
    }

    return reply.code(415).send({ error: 'Preview is not available for this file type' });
  });

  fastify.put('/file-preview/:id/content', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
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
}
