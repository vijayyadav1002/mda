import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { getEffectiveCacheLimits } from './settings.js';
import { purgeExpiredTrash } from './trash.js';

type CacheFile = {
  filePath: string;
  size: number;
  mtimeMs: number;
};

async function listFiles(rootPath: string, recursive: boolean): Promise<CacheFile[]> {
  const files: CacheFile[] = [];

  const walk = async (dirPath: string) => {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          if (recursive) await walk(fullPath);
          continue;
        }

        if (!entry.isFile()) continue;

        try {
          const stats = await fs.stat(fullPath);
          files.push({
            filePath: fullPath,
            size: stats.size,
            mtimeMs: stats.mtimeMs
          });
        } catch {
          // Ignore races with concurrent writes/deletes
        }
      }
    } catch (error: any) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  };

  await walk(rootPath);
  return files;
}

async function safeUnlink(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return false;
    console.warn(`Could not delete cache file ${filePath}:`, error);
    return false;
  }
}

async function removeEmptyDirectories(rootPath: string): Promise<void> {
  const walk = async (dirPath: string) => {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          await walk(path.join(dirPath, entry.name));
        }
      }
    } catch {
      return;
    }

    if (dirPath === rootPath) return;

    try {
      const remaining = await fs.readdir(dirPath);
      if (remaining.length === 0) {
        await fs.rmdir(dirPath);
      }
    } catch {
      // Ignore races
    }
  };

  await walk(rootPath);
}

async function cleanupByAgeAndSize(options: {
  label: string;
  rootPath: string;
  maxAgeMs: number;
  maxBytes: number;
  recursive: boolean;
}): Promise<string[]> {
  const { label, rootPath, maxAgeMs, maxBytes, recursive } = options;
  await fs.mkdir(rootPath, { recursive: true });

  const now = Date.now();
  let files = await listFiles(rootPath, recursive);
  const deletedPaths: string[] = [];

  let ageDeleted = 0;
  if (maxAgeMs > 0) {
    const cutoff = now - maxAgeMs;
    for (const file of files) {
      if (file.mtimeMs < cutoff) {
        if (await safeUnlink(file.filePath)) {
          ageDeleted += 1;
          deletedPaths.push(file.filePath);
        }
      }
    }
    if (ageDeleted > 0) {
      files = await listFiles(rootPath, recursive);
    }
  }

  let sizeDeleted = 0;
  if (maxBytes > 0) {
    let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > maxBytes) {
      const sortedOldestFirst = [...files].sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const file of sortedOldestFirst) {
        if (totalBytes <= maxBytes) break;
        if (await safeUnlink(file.filePath)) {
          totalBytes -= file.size;
          sizeDeleted += 1;
          deletedPaths.push(file.filePath);
        }
      }
    }
  }

  if (recursive) {
    await removeEmptyDirectories(rootPath);
  }

  if (ageDeleted > 0 || sizeDeleted > 0) {
    console.log(`[CacheMaintenance] ${label}: deleted ${ageDeleted} by age, ${sizeDeleted} by size`);
  }

  return deletedPaths;
}

// Deleting cache files must also clear the DB references, otherwise the
// frontend renders broken <img> tags for thumbnails that no longer exist.
async function clearDbReferences(column: 'thumbnail_path' | 'transcoded_path', deletedPaths: string[]) {
  if (deletedPaths.length === 0) return;
  try {
    const resolved = deletedPaths.map((p) => path.resolve(p));
    const allForms = resolved.concat(deletedPaths);
    await db.query(
      `UPDATE media_assets SET ${column} = NULL WHERE ${column} = ANY($1)`,
      [allForms]
    );
    if (column === 'thumbnail_path') {
      await db.query(
        'UPDATE trash_items SET thumbnail_path = NULL WHERE thumbnail_path = ANY($1)',
        [allForms]
      );
    }
  } catch (error) {
    console.warn(`[CacheMaintenance] Could not clear ${column} references:`, error);
  }
}

