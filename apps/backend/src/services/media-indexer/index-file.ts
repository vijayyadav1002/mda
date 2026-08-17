import fs from 'fs/promises';
import path from 'node:path';
import { db } from '../../db/index.js';
import { addToThumbnailQueue } from '../queue/index.js';
import { classifyFile } from '../file-types.js';
import { resolveCaptureDateAuto, updateCaptureDateForAsset } from '../capture-date/index.js';

export type IndexFileResult = 'indexed' | 'up_to_date' | 'thumbnail_requeued' | 'unsupported';
export type IndexOptions = {
  queueThumbnails?: boolean;
  requeueMissingThumbnails?: boolean;
};

export const normalizeIndexOptions = (options?: IndexOptions) => ({
  queueThumbnails: options?.queueThumbnails ?? true,
  requeueMissingThumbnails: options?.requeueMissingThumbnails ?? true
});

export async function indexFile(filePath: string, options: IndexOptions = {}): Promise<IndexFileResult> {
  try {
    const { queueThumbnails, requeueMissingThumbnails } = normalizeIndexOptions(options);

    // Check if file exists
    let stats;
    try {
      stats = await fs.stat(filePath);
    } catch {
      console.log(`File no longer exists: ${filePath}`);
      return 'up_to_date';
    }

    const fileName = path.basename(filePath);
    const classification = classifyFile(fileName);

    // Check if already indexed and up to date
    const existing = await db.query(
      'SELECT id, updated_at, thumbnail_path, captured_at FROM media_assets WHERE file_path = $1',
      [filePath]
    );

    if (existing.rows.length > 0) {
      const existingUpdated = new Date(existing.rows[0].updated_at);
      if (existingUpdated >= stats.mtime) {
        // Backfill missing capture dates without forcing a re-index.
        if (!existing.rows[0].captured_at) {
          await updateCaptureDateForAsset(existing.rows[0].id, filePath);
        }
        // Backfill missing thumbnails without forcing a re-index.
        const thumbPath = existing.rows[0].thumbnail_path as string | null;
        let hasUsableThumbnail = false;
        if (thumbPath) {
          try {
            const thumbStat = await fs.stat(thumbPath);
            hasUsableThumbnail = thumbStat.size > 0;
          } catch {
            hasUsableThumbnail = false;
          }
        }

        if (!hasUsableThumbnail && requeueMissingThumbnails) {
          try {
            if (classification.canThumbnail) {
              await addToThumbnailQueue({
                filePath,
                assetId: String(existing.rows[0].id),
                mediaType: classification.category === 'video' ? 'video' : 'image'
              });
              return 'thumbnail_requeued';
            }
          } catch (e: any) {
            console.warn(`⚠️  Failed to re-queue thumbnail job for ${path.basename(filePath)}: ${e?.message ?? String(e)}`);
            return 'up_to_date';
          }
        }
        return 'up_to_date';
      }
      // File was modified, delete old entry and clean up thumbnail
      try {
        const oldResult = await db.query(
          'SELECT thumbnail_path FROM media_assets WHERE id = $1',
          [existing.rows[0].id]
        );
        if (oldResult.rows.length > 0 && oldResult.rows[0].thumbnail_path) {
          try {
            await fs.unlink(oldResult.rows[0].thumbnail_path);
          } catch (e) {
            // Thumbnail may not exist, that's ok
          }
        }
      } catch (e) {
        console.warn(`Could not clean up old thumbnail: ${e}`);
      }
      await db.query('DELETE FROM media_assets WHERE id = $1', [existing.rows[0].id]);
    }

    // Insert into database (without transcoded path - will be generated on-demand)
    const captureDate = await resolveCaptureDateAuto(filePath, { mtime: stats.mtime, birthtime: stats.birthtime });
    const result = await db.query(
      `INSERT INTO media_assets
       (file_path, file_name, file_size, mime_type, thumbnail_path, captured_at, captured_at_precision, captured_at_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [filePath, fileName, stats.size, classification.mimeType, null, captureDate.capturedAt, captureDate.precision, captureDate.source]
    );

    const assetId = result.rows[0].id;

    // Queue thumbnail generation with priority (images first, videos second)
    if (queueThumbnails && classification.canThumbnail) {
      try {
        await addToThumbnailQueue({
          filePath,
          assetId,
          mediaType: classification.category === 'video' ? 'video' : 'image'
        });
      } catch (e: any) {
        console.warn(`⚠️  Failed to queue thumbnail job for ${fileName}: ${e?.message ?? String(e)}`);
      }
    }

    const queueLabel = queueThumbnails ? 'queued for processing' : 'thumbnail deferred';
    console.log(`✓ Indexed: ${fileName} (${queueLabel})`);
    return 'indexed';
  } catch (error) {
    console.error('Error indexing file:', filePath, error);
    throw error; // Re-throw so watcher can log it properly
  }
}
