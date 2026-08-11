import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { indexFile } from '../services/media-indexer.js';
import { resolveWithinRoot } from '../lib/media-path.js';

export default async function uploadRoutes(fastify: FastifyInstance) {
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
}
