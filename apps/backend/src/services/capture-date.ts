import path from 'node:path';
import fs from 'node:fs/promises';
import exifr from 'exifr';
import ffmpeg from 'fluent-ffmpeg';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { getTimelineSettings, type TimelineDateSource } from './settings.js';

export type CapturePrecision = 'day' | 'month' | 'year';
export type CaptureSource = 'folder' | 'filename' | 'mtime' | 'btime' | 'exif';

export type CaptureDate = {
  capturedAt: Date;
  precision: CapturePrecision;
  source: CaptureSource;
};

const isValidYear = (year: number) => year >= 1970 && year <= new Date().getFullYear() + 1;

const isValidDate = (year: number, month: number, day: number) => {
  if (!isValidYear(year) || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
};

// Matches YYYY-MM-DD, YYYY_MM_DD, YYYY.MM.DD (optionally followed by more text)
const FOLDER_DAY_RE = /^((?:19|20)\d{2})[-_.](0[1-9]|1[0-2])[-_.](0[1-9]|[12]\d|3[01])(?:\D|$)/;
// Matches YYYY-MM, YYYY_MM, YYYY.MM, "YYYY MM" (optionally followed by more text, e.g. "2022-02 Trip")
const FOLDER_MONTH_RE = /^((?:19|20)\d{2})[-_. ](0[1-9]|1[0-2])(?:\D|$)/;
// Matches a bare year folder like "2022"
const FOLDER_YEAR_RE = /^((?:19|20)\d{2})$/;
// Bare month folder like "02" or "11" (used when the parent folder is a bare year)
const FOLDER_BARE_MONTH_RE = /^(0[1-9]|1[0-2])$/;
// Filename patterns: IMG_20220215, PXL_20220215_..., VID-20220215-WA0001, 20220215_123456, 2022-02-15 ...
const FILENAME_DAY_RE = /(?:^|\D)((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:\D|$)/;

/**
 * Derive a capture date from the folder path segments (relative to the media
 * library root), scanning from the deepest folder upward. Supports:
 *   .../2022-02-15/   -> day precision
 *   .../2022-02/      -> month precision
 *   .../2022/02/      -> month precision
 *   .../2022/         -> year precision
 */
export function parseCaptureDateFromFolder(filePath: string): CaptureDate | null {
  const root = path.resolve(config.mediaLibraryPath);
  const dir = path.dirname(path.resolve(filePath));
  if (!dir.startsWith(root)) return null;

  const segments = dir.slice(root.length).split(path.sep).filter(Boolean);

  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i];

    const dayMatch = FOLDER_DAY_RE.exec(segment);
    if (dayMatch) {
      const [, y, m, d] = dayMatch;
      if (isValidDate(+y, +m, +d)) {
        return { capturedAt: new Date(Date.UTC(+y, +m - 1, +d)), precision: 'day', source: 'folder' };
      }
    }

    const monthMatch = FOLDER_MONTH_RE.exec(segment);
    if (monthMatch) {
      const [, y, m] = monthMatch;
      if (isValidYear(+y)) {
        return { capturedAt: new Date(Date.UTC(+y, +m - 1, 1)), precision: 'month', source: 'folder' };
      }
    }

    // "02" folder nested under a "2022" folder
    const bareMonthMatch = FOLDER_BARE_MONTH_RE.exec(segment);
    if (bareMonthMatch && i > 0) {
      const parentYear = FOLDER_YEAR_RE.exec(segments[i - 1]);
      if (parentYear && isValidYear(+parentYear[1])) {
        return {
          capturedAt: new Date(Date.UTC(+parentYear[1], +bareMonthMatch[1] - 1, 1)),
          precision: 'month',
          source: 'folder'
        };
      }
    }

    const yearMatch = FOLDER_YEAR_RE.exec(segment);
    if (yearMatch && isValidYear(+yearMatch[1])) {
      return { capturedAt: new Date(Date.UTC(+yearMatch[1], 0, 1)), precision: 'year', source: 'folder' };
    }
  }

  return null;
}

