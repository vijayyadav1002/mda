import 'dotenv/config';

const toNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
};

const lowStorageMode = toBool(process.env.LOW_STORAGE_MODE, true);

const thumbnailSizeDefault = lowStorageMode ? 240 : 300;
const thumbnailQualityDefault = lowStorageMode ? 65 : 80;
const previewMaxDimensionDefault = lowStorageMode ? 1280 : 2000;
const previewQualityDefault = lowStorageMode ? 70 : 85;
const cacheCleanupIntervalMinutesDefault = lowStorageMode ? 30 : 180;
const thumbnailMaxAgeDaysDefault = lowStorageMode ? 30 : 90;
const previewMaxAgeDaysDefault = lowStorageMode ? 7 : 30;
const hlsMaxAgeHoursDefault = lowStorageMode ? 24 : 168;
const transcodedMaxAgeHoursDefault = lowStorageMode ? 2 : 24;
const thumbnailCacheMaxMbDefault = lowStorageMode ? 250 : 1024;
const previewCacheMaxMbDefault = lowStorageMode ? 150 : 512;
const hlsCacheMaxMbDefault = lowStorageMode ? 500 : 2048;
const transcodedCacheMaxMbDefault = lowStorageMode ? 250 : 1024;
const thumbnailsOnDemandDefault = lowStorageMode;

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/mda',
  jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-this',
  mediaLibraryPath: process.env.MEDIA_LIBRARY_PATH || './media',
  thumbnailCachePath: process.env.THUMBNAIL_CACHE_PATH || './cache/thumbnails',
  redisHost: process.env.REDIS_HOST || 'localhost',
  redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
  lowStorageMode,
  thumbnailsOnDemand: toBool(process.env.THUMBNAILS_ON_DEMAND, thumbnailsOnDemandDefault),
  thumbnailSize: toNumber(process.env.THUMBNAIL_SIZE, thumbnailSizeDefault),
  thumbnailQuality: toNumber(process.env.THUMBNAIL_QUALITY, thumbnailQualityDefault),
  previewMaxDimension: toNumber(process.env.PREVIEW_MAX_DIMENSION, previewMaxDimensionDefault),
  previewQuality: toNumber(process.env.PREVIEW_QUALITY, previewQualityDefault),
  cacheCleanupIntervalMs: toNumber(process.env.CACHE_CLEANUP_INTERVAL_MINUTES, cacheCleanupIntervalMinutesDefault) * 60 * 1000,
  thumbnailCacheMaxAgeMs: toNumber(process.env.THUMBNAIL_CACHE_MAX_AGE_DAYS, thumbnailMaxAgeDaysDefault) * 24 * 60 * 60 * 1000,
  previewCacheMaxAgeMs: toNumber(process.env.PREVIEW_CACHE_MAX_AGE_DAYS, previewMaxAgeDaysDefault) * 24 * 60 * 60 * 1000,
  hlsCacheMaxAgeMs: toNumber(process.env.HLS_CACHE_MAX_AGE_HOURS, hlsMaxAgeHoursDefault) * 60 * 60 * 1000,
  transcodedCacheMaxAgeMs: toNumber(process.env.TRANSCODED_CACHE_MAX_AGE_HOURS, transcodedMaxAgeHoursDefault) * 60 * 60 * 1000,
  thumbnailCacheMaxBytes: toNumber(process.env.THUMBNAIL_CACHE_MAX_MB, thumbnailCacheMaxMbDefault) * 1024 * 1024,
  previewCacheMaxBytes: toNumber(process.env.PREVIEW_CACHE_MAX_MB, previewCacheMaxMbDefault) * 1024 * 1024,
  hlsCacheMaxBytes: toNumber(process.env.HLS_CACHE_MAX_MB, hlsCacheMaxMbDefault) * 1024 * 1024,
  transcodedCacheMaxBytes: toNumber(process.env.TRANSCODED_CACHE_MAX_MB, transcodedCacheMaxMbDefault) * 1024 * 1024
};