async function cleanupOrphanThumbnails(thumbnailCachePath: string): Promise<void> {
  await fs.mkdir(thumbnailCachePath, { recursive: true });

  // Thumbnails referenced by live assets AND by trash items (kept so the
  // trash page can show what a deleted photo looked like).
  const result = await db.query(
    `SELECT thumbnail_path FROM media_assets WHERE thumbnail_path IS NOT NULL
     UNION
     SELECT thumbnail_path FROM trash_items WHERE thumbnail_path IS NOT NULL`
  );
  const referencedRows = result.rows
    .map((row) => row.thumbnail_path as string)
    .filter(Boolean)
    .map((raw) => ({ raw, resolved: path.resolve(raw) }));
  const referenced = new Set<string>(referencedRows.map((r) => r.resolved));

  const files = await listFiles(thumbnailCachePath, false);
  let deleted = 0;

  const existingOnDisk = new Set<string>();
  for (const file of files) {
    const resolved = path.resolve(file.filePath);
    if (file.size === 0 || !referenced.has(resolved)) {
      if (await safeUnlink(file.filePath)) deleted += 1;
    } else {
      existingOnDisk.add(resolved);
    }
  }

  if (deleted > 0) {
    console.log(`[CacheMaintenance] Thumbnails: deleted ${deleted} orphan/empty files`);
  }

  // Reverse sweep: DB rows pointing at thumbnail files that no longer exist
  // (e.g. removed by older cleanup runs) would render as broken images.
  const staleRawPaths = referencedRows
    .filter((r) => !existingOnDisk.has(r.resolved))
    .map((r) => r.raw);
  if (staleRawPaths.length > 0) {
    try {
      await db.query(
        'UPDATE media_assets SET thumbnail_path = NULL WHERE thumbnail_path = ANY($1)',
        [staleRawPaths]
      );
      console.log(`[CacheMaintenance] Thumbnails: cleared ${staleRawPaths.length} stale DB references`);
    } catch (error) {
      console.warn('[CacheMaintenance] Could not clear stale thumbnail references:', error);
    }
  }
}

let cacheCleanupRunning = false;

export async function runCacheMaintenanceOnce(): Promise<void> {
  if (cacheCleanupRunning) return;
  cacheCleanupRunning = true;

  const cacheBasePath = path.resolve(path.dirname(config.thumbnailCachePath));
  const thumbnailCachePath = path.resolve(config.thumbnailCachePath);
  const previewCachePath = path.join(cacheBasePath, 'previews');
  const hlsCachePath = path.join(cacheBasePath, 'hls');
  const transcodedCachePath = path.join(cacheBasePath, 'transcoded');

  try {
    const limits = await getEffectiveCacheLimits();

    // Thumbnails are never expired by age: once generated they are kept
    // until the size limit is exceeded, then evicted oldest-first.
    const deletedThumbnails = await cleanupByAgeAndSize({
      label: 'Thumbnails',
      rootPath: thumbnailCachePath,
      maxAgeMs: 0,
      maxBytes: limits.thumbnailCacheMaxBytes,
      recursive: false
    });
    await clearDbReferences('thumbnail_path', deletedThumbnails);
    await cleanupOrphanThumbnails(thumbnailCachePath);

    await cleanupByAgeAndSize({
      label: 'Previews',
      rootPath: previewCachePath,
      maxAgeMs: limits.previewCacheMaxAgeMs,
      maxBytes: limits.previewCacheMaxBytes,
      recursive: false
    });

    await cleanupByAgeAndSize({
      label: 'HLS',
      rootPath: hlsCachePath,
      maxAgeMs: limits.hlsCacheMaxAgeMs,
      maxBytes: limits.hlsCacheMaxBytes,
      recursive: true
    });

    // Transcoded videos are never expired by age — size-based eviction only,
    // oldest first, so finished transcodes stay available until space is needed.
    const deletedTranscoded = await cleanupByAgeAndSize({
      label: 'Transcoded',
      rootPath: transcodedCachePath,
      maxAgeMs: 0,
      maxBytes: limits.transcodedCacheMaxBytes,
      recursive: false
    });
    await clearDbReferences('transcoded_path', deletedTranscoded);

    // Trash bin: permanently remove items past the retention window
    await purgeExpiredTrash().catch((error) => {
      console.warn('[CacheMaintenance] Trash purge failed:', error);
    });
  } finally {
    cacheCleanupRunning = false;
  }
}