export function parseCaptureDateFromFilename(fileName: string): CaptureDate | null {
  const match = FILENAME_DAY_RE.exec(fileName);
  if (!match) return null;
  const [, y, m, d] = match;
  if (!isValidDate(+y, +m, +d)) return null;
  return { capturedAt: new Date(Date.UTC(+y, +m - 1, +d)), precision: 'day', source: 'filename' };
}

export type FileTimes = { mtime: Date; birthtime?: Date };

const EXIF_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.heic', '.heif', '.png', '.tiff', '.tif', '.avif', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']);

const isSaneDate = (d: unknown): d is Date =>
  d instanceof Date &&
  !Number.isNaN(d.getTime()) &&
  d.getFullYear() >= 1971 &&
  d.getFullYear() <= new Date().getFullYear() + 1;

/**
 * Read the capture date embedded in the file itself: EXIF DateTimeOriginal /
 * CreateDate for images (via exifr), container creation_time for videos
 * (via ffprobe). Returns null when the file carries no usable metadata.
 */
export async function extractEmbeddedDate(filePath: string): Promise<Date | null> {
  const ext = path.extname(filePath).toLowerCase();

  if (EXIF_IMAGE_EXTENSIONS.has(ext)) {
    try {
      const parsed = await exifr.parse(filePath, { pick: ['DateTimeOriginal', 'CreateDate'] });
      const candidate = parsed?.DateTimeOriginal ?? parsed?.CreateDate;
      if (isSaneDate(candidate)) return candidate;
    } catch {
      // Corrupt/unsupported metadata — treat as absent.
    }
    return null;
  }

  if (VIDEO_EXTENSIONS.has(ext)) {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) return resolve(null);
        const raw = metadata?.format?.tags?.creation_time;
        if (typeof raw !== 'string') return resolve(null);
        const parsed = new Date(raw);
        resolve(isSaneDate(parsed) ? parsed : null);
      });
    });
  }

  return null;
}

// Some filesystems report no real creation time (epoch 0 or garbage).
const isUsableBirthtime = (birthtime?: Date) =>
  !!birthtime && birthtime.getTime() > 24 * 60 * 60 * 1000;

/**
 * Resolve a capture date for a file according to the timeline date-source mode:
 *   - 'folder'   (default): folder name → filename pattern → file modified time
 *   - 'exif':     handled by resolveCaptureDateAuto (async metadata read);
 *                 this sync resolver applies the folder cascade as its fallback
 *   - 'created':  file creation time (birthtime), falling back to modified time
 *   - 'modified': file last-modified time
 */
export function resolveCaptureDate(filePath: string, times: FileTimes, mode: TimelineDateSource = 'folder'): CaptureDate {
  if (mode === 'modified') {
    return { capturedAt: times.mtime, precision: 'day', source: 'mtime' };
  }
  if (mode === 'created') {
    if (isUsableBirthtime(times.birthtime)) {
      return { capturedAt: times.birthtime!, precision: 'day', source: 'btime' };
    }
    return { capturedAt: times.mtime, precision: 'day', source: 'mtime' };
  }
  return (
    parseCaptureDateFromFolder(filePath) ??
    parseCaptureDateFromFilename(path.basename(filePath)) ??
    { capturedAt: times.mtime, precision: 'day', source: 'mtime' }
  );
}

/** Resolve using the admin-configured date source (cached DB setting). */
export async function resolveCaptureDateAuto(filePath: string, times: FileTimes): Promise<CaptureDate> {
  const { dateSource } = await getTimelineSettings();
  if (dateSource === 'exif') {
    const embedded = await extractEmbeddedDate(filePath);
    if (embedded) return { capturedAt: embedded, precision: 'day', source: 'exif' };
    // No embedded metadata — fall back to the default folder/filename cascade.
    return resolveCaptureDate(filePath, times, 'folder');
  }
  return resolveCaptureDate(filePath, times, dateSource);
}

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
