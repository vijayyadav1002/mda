import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { db } from '../db/index.js';

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
}): Promise<void> {
  const { label, rootPath, maxAgeMs, maxBytes, recursive } = options;
  await fs.mkdir(rootPath, { recursive: true });

  const now = Date.now();
  let files = await listFiles(rootPath, recursive);

  let ageDeleted = 0;
  if (maxAgeMs > 0) {
    const cutoff = now - maxAgeMs;
    for (const file of files) {
      if (file.mtimeMs < cutoff) {
        if (await safeUnlink(file.filePath)) ageDeleted += 1;
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
}

async function cleanupOrphanThumbnails(thumbnailCachePath: string): Promise<void> {
  await fs.mkdir(thumbnailCachePath, { recursive: true });

  const result = await db.query(
    'SELECT thumbnail_path FROM media_assets WHERE thumbnail_path IS NOT NULL'
  );
  const referenced = new Set<string>(
    result.rows
      .map((row) => row.thumbnail_path as string)
      .filter(Boolean)
      .map((thumbnailPath) => path.resolve(thumbnailPath))
  );

  const files = await listFiles(thumbnailCachePath, false);
  let deleted = 0;

  for (const file of files) {
    const resolved = path.resolve(file.filePath);
    if (file.size === 0 || !referenced.has(resolved)) {
      if (await safeUnlink(file.filePath)) deleted += 1;
    }
  }

  if (deleted > 0) {
    console.log(`[CacheMaintenance] Thumbnails: deleted ${deleted} orphan/empty files`);
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
    await cleanupByAgeAndSize({
      label: 'Thumbnails',
      rootPath: thumbnailCachePath,
      maxAgeMs: config.thumbnailCacheMaxAgeMs,
      maxBytes: config.thumbnailCacheMaxBytes,
      recursive: false
    });
    await cleanupOrphanThumbnails(thumbnailCachePath);

    await cleanupByAgeAndSize({
      label: 'Previews',
      rootPath: previewCachePath,
      maxAgeMs: config.previewCacheMaxAgeMs,
      maxBytes: config.previewCacheMaxBytes,
      recursive: false
    });

    await cleanupByAgeAndSize({
      label: 'HLS',
      rootPath: hlsCachePath,
      maxAgeMs: config.hlsCacheMaxAgeMs,
      maxBytes: config.hlsCacheMaxBytes,
      recursive: true
    });

    await cleanupByAgeAndSize({
      label: 'Transcoded',
      rootPath: transcodedCachePath,
      maxAgeMs: config.transcodedCacheMaxAgeMs,
      maxBytes: config.transcodedCacheMaxBytes,
      recursive: false
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
