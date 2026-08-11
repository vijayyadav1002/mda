import path from 'node:path';
import { getTimelineSettings, type TimelineDateSource } from '../settings.js';
import { parseCaptureDateFromFolder, parseCaptureDateFromFilename, type CaptureDate } from './path-parsing.js';
import { extractEmbeddedDate } from './embedded-metadata.js';

export type FileTimes = { mtime: Date; birthtime?: Date };

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
