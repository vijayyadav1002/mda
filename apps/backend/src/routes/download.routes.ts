import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { ZipArchive } from 'archiver';
import { config } from '../config.js';
import { db } from '../db/index.js';

export default async function downloadRoutes(fastify: FastifyInstance) {
  fastify.get('/download/:id', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
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
}
