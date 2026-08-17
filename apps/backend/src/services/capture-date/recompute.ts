import fs from 'node:fs/promises';
import { db } from '../../db/index.js';
import { resolveCaptureDateAuto, type FileTimes } from './resolve.js';

/** Recompute and persist the capture date for an asset whose path changed. */
export async function updateCaptureDateForAsset(assetId: string | number, filePath: string): Promise<void> {
  try {
    let times: FileTimes = { mtime: new Date() };
    try {
      const stats = await fs.stat(filePath);
      times = { mtime: stats.mtime, birthtime: stats.birthtime };
    } catch {
      // File may be mid-move; fall back to now for mtime-sourced dates only.
    }
    const { capturedAt, precision, source } = await resolveCaptureDateAuto(filePath, times);
    await db.query(
      'UPDATE media_assets SET captured_at = $1, captured_at_precision = $2, captured_at_source = $3 WHERE id = $4',
      [capturedAt, precision, source, assetId]
    );
  } catch (error) {
    console.warn(`Could not update capture date for asset ${assetId}:`, error);
  }
}

/**
 * Backfill capture dates for already-indexed assets missing one.
 * Runs in batches so startup is not blocked on large libraries.
 */
export async function backfillCaptureDates(batchSize = 500): Promise<number> {
  let totalUpdated = 0;

  for (;;) {
    const result = await db.query(
      'SELECT id, file_path FROM media_assets WHERE captured_at IS NULL LIMIT $1',
      [batchSize]
    );
    if (result.rows.length === 0) break;

    for (const row of result.rows) {
      let times: FileTimes = { mtime: new Date() };
      try {
        const stats = await fs.stat(row.file_path);
        times = { mtime: stats.mtime, birthtime: stats.birthtime };
      } catch {
        // File gone; watcher/indexer will remove the row eventually.
      }
      const { capturedAt, precision, source } = await resolveCaptureDateAuto(row.file_path, times);
      await db.query(
        'UPDATE media_assets SET captured_at = $1, captured_at_precision = $2, captured_at_source = $3 WHERE id = $4',
        [capturedAt, precision, source, row.id]
      );
      totalUpdated += 1;
    }

    if (result.rows.length < batchSize) break;
  }

  if (totalUpdated > 0) {
    console.log(`[CaptureDate] Backfilled capture dates for ${totalUpdated} assets`);
  }
  return totalUpdated;
}

let recomputeRunning = false;

/**
 * Recompute capture dates for the entire library, used when an admin changes
 * the timeline date source. Runs in id-ordered batches; safe to fire and
 * forget. Returns the number of assets updated (0 if already running).
 */
export async function recomputeAllCaptureDates(batchSize = 500): Promise<number> {
  if (recomputeRunning) return 0;
  recomputeRunning = true;
  let totalUpdated = 0;

  try {
    let lastId = 0;
    for (;;) {
      const result = await db.query(
        'SELECT id, file_path FROM media_assets WHERE id > $1 ORDER BY id LIMIT $2',
        [lastId, batchSize]
      );
      if (result.rows.length === 0) break;

      for (const row of result.rows) {
        let times: FileTimes = { mtime: new Date() };
        try {
          const stats = await fs.stat(row.file_path);
          times = { mtime: stats.mtime, birthtime: stats.birthtime };
        } catch {
          // File gone; watcher/indexer will remove the row eventually.
        }
        const { capturedAt, precision, source } = await resolveCaptureDateAuto(row.file_path, times);
        await db.query(
          'UPDATE media_assets SET captured_at = $1, captured_at_precision = $2, captured_at_source = $3 WHERE id = $4',
          [capturedAt, precision, source, row.id]
        );
        totalUpdated += 1;
      }

      lastId = result.rows[result.rows.length - 1].id;
      if (result.rows.length < batchSize) break;
    }

    console.log(`[CaptureDate] Recomputed capture dates for ${totalUpdated} assets`);
    return totalUpdated;
  } finally {
    recomputeRunning = false;
  }
}
