import fs from 'fs/promises';
import path from 'path';
import type { GraphQLContext } from '../context.js';
import { resolveLibraryPath, listMediaFilesInDirectory } from '../helpers/directory-tree.js';
import { addToThumbnailQueue, cancelThumbnailSession } from '../../services/queue.js';
import { indexFile } from '../../services/media-indexer.js';
import { canThumbnailFile } from '../../services/file-types.js';
import { db } from '../../db/index.js';

export const thumbnailsMutationResolvers = {
  generateThumbnailsForPath: async (_: any, args: { path?: string | null }, context: GraphQLContext) => {
    if (!context.user) throw new Error('Unauthorized');

    const targetPath = resolveLibraryPath(args.path ?? null);
    const stats = await fs.stat(targetPath);
    if (!stats.isDirectory()) {
      throw new Error('Path is not a directory');
    }

    const mediaFiles = await listMediaFilesInDirectory(targetPath);
    let queuedCount = 0;
    const BATCH_SIZE = 10;
    const BATCH_DELAY_MS = 200; // Throttle job production to prevent queue explosion

    // Process in batches with delay to keep queue manageable and CPU responsive
    for (let i = 0; i < mediaFiles.length; i += BATCH_SIZE) {
      const batch = mediaFiles.slice(i, i + BATCH_SIZE);

      for (const filePath of batch) {
        try {
          const result = await indexFile(filePath, { queueThumbnails: true, requeueMissingThumbnails: true });
          if (result === 'indexed' || result === 'thumbnail_requeued') {
            queuedCount += 1;
          }
        } catch (error) {
          console.warn(`[GenerateThumbnails] Failed for ${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Delay before next batch to throttle job production (except on last batch)
      if (i + BATCH_SIZE < mediaFiles.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    return queuedCount;
  },

  generateThumbnailsForAssets: async (_: any, args: { ids: string[]; sessionId?: string | null; force?: boolean | null }, context: GraphQLContext) => {
    if (!context.user) throw new Error('Unauthorized');

    const numericIds = Array.from(
      new Set(
        (args.ids ?? [])
          .map((raw) => Number.parseInt(String(raw), 10))
          .filter((n) => Number.isInteger(n) && n > 0)
      )
    );
    if (numericIds.length === 0) return 0;

    // Cap the number of ids we consider per call so a malicious or buggy
    // client cannot ask us to re-queue the entire library in one request.
    const MAX_IDS_PER_CALL = 200;
    const boundedIds = numericIds.slice(0, MAX_IDS_PER_CALL);

    // Fetch asset rows for the requested ids. Only queue thumbnails for assets
    // that are currently missing a usable thumbnail file on disk so repeated
    // viewport requests don't re-queue the same work.
    const result = await db.query(
      'SELECT id, file_path, thumbnail_path, mime_type FROM media_assets WHERE id = ANY($1::int[])',
      [boundedIds]
    );

    let queuedCount = 0;
    for (const row of result.rows) {
      if (args.force) {
        // Force-regenerate: remove the existing thumbnail file first —
        // the generator returns early when one already exists on disk.
        const thumbPath = row.thumbnail_path as string | null;
        if (thumbPath) {
          await fs.unlink(thumbPath).catch(() => {});
          await db.query('UPDATE media_assets SET thumbnail_path = NULL WHERE id = $1', [row.id]);
        }
      } else {
        const thumbPath = row.thumbnail_path as string | null;
        let hasUsableThumbnail = false;
        if (thumbPath) {
          try {
            const thumbStat = await fs.stat(thumbPath);
            hasUsableThumbnail = thumbStat.size > 0;
          } catch {
            hasUsableThumbnail = false;
          }
        }
        if (hasUsableThumbnail) continue;
      }

      const filePath = row.file_path as string;
      const mimeType = (row.mime_type as string | null) ?? '';
      if (!canThumbnailFile(filePath, mimeType)) continue;
      const isVideo = mimeType.startsWith('video/');

      try {
        await addToThumbnailQueue({
          filePath,
          assetId: String(row.id),
          mediaType: isVideo ? 'video' : 'image',
          sessionId: args.sessionId ?? undefined
        });
        queuedCount += 1;
      } catch (error) {
        console.warn(`[GenerateThumbnailsForAssets] Failed to queue ${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return queuedCount;
  },

  cancelThumbnailJobsForSession: async (_: any, args: { sessionId: string }, context: GraphQLContext) => {
    if (!context.user) throw new Error('Unauthorized');
    if (!args.sessionId || typeof args.sessionId !== 'string') return 0;
    try {
      return await cancelThumbnailSession(args.sessionId);
    } catch (error) {
      console.warn(`[CancelThumbnailJobsForSession] Failed: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }
};