export function startCacheMaintenance() {
  void runCacheMaintenanceOnce().catch((error) => {
    console.error('[CacheMaintenance] Initial run failed:', error);
  });

  const timer = setInterval(() => {
    void runCacheMaintenanceOnce().catch((error) => {
      console.error('[CacheMaintenance] Scheduled run failed:', error);
    });
  }, config.cacheCleanupIntervalMs);

  console.log(`[CacheMaintenance] Started (interval ${Math.round(config.cacheCleanupIntervalMs / 60000)} min)`);
  return timer;
}

export type CacheTypeStats = {
  label: string;
  bytes: number;
  fileCount: number;
  maxBytes: number;
};

export type CacheStats = {
  thumbnails: CacheTypeStats;
  previews: CacheTypeStats;
  hls: CacheTypeStats;
  transcoded: CacheTypeStats;
  totalBytes: number;
};

export async function getCacheStats(): Promise<CacheStats> {
  const cacheBasePath = path.resolve(path.dirname(config.thumbnailCachePath));

  const measure = async (
    rootPath: string,
    recursive: boolean,
    maxBytes: number,
    label: string
  ): Promise<CacheTypeStats> => {
    const files = await listFiles(rootPath, recursive);
    const bytes = files.reduce((sum, f) => sum + f.size, 0);
    return { label, bytes, fileCount: files.length, maxBytes };
  };

  const limits = await getEffectiveCacheLimits();
  const [thumbnails, previews, hls, transcoded] = await Promise.all([
    measure(path.resolve(config.thumbnailCachePath), false, limits.thumbnailCacheMaxBytes, 'Thumbnails'),
    measure(path.join(cacheBasePath, 'previews'), false, limits.previewCacheMaxBytes, 'Previews'),
    measure(path.join(cacheBasePath, 'hls'), true, limits.hlsCacheMaxBytes, 'HLS'),
    measure(path.join(cacheBasePath, 'transcoded'), false, limits.transcodedCacheMaxBytes, 'Transcoded'),
  ]);

  return {
    thumbnails,
    previews,
    hls,
    transcoded,
    totalBytes: thumbnails.bytes + previews.bytes + hls.bytes + transcoded.bytes,
  };
}

type ClearableType = 'thumbnails' | 'previews' | 'hls' | 'transcoded' | 'all';

export async function clearCacheByType(type: ClearableType): Promise<void> {
  if (cacheCleanupRunning) throw new Error('Cache maintenance is running, try again shortly');

  const cacheBasePath = path.resolve(path.dirname(config.thumbnailCachePath));

  const clearDir = async (rootPath: string, recursive: boolean) => {
    const files = await listFiles(rootPath, recursive);
    await Promise.all(files.map((f) => safeUnlink(f.filePath)));
    if (recursive) await removeEmptyDirectories(rootPath);
  };

  const targets: Array<[string, boolean]> = [];
  if (type === 'thumbnails' || type === 'all') targets.push([path.resolve(config.thumbnailCachePath), false]);
  if (type === 'previews'   || type === 'all') targets.push([path.join(cacheBasePath, 'previews'), false]);
  if (type === 'hls'        || type === 'all') targets.push([path.join(cacheBasePath, 'hls'), true]);
  if (type === 'transcoded' || type === 'all') targets.push([path.join(cacheBasePath, 'transcoded'), false]);

  await Promise.all(targets.map(([p, r]) => clearDir(p, r)));

  // Null out DB references so the frontend knows files are gone and queues regeneration
  if (type === 'thumbnails' || type === 'all') {
    await db.query('UPDATE media_assets SET thumbnail_path = NULL WHERE thumbnail_path IS NOT NULL');
  }
  if (type === 'transcoded' || type === 'all') {
    await db.query('UPDATE media_assets SET transcoded_path = NULL WHERE transcoded_path IS NOT NULL');
  }
}
