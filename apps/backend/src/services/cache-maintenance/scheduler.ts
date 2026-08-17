import path from 'node:path';
import { config } from '../../config.js';
import { getEffectiveCacheLimits } from '../settings.js';
import { purgeExpiredTrash } from '../trash.js';
import { cleanupByAgeAndSize, clearDbReferences, cleanupOrphanThumbnails } from './eviction.js';

let cacheCleanupRunning = false;

export function isCacheMaintenanceRunning(): boolean {
  return cacheCleanupRunning;
}

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
