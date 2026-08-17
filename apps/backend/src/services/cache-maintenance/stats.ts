import path from 'node:path';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { getEffectiveCacheLimits } from '../settings.js';
import { listFiles, safeUnlink, removeEmptyDirectories } from './fs-utils.js';
import { isCacheMaintenanceRunning } from './scheduler.js';

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
  if (isCacheMaintenanceRunning()) throw new Error('Cache maintenance is running, try again shortly');

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
