import { db } from '../db/index.js';
import { config } from '../config.js';

export type CacheSettings = {
  thumbnailCacheMaxMb: number;
  previewCacheMaxMb: number;
  hlsCacheMaxMb: number;
  transcodedCacheMaxMb: number;
  previewCacheMaxAgeDays: number;
  hlsCacheMaxAgeHours: number;
};

const CACHE_SETTINGS_KEY = 'cache_settings';

// Env-derived values remain the defaults; DB values override them.
const envDefaults = (): CacheSettings => ({
  thumbnailCacheMaxMb: Math.round(config.thumbnailCacheMaxBytes / (1024 * 1024)),
  previewCacheMaxMb: Math.round(config.previewCacheMaxBytes / (1024 * 1024)),
  hlsCacheMaxMb: Math.round(config.hlsCacheMaxBytes / (1024 * 1024)),
  transcodedCacheMaxMb: Math.round(config.transcodedCacheMaxBytes / (1024 * 1024)),
  previewCacheMaxAgeDays: Math.round(config.previewCacheMaxAgeMs / (24 * 60 * 60 * 1000)),
  hlsCacheMaxAgeHours: Math.round(config.hlsCacheMaxAgeMs / (60 * 60 * 1000))
});

const SETTING_LIMITS: Record<keyof CacheSettings, { min: number; max: number }> = {
  thumbnailCacheMaxMb: { min: 50, max: 100_000 },
  previewCacheMaxMb: { min: 50, max: 100_000 },
  hlsCacheMaxMb: { min: 100, max: 500_000 },
  transcodedCacheMaxMb: { min: 100, max: 500_000 },
  previewCacheMaxAgeDays: { min: 1, max: 3650 },
  hlsCacheMaxAgeHours: { min: 1, max: 87_600 }
};

let cached: CacheSettings | null = null;

export async function getCacheSettings(): Promise<CacheSettings> {
  if (cached) return cached;

  const defaults = envDefaults();
  try {
    const result = await db.query('SELECT value FROM app_settings WHERE key = $1', [CACHE_SETTINGS_KEY]);
    const overrides = result.rows.length > 0 ? result.rows[0].value : {};
    const merged = { ...defaults } as CacheSettings;
    for (const key of Object.keys(SETTING_LIMITS) as Array<keyof CacheSettings>) {
      const value = Number(overrides?.[key]);
      if (Number.isFinite(value)) merged[key] = value;
    }
    cached = merged;
    return merged;
  } catch (error) {
    console.warn('[Settings] Could not load cache settings, using env defaults:', error);
    return defaults;
  }
}

export async function updateCacheSettings(input: Partial<CacheSettings>): Promise<CacheSettings> {
  const current = await getCacheSettings();
  const next = { ...current };

  for (const key of Object.keys(SETTING_LIMITS) as Array<keyof CacheSettings>) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (!Number.isInteger(value)) throw new Error(`${key} must be an integer`);
    const { min, max } = SETTING_LIMITS[key];
    if (value < min || value > max) throw new Error(`${key} must be between ${min} and ${max}`);
    next[key] = value;
  }

  await db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [CACHE_SETTINGS_KEY, JSON.stringify(next)]
  );

  cached = next;
  return next;
}

/* ── Timeline settings ─────────────────────────────────────────── */

export type TimelineDateSource = 'folder' | 'exif' | 'created' | 'modified';

export type TimelineSettings = {
  dateSource: TimelineDateSource;
};

const TIMELINE_SETTINGS_KEY = 'timeline_settings';
const TIMELINE_DATE_SOURCES: TimelineDateSource[] = ['folder', 'exif', 'created', 'modified'];
const TIMELINE_DEFAULTS: TimelineSettings = { dateSource: 'folder' };

let cachedTimeline: TimelineSettings | null = null;

export async function getTimelineSettings(): Promise<TimelineSettings> {
  if (cachedTimeline) return cachedTimeline;
  try {
    const result = await db.query('SELECT value FROM app_settings WHERE key = $1', [TIMELINE_SETTINGS_KEY]);
    const stored = result.rows.length > 0 ? result.rows[0].value : {};
    const dateSource = TIMELINE_DATE_SOURCES.includes(stored?.dateSource)
      ? (stored.dateSource as TimelineDateSource)
      : TIMELINE_DEFAULTS.dateSource;
    cachedTimeline = { dateSource };
    return cachedTimeline;
  } catch (error) {
    console.warn('[Settings] Could not load timeline settings, using defaults:', error);
    return TIMELINE_DEFAULTS;
  }
}

export async function updateTimelineSettings(input: Partial<TimelineSettings>): Promise<TimelineSettings> {
  const current = await getTimelineSettings();
  const next = { ...current };

  if (input.dateSource !== undefined) {
    if (!TIMELINE_DATE_SOURCES.includes(input.dateSource)) {
      throw new Error(`dateSource must be one of: ${TIMELINE_DATE_SOURCES.join(', ')}`);
    }
    next.dateSource = input.dateSource;
  }

  await db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [TIMELINE_SETTINGS_KEY, JSON.stringify(next)]
  );

  cachedTimeline = next;
  return next;
}

/** Effective byte/ms values for cache maintenance, honoring DB overrides. */
export async function getEffectiveCacheLimits() {
  const s = await getCacheSettings();
  return {
    thumbnailCacheMaxBytes: s.thumbnailCacheMaxMb * 1024 * 1024,
    previewCacheMaxBytes: s.previewCacheMaxMb * 1024 * 1024,
    hlsCacheMaxBytes: s.hlsCacheMaxMb * 1024 * 1024,
    transcodedCacheMaxBytes: s.transcodedCacheMaxMb * 1024 * 1024,
    previewCacheMaxAgeMs: s.previewCacheMaxAgeDays * 24 * 60 * 60 * 1000,
    hlsCacheMaxAgeMs: s.hlsCacheMaxAgeHours * 60 * 60 * 1000
  };
}
